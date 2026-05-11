# Phase 5C Session Timeline and Breadcrumbs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe session breadcrumbs and an error-detail session timeline so operators can understand what happened around a session without full replay.

**Architecture:** Breadcrumbs become a new scoped telemetry signal stored in Postgres, ingested through the existing API-key and worker queue path, and retained through the worker retention scheduler. A session timeline repository combines breadcrumbs with existing events, errors, traces, and LLM calls for a single session, and the console renders that timeline from raw error details when a selected error has `session_id`.

**Tech Stack:** TypeScript, Fastify, Zod, Kysely/Postgres, BullMQ, React/Vite, Vitest, pnpm.

---

## File Structure

- `packages/db/migrations/0007_breadcrumbs.sql`: creates `breadcrumbs`, adds breadcrumb retention columns to `retention_runs`, and adds timeline indexes.
- `packages/db/src/migrate.ts`: registers migration 0007.
- `packages/db/src/schema.ts`: adds `BreadcrumbsTable`, `RetentionRunsTable.deleted_breadcrumbs`, and `RetentionRunsTable.breadcrumbs_days`.
- `packages/config/src/index.ts`: adds `RETENTION_BREADCRUMBS_DAYS` with default `30`.
- `.env.example`: documents `RETENTION_BREADCRUMBS_DAYS=30`.
- `packages/db/src/repositories/telemetry-writes.ts`: adds `InsertBreadcrumbInput` and `insertBreadcrumb`.
- `packages/db/src/repositories/system.ts`: includes breadcrumbs in retention policy, deleted counts, retention run records, and deletion execution.
- `packages/telemetry/src/ingestion-schemas.ts`: adds `breadcrumbPayloadSchema` and `BreadcrumbPayload`.
- `packages/queues/src/telemetry-queue.ts`: adds `breadcrumb` to `TelemetryJobKind`.
- `apps/api/src/routes/ingestion.ts`: registers `POST /v1/breadcrumbs`.
- `apps/worker/src/telemetry-worker.ts`: validates and persists breadcrumb jobs.
- `apps/worker/src/main.ts`: wires `insertBreadcrumb` and breadcrumb retention policy.
- `apps/api/src/main.ts`: wires `insertBreadcrumb` and `getSessionTimeline`.
- `packages/db/src/repositories/session-timeline.ts`: creates mixed session timeline query over breadcrumbs, events, errors, traces, and LLM calls.
- `apps/api/src/routes/query.ts`: adds `GET /query/sessions/:sessionId/timeline`.
- `packages/sdk/src/types.ts`: adds breadcrumb types and client method.
- `packages/sdk/src/mapping.ts`: adds `createBreadcrumbSignal`.
- `packages/sdk/src/client.ts`: exposes `client.breadcrumb`.
- `packages/sdk/src/browser-breadcrumbs.ts`: optional browser helper with safe capture utilities.
- `packages/sdk/src/index.ts`: exports breadcrumb types, mapping helper, and browser helper.
- `apps/console/src/api/types.ts`: adds session timeline response and item types.
- `apps/console/src/api/client.ts`: adds `getSessionTimeline`.
- `apps/console/src/components/SessionTimeline.tsx`: renders mixed session timeline items.
- `apps/console/src/components/ErrorDetailDrawer.tsx`: accepts and renders session timeline props.
- `apps/console/src/components/ErrorRawOccurrencesPanel.tsx`: loads session timeline around selected raw error.
- `apps/console/src/styles.css`: styles compact session timeline.
- Docs: `README.md`, `.claude/docs/ARCHITECTURE.md`, `.claude/docs/PROJECT-SUMMARY.md`, `.claude/docs/SECRETS.md`, `.claude/docs/UI-UX.md`, `.claude/docs/STACK.md`, and `CLAUDE.md`.

## Task 1: Breadcrumb Schema and Retention Configuration

**Files:**
- Create: `packages/db/migrations/0007_breadcrumbs.sql`
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `.env.example`
- Test: `packages/db/test/repositories.test.ts`
- Test: `packages/config/test/config.test.ts`

- [x] **Step 1: Write failing DB migration test**

Add to `packages/db/test/repositories.test.ts`:

```ts
it("runs breadcrumb migrations", async () => {
  await sql`select id, type, category, message, level, data from breadcrumbs limit 0`.execute(db);
  await sql`select deleted_breadcrumbs, breadcrumbs_days from retention_runs limit 0`.execute(db);
});
```

- [x] **Step 2: Write failing config test**

Add to `packages/config/test/config.test.ts`:

```ts
it("loads breadcrumb retention config with defaults and overrides", () => {
  const defaults = loadConfig(baseEnv);
  expect(defaults.retention.breadcrumbsDays).toBe(30);

  const custom = loadConfig({ ...baseEnv, RETENTION_BREADCRUMBS_DAYS: "14" });
  expect(custom.retention.breadcrumbsDays).toBe(14);
});
```

- [x] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts packages/config/test/config.test.ts
```

Expected: migration test fails because `breadcrumbs` does not exist; config test fails because `breadcrumbsDays` is missing.

- [x] **Step 4: Add migration 0007**

Create `packages/db/migrations/0007_breadcrumbs.sql`:

```sql
CREATE TABLE IF NOT EXISTS breadcrumbs (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id text NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  tenant_id text,
  user_id text,
  session_id text,
  trace_id text,
  timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  source text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  type text NOT NULL,
  category text,
  message text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (type IN ('navigation', 'click', 'console', 'network', 'custom')),
  CHECK (level IN ('debug', 'info', 'warning', 'error', 'fatal'))
);

CREATE INDEX breadcrumbs_scope_session_timestamp_idx
  ON breadcrumbs(project_id, environment_id, session_id, timestamp ASC, id ASC)
  WHERE session_id IS NOT NULL;

CREATE INDEX breadcrumbs_scope_timestamp_idx
  ON breadcrumbs(project_id, environment_id, timestamp DESC);

ALTER TABLE retention_runs
  ADD COLUMN IF NOT EXISTS deleted_breadcrumbs integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS breadcrumbs_days integer NOT NULL DEFAULT 30;
```

- [x] **Step 5: Register migration**

Modify `packages/db/src/migrate.ts`:

```ts
const migrations = [
  { name: "0001_initial.sql", url: new URL("../migrations/0001_initial.sql", import.meta.url) },
  { name: "0002_operational_safety.sql", url: new URL("../migrations/0002_operational_safety.sql", import.meta.url) },
  { name: "0003_simple_alerts.sql", url: new URL("../migrations/0003_simple_alerts.sql", import.meta.url) },
  { name: "0004_backup_runs.sql", url: new URL("../migrations/0004_backup_runs.sql", import.meta.url) },
  { name: "0005_error_groups.sql", url: new URL("../migrations/0005_error_groups.sql", import.meta.url) },
  { name: "0006_source_maps.sql", url: new URL("../migrations/0006_source_maps.sql", import.meta.url) },
  { name: "0007_breadcrumbs.sql", url: new URL("../migrations/0007_breadcrumbs.sql", import.meta.url) }
];
```

- [x] **Step 6: Update schema types**

Add to `packages/db/src/schema.ts`:

```ts
export interface BreadcrumbsTable {
  id: string;
  project_id: string;
  environment_id: string;
  tenant_id: string | null;
  user_id: string | null;
  session_id: string | null;
  trace_id: string | null;
  timestamp: Timestamp;
  received_at: Timestamp;
  source: string | null;
  release: string | null;
  metadata: JsonColumn;
  type: "navigation" | "click" | "console" | "network" | "custom";
  category: string | null;
  message: string;
  level: "debug" | "info" | "warning" | "error" | "fatal";
  data: JsonColumn;
}
```

Update `RetentionRunsTable`:

```ts
deleted_breadcrumbs: DefaultedInteger;
breadcrumbs_days: number;
```

Update `Database`:

```ts
breadcrumbs: BreadcrumbsTable;
```

- [x] **Step 7: Update config**

Modify `packages/config/src/index.ts`:

```ts
RETENTION_BREADCRUMBS_DAYS: optionalPositiveInteger(30),
```

and return:

```ts
retention: {
  enabled: parsed.RETENTION_ENABLED,
  intervalMinutes: parsed.RETENTION_INTERVAL_MINUTES,
  batchSize: parsed.RETENTION_BATCH_SIZE,
  eventsDays: parsed.RETENTION_EVENTS_DAYS,
  errorsDays: parsed.RETENTION_ERRORS_DAYS,
  tracesDays: parsed.RETENTION_TRACES_DAYS,
  spansDays: parsed.RETENTION_SPANS_DAYS,
  llmCallsDays: parsed.RETENTION_LLM_CALLS_DAYS,
  breadcrumbsDays: parsed.RETENTION_BREADCRUMBS_DAYS
},
```

Add to `.env.example`:

```dotenv
RETENTION_BREADCRUMBS_DAYS=30
```

- [x] **Step 8: Run focused tests**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts packages/config/test/config.test.ts
```

Expected: tests pass.

- [x] **Step 9: Commit**

```bash
git add .env.example packages/config/src/index.ts packages/config/test/config.test.ts packages/db/migrations/0007_breadcrumbs.sql packages/db/src/migrate.ts packages/db/src/schema.ts packages/db/test/repositories.test.ts
git commit -m "feat: add breadcrumb storage config"
```

## Task 2: Breadcrumb Ingestion and Persistence

**Files:**
- Modify: `packages/telemetry/src/ingestion-schemas.ts`
- Modify: `packages/queues/src/telemetry-queue.ts`
- Modify: `packages/db/src/repositories/telemetry-writes.ts`
- Modify: `apps/api/src/routes/ingestion.ts`
- Modify: `apps/worker/src/telemetry-worker.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/api/src/main.ts`
- Test: `packages/telemetry/test/ingestion-schemas.test.ts`
- Test: `packages/queues/test/telemetry-queue.test.ts`
- Test: `packages/db/test/repositories.test.ts`
- Test: `apps/api/test/ingestion.test.ts`
- Test: `apps/worker/test/telemetry-worker.test.ts`

- [x] **Step 1: Write failing ingestion schema test**

Add to `packages/telemetry/test/ingestion-schemas.test.ts`:

```ts
it("validates breadcrumb payloads", () => {
  const parsed = breadcrumbPayloadSchema.parse({
    timestamp: "2026-05-11T12:00:00.000Z",
    session_id: "sess_1",
    type: "navigation",
    category: "route",
    message: "Navigated to /checkout",
    data: { from: "/cart", to: "/checkout" }
  });

  expect(parsed.level).toBe("info");
  expect(parsed.metadata).toEqual({});
  expect(parsed.data).toEqual({ from: "/cart", to: "/checkout" });
});

it("rejects unsupported breadcrumb types and oversized messages", () => {
  expect(() => breadcrumbPayloadSchema.parse({ type: "dom", message: "bad" })).toThrow();
  expect(() => breadcrumbPayloadSchema.parse({ type: "custom", message: "x".repeat(2001) })).toThrow();
});
```

- [x] **Step 2: Write failing API ingestion test**

Add to `apps/api/test/ingestion.test.ts`:

```ts
it("accepts breadcrumb ingestion", async () => {
  const enqueue = vi.fn(async () => undefined);
  const app = buildTestApp({
    ingestion: {
      verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
      enqueue
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/breadcrumbs",
    headers: { authorization: "Bearer sh_test" },
    payload: {
      session_id: "sess_1",
      type: "custom",
      category: "checkout",
      message: "Selected shipping method",
      level: "info",
      data: { method: "standard" }
    }
  });

  expect(response.statusCode).toBe(202);
  expect(enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "breadcrumb",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: expect.objectContaining({ type: "custom", message: "Selected shipping method" })
    })
  );
});
```

- [x] **Step 3: Write failing worker/repository test**

Add to `apps/worker/test/telemetry-worker.test.ts`:

```ts
it("persists sanitized breadcrumb jobs", async () => {
  const writer = {
    insertEvent: vi.fn(),
    insertError: vi.fn(),
    insertLlmCall: vi.fn(),
    insertTrace: vi.fn(),
    insertSpan: vi.fn(),
    insertBreadcrumb: vi.fn()
  };

  await processTelemetryJob(
    {
      kind: "breadcrumb",
      id: "brd_1",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        timestamp: "2026-05-11T12:00:00.000Z",
        session_id: "sess_1",
        type: "console",
        category: "browser",
        message: "Failed password=secret",
        level: "error",
        data: { token: "abc", nested: { authorization: "Bearer secret" } }
      }
    },
    writer
  );

  expect(writer.insertBreadcrumb).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "brd_1",
      sessionId: "sess_1",
      type: "console",
      category: "browser",
      message: "Failed password=[REDACTED]",
      level: "error",
      data: expect.any(Object)
    })
  );
});
```

- [x] **Step 4: Run tests to verify failure**

Run:

```bash
pnpm exec vitest run packages/telemetry/test/ingestion-schemas.test.ts apps/api/test/ingestion.test.ts apps/worker/test/telemetry-worker.test.ts
```

Expected: failures for missing schema, route, queue kind, and writer method.

- [x] **Step 5: Add telemetry schema**

Modify `packages/telemetry/src/ingestion-schemas.ts`:

```ts
export const breadcrumbPayloadSchema = sharedEnvelopeSchema.extend({
  type: z.enum(["navigation", "click", "console", "network", "custom"]),
  category: shortTextSchema.optional(),
  message: mediumTextSchema,
  level: z.enum(["debug", "info", "warning", "error", "fatal"]).default("info"),
  data: jsonObjectSchema
});

export type BreadcrumbPayload = z.infer<typeof breadcrumbPayloadSchema>;
```

- [x] **Step 6: Add queue kind**

Modify `packages/queues/src/telemetry-queue.ts`:

```ts
export type TelemetryJobKind = "event" | "error" | "llm" | "trace" | "span" | "breadcrumb";
```

- [x] **Step 7: Add DB write repository support**

Modify `packages/db/src/repositories/telemetry-writes.ts`:

```ts
export interface InsertBreadcrumbInput extends TelemetryBaseInput {
  type: "navigation" | "click" | "console" | "network" | "custom";
  category?: string;
  message: string;
  level: "debug" | "info" | "warning" | "error" | "fatal";
  data?: unknown;
}

export async function insertBreadcrumb(db: Db, input: InsertBreadcrumbInput): Promise<void> {
  await db
    .insertInto("breadcrumbs")
    .values({
      ...baseColumns(input),
      type: input.type,
      category: nullable(input.category),
      message: input.message,
      level: input.level,
      data: input.data ?? {}
    })
    .execute();
}
```

- [x] **Step 8: Register API ingestion route**

Modify `apps/api/src/routes/ingestion.ts` imports and route config:

```ts
import {
  breadcrumbPayloadSchema,
  errorPayloadSchema,
  eventPayloadSchema,
  llmCallPayloadSchema,
  spanPayloadSchema,
  tracePayloadSchema
} from "@signal-hub/telemetry/ingestion-schemas";
```

```ts
{ path: "/v1/breadcrumbs", kind: "breadcrumb", idPrefix: "brd", schema: breadcrumbPayloadSchema }
```

- [x] **Step 9: Process worker breadcrumb jobs**

Modify `apps/worker/src/telemetry-worker.ts` imports and writer type:

```ts
import {
  breadcrumbPayloadSchema,
  eventPayloadSchema,
  errorPayloadSchema,
  llmCallPayloadSchema,
  spanPayloadSchema,
  tracePayloadSchema
} from "@signal-hub/telemetry/ingestion-schemas";
```

```ts
import type {
  InsertBreadcrumbInput,
  InsertErrorInput,
  InsertEventInput,
  InsertLlmCallInput,
  InsertSpanInput,
  InsertTraceInput
} from "@signal-hub/db/repositories/telemetry-writes.js";
```

```ts
insertBreadcrumb(input: InsertBreadcrumbInput): Promise<void>;
```

Add switch case:

```ts
case "breadcrumb": {
  const payload = breadcrumbPayloadSchema.parse(job.payload);
  await writer.insertBreadcrumb({
    ...baseInput(job, payload, receivedAt),
    type: payload.type,
    category: payload.category,
    message: sanitizePreviewText(payload.message) ?? "breadcrumb",
    level: payload.level,
    data: sanitizeValue(payload.data)
  });
  return;
}
```

- [x] **Step 10: Wire main services**

Modify `apps/worker/src/main.ts` and `apps/api/src/main.ts` telemetry writer imports to include `insertBreadcrumb`, then add:

```ts
insertBreadcrumb: (input) => insertBreadcrumb(db, input)
```

- [x] **Step 11: Run focused tests**

Run:

```bash
pnpm exec vitest run packages/telemetry/test/ingestion-schemas.test.ts packages/queues/test/telemetry-queue.test.ts packages/db/test/repositories.test.ts apps/api/test/ingestion.test.ts apps/worker/test/telemetry-worker.test.ts
```

Expected: tests pass.

- [x] **Step 12: Commit**

```bash
git add packages/telemetry/src/ingestion-schemas.ts packages/telemetry/test/ingestion-schemas.test.ts packages/queues/src/telemetry-queue.ts packages/queues/test/telemetry-queue.test.ts packages/db/src/repositories/telemetry-writes.ts packages/db/test/repositories.test.ts apps/api/src/routes/ingestion.ts apps/api/test/ingestion.test.ts apps/worker/src/telemetry-worker.ts apps/worker/src/main.ts apps/worker/test/telemetry-worker.test.ts apps/api/src/main.ts
git commit -m "feat: add breadcrumb ingestion"
```

## Task 3: Breadcrumb Retention

**Files:**
- Modify: `packages/db/src/repositories/system.ts`
- Modify: `apps/worker/src/retention.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/api/src/system-health.ts`
- Modify: `apps/api/test/system.test.ts`
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/components/SystemHealthPanel.test.tsx`
- Test: `packages/db/test/repositories.test.ts`
- Test: `apps/worker/test/telemetry-worker.test.ts`

- [x] **Step 1: Write failing retention repository test**

Add to `packages/db/test/repositories.test.ts`:

```ts
it("deletes expired breadcrumbs during retention", async () => {
  await insertBreadcrumb(db, {
    id: "brd_old",
    projectId: "prj_1",
    environmentId: "env_1",
    sessionId: "sess_1",
    timestamp: new Date("2026-04-01T00:00:00.000Z"),
    receivedAt: new Date("2026-04-01T00:00:00.000Z"),
    type: "custom",
    message: "old",
    level: "info",
    data: {}
  });
  await insertBreadcrumb(db, {
    id: "brd_new",
    projectId: "prj_1",
    environmentId: "env_1",
    sessionId: "sess_1",
    timestamp: new Date("2026-05-10T00:00:00.000Z"),
    receivedAt: new Date("2026-05-10T00:00:00.000Z"),
    type: "custom",
    message: "new",
    level: "info",
    data: {}
  });

  const deleted = await deleteExpiredTelemetry(db, {
    now: new Date("2026-05-11T00:00:00.000Z"),
    batchSize: 100,
    eventsDays: 90,
    errorsDays: 180,
    tracesDays: 90,
    spansDays: 90,
    llmCallsDays: 180,
    breadcrumbsDays: 30
  });

  expect(deleted.breadcrumbs).toBe(1);
  await expect(db.selectFrom("breadcrumbs").select("id").where("id", "=", "brd_old").executeTakeFirst()).resolves.toBeUndefined();
  await expect(db.selectFrom("breadcrumbs").select("id").where("id", "=", "brd_new").executeTakeFirst()).resolves.toBeTruthy();
});
```

- [x] **Step 2: Run retention tests to verify failure**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts apps/worker/test/telemetry-worker.test.ts apps/api/test/system.test.ts
```

Expected: failures for missing `breadcrumbs` deleted counts and policy fields.

- [x] **Step 3: Update retention types and deletion**

Modify `packages/db/src/repositories/system.ts`:

```ts
export type RetentionPolicy = {
  eventsDays: number;
  errorsDays: number;
  tracesDays: number;
  spansDays: number;
  llmCallsDays: number;
  breadcrumbsDays: number;
};

export type RetentionDeletedCounts = {
  events: number;
  errors: number;
  traces: number;
  spans: number;
  llmCalls: number;
  breadcrumbs: number;
};
```

Update `toRetentionRunRecord`:

```ts
deleted: {
  events: row.deleted_events,
  errors: row.deleted_errors,
  traces: row.deleted_traces,
  spans: row.deleted_spans,
  llmCalls: row.deleted_llm_calls,
  breadcrumbs: row.deleted_breadcrumbs
},
policy: {
  eventsDays: row.events_days,
  errorsDays: row.errors_days,
  tracesDays: row.traces_days,
  spansDays: row.spans_days,
  llmCallsDays: row.llm_calls_days,
  breadcrumbsDays: row.breadcrumbs_days
}
```

Update `deleteExpiredTelemetry` return:

```ts
breadcrumbs: await deleteExpiredBatchesFromTable(
  db,
  "breadcrumbs",
  cutoff(options.breadcrumbsDays),
  options.batchSize,
  maxBatches
)
```

Update `recordRetentionRun` insert:

```ts
deleted_breadcrumbs: input.deleted.breadcrumbs,
breadcrumbs_days: input.policy.breadcrumbsDays
```

- [x] **Step 4: Update worker zero counts and policy**

Modify `apps/worker/src/retention.ts`:

```ts
const zeroDeleted: RetentionDeletedCounts = { events: 0, errors: 0, traces: 0, spans: 0, llmCalls: 0, breadcrumbs: 0 };
```

Modify `apps/worker/src/main.ts` retention policy:

```ts
breadcrumbsDays: config.retention.breadcrumbsDays
```

- [x] **Step 5: Update system health types/tests**

Where `policy` is asserted in `apps/api/test/system.test.ts`, add:

```ts
breadcrumbsDays: 30
```

Where deleted counts are asserted, add:

```ts
breadcrumbs: 0
```

Update `apps/console/src/api/types.ts` system health retention types so `policy` and `deleted` include `breadcrumbsDays` and `breadcrumbs`.

- [x] **Step 6: Run focused tests**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts apps/worker/test/telemetry-worker.test.ts apps/api/test/system.test.ts apps/console/src/components/SystemHealthPanel.test.tsx
```

Expected: tests pass.

- [x] **Step 7: Commit**

```bash
git add packages/db/src/repositories/system.ts packages/db/test/repositories.test.ts apps/worker/src/retention.ts apps/worker/src/main.ts apps/worker/test/telemetry-worker.test.ts apps/api/src/system-health.ts apps/api/test/system.test.ts apps/console/src/api/types.ts apps/console/src/components/SystemHealthPanel.test.tsx
git commit -m "feat: retain breadcrumbs safely"
```

## Task 4: Session Timeline Repository

**Files:**
- Create: `packages/db/src/repositories/session-timeline.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [x] **Step 1: Write failing timeline repository tests**

Add to `packages/db/test/repositories.test.ts`:

```ts
it("returns a mixed session timeline around a center timestamp", async () => {
  await insertEvent(db, {
    id: "evt_session",
    projectId: "prj_1",
    environmentId: "env_1",
    sessionId: "sess_1",
    timestamp: new Date("2026-05-11T11:59:00.000Z"),
    receivedAt: new Date("2026-05-11T11:59:01.000Z"),
    name: "checkout_started",
    properties: {}
  });
  await insertBreadcrumb(db, {
    id: "brd_session",
    projectId: "prj_1",
    environmentId: "env_1",
    sessionId: "sess_1",
    timestamp: new Date("2026-05-11T12:00:00.000Z"),
    receivedAt: new Date("2026-05-11T12:00:01.000Z"),
    type: "click",
    category: "button",
    message: "Clicked Pay",
    level: "info",
    data: { tag: "button" }
  });
  await insertError(db, {
    id: "err_session",
    projectId: "prj_1",
    environmentId: "env_1",
    sessionId: "sess_1",
    timestamp: new Date("2026-05-11T12:01:00.000Z"),
    receivedAt: new Date("2026-05-11T12:01:01.000Z"),
    message: "Payment failed",
    severity: "error",
    context: {}
  });

  const timeline = await getSessionTimeline(db, {
    projectId: "prj_1",
    environmentId: "env_1",
    sessionId: "sess_1",
    center: new Date("2026-05-11T12:01:00.000Z"),
    beforeMs: 5 * 60 * 1000,
    afterMs: 60 * 1000,
    limit: 20
  });

  expect(timeline.items.map((item) => item.id)).toEqual(["evt_session", "brd_session", "err_session"]);
  expect(timeline.items.map((item) => item.type)).toEqual(["event", "breadcrumb", "error"]);
});

it("does not leak timeline items across project, environment, or session", async () => {
  const timeline = await getSessionTimeline(db, {
    projectId: "prj_1",
    environmentId: "env_1",
    sessionId: "missing",
    limit: 20
  });

  expect(timeline.items).toEqual([]);
});
```

- [x] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts
```

Expected: failure because `getSessionTimeline` does not exist.

- [x] **Step 3: Add repository**

Create `packages/db/src/repositories/session-timeline.ts`:

```ts
import { sql } from "kysely";
import type { Db } from "../client.js";

export type SessionTimelineItemType = "breadcrumb" | "event" | "error" | "trace" | "llm";

export type SessionTimelineFilters = {
  projectId: string;
  environmentId: string;
  sessionId: string;
  tenantId?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  center?: Date;
  beforeMs?: number;
  afterMs?: number;
  types?: SessionTimelineItemType[];
  limit?: number;
};

export type SessionTimelineItem = {
  id: string;
  type: SessionTimelineItemType;
  timestamp: Date;
  receivedAt: Date;
  tenantId: string | null;
  userId: string | null;
  sessionId: string;
  traceId: string | null;
  source: string | null;
  release: string | null;
  title: string;
  level: string | null;
  data: unknown;
};

export type SessionTimelineResponse = {
  sessionId: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string | null; to: string | null };
  items: SessionTimelineItem[];
  page: { nextCursor: string | null; previousCursor: string | null };
};

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 100;
  return Math.min(200, Math.max(1, Math.trunc(limit)));
}

function resolveRange(filters: SessionTimelineFilters): { from?: Date; to?: Date } {
  if (filters.center) {
    return {
      from: new Date(filters.center.getTime() - (filters.beforeMs ?? 10 * 60 * 1000)),
      to: new Date(filters.center.getTime() + (filters.afterMs ?? 2 * 60 * 1000))
    };
  }

  return { from: filters.from, to: filters.to };
}

export async function getSessionTimeline(db: Db, filters: SessionTimelineFilters): Promise<SessionTimelineResponse> {
  const range = resolveRange(filters);
  const selectedTypes = filters.types?.length ? filters.types : ["breadcrumb", "event", "error", "trace", "llm"];
  const rows = await sql<SessionTimelineItem>`
    with timeline as (
      select id, 'breadcrumb'::text as type, timestamp, received_at, tenant_id, user_id, session_id, trace_id, source, release,
        message as title, level, jsonb_build_object('breadcrumbType', type, 'category', category, 'data', data) as data
      from breadcrumbs
      where project_id = ${filters.projectId} and environment_id = ${filters.environmentId} and session_id = ${filters.sessionId}
      union all
      select id, 'event'::text as type, timestamp, received_at, tenant_id, user_id, session_id, trace_id, source, release,
        name as title, null::text as level, jsonb_build_object('properties', properties, 'metadata', metadata) as data
      from events
      where project_id = ${filters.projectId} and environment_id = ${filters.environmentId} and session_id = ${filters.sessionId}
      union all
      select id, 'error'::text as type, timestamp, received_at, tenant_id, user_id, session_id, trace_id, source, release,
        message as title, severity as level, jsonb_build_object('status', status, 'errorGroupId', error_group_id) as data
      from errors
      where project_id = ${filters.projectId} and environment_id = ${filters.environmentId} and session_id = ${filters.sessionId}
      union all
      select id, 'trace'::text as type, timestamp, received_at, tenant_id, user_id, session_id, trace_id, source, release,
        name as title, status as level, jsonb_build_object('durationMs', duration_ms) as data
      from traces
      where project_id = ${filters.projectId} and environment_id = ${filters.environmentId} and session_id = ${filters.sessionId}
      union all
      select id, 'llm'::text as type, timestamp, received_at, tenant_id, user_id, session_id, trace_id, source, release,
        coalesce(prompt_name, provider || ' ' || model) as title, status as level,
        jsonb_build_object('provider', provider, 'model', model, 'costUsd', cost_usd, 'latencyMs', latency_ms) as data
      from llm_calls
      where project_id = ${filters.projectId} and environment_id = ${filters.environmentId} and session_id = ${filters.sessionId}
    )
    select id, type, timestamp, received_at as "receivedAt", tenant_id as "tenantId", user_id as "userId",
      session_id as "sessionId", trace_id as "traceId", source, release, title, level, data
    from timeline
    where type = any(${selectedTypes})
      and (${range.from ?? null}::timestamptz is null or timestamp >= ${range.from ?? null})
      and (${range.to ?? null}::timestamptz is null or timestamp <= ${range.to ?? null})
      and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? null})
      and (${filters.userId ?? null}::text is null or user_id = ${filters.userId ?? null})
    order by timestamp asc, id asc
    limit ${resolveLimit(filters.limit)}
  `.execute(db);

  return {
    sessionId: filters.sessionId,
    scope: { projectId: filters.projectId, environmentId: filters.environmentId },
    range: { from: range.from?.toISOString() ?? null, to: range.to?.toISOString() ?? null },
    items: rows.rows,
    page: { nextCursor: null, previousCursor: null }
  };
}
```

- [x] **Step 4: Run repository tests**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts
```

Expected: tests pass.

- [x] **Step 5: Commit**

```bash
git add packages/db/src/repositories/session-timeline.ts packages/db/test/repositories.test.ts
git commit -m "feat: add session timeline repository"
```

## Task 5: Session Timeline Query API

**Files:**
- Modify: `apps/api/src/routes/query.ts`
- Modify: `apps/api/src/main.ts`
- Test: `apps/api/test/query.test.ts`

- [ ] **Step 1: Write failing route tests**

Add to `apps/api/test/query.test.ts`:

```ts
it("returns a session timeline for logged-in users", async () => {
  const getSessionTimeline = vi.fn(async () => ({
    sessionId: "sess_1",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-05-11T11:50:00.000Z", to: "2026-05-11T12:02:00.000Z" },
    items: [{ id: "brd_1", type: "breadcrumb", timestamp: "2026-05-11T12:00:00.000Z", title: "Clicked Pay" }],
    page: { nextCursor: null, previousCursor: null }
  }));
  const app = buildQueryTestApp({ query: { getSessionTimeline }, authUser: testUser });

  const response = await app.inject({
    method: "GET",
    url: "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1&center=2026-05-11T12%3A00%3A00.000Z&before=600&after=120&types=breadcrumb,error&limit=25"
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ data: expect.objectContaining({ sessionId: "sess_1" }) });
  expect(getSessionTimeline).toHaveBeenCalledWith({
    projectId: "prj_1",
    environmentId: "env_1",
    sessionId: "sess_1",
    center: new Date("2026-05-11T12:00:00.000Z"),
    beforeMs: 600_000,
    afterMs: 120_000,
    types: ["breadcrumb", "error"],
    limit: 25
  });
});

it("rejects invalid session timeline queries", async () => {
  const app = buildQueryTestApp({ query: { getSessionTimeline: vi.fn() }, authUser: testUser });
  const response = await app.inject({ method: "GET", url: "/query/sessions/sess_1/timeline?project_id=prj_1" });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: "invalid_query" });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm exec vitest run apps/api/test/query.test.ts
```

Expected: failure because the session timeline route is not registered yet.

- [ ] **Step 3: Add query dependency and parser**

Modify `apps/api/src/routes/query.ts`:

```ts
export type SessionTimelineType = "breadcrumb" | "event" | "error" | "trace" | "llm";

export type SessionTimelineFilters = {
  projectId: string;
  environmentId: string;
  sessionId: string;
  tenantId?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  center?: Date;
  beforeMs?: number;
  afterMs?: number;
  types?: SessionTimelineType[];
  limit: number;
};
```

Add to `QueryDependencies`:

```ts
getSessionTimeline?: (filters: SessionTimelineFilters) => Promise<unknown>;
```

Add parser:

```ts
const sessionParamsSchema = z.object({ sessionId: z.string().trim().min(1) });

function parsePositiveSeconds(raw: RawQuery, key: string): number | undefined | null {
  const value = optionalNonEmpty(raw, key);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed * 1000);
}

function parseSessionTimelineTypes(raw: RawQuery): SessionTimelineType[] | undefined | null {
  const value = optionalNonEmpty(raw, "types");
  if (!value) return undefined;
  const types = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (types.some((type) => !["breadcrumb", "event", "error", "trace", "llm"].includes(type))) return null;
  return types as SessionTimelineType[];
}

function parseSessionTimelineFilters(query: unknown, sessionId: string): SessionTimelineFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) return undefined;

  const from = parseDate(raw, "from");
  const to = parseDate(raw, "to");
  const center = parseDate(raw, "center");
  const beforeMs = parsePositiveSeconds(raw, "before");
  const afterMs = parsePositiveSeconds(raw, "after");
  const types = parseSessionTimelineTypes(raw);
  if (from === null || to === null || center === null || beforeMs === null || afterMs === null || types === null) {
    return undefined;
  }

  const filters: SessionTimelineFilters = { projectId, environmentId, sessionId, limit: parseLimit(raw) };
  const tenantId = optionalNonEmpty(raw, "tenant_id");
  const userId = optionalNonEmpty(raw, "user_id");
  if (tenantId) filters.tenantId = tenantId;
  if (userId) filters.userId = userId;
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (center) filters.center = center;
  if (beforeMs !== undefined) filters.beforeMs = beforeMs;
  if (afterMs !== undefined) filters.afterMs = afterMs;
  if (types) filters.types = types;
  return filters;
}
```

- [ ] **Step 4: Add route handler**

Add before aggregate routes in `registerQueryRoutes`:

```ts
app.get("/query/sessions/:sessionId/timeline", async (request, reply) => {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) return reply;

  if (!options.query?.getSessionTimeline) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = sessionParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  const filters = parseSessionTimelineFilters(request.query, params.data.sessionId);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getSessionTimeline(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
});
```

- [ ] **Step 5: Wire main**

Modify `apps/api/src/main.ts` imports:

```ts
import { getSessionTimeline } from "@signal-hub/db/repositories/session-timeline.js";
```

Add to query dependencies:

```ts
getSessionTimeline: (filters) => getSessionTimeline(db, filters)
```

- [ ] **Step 6: Run query tests**

Run:

```bash
pnpm exec vitest run apps/api/test/query.test.ts
```

Expected: tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/query.ts apps/api/src/main.ts apps/api/test/query.test.ts
git commit -m "feat: add session timeline query api"
```

## Task 6: SDK Manual Breadcrumbs and Browser Helper

**Files:**
- Modify: `packages/sdk/src/types.ts`
- Modify: `packages/sdk/src/mapping.ts`
- Modify: `packages/sdk/src/client.ts`
- Create: `packages/sdk/src/browser-breadcrumbs.ts`
- Modify: `packages/sdk/src/index.ts`
- Test: `packages/sdk/test/client.test.ts`
- Test: `packages/sdk/test/mapping.test.ts`
- Create: `packages/sdk/test/browser-breadcrumbs.test.ts`

- [ ] **Step 1: Write failing SDK mapping/client tests**

Add to `packages/sdk/test/mapping.test.ts`:

```ts
it("creates breadcrumb signals with merged context", () => {
  expect(
    createBreadcrumbSignal(
      { type: "custom", category: "checkout", message: "Selected shipping", data: { method: "standard" } },
      { sessionId: "sess_1" },
      { tenantId: "tenant_1", source: "web" }
    )
  ).toEqual({
    kind: "breadcrumb",
    endpointPath: "/v1/breadcrumbs",
    payload: {
      metadata: {},
      tenant_id: "tenant_1",
      session_id: "sess_1",
      source: "web",
      type: "custom",
      category: "checkout",
      message: "Selected shipping",
      data: { method: "standard" }
    }
  });
});
```

Add to `packages/sdk/test/client.test.ts`:

```ts
it("queues manual breadcrumbs", async () => {
  const fetch = vi.fn(async () => new Response("{}", { status: 202 }));
  const client = createSignalHubClient({
    endpoint: "https://signalhub.example.com",
    apiKey: "sh_test",
    fetch,
    defaultContext: { sessionId: "sess_1" }
  });

  client.breadcrumb({ type: "custom", message: "Opened checkout" });
  await client.flush();

  expect(fetch).toHaveBeenCalledWith(
    "https://signalhub.example.com/v1/breadcrumbs",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"session_id":"sess_1"')
    })
  );
});
```

- [ ] **Step 2: Write failing browser helper tests**

Create `packages/sdk/test/browser-breadcrumbs.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createBrowserBreadcrumbs, sanitizeBreadcrumbUrl, summarizeClickedElement } from "../src/browser-breadcrumbs.js";

describe("browser breadcrumbs", () => {
  it("redacts query values from URLs", () => {
    expect(sanitizeBreadcrumbUrl("https://app.example.com/checkout?token=secret&page=2#card")).toBe("/checkout?token=%5BREDACTED%5D&page=%5BREDACTED%5D");
  });

  it("summarizes clicks without input values", () => {
    const input = document.createElement("input");
    input.type = "email";
    input.value = "person@example.com";
    input.setAttribute("aria-label", "Email address");

    expect(summarizeClickedElement(input)).toEqual({
      tag: "input",
      role: null,
      label: "Email address",
      text: null
    });
  });

  it("captures enabled console errors", () => {
    const breadcrumb = vi.fn();
    const stop = createBrowserBreadcrumbs({ breadcrumb } as never, { console: true, navigation: false, clicks: false, network: false });
    console.error("Checkout failed password=secret");
    stop();
    expect(breadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ type: "console", level: "error", message: expect.stringContaining("Checkout failed") })
    );
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm exec vitest run packages/sdk/test/mapping.test.ts packages/sdk/test/client.test.ts packages/sdk/test/browser-breadcrumbs.test.ts
```

Expected: failures for missing breadcrumb types, signal mapping, client method, and browser helper.

- [ ] **Step 4: Add SDK types**

Modify `packages/sdk/src/types.ts`:

```ts
export type BreadcrumbType = "navigation" | "click" | "console" | "network" | "custom";
export type BreadcrumbLevel = "debug" | "info" | "warning" | "error" | "fatal";

export type BreadcrumbInput = {
  type: BreadcrumbType;
  category?: string;
  message: string;
  level?: BreadcrumbLevel;
  data?: SignalMetadata;
  timestamp?: Date | string;
};
```

Add to `SignalHubClient`:

```ts
breadcrumb: (input: BreadcrumbInput, context?: SignalContext) => void;
```

Update `SignalKind`:

```ts
export type SignalKind = "event" | "error" | "llm" | "trace" | "span" | "breadcrumb";
```

- [ ] **Step 5: Add mapping**

Modify `packages/sdk/src/mapping.ts`:

```ts
import type {
  BreadcrumbInput,
  ErrorInput,
  EventInput,
  LlmInput,
  QueuedSignal,
  SignalContext,
  SignalMetadata,
  SpanInput,
  TraceInput
} from "./types.js";
```

Add:

```ts
export function createBreadcrumbSignal(
  input: BreadcrumbInput,
  context?: SignalContext,
  defaultContext?: SignalContext
): QueuedSignal {
  const payload = {
    ...mergeContext(defaultContext, { ...context, timestamp: input.timestamp }),
    type: input.type,
    message: input.message,
    data: input.data ?? {}
  };

  assignDefined(payload, "category", input.category);
  assignDefined(payload, "level", input.level);

  return {
    kind: "breadcrumb",
    endpointPath: "/v1/breadcrumbs",
    payload
  };
}
```

- [ ] **Step 6: Add client method**

Modify `packages/sdk/src/client.ts` imports and returned client:

```ts
import {
  createBreadcrumbSignal,
  createErrorSignal,
  createEventSignal,
  createLlmSignal,
  createSpanSignal,
  createTraceSignal
} from "./mapping.js";
```

```ts
BreadcrumbInput,
```

```ts
breadcrumb(input: BreadcrumbInput, context?: SignalContext): void {
  enqueue(createBreadcrumbSignal(input, context, defaultContext));
},
```

- [ ] **Step 7: Add browser helper**

Create `packages/sdk/src/browser-breadcrumbs.ts`:

```ts
import type { BreadcrumbInput, SignalHubClient } from "./types.js";

export type BrowserBreadcrumbOptions = {
  navigation?: boolean;
  clicks?: boolean;
  console?: boolean;
  network?: boolean;
  maxBreadcrumbsPerMinute?: number;
};

export type StopBrowserBreadcrumbs = () => void;

export function sanitizeBreadcrumbUrl(value: string): string {
  try {
    const url = new URL(value, globalThis.location?.href ?? "http://localhost");
    const params = new URLSearchParams();
    url.searchParams.forEach((_paramValue, key) => {
      params.set(key, "[REDACTED]");
    });
    const query = params.toString();
    return `${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return "[invalid-url]";
  }
}

function compactText(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 120) : null;
}

export function summarizeClickedElement(element: Element): { tag: string; role: string | null; label: string | null; text: string | null } {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute("role");
  const label = compactText(element.getAttribute("aria-label"));
  const text = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
    ? null
    : compactText(element.textContent);

  return { tag, role, label, text };
}

export function createBrowserBreadcrumbs(client: Pick<SignalHubClient, "breadcrumb">, options: BrowserBreadcrumbOptions = {}): StopBrowserBreadcrumbs {
  const disposers: Array<() => void> = [];
  const maxPerMinute = options.maxBreadcrumbsPerMinute ?? 120;
  let windowStartedAt = Date.now();
  let emitted = 0;

  const emit = (input: BreadcrumbInput) => {
    const now = Date.now();
    if (now - windowStartedAt >= 60_000) {
      windowStartedAt = now;
      emitted = 0;
    }
    if (emitted >= maxPerMinute) return;
    emitted += 1;
    client.breadcrumb(input);
  };

  if (options.clicks) {
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element) {
        emit({ type: "click", category: "dom", message: "Clicked element", data: summarizeClickedElement(event.target) });
      }
    };
    document.addEventListener("click", onClick, true);
    disposers.push(() => document.removeEventListener("click", onClick, true));
  }

  if (options.console) {
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args: unknown[]) => {
      emit({ type: "console", category: "browser", level: "warning", message: args.map(String).join(" ").slice(0, 2000) });
      originalWarn.apply(console, args);
    };
    console.error = (...args: unknown[]) => {
      emit({ type: "console", category: "browser", level: "error", message: args.map(String).join(" ").slice(0, 2000) });
      originalError.apply(console, args);
    };
    disposers.push(() => {
      console.warn = originalWarn;
      console.error = originalError;
    });
  }

  return () => {
    for (const dispose of disposers.splice(0)) dispose();
  };
}
```

- [ ] **Step 8: Export SDK additions**

Modify `packages/sdk/src/index.ts`:

```ts
BreadcrumbInput,
BreadcrumbLevel,
BreadcrumbType,
```

```ts
createBreadcrumbSignal,
```

```ts
export {
  createBrowserBreadcrumbs,
  sanitizeBreadcrumbUrl,
  summarizeClickedElement
} from "./browser-breadcrumbs.js";
```

- [ ] **Step 9: Run SDK tests and build**

Run:

```bash
pnpm exec vitest run packages/sdk/test/mapping.test.ts packages/sdk/test/client.test.ts packages/sdk/test/browser-breadcrumbs.test.ts
pnpm --filter @signal-hub/sdk build
```

Expected: tests and SDK build pass.

- [ ] **Step 10: Commit**

```bash
git add packages/sdk/src/types.ts packages/sdk/src/mapping.ts packages/sdk/src/client.ts packages/sdk/src/browser-breadcrumbs.ts packages/sdk/src/index.ts packages/sdk/test/mapping.test.ts packages/sdk/test/client.test.ts packages/sdk/test/browser-breadcrumbs.test.ts
git commit -m "feat: add sdk breadcrumbs"
```

## Task 7: Console API Client for Session Timeline

**Files:**
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Test: `apps/console/src/api/client.test.ts`

- [ ] **Step 1: Write failing console client test**

Add to `apps/console/src/api/client.test.ts`:

```ts
it("gets a session timeline with scoped filters", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { sessionId: "sess_1", items: [], page: { nextCursor: null, previousCursor: null } } }));
  vi.stubGlobal("fetch", fetchMock);
  const client = createApiClient("/api");

  await client.getSessionTimeline("sess/1", {
    projectId: "prj/1",
    environmentId: "env 1",
    center: "2026-05-11T12:00:00.000Z",
    beforeSeconds: 600,
    afterSeconds: 120,
    types: ["breadcrumb", "error"],
    limit: 25
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/query/sessions/sess%2F1/timeline?project_id=prj%2F1&environment_id=env+1&center=2026-05-11T12%3A00%3A00.000Z&before=600&after=120&types=breadcrumb%2Cerror&limit=25",
    expect.objectContaining({ method: "GET" })
  );
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm exec vitest run apps/console/src/api/client.test.ts
```

Expected: `getSessionTimeline` is missing.

- [ ] **Step 3: Add console types**

Add to `apps/console/src/api/types.ts`:

```ts
export type SessionTimelineItemType = "breadcrumb" | "event" | "error" | "trace" | "llm";

export type SessionTimelineItem = {
  id: string;
  type: SessionTimelineItemType;
  timestamp: string;
  receivedAt: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string;
  traceId: string | null;
  source: string | null;
  release: string | null;
  title: string;
  level: string | null;
  data: unknown;
};

export type SessionTimelineQuery = {
  projectId: string;
  environmentId: string;
  tenantId?: string;
  userId?: string;
  from?: Date | string;
  to?: Date | string;
  center?: Date | string;
  beforeSeconds?: number;
  afterSeconds?: number;
  types?: SessionTimelineItemType[];
  limit?: number;
  cursor?: string;
};

export type SessionTimelineResponse = {
  sessionId: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string | null; to: string | null };
  items: SessionTimelineItem[];
  page: { nextCursor: string | null; previousCursor: string | null };
};
```

- [ ] **Step 4: Add client method**

Modify imports and `ApiClient` in `apps/console/src/api/client.ts`:

```ts
SessionTimelineQuery,
SessionTimelineResponse,
```

```ts
getSessionTimeline: (sessionId: string, query: SessionTimelineQuery) => Promise<AggregateResponse<SessionTimelineResponse>>;
```

Add path helper:

```ts
function sessionTimelinePath(sessionId: string, query: SessionTimelineQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  if (query.tenantId) params.set("tenant_id", query.tenantId);
  if (query.userId) params.set("user_id", query.userId);
  if (query.from) params.set("from", query.from instanceof Date ? query.from.toISOString() : query.from);
  if (query.to) params.set("to", query.to instanceof Date ? query.to.toISOString() : query.to);
  if (query.center) params.set("center", query.center instanceof Date ? query.center.toISOString() : query.center);
  if (query.beforeSeconds !== undefined) params.set("before", String(query.beforeSeconds));
  if (query.afterSeconds !== undefined) params.set("after", String(query.afterSeconds));
  if (query.types?.length) params.set("types", query.types.join(","));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  return `/query/sessions/${encodePathSegment(sessionId)}/timeline?${params.toString()}`;
}
```

Add to `createApiClient`:

```ts
getSessionTimeline: (sessionId, query) =>
  request<AggregateResponse<SessionTimelineResponse>>(path(apiBasePath, sessionTimelinePath(sessionId, query))),
```

- [ ] **Step 5: Run client tests**

Run:

```bash
pnpm exec vitest run apps/console/src/api/client.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts
git commit -m "feat: add session timeline console client"
```

## Task 8: Error Detail Session Timeline UI

**Files:**
- Create: `apps/console/src/components/SessionTimeline.tsx`
- Create: `apps/console/src/components/SessionTimeline.test.tsx`
- Modify: `apps/console/src/components/ErrorDetailDrawer.tsx`
- Modify: `apps/console/src/components/ErrorDetailDrawer.test.tsx`
- Modify: `apps/console/src/components/ErrorRawOccurrencesPanel.tsx`
- Modify: `apps/console/src/components/ErrorInvestigationPanel.test.tsx`
- Modify: `apps/console/src/styles.css`

- [ ] **Step 1: Write failing SessionTimeline component tests**

Create `apps/console/src/components/SessionTimeline.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionTimelineItem } from "../api/types";
import { SessionTimeline } from "./SessionTimeline";

const item = (overrides: Partial<SessionTimelineItem>): SessionTimelineItem => ({
  id: "brd_1",
  type: "breadcrumb",
  timestamp: "2026-05-11T12:00:00.000Z",
  receivedAt: "2026-05-11T12:00:01.000Z",
  tenantId: "tenant_1",
  userId: "user_1",
  sessionId: "sess_1",
  traceId: null,
  source: "web",
  release: "web@1.0.0",
  title: "Clicked Pay",
  level: "info",
  data: { breadcrumbType: "click", category: "button" },
  ...overrides
});

describe("SessionTimeline", () => {
  it("renders timeline items and highlights the selected error", () => {
    render(
      <SessionTimeline
        highlightedErrorId="err_1"
        isLoading={false}
        timeline={{
          sessionId: "sess_1",
          scope: { projectId: "prj_1", environmentId: "env_1" },
          range: { from: null, to: null },
          items: [item({ id: "brd_1", type: "breadcrumb", title: "Clicked Pay" }), item({ id: "err_1", type: "error", title: "Payment failed", level: "error" })],
          page: { nextCursor: null, previousCursor: null }
        }}
      />
    );

    expect(screen.getByText("Session context")).toBeInTheDocument();
    expect(screen.getByText("Clicked Pay")).toBeInTheDocument();
    expect(screen.getByText("Payment failed")).toBeInTheDocument();
    expect(screen.getByLabelText("Selected error timeline item")).toHaveTextContent("Payment failed");
  });

  it("renders quiet empty state", () => {
    render(<SessionTimeline isLoading={false} timeline={{ sessionId: "sess_1", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: null, to: null }, items: [], page: { nextCursor: null, previousCursor: null } }} />);
    expect(screen.getByText("No session context found.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write failing integration test**

Add to `apps/console/src/components/ErrorInvestigationPanel.test.tsx`:

```tsx
it("loads session context for a selected raw error with a session id", async () => {
  const getSessionTimeline = vi.fn().mockResolvedValue({
    data: {
      sessionId: "sess_1",
      scope: { projectId: "prj_1", environmentId: "env_1" },
      range: { from: null, to: null },
      items: [
        {
          id: "brd_1",
          type: "breadcrumb",
          timestamp: "2026-05-11T11:59:00.000Z",
          receivedAt: "2026-05-11T11:59:01.000Z",
          tenantId: null,
          userId: "user_1",
          sessionId: "sess_1",
          traceId: null,
          source: "web",
          release: "web@1.0.0",
          title: "Clicked Pay",
          level: "info",
          data: {}
        }
      ],
      page: { nextCursor: null, previousCursor: null }
    }
  });
  const client = makeClient({
    listErrors: vi.fn().mockResolvedValue({ data: [errorRecord({ id: "err_1", sessionId: "sess_1", timestamp: "2026-05-11T12:00:00.000Z" })] }),
    getSessionTimeline
  });

  render(<ErrorInvestigationPanel client={client} environmentId="env_1" initialTab="raw" projectId="prj_1" />);
  await userEvent.click(await screen.findByText("Payment failed"));

  expect(await screen.findByText("Session context")).toBeInTheDocument();
  expect(await screen.findByText("Clicked Pay")).toBeInTheDocument();
  expect(getSessionTimeline).toHaveBeenCalledWith("sess_1", {
    projectId: "prj_1",
    environmentId: "env_1",
    center: "2026-05-11T12:00:00.000Z",
    beforeSeconds: 600,
    afterSeconds: 120,
    limit: 100
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm exec vitest run apps/console/src/components/SessionTimeline.test.tsx apps/console/src/components/ErrorInvestigationPanel.test.tsx apps/console/src/components/ErrorDetailDrawer.test.tsx
```

Expected: `SessionTimeline` missing and `getSessionTimeline` not used.

- [ ] **Step 4: Create SessionTimeline component**

Create `apps/console/src/components/SessionTimeline.tsx`:

```tsx
import type { SessionTimelineResponse, SessionTimelineItem } from "../api/types";

type Props = {
  timeline?: SessionTimelineResponse;
  isLoading: boolean;
  error?: string | null;
  highlightedErrorId?: string;
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function itemLabel(item: SessionTimelineItem): string {
  if (item.type === "llm") return "LLM";
  return item.type.charAt(0).toUpperCase() + item.type.slice(1);
}

function levelClass(level: string | null): string {
  if (level === "error" || level === "fatal") return "status-pill status-pill--danger";
  if (level === "warning") return "status-pill status-pill--warning";
  return "status-pill status-pill--neutral";
}

export function SessionTimeline({ timeline, isLoading, error, highlightedErrorId }: Props) {
  return (
    <section className="session-timeline">
      <div className="section-header">
        <h3>Session context</h3>
      </div>
      {isLoading ? <p className="muted-text">Loading session context</p> : null}
      {error ? <p className="muted-text">{error}</p> : null}
      {!isLoading && !error && timeline && timeline.items.length === 0 ? <p className="muted-text">No session context found.</p> : null}
      {!isLoading && !error && timeline && timeline.items.length > 0 ? (
        <ol className="session-timeline__list" aria-label="Session context timeline">
          {timeline.items.map((item) => {
            const selected = item.type === "error" && item.id === highlightedErrorId;
            return (
              <li
                aria-label={selected ? "Selected error timeline item" : undefined}
                className={selected ? "session-timeline__item session-timeline__item--selected" : "session-timeline__item"}
                key={`${item.type}:${item.id}`}
              >
                <div className="session-timeline__meta">
                  <span className="session-timeline__time">{formatTimestamp(item.timestamp)}</span>
                  <span className={levelClass(item.level)}>{item.level ?? itemLabel(item)}</span>
                </div>
                <strong>{item.title}</strong>
                <p className="muted-text">{itemLabel(item)}{item.traceId ? ` · trace ${item.traceId}` : ""}</p>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 5: Wire ErrorDetailDrawer props**

Modify `apps/console/src/components/ErrorDetailDrawer.tsx`:

```tsx
import type { ErrorRecord, SessionTimelineResponse, SourceMapResolution } from "../api/types";
import { SessionTimeline } from "./SessionTimeline";
```

Update props:

```ts
sessionTimeline?: SessionTimelineResponse;
isLoadingSessionTimeline?: boolean;
sessionTimelineError?: string | null;
```

Render after source maps:

```tsx
{error.sessionId ? (
  <SessionTimeline
    error={sessionTimelineError}
    highlightedErrorId={error.id}
    isLoading={Boolean(isLoadingSessionTimeline)}
    timeline={sessionTimeline}
  />
) : null}
```

- [ ] **Step 6: Load timeline in raw occurrences panel**

Modify `apps/console/src/components/ErrorRawOccurrencesPanel.tsx` state:

```ts
const [sessionTimeline, setSessionTimeline] = useState<SessionTimelineResponse | undefined>();
const [isLoadingSessionTimeline, setIsLoadingSessionTimeline] = useState(false);
const [sessionTimelineError, setSessionTimelineError] = useState<string | null>(null);
```

Add effect:

```ts
useEffect(() => {
  let cancelled = false;
  setSessionTimeline(undefined);
  setSessionTimelineError(null);
  setIsLoadingSessionTimeline(false);

  if (!selectedError?.sessionId || !client.getSessionTimeline) {
    return () => {
      cancelled = true;
    };
  }

  setIsLoadingSessionTimeline(true);
  void client
    .getSessionTimeline(selectedError.sessionId, {
      projectId,
      environmentId,
      center: selectedError.timestamp,
      beforeSeconds: 600,
      afterSeconds: 120,
      limit: 100
    })
    .then(
      ({ data }) => {
        if (cancelled) return;
        setSessionTimeline(data);
        setIsLoadingSessionTimeline(false);
      },
      () => {
        if (cancelled) return;
        setSessionTimelineError("Session context unavailable.");
        setIsLoadingSessionTimeline(false);
      }
    );

  return () => {
    cancelled = true;
  };
}, [client, environmentId, projectId, selectedError]);
```

Pass props:

```tsx
<ErrorDetailDrawer
  error={selectedError}
  isResolvingSourceMap={isResolvingSourceMap}
  isLoadingSessionTimeline={isLoadingSessionTimeline}
  sessionTimeline={sessionTimeline}
  sessionTimelineError={sessionTimelineError}
  sourceMapResolution={sourceMapResolution}
/>
```

- [ ] **Step 7: Add styles**

Add to `apps/console/src/styles.css`:

```css
.session-timeline {
  border-top: 1px solid var(--border);
  margin-top: 1rem;
  padding-top: 1rem;
}

.session-timeline__list {
  display: grid;
  gap: 0.75rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.session-timeline__item {
  border-left: 3px solid var(--border);
  padding: 0.25rem 0 0.25rem 0.75rem;
}

.session-timeline__item--selected {
  border-left-color: var(--accent);
  background: var(--surface-subtle);
}

.session-timeline__meta {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.session-timeline__time {
  color: var(--muted);
  font-size: 0.85rem;
}
```

- [ ] **Step 8: Run console tests**

Run:

```bash
pnpm exec vitest run apps/console/src/components/SessionTimeline.test.tsx apps/console/src/components/ErrorDetailDrawer.test.tsx apps/console/src/components/ErrorInvestigationPanel.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: tests and console build pass.

- [ ] **Step 9: Commit**

```bash
git add apps/console/src/components/SessionTimeline.tsx apps/console/src/components/SessionTimeline.test.tsx apps/console/src/components/ErrorDetailDrawer.tsx apps/console/src/components/ErrorDetailDrawer.test.tsx apps/console/src/components/ErrorRawOccurrencesPanel.tsx apps/console/src/components/ErrorInvestigationPanel.test.tsx apps/console/src/styles.css
git commit -m "feat: show session context for errors"
```

## Task 9: Documentation and Memory

**Files:**
- Modify: `README.md`
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `.claude/docs/SECRETS.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/STACK.md`
- Modify: `CLAUDE.md`
- Modify external memory: `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`

- [ ] **Step 1: Update README**

Add a `Breadcrumbs and Session Context` section:

````md
## Breadcrumbs and Session Context

SignalHub supports lightweight breadcrumbs for session debugging. Breadcrumbs are structured telemetry records for navigation, safe clicks, console warnings/errors, failed or slow network summaries, and custom application steps.

Manual SDK example:

```ts
client.breadcrumb({
  type: "custom",
  category: "checkout",
  message: "Selected shipping method",
  data: { method: "standard" }
});
```

Breadcrumbs must not include secrets, raw form values, request bodies, response bodies, cookies, or headers. Browser auto-capture helpers sanitize URLs and element summaries, and network capture is disabled by default.
````

- [ ] **Step 2: Update architecture docs**

Add to `.claude/docs/ARCHITECTURE.md`:

```md
Breadcrumbs are stored in the `breadcrumbs` telemetry table. They use the same project, environment, tenant, user, session, trace, source, release, timestamp, received_at, and metadata envelope as other telemetry signals. The API accepts `POST /v1/breadcrumbs`, the worker persists sanitized rows, and `GET /query/sessions/:sessionId/timeline` returns a mixed session timeline across breadcrumbs, events, errors, traces, and LLM calls.
```

- [ ] **Step 3: Update project summary**

Set current phase to:

```md
Phase 5C: Session Timeline and Breadcrumbs.
```

Add implemented capability:

```md
- Lightweight breadcrumb ingestion, short retention, SDK manual breadcrumbs, optional safe browser breadcrumb helper, and error-detail session context timeline.
```

- [ ] **Step 4: Update secrets and UI docs**

Add to `.claude/docs/SECRETS.md`:

```md
- `RETENTION_BREADCRUMBS_DAYS` is not a secret. Breadcrumb payloads can still contain sensitive application data if callers misuse the API, so SDK/browser helpers sanitize aggressively and documentation forbids secrets, form values, bodies, cookies, and headers.
```

Add to `.claude/docs/UI-UX.md`:

```md
Raw error details show `Session context` only when a selected error has `session_id`. The timeline is compact, chronological, and highlights the selected error. It displays safe summaries and never renders raw form values, request bodies, response bodies, cookies, or headers.
```

Add to `.claude/docs/STACK.md`:

```md
- The JavaScript SDK exports manual breadcrumb capture through `client.breadcrumb` and optional browser breadcrumb helpers. No new runtime dependency is required for Phase 5C.
```

Add to `CLAUDE.md`:

```md
- Current phase: Phase 5C Session Timeline and Breadcrumbs.
```

- [ ] **Step 5: Update memory**

Append to `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`:

```md
- Implemented Phase 5C Session Timeline and Breadcrumbs: breadcrumb ingestion/storage, SDK manual breadcrumbs and safe browser helper, short retention, session timeline query, and raw error session context. Full visual replay and full Sessions investigation remain deferred.
```

- [ ] **Step 6: Commit SignalHub docs**

Run:

```bash
git add README.md .claude/docs/ARCHITECTURE.md .claude/docs/PROJECT-SUMMARY.md .claude/docs/SECRETS.md .claude/docs/UI-UX.md .claude/docs/STACK.md CLAUDE.md
git commit -m "docs: document session breadcrumbs"
```

Expected: commit succeeds.

- [ ] **Step 7: Commit memory**

Run:

```bash
cd /Users/diogo/Developer/Github/claude-config
git add projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
git commit -m "docs: update SignalHub phase 5C memory"
```

Expected: memory commit succeeds. Preserve unrelated untracked memory directories.

## Task 10: Final Verification and Integration

**Files:**
- Modify: `docs/superpowers/plans/2026-05-11-phase5c-session-timeline-breadcrumbs-implementation.md`

- [ ] **Step 1: Run full tests**

```bash
pnpm test
```

Expected: all test files pass with no unhandled errors.

- [ ] **Step 2: Run full build**

```bash
pnpm build
```

Expected: all workspace builds pass.

- [ ] **Step 3: Run Compose config verification**

```bash
docker compose config --quiet
```

Expected: exit code 0.

- [ ] **Step 4: Run doctor**

If `.env` exists:

```bash
pnpm run doctor
```

If this is an isolated worktree without `.env`, create a temporary safe env:

```bash
perl -0pe 's#^SIGNALHUB_PUBLIC_ENDPOINT=.*#SIGNALHUB_PUBLIC_ENDPOINT=#mg' .env.example > /tmp/signalhub-doctor.env
pnpm run doctor -- --env-file /tmp/signalhub-doctor.env
```

Expected: exit code 0. API reachability warnings are acceptable if no local API is running.

- [ ] **Step 5: Mark plan complete**

Update this plan file so completed verification and integration checkboxes are checked.

- [ ] **Step 6: Commit plan completion**

```bash
git add docs/superpowers/plans/2026-05-11-phase5c-session-timeline-breadcrumbs-implementation.md
git commit -m "docs: complete session breadcrumbs plan"
```

- [ ] **Step 7: Merge and push**

From the main SignalHub checkout:

```bash
git fetch origin
git status -sb
git merge --no-ff feature/phase5c-session-breadcrumbs -m "merge: phase 5c session breadcrumbs"
pnpm test
pnpm build
docker compose config --quiet
git push origin main
```

Push memory if Task 9 committed it:

```bash
cd /Users/diogo/Developer/Github/claude-config
git push origin main
```

Clean up the completed worktree and local feature branch only after push succeeds.
