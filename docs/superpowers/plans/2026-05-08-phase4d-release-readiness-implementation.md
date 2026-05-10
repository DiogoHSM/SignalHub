# Phase 4D Release Readiness and Install Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe `pnpm run doctor` operator check, harden production placeholder configuration, and document the Compose-only self-hosted install, upgrade, backup, restore, and release workflow.

**Architecture:** Keep the release-readiness work inside the existing TypeScript workspace. Shared production config safety lives in `packages/config`, while the doctor command is a root TypeScript script with pure validation helpers and thin adapters for filesystem, child-process, and HTTP checks. Documentation continues to live in `README.md` and `.claude/docs`.

**Tech Stack:** TypeScript, Zod, Vitest, Node.js `fs`/`child_process`, built-in `fetch`, Docker Compose.

---

## Scope Check

The spec covers one cohesive operational-readiness slice:

- production config hardening,
- read-only install diagnostics,
- Compose install/upgrade/restore documentation,
- release/versioning baseline.

These should stay in one plan because the doctor command and documentation describe the same supported operator flow. No database schema, console UI, new runtime service, SaaS feature, Kubernetes support, or release automation is included.

## File Structure

Create:

- `scripts/doctor.ts` - CLI entrypoint, argument parsing, check orchestration, output formatting, and process exit code.
- `scripts/doctor.test.ts` - Vitest coverage for doctor result classification, env checks, command/HTTP adapter behavior, and CLI-safe formatting.

Modify:

- `packages/config/src/index.ts` - add production placeholder rejection while preserving existing test/development behavior.
- `packages/config/test/config.test.ts` - add red/green tests for production placeholder rejection and explicit test-environment allowance.
- `package.json` - add root `doctor` script.
- `README.md` - document fresh Compose install, `pnpm run doctor`, upgrade, restore drill, troubleshooting, and release baseline.
- `.claude/docs/PROJECT-SUMMARY.md` - update current phase and implemented/release-readiness status.
- `.claude/docs/DEPLOYMENT.md` - make Compose-only production path, doctor checks, upgrade, and restore drill explicit.
- `.claude/docs/CONSTRAINTS.md` - record Compose-only production support and no Kubernetes/systemd support for this phase.
- `.claude/docs/DECISIONS.md` - record the decision to add read-only operator doctor before release automation.
- `.claude/docs/SECRETS.md` - document production placeholder rejection and doctor redaction behavior.
- `.claude/docs/INFRASTRUCTURE.md` - document host and Compose doctor checks.

Do not modify:

- database migrations,
- ingestion routes,
- console UI,
- worker scheduler behavior,
- alert/backup business logic beyond documentation references.

## Task 1: Production Placeholder Config Hardening

**Files:**

- Modify: `packages/config/src/index.ts`
- Test: `packages/config/test/config.test.ts`

- [x] **Step 1: Add failing config tests**

Append these tests inside the existing `describe("loadConfig", ...)` block in `packages/config/test/config.test.ts`:

```ts
  it.each([
    ["SESSION_SECRET", "change-me-to-a-long-random-secret"],
    ["API_KEY_PEPPER", "change-me-to-a-long-random-pepper"],
    ["BOOTSTRAP_ADMIN_PASSWORD", "change-me-admin-password-32-chars-min"]
  ] as const)("rejects production placeholder %s", (fieldName, placeholder) => {
    expect(() =>
      loadConfig({
        ...validEnv,
        NODE_ENV: "production",
        [fieldName]: placeholder
      })
    ).toThrow(`${fieldName} must be replaced for production`);
  });

  it("rejects the local-only Postgres password placeholder in production database URLs", () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        NODE_ENV: "production",
        DATABASE_URL: "postgres://signalhub:signalhub-local-only-change-me@localhost:5432/signalhub"
      })
    ).toThrow("DATABASE_URL uses the local-only Postgres password placeholder");
  });

  it("allows placeholders in test so configuration tests can stay lightweight", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "3000",
      DATABASE_URL: "postgres://signalhub:signalhub-local-only-change-me@localhost:5432/signalhub",
      REDIS_URL: "redis://localhost:6379",
      SESSION_SECRET: "change-me-to-a-long-random-secret",
      API_KEY_PEPPER: "change-me-to-a-long-random-pepper",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "change-me-admin-password-32-chars-min",
      GOOGLE_OAUTH_ENABLED: "false"
    });

    expect(config.nodeEnv).toBe("test");
  });
```

- [x] **Step 2: Run config tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/config test
```

Expected: fail because production placeholder rejection has not been implemented.

- [x] **Step 3: Implement production placeholder rejection**

In `packages/config/src/index.ts`, add these constants and helper functions below `optionalPositiveInteger`:

```ts
const productionPlaceholders = {
  SESSION_SECRET: "change-me-to-a-long-random-secret",
  API_KEY_PEPPER: "change-me-to-a-long-random-pepper",
  BOOTSTRAP_ADMIN_PASSWORD: "change-me-admin-password-32-chars-min"
} as const;

const localOnlyPostgresPassword = "signalhub-local-only-change-me";

function requireNoProductionPlaceholder(name: keyof typeof productionPlaceholders, value: string, nodeEnv: string): void {
  if (nodeEnv === "production" && value === productionPlaceholders[name]) {
    throw new Error(`${name} must be replaced for production`);
  }
}

function requireProductionDatabasePasswordIsNotPlaceholder(databaseUrl: string, nodeEnv: string): void {
  if (nodeEnv !== "production") return;

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return;
  }

  if (parsed.password === localOnlyPostgresPassword) {
    throw new Error("DATABASE_URL uses the local-only Postgres password placeholder");
  }
}
```

Then call the new helpers in `loadConfig()` immediately after the existing `requireStrongSecret(...)` calls:

```ts
  requireNoProductionPlaceholder("SESSION_SECRET", parsed.SESSION_SECRET, parsed.NODE_ENV);
  requireNoProductionPlaceholder("API_KEY_PEPPER", parsed.API_KEY_PEPPER, parsed.NODE_ENV);
  requireNoProductionPlaceholder("BOOTSTRAP_ADMIN_PASSWORD", parsed.BOOTSTRAP_ADMIN_PASSWORD, parsed.NODE_ENV);
  requireProductionDatabasePasswordIsNotPlaceholder(parsed.DATABASE_URL, parsed.NODE_ENV);
```

- [x] **Step 4: Run config tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/config test
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add packages/config/src/index.ts packages/config/test/config.test.ts
git commit -m "fix: reject production placeholder secrets"
```

## Task 2: Doctor Result Model and Pure Checks

**Files:**

- Create: `scripts/doctor.ts`
- Create: `scripts/doctor.test.ts`
- Modify: `package.json`

- [x] **Step 1: Add failing doctor tests for pure checks**

Create `scripts/doctor.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  checkEnvValues,
  createResult,
  getExitCode,
  redactDoctorText,
  renderResults,
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
```

- [x] **Step 2: Run doctor tests and verify failure**

Run:

```bash
pnpm exec vitest run scripts/doctor.test.ts
```

Expected: fail because `scripts/doctor.ts` does not exist.

- [x] **Step 3: Add doctor script skeleton and pure checks**

Create `scripts/doctor.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export type DoctorStatus = "pass" | "warn" | "fail";

export type DoctorResult = {
  status: DoctorStatus;
  message: string;
  detail?: string;
};

export type DoctorEnv = Record<string, string | undefined>;

type DoctorOptions = {
  compose: boolean;
  apiUrl?: string;
  envFile: string;
};

const requiredEnv = [
  "DATABASE_URL",
  "REDIS_URL",
  "SESSION_SECRET",
  "API_KEY_PEPPER",
  "BOOTSTRAP_ADMIN_EMAIL",
  "BOOTSTRAP_ADMIN_PASSWORD"
] as const;

const productionPlaceholders = new Map([
  ["SESSION_SECRET", "change-me-to-a-long-random-secret"],
  ["API_KEY_PEPPER", "change-me-to-a-long-random-pepper"],
  ["BOOTSTRAP_ADMIN_PASSWORD", "change-me-admin-password-32-chars-min"]
]);

const secretEnvNames = [
  "SESSION_SECRET",
  "API_KEY_PEPPER",
  "BOOTSTRAP_ADMIN_PASSWORD",
  "POSTGRES_PASSWORD",
  "POSTGRES_PASSWORD_URLENCODED",
  "GOOGLE_CLIENT_SECRET",
  "BACKUPS_S3_ACCESS_KEY_ID",
  "BACKUPS_S3_SECRET_ACCESS_KEY"
] as const;

export function createResult(status: DoctorStatus, message: string, detail?: string): DoctorResult {
  return detail ? { status, message, detail } : { status, message };
}

export function getExitCode(results: DoctorResult[]): number {
  return results.some((result) => result.status === "fail") ? 1 : 0;
}

function parseBoolean(value: string | undefined): boolean {
  return value === "true";
}

function isLocalhostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isPlainHttpUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "http:";
  } catch {
    return false;
  }
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function containsUrlReservedCharacters(value: string): boolean {
  return /[:/?#\\[\\]@!$&'()*+,;=%]/.test(value);
}

export function checkEnvValues(env: DoctorEnv): DoctorResult[] {
  const results: DoctorResult[] = [];
  const nodeEnv = env.NODE_ENV ?? "development";

  for (const name of requiredEnv) {
    if (!env[name]) {
      results.push(createResult("fail", `${name} is missing`));
    }
  }

  for (const [name, placeholder] of productionPlaceholders) {
    if (nodeEnv === "production" && env[name] === placeholder) {
      results.push(createResult("fail", `${name} must be replaced for production`));
    }
  }

  if (nodeEnv === "production" && env.DATABASE_URL?.includes(":signalhub-local-only-change-me@")) {
    results.push(createResult("fail", "DATABASE_URL uses the local-only Postgres password placeholder"));
  }

  for (const name of ["DATABASE_URL", "REDIS_URL", "SIGNALHUB_PUBLIC_ENDPOINT"] as const) {
    const value = env[name];
    if (value && !isValidUrl(value)) {
      results.push(createResult("fail", `${name} must be a valid URL`));
    }
  }

  if (nodeEnv === "production" && env.SIGNALHUB_PUBLIC_ENDPOINT) {
    if (isLocalhostUrl(env.SIGNALHUB_PUBLIC_ENDPOINT)) {
      results.push(createResult("warn", "SIGNALHUB_PUBLIC_ENDPOINT points to localhost in production"));
    }
    if (isPlainHttpUrl(env.SIGNALHUB_PUBLIC_ENDPOINT)) {
      results.push(createResult("warn", "SIGNALHUB_PUBLIC_ENDPOINT uses plain HTTP in production"));
    }
  }

  if (env.POSTGRES_PASSWORD && containsUrlReservedCharacters(env.POSTGRES_PASSWORD) && !env.POSTGRES_PASSWORD_URLENCODED) {
    results.push(createResult("warn", "POSTGRES_PASSWORD contains URL-reserved characters; set POSTGRES_PASSWORD_URLENCODED"));
  }

  if (parseBoolean(env.GOOGLE_OAUTH_ENABLED)) {
    for (const name of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"] as const) {
      if (!env[name]) results.push(createResult("warn", `${name} is missing while Google OAuth is enabled`));
    }
  }

  if (parseBoolean(env.BACKUPS_ENABLED) && !env.BACKUPS_LOCAL_DIR) {
    results.push(createResult("warn", "BACKUPS_LOCAL_DIR is missing while backups are enabled"));
  }

  if (parseBoolean(env.BACKUPS_S3_ENABLED)) {
    for (const name of [
      "BACKUPS_S3_ENDPOINT",
      "BACKUPS_S3_BUCKET",
      "BACKUPS_S3_ACCESS_KEY_ID",
      "BACKUPS_S3_SECRET_ACCESS_KEY",
      "BACKUPS_S3_PREFIX"
    ] as const) {
      if (!env[name]) results.push(createResult("warn", `${name} is missing while S3 backups are enabled`));
    }
  }

  if (results.length === 0) {
    results.push(createResult("pass", "Environment values look coherent"));
  }

  return results;
}

export function renderResults(results: DoctorResult[]): string {
  const icon = { pass: "PASS", warn: "WARN", fail: "FAIL" } satisfies Record<DoctorStatus, string>;
  return results.map((result) => `[${icon[result.status]}] ${result.message}${result.detail ? `\\n  ${result.detail}` : ""}`).join("\\n");
}

export function redactDoctorText(text: string, secrets: Array<string | undefined>): string {
  return secrets.filter((secret): secret is string => Boolean(secret)).reduce((output, secret) => output.split(secret).join("[REDACTED]"), text);
}

export function collectSecretValues(env: DoctorEnv): string[] {
  return secretEnvNames.map((name) => env[name]).filter((value): value is string => Boolean(value));
}

export function parseEnvFile(content: string): DoctorEnv {
  const env: DoctorEnv = {};
  for (const rawLine of content.split(/\\r?\\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = value;
  }
  return env;
}
```

Do not add the CLI `main()` yet; that comes in the next task.

- [x] **Step 4: Add root package script**

Modify the `scripts` object in `package.json`:

```json
"doctor": "tsx scripts/doctor.ts",
```

Place it near the other root operational scripts after `seed:admin`.

- [x] **Step 5: Run doctor tests and verify pass**

Run:

```bash
pnpm exec vitest run scripts/doctor.test.ts
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add package.json scripts/doctor.ts scripts/doctor.test.ts
git commit -m "feat: add doctor validation model"
```

## Task 3: Doctor Command, Command Checks, and HTTP Checks

**Files:**

- Modify: `scripts/doctor.ts`
- Test: `scripts/doctor.test.ts`

- [x] **Step 1: Add failing tests for adapters and orchestration**

Append to `scripts/doctor.test.ts`:

```ts
import {
  buildDoctorResults,
  checkApiHealth,
  checkCommand,
  parseDoctorArgs,
  runDoctor
} from "./doctor.js";

describe("doctor orchestration", () => {
  it("parses compose and api URL arguments", () => {
    expect(parseDoctorArgs(["--compose", "--api-url", "http://localhost:3000"])).toEqual({
      compose: true,
      apiUrl: "http://localhost:3000",
      envFile: ".env"
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

  it("builds a warning when the env file is missing in host mode", async () => {
    const results = await buildDoctorResults({
      options: { compose: false, envFile: ".env" },
      fileExists: () => false,
      readFile: () => "",
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      fetchHealth: async () => ({ ok: true, status: 200 })
    });

    expect(results).toContainEqual(expect.objectContaining({ status: "fail", message: ".env is missing; copy .env.example to .env" }));
  });

  it("redacts secrets when running the doctor", async () => {
    const exitCode = await runDoctor({
      options: { compose: false, envFile: ".env" },
      fileExists: () => true,
      readFile: () => "NODE_ENV=production\\nSESSION_SECRET=abc123secretvalue\\n",
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      fetchHealth: async () => ({ ok: true, status: 200 }),
      write: (output) => {
        expect(output).not.toContain("abc123secretvalue");
      }
    });

    expect(exitCode).toBe(1);
  });
});
```

- [x] **Step 2: Run focused doctor tests and verify failure**

Run:

```bash
pnpm exec vitest run scripts/doctor.test.ts
```

Expected: fail because orchestration exports are missing.

- [x] **Step 3: Implement command and HTTP adapters**

Add these exports to `scripts/doctor.ts` after `parseEnvFile()`:

```ts
type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type CommandRunner = (command: string[]) => Promise<CommandResult>;

type FetchResult = {
  ok: boolean;
  status: number;
};

type FetchHealth = (url: string) => Promise<FetchResult>;

type BuildDoctorDependencies = {
  options: DoctorOptions;
  fileExists: (path: string) => boolean;
  readFile: (path: string) => string;
  runCommand: CommandRunner;
  fetchHealth: FetchHealth;
};

export function parseDoctorArgs(args: string[]): DoctorOptions {
  const options: DoctorOptions = { compose: false, envFile: ".env" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--compose") {
      options.compose = true;
      continue;
    }
    if (arg === "--api-url") {
      const value = args[index + 1];
      if (!value) throw new Error("--api-url requires a value");
      options.apiUrl = value;
      index += 1;
      continue;
    }
    if (arg === "--env-file") {
      const value = args[index + 1];
      if (!value) throw new Error("--env-file requires a value");
      options.envFile = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown doctor argument: ${arg}`);
  }
  return options;
}

function truncateOutput(value: string): string {
  return value.trim().split(/\\r?\\n/).slice(0, 8).join("\\n");
}

export async function checkCommand(
  label: string,
  command: string[],
  runCommand: CommandRunner,
  failedStatus: DoctorStatus = "fail"
): Promise<DoctorResult> {
  try {
    const result = await runCommand(command);
    if (result.exitCode === 0) {
      return createResult("pass", `${label} passed`);
    }
    return createResult(failedStatus, `${label} failed`, truncateOutput(result.stderr || result.stdout));
  } catch (error) {
    return createResult(failedStatus, `${label} failed`, error instanceof Error ? error.message : String(error));
  }
}

export async function checkApiHealth(apiUrl: string, fetchHealth: FetchHealth, required = false): Promise<DoctorResult[]> {
  const base = apiUrl.replace(/\\/$/, "");
  const checks: Array<[string, string]> = [
    ["/health", `${base}/health`],
    ["/ready", `${base}/ready`]
  ];
  const results: DoctorResult[] = [];
  for (const [path, url] of checks) {
    try {
      const response = await fetchHealth(url);
      results.push(
        response.ok
          ? createResult("pass", `API ${path} responded successfully`)
          : createResult(required ? "fail" : "warn", `API ${path} returned HTTP ${response.status}`)
      );
    } catch (error) {
      results.push(createResult(required ? "fail" : "warn", `API ${path} is unreachable`, error instanceof Error ? error.message : String(error)));
    }
  }
  return results;
}
```

- [x] **Step 4: Implement doctor orchestration and CLI main**

Append:

```ts
export async function buildDoctorResults(dependencies: BuildDoctorDependencies): Promise<DoctorResult[]> {
  const { options, fileExists, readFile, runCommand, fetchHealth } = dependencies;
  const results: DoctorResult[] = [];
  let env: DoctorEnv = {};

  results.push(await checkCommand("Node.js version check", ["node", "--version"], runCommand));
  results.push(await checkCommand("pnpm version check", ["pnpm", "--version"], runCommand));

  if (!fileExists(options.envFile)) {
    results.push(createResult("fail", `${options.envFile} is missing; copy .env.example to ${options.envFile}`));
  } else {
    env = parseEnvFile(readFile(options.envFile));
    results.push(createResult("pass", `${options.envFile} exists`));
    results.push(...checkEnvValues(env));
  }

  results.push(await checkCommand("Docker Compose config", ["docker", "compose", "config", "--quiet"], runCommand, "warn"));

  if (options.compose) {
    results.push(await checkCommand("Docker service list", ["docker", "compose", "ps"], runCommand));
    for (const service of ["postgres", "redis", "api", "worker"]) {
      results.push(await checkCommand(`Docker Compose ${service} service`, ["docker", "compose", "ps", service], runCommand));
    }
  }

  const apiUrl = options.apiUrl ?? env.SIGNALHUB_PUBLIC_ENDPOINT;
  if (apiUrl && (options.apiUrl || options.compose || isLocalhostUrl(apiUrl))) {
    results.push(...(await checkApiHealth(apiUrl, fetchHealth, options.compose)));
  }

  return results;
}

function runCommandWithTimeout(command: string[], timeoutMs = 5000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

export async function runDoctor(input: {
  options: DoctorOptions;
  fileExists: (path: string) => boolean;
  readFile: (path: string) => string;
  runCommand: CommandRunner;
  fetchHealth: FetchHealth;
  write: (output: string) => void;
}): Promise<number> {
  const results = await buildDoctorResults(input);
  const env = input.fileExists(input.options.envFile) ? parseEnvFile(input.readFile(input.options.envFile)) : {};
  const output = redactDoctorText(renderResults(results), collectSecretValues(env));
  input.write(`${output}\\n`);
  return getExitCode(results);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseDoctorArgs(args);
  const exitCode = await runDoctor({
    options,
    fileExists: existsSync,
    readFile: (path) => readFileSync(path, "utf8"),
    runCommand: runCommandWithTimeout,
    fetchHealth: fetchWithTimeout,
    write: (output) => process.stdout.write(output)
  });
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
```

- [x] **Step 5: Run focused doctor tests and verify pass**

Run:

```bash
pnpm exec vitest run scripts/doctor.test.ts
```

Expected: pass.

- [x] **Step 6: Run the doctor in safe local mode**

Run:

```bash
pnpm run doctor
```

Expected: exits `0` if there are only pass/warn results, or exits non-zero only if the local `.env` is missing or has failed checks. If the local workspace intentionally lacks `.env`, keep that behavior; do not make the command silently pass missing required setup.

- [x] **Step 7: Commit**

```bash
git add scripts/doctor.ts scripts/doctor.test.ts
git commit -m "feat: add operator doctor command"
```

## Task 4: Documentation and Release Baseline

**Files:**

- Modify: `README.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `.claude/docs/DEPLOYMENT.md`
- Modify: `.claude/docs/CONSTRAINTS.md`
- Modify: `.claude/docs/DECISIONS.md`
- Modify: `.claude/docs/SECRETS.md`
- Modify: `.claude/docs/INFRASTRUCTURE.md`

- [x] **Step 1: Update README install and doctor sections**

In `README.md`, update the Docker Compose setup section so the primary flow includes doctor:

````md
## Docker Compose Setup

Docker Compose is the supported production-oriented self-hosted install path for SignalHub at this stage. Kubernetes, Helm, systemd, and hosted SaaS deployment are intentionally out of scope for this release line.

```sh
cp .env.example .env
# edit .env before first start
pnpm install
pnpm run doctor
docker compose up -d postgres redis
docker compose run --rm api pnpm seed:admin
docker compose up --build
pnpm run doctor -- --compose --api-url http://localhost:3000
```
````

Add a new `## Operator Doctor` section:

````md
## Operator Doctor

Run the read-only doctor before first startup, after configuration changes, and after upgrades:

```sh
pnpm run doctor
pnpm run doctor -- --compose --api-url http://localhost:3000
```

`pnpm run doctor` checks local `.env` shape, dangerous production placeholders, URL formatting, password-encoding guidance, scheduler configuration, and Compose config when Docker is available. `--compose` also checks the running Compose stack and unauthenticated API health/readiness endpoints.

Use `pnpm run doctor`, not `pnpm doctor`; `pnpm doctor` is pnpm's built-in diagnostic command and does not run project scripts.

The command prints `PASS`, `WARN`, and `FAIL` lines. Warnings do not make the command fail. Failures return a non-zero exit code. The command is read-only and does not create users, projects, API keys, migrations, backups, restores, or telemetry.
````

- [x] **Step 2: Add upgrade and restore drill docs**

Add `## Upgrade Flow` and `## Restore Drill` sections to `README.md`:

````md
## Upgrade Flow

Before upgrading a self-hosted install:

```sh
docker compose run --rm worker pnpm backup:create
git pull
pnpm install
docker compose build
docker compose stop api worker
docker compose run --rm api pnpm db:migrate
docker compose up -d
pnpm run doctor -- --compose --api-url http://localhost:3000
```

For source installs, keep `pnpm-lock.yaml` authoritative and run `pnpm install` after pulling. For image-based installs in the future, replace the build step with the documented image update step for that release.

## Restore Drill

Practice the restore path before an incident. Use a disposable environment or copied database volume, not the primary production database.

```sh
docker compose stop api worker
docker compose run --rm worker pnpm backup:restore -- /var/lib/signalhub/backups/signalhub-YYYYMMDDTHHMMSSZ.dump --yes
docker compose start api worker
pnpm run doctor -- --compose --api-url http://localhost:3000
```

Restore is destructive. Stop writers first and verify the target backup file before running `backup:restore`.
````

- [x] **Step 3: Add troubleshooting and release baseline docs**

Add concise sections:

````md
## Troubleshooting

- `.env is missing`: copy `.env.example` to `.env` and replace placeholder values.
- `DATABASE_URL` fails in Compose: check `POSTGRES_PASSWORD`; set `POSTGRES_PASSWORD_URLENCODED` when the password contains URL-reserved characters.
- `/ready` fails: check Postgres and Redis health with `docker compose ps`.
- worker heartbeat is stale in the console: check `docker compose logs worker`.
- backups fail: verify `BACKUPS_LOCAL_DIR`, the Compose `backup_data` volume, and optional R2/S3 credentials.
- webhook alerts fail: verify the channel URL is publicly reachable by the worker and is not a private or metadata-network address.

## Release Baseline

Before tagging a release:

```sh
pnpm test
pnpm build
docker compose config --quiet
pnpm run doctor
```

Use semantic versioning from the root `package.json`. Keep release notes focused on install/upgrade impact, schema migrations, environment variables, and operator action required.
````

- [x] **Step 4: Update `.claude/docs` project docs**

Apply these content updates:

- `.claude/docs/PROJECT-SUMMARY.md`: change current phase to `Phase 4D: Release Readiness and Install Hardening`; add `Read-only operator doctor command and Compose install hardening` to implemented capabilities once implementation exists.
- `.claude/docs/DEPLOYMENT.md`: add a `Doctor` section with the exact commands and define Compose as the only production-supported path for this phase.
- `.claude/docs/CONSTRAINTS.md`: add `Docker Compose is the only supported production install path; Kubernetes, Helm, and systemd are deferred`.
- `.claude/docs/DECISIONS.md`: add a dated decision that SignalHub adds read-only operator diagnostics before release automation.
- `.claude/docs/SECRETS.md`: document that production startup rejects known placeholder secrets and that doctor output redacts secret values.
- `.claude/docs/INFRASTRUCTURE.md`: list the doctor host and Compose checks.

- [x] **Step 5: Run docs grep checks**

Run:

```bash
rg -n "kubernetes|helm|systemd" README.md .claude/docs
```

Expected: only explicit out-of-scope/deferred mentions.

Run:

```bash
rg -n "pnpm run doctor|docker compose" README.md .claude/docs/DEPLOYMENT.md .claude/docs/INFRASTRUCTURE.md
```

Expected: doctor and Compose commands are documented.

- [x] **Step 6: Commit**

```bash
git add README.md .claude/docs/PROJECT-SUMMARY.md .claude/docs/DEPLOYMENT.md .claude/docs/CONSTRAINTS.md .claude/docs/DECISIONS.md .claude/docs/SECRETS.md .claude/docs/INFRASTRUCTURE.md
git commit -m "docs: document release readiness operations"
```

## Task 5: Final Verification and Plan Completion

**Files:**

- Modify: `docs/superpowers/plans/2026-05-08-phase4d-release-readiness-implementation.md`

- [x] **Step 1: Run full tests**

Run:

```bash
pnpm test
```

Expected: all tests pass.

- [x] **Step 2: Run build**

Run:

```bash
pnpm build
```

Expected: all workspace builds pass.

- [x] **Step 3: Run Compose config verification**

Run:

```bash
docker compose config --quiet
```

Expected: exit code `0`.

- [x] **Step 4: Run doctor safe local mode**

Run:

```bash
pnpm run doctor
```

Expected: exit code `0` when local `.env` has no failed checks. If the local `.env` is intentionally absent or unsafe, capture the output and either add a test fixture command for verification or create a safe temporary env file command using `pnpm run doctor -- --env-file <path>` in `/tmp`.

- [x] **Step 5: Mark plan tasks complete**

Update this plan file by changing all completed task checkboxes from `- [ ]` to `- [x]`.

- [x] **Step 6: Commit plan completion**

```bash
git add docs/superpowers/plans/2026-05-08-phase4d-release-readiness-implementation.md
git commit -m "docs: mark release readiness verification complete"
```

- [x] **Step 7: Update project memory**

Update the SignalHub memory file in the config repository:

```txt
/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
```

Add a dated entry with:

- Phase 4D implemented.
- Doctor command behavior.
- Production placeholder config safety.
- Documentation and verification results.

Commit it from `/Users/diogo/Developer/Github/claude-config`:

```bash
git add projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
git commit -m "docs: update signalhub phase 4d memory"
```

## Final Verification Checklist

Before calling the phase complete:

- `pnpm test`
- `pnpm build`
- `docker compose config --quiet`
- `pnpm run doctor` or `pnpm run doctor -- --env-file <safe-temp-env>`
- `git status -sb` in SignalHub
- `git status -sb` in the config repo

## Execution Recommendation

Use `superpowers:subagent-driven-development`.

Recommended task split:

1. Config hardening.
2. Doctor model and pure checks.
3. Doctor adapters/CLI.
4. Documentation.
5. Final verification and memory.

Each task has a clear write scope and can be reviewed independently. Tasks 2 and 3 should be sequential because Task 3 builds on the exports from Task 2.
