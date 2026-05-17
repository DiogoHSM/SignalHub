import { EventEmitter } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { spanPayloadSchema, tracePayloadSchema } from "@signal-hub/telemetry/ingestion-schemas";
import { describe, expect, it, vi } from "vitest";
import { parseSmokeArgs } from "./smoke-compose/args.js";
import { formatCommandFailure, runCommand } from "./smoke-compose/command.js";
import { cleanupPlan } from "./smoke-compose/cleanup.js";
import { createSmokePayloads, sourceMapFixtureContent } from "./smoke-compose/fixtures.js";
import { SmokeHttpError, createCookieJar, expectArrayContains, getJson, pollUntil, postJson } from "./smoke-compose/http.js";
import { createRedactor } from "./smoke-compose/redaction.js";
import { runSmokeCompose } from "./smoke-compose/runner.js";
import { createStepRecorder, renderSummary } from "./smoke-compose/steps.js";
import { createSmokeEnvContent, defaultSmokeSecrets, writeSmokeResources } from "./smoke-compose/temp-env.js";

describe("smoke compose primitives", () => {
  it("uses default smoke options", () => {
    expect(parseSmokeArgs([], {})).toEqual({
      projectName: "signalhub_smoke",
      apiUrl: "http://localhost:3000",
      preserve: false
    });
  });

  it("prefers flags over environment defaults", () => {
    expect(
      parseSmokeArgs(["--project-name", "signalhub_custom", "--api-url", "http://127.0.0.1:3300", "--preserve"], {
        SIGNALHUB_SMOKE_PROJECT_NAME: "signalhub_env",
        SIGNALHUB_SMOKE_API_URL: "http://localhost:4400"
      })
    ).toEqual({
      projectName: "signalhub_custom",
      apiUrl: "http://127.0.0.1:3300",
      preserve: true
    });
  });

  it("rejects incomplete and unknown arguments", () => {
    expect(() => parseSmokeArgs(["--project-name"], {})).toThrow("Missing value for --project-name");
    expect(() => parseSmokeArgs(["--project-name", "--api-url"], {})).toThrow("Missing value for --project-name");
    expect(() => parseSmokeArgs(["--api-url"], {})).toThrow("Missing value for --api-url");
    expect(() => parseSmokeArgs(["--api-url", "--preserve"], {})).toThrow("Missing value for --api-url");
    expect(() => parseSmokeArgs(["--mystery"], {})).toThrow("Unknown smoke argument: --mystery");
  });

  it("redacts registered secrets and credential URLs", () => {
    const redactor = createRedactor(["admin-password", "sh_secret", "cookie-value"]);
    const output = redactor.redact(
      "admin-password sh_secret cookie-value http://user:pass@localhost:3000/path https://token:secret@example.com/path"
    );

    expect(output).toBe(
      "[REDACTED] [REDACTED] [REDACTED] http://[REDACTED]@localhost:3000/path https://[REDACTED]@example.com/path"
    );
  });

  it("redacts uppercase HTTPS credential URLs", () => {
    const redactor = createRedactor([]);

    expect(redactor.redact("HTTPS://user:pass@example.com/path")).toBe("HTTPS://[REDACTED]@example.com/path");
  });

  it("redacts secrets registered after creation", () => {
    const redactor = createRedactor([]);

    redactor.add("late-secret");

    expect(redactor.redact("late-secret")).toBe("[REDACTED]");
  });

  it("records steps and renders summary counts", () => {
    const lines: string[] = [];
    const recorder = createStepRecorder((line) => lines.push(line));

    recorder.pass("doctor", "local checks passed");
    recorder.warn("native bindings", "optional build noise");
    recorder.fail("ready", "API readiness failed");

    expect(lines).toEqual([
      "[PASS] doctor - local checks passed",
      "[WARN] native bindings - optional build noise",
      "[FAIL] ready - API readiness failed"
    ]);
    expect(
      renderSummary({ commit: "abc1234", projectName: "signalhub_smoke", apiUrl: "http://localhost:3000" }, recorder.results())
    ).toBe([
      "Smoke summary",
      "- Commit: abc1234",
      "- Compose project: signalhub_smoke",
      "- API URL: http://localhost:3000",
      "- Passed: 1",
      "- Warnings: 1",
      "- Failed: 1"
    ].join("\n"));
  });
});

class FakeProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killedWith: NodeJS.Signals | number | undefined;

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killedWith = signal;
    this.emit("close", 143);
    return true;
  }
}

class HangingFakeProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killedWith: Array<NodeJS.Signals | number | undefined> = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killedWith.push(signal);
    return true;
  }
}

describe("smoke compose command execution", () => {
  it("captures stdout, stderr, and exit code", async () => {
    const child = new FakeProcess();
    const promise = runCommand(
      { command: "pnpm", args: ["--version"], timeoutMs: 500 },
      {
        spawnProcess: () => child
      }
    );

    child.stdout.write("9.15.4\n");
    child.stderr.write("warn\n");
    child.emit("close", 0);

    await expect(promise).resolves.toEqual({ exitCode: 0, stdout: "9.15.4\n", stderr: "warn\n" });
  });

  it("formats failures with redacted output", () => {
    const message = formatCommandFailure(
      { command: "curl", args: ["http://localhost:3000/auth/login"] },
      { exitCode: 1, stdout: "", stderr: "password=super-secret" },
      (value) => value.replaceAll("super-secret", "[REDACTED]")
    );

    expect(message).toContain("curl http://localhost:3000/auth/login");
    expect(message).toContain("[REDACTED]");
    expect(message).not.toContain("super-secret");
  });

  it("redacts secrets from formatted command arguments", () => {
    const message = formatCommandFailure(
      { command: "pnpm", args: ["source-maps:upload", "--token", "super-secret"] },
      { exitCode: 1, stdout: "", stderr: "upload failed" },
      (value) => value.replaceAll("super-secret", "[REDACTED]")
    );

    expect(message).toContain("[REDACTED]");
    expect(message).not.toContain("super-secret");
  });

  it("waits for process close after timeout SIGKILL escalation", async () => {
    vi.useFakeTimers();

    try {
      const child = new HangingFakeProcess();
      let settled = false;
      const promise = runCommand(
        { command: "pnpm", args: ["source-maps:upload", "--token", "super-secret"], timeoutMs: 5 },
        {
          spawnProcess: () => child
        }
      ).catch((error: Error) => {
        settled = true;
        return error;
      });

      await vi.advanceTimersByTimeAsync(5);
      expect(child.killedWith).toEqual(["SIGTERM"]);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1000);
      expect(child.killedWith).toEqual(["SIGTERM", "SIGKILL"]);
      expect(settled).toBe(false);

      child.emit("close", null);

      const error = await promise;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("pnpm timed out after 5ms");
      expect(error.message).not.toContain("--token");
      expect(error.message).not.toContain("super-secret");
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("smoke compose cleanup plan", () => {
  it("removes compose resources and temp files by default", () => {
    expect(cleanupPlan({ preserve: false, projectName: "signalhub_smoke", tempDir: "/tmp/signalhub-smoke-1" })).toEqual({
      preserve: false,
      commands: [["docker", "compose", "-p", "signalhub_smoke", "down", "-v"]],
      removeTempDir: true,
      message: "Cleanup will remove Compose resources and /tmp/signalhub-smoke-1"
    });
  });

  it("preserves resources when requested", () => {
    expect(cleanupPlan({ preserve: true, projectName: "signalhub_keep", tempDir: "/tmp/signalhub-smoke-2" })).toEqual({
      preserve: true,
      commands: [],
      removeTempDir: false,
      message:
        "Preserved Compose project signalhub_keep and temp directory /tmp/signalhub-smoke-2. Inspect logs with docker compose -p signalhub_keep logs."
    });
  });
});

describe("smoke compose temp env", () => {
  it("generates non-example local values from env example content", () => {
    const secrets = defaultSmokeSecrets("phase6b");
    const env = createSmokeEnvContent(
      [
        "DATABASE_URL=postgres://signalhub:signalhub-local-only-change-me@localhost:5432/signalhub",
        "REDIS_URL=redis://localhost:6379",
        "SESSION_SECRET=change-me-to-a-long-random-secret",
        "API_KEY_PEPPER=change-me-to-a-long-random-pepper",
        "BOOTSTRAP_ADMIN_EMAIL=admin@example.com",
        "BOOTSTRAP_ADMIN_PASSWORD=change-me-admin-password-32-chars-min",
        "POSTGRES_PASSWORD=signalhub-local-only-change-me",
        "SIGNALHUB_PUBLIC_ENDPOINT=http://localhost:3000"
      ].join("\n"),
      secrets,
      "http://localhost:3000"
    );

    expect(env).toContain("BOOTSTRAP_ADMIN_EMAIL=phase6b-admin@example.com");
    expect(env).toContain("SIGNALHUB_PUBLIC_ENDPOINT=http://localhost:3000");
    expect(env).not.toContain("change-me");
    expect(env).not.toContain("signalhub-local-only-change-me");
  });

  it("writes env and source-map resources into a temp directory", async () => {
    const root = join(tmpdir(), `signalhub-smoke-test-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const envExample = join(root, ".env.example");
    await writeFile(
      envExample,
      "BOOTSTRAP_ADMIN_EMAIL=admin@example.com\nBOOTSTRAP_ADMIN_PASSWORD=change-me-admin-password-32-chars-min\n"
    );

    try {
      const resources = await writeSmokeResources({
        tempRoot: root,
        envExamplePath: envExample,
        apiUrl: "http://localhost:3000",
        runId: "phase6b"
      });

      expect(resources.envFile).toContain(root);
      const envContent = await readFile(resources.envFile, "utf8");
      expect(envContent).toContain("BOOTSTRAP_ADMIN_EMAIL=phase6b-admin@example.com");
      expect(envContent).toContain(`SIGNALHUB_ENV_FILE=${resources.envFile}`);
      expect(await readFile(resources.sourceMapFile, "utf8")).toContain('"sources":["src/app.ts"]');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lets compose services load the generated env file path", async () => {
    const compose = await readFile("docker-compose.yml", "utf8");

    expect(compose.match(/path: \$\{SIGNALHUB_ENV_FILE:-\.env\}/g)).toHaveLength(2);
  });
});

describe("smoke compose fixtures", () => {
  it("creates deterministic payloads with a run marker", () => {
    const payloads = createSmokePayloads("phase6b");

    expect(payloads.event.name).toBe("phase6b.account.created");
    expect(payloads.error.fingerprint).toBe("phase6b-checkout-error");
    expect(payloads.trace.trace_id).toBe("trace_phase6b");
    expect(payloads.breadcrumb.message).toBe("Phase 6B selected shipping method");
  });

  it("creates traces accepted by the ingestion schema", () => {
    expect(() => tracePayloadSchema.parse(createSmokePayloads("phase6b").trace)).not.toThrow();
  });

  it("creates spans accepted by the ingestion schema", () => {
    expect(() => spanPayloadSchema.parse(createSmokePayloads("phase6b").span)).not.toThrow();
  });

  it("creates a source map that resolves app.min.js to src/app.ts", () => {
    const content = JSON.parse(sourceMapFixtureContent());

    expect(content.file).toBe("app.min.js");
    expect(content.sources).toEqual(["src/app.ts"]);
    expect(content.names).toContain("checkout");
  });
});

describe("smoke compose HTTP helpers", () => {
  it("keeps session cookies from set-cookie responses", async () => {
    const jar = createCookieJar();
    const fetchImpl = async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ "set-cookie": "sid=abc123; Path=/; HttpOnly" }),
        json: async () => ({ user: { email: "phase6b-admin@example.com" } }),
        text: async () => "{}"
      }) as Response;

    const response = await postJson<{ user: { email: string } }>("http://localhost:3000/auth/login", { email: "a", password: "b" }, {
      fetchImpl,
      cookieJar: jar
    });

    expect(response.user.email).toBe("phase6b-admin@example.com");
    expect(jar.header()).toBe("sid=abc123");
  });

  it("throws SmokeHttpError with redacted body text", async () => {
    const fetchImpl = async () =>
      ({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: async () => ({ error: "bad secret" }),
        text: async () => '{"error":"bad secret"}'
      }) as Response;

    const promise = getJson("http://localhost:3000/auth/me", {
      fetchImpl,
      redact: (value) => value.replace("secret", "[REDACTED]")
    });

    await expect(promise).rejects.toBeInstanceOf(SmokeHttpError);
    await expect(promise).rejects.toMatchObject({
      status: 401,
      body: '{"error":"bad [REDACTED]"}'
    });
  });

  it("polls until the callback returns a value", async () => {
    let attempts = 0;

    await expect(
      pollUntil(
        "wait for data",
        async () => {
          attempts += 1;
          return attempts === 3 ? "ready" : null;
        },
        { attempts: 5, delayMs: 1 }
      )
    ).resolves.toBe("ready");
  });

  it("asserts arrays contain matching objects", () => {
    expectArrayContains([{ name: "phase6b.account.created" }], (item) => item.name === "phase6b.account.created", "event marker");
    expect(() => expectArrayContains([], () => false, "missing marker")).toThrow("Expected missing marker");
  });
});

describe("smoke compose runner", () => {
  it("runs lifecycle steps with cleanup by default", async () => {
    const calls: string[] = [];
    const lines: string[] = [];

    const exitCode = await runSmokeCompose({
      options: { projectName: "signalhub_smoke", apiUrl: "http://localhost:3000", preserve: false },
      write: (line) => lines.push(line),
      dependencies: {
        getCommit: async () => "abc1234",
        prepareResources: async () => ({
          tempDir: "/tmp/signalhub-smoke-1",
          envFile: "/tmp/signalhub-smoke-1/.env",
          sourceMapFile: "/tmp/signalhub-smoke-1/app.min.js.map",
          secrets: {
            postgresPassword: "postgres-secret",
            sessionSecret: "session-secret",
            apiKeyPepper: "pepper-secret",
            adminEmail: "phase6b-admin@example.com",
            adminPassword: "admin-secret"
          }
        }),
        runCommand: async (input) => {
          calls.push([input.command, ...input.args].join(" "));
          return { exitCode: 0, stdout: "ok", stderr: "" };
        },
        runHttpSmoke: async () => {
          calls.push("http-smoke");
        },
        removeTempDir: async (dir) => {
          calls.push(`rm ${dir}`);
        }
      }
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      "pnpm run doctor -- --env-file /tmp/signalhub-smoke-1/.env",
      "docker compose -p signalhub_smoke --env-file /tmp/signalhub-smoke-1/.env config --quiet",
      "docker compose -p signalhub_smoke --env-file /tmp/signalhub-smoke-1/.env up -d postgres redis",
      "docker compose -p signalhub_smoke --env-file /tmp/signalhub-smoke-1/.env run --rm api pnpm seed:admin",
      "docker compose -p signalhub_smoke --env-file /tmp/signalhub-smoke-1/.env up -d --build",
      "pnpm run doctor -- --compose --api-url http://localhost:3000 --env-file /tmp/signalhub-smoke-1/.env",
      "http-smoke",
      "docker compose -p signalhub_smoke --env-file /tmp/signalhub-smoke-1/.env run --rm worker pnpm backup:create",
      "docker compose -p signalhub_smoke --env-file /tmp/signalhub-smoke-1/.env run --rm worker pnpm backup:restore -- /var/lib/signalhub/backups/latest.dump",
      "docker compose -p signalhub_smoke --env-file /tmp/signalhub-smoke-1/.env stop api worker",
      "docker compose -p signalhub_smoke --env-file /tmp/signalhub-smoke-1/.env run --rm worker pnpm backup:restore -- /var/lib/signalhub/backups/latest.dump --yes",
      "docker compose -p signalhub_smoke --env-file /tmp/signalhub-smoke-1/.env start api worker",
      "pnpm run doctor -- --compose --api-url http://localhost:3000 --env-file /tmp/signalhub-smoke-1/.env",
      "http-smoke",
      "docker compose -p signalhub_smoke down -v",
      "rm /tmp/signalhub-smoke-1"
    ]);
    expect(lines.join("\n")).toContain("Smoke summary");
  });
});
