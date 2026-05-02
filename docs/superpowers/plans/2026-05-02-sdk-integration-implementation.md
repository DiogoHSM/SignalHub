# Phase 2 JavaScript SDK and HTTP Ingestion Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@signal-hub/sdk`, a small TypeScript SDK that sends events, errors, LLM calls, traces, and spans into the existing Phase 1 ingestion API, plus a tiny raw HTTP ingestion guide.

**Architecture:** Add a new workspace package at `packages/sdk` with focused modules for public types, context and payload mapping, client-side sanitization, FIFO queueing, retry/backoff, and the public client. The SDK uses `globalThis.fetch` by default, supports injected fetch in tests, sends one request per queued signal to existing `/v1/*` ingestion endpoints, and does not require backend changes.

**Tech Stack:** TypeScript ES modules, pnpm workspaces, Vitest, existing `@signal-hub/telemetry` ingestion schemas for contract tests.

---

## Source Documents

- Approved spec: `docs/superpowers/specs/2026-05-02-sdk-integration-design.md`
- API contract: `packages/telemetry/src/ingestion-schemas.ts`
- Ingestion routes: `apps/api/src/routes/ingestion.ts`
- Package patterns: `packages/telemetry/package.json`, `packages/queues/tsconfig.json`, `vitest.config.ts`

## File Structure

Create:

```txt
packages/sdk
├── package.json
├── tsconfig.json
├── src
│   ├── index.ts
│   ├── client.ts
│   ├── mapping.ts
│   ├── queue.ts
│   ├── retry.ts
│   ├── sanitize.ts
│   └── types.ts
└── test
    ├── client.test.ts
    ├── contract.test.ts
    ├── mapping.test.ts
    ├── queue.test.ts
    ├── retry.test.ts
    └── sanitize.test.ts
```

Modify:

```txt
tsconfig.base.json
vitest.config.ts
docs/HTTP-INGESTION.md
.claude/docs/STACK.md
.claude/docs/PROJECT-SUMMARY.md
.claude/docs/DECISIONS.md
CLAUDE.md
```

Responsibilities:

- `types.ts`: public SDK types, internal normalized queue item types, constants shared by SDK modules.
- `mapping.ts`: convert public camelCase SDK inputs into Phase 1 snake_case ingestion payloads.
- `sanitize.ts`: best-effort client-side masking, string truncation, and serialized payload-size checks.
- `queue.ts`: in-memory FIFO queue with drop-oldest overflow accounting.
- `retry.ts`: retry classification, sleep, timeout-aware fetch wrapper, and request sending.
- `client.ts`: public client implementation, non-throwing tracking methods, flush behavior, interval flushing, and shutdown.
- `index.ts`: public exports only.

## Implementation Notes

- The existing API returns `202 Accepted` with `{ "accepted": true, "id": "..." }`.
- The existing API validates payload bodies before queueing. SDK contract tests must parse SDK-generated payloads with `eventPayloadSchema`, `errorPayloadSchema`, `llmCallPayloadSchema`, `tracePayloadSchema`, and `spanPayloadSchema`.
- Tracking methods should not throw for normal enqueue/send failures. Constructor validation may throw for missing `endpoint`, missing `apiKey`, or missing fetch implementation.
- Use `.js` extensions in local TypeScript imports, matching the current codebase pattern.
- Do not add automatic browser instrumentation, framework integrations, logs ingestion, batch endpoints, source maps, session replay, or backend storage changes.

---

### Task 1: Scaffold SDK Package

**Files:**
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/tsconfig.json`
- Create: `packages/sdk/src/index.ts`
- Create: `packages/sdk/src/types.ts`
- Modify: `tsconfig.base.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/sdk/package.json`:

```json
{
  "name": "@signal-hub/sdk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@signal-hub/telemetry": "workspace:*",
    "nanoid": "^5.1.11"
  },
  "devDependencies": {
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create the package TypeScript config**

Create `packages/sdk/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Add SDK path aliases**

Modify `tsconfig.base.json` and add these entries inside `compilerOptions.paths`:

```json
"@signal-hub/sdk": ["packages/sdk/src/index.ts"],
"@signal-hub/sdk/*": ["packages/sdk/src/*"]
```

Keep the existing aliases unchanged.

- [ ] **Step 4: Add Vitest aliases**

Modify `vitest.config.ts` and add these entries inside `resolve.alias`:

```ts
"@signal-hub/sdk": resolve(root, "packages/sdk/src/index.ts"),
"@signal-hub/sdk/": resolve(root, "packages/sdk/src/")
```

Keep the existing aliases unchanged.

- [ ] **Step 5: Create temporary public exports**

Create `packages/sdk/src/types.ts`:

```ts
export type SignalStatus = "success" | "error" | "pending";
export type ErrorSeverity = "debug" | "info" | "warning" | "error" | "critical";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SignalMetadata = Record<string, JsonValue>;

export type SignalContext = {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  source?: string;
  release?: string;
  metadata?: SignalMetadata;
};

export type SignalHubClientOptions = {
  endpoint: string;
  apiKey: string;
  defaultContext?: SignalContext;
  fetch?: typeof fetch;
  maxQueueSize?: number;
  flushIntervalMs?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  maxSerializedPayloadBytes?: number;
  onError?: (error: SignalHubError) => void;
};

export type EventInput = {
  timestamp?: Date | string;
};

export type ErrorInput = {
  severity?: ErrorSeverity;
  fingerprint?: string;
  context?: SignalMetadata;
} & SignalContext;

export type LlmInput = {
  provider: string;
  model: string;
  promptName?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  status?: SignalStatus;
  error?: string;
  inputPreview?: string;
  outputPreview?: string;
  timestamp?: Date | string;
};

export type TraceInput = {
  name: string;
  status?: SignalStatus;
  startedAt?: Date | string;
  endedAt?: Date | string;
  durationMs?: number;
  timestamp?: Date | string;
};

export type SpanInput = {
  traceId: string;
  parentSpanId?: string;
  name: string;
  status?: SignalStatus;
  startedAt?: Date | string;
  endedAt?: Date | string;
  durationMs?: number;
  input?: JsonValue;
  output?: JsonValue;
  error?: JsonValue;
  costUsd?: number;
  timestamp?: Date | string;
};

export type StartTraceInput = Omit<TraceInput, "name" | "startedAt"> & {
  startedAt?: Date | string;
};

export type EndTraceInput = Partial<Omit<TraceInput, "name" | "startedAt">>;

export type ActiveTrace = {
  traceId: string;
  startedAt: Date;
  end: (input?: EndTraceInput, context?: SignalContext) => void;
};

export type FlushOptions = {
  discardOnFailure?: boolean;
};

export type FlushResult = {
  sent: number;
  failed: number;
  retained: number;
  dropped: number;
};

export type SignalHubErrorCode =
  | "queue_overflow"
  | "payload_too_large"
  | "permanent_failure"
  | "transient_failure"
  | "invalid_payload";

export type SignalHubError = {
  code: SignalHubErrorCode;
  message: string;
  status?: number;
  endpoint?: string;
};

export type SignalHubClient = {
  track: (name: string, properties?: SignalMetadata, context?: SignalContext & EventInput) => void;
  captureError: (error: unknown, input?: ErrorInput) => void;
  llm: (input: LlmInput, context?: SignalContext) => void;
  trace: (input: TraceInput, context?: SignalContext) => void;
  startTrace: (name: string, input?: StartTraceInput & SignalContext) => ActiveTrace;
  span: (input: SpanInput, context?: SignalContext) => void;
  identify: (context: SignalContext) => void;
  flush: (options?: FlushOptions) => Promise<FlushResult>;
  shutdown: (options?: FlushOptions) => Promise<FlushResult>;
};

export type SignalKind = "event" | "error" | "llm" | "trace" | "span";

export type QueuedSignal = {
  kind: SignalKind;
  endpointPath: string;
  payload: Record<string, unknown>;
};

export const DEFAULT_MAX_QUEUE_SIZE = 1000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_BASE_DELAY_MS = 250;
export const DEFAULT_MAX_SERIALIZED_PAYLOAD_BYTES = 64_000;
```

Create `packages/sdk/src/index.ts`:

```ts
export type {
  ActiveTrace,
  EndTraceInput,
  ErrorInput,
  ErrorSeverity,
  EventInput,
  FlushOptions,
  FlushResult,
  JsonValue,
  LlmInput,
  SignalContext,
  SignalHubClient,
  SignalHubClientOptions,
  SignalHubError,
  SignalHubErrorCode,
  SignalMetadata,
  SignalStatus,
  SpanInput,
  StartTraceInput,
  TraceInput
} from "./types.js";
```

- [ ] **Step 6: Verify scaffold builds**

Run:

```bash
pnpm --filter @signal-hub/sdk build
```

Expected: command exits `0`.

- [ ] **Step 7: Commit scaffold**

```bash
git add packages/sdk tsconfig.base.json vitest.config.ts
git commit -m "chore: scaffold sdk package"
```

---

### Task 2: Add Payload Mapping

**Files:**
- Create: `packages/sdk/src/mapping.ts`
- Create: `packages/sdk/test/mapping.test.ts`
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: Write mapping tests**

Create `packages/sdk/test/mapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createEventSignal,
  createErrorSignal,
  createLlmSignal,
  createSpanSignal,
  createTraceSignal,
  mergeContext,
  serializeDate
} from "../src/mapping.js";

describe("sdk mapping", () => {
  it("merges default and per-call context with shallow metadata override", () => {
    expect(
      mergeContext(
        {
          tenantId: "tenant_1",
          userId: "user_1",
          source: "web",
          metadata: { plan: "free", region: "us" }
        },
        {
          userId: "user_2",
          release: "1.2.3",
          metadata: { plan: "pro" }
        }
      )
    ).toEqual({
      tenant_id: "tenant_1",
      user_id: "user_2",
      source: "web",
      release: "1.2.3",
      metadata: { plan: "pro", region: "us" }
    });
  });

  it("serializes Date and ISO string values", () => {
    expect(serializeDate(new Date("2026-05-02T12:00:00.000Z"))).toBe("2026-05-02T12:00:00.000Z");
    expect(serializeDate("2026-05-02T12:00:01.000Z")).toBe("2026-05-02T12:00:01.000Z");
  });

  it("maps events to the ingestion payload", () => {
    expect(
      createEventSignal("dashboard_created", { charts_count: 6 }, { userId: "user_1" })
    ).toEqual({
      kind: "event",
      endpointPath: "/v1/events",
      payload: {
        user_id: "user_1",
        metadata: {},
        name: "dashboard_created",
        properties: { charts_count: 6 }
      }
    });
  });

  it("extracts Error instances into error payload fields", () => {
    const error = new TypeError("Database connection failed");
    error.stack = "stack trace";

    expect(
      createErrorSignal(error, {
        severity: "critical",
        fingerprint: "db-down",
        context: { retryable: false },
        tenantId: "tenant_1"
      })
    ).toEqual({
      kind: "error",
      endpointPath: "/v1/errors",
      payload: {
        tenant_id: "tenant_1",
        metadata: {},
        message: "Database connection failed",
        type: "TypeError",
        severity: "critical",
        stack: "stack trace",
        fingerprint: "db-down",
        context: { retryable: false }
      }
    });
  });

  it("converts unknown thrown values into string messages", () => {
    expect(createErrorSignal({ reason: "bad" }).payload).toMatchObject({
      message: "{\"reason\":\"bad\"}",
      severity: "error",
      context: {}
    });
  });

  it("maps LLM calls with camelCase conversion", () => {
    expect(
      createLlmSignal(
        {
          provider: "openai",
          model: "gpt-5.5",
          promptName: "generate_sql",
          inputTokens: 120,
          outputTokens: 30,
          costUsd: 0.02,
          latencyMs: 900,
          status: "success",
          inputPreview: "prompt",
          outputPreview: "answer"
        },
        { traceId: "trace_1" }
      ).payload
    ).toEqual({
      trace_id: "trace_1",
      metadata: {},
      provider: "openai",
      model: "gpt-5.5",
      prompt_name: "generate_sql",
      input_tokens: 120,
      output_tokens: 30,
      cost_usd: 0.02,
      latency_ms: 900,
      status: "success",
      input_preview: "prompt",
      output_preview: "answer"
    });
  });

  it("maps traces and computes duration when endedAt is present", () => {
    expect(
      createTraceSignal({
        name: "generate_dashboard",
        status: "success",
        startedAt: "2026-05-02T12:00:00.000Z",
        endedAt: "2026-05-02T12:00:02.500Z"
      }).payload
    ).toEqual({
      metadata: {},
      name: "generate_dashboard",
      status: "success",
      started_at: "2026-05-02T12:00:00.000Z",
      ended_at: "2026-05-02T12:00:02.500Z",
      duration_ms: 2500
    });
  });

  it("maps spans with parent span and IO fields", () => {
    expect(
      createSpanSignal({
        traceId: "trace_1",
        parentSpanId: "span_1",
        name: "llm.generate",
        status: "error",
        startedAt: "2026-05-02T12:00:00.000Z",
        endedAt: "2026-05-02T12:00:01.000Z",
        input: { prompt: "x" },
        output: null,
        error: { message: "failed" },
        costUsd: 0.01
      }).payload
    ).toEqual({
      metadata: {},
      trace_id: "trace_1",
      parent_span_id: "span_1",
      name: "llm.generate",
      status: "error",
      started_at: "2026-05-02T12:00:00.000Z",
      ended_at: "2026-05-02T12:00:01.000Z",
      duration_ms: 1000,
      input: { prompt: "x" },
      output: null,
      error: { message: "failed" },
      cost_usd: 0.01
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test packages/sdk/test/mapping.test.ts
```

Expected: FAIL because `packages/sdk/src/mapping.ts` does not exist.

- [ ] **Step 3: Implement mapping**

Create `packages/sdk/src/mapping.ts`:

```ts
import type {
  ErrorInput,
  EventInput,
  JsonValue,
  LlmInput,
  QueuedSignal,
  SignalContext,
  SignalMetadata,
  SpanInput,
  TraceInput
} from "./types.js";

type EnvelopePayload = {
  timestamp?: string;
  tenant_id?: string;
  user_id?: string;
  session_id?: string;
  trace_id?: string;
  source?: string;
  release?: string;
  metadata: SignalMetadata;
};

export function serializeDate(value: Date | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function setIfDefined<T extends Record<string, unknown>>(target: T, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

export function mergeContext(defaultContext?: SignalContext, context?: SignalContext & EventInput): EnvelopePayload {
  const payload: EnvelopePayload = {
    metadata: {
      ...(defaultContext?.metadata ?? {}),
      ...(context?.metadata ?? {})
    }
  };

  const merged = {
    tenantId: context?.tenantId ?? defaultContext?.tenantId,
    userId: context?.userId ?? defaultContext?.userId,
    sessionId: context?.sessionId ?? defaultContext?.sessionId,
    traceId: context?.traceId ?? defaultContext?.traceId,
    source: context?.source ?? defaultContext?.source,
    release: context?.release ?? defaultContext?.release,
    timestamp: context?.timestamp
  };

  setIfDefined(payload, "tenant_id", merged.tenantId);
  setIfDefined(payload, "user_id", merged.userId);
  setIfDefined(payload, "session_id", merged.sessionId);
  setIfDefined(payload, "trace_id", merged.traceId);
  setIfDefined(payload, "source", merged.source);
  setIfDefined(payload, "release", merged.release);
  setIfDefined(payload, "timestamp", serializeDate(merged.timestamp));

  return payload;
}

function computeDurationMs(startedAt: Date | string | undefined, endedAt: Date | string | undefined): number | undefined {
  if (startedAt === undefined || endedAt === undefined) {
    return undefined;
  }

  const started = new Date(serializeDate(startedAt) as string).getTime();
  const ended = new Date(serializeDate(endedAt) as string).getTime();
  const duration = ended - started;

  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function createEventSignal(
  name: string,
  properties: SignalMetadata = {},
  context?: SignalContext & EventInput,
  defaultContext?: SignalContext
): QueuedSignal {
  return {
    kind: "event",
    endpointPath: "/v1/events",
    payload: {
      ...mergeContext(defaultContext, context),
      name,
      properties
    }
  };
}

export function createErrorSignal(error: unknown, input: ErrorInput = {}, defaultContext?: SignalContext): QueuedSignal {
  const message = error instanceof Error ? error.message : stringifyUnknown(error);
  const type = error instanceof Error ? error.name : undefined;
  const stack = error instanceof Error ? error.stack : undefined;
  const { context, fingerprint, severity = "error", ...signalContext } = input;

  return {
    kind: "error",
    endpointPath: "/v1/errors",
    payload: {
      ...mergeContext(defaultContext, signalContext),
      message,
      ...(type ? { type } : {}),
      severity,
      ...(stack ? { stack } : {}),
      ...(fingerprint ? { fingerprint } : {}),
      context: context ?? {}
    }
  };
}

export function createLlmSignal(input: LlmInput, context?: SignalContext, defaultContext?: SignalContext): QueuedSignal {
  const payload: Record<string, unknown> = {
    ...mergeContext(defaultContext, { ...context, timestamp: input.timestamp }),
    provider: input.provider,
    model: input.model
  };

  setIfDefined(payload, "prompt_name", input.promptName);
  setIfDefined(payload, "input_tokens", input.inputTokens);
  setIfDefined(payload, "output_tokens", input.outputTokens);
  setIfDefined(payload, "cost_usd", input.costUsd);
  setIfDefined(payload, "latency_ms", input.latencyMs);
  setIfDefined(payload, "status", input.status);
  setIfDefined(payload, "error", input.error);
  setIfDefined(payload, "input_preview", input.inputPreview);
  setIfDefined(payload, "output_preview", input.outputPreview);

  return { kind: "llm", endpointPath: "/v1/llm", payload };
}

export function createTraceSignal(input: TraceInput, context?: SignalContext, defaultContext?: SignalContext): QueuedSignal {
  const startedAt = input.startedAt ?? new Date();
  const durationMs = input.durationMs ?? computeDurationMs(startedAt, input.endedAt);
  const payload: Record<string, unknown> = {
    ...mergeContext(defaultContext, { ...context, timestamp: input.timestamp }),
    name: input.name,
    status: input.status ?? "pending",
    started_at: serializeDate(startedAt)
  };

  setIfDefined(payload, "ended_at", serializeDate(input.endedAt));
  setIfDefined(payload, "duration_ms", durationMs);

  return { kind: "trace", endpointPath: "/v1/traces", payload };
}

export function createSpanSignal(input: SpanInput, context?: SignalContext, defaultContext?: SignalContext): QueuedSignal {
  const startedAt = input.startedAt ?? new Date();
  const durationMs = input.durationMs ?? computeDurationMs(startedAt, input.endedAt);
  const payload: Record<string, unknown> = {
    ...mergeContext(defaultContext, { ...context, timestamp: input.timestamp }),
    trace_id: input.traceId,
    name: input.name,
    status: input.status ?? "pending",
    started_at: serializeDate(startedAt)
  };

  setIfDefined(payload, "parent_span_id", input.parentSpanId);
  setIfDefined(payload, "ended_at", serializeDate(input.endedAt));
  setIfDefined(payload, "duration_ms", durationMs);
  setIfDefined(payload, "input", input.input as JsonValue | undefined);
  setIfDefined(payload, "output", input.output as JsonValue | undefined);
  setIfDefined(payload, "error", input.error as JsonValue | undefined);
  setIfDefined(payload, "cost_usd", input.costUsd);

  return { kind: "span", endpointPath: "/v1/spans", payload };
}
```

- [ ] **Step 4: Export mapping helpers for tests and advanced users**

Modify `packages/sdk/src/index.ts`:

```ts
export {
  createErrorSignal,
  createEventSignal,
  createLlmSignal,
  createSpanSignal,
  createTraceSignal,
  mergeContext,
  serializeDate
} from "./mapping.js";

export type {
  ActiveTrace,
  EndTraceInput,
  ErrorInput,
  ErrorSeverity,
  EventInput,
  FlushOptions,
  FlushResult,
  JsonValue,
  LlmInput,
  SignalContext,
  SignalHubClient,
  SignalHubClientOptions,
  SignalHubError,
  SignalHubErrorCode,
  SignalMetadata,
  SignalStatus,
  SpanInput,
  StartTraceInput,
  TraceInput
} from "./types.js";
```

- [ ] **Step 5: Run mapping tests**

Run:

```bash
pnpm test packages/sdk/test/mapping.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit mapping**

```bash
git add packages/sdk/src packages/sdk/test/mapping.test.ts
git commit -m "feat: map sdk inputs to ingestion payloads"
```

---

### Task 3: Add Client-Side Sanitization

**Files:**
- Create: `packages/sdk/src/sanitize.ts`
- Create: `packages/sdk/test/sanitize.test.ts`

- [ ] **Step 1: Write sanitization tests**

Create `packages/sdk/test/sanitize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { enforcePayloadSize, sanitizePayload } from "../src/sanitize.js";

describe("sdk sanitize", () => {
  it("redacts sensitive nested keys", () => {
    expect(
      sanitizePayload({
        metadata: {
          authorization: "Bearer secret",
          nested: {
            apiKey: "sh_secret",
            password: "pw",
            normal: "visible"
          }
        }
      })
    ).toEqual({
      metadata: {
        authorization: "[REDACTED]",
        nested: {
          apiKey: "[REDACTED]",
          password: "[REDACTED]",
          normal: "visible"
        }
      }
    });
  });

  it("redacts credentials embedded in preview strings", () => {
    expect(
      sanitizePayload({
        input_preview: "authorization: Bearer abc123 password=secret",
        output_preview: "api_key: sh_secret"
      })
    ).toEqual({
      input_preview: "authorization: [REDACTED] password=[REDACTED]",
      output_preview: "api_key: [REDACTED]"
    });
  });

  it("truncates strings to the configured length", () => {
    expect(sanitizePayload({ message: "x".repeat(10) }, { maxStringLength: 4 })).toEqual({
      message: "xxxx"
    });
  });

  it("returns a size error when serialized payload is too large", () => {
    expect(enforcePayloadSize({ message: "abcdef" }, 10)).toEqual({ ok: false, bytes: 20 });
    expect(enforcePayloadSize({ message: "abc" }, 100)).toEqual({ ok: true, bytes: 17 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test packages/sdk/test/sanitize.test.ts
```

Expected: FAIL because `packages/sdk/src/sanitize.ts` does not exist.

- [ ] **Step 3: Implement sanitization**

Create `packages/sdk/src/sanitize.ts`:

```ts
const DEFAULT_MAX_STRING_LENGTH = 20_000;
const TEXT_PREVIEW_KEYS = new Set(["input_preview", "output_preview", "stack", "message", "error"]);

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "authorization",
  "cookie",
  "setcookie",
  "secret",
  "secretaccesskey",
  "awssecretaccesskey",
  "accesskey",
  "accesskeyid",
  "privatekey",
  "credential",
  "clientkey",
  "apikey",
  "cpf",
  "creditcard"
]);

const PREVIEW_CREDENTIAL_PATTERNS: Array<[RegExp, string]> = [
  [/\\b(authorization)\\s*[:=]\\s*Bearer\\s+[^\\s,;'"})\\]]+/gi, "$1: [REDACTED]"],
  [/\\b(password)\\s*[:=]\\s*[^\\s,;'"})\\]]+/gi, "$1=[REDACTED]"],
  [/\\b(access[_-]?token)\\s*[:=]\\s*[^\\s,;'"})\\]]+/gi, "$1=[REDACTED]"],
  [/\\b(refresh[_-]?token)\\s*[:=]\\s*[^\\s,;'"})\\]]+/gi, "$1=[REDACTED]"],
  [/\\b(api[_-]?key)\\s*[:=]\\s*[^\\s,;'"})\\]]+/gi, "$1: [REDACTED]"],
  [/\\b(secret)\\s*[:=]\\s*[^\\s,;'"})\\]]+/gi, "$1=[REDACTED]"]
];

export type SanitizeOptions = {
  maxStringLength?: number;
};

export type PayloadSizeResult = {
  ok: boolean;
  bytes: number;
};

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);

  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.startsWith("authorization") ||
    normalized.startsWith("cookie") ||
    normalized.startsWith("password") ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("password") ||
    normalized.includes("apikey") ||
    normalized.includes("secretkey") ||
    normalized.includes("privatekey")
  );
}

function sanitizeText(value: string, key: string, maxStringLength: number): string {
  const truncated = value.length > maxStringLength ? value.slice(0, maxStringLength) : value;

  if (!TEXT_PREVIEW_KEYS.has(key)) {
    return truncated;
  }

  return PREVIEW_CREDENTIAL_PATTERNS.reduce(
    (sanitized, [pattern, replacement]) => sanitized.replace(pattern, replacement),
    truncated
  );
}

function sanitizeValue(value: unknown, key: string, maxStringLength: number): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, key, maxStringLength));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      output[nestedKey] = isSensitiveKey(nestedKey)
        ? "[REDACTED]"
        : sanitizeValue(nestedValue, nestedKey, maxStringLength);
    }
    return output;
  }

  if (typeof value === "string") {
    return sanitizeText(value, key, maxStringLength);
  }

  return value;
}

export function sanitizePayload<T extends Record<string, unknown>>(payload: T, options: SanitizeOptions = {}): T {
  return sanitizeValue(payload, "", options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH) as T;
}

export function enforcePayloadSize(payload: Record<string, unknown>, maxBytes: number): PayloadSizeResult {
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");

  return {
    ok: bytes <= maxBytes,
    bytes
  };
}
```

- [ ] **Step 4: Run sanitization tests**

Run:

```bash
pnpm test packages/sdk/test/sanitize.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit sanitization**

```bash
git add packages/sdk/src/sanitize.ts packages/sdk/test/sanitize.test.ts
git commit -m "feat: add sdk payload sanitization"
```

---

### Task 4: Add FIFO Queue

**Files:**
- Create: `packages/sdk/src/queue.ts`
- Create: `packages/sdk/test/queue.test.ts`

- [ ] **Step 1: Write queue tests**

Create `packages/sdk/test/queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSignalQueue } from "../src/queue.js";
import type { QueuedSignal } from "../src/types.js";

const event = (name: string): QueuedSignal => ({
  kind: "event",
  endpointPath: "/v1/events",
  payload: { name, metadata: {}, properties: {} }
});

describe("sdk queue", () => {
  it("drains items in FIFO order", () => {
    const queue = createSignalQueue(10);

    queue.enqueue(event("one"));
    queue.enqueue(event("two"));

    expect(queue.drain()).toEqual([event("one"), event("two")]);
    expect(queue.size()).toBe(0);
  });

  it("drops oldest items when max size is exceeded", () => {
    const queue = createSignalQueue(2);

    expect(queue.enqueue(event("one"))).toEqual({ dropped: undefined });
    expect(queue.enqueue(event("two"))).toEqual({ dropped: undefined });
    expect(queue.enqueue(event("three"))).toEqual({ dropped: event("one") });

    expect(queue.dropped()).toBe(1);
    expect(queue.drain()).toEqual([event("two"), event("three")]);
  });

  it("can restore retained items to the front of the queue", () => {
    const queue = createSignalQueue(10);

    queue.enqueue(event("three"));
    queue.requeueFront([event("one"), event("two")]);

    expect(queue.drain()).toEqual([event("one"), event("two"), event("three")]);
  });

  it("returns and resets the dropped count", () => {
    const queue = createSignalQueue(1);

    queue.enqueue(event("one"));
    queue.enqueue(event("two"));

    expect(queue.consumeDropped()).toBe(1);
    expect(queue.consumeDropped()).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test packages/sdk/test/queue.test.ts
```

Expected: FAIL because `packages/sdk/src/queue.ts` does not exist.

- [ ] **Step 3: Implement queue**

Create `packages/sdk/src/queue.ts`:

```ts
import type { QueuedSignal } from "./types.js";

export type SignalQueue = {
  enqueue: (item: QueuedSignal) => { dropped?: QueuedSignal };
  drain: () => QueuedSignal[];
  requeueFront: (items: QueuedSignal[]) => void;
  size: () => number;
  dropped: () => number;
  consumeDropped: () => number;
};

export function createSignalQueue(maxSize: number): SignalQueue {
  const items: QueuedSignal[] = [];
  let droppedCount = 0;

  return {
    enqueue(item) {
      let dropped: QueuedSignal | undefined;

      if (items.length >= maxSize) {
        dropped = items.shift();
        droppedCount += 1;
      }

      items.push(item);
      return { dropped };
    },
    drain() {
      return items.splice(0, items.length);
    },
    requeueFront(retained) {
      items.unshift(...retained);
      while (items.length > maxSize) {
        items.pop();
        droppedCount += 1;
      }
    },
    size() {
      return items.length;
    },
    dropped() {
      return droppedCount;
    },
    consumeDropped() {
      const value = droppedCount;
      droppedCount = 0;
      return value;
    }
  };
}
```

- [ ] **Step 4: Run queue tests**

Run:

```bash
pnpm test packages/sdk/test/queue.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit queue**

```bash
git add packages/sdk/src/queue.ts packages/sdk/test/queue.test.ts
git commit -m "feat: add sdk telemetry queue"
```

---

### Task 5: Add Retry and HTTP Sending

**Files:**
- Create: `packages/sdk/src/retry.ts`
- Create: `packages/sdk/test/retry.test.ts`

- [ ] **Step 1: Write retry tests**

Create `packages/sdk/test/retry.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { classifyStatus, createRetryDelay, sendSignal } from "../src/retry.js";

describe("sdk retry", () => {
  it("classifies retryable and permanent statuses", () => {
    expect(classifyStatus(202)).toBe("success");
    expect(classifyStatus(408)).toBe("retryable");
    expect(classifyStatus(429)).toBe("retryable");
    expect(classifyStatus(500)).toBe("retryable");
    expect(classifyStatus(503)).toBe("retryable");
    expect(classifyStatus(400)).toBe("permanent");
    expect(classifyStatus(401)).toBe("permanent");
    expect(classifyStatus(403)).toBe("permanent");
    expect(classifyStatus(404)).toBe("permanent");
  });

  it("uses bounded exponential backoff", () => {
    expect(createRetryDelay(0, 250)).toBe(250);
    expect(createRetryDelay(1, 250)).toBe(500);
    expect(createRetryDelay(2, 250)).toBe(1000);
  });

  it("sends authorization and JSON body to the signal endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true, id: "evt_1" }), {
      status: 202,
      headers: { "content-type": "application/json" }
    }));

    const result = await sendSignal({
      endpoint: "https://signal.example.com",
      apiKey: "sh_secret",
      fetchImpl: fetchMock,
      requestTimeoutMs: 1000,
      maxRetries: 0,
      retryBaseDelayMs: 1,
      signal: {
        kind: "event",
        endpointPath: "/v1/events",
        payload: { name: "dashboard_created", metadata: {}, properties: {} }
      }
    });

    expect(result).toEqual({ ok: true, status: 202 });
    expect(fetchMock).toHaveBeenCalledWith("https://signal.example.com/v1/events", {
      method: "POST",
      headers: {
        authorization: "Bearer sh_secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({ name: "dashboard_created", metadata: {}, properties: {} }),
      signal: expect.any(AbortSignal)
    });
  });

  it("retries transient failures and returns success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true, id: "evt_1" }), { status: 202 }));

    const result = await sendSignal({
      endpoint: "https://signal.example.com",
      apiKey: "sh_secret",
      fetchImpl: fetchMock,
      requestTimeoutMs: 1000,
      maxRetries: 1,
      retryBaseDelayMs: 1,
      signal: {
        kind: "event",
        endpointPath: "/v1/events",
        payload: { name: "dashboard_created", metadata: {}, properties: {} }
      }
    });

    expect(result).toEqual({ ok: true, status: 202 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));

    const result = await sendSignal({
      endpoint: "https://signal.example.com",
      apiKey: "sh_secret",
      fetchImpl: fetchMock,
      requestTimeoutMs: 1000,
      maxRetries: 3,
      retryBaseDelayMs: 1,
      signal: {
        kind: "event",
        endpointPath: "/v1/events",
        payload: { name: "", metadata: {}, properties: {} }
      }
    });

    expect(result).toEqual({ ok: false, retryable: false, status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test packages/sdk/test/retry.test.ts
```

Expected: FAIL because `packages/sdk/src/retry.ts` does not exist.

- [ ] **Step 3: Implement retry and send behavior**

Create `packages/sdk/src/retry.ts`:

```ts
import type { QueuedSignal } from "./types.js";

export type StatusClassification = "success" | "retryable" | "permanent";

export type SendSignalInput = {
  endpoint: string;
  apiKey: string;
  fetchImpl: typeof fetch;
  requestTimeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  signal: QueuedSignal;
};

export type SendSignalResult =
  | { ok: true; status: number }
  | { ok: false; retryable: boolean; status?: number; error?: unknown };

export function classifyStatus(status: number): StatusClassification {
  if (status >= 200 && status < 300) {
    return "success";
  }

  if (status === 408 || status === 429 || status >= 500) {
    return "retryable";
  }

  return "permanent";
}

export function createRetryDelay(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** attempt;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function joinUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\\/+$/, "")}${path}`;
}

export async function sendSignal(input: SendSignalInput): Promise<SendSignalResult> {
  for (let attempt = 0; attempt <= input.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.requestTimeoutMs);

    try {
      const response = await input.fetchImpl(joinUrl(input.endpoint, input.signal.endpointPath), {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(input.signal.payload),
        signal: controller.signal
      });

      const classification = classifyStatus(response.status);
      if (classification === "success") {
        return { ok: true, status: response.status };
      }

      if (classification === "permanent") {
        return { ok: false, retryable: false, status: response.status };
      }

      if (attempt === input.maxRetries) {
        return { ok: false, retryable: true, status: response.status };
      }
    } catch (error) {
      if (attempt === input.maxRetries) {
        return { ok: false, retryable: true, error };
      }
    } finally {
      clearTimeout(timeout);
    }

    await sleep(createRetryDelay(attempt, input.retryBaseDelayMs));
  }

  return { ok: false, retryable: true };
}
```

- [ ] **Step 4: Run retry tests**

Run:

```bash
pnpm test packages/sdk/test/retry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit retry/send behavior**

```bash
git add packages/sdk/src/retry.ts packages/sdk/test/retry.test.ts
git commit -m "feat: add sdk retrying sender"
```

---

### Task 6: Add Public Client

**Files:**
- Create: `packages/sdk/src/client.ts`
- Create: `packages/sdk/test/client.test.ts`
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: Write client tests**

Create `packages/sdk/test/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createSignalHubClient } from "../src/client.js";

describe("sdk client", () => {
  it("rejects missing endpoint and api key", () => {
    expect(() => createSignalHubClient({ endpoint: "", apiKey: "sh_secret" })).toThrow("endpoint is required");
    expect(() => createSignalHubClient({ endpoint: "https://signal.example.com", apiKey: "" })).toThrow(
      "apiKey is required"
    );
  });

  it("tracks events and flushes them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true, id: "evt_1" }), {
      status: 202
    }));
    const signal = createSignalHubClient({
      endpoint: "https://signal.example.com/",
      apiKey: "sh_secret",
      fetch: fetchMock,
      defaultContext: { userId: "user_1" }
    });

    signal.track("dashboard_created", { charts_count: 6 });

    await expect(signal.flush()).resolves.toEqual({ sent: 1, failed: 0, retained: 0, dropped: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://signal.example.com/v1/events",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          user_id: "user_1",
          metadata: {},
          name: "dashboard_created",
          properties: { charts_count: 6 }
        })
      })
    );
  });

  it("retains transient failures by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    const signal = createSignalHubClient({
      endpoint: "https://signal.example.com",
      apiKey: "sh_secret",
      fetch: fetchMock,
      maxRetries: 0
    });

    signal.track("dashboard_created");

    await expect(signal.flush()).resolves.toEqual({ sent: 0, failed: 1, retained: 1, dropped: 0 });
    await expect(signal.flush({ discardOnFailure: true })).resolves.toEqual({
      sent: 0,
      failed: 1,
      retained: 0,
      dropped: 0
    });
  });

  it("removes permanent failures and calls onError", async () => {
    const onError = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    const signal = createSignalHubClient({
      endpoint: "https://signal.example.com",
      apiKey: "sh_secret",
      fetch: fetchMock,
      onError
    });

    signal.track("dashboard_created");

    await expect(signal.flush()).resolves.toEqual({ sent: 0, failed: 1, retained: 0, dropped: 0 });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "permanent_failure",
        status: 400,
        endpoint: "/v1/events"
      })
    );
  });

  it("reports queue overflow through onError and dropped flush count", async () => {
    const onError = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true, id: "evt_1" }), {
      status: 202
    }));
    const signal = createSignalHubClient({
      endpoint: "https://signal.example.com",
      apiKey: "sh_secret",
      fetch: fetchMock,
      maxQueueSize: 1,
      onError
    });

    signal.track("one");
    signal.track("two");

    await expect(signal.flush()).resolves.toEqual({ sent: 1, failed: 0, retained: 0, dropped: 1 });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "queue_overflow" }));
  });

  it("drops oversized payloads before enqueueing", async () => {
    const onError = vi.fn();
    const fetchMock = vi.fn();
    const signal = createSignalHubClient({
      endpoint: "https://signal.example.com",
      apiKey: "sh_secret",
      fetch: fetchMock,
      maxSerializedPayloadBytes: 10,
      onError
    });

    signal.track("dashboard_created", { value: "too-large" });

    await expect(signal.flush()).resolves.toEqual({ sent: 0, failed: 0, retained: 0, dropped: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "payload_too_large" }));
  });

  it("updates default context through identify", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true, id: "evt_1" }), {
      status: 202
    }));
    const signal = createSignalHubClient({
      endpoint: "https://signal.example.com",
      apiKey: "sh_secret",
      fetch: fetchMock,
      defaultContext: { userId: "user_1", metadata: { plan: "free" } }
    });

    signal.identify({ userId: "user_2", metadata: { plan: "pro" } });
    signal.track("dashboard_created");
    await signal.flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://signal.example.com/v1/events",
      expect.objectContaining({
        body: JSON.stringify({
          user_id: "user_2",
          metadata: { plan: "pro" },
          name: "dashboard_created",
          properties: {}
        })
      })
    );
  });

  it("creates trace helper and flushes trace on end", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true, id: "trc_1" }), {
      status: 202
    }));
    const signal = createSignalHubClient({
      endpoint: "https://signal.example.com",
      apiKey: "sh_secret",
      fetch: fetchMock
    });

    const trace = signal.startTrace("generate_dashboard", {
      startedAt: "2026-05-02T12:00:00.000Z",
      status: "success"
    });
    trace.end({ endedAt: "2026-05-02T12:00:01.000Z" });

    await expect(signal.flush()).resolves.toEqual({ sent: 1, failed: 0, retained: 0, dropped: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://signal.example.com/v1/traces",
      expect.objectContaining({
        body: expect.stringContaining("\"name\":\"generate_dashboard\"")
      })
    );
  });

  it("shutdown stops the interval and flushes pending items", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true, id: "evt_1" }), {
      status: 202
    }));
    const signal = createSignalHubClient({
      endpoint: "https://signal.example.com",
      apiKey: "sh_secret",
      fetch: fetchMock,
      flushIntervalMs: 1000
    });

    signal.track("dashboard_created");
    await expect(signal.shutdown()).resolves.toEqual({ sent: 1, failed: 0, retained: 0, dropped: 0 });

    vi.advanceTimersByTime(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test packages/sdk/test/client.test.ts
```

Expected: FAIL because `createSignalHubClient` is not implemented.

- [ ] **Step 3: Implement public client**

Create `packages/sdk/src/client.ts`:

```ts
import { nanoid } from "nanoid";
import {
  createErrorSignal,
  createEventSignal,
  createLlmSignal,
  createSpanSignal,
  createTraceSignal
} from "./mapping.js";
import { createSignalQueue } from "./queue.js";
import { sendSignal } from "./retry.js";
import { enforcePayloadSize, sanitizePayload } from "./sanitize.js";
import type {
  ActiveTrace,
  EndTraceInput,
  ErrorInput,
  EventInput,
  FlushOptions,
  FlushResult,
  LlmInput,
  QueuedSignal,
  SignalContext,
  SignalHubClient,
  SignalHubClientOptions,
  SignalHubError,
  SpanInput,
  StartTraceInput,
  TraceInput
} from "./types.js";
import {
  DEFAULT_MAX_QUEUE_SIZE,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_SERIALIZED_PAYLOAD_BYTES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RETRY_BASE_DELAY_MS
} from "./types.js";

type RuntimeOptions = Required<
  Pick<
    SignalHubClientOptions,
    "maxQueueSize" | "requestTimeoutMs" | "maxRetries" | "retryBaseDelayMs" | "maxSerializedPayloadBytes"
  >
> &
  Pick<SignalHubClientOptions, "flushIntervalMs" | "onError"> & {
    endpoint: string;
    apiKey: string;
    fetchImpl: typeof fetch;
  };

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\\/+$/, "");
}

function buildOptions(options: SignalHubClientOptions): RuntimeOptions {
  if (!options.endpoint) {
    throw new Error("endpoint is required");
  }

  if (!options.apiKey) {
    throw new Error("apiKey is required");
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("fetch is required");
  }

  return {
    endpoint: normalizeEndpoint(options.endpoint),
    apiKey: options.apiKey,
    fetchImpl,
    maxQueueSize: options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE,
    flushIntervalMs: options.flushIntervalMs,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    retryBaseDelayMs: options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    maxSerializedPayloadBytes: options.maxSerializedPayloadBytes ?? DEFAULT_MAX_SERIALIZED_PAYLOAD_BYTES,
    onError: options.onError
  };
}

export function createSignalHubClient(options: SignalHubClientOptions): SignalHubClient {
  const runtime = buildOptions(options);
  const queue = createSignalQueue(runtime.maxQueueSize);
  let defaultContext: SignalContext = options.defaultContext ?? {};
  let interval: ReturnType<typeof setInterval> | undefined;
  let flushing: Promise<FlushResult> | undefined;

  function report(error: SignalHubError): void {
    runtime.onError?.(error);
  }

  function enqueue(signal: QueuedSignal): void {
    const sanitized = {
      ...signal,
      payload: sanitizePayload(signal.payload)
    };
    const size = enforcePayloadSize(sanitized.payload, runtime.maxSerializedPayloadBytes);

    if (!size.ok) {
      report({
        code: "payload_too_large",
        message: `Payload is ${size.bytes} bytes and exceeds ${runtime.maxSerializedPayloadBytes} bytes`,
        endpoint: signal.endpointPath
      });
      queue.enqueue({
        kind: "event",
        endpointPath: "/v1/events",
        payload: { name: "dropped_payload_marker", metadata: {}, properties: {} }
      });
      queue.drain();
      return;
    }

    const result = queue.enqueue(sanitized);
    if (result.dropped) {
      report({
        code: "queue_overflow",
        message: "SDK queue exceeded maxQueueSize and dropped the oldest signal",
        endpoint: result.dropped.endpointPath
      });
    }
  }

  async function performFlush(flushOptions: FlushOptions = {}): Promise<FlushResult> {
    const dropped = queue.consumeDropped();
    const items = queue.drain();
    const retained: QueuedSignal[] = [];
    let sent = 0;
    let failed = 0;

    for (const item of items) {
      const result = await sendSignal({
        endpoint: runtime.endpoint,
        apiKey: runtime.apiKey,
        fetchImpl: runtime.fetchImpl,
        requestTimeoutMs: runtime.requestTimeoutMs,
        maxRetries: runtime.maxRetries,
        retryBaseDelayMs: runtime.retryBaseDelayMs,
        signal: item
      });

      if (result.ok) {
        sent += 1;
        continue;
      }

      failed += 1;

      if (result.retryable && !flushOptions.discardOnFailure) {
        retained.push(item);
        report({
          code: "transient_failure",
          message: "Signal delivery failed with a retryable error",
          status: result.status,
          endpoint: item.endpointPath
        });
        continue;
      }

      report({
        code: result.retryable ? "transient_failure" : "permanent_failure",
        message: result.retryable
          ? "Signal delivery failed and was discarded"
          : "Signal delivery failed with a permanent error",
        status: result.status,
        endpoint: item.endpointPath
      });
    }

    if (retained.length > 0) {
      queue.requeueFront(retained);
    }

    return {
      sent,
      failed,
      retained: retained.length,
      dropped
    };
  }

  function flush(flushOptions?: FlushOptions): Promise<FlushResult> {
    if (!flushing) {
      flushing = performFlush(flushOptions).finally(() => {
        flushing = undefined;
      });
    }

    return flushing;
  }

  if (runtime.flushIntervalMs !== undefined) {
    interval = setInterval(() => {
      void flush();
    }, runtime.flushIntervalMs);
  }

  return {
    track(name: string, properties = {}, context?: SignalContext & EventInput) {
      enqueue(createEventSignal(name, properties, context, defaultContext));
    },
    captureError(error: unknown, input?: ErrorInput) {
      enqueue(createErrorSignal(error, input, defaultContext));
    },
    llm(input: LlmInput, context?: SignalContext) {
      enqueue(createLlmSignal(input, context, defaultContext));
    },
    trace(input: TraceInput, context?: SignalContext) {
      enqueue(createTraceSignal(input, context, defaultContext));
    },
    startTrace(name: string, input: StartTraceInput & SignalContext = {}): ActiveTrace {
      const traceId = input.traceId ?? `trc_${nanoid()}`;
      const startedAt = input.startedAt instanceof Date ? input.startedAt : new Date(input.startedAt ?? Date.now());
      const { tenantId, userId, sessionId, source, release, metadata, ...traceInput } = input;
      const context = { tenantId, userId, sessionId, traceId, source, release, metadata };

      return {
        traceId,
        startedAt,
        end(endInput: EndTraceInput = {}, endContext?: SignalContext) {
          enqueue(
            createTraceSignal(
              {
                ...traceInput,
                ...endInput,
                name,
                startedAt,
                endedAt: endInput.endedAt ?? new Date(),
                status: endInput.status ?? traceInput.status ?? "success"
              },
              { ...context, ...endContext, traceId },
              defaultContext
            )
          );
        }
      };
    },
    span(input: SpanInput, context?: SignalContext) {
      enqueue(createSpanSignal(input, context, defaultContext));
    },
    identify(context: SignalContext) {
      defaultContext = {
        ...defaultContext,
        ...context,
        metadata: {
          ...(defaultContext.metadata ?? {}),
          ...(context.metadata ?? {})
        }
      };
    },
    flush,
    async shutdown(flushOptions?: FlushOptions) {
      if (interval) {
        clearInterval(interval);
        interval = undefined;
      }

      return flush(flushOptions);
    }
  };
}
```

- [ ] **Step 4: Fix oversized drop accounting**

Replace the oversized-payload branch inside `enqueue()` in `packages/sdk/src/client.ts` with an explicit local dropped counter:

```ts
  let localDropped = 0;

  function enqueue(signal: QueuedSignal): void {
    const sanitized = {
      ...signal,
      payload: sanitizePayload(signal.payload)
    };
    const size = enforcePayloadSize(sanitized.payload, runtime.maxSerializedPayloadBytes);

    if (!size.ok) {
      localDropped += 1;
      report({
        code: "payload_too_large",
        message: `Payload is ${size.bytes} bytes and exceeds ${runtime.maxSerializedPayloadBytes} bytes`,
        endpoint: signal.endpointPath
      });
      return;
    }

    const result = queue.enqueue(sanitized);
    if (result.dropped) {
      report({
        code: "queue_overflow",
        message: "SDK queue exceeded maxQueueSize and dropped the oldest signal",
        endpoint: result.dropped.endpointPath
      });
    }
  }
```

Then replace the first line of `performFlush()`:

```ts
    const dropped = queue.consumeDropped() + localDropped;
    localDropped = 0;
```

- [ ] **Step 5: Export public client**

Modify `packages/sdk/src/index.ts`:

```ts
export { createSignalHubClient } from "./client.js";
export {
  createErrorSignal,
  createEventSignal,
  createLlmSignal,
  createSpanSignal,
  createTraceSignal,
  mergeContext,
  serializeDate
} from "./mapping.js";

export type {
  ActiveTrace,
  EndTraceInput,
  ErrorInput,
  ErrorSeverity,
  EventInput,
  FlushOptions,
  FlushResult,
  JsonValue,
  LlmInput,
  SignalContext,
  SignalHubClient,
  SignalHubClientOptions,
  SignalHubError,
  SignalHubErrorCode,
  SignalMetadata,
  SignalStatus,
  SpanInput,
  StartTraceInput,
  TraceInput
} from "./types.js";
```

- [ ] **Step 6: Run client tests**

Run:

```bash
pnpm test packages/sdk/test/client.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit public client**

```bash
git add packages/sdk/src packages/sdk/test/client.test.ts
git commit -m "feat: add signal hub sdk client"
```

---

### Task 7: Add Contract Tests Against Existing Schemas

**Files:**
- Create: `packages/sdk/test/contract.test.ts`
- Modify: `packages/sdk/src/types.ts`

- [ ] **Step 1: Write contract tests**

Create `packages/sdk/test/contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  errorPayloadSchema,
  eventPayloadSchema,
  llmCallPayloadSchema,
  spanPayloadSchema,
  tracePayloadSchema
} from "@signal-hub/telemetry/ingestion-schemas";
import {
  createErrorSignal,
  createEventSignal,
  createLlmSignal,
  createSpanSignal,
  createTraceSignal
} from "../src/mapping.js";

describe("sdk ingestion contract", () => {
  it("creates event payloads accepted by the API schema", () => {
    expect(() =>
      eventPayloadSchema.parse(
        createEventSignal("dashboard_created", { charts_count: 6 }, {
          timestamp: "2026-05-02T12:00:00.000Z",
          tenantId: "tenant_1",
          userId: "user_1",
          metadata: { plan: "pro" }
        }).payload
      )
    ).not.toThrow();
  });

  it("creates error payloads accepted by the API schema", () => {
    expect(() =>
      errorPayloadSchema.parse(
        createErrorSignal(new Error("Database connection failed"), {
          severity: "critical",
          context: { retryable: false }
        }).payload
      )
    ).not.toThrow();
  });

  it("creates LLM payloads accepted by the API schema", () => {
    expect(() =>
      llmCallPayloadSchema.parse(
        createLlmSignal({
          provider: "openai",
          model: "gpt-5.5",
          promptName: "generate_sql",
          inputTokens: 100,
          outputTokens: 20,
          costUsd: 0.01,
          latencyMs: 800,
          status: "success"
        }).payload
      )
    ).not.toThrow();
  });

  it("creates trace payloads accepted by the API schema", () => {
    expect(() =>
      tracePayloadSchema.parse(
        createTraceSignal({
          name: "generate_dashboard",
          startedAt: "2026-05-02T12:00:00.000Z",
          endedAt: "2026-05-02T12:00:01.000Z",
          status: "success"
        }).payload
      )
    ).not.toThrow();
  });

  it("creates span payloads accepted by the API schema", () => {
    expect(() =>
      spanPayloadSchema.parse(
        createSpanSignal({
          traceId: "trace_1",
          parentSpanId: "span_1",
          name: "llm.generate",
          startedAt: "2026-05-02T12:00:00.000Z",
          endedAt: "2026-05-02T12:00:01.000Z",
          status: "success",
          input: { prompt: "x" },
          output: { text: "y" },
          costUsd: 0.01
        }).payload
      )
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run contract tests**

Run:

```bash
pnpm test packages/sdk/test/contract.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full SDK tests**

Run:

```bash
pnpm test packages/sdk/test
```

Expected: PASS for mapping, sanitization, queue, retry, client, and contract tests.

- [ ] **Step 4: Run SDK typecheck**

Run:

```bash
pnpm --filter @signal-hub/sdk build
```

Expected: PASS.

- [ ] **Step 5: Commit contract tests**

```bash
git add packages/sdk/test/contract.test.ts packages/sdk/src/types.ts
git commit -m "test: add sdk ingestion contract coverage"
```

---

### Task 8: Add HTTP Ingestion Guide

**Files:**
- Create: `docs/HTTP-INGESTION.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `.claude/docs/STACK.md`
- Modify: `.claude/docs/DECISIONS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Create HTTP guide**

Create `docs/HTTP-INGESTION.md`:

```md
# HTTP Ingestion Guide

SignalHub accepts telemetry through authenticated JSON requests. API keys are scoped to one project and one environment, so clients do not send project or environment identifiers in telemetry payloads.

## Base Request

```http
POST /v1/events HTTP/1.1
Host: signal.example.com
Authorization: Bearer sh_your_api_key
Content-Type: application/json
```

Successful ingestion returns:

```json
{
  "accepted": true,
  "id": "evt_..."
}
```

The API returns `202 Accepted` after validating the payload and enqueueing it for the worker.

## Endpoints

| Signal | Endpoint |
| --- | --- |
| Events | `POST /v1/events` |
| Errors | `POST /v1/errors` |
| LLM calls | `POST /v1/llm` |
| Traces | `POST /v1/traces` |
| Spans | `POST /v1/spans` |

## Shared Fields

All signal payloads may include:

```json
{
  "timestamp": "2026-05-02T12:00:00.000Z",
  "tenant_id": "tenant_123",
  "user_id": "user_456",
  "session_id": "session_789",
  "trace_id": "trace_abc",
  "source": "web",
  "release": "1.2.3",
  "metadata": {
    "plan": "pro"
  }
}
```

`metadata` must be a JSON object. Avoid sending secrets, credentials, tokens, cookies, raw prompts with private data, or full request headers.

## Events

```bash
curl -X POST https://signal.example.com/v1/events \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dashboard_created",
    "properties": {
      "charts_count": 6
    },
    "metadata": {
      "plan": "pro"
    }
  }'
```

Required fields:

- `name`

Optional fields:

- `properties`
- shared fields

## Errors

```bash
curl -X POST https://signal.example.com/v1/errors \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Database connection failed",
    "type": "DatabaseError",
    "severity": "critical",
    "fingerprint": "db-connection",
    "context": {
      "retryable": false
    },
    "metadata": {}
  }'
```

Required fields:

- `message`

Optional fields:

- `type`
- `severity`: `debug`, `info`, `warning`, `error`, or `critical`
- `stack`
- `fingerprint`
- `context`
- shared fields

## LLM Calls

```bash
curl -X POST https://signal.example.com/v1/llm \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "model": "gpt-5.5",
    "prompt_name": "generate_sql",
    "input_tokens": 120,
    "output_tokens": 30,
    "cost_usd": 0.02,
    "latency_ms": 900,
    "status": "success",
    "metadata": {}
  }'
```

Required fields:

- `provider`
- `model`

Optional fields:

- `prompt_name`
- `input_tokens`
- `output_tokens`
- `cost_usd`
- `latency_ms`
- `status`: `success`, `error`, or `pending`
- `error`
- `input_preview`
- `output_preview`
- shared fields

## Traces

```bash
curl -X POST https://signal.example.com/v1/traces \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "generate_dashboard",
    "status": "success",
    "started_at": "2026-05-02T12:00:00.000Z",
    "ended_at": "2026-05-02T12:00:01.000Z",
    "duration_ms": 1000,
    "metadata": {}
  }'
```

Required fields:

- `name`
- `started_at`

Optional fields:

- `status`: `success`, `error`, or `pending`
- `ended_at`
- `duration_ms`
- shared fields

## Spans

```bash
curl -X POST https://signal.example.com/v1/spans \
  -H "Authorization: Bearer sh_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "trace_id": "trace_abc",
    "parent_span_id": "span_parent",
    "name": "llm.generate",
    "status": "success",
    "started_at": "2026-05-02T12:00:00.000Z",
    "ended_at": "2026-05-02T12:00:01.000Z",
    "duration_ms": 1000,
    "input": {
      "prompt_name": "generate_sql"
    },
    "output": {
      "rows": 12
    },
    "cost_usd": 0.01,
    "metadata": {}
  }'
```

Required fields:

- `trace_id`
- `name`
- `started_at`

Optional fields:

- `parent_span_id`
- `status`: `success`, `error`, or `pending`
- `ended_at`
- `duration_ms`
- `input`
- `output`
- `error`
- `cost_usd`
- shared fields

## Status Codes

| Status | Meaning | Retry |
| --- | --- | --- |
| `202` | Payload accepted and queued | No |
| `400` | Invalid JSON payload or schema validation error | No |
| `401` | Missing or invalid API key | No |
| `403` | Authenticated request is forbidden | No |
| `408` | Request timeout | Yes |
| `429` | Rate limited | Yes |
| `500`-`599` | Server, queue, or ingestion dependency unavailable | Yes |

Retry network failures, `408`, `429`, and `5xx` responses with bounded exponential backoff. Do not retry `400`, `401`, or `403` without changing the payload or credentials.
```

- [ ] **Step 2: Update project docs**

Update `.claude/docs/PROJECT-SUMMARY.md` to mention that Phase 2 adds a JavaScript SDK and raw HTTP guide for product integration.

Update `.claude/docs/STACK.md` to include:

```md
- `packages/sdk`: TypeScript SDK for sending telemetry to the existing ingestion API.
```

Update `.claude/docs/DECISIONS.md` with:

```md
## 2026-05-02: Phase 2 SDK sends one request per signal

Decision: The first JavaScript SDK targets the existing single-signal ingestion endpoints and does not add batch ingestion.

Rationale: This keeps Phase 2 installable and compatible with the completed self-hosted core. Buffered client flush and bounded retries improve product integration without changing backend storage or queue contracts.
```

Update `CLAUDE.md` so its package list and verification notes include `@signal-hub/sdk`.

- [ ] **Step 3: Run docs checks**

Run:

```bash
git diff --check
```

Expected: PASS with no whitespace errors.

- [ ] **Step 4: Commit docs**

```bash
git add docs/HTTP-INGESTION.md .claude/docs/PROJECT-SUMMARY.md .claude/docs/STACK.md .claude/docs/DECISIONS.md CLAUDE.md
git commit -m "docs: add http ingestion guide"
```

---

### Task 9: Final Verification

**Files:**
- Verify all files changed in Tasks 1-8.

- [ ] **Step 1: Run SDK tests**

Run:

```bash
pnpm test packages/sdk/test
```

Expected: all SDK tests pass.

- [ ] **Step 2: Run full test suite**

Run:

```bash
pnpm test
```

Expected: all existing API, worker, package, and SDK tests pass.

- [ ] **Step 3: Run full build**

Run:

```bash
pnpm build
```

Expected: all workspace package builds pass.

- [ ] **Step 4: Validate Docker Compose remains unchanged operationally**

Run:

```bash
docker compose config --quiet
```

Expected: command exits `0`.

- [ ] **Step 5: Check Git diff**

Run:

```bash
git status -sb
git diff --stat
git diff --check
```

Expected:

- SDK package files are present.
- HTTP guide and project docs are updated.
- No backend route, database, worker, or Docker Compose behavior changed.
- `git diff --check` exits `0`.

- [ ] **Step 6: Commit final verification notes if docs changed during verification**

If verification reveals a necessary documentation correction, commit only that correction:

```bash
git add <corrected-doc-file>
git commit -m "docs: clarify sdk integration notes"
```

---

## Self-Review Checklist

- Spec coverage:
  - Public SDK constructor and methods: Task 6.
  - Client options and defaults: Tasks 1 and 6.
  - Context merge and camelCase-to-snake_case mapping: Task 2.
  - Events, errors, LLM calls, traces, and spans: Tasks 2, 6, and 7.
  - FIFO queue, drop-oldest overflow, dropped counts: Task 4 and Task 6.
  - `flush()` summaries, retained retryable failures, discard-on-failure: Task 6.
  - Bounded retries for network, timeout, `408`, `429`, and `5xx`: Task 5.
  - Permanent failure behavior for `400`, `401`, `403`, and other `4xx`: Task 5 and Task 6.
  - Best-effort client sanitization and payload-size enforcement: Task 3 and Task 6.
  - HTTP ingestion guide: Task 8.
  - No backend API changes: Task 9 verification.
- Red-flag scan:
  - No unresolved implementation gaps are intentionally left in this plan.
- Type consistency:
  - Public types in `types.ts` match client method signatures and mapping helpers.
  - Internal `QueuedSignal` shape matches queue, retry, mapping, and client modules.
  - Existing ingestion schema field names are preserved exactly.
