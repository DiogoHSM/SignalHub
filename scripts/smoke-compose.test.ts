import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { spanPayloadSchema, tracePayloadSchema } from "@sigmon/telemetry/ingestion-schemas";
import { describe, expect, it, vi } from "vitest";
import { parseSmokeArgs } from "./smoke-compose/args.js";
import { formatCommandFailure, runCommand } from "./smoke-compose/command.js";
import { cleanupPlan } from "./smoke-compose/cleanup.js";
import { createSmokePayloads, sourceMapFixtureContent } from "./smoke-compose/fixtures.js";
import {
  SmokeHttpError,
  createCookieJar,
  expectArrayContains,
  getJson,
  pollUntil,
  postJson,
  uploadSourceMapFile
} from "./smoke-compose/http.js";
import { createRedactor } from "./smoke-compose/redaction.js";
import { isSmokeErrorGroup, pollForAssertion, runSmokeCompose } from "./smoke-compose/runner.js";
import { createStepRecorder, renderSummary } from "./smoke-compose/steps.js";
import { createSmokeEnvContent, defaultSmokeSecrets, writeSmokeResources } from "./smoke-compose/temp-env.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const doctorEntry = fileURLToPath(new URL("./doctor.ts", import.meta.url));

describe("smoke compose primitives", () => {
  it("uses default smoke options", () => {
    expect(parseSmokeArgs([], {})).toEqual({
      projectName: "sigmon_smoke",
      apiUrl: "http://localhost:3000",
      preserve: false
    });
  });

  it("prefers flags over environment defaults", () => {
    expect(
      parseSmokeArgs(["--project-name", "sigmon_custom", "--api-url", "http://127.0.0.1:3300", "--preserve"], {
        SIGMON_SMOKE_PROJECT_NAME: "sigmon_env",
        SIGMON_SMOKE_API_URL: "http://localhost:4400"
      })
    ).toEqual({
      projectName: "sigmon_custom",
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
      renderSummary({ commit: "abc1234", projectName: "sigmon_smoke", apiUrl: "http://localhost:3000" }, recorder.results())
    ).toBe([
      "Smoke summary",
      "- Commit: abc1234",
      "- Compose project: sigmon_smoke",
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
  it("launches the real doctor parser through Node without invoking Docker", async () => {
    const literalArgument = "--literal value & $() | < >";

    await expect(execFileAsync(process.execPath, [tsxCli, doctorEntry, literalArgument], { shell: false })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`Unknown doctor argument: ${literalArgument}`)
    });
  });

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
    expect(cleanupPlan({ preserve: false, projectName: "sigmon_smoke", tempDir: "/tmp/sigmon-smoke-1" })).toEqual({
      preserve: false,
      commands: [["docker", "compose", "-p", "sigmon_smoke", "down", "-v"]],
      removeTempDir: true,
      message: "Cleanup will remove Compose resources and /tmp/sigmon-smoke-1"
    });
  });

  it("preserves resources when requested", () => {
    expect(cleanupPlan({ preserve: true, projectName: "sigmon_keep", tempDir: "/tmp/sigmon-smoke-2" })).toEqual({
      preserve: true,
      commands: [],
      removeTempDir: false,
      message:
        "Preserved Compose project sigmon_keep and temp directory /tmp/sigmon-smoke-2. Inspect logs with docker compose -p sigmon_keep logs."
    });
  });
});

describe("smoke compose temp env", () => {
  it("generates non-example local values from env example content", () => {
    const secrets = defaultSmokeSecrets("phase6b");
    const env = createSmokeEnvContent(
      [
        "DATABASE_URL=postgres://sigmon:sigmon-local-only-change-me@localhost:5432/sigmon",
        "REDIS_URL=redis://localhost:6379",
        "SESSION_SECRET=change-me-to-a-long-random-secret",
        "API_KEY_PEPPER=change-me-to-a-long-random-pepper",
        "BOOTSTRAP_ADMIN_EMAIL=admin@example.com",
        "BOOTSTRAP_ADMIN_PASSWORD=change-me-admin-password-32-chars-min",
        "POSTGRES_PASSWORD=sigmon-local-only-change-me",
        "SIGMON_PUBLIC_ENDPOINT=http://localhost:3000"
      ].join("\n"),
      secrets,
      "http://localhost:3000"
    );

    expect(env).toContain("BOOTSTRAP_ADMIN_EMAIL=phase6b-admin@example.com");
    expect(env).toContain("SIGMON_PUBLIC_ENDPOINT=http://localhost:3000");
    expect(env).not.toContain("change-me");
    expect(env).not.toContain("sigmon-local-only-change-me");
  });

  it("writes env and source-map resources into a temp directory", async () => {
    const root = join(tmpdir(), `sigmon-smoke-test-${Date.now()}`);
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
      expect(envContent).toContain(`SIGMON_ENV_FILE=${resources.envFile}`);
      expect(await readFile(resources.sourceMapFile, "utf8")).toContain('"sources":["src/app.ts"]');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lets compose services load the generated env file path", async () => {
    const compose = await readFile("docker-compose.yml", "utf8");

    expect(compose.match(/path: \$\{SIGMON_ENV_FILE:-\.env\}/g)).toHaveLength(2);
  });

  it("mounts one exact read-write source-map volume into API and worker", async () => {
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "--project-name", "sigmon_contract", "config", "--no-normalize", "--format", "json"],
      { cwd: process.cwd(), encoding: "utf8" }
    );
    const compose = JSON.parse(stdout) as {
      services: Record<string, {
        volumes?: Array<{ type: string; source: string; target: string; read_only?: boolean }>;
        depends_on?: Record<string, { condition?: string }>;
      }>;
      volumes: Record<string, unknown>;
    };
    const expected = {
      type: "volume",
      source: "source_map_data",
      target: "/var/lib/sigmon/source-maps"
    };

    expect(compose.volumes).toHaveProperty("source_map_data");
    for (const serviceName of ["api", "worker"]) {
      const matches = (compose.services[serviceName]?.volumes ?? []).filter(
        (volume) => volume.source === expected.source || volume.target === expected.target
      );
      expect(matches, serviceName).toHaveLength(1);
      expect(matches[0]).toMatchObject(expected);
      expect(matches[0].read_only ?? false).toBe(false);
    }
    expect(compose.services.worker?.depends_on?.api).toMatchObject({ condition: "service_healthy" });
    expect(compose.services.api?.depends_on).not.toHaveProperty("api");
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

  it("keeps payload timestamps inside the default entity query window", () => {
    const createdAt = new Date("2026-05-24T21:17:00.000Z");
    const payloads = createSmokePayloads("phase6b", createdAt);
    const sevenDaysAgo = createdAt.getTime() - 7 * 24 * 60 * 60 * 1000;

    expect(new Date(payloads.event.timestamp).getTime()).toBeGreaterThan(sevenDaysAgo);
    expect(new Date(payloads.breadcrumb.timestamp).getTime()).toBeLessThanOrEqual(createdAt.getTime());
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

  it("keeps multiple and host-prefixed cookies from set-cookie responses", async () => {
    const jar = createCookieJar();
    const headers = new Headers();
    headers.append("set-cookie", "__Host-sigmon_session=session_1; Path=/; Secure; HttpOnly");
    headers.append("set-cookie", "sigmon_oauth_state=state_1; Path=/auth/google/callback; HttpOnly");

    jar.addFromResponse(headers);
    expect(jar.header()).toBe("__Host-sigmon_session=session_1; sigmon_oauth_state=state_1");

    const clearHeaders = new Headers();
    clearHeaders.append("set-cookie", "sigmon_oauth_state=; Path=/auth/google/callback; Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    jar.addFromResponse(clearHeaders);

    expect(jar.header()).toBe("__Host-sigmon_session=session_1");
  });

  it("splits combined set-cookie values returned by getSetCookie", async () => {
    const jar = createCookieJar();
    const headers = new Headers() as Headers & { getSetCookie: () => string[] };
    headers.getSetCookie = () => [
      "a=1; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT, __Host-b=2; Path=/; Secure; HttpOnly, empty=; Path=/"
    ];

    jar.addFromResponse(headers);

    expect(jar.header()).toBe("a=1; __Host-b=2");
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

  it("matches error group responses by grouping fingerprint", () => {
    expect(isSmokeErrorGroup({ groupingFingerprint: "phase6b-checkout-error" }, "phase6b-checkout-error")).toBe(true);
  });

  it("polls assertions until they stop throwing", async () => {
    let attempts = 0;

    await pollForAssertion(
      "eventually persisted smoke data",
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("not persisted yet");
        }
      },
      { attempts: 5, delayMs: 1 }
    );

    expect(attempts).toBe(3);
  });
});

describe("smoke compose source map upload", () => {
  it("uploads a source map file with a bearer token", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push([String(url), init ?? {}]);
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ artifacts: [{ minifiedFile: "app.min.js" }] }),
        text: async () => "{}"
      } as Response;
    };

    const response = await uploadSourceMapFile("http://localhost:3000/", {
      token: "shsmap_secret",
      projectId: "prj_1",
      environmentId: "env_1",
      release: "web@phase6b",
      filePath: "/tmp/app.min.js.map",
      minifiedFile: "app.min.js",
      fileContent: "{}",
      fetchImpl
    });

    expect(response.artifacts[0].minifiedFile).toBe("app.min.js");
    expect(calls[0][0]).toBe("http://localhost:3000/v1/source-maps");
    const headers = new Headers(calls[0][1].headers);
    expect(headers.get("authorization")).toBe("Bearer shsmap_secret");
    expect(headers.get("content-type")).toBeNull();

    expect(calls[0][1].body).toBeInstanceOf(FormData);
    const body = calls[0][1].body as FormData;
    expect(body.get("project_id")).toBe("prj_1");
    expect(body.get("environment_id")).toBe("env_1");
    expect(body.get("release")).toBe("web@phase6b");
    expect(body.get("minified_file")).toBe("app.min.js");
    expect(body.get("file")).toBeInstanceOf(Blob);
  });

  it("throws SmokeHttpError when source map upload is rejected", async () => {
    const fetchImpl = async () =>
      ({
        ok: false,
        status: 403,
        headers: new Headers(),
        json: async () => ({ error: "forbidden" }),
        text: async () => "scope mismatch"
      }) as Response;

    const promise = uploadSourceMapFile("http://localhost:3000", {
      token: "shsmap_secret",
      projectId: "prj_1",
      environmentId: "env_1",
      release: "web@phase6b",
      filePath: "/tmp/app.min.js.map",
      minifiedFile: "app.min.js",
      fileContent: "{}",
      fetchImpl
    });

    await expect(promise).rejects.toBeInstanceOf(SmokeHttpError);
    await expect(promise).rejects.toMatchObject({
      status: 403,
      body: "scope mismatch"
    });
  });
});

describe("smoke compose runner", () => {
  const runnerOptions = { projectName: "sigmon_smoke", apiUrl: "http://localhost:3000", preserve: false };

  const preparedResources = async () => ({
    tempDir: "/tmp/sigmon-smoke-1",
    envFile: "/tmp/sigmon-smoke-1/.env",
    sourceMapFile: "/tmp/sigmon-smoke-1/app.min.js.map",
    secrets: {
      postgresPassword: "postgres-secret",
      sessionSecret: "session-secret",
      apiKeyPepper: "pepper-secret",
      adminEmail: "phase6b-admin@example.com",
      adminPassword: "admin-secret"
    }
  });

  const commandString = (input: { command: string; args: string[] }) => [input.command, ...input.args].join(" ");

  it("runs lifecycle steps with cleanup by default", async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    const smokeScope = { projectId: "prj_1", environmentId: "env_1", errorId: "err_1" };

    const exitCode = await runSmokeCompose({
      options: runnerOptions,
      write: (line) => lines.push(line),
      dependencies: {
        getCommit: async () => "abc1234",
        prepareResources: preparedResources,
        runCommand: async (input) => {
          const command = commandString(input);
          calls.push(command);
          if (command.includes("ls -1t /var/lib/sigmon/backups/*.dump")) {
            return { exitCode: 0, stdout: "/var/lib/sigmon/backups/sigmon-smoke.dump\n", stderr: "" };
          }
          if (command.includes("backup:restore -- ") && !command.endsWith(" --yes")) {
            return { exitCode: 1, stdout: "", stderr: "Restore requires --yes" };
          }
          return { exitCode: 0, stdout: "ok", stderr: "" };
        },
        runHttpSmoke: async (input) => {
          if (input.phase === "pre-restore") {
            calls.push("http-smoke");
            return smokeScope;
          }

          expect(input.scope).toEqual(smokeScope);
          calls.push("http-smoke");
        },
        removeTempDir: async (dir) => {
          calls.push(`rm ${dir}`);
        },
        wait: async (ms) => {
          calls.push(`wait ${ms}`);
        }
      }
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      `${process.execPath} ${tsxCli} ${doctorEntry} --env-file /tmp/sigmon-smoke-1/.env`,
      "docker compose -p sigmon_smoke --env-file /tmp/sigmon-smoke-1/.env config --quiet",
      "docker compose -p sigmon_smoke --env-file /tmp/sigmon-smoke-1/.env up -d postgres redis",
      "docker compose -p sigmon_smoke --env-file /tmp/sigmon-smoke-1/.env run --rm api pnpm seed:admin",
      "docker compose -p sigmon_smoke --env-file /tmp/sigmon-smoke-1/.env up -d --build",
      `${process.execPath} ${tsxCli} ${doctorEntry} --compose --api-url http://localhost:3000 --env-file /tmp/sigmon-smoke-1/.env`,
      "http-smoke",
      "docker compose -p sigmon_smoke --env-file /tmp/sigmon-smoke-1/.env run --rm worker pnpm backup:create",
      "docker compose -p sigmon_smoke --env-file /tmp/sigmon-smoke-1/.env run --rm worker sh -lc ls -1t /var/lib/sigmon/backups/*.dump | head -n 1",
      "docker compose -p sigmon_smoke --env-file /tmp/sigmon-smoke-1/.env run --rm worker pnpm backup:restore -- /var/lib/sigmon/backups/sigmon-smoke.dump",
      "docker compose -p sigmon_smoke --env-file /tmp/sigmon-smoke-1/.env stop api worker",
      "docker compose -p sigmon_smoke --env-file /tmp/sigmon-smoke-1/.env run --rm worker pnpm backup:restore -- /var/lib/sigmon/backups/sigmon-smoke.dump --yes",
      "docker compose -p sigmon_smoke --env-file /tmp/sigmon-smoke-1/.env start api worker",
      `${process.execPath} ${tsxCli} ${doctorEntry} --compose --api-url http://localhost:3000 --env-file /tmp/sigmon-smoke-1/.env`,
      "http-smoke",
      "docker compose -p sigmon_smoke down -v",
      "rm /tmp/sigmon-smoke-1"
    ]);
    expect(lines.join("\n")).toContain("Smoke summary");
  });

  it("retries compose doctor while the API becomes ready", async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    let composeDoctorAttempts = 0;
    const smokeScope = { projectId: "prj_1", environmentId: "env_1", errorId: "err_1" };

    const exitCode = await runSmokeCompose({
      options: runnerOptions,
      write: (line) => lines.push(line),
      dependencies: {
        getCommit: async () => "abc1234",
        prepareResources: preparedResources,
        runCommand: async (input) => {
          const command = commandString(input);
          calls.push(command);
          if (command === `${process.execPath} ${tsxCli} ${doctorEntry} --compose --api-url http://localhost:3000 --env-file /tmp/sigmon-smoke-1/.env`) {
            composeDoctorAttempts += 1;
            if (composeDoctorAttempts === 1) {
              return { exitCode: 1, stdout: "[FAIL] API /ready is unreachable", stderr: "" };
            }
          }
          if (command.includes("ls -1t /var/lib/sigmon/backups/*.dump")) {
            return { exitCode: 0, stdout: "/var/lib/sigmon/backups/sigmon-smoke.dump\n", stderr: "" };
          }
          if (command.includes("backup:restore -- ") && !command.endsWith(" --yes")) {
            return { exitCode: 1, stdout: "", stderr: "Restore requires --yes" };
          }
          return { exitCode: 0, stdout: "ok", stderr: "" };
        },
        runHttpSmoke: async (input) => {
          if (input.phase === "pre-restore") {
            return smokeScope;
          }
        },
        removeTempDir: async (dir) => {
          calls.push(`rm ${dir}`);
        },
        wait: async (ms) => {
          calls.push(`wait ${ms}`);
        }
      }
    });

    expect(exitCode).toBe(0);
    expect(composeDoctorAttempts).toBe(3);
    expect(calls).toContain("wait 2500");
  });

  it("fails if restore without confirmation unexpectedly succeeds and still cleans up", async () => {
    const calls: string[] = [];
    const lines: string[] = [];

    const exitCode = await runSmokeCompose({
      options: runnerOptions,
      write: (line) => lines.push(line),
      dependencies: {
        getCommit: async () => "abc1234",
        prepareResources: preparedResources,
        runCommand: async (input) => {
          const command = commandString(input);
          calls.push(command);
          if (command.includes("ls -1t /var/lib/sigmon/backups/*.dump")) {
            return { exitCode: 0, stdout: "/var/lib/sigmon/backups/sigmon-smoke.dump\n", stderr: "" };
          }
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

    expect(exitCode).toBe(1);
    expect(lines.join("\n")).toContain("restore without --yes unexpectedly succeeded");
    expect(calls).toContain("docker compose -p sigmon_smoke down -v");
    expect(calls).toContain("rm /tmp/sigmon-smoke-1");
  });

  it("fails if backup discovery returns no dump path and still cleans up", async () => {
    const calls: string[] = [];
    const lines: string[] = [];

    const exitCode = await runSmokeCompose({
      options: runnerOptions,
      write: (line) => lines.push(line),
      dependencies: {
        getCommit: async () => "abc1234",
        prepareResources: preparedResources,
        runCommand: async (input) => {
          const command = commandString(input);
          calls.push(command);
          if (command.includes("ls -1t /var/lib/sigmon/backups/*.dump")) {
            return { exitCode: 0, stdout: "\n", stderr: "" };
          }
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

    expect(exitCode).toBe(1);
    expect(lines.join("\n")).toContain("Backup completed but no dump path was found");
    expect(calls).toContain("docker compose -p sigmon_smoke down -v");
    expect(calls).toContain("rm /tmp/sigmon-smoke-1");
  });
});
