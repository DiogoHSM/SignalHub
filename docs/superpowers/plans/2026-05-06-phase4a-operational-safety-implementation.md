# Phase 4A Operational Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add worker-owned telemetry retention, operational run history, worker heartbeat, authenticated system health, and a read-only System console panel.

**Architecture:** Keep Phase 4A inside the existing self-hosted runtime: the worker schedules retention and heartbeat updates, Postgres stores operational metadata, the API exposes an authenticated `/system/health` snapshot, and the console renders a read-only health surface. Retention is environment-configured, batch-limited, guarded by a Postgres advisory lock, and independent from request handling.

**Tech Stack:** TypeScript, Fastify, Kysely/Postgres, Redis/ioredis, BullMQ, React, Vitest, Docker Compose.

---

## Scope Check

This spec contains two tightly related operational subsystems:

- Retention cleanup and retention run history.
- Self-health reporting built from heartbeat, queue, Redis/Postgres, ingestion freshness, and retention status.

They should stay in one plan because the health panel needs retention and heartbeat status to be useful, and both share the same operational metadata migration.

## File Structure

Create:

- `packages/db/migrations/0002_operational_safety.sql` - retention history and heartbeat tables.
- `packages/db/src/repositories/system.ts` - retention deletion, retention run history, heartbeat, ingestion freshness, and Postgres advisory-lock helpers.
- `apps/worker/src/retention.ts` - worker-side retention scheduler and one-shot retention run orchestration.
- `apps/worker/src/heartbeat.ts` - worker heartbeat interval.
- `apps/api/src/routes/system.ts` - authenticated `/system/health` route and response mapping.
- `apps/api/test/system.test.ts` - API system-health route tests.
- `apps/console/src/components/SystemHealthPanel.tsx` - read-only System mode panel.
- `apps/console/src/components/SystemHealthPanel.test.tsx` - System panel behavior tests.

Modify:

- `packages/config/src/index.ts` - retention config parsing and validation.
- `packages/config/test/config.test.ts` - retention config tests.
- `packages/db/src/migrate.ts` - run ordered SQL migrations instead of only `0001_initial.sql`.
- `packages/db/src/schema.ts` - add `retention_runs` and `system_heartbeats`.
- `packages/db/test/repositories.test.ts` - system repository integration tests.
- `apps/worker/src/main.ts` - start retention and heartbeat loops; close them on shutdown.
- `apps/api/src/app.ts` - register system routes.
- `apps/api/src/main.ts` - wire health dependencies to DB, Redis, queue, and config.
- `apps/api/test/e2e.test.ts` - provide new buildApp dependencies where needed.
- `apps/console/src/api/types.ts` - add `SystemHealthResponse` types.
- `apps/console/src/api/client.ts` - add `getSystemHealth()`.
- `apps/console/src/api/client.test.ts` - verify system-health client path.
- `apps/console/src/components/ConsoleModeTabs.tsx` - add `system` mode.
- `apps/console/src/components/ConsoleModeTabs.test.tsx` - cover the new tab.
- `apps/console/src/components/ConsoleShell.tsx` - lazy-render `SystemHealthPanel`.
- `apps/console/src/components/ConsoleShell.test.tsx` - cover System mode loading.
- `apps/console/src/styles.css` - operational health layout and status states.
- `.env.example` - retention defaults.
- `README.md` - retention and System panel docs.
- `.claude/docs/ARCHITECTURE.md`, `.claude/docs/DEPLOYMENT.md`, `.claude/docs/SECRETS.md`, `.claude/docs/UI-UX.md`, `.claude/docs/PROJECT-SUMMARY.md` - project docs.

## Task 1: Retention Configuration

**Files:**

- Modify: `packages/config/src/index.ts`
- Test: `packages/config/test/config.test.ts`

- [x] **Step 1: Add failing config tests**

Add tests that assert the default retention policy and validation behavior:

```ts
it("loads retention defaults", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    PORT: "3000",
    DATABASE_URL: "postgres://user:pass@localhost:5432/signalhub",
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "a-secure-session-secret-with-enough-length",
    API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
    BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
    BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple",
    GOOGLE_OAUTH_ENABLED: "false"
  });

  expect(config.retention).toEqual({
    enabled: true,
    intervalMinutes: 60,
    batchSize: 1000,
    eventsDays: 90,
    errorsDays: 180,
    tracesDays: 90,
    spansDays: 90,
    llmCallsDays: 180
  });
});

it("loads explicit retention settings", () => {
  const config = loadConfig({
    ...validEnv,
    RETENTION_ENABLED: "false",
    RETENTION_INTERVAL_MINUTES: "15",
    RETENTION_BATCH_SIZE: "250",
    RETENTION_EVENTS_DAYS: "30",
    RETENTION_ERRORS_DAYS: "60",
    RETENTION_TRACES_DAYS: "30",
    RETENTION_SPANS_DAYS: "15",
    RETENTION_LLM_CALLS_DAYS: "120"
  });

  expect(config.retention).toEqual({
    enabled: false,
    intervalMinutes: 15,
    batchSize: 250,
    eventsDays: 30,
    errorsDays: 60,
    tracesDays: 30,
    spansDays: 15,
    llmCallsDays: 120
  });
});

it.each(["RETENTION_INTERVAL_MINUTES", "RETENTION_BATCH_SIZE", "RETENTION_EVENTS_DAYS"] as const)(
  "rejects non-positive %s",
  (fieldName) => {
    expect(() =>
      loadConfig({
        ...validEnv,
        [fieldName]: "0"
      })
    ).toThrow();
  }
);
```

- [x] **Step 2: Run config tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/config test
```

Expected: fail because `config.retention` does not exist.

- [x] **Step 3: Implement retention config**

In `packages/config/src/index.ts`, add helpers and schema fields:

```ts
const optionalPositiveInteger = (defaultValue: number) =>
  z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().min(1).default(defaultValue)
  );

const rawConfigSchema = z.object({
  // existing fields...
  RETENTION_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  RETENTION_INTERVAL_MINUTES: optionalPositiveInteger(60),
  RETENTION_BATCH_SIZE: optionalPositiveInteger(1000),
  RETENTION_EVENTS_DAYS: optionalPositiveInteger(90),
  RETENTION_ERRORS_DAYS: optionalPositiveInteger(180),
  RETENTION_TRACES_DAYS: optionalPositiveInteger(90),
  RETENTION_SPANS_DAYS: optionalPositiveInteger(90),
  RETENTION_LLM_CALLS_DAYS: optionalPositiveInteger(180)
});
```

Return:

```ts
retention: {
  enabled: parsed.RETENTION_ENABLED,
  intervalMinutes: parsed.RETENTION_INTERVAL_MINUTES,
  batchSize: parsed.RETENTION_BATCH_SIZE,
  eventsDays: parsed.RETENTION_EVENTS_DAYS,
  errorsDays: parsed.RETENTION_ERRORS_DAYS,
  tracesDays: parsed.RETENTION_TRACES_DAYS,
  spansDays: parsed.RETENTION_SPANS_DAYS,
  llmCallsDays: parsed.RETENTION_LLM_CALLS_DAYS
}
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
git commit -m "feat: add retention configuration"
```

## Task 2: Migration Runner and Operational Metadata Tables

**Files:**

- Create: `packages/db/migrations/0002_operational_safety.sql`
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/src/schema.ts`
- Test: `packages/db/test/repositories.test.ts`

- [x] **Step 1: Add a failing migration test**

Add an integration test that runs `migrate(db)` and verifies the new tables exist:

```ts
it("runs operational safety migrations", async () => {
  await sql`select id, status, started_at from retention_runs limit 0`.execute(db);
  await sql`select component, last_heartbeat_at from system_heartbeats limit 0`.execute(db);
});
```

- [x] **Step 2: Run DB tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: fail because `retention_runs` and `system_heartbeats` do not exist.

- [x] **Step 3: Add migration SQL**

Create `packages/db/migrations/0002_operational_safety.sql`:

```sql
CREATE TABLE retention_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  error_message text,
  deleted_events integer NOT NULL DEFAULT 0,
  deleted_errors integer NOT NULL DEFAULT 0,
  deleted_traces integer NOT NULL DEFAULT 0,
  deleted_spans integer NOT NULL DEFAULT 0,
  deleted_llm_calls integer NOT NULL DEFAULT 0,
  events_days integer NOT NULL,
  errors_days integer NOT NULL,
  traces_days integer NOT NULL,
  spans_days integer NOT NULL,
  llm_calls_days integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX retention_runs_started_at_idx ON retention_runs(started_at DESC);

CREATE TABLE system_heartbeats (
  component text PRIMARY KEY,
  last_heartbeat_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- [x] **Step 4: Update the migration runner**

Replace the single-file migration constants in `packages/db/src/migrate.ts` with ordered migration loading:

```ts
const migrations = [
  { name: "0001_initial.sql", url: new URL("../migrations/0001_initial.sql", import.meta.url) },
  { name: "0002_operational_safety.sql", url: new URL("../migrations/0002_operational_safety.sql", import.meta.url) }
];
```

Inside the advisory-lock transaction, loop in order:

```ts
for (const migration of migrations) {
  const migrationSql = await readFile(migration.url, "utf8");
  const checksum = createHash("sha256").update(migrationSql).digest("hex");

  const existing = await trx
    .selectFrom("_migrations")
    .select(["name", "checksum"])
    .where("name", "=", migration.name)
    .executeTakeFirst();

  if (existing) {
    if (existing.checksum !== checksum) {
      throw new Error(`Migration ${migration.name} checksum mismatch`);
    }
    continue;
  }

  await sql.raw(migrationSql).execute(trx);
  await trx.insertInto("_migrations").values({ name: migration.name, checksum }).execute();
}
```

- [x] **Step 5: Update Kysely schema**

Add interfaces in `packages/db/src/schema.ts`:

```ts
export interface RetentionRunsTable {
  id: ColumnType<string, string | undefined, string>;
  started_at: Timestamp;
  finished_at: NullableTimestamp;
  status: "success" | "failed";
  error_message: string | null;
  deleted_events: DefaultedInteger;
  deleted_errors: DefaultedInteger;
  deleted_traces: DefaultedInteger;
  deleted_spans: DefaultedInteger;
  deleted_llm_calls: DefaultedInteger;
  events_days: number;
  errors_days: number;
  traces_days: number;
  spans_days: number;
  llm_calls_days: number;
  created_at: Timestamp;
}

export interface SystemHeartbeatsTable {
  component: string;
  last_heartbeat_at: Timestamp;
  metadata: JsonColumn;
  updated_at: Timestamp;
}
```

Add to `Database`:

```ts
retention_runs: RetentionRunsTable;
system_heartbeats: SystemHeartbeatsTable;
```

- [x] **Step 6: Run DB tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add packages/db/migrations/0002_operational_safety.sql packages/db/src/migrate.ts packages/db/src/schema.ts packages/db/test/repositories.test.ts
git commit -m "feat: add operational metadata tables"
```

## Task 3: System Repository

**Files:**

- Create: `packages/db/src/repositories/system.ts`
- Test: `packages/db/test/repositories.test.ts`

- [x] **Step 1: Add failing repository tests**

Add tests for heartbeat upsert, ingestion freshness, retention run recording, and retention deletion:

```ts
it("records and reads worker heartbeat", async () => {
  const heartbeatAt = new Date("2026-05-06T12:00:00.000Z");
  await upsertHeartbeat(db, { component: "worker", heartbeatAt });

  const heartbeat = await getHeartbeat(db, "worker");
  expect(heartbeat?.component).toBe("worker");
  expect(heartbeat?.lastHeartbeatAt).toEqual(heartbeatAt);
});

it("deletes telemetry older than retention cutoffs in bounded batches", async () => {
  const project = await createProject(db, { name: "Retention Project" });
  const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
  const receivedAt = new Date("2026-05-06T12:00:00.000Z");
  const oldTimestamp = new Date("2026-01-01T12:00:00.000Z");
  const freshTimestamp = new Date("2026-05-05T12:00:00.000Z");

  await insertEvent(db, {
    id: "evt_old_retention",
    projectId: project.id,
    environmentId: environment.id,
    timestamp: oldTimestamp,
    receivedAt,
    name: "old.event"
  });
  await insertEvent(db, {
    id: "evt_fresh_retention",
    projectId: project.id,
    environmentId: environment.id,
    timestamp: freshTimestamp,
    receivedAt,
    name: "fresh.event"
  });

  const deleted = await deleteExpiredTelemetry(db, {
    now: new Date("2026-05-06T12:00:00.000Z"),
    batchSize: 1000,
    eventsDays: 90,
    errorsDays: 180,
    tracesDays: 90,
    spansDays: 90,
    llmCallsDays: 180
  });

  expect(deleted.events).toBe(1);
  expect(await listEvents(db, { projectId: project.id, environmentId: environment.id, limit: 10 })).toHaveLength(1);
});
```

- [x] **Step 2: Run DB tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: fail because `system.ts` functions do not exist.

- [x] **Step 3: Implement repository types and helpers**

Create `packages/db/src/repositories/system.ts` with exported types:

```ts
export type RetentionPolicy = {
  eventsDays: number;
  errorsDays: number;
  tracesDays: number;
  spansDays: number;
  llmCallsDays: number;
};

export type RetentionExecutionOptions = RetentionPolicy & {
  now: Date;
  batchSize: number;
};

export type RetentionDeletedCounts = {
  events: number;
  errors: number;
  traces: number;
  spans: number;
  llmCalls: number;
};

export type RetentionRunRecord = {
  id: string;
  status: "success" | "failed";
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage: string | null;
  deleted: RetentionDeletedCounts;
  policy: RetentionPolicy;
};
```

Add `toRetentionRunRecord(row)` and `toIso` only if needed by API mapping. Keep DB repository values as `Date` objects.

- [x] **Step 4: Implement advisory lock and heartbeat functions**

Use a fixed bigint lock id:

```ts
const retentionAdvisoryLockId = 927380402914;

export async function tryAcquireRetentionLock(db: Db): Promise<boolean> {
  const result = await sql<{ locked: boolean }>`select pg_try_advisory_lock(${retentionAdvisoryLockId}) as locked`.execute(db);
  return result.rows[0]?.locked === true;
}

export async function releaseRetentionLock(db: Db): Promise<void> {
  await sql`select pg_advisory_unlock(${retentionAdvisoryLockId})`.execute(db);
}
```

Add heartbeat functions:

```ts
export async function upsertHeartbeat(
  db: Db,
  input: { component: string; heartbeatAt: Date; metadata?: unknown }
): Promise<void> {
  await db
    .insertInto("system_heartbeats")
    .values({
      component: input.component,
      last_heartbeat_at: input.heartbeatAt,
      metadata: input.metadata ?? {},
      updated_at: input.heartbeatAt
    })
    .onConflict((oc) =>
      oc.column("component").doUpdateSet({
        last_heartbeat_at: input.heartbeatAt,
        metadata: input.metadata ?? {},
        updated_at: input.heartbeatAt
      })
    )
    .execute();
}

export async function getHeartbeat(db: Db, component: string) {
  const row = await db
    .selectFrom("system_heartbeats")
    .select(["component", "last_heartbeat_at"])
    .where("component", "=", component)
    .executeTakeFirst();

  return row ? { component: row.component, lastHeartbeatAt: row.last_heartbeat_at } : null;
}
```

- [x] **Step 5: Implement bounded retention deletion**

Use CTE deletes with `ctid` to honor batch size:

```ts
async function deleteExpiredFromTable(db: Db, tableName: string, cutoff: Date, batchSize: number): Promise<number> {
  const result = await sql<{ deleted_count: string }>`
    with deleted_rows as (
      delete from ${sql.table(tableName)}
      where ctid in (
        select ctid from ${sql.table(tableName)}
        where timestamp < ${cutoff}
        order by timestamp asc
        limit ${batchSize}
      )
      returning 1
    )
    select count(*)::text as deleted_count from deleted_rows
  `.execute(db);

  return Number(result.rows[0]?.deleted_count ?? 0);
}
```

Loop until a table returns fewer than `batchSize`:

```ts
async function deleteAllExpiredFromTable(db: Db, tableName: string, cutoff: Date, batchSize: number): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await deleteExpiredFromTable(db, tableName, cutoff, batchSize);
    total += deleted;
    if (deleted < batchSize) return total;
  }
}
```

Then:

```ts
export async function deleteExpiredTelemetry(db: Db, options: RetentionExecutionOptions): Promise<RetentionDeletedCounts> {
  const cutoff = (days: number) => new Date(options.now.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    events: await deleteAllExpiredFromTable(db, "events", cutoff(options.eventsDays), options.batchSize),
    errors: await deleteAllExpiredFromTable(db, "errors", cutoff(options.errorsDays), options.batchSize),
    traces: await deleteAllExpiredFromTable(db, "traces", cutoff(options.tracesDays), options.batchSize),
    spans: await deleteAllExpiredFromTable(db, "spans", cutoff(options.spansDays), options.batchSize),
    llmCalls: await deleteAllExpiredFromTable(db, "llm_calls", cutoff(options.llmCallsDays), options.batchSize)
  };
}
```

- [x] **Step 6: Implement retention run history and freshness**

Add:

```ts
export async function recordRetentionRun(
  db: Db,
  input: {
    startedAt: Date;
    finishedAt: Date | null;
    status: "success" | "failed";
    errorMessage?: string | null;
    deleted: RetentionDeletedCounts;
    policy: RetentionPolicy;
  }
): Promise<RetentionRunRecord> {
  const row = await db
    .insertInto("retention_runs")
    .values({
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      status: input.status,
      error_message: input.errorMessage ?? null,
      deleted_events: input.deleted.events,
      deleted_errors: input.deleted.errors,
      deleted_traces: input.deleted.traces,
      deleted_spans: input.deleted.spans,
      deleted_llm_calls: input.deleted.llmCalls,
      events_days: input.policy.eventsDays,
      errors_days: input.policy.errorsDays,
      traces_days: input.policy.tracesDays,
      spans_days: input.policy.spansDays,
      llm_calls_days: input.policy.llmCallsDays
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toRetentionRunRecord(row);
}

export async function getLastRetentionRun(db: Db): Promise<RetentionRunRecord | null> {
  const row = await db
    .selectFrom("retention_runs")
    .selectAll()
    .orderBy("started_at", "desc")
    .limit(1)
    .executeTakeFirst();

  return row ? toRetentionRunRecord(row) : null;
}
```

Add ingestion freshness:

```ts
export async function getIngestionFreshness(db: Db) {
  const [eventRow, errorRow, traceRow, spanRow, llmRow] = await Promise.all([
    db.selectFrom("events").select((eb) => eb.fn.max("timestamp").as("last_at")).executeTakeFirst(),
    db.selectFrom("errors").select((eb) => eb.fn.max("timestamp").as("last_at")).executeTakeFirst(),
    db.selectFrom("traces").select((eb) => eb.fn.max("timestamp").as("last_at")).executeTakeFirst(),
    db.selectFrom("spans").select((eb) => eb.fn.max("timestamp").as("last_at")).executeTakeFirst(),
    db.selectFrom("llm_calls").select((eb) => eb.fn.max("timestamp").as("last_at")).executeTakeFirst()
  ]);

  return {
    lastEventAt: eventRow?.last_at ?? null,
    lastErrorAt: errorRow?.last_at ?? null,
    lastTraceAt: traceRow?.last_at ?? null,
    lastSpanAt: spanRow?.last_at ?? null,
    lastLlmCallAt: llmRow?.last_at ?? null
  };
}
```

- [x] **Step 7: Run DB tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: pass.

- [x] **Step 8: Commit**

```bash
git add packages/db/src/repositories/system.ts packages/db/test/repositories.test.ts
git commit -m "feat: add operational system repository"
```

## Task 4: Worker Retention and Heartbeat Runtime

**Files:**

- Create: `apps/worker/src/retention.ts`
- Create: `apps/worker/src/heartbeat.ts`
- Modify: `apps/worker/src/main.ts`
- Test: `apps/worker/test/telemetry-worker.test.ts`

- [x] **Step 1: Add failing worker unit tests**

Add tests around pure orchestration functions:

```ts
it("records successful retention runs", async () => {
  const calls: string[] = [];
  const result = await runRetentionOnce({
    now: () => new Date("2026-05-06T12:00:00.000Z"),
    policy: {
      eventsDays: 90,
      errorsDays: 180,
      tracesDays: 90,
      spansDays: 90,
      llmCallsDays: 180
    },
    batchSize: 1000,
    tryAcquireLock: async () => true,
    releaseLock: async () => calls.push("released"),
    deleteExpiredTelemetry: async () => ({ events: 1, errors: 2, traces: 3, spans: 4, llmCalls: 5 }),
    recordRetentionRun: async (input) => {
      expect(input.status).toBe("success");
      expect(input.deleted.events).toBe(1);
      calls.push("recorded");
    }
  });

  expect(result).toEqual({ ran: true, skipped: false });
  expect(calls).toEqual(["recorded", "released"]);
});

it("skips retention when advisory lock is held", async () => {
  const result = await runRetentionOnce({
    now: () => new Date("2026-05-06T12:00:00.000Z"),
    policy: {
      eventsDays: 90,
      errorsDays: 180,
      tracesDays: 90,
      spansDays: 90,
      llmCallsDays: 180
    },
    batchSize: 1000,
    tryAcquireLock: async () => false,
    releaseLock: async () => {
      throw new Error("should_not_release");
    },
    deleteExpiredTelemetry: async () => {
      throw new Error("should_not_delete");
    },
    recordRetentionRun: async () => {
      throw new Error("should_not_record");
    }
  });

  expect(result).toEqual({ ran: false, skipped: true });
});
```

- [x] **Step 2: Run worker tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/worker test
```

Expected: fail because `runRetentionOnce` does not exist.

- [x] **Step 3: Implement retention orchestration**

Create `apps/worker/src/retention.ts`:

```ts
import { sanitizePreviewText } from "@signal-hub/telemetry/sanitization";
import type { RetentionDeletedCounts, RetentionPolicy } from "@signal-hub/db/repositories/system.js";

const zeroDeleted: RetentionDeletedCounts = { events: 0, errors: 0, traces: 0, spans: 0, llmCalls: 0 };

export type RetentionRuntime = {
  now: () => Date;
  policy: RetentionPolicy;
  batchSize: number;
  tryAcquireLock: () => Promise<boolean>;
  releaseLock: () => Promise<void>;
  deleteExpiredTelemetry: () => Promise<RetentionDeletedCounts>;
  recordRetentionRun: (input: {
    startedAt: Date;
    finishedAt: Date | null;
    status: "success" | "failed";
    errorMessage?: string | null;
    deleted: RetentionDeletedCounts;
    policy: RetentionPolicy;
  }) => Promise<unknown>;
};

export async function runRetentionOnce(runtime: RetentionRuntime): Promise<{ ran: boolean; skipped: boolean }> {
  const locked = await runtime.tryAcquireLock();
  if (!locked) return { ran: false, skipped: true };

  const startedAt = runtime.now();
  try {
    const deleted = await runtime.deleteExpiredTelemetry();
    await runtime.recordRetentionRun({
      startedAt,
      finishedAt: runtime.now(),
      status: "success",
      deleted,
      policy: runtime.policy
    });
    return { ran: true, skipped: false };
  } catch (error) {
    await runtime.recordRetentionRun({
      startedAt,
      finishedAt: runtime.now(),
      status: "failed",
      errorMessage: sanitizePreviewText(error instanceof Error ? error.message : String(error)),
      deleted: zeroDeleted,
      policy: runtime.policy
    });
    return { ran: true, skipped: false };
  } finally {
    await runtime.releaseLock();
  }
}

export function startRetentionScheduler(input: {
  intervalMinutes: number;
  runOnce: () => Promise<unknown>;
  setIntervalFn?: typeof setInterval;
  setTimeoutFn?: typeof setTimeout;
  clearIntervalFn?: typeof clearInterval;
}) {
  const setIntervalFn = input.setIntervalFn ?? setInterval;
  const setTimeoutFn = input.setTimeoutFn ?? setTimeout;
  const clearIntervalFn = input.clearIntervalFn ?? clearInterval;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await input.runOnce();
    } catch (error) {
      console.error("Retention scheduler run failed", error);
    } finally {
      running = false;
    }
  };

  const startupTimer = setTimeoutFn(() => void tick(), 1000);
  const interval = setIntervalFn(() => void tick(), input.intervalMinutes * 60 * 1000);

  return () => {
    clearTimeout(startupTimer);
    clearIntervalFn(interval);
  };
}
```

- [x] **Step 4: Implement heartbeat loop**

Create `apps/worker/src/heartbeat.ts`:

```ts
export const workerHeartbeatIntervalMs = 30_000;

export function startHeartbeat(input: {
  beat: () => Promise<void>;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}) {
  const setIntervalFn = input.setIntervalFn ?? setInterval;
  const clearIntervalFn = input.clearIntervalFn ?? clearInterval;

  const send = () => {
    void input.beat().catch((error) => {
      console.error("Worker heartbeat failed", error);
    });
  };

  send();
  const interval = setIntervalFn(send, workerHeartbeatIntervalMs);

  return () => clearIntervalFn(interval);
}
```

- [x] **Step 5: Wire worker main**

In `apps/worker/src/main.ts`, import system repository functions and start loops:

```ts
import {
  deleteExpiredTelemetry,
  recordRetentionRun,
  releaseRetentionLock,
  tryAcquireRetentionLock,
  upsertHeartbeat
} from "@signal-hub/db/repositories/system.js";
import { startHeartbeat } from "./heartbeat.js";
import { runRetentionOnce, startRetentionScheduler } from "./retention.js";
```

After worker creation:

```ts
const stopHeartbeat = startHeartbeat({
  beat: () => upsertHeartbeat(db, { component: "worker", heartbeatAt: new Date() })
});

const retentionPolicy = {
  eventsDays: config.retention.eventsDays,
  errorsDays: config.retention.errorsDays,
  tracesDays: config.retention.tracesDays,
  spansDays: config.retention.spansDays,
  llmCallsDays: config.retention.llmCallsDays
};

const stopRetention = config.retention.enabled
  ? startRetentionScheduler({
      intervalMinutes: config.retention.intervalMinutes,
      runOnce: () =>
        runRetentionOnce({
          now: () => new Date(),
          policy: retentionPolicy,
          batchSize: config.retention.batchSize,
          tryAcquireLock: () => tryAcquireRetentionLock(db),
          releaseLock: () => releaseRetentionLock(db),
          deleteExpiredTelemetry: () =>
            deleteExpiredTelemetry(db, {
              now: new Date(),
              batchSize: config.retention.batchSize,
              ...retentionPolicy
            }),
          recordRetentionRun: (input) => recordRetentionRun(db, input)
        })
    })
  : () => {};
```

Call both cleanup functions at the start of shutdown:

```ts
stopRetention();
stopHeartbeat();
```

- [x] **Step 6: Run worker tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/worker test
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add apps/worker/src/retention.ts apps/worker/src/heartbeat.ts apps/worker/src/main.ts apps/worker/test/telemetry-worker.test.ts
git commit -m "feat: add worker retention and heartbeat"
```

## Task 5: Authenticated System Health API

**Files:**

- Create: `apps/api/src/routes/system.ts`
- Create: `apps/api/test/system.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/test/e2e.test.ts`

- [x] **Step 1: Add failing API tests**

Create `apps/api/test/system.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const auth = {
  findSessionUser: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true }),
  login: async () => null,
  logout: async () => {}
};

describe("system health routes", () => {
  it("requires authentication", async () => {
    const app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: undefined,
      system: {
        getHealth: async () => ({ generatedAt: "2026-05-06T12:00:00.000Z", status: "healthy" })
      }
    });

    const response = await app.inject({ method: "GET", url: "/system/health" });
    expect(response.statusCode).toBe(401);
  });

  it("returns system health for authenticated users", async () => {
    const app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth,
      system: {
        getHealth: async () => ({
          generatedAt: "2026-05-06T12:00:00.000Z",
          status: "degraded",
          services: {
            api: { status: "healthy", uptimeSeconds: 10 },
            postgres: { status: "healthy", latencyMs: 2 },
            redis: { status: "healthy", latencyMs: 3 },
            worker: { status: "degraded", lastHeartbeatAt: null }
          },
          queues: { telemetry: { waiting: 0, active: 0, completed: 1, failed: 0, delayed: 0 } },
          ingestion: {
            lastEventAt: null,
            lastErrorAt: null,
            lastTraceAt: null,
            lastSpanAt: null,
            lastLlmCallAt: null
          },
          retention: {
            enabled: true,
            intervalMinutes: 60,
            lastRun: null,
            policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180 }
          }
        })
      }
    });

    const response = await app.inject({ method: "GET", url: "/system/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe("degraded");
  });
});
```

- [x] **Step 2: Run API tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/api test -- system.test.ts
```

Expected: fail because `system` build option and route do not exist.

- [x] **Step 3: Implement system route**

Create `apps/api/src/routes/system.ts`:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { setCurrentUser } from "../plugins/request-context.js";
import type { AuthDependencies } from "./auth.js";

export type SystemStatus = "healthy" | "degraded" | "unhealthy";
export type SystemHealthDependencies = {
  getHealth?: () => Promise<unknown>;
};

export function registerSystemRoutes(
  app: FastifyInstance,
  options: { auth?: AuthDependencies; system?: SystemHealthDependencies }
) {
  app.get("/system/health", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await options.auth?.findSessionUser(request);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    setCurrentUser(user);

    if (!options.system?.getHealth) {
      return reply.code(501).send({ error: "system_health_unavailable" });
    }

    try {
      return { data: await options.system.getHealth() };
    } catch {
      return reply.code(503).send({ error: "system_health_unavailable" });
    }
  });
}
```

Register it in `apps/api/src/app.ts`:

```ts
import { registerSystemRoutes, type SystemHealthDependencies } from "./routes/system.js";

export type BuildAppOptions = {
  // existing fields...
  system?: SystemHealthDependencies;
};

registerSystemRoutes(app, {
  auth: options.auth,
  system: options.system
});
```

- [x] **Step 4: Wire real dependencies in API main**

In `apps/api/src/main.ts`, import:

```ts
import {
  getHeartbeat,
  getIngestionFreshness,
  getLastRetentionRun
} from "@signal-hub/db/repositories/system.js";
```

Add helpers:

```ts
async function measure<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T; latencyMs: number } | { ok: false; latencyMs: null }> {
  const started = performance.now();
  try {
    const value = await fn();
    return { ok: true, value, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
```

Build `system.getHealth`:

```ts
system: {
  getHealth: async () => {
    const generatedAt = new Date();
    const [postgres, redisReady, queueCounts, heartbeat, freshness, retentionRun] = await Promise.all([
      measure(() => sql`select 1`.execute(db)),
      measure(() => redis.ping()),
      telemetryQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
      getHeartbeat(db, "worker"),
      getIngestionFreshness(db),
      getLastRetentionRun(db)
    ]);

    const workerStale =
      !heartbeat?.lastHeartbeatAt || generatedAt.getTime() - heartbeat.lastHeartbeatAt.getTime() > 150_000;
    const postgresStatus = postgres.ok ? "healthy" : "unhealthy";
    const redisStatus = redisReady.ok && redisReady.value === "PONG" ? "healthy" : "unhealthy";
    const workerStatus = workerStale ? "degraded" : "healthy";
    const retentionFailed = retentionRun?.status === "failed";
    const status = postgresStatus === "unhealthy" || redisStatus === "unhealthy" ? "unhealthy" : workerStatus === "degraded" || retentionFailed ? "degraded" : "healthy";

    return {
      generatedAt: generatedAt.toISOString(),
      status,
      services: {
        api: { status: "healthy", uptimeSeconds: Math.floor(process.uptime()) },
        postgres: { status: postgresStatus, latencyMs: postgres.latencyMs },
        redis: { status: redisStatus, latencyMs: redisReady.latencyMs },
        worker: { status: workerStatus, lastHeartbeatAt: isoOrNull(heartbeat?.lastHeartbeatAt) }
      },
      queues: {
        telemetry: {
          waiting: queueCounts.waiting,
          active: queueCounts.active,
          completed: queueCounts.completed,
          failed: queueCounts.failed,
          delayed: queueCounts.delayed
        }
      },
      ingestion: {
        lastEventAt: isoOrNull(freshness.lastEventAt),
        lastErrorAt: isoOrNull(freshness.lastErrorAt),
        lastTraceAt: isoOrNull(freshness.lastTraceAt),
        lastSpanAt: isoOrNull(freshness.lastSpanAt),
        lastLlmCallAt: isoOrNull(freshness.lastLlmCallAt)
      },
      retention: {
        enabled: config.retention.enabled,
        intervalMinutes: config.retention.intervalMinutes,
        lastRun: retentionRun
          ? {
              id: retentionRun.id,
              status: retentionRun.status,
              startedAt: retentionRun.startedAt.toISOString(),
              finishedAt: isoOrNull(retentionRun.finishedAt),
              deleted: retentionRun.deleted,
              errorMessage: retentionRun.errorMessage
            }
          : null,
        policy: retentionPolicy
      }
    };
  }
}
```

- [x] **Step 5: Run API tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/api test -- system.test.ts
```

Expected: pass.

- [x] **Step 6: Run API suite**

Run:

```bash
pnpm --filter @signal-hub/api test
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add apps/api/src/routes/system.ts apps/api/src/app.ts apps/api/src/main.ts apps/api/test/system.test.ts apps/api/test/e2e.test.ts
git commit -m "feat: add system health api"
```

## Task 6: Console Client and Types

**Files:**

- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Test: `apps/console/src/api/client.test.ts`

- [x] **Step 1: Add failing client test**

Add:

```ts
it("fetches system health", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({
        data: {
          generatedAt: "2026-05-06T12:00:00.000Z",
          status: "healthy",
          services: {
            api: { status: "healthy", uptimeSeconds: 10 },
            postgres: { status: "healthy", latencyMs: 1 },
            redis: { status: "healthy", latencyMs: 1 },
            worker: { status: "healthy", lastHeartbeatAt: "2026-05-06T11:59:30.000Z" }
          },
          queues: { telemetry: { waiting: 0, active: 0, completed: 1, failed: 0, delayed: 0 } },
          ingestion: { lastEventAt: null, lastErrorAt: null, lastTraceAt: null, lastSpanAt: null, lastLlmCallAt: null },
          retention: {
            enabled: true,
            intervalMinutes: 60,
            lastRun: null,
            policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180 }
          }
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient("/api");
  await expect(client.getSystemHealth()).resolves.toMatchObject({ data: { status: "healthy" } });
  expect(fetchMock).toHaveBeenCalledWith("/api/system/health", expect.objectContaining({ method: "GET" }));
});
```

- [x] **Step 2: Run client tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/console test -- client.test.ts
```

Expected: fail because `getSystemHealth` does not exist.

- [x] **Step 3: Add types**

In `apps/console/src/api/types.ts`:

```ts
export type SystemStatus = "healthy" | "degraded" | "unhealthy";

export type SystemHealthResponse = {
  generatedAt: string;
  status: SystemStatus;
  services: {
    api: { status: "healthy"; uptimeSeconds: number };
    postgres: { status: "healthy" | "unhealthy"; latencyMs: number | null };
    redis: { status: "healthy" | "unhealthy"; latencyMs: number | null };
    worker: { status: SystemStatus; lastHeartbeatAt: string | null };
  };
  queues: {
    telemetry: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    };
  };
  ingestion: {
    lastEventAt: string | null;
    lastErrorAt: string | null;
    lastTraceAt: string | null;
    lastSpanAt: string | null;
    lastLlmCallAt: string | null;
  };
  retention: {
    enabled: boolean;
    intervalMinutes: number;
    lastRun: {
      id: string;
      status: "success" | "failed";
      startedAt: string;
      finishedAt: string | null;
      deleted: { events: number; errors: number; traces: number; spans: number; llmCalls: number };
      errorMessage: string | null;
    } | null;
    policy: { eventsDays: number; errorsDays: number; tracesDays: number; spansDays: number; llmCallsDays: number };
  };
};
```

- [x] **Step 4: Add client method**

In `apps/console/src/api/client.ts`, import `SystemHealthResponse`, add to `ApiClient`:

```ts
getSystemHealth: () => Promise<AggregateResponse<SystemHealthResponse>>;
```

Return implementation:

```ts
getSystemHealth: () => request<AggregateResponse<SystemHealthResponse>>(path(apiBasePath, "/system/health")),
```

- [x] **Step 5: Run client tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/console test -- client.test.ts
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts
git commit -m "feat: add system health console client"
```

## Task 7: System Console Panel

**Files:**

- Create: `apps/console/src/components/SystemHealthPanel.tsx`
- Create: `apps/console/src/components/SystemHealthPanel.test.tsx`
- Modify: `apps/console/src/components/ConsoleModeTabs.tsx`
- Modify: `apps/console/src/components/ConsoleModeTabs.test.tsx`
- Modify: `apps/console/src/components/ConsoleShell.tsx`
- Modify: `apps/console/src/components/ConsoleShell.test.tsx`
- Modify: `apps/console/src/styles.css`

- [x] **Step 1: Add failing panel tests**

Create `SystemHealthPanel.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { SystemHealthPanel } from "./SystemHealthPanel";

function clientWithHealth(data: unknown): ApiClient {
  return {
    getSystemHealth: vi.fn(async () => ({ data })),
    getConsoleConfig: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn(),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    listTraces: vi.fn(),
    listTraceSpans: vi.fn(),
    listLlmCalls: vi.fn(),
    getLlmAggregates: vi.fn(),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn(),
    listEntityTenants: vi.fn(),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn(),
    getUserDetail: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn()
  } as ApiClient;
}

describe("SystemHealthPanel", () => {
  it("renders healthy system status", async () => {
    render(
      <SystemHealthPanel
        client={clientWithHealth({
          generatedAt: "2026-05-06T12:00:00.000Z",
          status: "healthy",
          services: {
            api: { status: "healthy", uptimeSeconds: 20 },
            postgres: { status: "healthy", latencyMs: 2 },
            redis: { status: "healthy", latencyMs: 3 },
            worker: { status: "healthy", lastHeartbeatAt: "2026-05-06T11:59:30.000Z" }
          },
          queues: { telemetry: { waiting: 0, active: 0, completed: 4, failed: 0, delayed: 0 } },
          ingestion: { lastEventAt: null, lastErrorAt: null, lastTraceAt: null, lastSpanAt: null, lastLlmCallAt: null },
          retention: {
            enabled: true,
            intervalMinutes: 60,
            lastRun: null,
            policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180 }
          }
        })}
      />
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: "System" })).toBeInTheDocument());
    expect(screen.getByText("healthy")).toBeInTheDocument();
    expect(screen.getByText("Postgres")).toBeInTheDocument();
    expect(screen.getByText("Redis")).toBeInTheDocument();
    expect(screen.getByText("Retention")).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run console component tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/console test -- SystemHealthPanel.test.tsx
```

Expected: fail because `SystemHealthPanel` does not exist.

- [x] **Step 3: Implement SystemHealthPanel**

Create `apps/console/src/components/SystemHealthPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { SystemHealthResponse, SystemStatus } from "../api/types";

function StatusPill({ status }: { status: SystemStatus | "success" | "failed" }) {
  return <span className={`status-pill status-pill--${status}`}>{status}</span>;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "No data";
}

export function SystemHealthPanel({ client }: { client: ApiClient }) {
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  async function load() {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setError(null);

    try {
      const response = await client.getSystemHealth();
      if (requestIdRef.current !== requestId) return;
      setHealth(response.data);
    } catch {
      if (requestIdRef.current !== requestId) return;
      setError("System health unavailable");
    }
  }

  useEffect(() => {
    void load();
  }, [client]);

  if (error) {
    return (
      <section className="system-panel">
        <h2>System</h2>
        <strong>{error}</strong>
        <button type="button" onClick={() => void load()}>Retry</button>
      </section>
    );
  }

  if (!health) {
    return (
      <section className="system-panel">
        <h2>System</h2>
        <p>Loading system health...</p>
      </section>
    );
  }

  return (
    <section className="system-panel">
      <header className="system-panel__header">
        <div>
          <h2>System</h2>
          <p>Generated {formatDate(health.generatedAt)}</p>
        </div>
        <StatusPill status={health.status} />
      </header>

      <div className="system-grid">
        {Object.entries(health.services).map(([name, service]) => (
          <article className="system-card" key={name}>
            <span>{name === "api" ? "API" : name === "postgres" ? "Postgres" : name === "redis" ? "Redis" : "Worker"}</span>
            <StatusPill status={service.status} />
            {"latencyMs" in service ? <p>{service.latencyMs === null ? "No latency" : `${service.latencyMs}ms`}</p> : null}
            {"lastHeartbeatAt" in service ? <p>Heartbeat {formatDate(service.lastHeartbeatAt)}</p> : null}
          </article>
        ))}
      </div>

      <article className="system-card">
        <h3>Queue</h3>
        <dl className="metric-list">
          {Object.entries(health.queues.telemetry).map(([key, value]) => (
            <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      </article>

      <article className="system-card">
        <h3>Ingestion freshness</h3>
        <dl className="metric-list">
          {Object.entries(health.ingestion).map(([key, value]) => (
            <div key={key}><dt>{key.replace(/^last/, "").replace(/At$/, "")}</dt><dd>{formatDate(value)}</dd></div>
          ))}
        </dl>
      </article>

      <article className="system-card">
        <h3>Retention</h3>
        <p>{health.retention.enabled ? `Every ${health.retention.intervalMinutes} minutes` : "Disabled"}</p>
        {health.retention.lastRun ? (
          <>
            <StatusPill status={health.retention.lastRun.status} />
            <p>Last run {formatDate(health.retention.lastRun.startedAt)}</p>
            {health.retention.lastRun.errorMessage ? <p>{health.retention.lastRun.errorMessage}</p> : null}
          </>
        ) : (
          <p>No retention run yet.</p>
        )}
      </article>
    </section>
  );
}
```

- [x] **Step 4: Add System mode**

Update `ConsoleModeTabs.tsx`:

```ts
export type ConsoleMode = "setup" | "overview" | "investigate" | "system";
```

Add button:

```tsx
<button aria-pressed={activeMode === "system"} onClick={() => onChange("system")} type="button">
  System
</button>
```

Update `ConsoleShell.tsx`:

```tsx
import { SystemHealthPanel } from "./SystemHealthPanel";
```

Add after Investigate:

```tsx
<div hidden={activeMode !== "system"}>
  {activeMode === "system" ? <SystemHealthPanel client={client} /> : null}
</div>
```

- [x] **Step 5: Add CSS**

Append focused styles:

```css
.system-panel {
  display: grid;
  gap: 1rem;
}

.system-panel__header {
  align-items: start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.system-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.system-card {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: grid;
  gap: 0.5rem;
  padding: 1rem;
}

.status-pill {
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.2rem 0.55rem;
  text-transform: uppercase;
}

.status-pill--healthy,
.status-pill--success {
  background: #dcfce7;
  color: #166534;
}

.status-pill--degraded {
  background: #fef3c7;
  color: #92400e;
}

.status-pill--unhealthy,
.status-pill--failed {
  background: #fee2e2;
  color: #991b1b;
}
```

- [x] **Step 6: Run console tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/console test -- SystemHealthPanel.test.tsx ConsoleModeTabs.test.tsx ConsoleShell.test.tsx
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add apps/console/src/components/SystemHealthPanel.tsx apps/console/src/components/SystemHealthPanel.test.tsx apps/console/src/components/ConsoleModeTabs.tsx apps/console/src/components/ConsoleModeTabs.test.tsx apps/console/src/components/ConsoleShell.tsx apps/console/src/components/ConsoleShell.test.tsx apps/console/src/styles.css
git commit -m "feat: add system health console panel"
```

## Task 8: Documentation and Environment Examples

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/DEPLOYMENT.md`
- Modify: `.claude/docs/SECRETS.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`

- [x] **Step 1: Update `.env.example`**

Add:

```txt
RETENTION_ENABLED=true
RETENTION_INTERVAL_MINUTES=60
RETENTION_BATCH_SIZE=1000
RETENTION_EVENTS_DAYS=90
RETENTION_ERRORS_DAYS=180
RETENTION_TRACES_DAYS=90
RETENTION_SPANS_DAYS=90
RETENTION_LLM_CALLS_DAYS=180
```

- [x] **Step 2: Update README**

Add a section:

```md
## Operational Safety

The worker runs telemetry retention by default. Retention is configured through environment variables and deletes old telemetry in bounded batches. Operational metadata, projects, environments, users, and API keys are not deleted by retention.

Default windows:

| Signal | Default |
| --- | --- |
| Events | 90 days |
| Errors | 180 days |
| Traces | 90 days |
| Spans | 90 days |
| LLM calls | 180 days |

Set `RETENTION_ENABLED=false` to disable scheduled deletion. The console `System` mode shows API, worker, Postgres, Redis, queue, ingestion freshness, and retention status for logged-in users.
```

- [x] **Step 3: Update project docs**

Add concise entries:

- `ARCHITECTURE.md`: mention `retention_runs`, `system_heartbeats`, worker retention scheduler, and `/system/health`.
- `DEPLOYMENT.md`: mention retention env vars and that no extra scheduler is needed.
- `SECRETS.md`: list retention env vars as non-secret operational config.
- `UI-UX.md`: mention `System` as a quiet operational mode.
- `PROJECT-SUMMARY.md`: add Phase 4A capabilities.

- [x] **Step 4: Commit**

```bash
git add .env.example README.md .claude/docs/ARCHITECTURE.md .claude/docs/DEPLOYMENT.md .claude/docs/SECRETS.md .claude/docs/UI-UX.md .claude/docs/PROJECT-SUMMARY.md
git commit -m "docs: document operational safety"
```

## Task 9: Final Verification and Visual Pass

**Files:**

- Potentially modify the exact files responsible for any defect found during verification. Do not change files if verification passes.

- [x] **Step 1: Run full tests**

Run:

```bash
pnpm test
```

Expected: all tests pass.

- [x] **Step 2: Run production build**

Run:

```bash
pnpm build
```

Expected: all workspace builds pass.

- [x] **Step 3: Validate Compose**

Run:

```bash
docker compose config --quiet
```

Expected: exits 0.

- [x] **Step 4: Browser visual check**

Run the console dev server:

```bash
pnpm dev:console
```

Use Playwright to mock:

- `/console/config`
- `/api/auth/me`
- `/api/admin/projects`
- `/api/admin/projects/:projectId/environments`
- `/api/system/health`

Verify at `1440x1000` and `390x900`:

- System tab is visible.
- Overall status renders.
- Service cards render.
- Queue counts render.
- Retention status renders.
- There is no horizontal page overflow.

- [x] **Step 5: Commit fixes if needed**

If visual or verification fixes are needed:

```bash
git add apps/api/src apps/console/src apps/worker/src packages/config/src packages/db/src packages/db/migrations packages/*/test apps/*/test .env.example README.md .claude/docs
git commit -m "fix: polish system health verification"
```

If no fixes are needed, do not create an empty commit.

## Final Verification Commands

Run before completing the branch:

```bash
pnpm test
pnpm build
docker compose config --quiet
```

Expected final state:

- Full test suite passes.
- Build passes.
- Compose config validates.
- Browser visual check confirms System mode works on desktop and mobile.
