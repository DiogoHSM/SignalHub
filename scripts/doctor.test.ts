import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  buildDoctorResults,
  checkApiHealth,
  checkCommand,
  checkEnvValues,
  createResult,
  getExitCode,
  parseDoctorArgs,
  redactDoctorText,
  renderResults,
  runCommandWithTimeout,
  runDoctor,
  selectPnpmVersionCommand,
  type DoctorEnv
} from "./doctor.js";

const validEnv: DoctorEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://sigmon:correct-password@localhost:5432/sigmon",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "a-secure-session-secret-with-enough-length",
  API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
  BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
  BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple-long-enough",
  GOOGLE_OAUTH_ENABLED: "false",
  SIGMON_PUBLIC_ENDPOINT: "https://sigmon.example.com",
  POSTGRES_PASSWORD: "correct-password",
  POSTGRES_PASSWORD_URLENCODED: "",
  BACKUPS_ENABLED: "true",
  BACKUPS_LOCAL_DIR: "/var/lib/sigmon/backups",
  BACKUPS_S3_ENABLED: "false",
  RETENTION_ENABLED: "true",
  ALERTS_ENABLED: "true"
};

describe("doctor pure checks", () => {
  it("maps failed checks to a non-zero exit code", () => {
    expect(getExitCode([createResult("pass", "ok"), createResult("warn", "review"), createResult("fail", "bad")])).toBe(1);
    expect(getExitCode([createResult("pass", "ok"), createResult("warn", "review")])).toBe(0);
  });

  it("detects missing required environment variables", () => {
    const { SESSION_SECRET: _sessionSecret, ...env } = validEnv;

    const results = checkEnvValues(env);

    expect(results).toContainEqual(
      expect.objectContaining({
        status: "fail",
        message: "SESSION_SECRET is missing"
      })
    );
  });

  it("warns for production localhost public endpoints", () => {
    const results = checkEnvValues({
      ...validEnv,
      SIGMON_PUBLIC_ENDPOINT: "http://localhost:3000"
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        status: "warn",
        message: "SIGMON_PUBLIC_ENDPOINT points to localhost in production"
      })
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        status: "warn",
        message: "SIGMON_PUBLIC_ENDPOINT uses plain HTTP in production"
      })
    );
  });

  it("warns for production IPv6 localhost public endpoints", () => {
    const results = checkEnvValues({
      ...validEnv,
      SIGMON_PUBLIC_ENDPOINT: "https://[::1]:3000"
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        status: "warn",
        message: "SIGMON_PUBLIC_ENDPOINT points to localhost in production"
      })
    );
  });

  it("fails production envs that keep the local-only postgres password placeholder", () => {
    const results = checkEnvValues({
      ...validEnv,
      NODE_ENV: "production",
      POSTGRES_PASSWORD: "sigmon-local-only-change-me",
      DATABASE_URL: "postgres://sigmon:sigmon-local-only-change-me@postgres:5432/sigmon"
    });

    expect(results).toContainEqual(
      expect.objectContaining({ status: "fail", message: "POSTGRES_PASSWORD must be set and replaced for production" })
    );
  });

  it("fails production envs that omit the postgres password", () => {
    const { POSTGRES_PASSWORD: _postgresPassword, ...env } = validEnv;

    const results = checkEnvValues({
      ...env,
      NODE_ENV: "production"
    });

    expect(results).toContainEqual(
      expect.objectContaining({ status: "fail", message: "POSTGRES_PASSWORD must be set and replaced for production" })
    );
  });

  it("warns when S3 backups are enabled with missing settings", () => {
    const results = checkEnvValues({
      ...validEnv,
      BACKUPS_S3_ENABLED: "true",
      BACKUPS_S3_ENDPOINT: "",
      BACKUPS_S3_BUCKET: "",
      BACKUPS_S3_ACCESS_KEY_ID: "",
      BACKUPS_S3_SECRET_ACCESS_KEY: "",
      BACKUPS_S3_PREFIX: ""
    });

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "warn", message: "BACKUPS_S3_ENDPOINT is missing while S3 backups are enabled" }),
        expect.objectContaining({ status: "warn", message: "BACKUPS_S3_BUCKET is missing while S3 backups are enabled" }),
        expect.objectContaining({ status: "warn", message: "BACKUPS_S3_ACCESS_KEY_ID is missing while S3 backups are enabled" }),
        expect.objectContaining({ status: "warn", message: "BACKUPS_S3_SECRET_ACCESS_KEY is missing while S3 backups are enabled" }),
        expect.objectContaining({ status: "warn", message: "BACKUPS_S3_PREFIX is missing while S3 backups are enabled" })
      ])
    );
  });

  it("redacts secret values from rendered output", () => {
    const output = renderResults([createResult("fail", "SESSION_SECRET is abc123secretvalue")]);

    expect(redactDoctorText(output, ["abc123secretvalue"])).toContain("[REDACTED]");
    expect(redactDoctorText(output, ["abc123secretvalue"])).not.toContain("abc123secretvalue");
  });
});

describe("container runtime configuration", () => {
  const getServiceBlock = (composeText: string, serviceName: string) => {
    const match = composeText.match(new RegExp(`^  ${serviceName}:\\n[\\s\\S]*?(?=^  \\w|^volumes:)`, "m"));
    return match?.[0] ?? "";
  };

  it("defines compose healthchecks for api and worker services", () => {
    const composeText = readFileSync("docker-compose.yml", "utf8");
    const healthcheckCount = composeText.match(/^\s+healthcheck:/gm)?.length ?? 0;

    expect(composeText).toContain("  api:");
    expect(composeText).toContain("  worker:");
    expect(healthcheckCount).toBeGreaterThanOrEqual(4);
    expect(getServiceBlock(composeText, "api")).toContain("curl -fsS http://localhost:3000/health >/dev/null");
    expect(getServiceBlock(composeText, "worker")).toContain("ps | grep -v grep | grep -q 'worker'");
  });

  it("hardens the Dockerfile runtime with tini, curl, and a non-root user", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");

    expect(dockerfile).toContain("# syntax=docker/dockerfile:1.7");
    expect(dockerfile).toContain("apk add --no-cache postgresql16-client tini curl");
    expect(dockerfile).toContain("addgroup -S sigmon && adduser -S -G sigmon sigmon");
    expect(dockerfile).toContain("corepack enable && corepack prepare pnpm@9.15.4 --activate");
    expect(dockerfile).toContain("mkdir -p /app /var/lib/sigmon/backups /var/lib/sigmon/source-maps");
    expect(dockerfile).toContain("COPY --chown=sigmon:sigmon apps/api/package.json ./apps/api/package.json");
    expect(dockerfile).toContain("COPY --chown=sigmon:sigmon packages/sdk/package.json ./packages/sdk/package.json");
    expect(dockerfile).toContain(
      "RUN --mount=type=cache,id=sigmon-pnpm-store,target=/home/sigmon/.local/share/pnpm/store pnpm install --frozen-lockfile"
    );
    expect(dockerfile).toContain("COPY --chown=sigmon:sigmon apps ./apps");
    expect(dockerfile).toContain("USER sigmon");
    expect(dockerfile.indexOf("USER sigmon")).toBeLessThan(dockerfile.indexOf("pnpm install --frozen-lockfile"));
    expect(dockerfile.indexOf("apps/api/package.json")).toBeLessThan(dockerfile.indexOf("RUN --mount=type=cache"));
    expect(dockerfile.indexOf("RUN --mount=type=cache")).toBeLessThan(dockerfile.indexOf("COPY --chown=sigmon:sigmon apps ./apps"));
    expect(dockerfile).not.toContain("RUN chown -R sigmon:sigmon /app /var/lib/sigmon");
    expect(dockerfile).toContain('ENTRYPOINT ["/sbin/tini", "--"]');
    expect(dockerfile).toContain('CMD ["pnpm", "start:api"]');
  });

  it("keeps local Docker build contexts small", () => {
    const dockerignore = readFileSync(".dockerignore", "utf8");

    expect(dockerignore).toContain("node_modules");
    expect(dockerignore).toContain("**/node_modules");
    expect(dockerignore).toContain(".worktrees");
    expect(dockerignore).toContain("SECRETS.md");
    expect(dockerignore).toContain("audit.md");
  });
});

describe("doctor orchestration", () => {
  const buildEnvContent = (env: DoctorEnv) => Object.entries(env).map(([key, value]) => `${key}=${value ?? ""}`).join("\n");
  const runDoctorChecks = async (env: DoctorEnv, checkDirectoryWritable = () => true) =>
    buildDoctorResults({
      options: { compose: false, envFile: ".env" },
      fileExists: (path) => path === ".env",
      readFile: () => buildEnvContent(env),
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      fetchHealth: async () => ({ ok: true, status: 200 }),
      checkDirectoryWritable
    });
  const sourceMapDirectoryWarning = expect.objectContaining({
    status: "warn",
    message: "SOURCE_MAPS_LOCAL_DIR is missing or not writable"
  });

  it("parses compose and api URL arguments", () => {
    expect(parseDoctorArgs(["--compose", "--api-url", "http://localhost:3000"])).toEqual({
      compose: true,
      apiUrl: "http://localhost:3000",
      envFile: ".env"
    });
  });

  it("ignores the standalone separator forwarded by pnpm run", () => {
    expect(parseDoctorArgs(["--", "--env-file", "/tmp/sigmon-doctor.env"])).toEqual({
      compose: false,
      envFile: "/tmp/sigmon-doctor.env"
    });
  });

  it("fails unknown arguments", () => {
    expect(() => parseDoctorArgs(["--unknown"])).toThrow("Unknown doctor argument: --unknown");
  });

  it("turns successful command execution into a pass", async () => {
    const result = await checkCommand("Docker Compose config", ["docker", "compose", "config", "--quiet"], async () => ({
      exitCode: 0,
      stdout: "",
      stderr: ""
    }));

    expect(result).toEqual(expect.objectContaining({ status: "pass", message: "Docker Compose config passed" }));
  });

  it("turns failed command execution into a fail with concise detail", async () => {
    const result = await checkCommand("Docker Compose config", ["docker", "compose", "config", "--quiet"], async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "invalid compose file"
    }));

    expect(result).toEqual(
      expect.objectContaining({
        status: "fail",
        message: "Docker Compose config failed",
        detail: "invalid compose file"
      })
    );
  });

  it("uses Node to run Corepack's pnpm entry point on Windows", async (context) => {
    const corepackRoot = process.env.COREPACK_ROOT;
    if (process.platform !== "win32" || !corepackRoot) {
      context.skip();
      return;
    }

    const commands: string[][] = [];
    await buildDoctorResults({
      options: { compose: false, envFile: ".env" },
      fileExists: () => true,
      readFile: () => buildEnvContent(validEnv),
      runCommand: async (command) => {
        commands.push(command);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      fetchHealth: async () => ({ ok: true, status: 200 }),
      checkDirectoryWritable: () => true
    });

    expect(commands[1]).toEqual([process.execPath, join(corepackRoot, "dist", "pnpm.js"), "--version"]);
  });

  it("reports the bare pnpm Windows no-shell failure without relying on PATH", async () => {
    const command = selectPnpmVersionCommand({
      platform: "win32",
      execPath: "C:\\node.exe",
      corepackRoot: "C:\\missing-corepack",
      isFile: () => false
    });
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: (signal: NodeJS.Signals) => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    const spawned: Array<[string, string[]]> = [];

    const result = await checkCommand("pnpm version check", command, (input) =>
      runCommandWithTimeout(input, 1_000, {
        spawnProcess: (program, args) => {
          spawned.push([program, args]);
          queueMicrotask(() => child.emit("error", new Error("spawn pnpm ENOENT")));
          return child;
        }
      })
    );

    expect(spawned).toEqual([["pnpm", ["--version"]]]);
    expect(result).toEqual(
      expect.objectContaining({ status: "fail", message: "pnpm version check failed", detail: "spawn pnpm ENOENT" })
    );
  });

  it("selects the validated Corepack pnpm entry point as literal Windows argv", () => {
    const execPath = "C:\\Node Runtime & Tools\\node.exe";
    const corepackRoot = "C:\\Corepack Root & Tools";
    const entryPoint = join(corepackRoot, "dist", "pnpm.js");

    expect(
      selectPnpmVersionCommand({
        platform: "win32",
        execPath,
        corepackRoot,
        isFile: (path) => path === entryPoint
      })
    ).toEqual([execPath, entryPoint, "--version"]);
  });

  it("preserves the bare pnpm command outside Windows", () => {
    expect(
      selectPnpmVersionCommand({
        platform: "linux",
        execPath: "/usr/bin/node",
        corepackRoot: "/opt/corepack",
        isFile: () => true
      })
    ).toEqual(["pnpm", "--version"]);
  });

  it("falls back to the normal pnpm check when Corepack runtime data is missing or invalid", () => {
    expect(selectPnpmVersionCommand({ platform: "win32", execPath: "C:\\node.exe", corepackRoot: "" })).toEqual([
      "pnpm",
      "--version"
    ]);
    expect(
      selectPnpmVersionCommand({
        platform: "win32",
        execPath: "C:\\node.exe",
        corepackRoot: "C:\\missing-corepack",
        isFile: () => false
      })
    ).toEqual(["pnpm", "--version"]);
  });

  it("runs the installed Corepack pnpm entry point with the local Node runtime", (context) => {
    if (process.platform !== "win32" || !process.env.COREPACK_ROOT) {
      context.skip();
      return;
    }

    const command = selectPnpmVersionCommand();
    expect(command).toHaveLength(3);
    expect(execFileSync(command[0]!, command.slice(1), { encoding: "utf8" }).trim()).toBe("9.15.4");
  });

  it("checks API health and readiness endpoints", async () => {
    const results = await checkApiHealth("http://localhost:3000", async (url) => ({
      ok: url.endsWith("/health") || url.endsWith("/ready"),
      status: 200
    }));

    expect(results).toEqual([
      expect.objectContaining({ status: "pass", message: "API /health responded successfully" }),
      expect.objectContaining({ status: "pass", message: "API /ready responded successfully" })
    ]);
  });

  it("does not render API URL username or password when health checks fail", async () => {
    const results = await checkApiHealth("http://user:supersecret@localhost:9", async (url) => {
      throw new Error(`fetch failed for ${url}`);
    });
    const output = renderResults(results);

    expect(output).not.toContain("user");
    expect(output).not.toContain("supersecret");
    expect(output).not.toContain("http://user:supersecret@localhost:9");
    expect(output).toContain("http://[REDACTED]@localhost:9");
  });

  it("builds a failure when the env file is missing in host mode", async () => {
    const results = await buildDoctorResults({
      options: { compose: false, envFile: ".env" },
      fileExists: () => false,
      readFile: () => "",
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      fetchHealth: async () => ({ ok: true, status: 200 }),
      checkDirectoryWritable: () => true
    });

    expect(results).toContainEqual(expect.objectContaining({ status: "fail", message: ".env is missing; copy .env.example to .env" }));
  });

  it("warns when source map directory is missing", async () => {
    const results = await runDoctorChecks({ ...validEnv, SOURCE_MAPS_LOCAL_DIR: "/missing/source-maps" }, () => false);

    expect(results).toContainEqual(sourceMapDirectoryWarning);
  });

  it("warns when source map path exists but is not a directory", async () => {
    const results = await runDoctorChecks({ ...validEnv, SOURCE_MAPS_LOCAL_DIR: "/tmp/source-map-file" }, () => false);

    expect(results).toContainEqual(sourceMapDirectoryWarning);
  });

  it("warns when source map directory exists but is not writable", async () => {
    const results = await runDoctorChecks({ ...validEnv, SOURCE_MAPS_LOCAL_DIR: "/tmp/source-map-readonly" }, () => false);

    expect(results).toContainEqual(sourceMapDirectoryWarning);
  });

  it("does not warn when source map directory exists and is writable", async () => {
    const results = await runDoctorChecks({ ...validEnv, SOURCE_MAPS_LOCAL_DIR: "/tmp/source-maps" }, () => true);

    expect(results).not.toContainEqual(sourceMapDirectoryWarning);
  });

  it("does not warn when source map directory is blank", async () => {
    const results = await runDoctorChecks({ ...validEnv, SOURCE_MAPS_LOCAL_DIR: "" }, () => false);

    expect(results).not.toContainEqual(sourceMapDirectoryWarning);
  });

  it("does not warn about host source map directory writability in compose mode", async () => {
    const results = await buildDoctorResults({
      options: { compose: true, envFile: ".env", apiUrl: "http://localhost:3000" },
      fileExists: (path) => path === ".env",
      readFile: () => buildEnvContent({ ...validEnv, SOURCE_MAPS_LOCAL_DIR: "/var/lib/sigmon/source-maps" }),
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      fetchHealth: async () => ({ ok: true, status: 200 }),
      checkDirectoryWritable: () => false
    });

    expect(results).not.toContainEqual(sourceMapDirectoryWarning);
  });

  it("redacts secrets when running the doctor", async () => {
    const exitCode = await runDoctor({
      options: { compose: false, envFile: ".env" },
      fileExists: () => true,
      readFile: () => "NODE_ENV=production\nSESSION_SECRET=abc123secretvalue\n",
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      fetchHealth: async () => ({ ok: true, status: 200 }),
      checkDirectoryWritable: () => true,
      write: (output) => {
        expect(output).not.toContain("abc123secretvalue");
      }
    });

    expect(exitCode).toBe(1);
  });

  it("redacts credential-bearing API URLs provided through doctor options", async () => {
    const outputs: string[] = [];
    const exitCode = await runDoctor({
      options: { compose: false, envFile: ".env", apiUrl: "http://user:supersecret@localhost:9" },
      fileExists: () => true,
      readFile: () => buildEnvContent(validEnv),
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      fetchHealth: async (url) => {
        throw new Error(`fetch failed for ${url}`);
      },
      checkDirectoryWritable: () => true,
      write: (output) => {
        outputs.push(output);
      }
    });

    const output = outputs.join("");
    expect(exitCode).toBe(0);
    expect(output).not.toContain("user");
    expect(output).not.toContain("supersecret");
    expect(output).not.toContain("http://user:supersecret@localhost:9");
    expect(output).toContain("http://[REDACTED]@localhost:9");
  });

  it("waits for timed-out commands to close before rejecting", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: (signal: NodeJS.Signals) => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const killedSignals: NodeJS.Signals[] = [];
    child.kill = (signal) => {
      killedSignals.push(signal);
      setTimeout(() => child.emit("close", null), 5);
      return true;
    };

    const started = Date.now();
    await expect(
      runCommandWithTimeout(["sleep", "60"], 1, {
        spawnProcess: () => child,
        killGraceMs: 100
      })
    ).rejects.toThrow("sleep 60 timed out after 1ms");

    expect(killedSignals).toEqual(["SIGTERM"]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(5);
  });

  it("escalates timed-out commands to SIGKILL when they do not close after SIGTERM", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: (signal: NodeJS.Signals) => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const killedSignals: NodeJS.Signals[] = [];
    child.kill = (signal) => {
      killedSignals.push(signal);
      if (signal === "SIGKILL") setTimeout(() => child.emit("close", null), 1);
      return true;
    };

    await expect(
      runCommandWithTimeout(["sleep", "60"], 1, {
        spawnProcess: () => child,
        killGraceMs: 1
      })
    ).rejects.toThrow("sleep 60 timed out after 1ms");

    expect(killedSignals).toEqual(["SIGTERM", "SIGKILL"]);
  });
});
