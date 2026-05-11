import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
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
  type DoctorEnv
} from "./doctor.js";

const validEnv: DoctorEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://signalhub:correct-password@localhost:5432/signalhub",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "a-secure-session-secret-with-enough-length",
  API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
  BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
  BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple-long-enough",
  GOOGLE_OAUTH_ENABLED: "false",
  SIGNALHUB_PUBLIC_ENDPOINT: "https://signalhub.example.com",
  POSTGRES_PASSWORD: "correct-password",
  POSTGRES_PASSWORD_URLENCODED: "",
  BACKUPS_ENABLED: "true",
  BACKUPS_LOCAL_DIR: "/var/lib/signalhub/backups",
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
      SIGNALHUB_PUBLIC_ENDPOINT: "http://localhost:3000"
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        status: "warn",
        message: "SIGNALHUB_PUBLIC_ENDPOINT points to localhost in production"
      })
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        status: "warn",
        message: "SIGNALHUB_PUBLIC_ENDPOINT uses plain HTTP in production"
      })
    );
  });

  it("warns for production IPv6 localhost public endpoints", () => {
    const results = checkEnvValues({
      ...validEnv,
      SIGNALHUB_PUBLIC_ENDPOINT: "https://[::1]:3000"
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        status: "warn",
        message: "SIGNALHUB_PUBLIC_ENDPOINT points to localhost in production"
      })
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

describe("doctor orchestration", () => {
  it("parses compose and api URL arguments", () => {
    expect(parseDoctorArgs(["--compose", "--api-url", "http://localhost:3000"])).toEqual({
      compose: true,
      apiUrl: "http://localhost:3000",
      envFile: ".env"
    });
  });

  it("ignores the standalone separator forwarded by pnpm run", () => {
    expect(parseDoctorArgs(["--", "--env-file", "/tmp/signalhub-doctor.env"])).toEqual({
      compose: false,
      envFile: "/tmp/signalhub-doctor.env"
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
      fetchHealth: async () => ({ ok: true, status: 200 })
    });

    expect(results).toContainEqual(expect.objectContaining({ status: "fail", message: ".env is missing; copy .env.example to .env" }));
  });

  it("warns when source map directory is missing", async () => {
    const envContent = Object.entries({ ...validEnv, SOURCE_MAPS_LOCAL_DIR: "/missing/source-maps" })
      .map(([key, value]) => `${key}=${value ?? ""}`)
      .join("\n");
    const results = await buildDoctorResults({
      options: { compose: false, envFile: ".env" },
      fileExists: (path) => path === ".env",
      readFile: () => envContent,
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      fetchHealth: async () => ({ ok: true, status: 200 })
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        status: "warn",
        message: "SOURCE_MAPS_LOCAL_DIR is missing or not writable"
      })
    );
  });

  it("redacts secrets when running the doctor", async () => {
    const exitCode = await runDoctor({
      options: { compose: false, envFile: ".env" },
      fileExists: () => true,
      readFile: () => "NODE_ENV=production\nSESSION_SECRET=abc123secretvalue\n",
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      fetchHealth: async () => ({ ok: true, status: 200 }),
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
      readFile: () => Object.entries(validEnv).map(([key, value]) => `${key}=${value ?? ""}`).join("\n"),
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      fetchHealth: async (url) => {
        throw new Error(`fetch failed for ${url}`);
      },
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
