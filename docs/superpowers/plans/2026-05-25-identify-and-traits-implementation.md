# Identify And Traits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent user and tenant traits so SignalMonitor can show real identity metadata in Users and Entities without becoming a full PostHog clone.

**Architecture:** Add project/environment-scoped profile tables for users and tenants. Identify endpoints verify project API keys and write sanitized traits directly to Postgres; normal telemetry writes opportunistically update profile last-seen timestamps without mutating traits. Console Users and Entities views join profile metadata to existing activity aggregates.

**Tech Stack:** TypeScript, Fastify, Zod, Kysely/Postgres migrations, existing sanitization helpers, existing SDK queue, React console, Vitest/Testcontainers.

---

## File Map

- Create `packages/db/migrations/0013_identity_profiles.sql`: `user_profiles` and `tenant_profiles`.
- Modify `packages/db/src/schema.ts`: table types.
- Create `packages/db/src/repositories/identity-profiles.ts`: identify upserts, last-seen touches, profile reads.
- Modify `packages/db/src/repositories/telemetry-writes.ts`: touch profile last-seen from telemetry with `userId`/`tenantId`.
- Modify `packages/db/src/repositories/users-query.ts`: include user traits and labels.
- Modify `packages/db/src/repositories/entities-query.ts`: include tenant traits and labels.
- Modify `packages/db/test/repositories.test.ts`: migration, repository, activity join tests.
- Modify `packages/telemetry/src/ingestion-schemas.ts`: identify payload schemas.
- Modify `packages/telemetry/test/ingestion-schemas.test.ts`: identify schema tests.
- Create `apps/api/src/routes/api-key-auth.ts`: shared API-key verification helper extracted from ingestion routes.
- Modify `apps/api/src/routes/ingestion.ts`: use shared helper.
- Create `apps/api/src/routes/identify.ts`: `POST /v1/identify/user` and `POST /v1/identify/tenant`.
- Modify `apps/api/src/main.ts`: register identify routes.
- Modify `apps/api/src/openapi.ts` and `apps/api/test/docs.test.ts`: document identify endpoints.
- Create `apps/api/test/identify.test.ts`: route behavior tests.
- Modify `packages/sdk/src/types.ts`: add identify input types and client methods.
- Modify `packages/sdk/src/mapping.ts`: map identify calls to endpoint payloads.
- Modify `packages/sdk/src/client.ts`: queue identify calls.
- Modify `packages/sdk/test/client.test.ts`, `packages/sdk/test/mapping.test.ts`, and `packages/sdk/test/contract.test.ts`: SDK coverage.
- Modify `apps/console/src/api/types.ts`: add traits/profile fields.
- Modify `apps/console/src/components/UsersUserList.tsx`, `UsersUserDetail.tsx`, `EntitiesTenantList.tsx`, and `EntitiesTenantDetail.tsx`: display labels and key traits.
- Modify related console tests for Users and Entities.
- Modify `README.md`, `.claude/docs/ARCHITECTURE.md`, `.claude/docs/PROJECT-SUMMARY.md`, `.claude/docs/STACK.md`, `.claude/docs/CONSTRAINTS.md`, and `.claude/docs/SECRETS.md`.

## Public Contract

API endpoints:

```http
POST /v1/identify/user
Authorization: Bearer sh_...
Content-Type: application/json

{
  "user_id": "user_123",
  "traits": {
    "name": "Ana Souza",
    "email": "ana@example.com",
    "role": "admin",
    "plan": "pro"
  },
  "tenant_id": "tenant_123",
  "timestamp": "2026-05-25T12:00:00.000Z",
  "metadata": { "source": "account-settings" }
}
```

```http
POST /v1/identify/tenant
Authorization: Bearer sh_...
Content-Type: application/json

{
  "tenant_id": "tenant_123",
  "traits": {
    "name": "MicroERP",
    "plan": "pro",
    "operation_mode": "production",
    "status": "active"
  },
  "timestamp": "2026-05-25T12:00:00.000Z",
  "metadata": { "source": "billing-sync" }
}
```

SDK methods:

```ts
client.identifyUser("user_123", { name: "Ana Souza", role: "admin" }, { tenantId: "tenant_123" });
client.identifyTenant("tenant_123", { name: "MicroERP", plan: "pro" });
```

Display rules:

- `traits.name`, `traits.display_name`, or `traits.email` becomes the preferred label.
- Users and tenants still show raw IDs.
- Key chips prefer `plan`, `role`, `operation_mode`, and `status`.
- Trait JSON is sanitized by existing `sanitizeValue` before storage.
- Traits only change through identify endpoints; telemetry writes only update `last_seen_at`.

## Task 1: Add Profile Tables And Repository

**Files:**
- Create: `packages/db/migrations/0013_identity_profiles.sql`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/repositories/identity-profiles.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Write failing DB tests**

Add tests in `packages/db/test/repositories.test.ts`:

```ts
import {
  identifyTenantProfile,
  identifyUserProfile,
  touchTenantProfileLastSeen,
  touchUserProfileLastSeen
} from "../src/repositories/identity-profiles.js";

it("has identity profile tables available", async () => {
  await sql`select project_id, environment_id, user_id, traits from user_profiles limit 0`.execute(db);
  await sql`select project_id, environment_id, tenant_id, traits from tenant_profiles limit 0`.execute(db);
});

it("upserts sanitized user and tenant profile traits", async () => {
  await insertProjectAndEnvironment(db, "prj_identity", "env_identity");

  await identifyUserProfile(db, {
    projectId: "prj_identity",
    environmentId: "env_identity",
    userId: "user_1",
    tenantId: "tenant_1",
    traits: { name: "Ana", token: "secret-value" },
    timestamp: new Date("2026-05-25T10:00:00.000Z")
  });
  await identifyTenantProfile(db, {
    projectId: "prj_identity",
    environmentId: "env_identity",
    tenantId: "tenant_1",
    traits: { name: "MicroERP", plan: "pro" },
    timestamp: new Date("2026-05-25T10:00:00.000Z")
  });

  const user = await db
    .selectFrom("user_profiles")
    .selectAll()
    .where("project_id", "=", "prj_identity")
    .where("environment_id", "=", "env_identity")
    .where("user_id", "=", "user_1")
    .executeTakeFirstOrThrow();
  const tenant = await db
    .selectFrom("tenant_profiles")
    .selectAll()
    .where("project_id", "=", "prj_identity")
    .where("environment_id", "=", "env_identity")
    .where("tenant_id", "=", "tenant_1")
    .executeTakeFirstOrThrow();

  expect(user.traits).toMatchObject({ name: "Ana", token: "[REDACTED]" });
  expect(user.tenant_id).toBe("tenant_1");
  expect(tenant.traits).toMatchObject({ name: "MicroERP", plan: "pro" });
});

it("touches last seen without overwriting traits", async () => {
  await insertProjectAndEnvironment(db, "prj_touch", "env_touch");
  await identifyUserProfile(db, {
    projectId: "prj_touch",
    environmentId: "env_touch",
    userId: "user_1",
    traits: { name: "Ana" },
    timestamp: new Date("2026-05-25T10:00:00.000Z")
  });

  await touchUserProfileLastSeen(db, {
    projectId: "prj_touch",
    environmentId: "env_touch",
    userId: "user_1",
    tenantId: "tenant_1",
    timestamp: new Date("2026-05-25T10:05:00.000Z")
  });

  const row = await db
    .selectFrom("user_profiles")
    .select(["traits", "last_seen_at"])
    .where("project_id", "=", "prj_touch")
    .where("environment_id", "=", "env_touch")
    .where("user_id", "=", "user_1")
    .executeTakeFirstOrThrow();

  expect(row.traits).toMatchObject({ name: "Ana" });
  expect(new Date(row.last_seen_at).toISOString()).toBe("2026-05-25T10:05:00.000Z");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
rtk proxy pnpm vitest run packages/db/test/repositories.test.ts -t "identity profile|touches last seen"
```

Expected: FAIL because migration and repository do not exist.

- [ ] **Step 3: Add migration**

Create `packages/db/migrations/0013_identity_profiles.sql`:

```sql
CREATE TABLE user_profiles (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tenant_id TEXT,
  traits JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, environment_id, user_id)
);

CREATE INDEX user_profiles_last_seen_idx
  ON user_profiles(project_id, environment_id, last_seen_at DESC);

CREATE INDEX user_profiles_tenant_idx
  ON user_profiles(project_id, environment_id, tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE tenant_profiles (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  traits JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, environment_id, tenant_id)
);

CREATE INDEX tenant_profiles_last_seen_idx
  ON tenant_profiles(project_id, environment_id, last_seen_at DESC);
```

- [ ] **Step 4: Add repository implementation**

Create `packages/db/src/repositories/identity-profiles.ts`:

```ts
import { sanitizeValue } from "@sigmon/telemetry/sanitization";
import type { Db } from "../client.js";

export type IdentifyUserProfileInput = {
  projectId: string;
  environmentId: string;
  userId: string;
  tenantId?: string | null;
  traits: unknown;
  timestamp: Date;
};

export type IdentifyTenantProfileInput = {
  projectId: string;
  environmentId: string;
  tenantId: string;
  traits: unknown;
  timestamp: Date;
};

export type TouchUserProfileInput = Omit<IdentifyUserProfileInput, "traits">;
export type TouchTenantProfileInput = Omit<IdentifyTenantProfileInput, "traits">;

function objectTraits(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(value);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return {};
  }
  return sanitized as Record<string, unknown>;
}

export async function identifyUserProfile(db: Db, input: IdentifyUserProfileInput): Promise<void> {
  await db
    .insertInto("user_profiles")
    .values({
      project_id: input.projectId,
      environment_id: input.environmentId,
      user_id: input.userId,
      tenant_id: input.tenantId ?? null,
      traits: objectTraits(input.traits),
      first_seen_at: input.timestamp,
      last_seen_at: input.timestamp,
      updated_at: input.timestamp
    })
    .onConflict((oc) =>
      oc.columns(["project_id", "environment_id", "user_id"]).doUpdateSet({
        tenant_id: input.tenantId ?? null,
        traits: objectTraits(input.traits),
        last_seen_at: input.timestamp,
        updated_at: input.timestamp
      })
    )
    .execute();
}

export async function identifyTenantProfile(db: Db, input: IdentifyTenantProfileInput): Promise<void> {
  await db
    .insertInto("tenant_profiles")
    .values({
      project_id: input.projectId,
      environment_id: input.environmentId,
      tenant_id: input.tenantId,
      traits: objectTraits(input.traits),
      first_seen_at: input.timestamp,
      last_seen_at: input.timestamp,
      updated_at: input.timestamp
    })
    .onConflict((oc) =>
      oc.columns(["project_id", "environment_id", "tenant_id"]).doUpdateSet({
        traits: objectTraits(input.traits),
        last_seen_at: input.timestamp,
        updated_at: input.timestamp
      })
    )
    .execute();
}

export async function touchUserProfileLastSeen(db: Db, input: TouchUserProfileInput): Promise<void> {
  await db
    .insertInto("user_profiles")
    .values({
      project_id: input.projectId,
      environment_id: input.environmentId,
      user_id: input.userId,
      tenant_id: input.tenantId ?? null,
      traits: {},
      first_seen_at: input.timestamp,
      last_seen_at: input.timestamp,
      updated_at: input.timestamp
    })
    .onConflict((oc) =>
      oc.columns(["project_id", "environment_id", "user_id"]).doUpdateSet({
        tenant_id: input.tenantId ?? null,
        last_seen_at: input.timestamp,
        updated_at: input.timestamp
      })
    )
    .execute();
}

export async function touchTenantProfileLastSeen(db: Db, input: TouchTenantProfileInput): Promise<void> {
  await db
    .insertInto("tenant_profiles")
    .values({
      project_id: input.projectId,
      environment_id: input.environmentId,
      tenant_id: input.tenantId,
      traits: {},
      first_seen_at: input.timestamp,
      last_seen_at: input.timestamp,
      updated_at: input.timestamp
    })
    .onConflict((oc) =>
      oc.columns(["project_id", "environment_id", "tenant_id"]).doUpdateSet({
        last_seen_at: input.timestamp,
        updated_at: input.timestamp
      })
    )
    .execute();
}
```

- [ ] **Step 5: Add schema table types**

Update `packages/db/src/schema.ts` with `user_profiles` and `tenant_profiles` table types matching the migration.

- [ ] **Step 6: Run focused DB tests**

Run:

```bash
pnpm vitest run packages/db/test/repositories.test.ts -t "identity profile|touches last seen"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/migrations/0013_identity_profiles.sql packages/db/src/schema.ts packages/db/src/repositories/identity-profiles.ts packages/db/test/repositories.test.ts
git commit -m "feat: add identity profile storage"
```

## Task 2: Add Identify API Endpoints

**Files:**
- Modify: `packages/telemetry/src/ingestion-schemas.ts`
- Modify: `packages/telemetry/test/ingestion-schemas.test.ts`
- Create: `apps/api/src/routes/api-key-auth.ts`
- Modify: `apps/api/src/routes/ingestion.ts`
- Create: `apps/api/src/routes/identify.ts`
- Modify: `apps/api/src/main.ts`
- Create: `apps/api/test/identify.test.ts`
- Modify: `apps/api/src/openapi.ts`
- Modify: `apps/api/test/docs.test.ts`

- [ ] **Step 1: Add failing schema tests**

In `packages/telemetry/test/ingestion-schemas.test.ts`, add:

```ts
import { tenantIdentifyPayloadSchema, userIdentifyPayloadSchema } from "../src/ingestion-schemas.js";

it("validates user identify payloads", () => {
  expect(
    userIdentifyPayloadSchema.parse({
      user_id: "user_1",
      tenant_id: "tenant_1",
      traits: { name: "Ana", role: "admin" },
      timestamp: "2026-05-25T12:00:00.000Z",
      metadata: { source: "account" }
    })
  ).toMatchObject({ user_id: "user_1", tenant_id: "tenant_1" });
});

it("validates tenant identify payloads", () => {
  expect(
    tenantIdentifyPayloadSchema.parse({
      tenant_id: "tenant_1",
      traits: { name: "MicroERP", plan: "pro" },
      timestamp: "2026-05-25T12:00:00.000Z"
    })
  ).toMatchObject({ tenant_id: "tenant_1" });
});
```

- [ ] **Step 2: Implement identify schemas**

In `packages/telemetry/src/ingestion-schemas.ts`, add:

```ts
export const userIdentifyPayloadSchema = sharedEnvelopeSchema
  .pick({ timestamp: true, tenant_id: true, metadata: true })
  .extend({
    user_id: shortTextSchema,
    traits: jsonObjectSchema
  });

export const tenantIdentifyPayloadSchema = sharedEnvelopeSchema
  .pick({ timestamp: true, metadata: true })
  .extend({
    tenant_id: shortTextSchema,
    traits: jsonObjectSchema
  });

export type UserIdentifyPayload = z.infer<typeof userIdentifyPayloadSchema>;
export type TenantIdentifyPayload = z.infer<typeof tenantIdentifyPayloadSchema>;
```

- [ ] **Step 3: Extract shared API key auth helper**

Create `apps/api/src/routes/api-key-auth.ts`:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";

export type ApiKeyScope = {
  projectId: string;
  environmentId: string;
};

export type ApiKeyVerifier = (secret: string) => Promise<ApiKeyScope | null | undefined>;

export function parseBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1];
}

export async function requireApiKeyScope(
  request: FastifyRequest,
  reply: FastifyReply,
  verifyApiKey: ApiKeyVerifier | undefined
): Promise<ApiKeyScope | undefined> {
  const secret = parseBearerToken(request);
  if (!secret || !verifyApiKey) {
    reply.status(401).send({ error: "invalid_api_key" });
    return undefined;
  }

  let scope: ApiKeyScope | null | undefined;
  try {
    scope = await verifyApiKey(secret);
  } catch {
    reply.status(503).send({ error: "ingestion_unavailable" });
    return undefined;
  }

  if (!scope) {
    reply.status(401).send({ error: "invalid_api_key" });
    return undefined;
  }

  return scope;
}
```

Update `apps/api/src/routes/ingestion.ts` to import and use this helper, preserving existing status codes.

- [ ] **Step 4: Add identify route tests**

Create `apps/api/test/identify.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { registerIdentifyRoutes } from "../src/routes/identify.js";

describe("identify routes", () => {
  it("stores user identify payloads in API-key scope", async () => {
    const identifyUser = vi.fn(async () => undefined);
    const app = buildApp();
    registerIdentifyRoutes(app, {
      verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
      identifyUser,
      identifyTenant: vi.fn()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/identify/user",
      headers: { authorization: "Bearer sh_test" },
      payload: { user_id: "user_1", tenant_id: "tenant_1", traits: { name: "Ana" } }
    });

    expect(response.statusCode).toBe(202);
    expect(identifyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        userId: "user_1",
        tenantId: "tenant_1",
        traits: { name: "Ana" }
      })
    );
  });

  it("stores tenant identify payloads in API-key scope", async () => {
    const identifyTenant = vi.fn(async () => undefined);
    const app = buildApp();
    registerIdentifyRoutes(app, {
      verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
      identifyUser: vi.fn(),
      identifyTenant
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/identify/tenant",
      headers: { authorization: "Bearer sh_test" },
      payload: { tenant_id: "tenant_1", traits: { name: "MicroERP" } }
    });

    expect(response.statusCode).toBe(202);
    expect(identifyTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        tenantId: "tenant_1",
        traits: { name: "MicroERP" }
      })
    );
  });
});
```

- [ ] **Step 5: Implement identify routes**

Create `apps/api/src/routes/identify.ts`:

```ts
import { tenantIdentifyPayloadSchema, userIdentifyPayloadSchema } from "@sigmon/telemetry/ingestion-schemas";
import type { FastifyInstance } from "fastify";
import { requireApiKeyScope, type ApiKeyVerifier } from "./api-key-auth.js";

export type IdentifyRouteDependencies = {
  verifyApiKey: ApiKeyVerifier;
  identifyUser(input: {
    projectId: string;
    environmentId: string;
    userId: string;
    tenantId?: string;
    traits: unknown;
    timestamp: Date;
  }): Promise<void>;
  identifyTenant(input: {
    projectId: string;
    environmentId: string;
    tenantId: string;
    traits: unknown;
    timestamp: Date;
  }): Promise<void>;
};

function timestamp(value: string | undefined): Date {
  return value ? new Date(value) : new Date();
}

function details(error: { issues: Array<{ path: PropertyKey[]; message: string; code: string }> }) {
  return error.issues.map((issue) => ({ path: issue.path, message: issue.message, code: issue.code }));
}

export function registerIdentifyRoutes(app: FastifyInstance, deps: IdentifyRouteDependencies): void {
  app.post("/v1/identify/user", async (request, reply) => {
    const scope = await requireApiKeyScope(request, reply, deps.verifyApiKey);
    if (!scope) return reply;
    const parsed = userIdentifyPayloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_identify_payload", details: details(parsed.error) });

    await deps.identifyUser({
      projectId: scope.projectId,
      environmentId: scope.environmentId,
      userId: parsed.data.user_id,
      tenantId: parsed.data.tenant_id,
      traits: parsed.data.traits,
      timestamp: timestamp(parsed.data.timestamp)
    });
    return reply.status(202).send({ accepted: true });
  });

  app.post("/v1/identify/tenant", async (request, reply) => {
    const scope = await requireApiKeyScope(request, reply, deps.verifyApiKey);
    if (!scope) return reply;
    const parsed = tenantIdentifyPayloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_identify_payload", details: details(parsed.error) });

    await deps.identifyTenant({
      projectId: scope.projectId,
      environmentId: scope.environmentId,
      tenantId: parsed.data.tenant_id,
      traits: parsed.data.traits,
      timestamp: timestamp(parsed.data.timestamp)
    });
    return reply.status(202).send({ accepted: true });
  });
}
```

- [ ] **Step 6: Wire main and OpenAPI**

In `apps/api/src/main.ts`, import `identifyUserProfile`, `identifyTenantProfile`, and `registerIdentifyRoutes`, then register routes with the same API key verifier used by ingestion.

Update OpenAPI docs to include:

- `POST /v1/identify/user`
- `POST /v1/identify/tenant`
- `202`, `400`, `401`, `503` responses

- [ ] **Step 7: Run API and docs tests**

Run:

```bash
pnpm vitest run packages/telemetry/test/ingestion-schemas.test.ts apps/api/test/identify.test.ts apps/api/test/docs.test.ts apps/api/test/ingestion.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/telemetry/src/ingestion-schemas.ts packages/telemetry/test/ingestion-schemas.test.ts apps/api/src/routes/api-key-auth.ts apps/api/src/routes/ingestion.ts apps/api/src/routes/identify.ts apps/api/src/main.ts apps/api/src/openapi.ts apps/api/test/identify.test.ts apps/api/test/docs.test.ts
git commit -m "feat: add identify ingestion endpoints"
```

## Task 3: Add SDK Identify Methods

**Files:**
- Modify: `packages/sdk/src/types.ts`
- Modify: `packages/sdk/src/mapping.ts`
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/test/client.test.ts`
- Modify: `packages/sdk/test/mapping.test.ts`
- Modify: `packages/sdk/test/contract.test.ts`

- [ ] **Step 1: Add failing SDK tests**

In `packages/sdk/test/client.test.ts`, add:

```ts
it("identifyUser and identifyTenant enqueue dedicated identify endpoints", async () => {
  const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));
  const client = createSignalMonitorClient({
    endpoint: "https://sigmon.example.com",
    apiKey: "sh_test",
    fetch: fetchImpl
  });

  client.identifyUser("user_1", { name: "Ana", role: "admin" }, { tenantId: "tenant_1" });
  client.identifyTenant("tenant_1", { name: "MicroERP", plan: "pro" });

  await client.flush();

  expect(fetchImpl).toHaveBeenNthCalledWith(
    1,
    "https://sigmon.example.com/v1/identify/user",
    expect.objectContaining({ method: "POST" })
  );
  expect(fetchImpl).toHaveBeenNthCalledWith(
    2,
    "https://sigmon.example.com/v1/identify/tenant",
    expect.objectContaining({ method: "POST" })
  );
});
```

- [ ] **Step 2: Add SDK public types**

In `packages/sdk/src/types.ts`, add:

```ts
export type IdentifyUserInput = EventInput & {
  tenantId?: string;
};

export type IdentifyTenantInput = EventInput;
```

Extend `SignalMonitorClient`:

```ts
identifyUser: (userId: string, traits?: SignalMetadata, context?: IdentifyUserInput) => void;
identifyTenant: (tenantId: string, traits?: SignalMetadata, context?: IdentifyTenantInput) => void;
```

Extend `SignalKind`:

```ts
export type SignalKind = "event" | "error" | "llm" | "trace" | "span" | "breadcrumb" | "identify_user" | "identify_tenant";
```

- [ ] **Step 3: Add mapping functions**

In `packages/sdk/src/mapping.ts`, add:

```ts
export function createIdentifyUserSignal(
  userId: string,
  traits: SignalMetadata = {},
  context?: IdentifyUserInput
): QueuedSignal {
  return {
    kind: "identify_user",
    endpointPath: "/v1/identify/user",
    payload: {
      timestamp: serializeDate(context?.timestamp),
      user_id: userId,
      tenant_id: context?.tenantId,
      traits,
      metadata: {}
    }
  };
}

export function createIdentifyTenantSignal(
  tenantId: string,
  traits: SignalMetadata = {},
  context?: IdentifyTenantInput
): QueuedSignal {
  return {
    kind: "identify_tenant",
    endpointPath: "/v1/identify/tenant",
    payload: {
      timestamp: serializeDate(context?.timestamp),
      tenant_id: tenantId,
      traits,
      metadata: {}
    }
  };
}
```

- [ ] **Step 4: Wire client methods**

In `packages/sdk/src/client.ts`, import the mapping functions and add:

```ts
identifyUser(userId: string, traits?: SignalMetadata, context?: IdentifyUserInput): void {
  enqueue(createIdentifyUserSignal(userId, traits, context));
},

identifyTenant(tenantId: string, traits?: SignalMetadata, context?: IdentifyTenantInput): void {
  enqueue(createIdentifyTenantSignal(tenantId, traits, context));
},
```

Keep existing `identify(context)` as in-memory default context for backwards compatibility.

- [ ] **Step 5: Add contract tests**

In `packages/sdk/test/contract.test.ts`, assert SDK payloads parse with `userIdentifyPayloadSchema` and `tenantIdentifyPayloadSchema`.

- [ ] **Step 6: Run SDK tests**

Run:

```bash
pnpm vitest run packages/sdk/test/client.test.ts packages/sdk/test/mapping.test.ts packages/sdk/test/contract.test.ts
pnpm --filter @sigmon/sdk build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/types.ts packages/sdk/src/mapping.ts packages/sdk/src/client.ts packages/sdk/test/client.test.ts packages/sdk/test/mapping.test.ts packages/sdk/test/contract.test.ts
git commit -m "feat: add sdk identify methods"
```

## Task 4: Join Profiles Into Users And Entities UI

**Files:**
- Modify: `packages/db/src/repositories/users-query.ts`
- Modify: `packages/db/src/repositories/entities-query.ts`
- Modify: `packages/db/test/repositories.test.ts`
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/components/UsersUserList.tsx`
- Modify: `apps/console/src/components/UsersUserDetail.tsx`
- Modify: `apps/console/src/components/EntitiesTenantList.tsx`
- Modify: `apps/console/src/components/EntitiesTenantDetail.tsx`
- Modify: `apps/console/src/components/UsersInvestigationPanel.test.tsx`
- Modify: `apps/console/src/components/EntitiesInvestigationPanel.test.tsx`

- [ ] **Step 1: Add failing aggregate tests**

Add repository expectations:

```ts
expect(users.users[0]).toMatchObject({
  userId: "user_1",
  label: "Ana Souza",
  traits: { name: "Ana Souza", role: "admin" },
  keyTraits: { role: "admin" }
});

expect(tenants.tenants[0]).toMatchObject({
  tenantId: "tenant_1",
  label: "MicroERP",
  traits: { name: "MicroERP", plan: "pro" },
  keyTraits: { plan: "pro" }
});
```

- [ ] **Step 2: Add response fields**

Extend `UserSummary` and `TenantSummary` in DB repositories and console API types:

```ts
traits: Record<string, unknown>;
keyTraits: Record<string, string>;
```

Add helper:

```ts
function profileLabel(rawId: string | null, traits: Record<string, unknown> | null, fallback: string): string {
  const name = traits?.name ?? traits?.display_name ?? traits?.email;
  return typeof name === "string" && name.trim() ? name : rawId ?? fallback;
}

function keyTraits(traits: Record<string, unknown> | null, keys: string[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const key of keys) {
    const value = traits?.[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      output[key] = String(value);
    }
  }
  return output;
}
```

- [ ] **Step 3: Left join profile tables**

Update list/detail queries:

- Users queries left join `user_profiles` by project/environment/user_id.
- Entity tenant queries left join `tenant_profiles` by project/environment/tenant_id.
- Search should match raw ID or profile label fields `name`, `display_name`, and `email`.

- [ ] **Step 4: Render traits in console**

Add small trait chips under labels:

```tsx
{Object.entries(user.keyTraits).map(([key, value]) => (
  <span className="trait-chip" key={key}>{key}: {value}</span>
))}
```

Use the same pattern for tenant rows and detail headers.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm vitest run packages/db/test/repositories.test.ts -t "user|tenant|profile|traits"
pnpm vitest run apps/console/src/components/UsersInvestigationPanel.test.tsx apps/console/src/components/EntitiesInvestigationPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repositories/users-query.ts packages/db/src/repositories/entities-query.ts packages/db/test/repositories.test.ts apps/console/src/api/types.ts apps/console/src/components/UsersUserList.tsx apps/console/src/components/UsersUserDetail.tsx apps/console/src/components/EntitiesTenantList.tsx apps/console/src/components/EntitiesTenantDetail.tsx apps/console/src/components/UsersInvestigationPanel.test.tsx apps/console/src/components/EntitiesInvestigationPanel.test.tsx
git commit -m "feat: show user and tenant traits"
```

## Task 5: Touch Profiles From Telemetry Writes

**Files:**
- Modify: `packages/db/src/repositories/telemetry-writes.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Add failing last-seen tests**

Add a test that inserts an event with `userId` and `tenantId`, then checks both profile rows exist with empty traits and matching `last_seen_at`.

- [ ] **Step 2: Implement profile touch helper**

In `telemetry-writes.ts`, import:

```ts
import { touchTenantProfileLastSeen, touchUserProfileLastSeen } from "./identity-profiles.js";
```

Add:

```ts
async function touchProfiles(db: Db, input: TelemetryBaseInput): Promise<void> {
  if (input.userId) {
    await touchUserProfileLastSeen(db, {
      projectId: input.projectId,
      environmentId: input.environmentId,
      userId: input.userId,
      tenantId: input.tenantId,
      timestamp: input.timestamp
    });
  }
  if (input.tenantId) {
    await touchTenantProfileLastSeen(db, {
      projectId: input.projectId,
      environmentId: input.environmentId,
      tenantId: input.tenantId,
      timestamp: input.timestamp
    });
  }
}
```

Call `await touchProfiles(db, input)` after successful inserts for events, traces, spans, LLM calls, and breadcrumbs. In `insertError`, call it inside the existing transaction after the error insert.

- [ ] **Step 3: Run telemetry write tests**

Run:

```bash
pnpm vitest run packages/db/test/repositories.test.ts -t "last seen|telemetry"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/repositories/telemetry-writes.ts packages/db/test/repositories.test.ts
git commit -m "feat: update identity last seen from telemetry"
```

## Task 6: Documentation

**Files:**
- Modify: `README.md`
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `.claude/docs/STACK.md`
- Modify: `.claude/docs/CONSTRAINTS.md`
- Modify: `.claude/docs/SECRETS.md`

- [ ] **Step 1: Add README identify recipe**

Add:

```md
### Identify Users And Tenants

Use identify calls to persist display traits:

```ts
signalMonitor.identifyUser("user_123", {
  name: "Ana Souza",
  role: "admin",
  plan: "pro"
}, {
  tenantId: "tenant_123"
});

signalMonitor.identifyTenant("tenant_123", {
  name: "MicroERP",
  plan: "pro",
  operation_mode: "production"
});

await signalMonitor.flush();
```

Traits are sanitized before storage. Telemetry with `userId` or `tenantId` updates last-seen timestamps but does not overwrite traits.
```

- [ ] **Step 2: Update architecture docs**

Document:

- profile tables are project/environment scoped
- identify endpoints use project API keys
- traits are sanitized
- telemetry writes update last seen only
- Users and Entities show trait labels and key chips

- [ ] **Step 3: Update secrets docs**

State that identify uses existing project API keys and adds no new secrets or environment variables.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md .claude/docs/ARCHITECTURE.md .claude/docs/PROJECT-SUMMARY.md .claude/docs/STACK.md .claude/docs/CONSTRAINTS.md .claude/docs/SECRETS.md
git commit -m "docs: document identify traits"
```

## Final Verification

- [ ] Run focused suites:

```bash
pnpm vitest run packages/telemetry/test/ingestion-schemas.test.ts packages/sdk/test/client.test.ts packages/sdk/test/mapping.test.ts packages/sdk/test/contract.test.ts apps/api/test/identify.test.ts apps/api/test/docs.test.ts packages/db/test/repositories.test.ts apps/console/src/components/UsersInvestigationPanel.test.tsx apps/console/src/components/EntitiesInvestigationPanel.test.tsx
```

- [ ] Run full suites:

```bash
pnpm test
pnpm build
git diff --check
```

- [ ] Confirm OpenAPI exposes both identify endpoints.

- [ ] Confirm the console shows persisted labels and key traits for one user and one tenant seeded through identify calls.
