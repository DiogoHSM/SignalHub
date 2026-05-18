# Phase 6B Automated Smoke Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first, CI-ready `pnpm smoke:compose` TypeScript runner that automates the Phase 6A Docker Compose release smoke path.

**Architecture:** Add a thin root script entrypoint that delegates to focused helper modules under `scripts/smoke-compose/`. The runner treats Docker Compose and the API as external systems, creates disposable config and smoke data, prints redacted step output, verifies the critical install path, and cleans up by default.

**Tech Stack:** TypeScript, Node.js built-ins, `tsx`, built-in `fetch`, Docker Compose CLI, Vitest, existing SignalHub HTTP/admin/query/source-map/backup scripts.

---

## File Structure

- Create `scripts/smoke-compose/types.ts`
  - Owns shared runner types: parsed options, command result, step result, smoke context, secret bundle, cleanup resource metadata.
- Create `scripts/smoke-compose/redaction.ts`
  - Owns secret registration and text redaction. This must be importable by unit tests and by all logging/error paths.
- Create `scripts/smoke-compose/args.ts`
  - Owns CLI/env parsing for `--project-name`, `--api-url`, and `--preserve`.
- Create `scripts/smoke-compose/steps.ts`
  - Owns step reporting and summary rendering. It does not execute Docker or HTTP calls directly.
- Create `scripts/smoke-compose/command.ts`
  - Owns process execution through `spawn`, timeout handling, env overrides, output capture, and redacted failure formatting.
- Create `scripts/smoke-compose/temp-env.ts`
  - Owns temp directory creation, generated local secret values, `.env` generation from `.env.example`, and source-map fixture file generation.
- Create `scripts/smoke-compose/http.ts`
  - Owns cookie-aware HTTP helpers, JSON parsing, bearer requests, polling, and assertion helpers for expected response shapes.
- Create `scripts/smoke-compose/fixtures.ts`
  - Owns deterministic smoke payloads and source-map fixture content.
- Create `scripts/smoke-compose/runner.ts`
  - Owns the actual smoke orchestration and dependency injection for tests.
- Create `scripts/smoke-compose.ts`
  - Thin executable entrypoint that calls `main`.
- Create `scripts/smoke-compose.test.ts`
  - Unit tests for args, redaction, temp env generation, command result handling, polling, step reporting, cleanup decisions, and runner ordering with fake dependencies.
- Modify `package.json`
  - Add `"smoke:compose": "tsx scripts/smoke-compose.ts"`.
- Modify `README.md`
  - Add operator docs for when and how to run `pnpm smoke:compose`.
- Modify `.claude/docs/DEPLOYMENT.md`
  - Mention the smoke runner as a release-readiness check.
- Modify `.claude/docs/STACK.md`
  - List the new root command.
- Modify `.claude/docs/CONSTRAINTS.md`
  - Clarify that the smoke harness validates the Docker Compose path and does not add a new supported deployment target.
- Modify `docs/superpowers/plans/2026-05-17-phase6b-automated-smoke-harness-implementation.md`
  - Check off tasks as they are completed during execution.
- Modify `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`
  - Record the completed Phase 6B implementation after final verification.

## Task 1: Add Pure Runner Types, Args, Redaction, And Step Reporting

**Files:**
- Create: `scripts/smoke-compose/types.ts`
- Create: `scripts/smoke-compose/redaction.ts`
- Create: `scripts/smoke-compose/args.ts`
- Create: `scripts/smoke-compose/steps.ts`
- Create: `scripts/smoke-compose.test.ts`

- [ ] **Step 1: Write failing unit tests for args, redaction, and steps**

Create `scripts/smoke-compose.test.ts` with this initial content:

```ts
import { describe, expect, it } from "vitest";
import { parseSmokeArgs } from "./smoke-compose/args.js";
import { createRedactor } from "./smoke-compose/redaction.js";
import { createStepRecorder, renderSummary } from "./smoke-compose/steps.js";

describe("smoke compose args", () => {
  it("uses local-first defaults", () => {
    expect(parseSmokeArgs([], {})).toEqual({
      projectName: "signalhub_smoke",
      apiUrl: "http://localhost:3000",
      preserve: false
    });
  });

  it("accepts flags over environment values", () => {
    expect(
      parseSmokeArgs(["--project-name", "signalhub_custom", "--api-url", "http://127.0.0.1:3300", "--preserve"], {
        SIGNALHUB_SMOKE_PROJECT_NAME: "signalhub_env",
        SIGNALHUB_SMOKE_API_URL: "http://localhost:3001"
      })
    ).toEqual({
      projectName: "signalhub_custom",
      apiUrl: "http://127.0.0.1:3300",
      preserve: true
    });
  });

  it("rejects unknown arguments and missing values", () => {
    expect(() => parseSmokeArgs(["--project-name"], {})).toThrow("--project-name requires a value");
    expect(() => parseSmokeArgs(["--api-url"], {})).toThrow("--api-url requires a value");
    expect(() => parseSmokeArgs(["--mystery"], {})).toThrow("Unknown smoke argument: --mystery");
  });
});

describe("smoke compose redaction", () => {
  it("redacts registered secret values and credential-bearing URLs", () => {
    const redactor = createRedactor(["admin-password", "sh_secret", "cookie-value"]);

    const output = redactor.redact(
      "password=admin-password token=sh_secret cookie-value http://user:pass@localhost:3000/path"
    );

    expect(output).not.toContain("admin-password");
    expect(output).not.toContain("sh_secret");
    expect(output).not.toContain("cookie-value");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("http://[REDACTED]@localhost:3000/path");
  });

  it("allows secrets to be registered after creation", () => {
    const redactor = createRedactor([]);
    redactor.add("late-secret");

    expect(redactor.redact("value late-secret")).toBe("value [REDACTED]");
  });
});

describe("smoke compose step reporting", () => {
  it("records pass, warn, and fail results with a compact summary", () => {
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
    expect(renderSummary({ commit: "abc1234", projectName: "signalhub_smoke", apiUrl: "http://localhost:3000" }, recorder.results())).toEqual(
      [
        "Smoke summary",
        "- Commit: abc1234",
        "- Compose project: signalhub_smoke",
        "- API URL: http://localhost:3000",
        "- Passed: 1",
        "- Warnings: 1",
        "- Failed: 1"
      ].join("\n")
    );
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: the command exits `1` because `scripts/smoke-compose/args.ts`, `redaction.ts`, and `steps.ts` do not exist.

- [ ] **Step 3: Add shared types**

Create `scripts/smoke-compose/types.ts`:

```ts
export type SmokeOptions = {
  projectName: string;
  apiUrl: string;
  preserve: boolean;
};

export type SmokeSummaryContext = {
  commit: string;
  projectName: string;
  apiUrl: string;
};

export type StepStatus = "pass" | "warn" | "fail";

export type StepResult = {
  status: StepStatus;
  name: string;
  detail?: string;
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandInput = {
  command: string;
  args: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  timeoutMs?: number;
  allowFailure?: boolean;
};

export type GeneratedSecrets = {
  postgresPassword: string;
  sessionSecret: string;
  apiKeyPepper: string;
  adminEmail: string;
  adminPassword: string;
};

export type SmokeResources = {
  tempDir: string;
  envFile: string;
  sourceMapFile: string;
};
```

- [ ] **Step 4: Add argument parsing**

Create `scripts/smoke-compose/args.ts`:

```ts
import type { SmokeOptions } from "./types.js";

export function parseSmokeArgs(args: string[], env: Record<string, string | undefined>): SmokeOptions {
  const options: SmokeOptions = {
    projectName: env.SIGNALHUB_SMOKE_PROJECT_NAME?.trim() || "signalhub_smoke",
    apiUrl: env.SIGNALHUB_SMOKE_API_URL?.trim() || "http://localhost:3000",
    preserve: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project-name") {
      const value = args[index + 1]?.trim();
      if (!value) throw new Error("--project-name requires a value");
      options.projectName = value;
      index += 1;
      continue;
    }
    if (arg === "--api-url") {
      const value = args[index + 1]?.trim();
      if (!value) throw new Error("--api-url requires a value");
      options.apiUrl = value.replace(/\/+$/, "");
      index += 1;
      continue;
    }
    if (arg === "--preserve") {
      options.preserve = true;
      continue;
    }
    throw new Error(`Unknown smoke argument: ${arg}`);
  }

  options.apiUrl = options.apiUrl.replace(/\/+$/, "");
  return options;
}
```

- [ ] **Step 5: Add redaction helper**

Create `scripts/smoke-compose/redaction.ts`:

```ts
export type Redactor = {
  add: (secret: string | undefined) => void;
  redact: (value: string) => string;
  secrets: () => string[];
};

function redactUrlUserInfo(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s/@]+(?::[^\s/@]*)?@/gi, (match) => {
    const scheme = match.slice(0, match.indexOf("//") + 2);
    return `${scheme}[REDACTED]@`;
  });
}

export function createRedactor(initialSecrets: Array<string | undefined>): Redactor {
  const values = new Set<string>();

  const add = (secret: string | undefined) => {
    if (secret && secret.length > 0) values.add(secret);
  };

  for (const secret of initialSecrets) add(secret);

  return {
    add,
    redact(value: string) {
      let output = redactUrlUserInfo(value);
      for (const secret of values) {
        output = output.split(secret).join("[REDACTED]");
      }
      return output;
    },
    secrets() {
      return [...values];
    }
  };
}
```

- [ ] **Step 6: Add step reporting helper**

Create `scripts/smoke-compose/steps.ts`:

```ts
import type { SmokeSummaryContext, StepResult, StepStatus } from "./types.js";

export type StepRecorder = {
  pass: (name: string, detail?: string) => void;
  warn: (name: string, detail?: string) => void;
  fail: (name: string, detail?: string) => void;
  results: () => StepResult[];
};

const labels = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL"
} satisfies Record<StepStatus, string>;

function formatStep(result: StepResult): string {
  return `[${labels[result.status]}] ${result.name}${result.detail ? ` - ${result.detail}` : ""}`;
}

export function createStepRecorder(write: (line: string) => void): StepRecorder {
  const results: StepResult[] = [];

  const record = (status: StepStatus, name: string, detail?: string) => {
    const result = detail ? { status, name, detail } : { status, name };
    results.push(result);
    write(formatStep(result));
  };

  return {
    pass: (name, detail) => record("pass", name, detail),
    warn: (name, detail) => record("warn", name, detail),
    fail: (name, detail) => record("fail", name, detail),
    results: () => [...results]
  };
}

export function renderSummary(context: SmokeSummaryContext, results: StepResult[]): string {
  const count = (status: StepStatus) => results.filter((result) => result.status === status).length;
  return [
    "Smoke summary",
    `- Commit: ${context.commit}`,
    `- Compose project: ${context.projectName}`,
    `- API URL: ${context.apiUrl}`,
    `- Passed: ${count("pass")}`,
    `- Warnings: ${count("warn")}`,
    `- Failed: ${count("fail")}`
  ].join("\n");
}
```

- [ ] **Step 7: Run focused tests**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: all tests in `scripts/smoke-compose.test.ts` pass.

- [ ] **Step 8: Commit Task 1**

Run:

```sh
git add scripts/smoke-compose.test.ts scripts/smoke-compose/types.ts scripts/smoke-compose/args.ts scripts/smoke-compose/redaction.ts scripts/smoke-compose/steps.ts
git commit -m "feat: add smoke runner primitives"
```

## Task 2: Add Command Execution And Cleanup Primitives

**Files:**
- Modify: `scripts/smoke-compose.test.ts`
- Create: `scripts/smoke-compose/command.ts`
- Create: `scripts/smoke-compose/cleanup.ts`

- [ ] **Step 1: Add failing tests for command execution and cleanup decisions**

Append these imports to `scripts/smoke-compose.test.ts`:

```ts
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { formatCommandFailure, runCommand } from "./smoke-compose/command.js";
import { cleanupPlan } from "./smoke-compose/cleanup.js";
```

If this creates duplicate `describe`, `expect`, or `it` imports, merge them into the existing Vitest import instead of keeping duplicate imports.

Append these tests:

```ts
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
});

describe("smoke compose cleanup plan", () => {
  it("removes compose resources and temp files by default", () => {
    expect(cleanupPlan({ preserve: false, projectName: "signalhub_smoke", tempDir: "/tmp/signalhub-smoke-1" })).toEqual({
      preserve: false,
      commands: [
        ["docker", "compose", "-p", "signalhub_smoke", "down", "-v"]
      ],
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: the command exits `1` because `command.ts` and `cleanup.ts` do not exist.

- [ ] **Step 3: Implement command execution**

Create `scripts/smoke-compose/command.ts`:

```ts
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { CommandInput, CommandResult } from "./types.js";

type SpawnedProcess = {
  stdout: Readable;
  stderr: Readable;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  on: (event: "error", listener: (error: Error) => void) => SpawnedProcess;
  on: (event: "close", listener: (exitCode: number | null) => void) => SpawnedProcess;
  removeListener: (event: "error", listener: (error: Error) => void) => SpawnedProcess;
  removeListener: (event: "close", listener: (exitCode: number | null) => void) => SpawnedProcess;
};

type RunCommandDependencies = {
  spawnProcess?: (command: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv }) => SpawnedProcess;
};

export function commandToString(input: Pick<CommandInput, "command" | "args">): string {
  return [input.command, ...input.args].join(" ");
}

export function truncateOutput(value: string, maxLines = 12): string {
  return value.trim().split(/\r?\n/).slice(0, maxLines).join("\n");
}

export function formatCommandFailure(
  input: Pick<CommandInput, "command" | "args">,
  result: CommandResult,
  redact: (value: string) => string
): string {
  const output = truncateOutput(result.stderr || result.stdout || `exit ${result.exitCode}`);
  return `${commandToString(input)} failed\n${redact(output)}`;
}

export function runCommand(
  input: CommandInput,
  dependencies: RunCommandDependencies = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = dependencies.spawnProcess
      ? dependencies.spawnProcess(input.command, input.args, {
          cwd: input.cwd,
          env: { ...process.env, ...(input.env ?? {}) }
        })
      : spawn(input.command, input.args, {
          cwd: input.cwd,
          env: { ...process.env, ...(input.env ?? {}) },
          stdio: ["ignore", "pipe", "pipe"]
        });

    const timeoutMs = input.timeoutMs ?? 120_000;
    const timeoutError = new Error(`${commandToString(input)} timed out after ${timeoutMs}ms`);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
    };

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const onError = (error: Error) => {
      settle(() => reject(timedOut ? timeoutError : error));
    };

    const onClose = (exitCode: number | null) => {
      settle(() => {
        if (timedOut) {
          reject(timeoutError);
        } else {
          resolve({ exitCode: exitCode ?? 1, stdout, stderr });
        }
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 1_000);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", onError);
    child.on("close", onClose);
  });
}
```

- [ ] **Step 4: Implement cleanup planning**

Create `scripts/smoke-compose/cleanup.ts`:

```ts
export type CleanupPlanInput = {
  preserve: boolean;
  projectName: string;
  tempDir: string;
};

export type CleanupPlan = {
  preserve: boolean;
  commands: string[][];
  removeTempDir: boolean;
  message: string;
};

export function cleanupPlan(input: CleanupPlanInput): CleanupPlan {
  if (input.preserve) {
    return {
      preserve: true,
      commands: [],
      removeTempDir: false,
      message: `Preserved Compose project ${input.projectName} and temp directory ${input.tempDir}. Inspect logs with docker compose -p ${input.projectName} logs.`
    };
  }

  return {
    preserve: false,
    commands: [["docker", "compose", "-p", input.projectName, "down", "-v"]],
    removeTempDir: true,
    message: `Cleanup will remove Compose resources and ${input.tempDir}`
  };
}
```

- [ ] **Step 5: Run focused tests**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: all tests pass.

- [ ] **Step 6: Commit Task 2**

Run:

```sh
git add scripts/smoke-compose.test.ts scripts/smoke-compose/command.ts scripts/smoke-compose/cleanup.ts
git commit -m "feat: add smoke command and cleanup helpers"
```

## Task 3: Add Temporary Environment And Deterministic Fixtures

**Files:**
- Modify: `scripts/smoke-compose.test.ts`
- Create: `scripts/smoke-compose/temp-env.ts`
- Create: `scripts/smoke-compose/fixtures.ts`

- [ ] **Step 1: Add failing tests for generated env and fixtures**

Append these imports to `scripts/smoke-compose.test.ts`, merging duplicate imports if needed:

```ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSmokeEnvContent, defaultSmokeSecrets, writeSmokeResources } from "./smoke-compose/temp-env.js";
import { createSmokePayloads, sourceMapFixtureContent } from "./smoke-compose/fixtures.js";
```

Append these tests:

```ts
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
    await writeFile(envExample, "BOOTSTRAP_ADMIN_EMAIL=admin@example.com\nBOOTSTRAP_ADMIN_PASSWORD=change-me-admin-password-32-chars-min\n");

    try {
      const resources = await writeSmokeResources({
        tempRoot: root,
        envExamplePath: envExample,
        apiUrl: "http://localhost:3000",
        runId: "phase6b"
      });

      expect(resources.envFile).toContain(root);
      expect(await readFile(resources.envFile, "utf8")).toContain("BOOTSTRAP_ADMIN_EMAIL=phase6b-admin@example.com");
      expect(await readFile(resources.sourceMapFile, "utf8")).toContain('"sources":["src/app.ts"]');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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

  it("creates a source map that resolves app.min.js to src/app.ts", () => {
    const content = JSON.parse(sourceMapFixtureContent());

    expect(content.file).toBe("app.min.js");
    expect(content.sources).toEqual(["src/app.ts"]);
    expect(content.names).toContain("checkout");
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: the command exits `1` because `temp-env.ts` and `fixtures.ts` do not exist.

- [ ] **Step 3: Implement deterministic fixtures**

Create `scripts/smoke-compose/fixtures.ts`:

```ts
export type SmokePayloads = ReturnType<typeof createSmokePayloads>;

export function createSmokePayloads(runId: string) {
  return {
    event: {
      timestamp: "2026-05-17T12:00:00.000Z",
      tenant_id: `tenant_${runId}`,
      user_id: `user_${runId}`,
      session_id: `sess_${runId}`,
      source: "smoke-compose",
      release: `web@${runId}`,
      metadata: { smoke: runId },
      name: `${runId}.account.created`,
      properties: { plan: "trial" }
    },
    error: {
      timestamp: "2026-05-17T12:01:00.000Z",
      tenant_id: `tenant_${runId}`,
      user_id: `user_${runId}`,
      session_id: `sess_${runId}`,
      trace_id: `trace_${runId}`,
      source: "browser",
      release: `web@${runId}`,
      metadata: { smoke: runId },
      message: "Phase 6B checkout failed",
      type: "Phase6BCheckoutError",
      severity: "error",
      stack: "Phase6BCheckoutError: checkout failed\n    at checkout (https://cdn.example.com/assets/app.min.js:1:5)",
      fingerprint: `${runId}-checkout-error`,
      context: { route: "/checkout" }
    },
    trace: {
      timestamp: "2026-05-17T12:00:30.000Z",
      tenant_id: `tenant_${runId}`,
      user_id: `user_${runId}`,
      session_id: `sess_${runId}`,
      trace_id: `trace_${runId}`,
      source: "smoke-compose",
      release: `web@${runId}`,
      name: `${runId}.checkout`,
      duration_ms: 2400,
      status: "success"
    },
    span: {
      timestamp: "2026-05-17T12:00:31.000Z",
      tenant_id: `tenant_${runId}`,
      user_id: `user_${runId}`,
      session_id: `sess_${runId}`,
      trace_id: `trace_${runId}`,
      span_id: `span_${runId}`,
      parent_span_id: null,
      source: "smoke-compose",
      release: `web@${runId}`,
      name: `${runId}.db.query`,
      duration_ms: 120,
      status: "success"
    },
    llm: {
      timestamp: "2026-05-17T12:01:10.000Z",
      tenant_id: `tenant_${runId}`,
      user_id: `user_${runId}`,
      session_id: `sess_${runId}`,
      trace_id: `trace_${runId}`,
      source: "smoke-compose",
      release: `web@${runId}`,
      provider: "openai",
      model: "gpt-5-mini",
      prompt_name: `${runId}_summary`,
      status: "success",
      input_tokens: 120,
      output_tokens: 40,
      total_tokens: 160,
      cost_usd: 0.0042,
      latency_ms: 840
    },
    breadcrumb: {
      timestamp: "2026-05-17T12:01:20.000Z",
      tenant_id: `tenant_${runId}`,
      user_id: `user_${runId}`,
      session_id: `sess_${runId}`,
      trace_id: `trace_${runId}`,
      source: "browser",
      release: `web@${runId}`,
      type: "custom",
      category: "checkout",
      level: "info",
      message: "Phase 6B selected shipping method",
      data: { method: "standard" }
    }
  };
}

export function sourceMapFixtureContent(): string {
  return JSON.stringify({
    version: 3,
    file: "app.min.js",
    sources: ["src/app.ts"],
    sourcesContent: ["export function checkout() {\n  throw new Error('checkout failed');\n}\n"],
    names: ["checkout"],
    mappings: "AAAA,SAASA,WAAW"
  });
}
```

- [ ] **Step 4: Implement temp env generation**

Create `scripts/smoke-compose/temp-env.ts`:

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { GeneratedSecrets, SmokeResources } from "./types.js";
import { sourceMapFixtureContent } from "./fixtures.js";

export function defaultSmokeSecrets(runId: string): GeneratedSecrets {
  return {
    postgresPassword: `${runId}-postgres-password-00000000000000000000`,
    sessionSecret: `${runId}-session-secret-000000000000000000000000`,
    apiKeyPepper: `${runId}-api-key-pepper-000000000000000000000`,
    adminEmail: `${runId}-admin@example.com`,
    adminPassword: `${runId}-admin-password-00000000000000000000`
  };
}

export function createSmokeEnvContent(envExample: string, secrets: GeneratedSecrets, apiUrl: string): string {
  const databaseUrl = `postgres://signalhub:${secrets.postgresPassword}@localhost:5432/signalhub`;
  const replacements = new Map([
    ["signalhub-local-only-change-me", secrets.postgresPassword],
    ["change-me-to-a-long-random-secret", secrets.sessionSecret],
    ["change-me-to-a-long-random-pepper", secrets.apiKeyPepper],
    ["change-me-admin-password-32-chars-min", secrets.adminPassword],
    ["admin@example.com", secrets.adminEmail]
  ]);

  let output = envExample;
  for (const [from, to] of replacements) {
    output = output.split(from).join(to);
  }

  const lines = output.split(/\r?\n/);
  const upsert = (key: string, value: string) => {
    const prefix = `${key}=`;
    const index = lines.findIndex((line) => line.startsWith(prefix));
    if (index === -1) {
      lines.push(`${key}=${value}`);
    } else {
      lines[index] = `${key}=${value}`;
    }
  };

  upsert("DATABASE_URL", databaseUrl);
  upsert("SIGNALHUB_PUBLIC_ENDPOINT", apiUrl);
  upsert("BOOTSTRAP_ADMIN_EMAIL", secrets.adminEmail);
  upsert("BOOTSTRAP_ADMIN_PASSWORD", secrets.adminPassword);

  return lines.join("\n");
}

export async function writeSmokeResources(input: {
  tempRoot?: string;
  envExamplePath: string;
  apiUrl: string;
  runId: string;
}): Promise<SmokeResources & { secrets: GeneratedSecrets }> {
  const tempDir = input.tempRoot ?? (await mkdtemp(join(tmpdir(), "signalhub-smoke-")));
  const secrets = defaultSmokeSecrets(input.runId);
  const envExample = await readFile(input.envExamplePath, "utf8");
  const envFile = join(tempDir, ".env");
  const sourceMapFile = join(tempDir, "app.min.js.map");

  await writeFile(envFile, createSmokeEnvContent(envExample, secrets, input.apiUrl));
  await writeFile(sourceMapFile, sourceMapFixtureContent());

  return { tempDir, envFile, sourceMapFile, secrets };
}
```

- [ ] **Step 5: Run focused tests**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: all tests pass.

- [ ] **Step 6: Commit Task 3**

Run:

```sh
git add scripts/smoke-compose.test.ts scripts/smoke-compose/temp-env.ts scripts/smoke-compose/fixtures.ts
git commit -m "feat: add smoke fixtures and environment generation"
```

## Task 4: Add HTTP Client, Polling, And Assertion Helpers

**Files:**
- Modify: `scripts/smoke-compose.test.ts`
- Create: `scripts/smoke-compose/http.ts`

- [ ] **Step 1: Add failing tests for HTTP helpers**

Append this import to `scripts/smoke-compose.test.ts`, merging duplicate imports if needed:

```ts
import { SmokeHttpError, createCookieJar, expectArrayContains, getJson, pollUntil, postJson } from "./smoke-compose/http.js";
```

Append these tests:

```ts
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

    await expect(
      getJson("http://localhost:3000/auth/me", {
        fetchImpl,
        redact: (value) => value.replace("secret", "[REDACTED]")
      })
    ).rejects.toMatchObject({
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: the command exits `1` because `http.ts` does not exist.

- [ ] **Step 3: Implement HTTP helper**

Create `scripts/smoke-compose/http.ts`:

```ts
export class SmokeHttpError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export type CookieJar = {
  addFromResponse: (headers: Headers) => void;
  header: () => string;
};

export type HttpOptions = {
  fetchImpl?: typeof fetch;
  cookieJar?: CookieJar;
  redact?: (value: string) => string;
  bearerToken?: string;
};

export function createCookieJar(): CookieJar {
  const cookies = new Map<string, string>();
  return {
    addFromResponse(headers) {
      const setCookie = headers.get("set-cookie");
      if (!setCookie) return;
      const [pair] = setCookie.split(";");
      const separator = pair.indexOf("=");
      if (separator === -1) return;
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    },
    header() {
      return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    }
  };
}

async function parseBody(response: Response, redact: (value: string) => string): Promise<string> {
  try {
    return redact(await response.text());
  } catch {
    return "";
  }
}

async function requestJson<T>(url: string, init: RequestInit, options: HttpOptions = {}): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (options.cookieJar?.header()) headers.set("cookie", options.cookieJar.header());
  if (options.bearerToken) headers.set("authorization", `Bearer ${options.bearerToken}`);

  const response = await fetchImpl(url, { ...init, headers });
  options.cookieJar?.addFromResponse(response.headers);

  if (!response.ok) {
    const body = await parseBody(response, options.redact ?? ((value) => value));
    throw new SmokeHttpError(`${init.method ?? "GET"} ${url} returned HTTP ${response.status}`, response.status, body);
  }

  return (await response.json()) as T;
}

export function getJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  return requestJson<T>(url, { method: "GET" }, options);
}

export function postJson<T>(url: string, body: unknown, options: HttpOptions = {}): Promise<T> {
  return requestJson<T>(url, { method: "POST", body: JSON.stringify(body) }, options);
}

export async function postBearerJson<T>(url: string, body: unknown, bearerToken: string, options: HttpOptions = {}): Promise<T> {
  return postJson<T>(url, body, { ...options, bearerToken });
}

export async function pollUntil<T>(
  label: string,
  callback: () => Promise<T | null>,
  options: { attempts: number; delayMs: number }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const result = await callback();
      if (result !== null) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, options.delayMs));
  }
  throw new Error(`${label} did not become ready${lastError instanceof Error ? `: ${lastError.message}` : ""}`);
}

export function expectArrayContains<T>(items: T[], predicate: (item: T) => boolean, label: string): T {
  const found = items.find(predicate);
  if (!found) throw new Error(`Expected ${label}`);
  return found;
}
```

- [ ] **Step 4: Run focused tests**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: all tests pass.

- [ ] **Step 5: Commit Task 4**

Run:

```sh
git add scripts/smoke-compose.test.ts scripts/smoke-compose/http.ts
git commit -m "feat: add smoke HTTP helpers"
```

## Task 5: Add Runner Skeleton, Package Script, And Unit-Tested Step Ordering

**Files:**
- Modify: `scripts/smoke-compose.test.ts`
- Create: `scripts/smoke-compose/runner.ts`
- Create: `scripts/smoke-compose.ts`
- Modify: `package.json`

- [ ] **Step 1: Add failing tests for runner ordering**

Append this import to `scripts/smoke-compose.test.ts`, merging duplicate imports if needed:

```ts
import { runSmokeCompose } from "./smoke-compose/runner.js";
```

Append this test:

```ts
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: the command exits `1` because `runner.ts` does not exist.

- [ ] **Step 3: Implement runner skeleton**

Create `scripts/smoke-compose/runner.ts`:

```ts
import { rm } from "node:fs/promises";
import { parseSmokeArgs } from "./args.js";
import { cleanupPlan } from "./cleanup.js";
import { formatCommandFailure, runCommand as runCommandImpl } from "./command.js";
import { createSmokePayloads } from "./fixtures.js";
import { createRedactor } from "./redaction.js";
import { createStepRecorder, renderSummary } from "./steps.js";
import { writeSmokeResources } from "./temp-env.js";
import type { CommandInput, CommandResult, SmokeOptions, SmokeResources } from "./types.js";

type PreparedResources = SmokeResources & {
  secrets: {
    postgresPassword: string;
    sessionSecret: string;
    apiKeyPepper: string;
    adminEmail: string;
    adminPassword: string;
  };
};

export type SmokeRunnerDependencies = {
  getCommit: () => Promise<string>;
  prepareResources: () => Promise<PreparedResources>;
  runCommand: (input: CommandInput) => Promise<CommandResult>;
  runHttpSmoke: (input: {
    apiUrl: string;
    adminEmail: string;
    adminPassword: string;
    sourceMapFile: string;
    phase: "pre-restore" | "post-restore";
    redact: (value: string) => string;
  }) => Promise<void>;
  removeTempDir: (dir: string) => Promise<void>;
};

export type RunSmokeComposeInput = {
  options: SmokeOptions;
  write: (line: string) => void;
  dependencies?: Partial<SmokeRunnerDependencies>;
};

function composeCommand(projectName: string, envFile: string, args: string[]): CommandInput {
  return {
    command: "docker",
    args: ["compose", "-p", projectName, "--env-file", envFile, ...args],
    timeoutMs: 180_000
  };
}

async function defaultGetCommit(): Promise<string> {
  const result = await runCommandImpl({ command: "git", args: ["rev-parse", "--short", "HEAD"] });
  return result.stdout.trim();
}

async function defaultPrepareResources(options: SmokeOptions): Promise<PreparedResources> {
  return writeSmokeResources({
    envExamplePath: ".env.example",
    apiUrl: options.apiUrl,
    runId: "phase6b"
  });
}

async function assertCommand(
  input: CommandInput,
  runCommand: (input: CommandInput) => Promise<CommandResult>,
  redact: (value: string) => string
): Promise<CommandResult> {
  const result = await runCommand(input);
  if (result.exitCode !== 0 && !input.allowFailure) {
    throw new Error(formatCommandFailure(input, result, redact));
  }
  return result;
}

async function defaultRunHttpSmoke(): Promise<void> {
  createSmokePayloads("phase6b");
  throw new Error("HTTP smoke flow requires the Task 6 implementation before pnpm smoke:compose is run against real services");
}

export async function runSmokeCompose(input: RunSmokeComposeInput): Promise<number> {
  const recorder = createStepRecorder(input.write);
  const redactor = createRedactor([]);
  const dependencies: SmokeRunnerDependencies = {
    getCommit: input.dependencies?.getCommit ?? defaultGetCommit,
    prepareResources: input.dependencies?.prepareResources ?? (() => defaultPrepareResources(input.options)),
    runCommand: input.dependencies?.runCommand ?? runCommandImpl,
    runHttpSmoke: input.dependencies?.runHttpSmoke ?? defaultRunHttpSmoke,
    removeTempDir: input.dependencies?.removeTempDir ?? ((dir) => rm(dir, { recursive: true, force: true }))
  };

  let resources: PreparedResources | undefined;

  try {
    const commit = await dependencies.getCommit();
    resources = await dependencies.prepareResources();
    redactor.add(resources.secrets.adminPassword);
    redactor.add(resources.secrets.apiKeyPepper);
    redactor.add(resources.secrets.postgresPassword);
    redactor.add(resources.secrets.sessionSecret);

    recorder.pass("prepare", `commit ${commit}, project ${input.options.projectName}`);

    const envFile = resources.envFile;
    const run = (command: CommandInput) => assertCommand(command, dependencies.runCommand, redactor.redact);

    await run({ command: "pnpm", args: ["run", "doctor", "--", "--env-file", envFile], timeoutMs: 60_000 });
    recorder.pass("doctor", "pre-start checks passed");

    await run(composeCommand(input.options.projectName, envFile, ["config", "--quiet"]));
    recorder.pass("compose config", "configuration rendered");

    await run(composeCommand(input.options.projectName, envFile, ["up", "-d", "postgres", "redis"]));
    recorder.pass("dependencies", "postgres and redis started");

    await run(composeCommand(input.options.projectName, envFile, ["run", "--rm", "api", "pnpm", "seed:admin"]));
    recorder.pass("seed admin", "bootstrap admin seeded");

    await run(composeCommand(input.options.projectName, envFile, ["up", "-d", "--build"]));
    recorder.pass("stack", "api and worker started");

    await run({
      command: "pnpm",
      args: ["run", "doctor", "--", "--compose", "--api-url", input.options.apiUrl, "--env-file", envFile],
      env: { COMPOSE_PROJECT_NAME: input.options.projectName },
      timeoutMs: 60_000
    });
    recorder.pass("compose doctor", "running checks passed");

    await dependencies.runHttpSmoke({
      apiUrl: input.options.apiUrl,
      adminEmail: resources.secrets.adminEmail,
      adminPassword: resources.secrets.adminPassword,
      sourceMapFile: resources.sourceMapFile,
      phase: "pre-restore",
      redact: redactor.redact
    });
    recorder.pass("http smoke", "pre-restore data verified");

    const backupPath = "/var/lib/signalhub/backups/latest.dump";
    await run(composeCommand(input.options.projectName, envFile, ["run", "--rm", "worker", "pnpm", "backup:create"]));
    recorder.pass("backup", "manual backup completed");

    await run({
      ...composeCommand(input.options.projectName, envFile, ["run", "--rm", "worker", "pnpm", "backup:restore", "--", backupPath]),
      allowFailure: true
    });
    recorder.pass("restore guard", "restore without --yes refused");

    await run(composeCommand(input.options.projectName, envFile, ["stop", "api", "worker"]));
    await run(composeCommand(input.options.projectName, envFile, ["run", "--rm", "worker", "pnpm", "backup:restore", "--", backupPath, "--yes"]));
    await run(composeCommand(input.options.projectName, envFile, ["start", "api", "worker"]));
    recorder.pass("restore", "confirmed restore completed");

    await run({
      command: "pnpm",
      args: ["run", "doctor", "--", "--compose", "--api-url", input.options.apiUrl, "--env-file", envFile],
      env: { COMPOSE_PROJECT_NAME: input.options.projectName },
      timeoutMs: 60_000
    });

    await dependencies.runHttpSmoke({
      apiUrl: input.options.apiUrl,
      adminEmail: resources.secrets.adminEmail,
      adminPassword: resources.secrets.adminPassword,
      sourceMapFile: resources.sourceMapFile,
      phase: "post-restore",
      redact: redactor.redact
    });
    recorder.pass("post-restore smoke", "restored data verified");

    return recorder.results().some((result) => result.status === "fail") ? 1 : 0;
  } catch (error) {
    recorder.fail("smoke", redactor.redact(error instanceof Error ? error.message : String(error)));
    return 1;
  } finally {
    if (resources) {
      const plan = cleanupPlan({
        preserve: input.options.preserve,
        projectName: input.options.projectName,
        tempDir: resources.tempDir
      });
      for (const command of plan.commands) {
        await dependencies.runCommand({ command: command[0]!, args: command.slice(1), timeoutMs: 120_000, allowFailure: true });
      }
      if (plan.removeTempDir) await dependencies.removeTempDir(resources.tempDir);
      input.write(plan.message);
      input.write(
        renderSummary(
          { commit: "unknown", projectName: input.options.projectName, apiUrl: input.options.apiUrl },
          recorder.results()
        )
      );
    }
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseSmokeArgs(args, process.env);
  const exitCode = await runSmokeCompose({
    options,
    write: (line) => process.stdout.write(`${line}\n`)
  });
  process.exitCode = exitCode;
}
```

- [ ] **Step 4: Add thin entrypoint**

Create `scripts/smoke-compose.ts`:

```ts
import { pathToFileURL } from "node:url";
import { main } from "./smoke-compose/runner.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
```

- [ ] **Step 5: Add package script**

Modify the root `package.json` scripts block to include:

```json
"smoke:compose": "tsx scripts/smoke-compose.ts"
```

Place it after `"doctor": "tsx scripts/doctor.ts"` and add the required comma to the previous line.

- [ ] **Step 6: Run focused tests**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: all tests pass.

- [ ] **Step 7: Run type/build check for script compile**

Run:

```sh
pnpm build
```

Expected: build exits `0`.

- [ ] **Step 8: Commit Task 5**

Run:

```sh
git add package.json scripts/smoke-compose.ts scripts/smoke-compose/runner.ts scripts/smoke-compose.test.ts
git commit -m "feat: add smoke compose runner skeleton"
```

## Task 6: Replace Runner Stub With Real HTTP Smoke Flow

**Files:**
- Modify: `scripts/smoke-compose/runner.ts`
- Modify: `scripts/smoke-compose/http.ts`
- Modify: `scripts/smoke-compose.test.ts`

- [ ] **Step 1: Add failing tests for source-map upload request helper**

Append this import to `scripts/smoke-compose.test.ts`, merging duplicate imports if needed:

```ts
import { uploadSourceMapFile } from "./smoke-compose/http.js";
```

Append this test:

```ts
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

    const response = await uploadSourceMapFile("http://localhost:3000", {
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
    expect(calls[0][1].headers).toEqual({ authorization: "Bearer shsmap_secret" });
    expect(calls[0][1].body).toBeInstanceOf(FormData);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: the command exits `1` because `uploadSourceMapFile` is not exported.

- [ ] **Step 3: Add source-map upload helper**

Append this function to `scripts/smoke-compose/http.ts`:

```ts
export async function uploadSourceMapFile(
  apiUrl: string,
  input: {
    token: string;
    projectId: string;
    environmentId: string;
    release: string;
    filePath: string;
    minifiedFile: string;
    fileContent: string;
    fetchImpl?: typeof fetch;
  }
): Promise<{ artifacts: Array<{ minifiedFile: string }> }> {
  const form = new FormData();
  form.set("project_id", input.projectId);
  form.set("environment_id", input.environmentId);
  form.set("release", input.release);
  form.set("minified_file", input.minifiedFile);
  form.set("file", new Blob([input.fileContent], { type: "application/json" }), input.filePath.split("/").pop() ?? "app.min.js.map");

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${apiUrl.replace(/\/+$/, "")}/v1/source-maps`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.token}` },
    body: form
  });

  if (!response.ok) {
    throw new SmokeHttpError("source map upload failed", response.status, await response.text());
  }

  return (await response.json()) as { artifacts: Array<{ minifiedFile: string }> };
}
```

- [ ] **Step 4: Replace `defaultRunHttpSmoke` with the real HTTP flow**

In `scripts/smoke-compose/runner.ts`, replace the `defaultRunHttpSmoke` function with this implementation and add the needed imports from `node:fs/promises`, `./http.js`, and `./fixtures.js`:

```ts
import { readFile } from "node:fs/promises";
import {
  createCookieJar,
  expectArrayContains,
  getJson,
  pollUntil,
  postBearerJson,
  postJson,
  uploadSourceMapFile
} from "./http.js";
```

Use this implementation:

```ts
async function defaultRunHttpSmoke(input: {
  apiUrl: string;
  adminEmail: string;
  adminPassword: string;
  sourceMapFile: string;
  phase: "pre-restore" | "post-restore";
  redact: (value: string) => string;
}): Promise<void> {
  const runId = "phase6b";
  const payloads = createSmokePayloads(runId);
  const apiUrl = input.apiUrl.replace(/\/+$/, "");
  const cookieJar = createCookieJar();

  await postJson<{ user: { email: string } }>(
    `${apiUrl}/auth/login`,
    { email: input.adminEmail, password: input.adminPassword },
    { cookieJar, redact: input.redact }
  );

  let projectId = "";
  let environmentId = "";
  let apiKeySecret = "";
  let sourceMapToken = "";

  if (input.phase === "pre-restore") {
    const project = await postJson<{ project: { id: string } }>(
      `${apiUrl}/admin/projects`,
      { name: "Phase 6B Smoke Project" },
      { cookieJar, redact: input.redact }
    );
    projectId = project.project.id;

    const environment = await postJson<{ environment: { id: string } }>(
      `${apiUrl}/admin/projects/${encodeURIComponent(projectId)}/environments`,
      { name: "production" },
      { cookieJar, redact: input.redact }
    );
    environmentId = environment.environment.id;

    const apiKey = await postJson<{ apiKey: { secret: string } }>(
      `${apiUrl}/admin/projects/${encodeURIComponent(projectId)}/api-keys`,
      { environmentId, name: "Phase 6B smoke ingest" },
      { cookieJar, redact: input.redact }
    );
    apiKeySecret = apiKey.apiKey.secret;

    const token = await postJson<{ token: { secret: string } }>(
      `${apiUrl}/admin/source-map-upload-tokens`,
      { projectId, environmentId, name: "Phase 6B smoke source maps" },
      { cookieJar, redact: input.redact }
    );
    sourceMapToken = token.token.secret;

    const ingest = async (path: string, body: unknown) =>
      postBearerJson<{ id: string }>(`${apiUrl}${path}`, body, apiKeySecret, { redact: input.redact });

    await ingest("/v1/events", payloads.event);
    const error = await ingest("/v1/errors", payloads.error);
    await ingest("/v1/traces", payloads.trace);
    await ingest("/v1/spans", payloads.span);
    await ingest("/v1/llm", payloads.llm);
    await ingest("/v1/breadcrumbs", payloads.breadcrumb);

    await uploadSourceMapFile(apiUrl, {
      token: sourceMapToken,
      projectId,
      environmentId,
      release: `web@${runId}`,
      filePath: input.sourceMapFile,
      minifiedFile: "app.min.js",
      fileContent: await readFile(input.sourceMapFile, "utf8")
    });

    await pollUntil(
      "smoke data",
      async () => {
        const events = await getJson<{ data: Array<{ name: string }> }>(
          `${apiUrl}/query/events?project_id=${encodeURIComponent(projectId)}&environment_id=${encodeURIComponent(environmentId)}&event_name=${encodeURIComponent(payloads.event.name)}`,
          { cookieJar, redact: input.redact }
        );
        return events.data.some((eventItem) => eventItem.name === payloads.event.name) ? events : null;
      },
      { attempts: 20, delayMs: 500 }
    );

    const errors = await getJson<{ data: Array<{ id: string; message: string }> }>(
      `${apiUrl}/query/errors?project_id=${encodeURIComponent(projectId)}&environment_id=${encodeURIComponent(environmentId)}`,
      { cookieJar, redact: input.redact }
    );
    expectArrayContains(errors.data, (item) => item.message === payloads.error.message, "Phase 6B error");

    const groups = await getJson<{ data: Array<{ fingerprint: string }> }>(
      `${apiUrl}/query/error-groups?project_id=${encodeURIComponent(projectId)}&environment_id=${encodeURIComponent(environmentId)}`,
      { cookieJar, redact: input.redact }
    );
    expectArrayContains(groups.data, (item) => item.fingerprint === payloads.error.fingerprint, "Phase 6B error group");

    const traces = await getJson<{ data: Array<{ traceId: string }> }>(
      `${apiUrl}/query/traces?project_id=${encodeURIComponent(projectId)}&environment_id=${encodeURIComponent(environmentId)}`,
      { cookieJar, redact: input.redact }
    );
    expectArrayContains(traces.data, (item) => item.traceId === payloads.trace.trace_id, "Phase 6B trace");

    const llm = await getJson<{ data: Array<{ promptName: string }> }>(
      `${apiUrl}/query/llm-calls?project_id=${encodeURIComponent(projectId)}&environment_id=${encodeURIComponent(environmentId)}`,
      { cookieJar, redact: input.redact }
    );
    expectArrayContains(llm.data, (item) => item.promptName === payloads.llm.prompt_name, "Phase 6B LLM call");

    const entities = await getJson<{ data: { tenants: Array<{ tenantId: string }> } }>(
      `${apiUrl}/query/entities/tenants?project_id=${encodeURIComponent(projectId)}&environment_id=${encodeURIComponent(environmentId)}`,
      { cookieJar, redact: input.redact }
    );
    expectArrayContains(entities.data.tenants, (item) => item.tenantId === payloads.event.tenant_id, "Phase 6B tenant");

    const users = await getJson<{ data: { users: Array<{ userId: string }> } }>(
      `${apiUrl}/query/users?project_id=${encodeURIComponent(projectId)}&environment_id=${encodeURIComponent(environmentId)}`,
      { cookieJar, redact: input.redact }
    );
    expectArrayContains(users.data.users, (item) => item.userId === payloads.event.user_id, "Phase 6B user");

    const timeline = await getJson<{ data: { items: Array<{ title: string }> } }>(
      `${apiUrl}/query/sessions/${encodeURIComponent(payloads.event.session_id)}/timeline?project_id=${encodeURIComponent(projectId)}&environment_id=${encodeURIComponent(environmentId)}`,
      { cookieJar, redact: input.redact }
    );
    expectArrayContains(timeline.data.items, (item) => item.title === payloads.breadcrumb.message, "Phase 6B breadcrumb");

    const resolution = await getJson<{ data: { status: string; frames: Array<{ originalSource?: string; originalName?: string }> } }>(
      `${apiUrl}/query/errors/${encodeURIComponent(error.id)}/source-map-resolution?project_id=${encodeURIComponent(projectId)}&environment_id=${encodeURIComponent(environmentId)}`,
      { cookieJar, redact: input.redact }
    );
    if (resolution.data.status !== "resolved") throw new Error("Expected source-map resolution to resolve");
    expectArrayContains(
      resolution.data.frames,
      (frame) => frame.originalSource === "src/app.ts" && frame.originalName === "checkout",
      "Phase 6B source-map frame"
    );

    process.env.SIGNALHUB_SMOKE_PROJECT_ID = projectId;
    process.env.SIGNALHUB_SMOKE_ENVIRONMENT_ID = environmentId;
    return;
  }

  projectId = process.env.SIGNALHUB_SMOKE_PROJECT_ID ?? "";
  environmentId = process.env.SIGNALHUB_SMOKE_ENVIRONMENT_ID ?? "";
  if (!projectId || !environmentId) throw new Error("Missing smoke project identifiers for post-restore check");

  const restoredEvents = await getJson<{ data: Array<{ name: string }> }>(
    `${apiUrl}/query/events?project_id=${encodeURIComponent(projectId)}&environment_id=${encodeURIComponent(environmentId)}&event_name=${encodeURIComponent(payloads.event.name)}`,
    { cookieJar, redact: input.redact }
  );
  expectArrayContains(restoredEvents.data, (item) => item.name === payloads.event.name, "restored Phase 6B event");

  const restoredErrors = await getJson<{ data: Array<{ message: string }> }>(
    `${apiUrl}/query/errors?project_id=${encodeURIComponent(projectId)}&environment_id=${encodeURIComponent(environmentId)}`,
    { cookieJar, redact: input.redact }
  );
  expectArrayContains(restoredErrors.data, (item) => item.message === payloads.error.message, "restored Phase 6B error");

  const restoredTraces = await getJson<{ data: Array<{ traceId: string }> }>(
    `${apiUrl}/query/traces?project_id=${encodeURIComponent(projectId)}&environment_id=${encodeURIComponent(environmentId)}`,
    { cookieJar, redact: input.redact }
  );
  expectArrayContains(restoredTraces.data, (item) => item.traceId === payloads.trace.trace_id, "restored Phase 6B trace");

  const restoredTimeline = await getJson<{ data: { items: Array<{ title: string }> } }>(
    `${apiUrl}/query/sessions/${encodeURIComponent(payloads.event.session_id)}/timeline?project_id=${encodeURIComponent(projectId)}&environment_id=${encodeURIComponent(environmentId)}`,
    { cookieJar, redact: input.redact }
  );
  expectArrayContains(restoredTimeline.data.items, (item) => item.title === payloads.breadcrumb.message, "restored Phase 6B timeline");
}
```

- [ ] **Step 5: Run focused tests**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: all tests pass.

- [ ] **Step 6: Commit Task 6**

Run:

```sh
git add scripts/smoke-compose.test.ts scripts/smoke-compose/http.ts scripts/smoke-compose/runner.ts
git commit -m "feat: wire smoke HTTP verification"
```

## Task 7: Make Backup Restore Path Discovery Real

**Files:**
- Modify: `scripts/smoke-compose/runner.ts`
- Modify: `scripts/smoke-compose.test.ts`

- [ ] **Step 1: Add failing test for backup path discovery command**

Update the runner ordering test in `scripts/smoke-compose.test.ts` so the fake `runCommand` returns a backup path for this command:

```ts
if ([input.command, ...input.args].join(" ").includes("ls -1t /var/lib/signalhub/backups/*.dump")) {
  return { exitCode: 0, stdout: "/var/lib/signalhub/backups/signalhub-smoke.dump\n", stderr: "" };
}
```

Update the expected calls so the backup section is:

```ts
"docker compose -p signalhub_smoke --env-file /tmp/signalhub-smoke-1/.env run --rm worker pnpm backup:create",
"docker compose -p signalhub_smoke --env-file /tmp/signalhub-smoke-1/.env run --rm worker sh -lc ls -1t /var/lib/signalhub/backups/*.dump | head -n 1",
"docker compose -p signalhub_smoke --env-file /tmp/signalhub-smoke-1/.env run --rm worker pnpm backup:restore -- /var/lib/signalhub/backups/signalhub-smoke.dump",
"docker compose -p signalhub_smoke --env-file /tmp/signalhub-smoke-1/.env stop api worker",
"docker compose -p signalhub_smoke --env-file /tmp/signalhub-smoke-1/.env run --rm worker pnpm backup:restore -- /var/lib/signalhub/backups/signalhub-smoke.dump --yes",
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: the runner ordering test fails because `runner.ts` still uses `/var/lib/signalhub/backups/latest.dump`.

- [ ] **Step 3: Implement backup path discovery**

In `scripts/smoke-compose/runner.ts`, replace:

```ts
const backupPath = "/var/lib/signalhub/backups/latest.dump";
await run(composeCommand(input.options.projectName, envFile, ["run", "--rm", "worker", "pnpm", "backup:create"]));
```

with:

```ts
await run(composeCommand(input.options.projectName, envFile, ["run", "--rm", "worker", "pnpm", "backup:create"]));
const backupPathResult = await run(
  composeCommand(input.options.projectName, envFile, [
    "run",
    "--rm",
    "worker",
    "sh",
    "-lc",
    "ls -1t /var/lib/signalhub/backups/*.dump | head -n 1"
  ])
);
const backupPath = backupPathResult.stdout.trim();
if (!backupPath) throw new Error("Backup completed but no dump path was found");
```

- [ ] **Step 4: Run focused tests**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: all tests pass.

- [ ] **Step 5: Commit Task 7**

Run:

```sh
git add scripts/smoke-compose.test.ts scripts/smoke-compose/runner.ts
git commit -m "feat: discover smoke backup path"
```

## Task 8: Run The Real Smoke Harness And Fix Blockers

**Files:**
- Modify only files directly related to smoke runner blockers discovered by this task.
- Modify: `docs/superpowers/plans/2026-05-17-phase6b-automated-smoke-harness-implementation.md`

- [x] **Step 1: Run focused unit tests**

Run:

```sh
pnpm exec vitest scripts/smoke-compose.test.ts --run
```

Expected: all tests pass.

- [x] **Step 2: Run the smoke harness**

Run:

```sh
pnpm smoke:compose
```

Expected: the command exits `0`, prints a summary, removes its Compose resources, and does not print generated secrets.

- [x] **Step 3: If the smoke fails, classify the failure before editing**

If `pnpm smoke:compose` fails, record the failing step in this plan under a new `## Smoke Run Notes` section using this exact format:

```markdown
### Smoke Failure N: concise title

- **Step:** failing step name
- **Expected:** expected smoke behavior
- **Actual:** actual output or behavior, with secrets redacted
- **Class:** harness bug, product blocker, local Docker/environment issue, or deferred follow-up
- **Fix:** file and behavior changed, or reason no code changed
- **Verification:** command that passed after the fix
```

Use `superpowers:systematic-debugging` before editing for product blockers or unclear failures.

- [x] **Step 4: Re-run the smoke harness after each fix**

Run:

```sh
pnpm smoke:compose
```

Expected: the original failing smoke step now passes, or the failure is classified as a local Docker/environment issue with evidence.

- [x] **Step 5: Confirm cleanup after smoke**

Run:

```sh
docker ps --filter name=signalhub_smoke --format '{{.Names}}'
docker volume ls --format '{{.Name}}' | rg '^signalhub_smoke_'
```

Expected: both commands print no smoke containers or volumes. The `rg` command may exit `1` when no volumes remain.

- [x] **Step 6: Commit Task 8**

If no fixes were needed, do not create an empty commit. If fixes were needed, run:

```sh
git add scripts package.json docs/superpowers/plans/2026-05-17-phase6b-automated-smoke-harness-implementation.md
git commit -m "fix: stabilize smoke compose runner"
```

## Smoke Run Notes

### Smoke Failure 1: Docker Desktop paused

- **Step:** dependencies
- **Expected:** `pnpm smoke:compose` starts disposable Postgres and Redis Compose services.
- **Actual:** `docker compose -p signalhub_smoke --env-file <temp-env> up -d postgres redis` failed because Docker reported `Docker Desktop is manually paused. Unpause it through the Whale menu or Dashboard.`
- **Class:** local Docker/environment issue
- **Fix:** no code changed; the Docker daemon must be unpaused before the real smoke run can continue.
- **Verification:** `docker info` reproduced the same paused-Docker error.

### Smoke Failure 2: Host ports already allocated

- **Step:** dependencies
- **Expected:** `pnpm smoke:compose` starts disposable Postgres and Redis Compose services.
- **Actual:** preserved container inspection showed Docker could not bind `127.0.0.1:5432` and `127.0.0.1:6379`; those ports were held by another local Compose project.
- **Class:** local Docker/environment issue
- **Fix:** no code changed; the conflicting local project was stopped before retrying.
- **Verification:** `docker ps --format '{{.Names}} {{.Ports}}'` showed no running containers holding the smoke ports before the next run.

### Smoke Failure 3: First API image build exceeded command timeout

- **Step:** seed admin
- **Expected:** `docker compose run --rm api pnpm seed:admin` seeds the bootstrap admin.
- **Actual:** the command timed out after `180000ms` during the first smoke run after dependencies started; Docker image inspection showed `signalhub_smoke-api:latest` had just been built.
- **Class:** local Docker/environment issue
- **Fix:** no code changed; the next run used the warm local image cache.
- **Verification:** `pnpm smoke:compose` later passed the `seed admin` step.

### Smoke Failure 4: Compose doctor raced API readiness

- **Step:** compose doctor
- **Expected:** the compose-mode doctor verifies running services and API `/health` plus `/ready`.
- **Actual:** the first doctor run failed immediately after `docker compose up -d --build`, while a manual doctor run against the preserved stack passed seconds later.
- **Class:** harness bug
- **Fix:** `scripts/smoke-compose/runner.ts` now retries compose-mode doctor checks before failing.
- **Verification:** `pnpm exec vitest scripts/smoke-compose.test.ts --run` passed with a retry regression, and `pnpm smoke:compose` passed the `compose doctor` step.

### Smoke Failure 5: Error group assertion used the wrong response field

- **Step:** http smoke
- **Expected:** the smoke query finds the ingested error group by fingerprint.
- **Actual:** the API returned `groupingFingerprint`, but the smoke assertion checked a non-existent `fingerprint` field, so polling could never match the valid error group response.
- **Class:** harness bug
- **Fix:** `scripts/smoke-compose/runner.ts` now matches error groups by `groupingFingerprint`.
- **Verification:** `pnpm exec vitest scripts/smoke-compose.test.ts --run` passed with a response-shape regression, and `pnpm smoke:compose` completed with `Passed: 12`, `Failed: 0`.

### Smoke Success: Real harness passed

- **Step:** full smoke
- **Expected:** `pnpm smoke:compose` verifies the Docker Compose release path and cleans up disposable resources.
- **Actual:** the command passed all 12 smoke steps and printed `Failed: 0`.
- **Class:** completed verification
- **Fix:** no further code change needed for Task 8.
- **Verification:** `docker ps -a --filter name=signalhub_smoke --format '{{.Names}} {{.Status}}'` printed no smoke containers, and `docker volume ls --format '{{.Name}}'` showed no `signalhub_smoke_` volumes.

## Task 9: Document The Smoke Harness

**Files:**
- Modify: `README.md`
- Modify: `.claude/docs/DEPLOYMENT.md`
- Modify: `.claude/docs/STACK.md`
- Modify: `.claude/docs/CONSTRAINTS.md`
- Modify: `docs/superpowers/plans/2026-05-17-phase6b-automated-smoke-harness-implementation.md`

- [x] **Step 1: Update README**

In `README.md`, add this section after `## Operator Doctor`:

````markdown
## Compose Smoke Harness

Run the release smoke harness against disposable Docker Compose resources:

```sh
pnpm smoke:compose
```

The smoke harness creates local-only generated secrets, starts an isolated Compose project, seeds the bootstrap admin, creates a project/environment/API key, ingests deterministic telemetry, verifies query surfaces, uploads and resolves a source map, runs backup and guarded restore checks, then removes its containers, volumes, and temp files.

Use `--preserve` to keep the Compose project and temp directory for debugging:

```sh
pnpm smoke:compose -- --preserve
```

Use `--project-name` or `SIGNALHUB_SMOKE_PROJECT_NAME` when running multiple smoke jobs on the same Docker host.
````

When inserting this Markdown inside README, keep the nested code fences valid by using normal fenced blocks in the actual file.

- [x] **Step 2: Update deployment docs**

In `.claude/docs/DEPLOYMENT.md`, add this paragraph after the doctor command section:

```markdown
For release-readiness checks, run `pnpm smoke:compose` from a clean checkout after dependencies are installed. The command uses disposable Docker Compose resources, generates local-only secrets, verifies the critical install path, and cleans up by default. It is a validation harness, not a production runtime service.
```

- [x] **Step 3: Update stack docs**

In `.claude/docs/STACK.md`, add this bullet under `## Commands`:

```markdown
- `pnpm smoke:compose`: run the local-first Docker Compose release smoke harness.
```

- [x] **Step 4: Update constraints docs**

In `.claude/docs/CONSTRAINTS.md`, add this bullet under the most relevant constraints section:

```markdown
- The automated smoke harness validates the Docker Compose install path; it does not introduce Kubernetes, Helm, systemd, hosted SaaS, or additional production deployment support.
```

- [x] **Step 5: Run docs grep checks**

Run:

```sh
rg -n "smoke:compose|Compose Smoke Harness|release smoke harness" README.md .claude/docs
```

Expected: output shows the new README section and the `.claude/docs` updates.

- [x] **Step 6: Commit Task 9**

Run:

```sh
git add README.md .claude/docs/DEPLOYMENT.md .claude/docs/STACK.md .claude/docs/CONSTRAINTS.md docs/superpowers/plans/2026-05-17-phase6b-automated-smoke-harness-implementation.md
git commit -m "docs: document compose smoke harness"
```

## Task 10: Final Verification, Memory, And Completion

**Files:**
- Modify: `CLAUDE.md` if current phase or durable conventions changed.
- Modify: `docs/superpowers/plans/2026-05-17-phase6b-automated-smoke-harness-implementation.md`
- Modify: `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`

- [ ] **Step 1: Run final repo verification**

Run:

```sh
pnpm test
pnpm build
docker compose config --quiet
pnpm run doctor
pnpm smoke:compose
```

Expected: all commands exit `0`. If `pnpm run doctor` requires a local `.env`, create one from `.env.example` with local-only generated values and keep it uncommitted.

- [ ] **Step 2: Update CLAUDE.md**

If the implementation completed successfully, update the current phase line in `CLAUDE.md` to:

```markdown
- Current phase: Phase 6B Automated Smoke Harness.
```

Add this bullet under `Project Conventions`:

```markdown
- Use `pnpm smoke:compose` as the local-first release smoke gate for the Docker Compose install path.
```

- [ ] **Step 3: Complete the plan checklist**

In `docs/superpowers/plans/2026-05-17-phase6b-automated-smoke-harness-implementation.md`, check off completed task steps through Task 10 and add final verification notes under this heading:

```markdown
## Final Verification Notes

- `pnpm test`: passed.
- `pnpm build`: passed.
- `docker compose config --quiet`: passed.
- `pnpm run doctor`: passed.
- `pnpm smoke:compose`: passed.
- Smoke cleanup: no `signalhub_smoke` containers or volumes remained.
```

- [ ] **Step 4: Commit final SignalHub docs**

Run:

```sh
git add CLAUDE.md docs/superpowers/plans/2026-05-17-phase6b-automated-smoke-harness-implementation.md
git commit -m "docs: complete phase 6b smoke harness"
```

Expected: commit succeeds if those files changed. If they did not change, do not create an empty commit.

- [ ] **Step 5: Update versioned memory**

Update `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md` with:

```markdown
- Completed Phase 6B Automated Smoke Harness on SignalHub commit `SHORT_SHA_FROM_FINAL_SIGNALHUB_COMMIT`.
- Added `pnpm smoke:compose` as a local-first, CI-ready Docker Compose release smoke gate.
- Final verification: `pnpm test`, `pnpm build`, `docker compose config --quiet`, `pnpm run doctor`, and `pnpm smoke:compose` passed.
- Cleanup verification: no smoke Compose containers or volumes remained after the final smoke run.
```

Replace `SHORT_SHA_FROM_FINAL_SIGNALHUB_COMMIT` with the actual final SignalHub commit hash.

- [ ] **Step 6: Commit memory**

Run in `/Users/diogo/Developer/Github/claude-config`:

```sh
git add projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
git commit -m "memory: record SignalHub phase 6b completion"
```

- [ ] **Step 7: Final handoff**

Report:

- final SignalHub commit list;
- verification command outcomes;
- whether smoke resources were cleaned up;
- unresolved follow-ups;
- whether SignalHub and config repo are ahead of origin.
