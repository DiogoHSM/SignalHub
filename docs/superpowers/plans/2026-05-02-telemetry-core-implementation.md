# Phase 1 Telemetry Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 self-hosted Signal Hub telemetry core: local human auth, admin-managed projects/environments/API keys, queued ingestion for events/errors/LLM/traces/spans, Postgres persistence, raw query endpoints, basic aggregates, and Docker Compose operation.

**Architecture:** Create a greenfield TypeScript monorepo with one Fastify API service and one BullMQ worker service. Postgres is the source of truth for users, admin resources, and typed telemetry tables; Redis provides durable ingestion queue handoff. The API validates/authenticates requests and enqueues telemetry, while the worker sanitizes and persists typed records.

**Tech Stack:** Node.js, TypeScript, pnpm workspaces, Fastify, Zod, PostgreSQL, Kysely, Redis, BullMQ, Vitest, Testcontainers, Docker Compose.

---

## Scope Notes

This plan implements the approved design spec at `docs/superpowers/specs/2026-05-02-telemetry-core-design.md`.

Out of scope for this plan:

- Signal Console frontend.
- ClickHouse.
- Object storage.
- Stored logs pipeline.
- SaaS organizations/workspaces.
- Per-project RBAC.
- Automated retention deletion.

## File Structure

Create this structure:

```txt
.
├── .env.example
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── apps
│   ├── api
│   │   ├── package.json
│   │   ├── src
│   │   │   ├── app.ts
│   │   │   ├── main.ts
│   │   │   ├── routes
│   │   │   │   ├── admin.ts
│   │   │   │   ├── auth.ts
│   │   │   │   ├── health.ts
│   │   │   │   ├── ingestion.ts
│   │   │   │   └── query.ts
│   │   │   └── plugins
│   │   │       └── request-context.ts
│   │   └── test
│   │       ├── admin.test.ts
│   │       ├── auth.test.ts
│   │       ├── e2e.test.ts
│   │       ├── health.test.ts
│   │       ├── ingestion.test.ts
│   │       └── query.test.ts
│   └── worker
│       ├── package.json
│       ├── src
│       │   ├── main.ts
│       │   └── telemetry-worker.ts
│       └── test
│           └── telemetry-worker.test.ts
├── packages
│   ├── config
│   │   ├── package.json
│   │   ├── src
│   │   │   └── index.ts
│   │   └── test
│   │       └── config.test.ts
│   ├── db
│   │   ├── package.json
│   │   ├── migrations
│   │   │   └── 0001_initial.sql
│   │   ├── src
│   │   │   ├── client.ts
│   │   │   ├── migrate.ts
│   │   │   ├── schema.ts
│   │   │   └── repositories
│   │   │       ├── admin.ts
│   │   │       ├── telemetry-query.ts
│   │   │       ├── telemetry-writes.ts
│   │   │       └── users.ts
│   │   └── test
│   │       └── repositories.test.ts
│   ├── queues
│   │   ├── package.json
│   │   ├── src
│   │   │   └── telemetry-queue.ts
│   │   └── test
│   │       └── telemetry-queue.test.ts
│   └── telemetry
│       ├── package.json
│       ├── src
│       │   ├── api-keys.ts
│       │   ├── auth.ts
│       │   ├── ids.ts
│       │   ├── ingestion-schemas.ts
│       │   ├── sanitization.ts
│       │   └── types.ts
│       └── test
│           ├── api-keys.test.ts
│           ├── auth.test.ts
│           ├── ingestion-schemas.test.ts
│           └── sanitization.test.ts
└── scripts
    ├── migrate.ts
    └── seed-admin.ts
```

Boundaries:

- `packages/telemetry`: pure functions and shared schemas; no database or network access.
- `packages/config`: environment parsing and startup safety checks.
- `packages/db`: Kysely schema, migrations, and repositories.
- `packages/queues`: BullMQ queue definitions and enqueue helpers.
- `apps/api`: Fastify app and HTTP routes only.
- `apps/worker`: queue processors and worker runtime.

## Task 1: Workspace Scaffold

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `apps/api/package.json`
- Create: `apps/worker/package.json`
- Create: `packages/config/package.json`
- Create: `packages/db/package.json`
- Create: `packages/queues/package.json`
- Create: `packages/telemetry/package.json`

- [ ] **Step 1: Create workspace and package files**

Create the files with this content:

`package.json`

```json
{
  "name": "signal-hub",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.4",
  "scripts": {
    "build": "pnpm -r build",
    "dev:api": "pnpm --filter @signal-hub/api dev",
    "dev:worker": "pnpm --filter @signal-hub/worker dev",
    "lint": "pnpm -r lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "tsx scripts/migrate.ts",
    "seed:admin": "tsx scripts/seed-admin.ts"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

`pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "baseUrl": ".",
    "paths": {
      "@signal-hub/config": ["packages/config/src/index.ts"],
      "@signal-hub/db": ["packages/db/src/client.ts"],
      "@signal-hub/db/*": ["packages/db/src/*"],
      "@signal-hub/queues": ["packages/queues/src/telemetry-queue.ts"],
      "@signal-hub/telemetry": ["packages/telemetry/src/types.ts"],
      "@signal-hub/telemetry/*": ["packages/telemetry/src/*"]
    }
  }
}
```

`vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    testTimeout: 30_000
  },
  resolve: {
    alias: {
      "@signal-hub/config": "/packages/config/src/index.ts",
      "@signal-hub/db": "/packages/db/src/client.ts",
      "@signal-hub/db/": "/packages/db/src/",
      "@signal-hub/queues": "/packages/queues/src/telemetry-queue.ts",
      "@signal-hub/telemetry": "/packages/telemetry/src/types.ts",
      "@signal-hub/telemetry/": "/packages/telemetry/src/"
    }
  }
});
```

`.env.example`

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://signalhub:signalhub@localhost:5432/signalhub
REDIS_URL=redis://localhost:6379
SESSION_SECRET=change-me-to-a-long-random-secret
API_KEY_PEPPER=change-me-to-a-long-random-pepper
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=change-me-admin-password
GOOGLE_OAUTH_ENABLED=false
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

Each package `package.json` should use these names and scripts:

```json
{
  "name": "@signal-hub/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "dev": "tsx watch src/main.ts",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {}
}
```

Use package names `@signal-hub/api`, `@signal-hub/worker`, `@signal-hub/config`, `@signal-hub/db`, `@signal-hub/queues`, and `@signal-hub/telemetry`. Add a `tsconfig.json` beside each package file:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

For packages under `packages/*`, use `"extends": "../../tsconfig.base.json"`. For apps under `apps/*`, use the same relative path.

- [ ] **Step 2: Install dependencies**

Run:

```bash
pnpm install
pnpm add fastify @fastify/cookie @fastify/cors @fastify/rate-limit @fastify/session zod kysely pg ioredis bullmq argon2 nanoid jose
pnpm add -D @types/pg testcontainers
```

Expected: packages install and `pnpm-lock.yaml` is created.

- [ ] **Step 3: Verify empty workspace scripts**

Run:

```bash
pnpm test
pnpm build
```

Expected: `pnpm test` exits successfully after the first package test file exists; `pnpm build` exits successfully after package `tsconfig.json` files are present.

- [ ] **Step 4: Commit scaffold**

Run:

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.config.ts .env.example apps packages
git commit -m "chore: scaffold telemetry core workspace"
```

## Task 2: Configuration and Startup Safety

**Files:**

- Create: `packages/config/src/index.ts`
- Create: `packages/config/test/config.test.ts`

- [ ] **Step 1: Write failing config tests**

`packages/config/test/config.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/index";

describe("loadConfig", () => {
  it("parses required runtime configuration", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "4000",
      DATABASE_URL: "postgres://user:pass@localhost:5432/signalhub",
      REDIS_URL: "redis://localhost:6379",
      SESSION_SECRET: "a-secure-session-secret-with-enough-length",
      API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple",
      GOOGLE_OAUTH_ENABLED: "false"
    });

    expect(config.port).toBe(4000);
    expect(config.googleOAuth.enabled).toBe(false);
  });

  it("rejects weak secrets outside test", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        PORT: "3000",
        DATABASE_URL: "postgres://user:pass@localhost:5432/signalhub",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "short",
        API_KEY_PEPPER: "short",
        BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
        BOOTSTRAP_ADMIN_PASSWORD: "short",
        GOOGLE_OAUTH_ENABLED: "false"
      })
    ).toThrow(/must be at least 32 characters/);
  });

  it("requires Google OAuth settings when enabled", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        PORT: "3000",
        DATABASE_URL: "postgres://user:pass@localhost:5432/signalhub",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a-secure-session-secret-with-enough-length",
        API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
        BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
        BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple",
        GOOGLE_OAUTH_ENABLED: "true"
      })
    ).toThrow(/GOOGLE_CLIENT_ID/);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm test packages/config/test/config.test.ts
```

Expected: FAIL because `packages/config/src/index.ts` does not exist.

- [ ] **Step 3: Implement config parser**

`packages/config/src/index.ts`

```ts
import { z } from "zod";

const rawConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string(),
  API_KEY_PEPPER: z.string(),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string(),
  GOOGLE_OAUTH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional()
});

export type AppConfig = ReturnType<typeof loadConfig>;

function requireStrongSecret(name: string, value: string, nodeEnv: string): void {
  if (nodeEnv !== "test" && value.length < 32) {
    throw new Error(`${name} must be at least 32 characters`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = rawConfigSchema.parse(env);

  requireStrongSecret("SESSION_SECRET", parsed.SESSION_SECRET, parsed.NODE_ENV);
  requireStrongSecret("API_KEY_PEPPER", parsed.API_KEY_PEPPER, parsed.NODE_ENV);
  requireStrongSecret("BOOTSTRAP_ADMIN_PASSWORD", parsed.BOOTSTRAP_ADMIN_PASSWORD, parsed.NODE_ENV);

  if (parsed.GOOGLE_OAUTH_ENABLED) {
    if (!parsed.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID is required when Google OAuth is enabled");
    if (!parsed.GOOGLE_CLIENT_SECRET) throw new Error("GOOGLE_CLIENT_SECRET is required when Google OAuth is enabled");
    if (!parsed.GOOGLE_REDIRECT_URI) throw new Error("GOOGLE_REDIRECT_URI is required when Google OAuth is enabled");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    sessionSecret: parsed.SESSION_SECRET,
    apiKeyPepper: parsed.API_KEY_PEPPER,
    bootstrapAdmin: {
      email: parsed.BOOTSTRAP_ADMIN_EMAIL,
      password: parsed.BOOTSTRAP_ADMIN_PASSWORD
    },
    googleOAuth: {
      enabled: parsed.GOOGLE_OAUTH_ENABLED,
      clientId: parsed.GOOGLE_CLIENT_ID ?? "",
      clientSecret: parsed.GOOGLE_CLIENT_SECRET ?? "",
      redirectUri: parsed.GOOGLE_REDIRECT_URI ?? ""
    }
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm test packages/config/test/config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit config**

Run:

```bash
git add packages/config
git commit -m "feat: add runtime configuration checks"
```

## Task 3: Shared Telemetry Schemas and Sanitization

**Files:**

- Create: `packages/telemetry/src/types.ts`
- Create: `packages/telemetry/src/ids.ts`
- Create: `packages/telemetry/src/ingestion-schemas.ts`
- Create: `packages/telemetry/src/sanitization.ts`
- Create: `packages/telemetry/test/ingestion-schemas.test.ts`
- Create: `packages/telemetry/test/sanitization.test.ts`

- [ ] **Step 1: Write failing schema and sanitization tests**

`packages/telemetry/test/ingestion-schemas.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { eventPayloadSchema, llmCallPayloadSchema, spanPayloadSchema } from "../src/ingestion-schemas";

describe("ingestion schemas", () => {
  it("accepts a product event payload with shared metadata", () => {
    const parsed = eventPayloadSchema.parse({
      name: "dashboard_created",
      timestamp: "2026-05-02T12:00:00.000Z",
      tenant_id: "tenant_1",
      user_id: "user_1",
      session_id: "session_1",
      trace_id: "trace_1",
      source: "web",
      release: "1.2.3",
      properties: { charts_count: 6 },
      metadata: { plan: "pro" }
    });

    expect(parsed.name).toBe("dashboard_created");
    expect(parsed.properties.charts_count).toBe(6);
  });

  it("rejects an LLM call without provider", () => {
    expect(() =>
      llmCallPayloadSchema.parse({
        model: "gpt-5.5",
        prompt_name: "generate_sql",
        input_tokens: 1200,
        output_tokens: 300,
        cost_usd: 0.03,
        latency_ms: 8400,
        status: "success"
      })
    ).toThrow();
  });

  it("accepts spans with parent span references", () => {
    const parsed = spanPayloadSchema.parse({
      trace_id: "trace_1",
      parent_span_id: "span_parent",
      name: "ai.generate_sql",
      status: "success",
      started_at: "2026-05-02T12:00:00.000Z",
      ended_at: "2026-05-02T12:00:02.000Z",
      duration_ms: 2000
    });

    expect(parsed.parent_span_id).toBe("span_parent");
  });
});
```

`packages/telemetry/test/sanitization.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { sanitizeValue } from "../src/sanitization";

describe("sanitizeValue", () => {
  it("recursively masks sensitive object keys", () => {
    const sanitized = sanitizeValue({
      email: "user@example.com",
      password: "secret",
      nested: {
        authorization: "Bearer token",
        safe: "visible"
      },
      items: [{ api_key: "abc", count: 1 }]
    });

    expect(sanitized).toEqual({
      email: "user@example.com",
      password: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        safe: "visible"
      },
      items: [{ api_key: "[REDACTED]", count: 1 }]
    });
  });

  it("does not mutate the original object", () => {
    const original = { token: "secret" };
    const sanitized = sanitizeValue(original);

    expect(original.token).toBe("secret");
    expect(sanitized).toEqual({ token: "[REDACTED]" });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm test packages/telemetry/test/ingestion-schemas.test.ts packages/telemetry/test/sanitization.test.ts
```

Expected: FAIL because implementation files do not exist.

- [ ] **Step 3: Implement shared types, IDs, schemas, and sanitizer**

`packages/telemetry/src/types.ts`

```ts
export type SignalStatus = "success" | "error" | "pending";
export type ErrorStatus = "open" | "investigating" | "resolved" | "ignored";
export type ErrorSeverity = "debug" | "info" | "warning" | "error" | "critical";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
```

`packages/telemetry/src/ids.ts`

```ts
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 24);

export function createId(prefix: string): string {
  return `${prefix}_${nanoid()}`;
}
```

`packages/telemetry/src/ingestion-schemas.ts`

```ts
import { z } from "zod";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema)
  ])
);

const jsonObjectSchema = z.record(jsonValueSchema).default({});

const timestampSchema = z.string().datetime();

export const sharedEnvelopeSchema = z.object({
  timestamp: timestampSchema.optional(),
  tenant_id: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
  trace_id: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  release: z.string().min(1).optional(),
  metadata: jsonObjectSchema
});

export const eventPayloadSchema = sharedEnvelopeSchema.extend({
  name: z.string().min(1),
  properties: jsonObjectSchema
});

export const errorPayloadSchema = sharedEnvelopeSchema.extend({
  message: z.string().min(1),
  type: z.string().min(1).optional(),
  severity: z.enum(["debug", "info", "warning", "error", "critical"]).default("error"),
  stack: z.string().optional(),
  fingerprint: z.string().min(1).optional(),
  context: jsonObjectSchema
});

export const llmCallPayloadSchema = sharedEnvelopeSchema.extend({
  provider: z.string().min(1),
  model: z.string().min(1),
  prompt_name: z.string().min(1).optional(),
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  cost_usd: z.number().nonnegative().default(0),
  latency_ms: z.number().int().nonnegative().optional(),
  status: z.enum(["success", "error", "pending"]).default("success"),
  error: z.string().optional(),
  input_preview: z.string().optional(),
  output_preview: z.string().optional()
});

export const tracePayloadSchema = sharedEnvelopeSchema.extend({
  name: z.string().min(1),
  status: z.enum(["success", "error", "pending"]).default("pending"),
  started_at: timestampSchema,
  ended_at: timestampSchema.optional(),
  duration_ms: z.number().int().nonnegative().optional()
});

export const spanPayloadSchema = sharedEnvelopeSchema.extend({
  trace_id: z.string().min(1),
  parent_span_id: z.string().min(1).optional(),
  name: z.string().min(1),
  status: z.enum(["success", "error", "pending"]).default("pending"),
  started_at: timestampSchema,
  ended_at: timestampSchema.optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  input: jsonValueSchema.optional(),
  output: jsonValueSchema.optional(),
  error: jsonValueSchema.optional(),
  cost_usd: z.number().nonnegative().optional()
});

export type EventPayload = z.infer<typeof eventPayloadSchema>;
export type ErrorPayload = z.infer<typeof errorPayloadSchema>;
export type LlmCallPayload = z.infer<typeof llmCallPayloadSchema>;
export type TracePayload = z.infer<typeof tracePayloadSchema>;
export type SpanPayload = z.infer<typeof spanPayloadSchema>;
```

`packages/telemetry/src/sanitization.ts`

```ts
const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "authorization",
  "cookie",
  "secret",
  "api_key",
  "apikey",
  "cpf",
  "credit_card"
]);

export function sanitizeValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item)) as T;
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase();
      output[key] = SENSITIVE_KEYS.has(normalizedKey) ? "[REDACTED]" : sanitizeValue(nestedValue);
    }
    return output as T;
  }

  return value;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm test packages/telemetry/test/ingestion-schemas.test.ts packages/telemetry/test/sanitization.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit telemetry schemas**

Run:

```bash
git add packages/telemetry
git commit -m "feat: add telemetry schemas and sanitization"
```

## Task 4: Security Primitives for Passwords and API Keys

**Files:**

- Create: `packages/telemetry/src/auth.ts`
- Create: `packages/telemetry/src/api-keys.ts`
- Create: `packages/telemetry/test/auth.test.ts`
- Create: `packages/telemetry/test/api-keys.test.ts`

- [ ] **Step 1: Write failing security tests**

`packages/telemetry/test/auth.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth";

describe("password hashing", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");

    expect(hash).not.toContain("correct-horse-battery-staple");
    await expect(verifyPassword(hash, "correct-horse-battery-staple")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong-password")).resolves.toBe(false);
  });
});
```

`packages/telemetry/test/api-keys.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createApiKey, hashApiKey, verifyApiKey } from "../src/api-keys";

describe("API keys", () => {
  it("creates prefixed API keys and verifies hashed values", async () => {
    const apiKey = createApiKey();
    const hash = await hashApiKey(apiKey.secret, "pepper-value");

    expect(apiKey.secret).toMatch(/^sh_/);
    expect(apiKey.prefix).toBe(apiKey.secret.slice(0, 12));
    expect(hash).not.toContain(apiKey.secret);
    await expect(verifyApiKey(hash, apiKey.secret, "pepper-value")).resolves.toBe(true);
    await expect(verifyApiKey(hash, "sh_wrong", "pepper-value")).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm test packages/telemetry/test/auth.test.ts packages/telemetry/test/api-keys.test.ts
```

Expected: FAIL because implementation files do not exist.

- [ ] **Step 3: Implement password and API key helpers**

`packages/telemetry/src/auth.ts`

```ts
import argon2 from "argon2";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
```

`packages/telemetry/src/api-keys.ts`

```ts
import { createHash } from "node:crypto";
import { customAlphabet } from "nanoid";

const apiKeyId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 40);

export type CreatedApiKey = {
  secret: string;
  prefix: string;
};

export function createApiKey(): CreatedApiKey {
  const secret = `sh_${apiKeyId()}`;
  return {
    secret,
    prefix: secret.slice(0, 12)
  };
}

export async function hashApiKey(secret: string, pepper: string): Promise<string> {
  return createHash("sha256").update(`${pepper}:${secret}`).digest("hex");
}

export async function verifyApiKey(hash: string, secret: string, pepper: string): Promise<boolean> {
  const candidate = await hashApiKey(secret, pepper);
  return candidate === hash;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm test packages/telemetry/test/auth.test.ts packages/telemetry/test/api-keys.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit security primitives**

Run:

```bash
git add packages/telemetry/src/auth.ts packages/telemetry/src/api-keys.ts packages/telemetry/test/auth.test.ts packages/telemetry/test/api-keys.test.ts
git commit -m "feat: add auth and api key primitives"
```

## Task 5: Database Schema, Migration Runner, and Repositories

**Files:**

- Create: `packages/db/migrations/0001_initial.sql`
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/src/repositories/users.ts`
- Create: `packages/db/src/repositories/admin.ts`
- Create: `packages/db/src/repositories/telemetry-writes.ts`
- Create: `packages/db/src/repositories/telemetry-query.ts`
- Create: `packages/db/test/repositories.test.ts`
- Create: `scripts/migrate.ts`
- Create: `scripts/seed-admin.ts`

- [ ] **Step 1: Write failing repository tests**

`packages/db/test/repositories.test.ts`

```ts
import { PostgreSqlContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client";
import { migrate } from "../src/migrate";
import { createProject, createEnvironment, createApiKeyRecord } from "../src/repositories/admin";
import { createUser, findUserByEmail } from "../src/repositories/users";
import { insertEvent, insertLlmCall } from "../src/repositories/telemetry-writes";
import { listEvents, getLlmAggregates } from "../src/repositories/telemetry-query";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;

describe("repositories", () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("signalhub")
      .withUsername("signalhub")
      .withPassword("signalhub")
      .start();
  });

  afterAll(async () => {
    await container.stop();
  });

  it("creates admin resources and queries telemetry", async () => {
    const db = createDb(container.getConnectionUri());
    await migrate(db);

    const user = await createUser(db, {
      email: "admin@example.com",
      passwordHash: "hash",
      isAdmin: true
    });
    const foundUser = await findUserByEmail(db, "admin@example.com");
    expect(foundUser?.id).toBe(user.id);

    const project = await createProject(db, { name: "Demo API" });
    const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
    const apiKey = await createApiKeyRecord(db, {
      projectId: project.id,
      environmentId: environment.id,
      name: "prod key",
      prefix: "sh_abc123456",
      hash: "hash"
    });

    expect(apiKey.revokedAt).toBeNull();

    await insertEvent(db, {
      id: "evt_1",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-02T12:00:00.000Z"),
      receivedAt: new Date("2026-05-02T12:00:01.000Z"),
      name: "dashboard_created",
      tenantId: "tenant_1",
      userId: "user_1",
      sessionId: "session_1",
      traceId: "trace_1",
      source: "web",
      release: "1.0.0",
      metadata: { plan: "pro" },
      properties: { charts_count: 6 }
    });

    await insertLlmCall(db, {
      id: "llm_1",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-02T12:00:00.000Z"),
      receivedAt: new Date("2026-05-02T12:00:01.000Z"),
      tenantId: "tenant_1",
      userId: "user_1",
      provider: "openai",
      model: "gpt-5.5",
      promptName: "generate_sql",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: "0.030000",
      status: "success"
    });

    const events = await listEvents(db, { projectId: project.id, environmentId: environment.id });
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("dashboard_created");

    const llm = await getLlmAggregates(db, { projectId: project.id, environmentId: environment.id });
    expect(llm.totalCalls).toBe(1);
    expect(llm.totalInputTokens).toBe(100);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm test packages/db/test/repositories.test.ts
```

Expected: FAIL because database files do not exist.

- [ ] **Step 3: Implement migration SQL**

`packages/db/migrations/0001_initial.sql`

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text,
  google_subject text UNIQUE,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE environments (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE(project_id, name)
);

CREATE TABLE api_keys (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL REFERENCES environments(id),
  name text NOT NULL,
  prefix text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX api_keys_prefix_idx ON api_keys(prefix);

CREATE TABLE events (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL REFERENCES environments(id),
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  source text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}',
  name text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE errors (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL REFERENCES environments(id),
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  source text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}',
  message text NOT NULL,
  type text,
  severity text NOT NULL,
  stack text,
  status text NOT NULL DEFAULT 'open',
  fingerprint text,
  context jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE llm_calls (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL REFERENCES environments(id),
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  source text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}',
  provider text NOT NULL,
  model text NOT NULL,
  prompt_name text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(18, 6) NOT NULL DEFAULT 0,
  latency_ms integer,
  status text NOT NULL,
  error text,
  input_preview text,
  output_preview text
);

CREATE TABLE traces (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL REFERENCES environments(id),
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  source text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}',
  name text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_ms integer
);

CREATE TABLE spans (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL REFERENCES environments(id),
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text NOT NULL,
  timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  source text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}',
  parent_span_id text,
  name text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_ms integer,
  input jsonb,
  output jsonb,
  error jsonb,
  cost_usd numeric(18, 6)
);

CREATE TABLE dead_letter_jobs (
  id text PRIMARY KEY,
  queue_name text NOT NULL,
  job_name text NOT NULL,
  payload jsonb NOT NULL,
  error_message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_project_env_time_idx ON events(project_id, environment_id, timestamp DESC);
CREATE INDEX errors_project_env_time_idx ON errors(project_id, environment_id, timestamp DESC);
CREATE INDEX llm_calls_project_env_time_idx ON llm_calls(project_id, environment_id, timestamp DESC);
CREATE INDEX traces_project_env_time_idx ON traces(project_id, environment_id, timestamp DESC);
CREATE INDEX spans_trace_id_idx ON spans(trace_id);
```

- [ ] **Step 4: Implement DB client and repositories**

Implement `schema.ts` with Kysely table types matching the SQL columns. Implement:

- `createDb(databaseUrl: string)`
- `migrate(db)`
- `createUser`, `findUserByEmail`
- `createProject`, `createEnvironment`, `createApiKeyRecord`
- `insertEvent`, `insertLlmCall`, and matching insert helpers for errors/traces/spans
- `listEvents`, `getLlmAggregates`

Use `createId("usr")`, `createId("prj")`, `createId("env")`, and `createId("key")` for operational IDs.

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
pnpm test packages/db/test/repositories.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit DB foundation**

Run:

```bash
git add packages/db scripts/migrate.ts scripts/seed-admin.ts
git commit -m "feat: add database schema and repositories"
```

## Task 6: Queue Package

**Files:**

- Create: `packages/queues/src/telemetry-queue.ts`
- Create: `packages/queues/test/telemetry-queue.test.ts`

- [ ] **Step 1: Write failing queue tests**

`packages/queues/test/telemetry-queue.test.ts`

```ts
import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTelemetryQueue, enqueueTelemetryJob } from "../src/telemetry-queue";

let redis: Awaited<ReturnType<GenericContainer["start"]>>;

describe("telemetry queue", () => {
  beforeAll(async () => {
    redis = await new GenericContainer("redis:7-alpine")
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
      .start();
  });

  afterAll(async () => {
    await redis.stop();
  });

  it("enqueues telemetry jobs", async () => {
    const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    const queue = createTelemetryQueue(redisUrl);

    const job = await enqueueTelemetryJob(queue, {
      kind: "event",
      id: "evt_1",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: { name: "dashboard_created", metadata: {}, properties: {} }
    });

    expect(job.id).toBeDefined();
    expect(job.name).toBe("event");

    await queue.close();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm test packages/queues/test/telemetry-queue.test.ts
```

Expected: FAIL because queue files do not exist.

- [ ] **Step 3: Implement queue helpers**

`packages/queues/src/telemetry-queue.ts`

```ts
import { Queue } from "bullmq";
import IORedis from "ioredis";

export type TelemetryJobKind = "event" | "error" | "llm" | "trace" | "span";

export type TelemetryJobPayload = {
  kind: TelemetryJobKind;
  id: string;
  projectId: string;
  environmentId: string;
  payload: Record<string, unknown>;
};

export function createTelemetryQueue(redisUrl: string): Queue<TelemetryJobPayload> {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  return new Queue<TelemetryJobPayload>("telemetry", {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: false
    }
  });
}

export async function enqueueTelemetryJob(queue: Queue<TelemetryJobPayload>, payload: TelemetryJobPayload) {
  return queue.add(payload.kind, payload);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm test packages/queues/test/telemetry-queue.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit queue package**

Run:

```bash
git add packages/queues
git commit -m "feat: add telemetry queue"
```

## Task 7: Fastify App, Health, and Readiness

**Files:**

- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/test/health.test.ts`

- [ ] **Step 1: Write failing health tests**

`apps/api/test/health.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

describe("health routes", () => {
  it("returns liveness", async () => {
    const app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true })
    });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("returns readiness failures", async () => {
    const app = await buildApp({
      readiness: async () => ({ postgres: true, redis: false })
    });

    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false, checks: { postgres: true, redis: false } });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm test apps/api/test/health.test.ts
```

Expected: FAIL because app files do not exist.

- [ ] **Step 3: Implement Fastify app and health routes**

`apps/api/src/routes/health.ts`

```ts
import type { FastifyInstance } from "fastify";

export type ReadinessCheck = () => Promise<{ postgres: boolean; redis: boolean }>;

export async function registerHealthRoutes(app: FastifyInstance, readiness: ReadinessCheck) {
  app.get("/health", async () => ({ ok: true }));

  app.get("/ready", async (request, reply) => {
    const checks = await readiness();
    const ok = checks.postgres && checks.redis;
    return reply.code(ok ? 200 : 503).send({ ok, checks });
  });
}
```

`apps/api/src/app.ts`

```ts
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { registerHealthRoutes, type ReadinessCheck } from "./routes/health";

export type BuildAppOptions = {
  readiness: ReadinessCheck;
};

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
  await registerHealthRoutes(app, options.readiness);
  return app;
}
```

`apps/api/src/main.ts`

```ts
import { loadConfig } from "@signal-hub/config";
import { buildApp } from "./app";

const config = loadConfig();

const app = await buildApp({
  readiness: async () => ({ postgres: true, redis: true })
});

await app.listen({ port: config.port, host: "0.0.0.0" });
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm test apps/api/test/health.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Fastify foundation**

Run:

```bash
git add apps/api
git commit -m "feat: add api health routes"
```

## Task 8: Local Auth and User Administration

**Files:**

- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/routes/admin.ts`
- Create: `apps/api/src/plugins/request-context.ts`
- Create: `apps/api/test/auth.test.ts`
- Create: `apps/api/test/admin.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write failing auth and user admin tests**

`apps/api/test/auth.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

describe("auth routes", () => {
  it("logs in with local email and password", async () => {
    const app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: {
        login: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true }),
        findSessionUser: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true })
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin@example.com", password: "correct-horse-battery-staple" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: { id: "usr_1", email: "admin@example.com", isAdmin: true } });
  });
});
```

`apps/api/test/admin.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

describe("admin user routes", () => {
  it("rejects regular users from user management", async () => {
    const app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: {
        login: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false }),
        findSessionUser: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false })
      },
      users: {
        listUsers: async () => []
      }
    });

    const response = await app.inject({ method: "GET", url: "/admin/users" });

    expect(response.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm test apps/api/test/auth.test.ts apps/api/test/admin.test.ts
```

Expected: FAIL because auth/admin routes do not exist.

- [ ] **Step 3: Implement auth route interfaces and admin guard**

Implement `auth.ts` with:

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /auth/google`
- `GET /auth/google/callback`

Implement `admin.ts` with `GET /admin/users`, `POST /admin/users`, `PATCH /admin/users/:id`, `DELETE /admin/users/:id`. Add an `isAdmin` guard that returns `401` without a user and `403` for non-admin users.

Keep Google OAuth inert when disabled: `GET /auth/google` returns `404` or `501` with `{ error: "google_oauth_disabled" }` until OAuth config is enabled.

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm test apps/api/test/auth.test.ts apps/api/test/admin.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit auth and user administration**

Run:

```bash
git add apps/api/src/routes/auth.ts apps/api/src/routes/admin.ts apps/api/src/plugins/request-context.ts apps/api/test/auth.test.ts apps/api/test/admin.test.ts apps/api/src/app.ts
git commit -m "feat: add local auth and user administration"
```

## Task 9: Project, Environment, and API Key Admin Routes

**Files:**

- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/test/admin.test.ts`

- [ ] **Step 1: Add failing admin resource tests**

Append tests covering:

- `POST /admin/projects` creates a project.
- `POST /admin/projects/:projectId/environments` creates an environment.
- `POST /admin/projects/:projectId/api-keys` returns a one-time API key secret and stores only prefix/hash through the repository interface.
- `DELETE /admin/projects/:id` soft archives a project.
- `DELETE /admin/api-keys/:id` revokes a key.

Use this representative assertion for API key creation:

```ts
expect(response.statusCode).toBe(201);
expect(response.json().apiKey.secret).toMatch(/^sh_/);
expect(response.json().apiKey.prefix).toBe(response.json().apiKey.secret.slice(0, 12));
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm test apps/api/test/admin.test.ts
```

Expected: FAIL because project/environment/API key routes are incomplete.

- [ ] **Step 3: Implement admin resource routes**

Add these routes to `apps/api/src/routes/admin.ts`:

- `GET /admin/projects`
- `POST /admin/projects`
- `GET /admin/projects/:id`
- `PATCH /admin/projects/:id`
- `DELETE /admin/projects/:id`
- `GET /admin/projects/:projectId/environments`
- `POST /admin/projects/:projectId/environments`
- `PATCH /admin/environments/:id`
- `DELETE /admin/environments/:id`
- `GET /admin/projects/:projectId/api-keys`
- `POST /admin/projects/:projectId/api-keys`
- `DELETE /admin/api-keys/:id`

Validate request bodies with Zod. For API keys, call `createApiKey()`, hash the secret with `API_KEY_PEPPER`, store only `prefix` and `hash`, and return the secret only in the creation response.

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm test apps/api/test/admin.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit admin resources**

Run:

```bash
git add apps/api/src/routes/admin.ts apps/api/test/admin.test.ts
git commit -m "feat: add project environment and api key admin routes"
```

## Task 10: Ingestion Routes

**Files:**

- Create: `apps/api/src/routes/ingestion.ts`
- Create: `apps/api/test/ingestion.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write failing ingestion tests**

`apps/api/test/ingestion.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

describe("ingestion routes", () => {
  it("accepts valid events and enqueues them", async () => {
    const enqueued: unknown[] = [];
    const app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async (job) => {
          enqueued.push(job);
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: "Bearer sh_valid" },
      payload: { name: "dashboard_created", properties: { charts_count: 6 } }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().accepted).toBe(true);
    expect(enqueued).toHaveLength(1);
  });

  it("returns 503 when the queue is unavailable", async () => {
    const app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async () => {
          throw new Error("queue unavailable");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: "Bearer sh_valid" },
      payload: { name: "dashboard_created", properties: {} }
    });

    expect(response.statusCode).toBe(503);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm test apps/api/test/ingestion.test.ts
```

Expected: FAIL because ingestion routes do not exist.

- [ ] **Step 3: Implement ingestion routes**

Implement:

- `POST /v1/events`
- `POST /v1/errors`
- `POST /v1/llm`
- `POST /v1/traces`
- `POST /v1/spans`

Behavior:

- Require `Authorization: Bearer <api_key>`.
- Return `401` if missing/invalid.
- Validate body with the matching Zod schema.
- Generate IDs with prefixes `evt`, `err`, `llm`, `trc`, `spn`.
- Enqueue `{ kind, id, projectId, environmentId, payload }`.
- Return `202` with `{ accepted: true, id }`.
- Return `400` with validation details for invalid payloads.
- Return `503` if enqueue fails.

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm test apps/api/test/ingestion.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit ingestion routes**

Run:

```bash
git add apps/api/src/routes/ingestion.ts apps/api/test/ingestion.test.ts apps/api/src/app.ts
git commit -m "feat: add telemetry ingestion routes"
```

## Task 11: Worker Processing and Persistence

**Files:**

- Create: `apps/worker/src/telemetry-worker.ts`
- Create: `apps/worker/src/main.ts`
- Create: `apps/worker/test/telemetry-worker.test.ts`

- [ ] **Step 1: Write failing worker tests**

`apps/worker/test/telemetry-worker.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { processTelemetryJob } from "../src/telemetry-worker";

describe("processTelemetryJob", () => {
  it("sanitizes and persists event jobs", async () => {
    const inserted: unknown[] = [];

    await processTelemetryJob(
      {
        kind: "event",
        id: "evt_1",
        projectId: "prj_1",
        environmentId: "env_1",
        payload: {
          name: "dashboard_created",
          properties: { password: "secret", charts_count: 6 },
          metadata: { authorization: "Bearer token" }
        }
      },
      {
        insertEvent: async (record) => {
          inserted.push(record);
        }
      }
    );

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      id: "evt_1",
      projectId: "prj_1",
      environmentId: "env_1",
      properties: { password: "[REDACTED]", charts_count: 6 },
      metadata: { authorization: "[REDACTED]" }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm test apps/worker/test/telemetry-worker.test.ts
```

Expected: FAIL because worker files do not exist.

- [ ] **Step 3: Implement worker processor**

`apps/worker/src/telemetry-worker.ts`

```ts
import type { TelemetryJobPayload } from "@signal-hub/queues";
import {
  eventPayloadSchema,
  errorPayloadSchema,
  llmCallPayloadSchema,
  spanPayloadSchema,
  tracePayloadSchema
} from "@signal-hub/telemetry/ingestion-schemas";
import { sanitizeValue } from "@signal-hub/telemetry/sanitization";

type EventInsert = (record: Record<string, unknown>) => Promise<void>;

export type TelemetryWriter = {
  insertEvent?: EventInsert;
  insertError?: EventInsert;
  insertLlmCall?: EventInsert;
  insertTrace?: EventInsert;
  insertSpan?: EventInsert;
};

function receivedAt(): Date {
  return new Date();
}

function timestamp(value: { timestamp?: string }): Date {
  return value.timestamp ? new Date(value.timestamp) : receivedAt();
}

export async function processTelemetryJob(job: TelemetryJobPayload, writer: TelemetryWriter): Promise<void> {
  if (job.kind === "event") {
    const payload = eventPayloadSchema.parse(job.payload);
    await writer.insertEvent?.({
      id: job.id,
      projectId: job.projectId,
      environmentId: job.environmentId,
      timestamp: timestamp(payload),
      receivedAt: receivedAt(),
      tenantId: payload.tenant_id,
      userId: payload.user_id,
      sessionId: payload.session_id,
      traceId: payload.trace_id,
      source: payload.source,
      release: payload.release,
      metadata: sanitizeValue(payload.metadata),
      name: payload.name,
      properties: sanitizeValue(payload.properties)
    });
    return;
  }

  if (job.kind === "error") {
    const payload = errorPayloadSchema.parse(job.payload);
    await writer.insertError?.({ id: job.id, projectId: job.projectId, environmentId: job.environmentId, payload: sanitizeValue(payload) });
    return;
  }

  if (job.kind === "llm") {
    const payload = llmCallPayloadSchema.parse(job.payload);
    await writer.insertLlmCall?.({ id: job.id, projectId: job.projectId, environmentId: job.environmentId, payload: sanitizeValue(payload) });
    return;
  }

  if (job.kind === "trace") {
    const payload = tracePayloadSchema.parse(job.payload);
    await writer.insertTrace?.({ id: job.id, projectId: job.projectId, environmentId: job.environmentId, payload: sanitizeValue(payload) });
    return;
  }

  const payload = spanPayloadSchema.parse(job.payload);
  await writer.insertSpan?.({ id: job.id, projectId: job.projectId, environmentId: job.environmentId, payload: sanitizeValue(payload) });
}
```

Wire `apps/worker/src/main.ts` to create a BullMQ `Worker`, call `processTelemetryJob`, and use DB repository insert functions.

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm test apps/worker/test/telemetry-worker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add integration coverage for all signal types**

Expand the test file with one test each for `error`, `llm`, `trace`, and `span`. Each test must assert sensitive nested values are redacted before the writer receives data.

- [ ] **Step 6: Run worker tests**

Run:

```bash
pnpm test apps/worker/test/telemetry-worker.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit worker**

Run:

```bash
git add apps/worker
git commit -m "feat: add telemetry worker processing"
```

## Task 12: Query and Aggregate Routes

**Files:**

- Create: `apps/api/src/routes/query.ts`
- Create: `apps/api/test/query.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write failing query tests**

`apps/api/test/query.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

describe("query routes", () => {
  it("lists events with filters", async () => {
    const app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: {
        findSessionUser: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false })
      },
      query: {
        listEvents: async (filters) => [{ id: "evt_1", name: "dashboard_created", projectId: filters.projectId }],
        getEventAggregates: async () => ({ total: 1, byName: [{ name: "dashboard_created", count: 1 }] })
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm test apps/api/test/query.test.ts
```

Expected: FAIL because query routes do not exist.

- [ ] **Step 3: Implement query routes**

Implement:

- `GET /query/events`
- `GET /query/errors`
- `GET /query/llm-calls`
- `GET /query/traces`
- `GET /query/traces/:id/spans`
- `GET /query/aggregates/events`
- `GET /query/aggregates/errors`
- `GET /query/aggregates/llm`
- `GET /query/aggregates/traces`

Require an authenticated human user for all query routes. Support these query params:

- `project_id`
- `environment_id`
- `tenant_id`
- `user_id`
- `session_id`
- `trace_id`
- `from`
- `to`
- `limit`
- `cursor`

Default `limit` to `50` and cap at `500`.

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm test apps/api/test/query.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit query routes**

Run:

```bash
git add apps/api/src/routes/query.ts apps/api/test/query.test.ts apps/api/src/app.ts
git commit -m "feat: add telemetry query routes"
```

## Task 13: Docker Compose and Runtime Wiring

**Files:**

- Create: `docker-compose.yml`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `README.md`

- [ ] **Step 1: Add Docker Compose**

`docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: signalhub
      POSTGRES_USER: signalhub
      POSTGRES_PASSWORD: signalhub
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U signalhub -d signalhub"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  api:
    build:
      context: .
      dockerfile: Dockerfile
    command: ["pnpm", "dev:api"]
    env_file: .env
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  worker:
    build:
      context: .
      dockerfile: Dockerfile
    command: ["pnpm", "dev:worker"]
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  postgres_data:
  redis_data:
```

Also add a root `Dockerfile`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.base.json vitest.config.ts ./
RUN pnpm install --frozen-lockfile
CMD ["pnpm", "dev:api"]
```

- [ ] **Step 2: Wire real dependencies in API and worker mains**

`apps/api/src/main.ts` should:

- Load config.
- Create DB client.
- Create Redis/BullMQ queue.
- Register readiness checks that ping Postgres and Redis.
- Build app with real repositories and queue helpers.
- Listen on configured port.

`apps/worker/src/main.ts` should:

- Load config.
- Create DB client.
- Create BullMQ worker.
- Call `processTelemetryJob`.
- Log failed jobs and leave failed jobs in BullMQ for inspection.

- [ ] **Step 3: Update README**

Add:

- Project description.
- Prerequisites: Node 22, pnpm, Docker.
- Setup: copy `.env.example` to `.env`, edit secrets, run `pnpm install`, run migrations, seed admin, start API and worker.
- Docker Compose instructions.
- Example `curl` for creating a project/environment/key and ingesting an event.

- [ ] **Step 4: Run full local checks**

Run:

```bash
pnpm test
pnpm build
docker compose config
```

Expected: all pass.

- [ ] **Step 5: Commit runtime wiring**

Run:

```bash
git add docker-compose.yml Dockerfile README.md apps/api/src/main.ts apps/worker/src/main.ts
git commit -m "feat: add self hosted runtime wiring"
```

## Task 14: End-to-End Smoke Test

**Files:**

- Create: `apps/api/test/e2e.test.ts`

- [ ] **Step 1: Write failing end-to-end test**

`apps/api/test/e2e.test.ts`

```ts
import { PostgreSqlContainer } from "testcontainers";
import { GenericContainer, Wait } from "testcontainers";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createDb } from "@signal-hub/db";
import { migrate } from "@signal-hub/db/migrate";
import { createProject, createEnvironment, createApiKeyRecord } from "@signal-hub/db/repositories/admin";
import { listEvents } from "@signal-hub/db/repositories/telemetry-query";
import { hashApiKey } from "@signal-hub/telemetry/api-keys";
import { createTelemetryQueue } from "@signal-hub/queues";
import { processTelemetryJob } from "../../worker/src/telemetry-worker";

describe("telemetry core e2e", () => {
  it("creates admin resources, ingests an event, runs worker processing, and queries the event", async () => {
    const postgres = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("signalhub")
      .withUsername("signalhub")
      .withPassword("signalhub")
      .start();
    const redis = await new GenericContainer("redis:7-alpine")
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
      .start();

    try {
      const db = createDb(postgres.getConnectionUri());
      await migrate(db);

      const project = await createProject(db, { name: "Demo API" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const secret = "sh_test_e2e_key";
      await createApiKeyRecord(db, {
        projectId: project.id,
        environmentId: environment.id,
        name: "e2e key",
        prefix: secret.slice(0, 12),
        hash: await hashApiKey(secret, "test-pepper")
      });

      const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
      const queue = createTelemetryQueue(redisUrl);
      const app = await buildApp({
        readiness: async () => ({ postgres: true, redis: true }),
        ingestion: {
          verifyApiKey: async (candidate) => {
            if (candidate !== secret) return null;
            return { projectId: project.id, environmentId: environment.id };
          },
          enqueue: async (job) => {
            await queue.add(job.kind, job);
          }
        },
        auth: {
          findSessionUser: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false })
        },
        query: {
          listEvents: async (filters) => listEvents(db, filters),
          getEventAggregates: async () => ({ total: 1, byName: [{ name: "dashboard_created", count: 1 }] })
        }
      });

      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/events",
        headers: { authorization: `Bearer ${secret}` },
        payload: {
          name: "dashboard_created",
          properties: { password: "secret", charts_count: 6 },
          metadata: { authorization: "Bearer token" }
        }
      });

      expect(ingestResponse.statusCode).toBe(202);

      const waiting = await queue.getWaiting();
      expect(waiting).toHaveLength(1);
      const jobData = waiting[0].data;

      await processTelemetryJob(jobData, {
        insertEvent: async (record) => {
          await db.insertInto("events").values({
            id: record.id as string,
            project_id: record.projectId as string,
            environment_id: record.environmentId as string,
            timestamp: record.timestamp as Date,
            received_at: record.receivedAt as Date,
            metadata: JSON.stringify(record.metadata),
            name: record.name as string,
            properties: JSON.stringify(record.properties)
          }).execute();
        }
      });

      const queryResponse = await app.inject({
        method: "GET",
        url: `/query/events?project_id=${project.id}&environment_id=${environment.id}`
      });

      expect(queryResponse.statusCode).toBe(200);
      expect(queryResponse.json().data[0].properties.password).toBe("[REDACTED]");

      await queue.close();
      await app.close();
    } finally {
      await redis.stop();
      await postgres.stop();
    }
  });
});
```

- [ ] **Step 2: Run e2e test to verify failure before implementation**

Run:

```bash
pnpm test apps/api/test/e2e.test.ts
```

Expected: FAIL if any API, queue, worker, or repository contract from previous tasks is inconsistent.

- [ ] **Step 3: Fix any contract mismatch surfaced by the e2e test**

Allowed fixes are limited to these categories:

- Import path mismatch between packages.
- CamelCase/snake_case mismatch between repositories and route filters.
- Missing `app.close()` or queue cleanup.
- Missing route registration in `buildApp`.
- Missing JSON serialization/deserialization in repository methods.

Do not add new product scope while fixing the e2e path.

- [ ] **Step 4: Run e2e test to verify pass**

Run:

```bash
pnpm test apps/api/test/e2e.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full verification**

Run:

```bash
pnpm test
pnpm build
docker compose config
```

Expected: all pass.

- [ ] **Step 6: Commit e2e coverage**

Run:

```bash
git add apps/api/test/e2e.test.ts apps apps packages
git commit -m "test: add telemetry core e2e coverage"
```

## Task 15: Final Documentation and Acceptance Review

**Files:**

- Modify: `README.md`
- Create: `.claude/docs/PROJECT-SUMMARY.md`
- Create: `.claude/docs/ARCHITECTURE.md`
- Create: `.claude/docs/STACK.md`
- Create: `.claude/docs/DEPLOYMENT.md`
- Create: `.claude/docs/CONSTRAINTS.md`
- Create: `.claude/docs/DECISIONS.md`
- Create: `.claude/docs/SECRETS.md`
- Create: `.claude/docs/INFRASTRUCTURE.md`
- Modify: `.gitignore`

- [ ] **Step 1: Document operator workflow**

Update `README.md` with:

- What Signal Hub is.
- Current Phase 1 capabilities.
- Local development setup.
- Docker Compose setup.
- Required secrets.
- Admin bootstrap.
- API key creation.
- Ingestion examples for events, errors, LLM calls, traces, and spans.
- Query examples for raw events and aggregates.

- [ ] **Step 2: Create standard project docs**

Create `.claude/docs/*` files required by repo instructions. Version `.claude/docs/SECRETS.md` with sanitized variable names, descriptions, and example-safe values only. Keep root-level `SECRETS.md` ignored in `.gitignore`; do not put real secrets in any committed file.

- [ ] **Step 3: Run final verification**

Run:

```bash
pnpm test
pnpm build
docker compose config
git status -sb
```

Expected:

- Tests pass.
- TypeScript build passes.
- Docker Compose config validates.
- `git status -sb` shows only intentional documentation changes.

- [ ] **Step 4: Commit docs**

Run:

```bash
git add README.md .claude/docs .gitignore
git commit -m "docs: document telemetry core operation"
```

## Self-Review Checklist

- Spec coverage:
  - Self-hosted multi-project boundary: Tasks 5, 9, 13, 15.
  - Local auth and optional Google OAuth endpoints: Tasks 8 and 15.
  - API keys scoped to project and environment: Tasks 4, 5, 9, 10.
  - Typed telemetry tables: Tasks 5 and 11.
  - Queued ingestion: Tasks 6, 10, 11, 13.
  - Sanitization before persistence: Tasks 3 and 11.
  - Raw query and aggregate endpoints: Tasks 5 and 12.
  - Docker Compose install path: Task 13.
  - Tests and acceptance criteria: Tasks 2 through 15.
- Red-flag scan:
  - No open decision markers remain.
  - Task 14 contains a concrete e2e path rather than a symbolic assertion.
- Type consistency:
  - Signal kinds are `event`, `error`, `llm`, `trace`, and `span`.
  - Table names match the design spec.
  - API key scope is consistently `projectId + environmentId`.
  - Human users have coarse `isAdmin` access only.
