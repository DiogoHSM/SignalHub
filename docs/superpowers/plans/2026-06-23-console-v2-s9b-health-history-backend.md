# Implementation Plan — Phase A · B5 health-history backend (Console v2 S9)

**Spec (authoritative):** `docs/superpowers/specs/2026-06-23-console-v2-s9-system-health-design.md` (Phase A section only).
**Linear:** PER-367 (B5 · System health history).
**Scope:** DB migration + schema type + repository + config envs + worker sample job + API read endpoint + console client method/type. **No UI change.** Phase B (the screen) is a separate plan and is out of scope here.

This plan ships a bounded, self-pruning health-history time-series (`system_health_samples`) plus a read endpoint `GET /system/health/history`, so the Phase-B sparklines render real Postgres/Redis/Worker data.

---

## Global Constraints

These apply to **every** task below. Re-read before each commit.

1. **English identifiers and copy** everywhere (CLAUDE.md), even though the design source is pt-BR.
2. **Vocabulary is "sample" / "history".** NEVER reuse the existing `SystemHealthSnapshot` / `createSystemHealthSnapshot` name (those are the point-in-time full-health collector). The new feature uses: table `system_health_samples`; row interface `SystemHealthSamplesTable`; record `SystemHealthSampleRecord`; repo `recordSystemHealthSample` / `pruneSystemHealthSamples` / `listSystemHealthSamples`; worker `collectHealthSample` / `runHealthSampleOnce` / `startHealthSampleScheduler`; route `GET /system/health/history`; response type `SystemHealthSampleResponse`; console `getSystemHealthHistory`.
3. **Prune by AGE on every run**, never by count. `cutoff = now − SYSTEM_HEALTH_HISTORY_RETENTION_HOURS`; delete `where captured_at < cutoff`. OK-for-weeks signals must not accumulate.
4. **Read-only endpoint.** Auth is identical to `/system/health` (`findSessionUser` → `401 { error: "unauthenticated" }`); `{ data }` envelope; no secrets surfaced; the sample job writes only to its own bounded table.
5. **New env vars** (`SYSTEM_HEALTH_HISTORY_ENABLED`, `SYSTEM_HEALTH_SAMPLE_INTERVAL_MINUTES`, `SYSTEM_HEALTH_HISTORY_RETENTION_HOURS`) MUST be documented sanitized in `.claude/docs/SECRETS.md` and added to `.env.example`. This is folded into the config task's steps.
6. **TDD ordering** for every task: write the failing test → run it and SEE it fail for the right reason → implement → run and SEE it pass → commit. Use `superpowers:test-driven-development`.
7. **DRY/YAGNI:** mirror existing patterns exactly (backups/retention repos, retention/backup schedulers, the `measure()` timer). Do not add fields, signals, or knobs the spec does not name.
8. **No comments / docstrings / extra types in untouched code.** Do not refactor neighbouring code.
9. **Commit trailers:** implementer commits MUST NOT include `Co-Authored-By` or `Claude-Session` trailers (those are added only at squash-merge). Commit on a feature branch, never directly on `main`.
10. **Final verification gate** (after Task 4): `pnpm test && pnpm build && pnpm --filter @sigmon/sdk build && docker compose config`. All four must pass before the work is considered complete (`superpowers:verification-before-completion`).

### Type-consistency contract (must match verbatim across all tasks)

The record/row/response field names below MUST be identical wherever they appear (migration column ↔ schema interface ↔ repository row mapper ↔ worker input ↔ route response ↔ console type).

| DB column (`snake_case`) | schema type | record / response field (`camelCase`) | TS type |
|---|---|---|---|
| `id` | `ColumnType<string, string \| undefined, string>` | `id` | `string` |
| `captured_at` | `Timestamp` | `capturedAt` | `Date` (record) / `string` ISO (response) |
| `postgres_latency_ms` | `number \| null` | `postgresLatencyMs` | `number \| null` |
| `redis_latency_ms` | `number \| null` | `redisLatencyMs` | `number \| null` |
| `queue_waiting` | `DefaultedInteger` | `queueWaiting` | `number` |
| `queue_active` | `DefaultedInteger` | `queueActive` | `number` |
| `queue_failed` | `DefaultedInteger` | `queueFailed` | `number` |

`SystemHealthSampleRecord` (repository) = `{ id: string; capturedAt: Date; postgresLatencyMs: number | null; redisLatencyMs: number | null; queueWaiting: number; queueActive: number; queueFailed: number }`.

`SystemHealthSampleResponse` (route + console) = `{ capturedAt: string; postgresLatencyMs: number | null; redisLatencyMs: number | null; queueWaiting: number; queueActive: number; queueFailed: number }` (no `id`).

---

## Task 1 — DB layer (migration + schema type + repository + repository test)

**Deliverable:** a `system_health_samples` table with a repository (`recordSystemHealthSample`, `pruneSystemHealthSamples`, `listSystemHealthSamples`) covered by a unit test, all type-checking and the test passing.

**Repository test style (decided after inspecting the codebase):** packages/db repository tests use a **mocked Kysely builder** cast to `any` — there is NO real test database and NO migration runner in the db package test suite. The established pattern (see `packages/db/src/repositories/fleet-query.test.ts` lines 358-366) is:

```ts
const mockDb = {
  selectFrom: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue({ /* row */ })
  })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
```

The new `system-health-samples.test.ts` MUST follow this mock-builder style (one stubbed builder chain per repo call), asserting (a) the exact builder methods/args the repo invokes and (b) the camelCase mapping of the returned rows. It does NOT touch Postgres.

### Step 1.1 — Migration

Highest existing migration is `0015_incident_triage.sql`; the next number is **0016**. Create `packages/db/migrations/0016_system_health_samples.sql` (mirrors `0004_backup_runs.sql` conventions: `text PK default gen_random_uuid()::text`, `timestamptz`, a `*_idx` index):

```sql
CREATE TABLE system_health_samples (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  postgres_latency_ms integer,
  redis_latency_ms integer,
  queue_waiting integer NOT NULL DEFAULT 0,
  queue_active integer NOT NULL DEFAULT 0,
  queue_failed integer NOT NULL DEFAULT 0
);

CREATE INDEX system_health_samples_captured_at_idx ON system_health_samples(captured_at DESC);
```

### Step 1.2 — Schema type + `Database` registration

In `packages/db/src/schema.ts`, add the table interface immediately after `SystemHeartbeatsTable` (which ends at the `}` on the line after `updated_at: Timestamp;`). Use the existing helpers `Timestamp` and `DefaultedInteger` declared at the top of the file:

```ts
export interface SystemHealthSamplesTable {
  id: ColumnType<string, string | undefined, string>;
  captured_at: Timestamp;
  postgres_latency_ms: number | null;
  redis_latency_ms: number | null;
  queue_waiting: DefaultedInteger;
  queue_active: DefaultedInteger;
  queue_failed: DefaultedInteger;
}
```

Then register it in the `Database` interface (after the `system_heartbeats: SystemHeartbeatsTable;` line):

```ts
  system_heartbeats: SystemHeartbeatsTable;
  system_health_samples: SystemHealthSamplesTable;
```

### Step 1.3 — TDD: write the failing repository test

Create `packages/db/src/repositories/system-health-samples.test.ts`. Write it against the not-yet-existing module so it fails on import first, then on behaviour. Cover the three functions:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  listSystemHealthSamples,
  pruneSystemHealthSamples,
  recordSystemHealthSample,
  type SystemHealthSampleRecord
} from "./system-health-samples.js";

const CAPTURED_AT = new Date("2026-06-23T12:00:00.000Z");

function makeRow(overrides: Partial<{
  id: string;
  captured_at: Date;
  postgres_latency_ms: number | null;
  redis_latency_ms: number | null;
  queue_waiting: number;
  queue_active: number;
  queue_failed: number;
}> = {}) {
  return {
    id: "sample-1",
    captured_at: CAPTURED_AT,
    postgres_latency_ms: 2,
    redis_latency_ms: 3,
    queue_waiting: 4,
    queue_active: 5,
    queue_failed: 6,
    ...overrides
  };
}

describe("recordSystemHealthSample", () => {
  it("inserts the sample and maps the returned row to camelCase", async () => {
    const executeTakeFirstOrThrow = vi.fn().mockResolvedValue(makeRow());
    const values = vi.fn().mockReturnValue({ returningAll: vi.fn().mockReturnThis(), executeTakeFirstOrThrow });
    const insertInto = vi.fn().mockReturnValue({ values });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { insertInto } as any;

    const record = await recordSystemHealthSample(db, {
      capturedAt: CAPTURED_AT,
      postgresLatencyMs: 2,
      redisLatencyMs: 3,
      queueWaiting: 4,
      queueActive: 5,
      queueFailed: 6
    });

    expect(insertInto).toHaveBeenCalledWith("system_health_samples");
    expect(values).toHaveBeenCalledWith({
      captured_at: CAPTURED_AT,
      postgres_latency_ms: 2,
      redis_latency_ms: 3,
      queue_waiting: 4,
      queue_active: 5,
      queue_failed: 6
    });
    const expected: SystemHealthSampleRecord = {
      id: "sample-1",
      capturedAt: CAPTURED_AT,
      postgresLatencyMs: 2,
      redisLatencyMs: 3,
      queueWaiting: 4,
      queueActive: 5,
      queueFailed: 6
    };
    expect(record).toEqual(expected);
  });

  it("persists null latencies", async () => {
    const executeTakeFirstOrThrow = vi
      .fn()
      .mockResolvedValue(makeRow({ postgres_latency_ms: null, redis_latency_ms: null }));
    const values = vi.fn().mockReturnValue({ returningAll: vi.fn().mockReturnThis(), executeTakeFirstOrThrow });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { insertInto: vi.fn().mockReturnValue({ values }) } as any;

    const record = await recordSystemHealthSample(db, {
      capturedAt: CAPTURED_AT,
      postgresLatencyMs: null,
      redisLatencyMs: null,
      queueWaiting: 0,
      queueActive: 0,
      queueFailed: 0
    });

    expect(record.postgresLatencyMs).toBeNull();
    expect(record.redisLatencyMs).toBeNull();
  });
});

describe("pruneSystemHealthSamples", () => {
  it("deletes rows older than the cutoff and returns the deleted count", async () => {
    const execute = vi.fn().mockResolvedValue([{ numDeletedRows: 7n }]);
    const where = vi.fn().mockReturnValue({ execute });
    const deleteFrom = vi.fn().mockReturnValue({ where });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { deleteFrom } as any;

    const deleted = await pruneSystemHealthSamples(db, { cutoff: CAPTURED_AT });

    expect(deleteFrom).toHaveBeenCalledWith("system_health_samples");
    expect(where).toHaveBeenCalledWith("captured_at", "<", CAPTURED_AT);
    expect(deleted).toBe(7);
  });
});

describe("listSystemHealthSamples", () => {
  it("selects the latest N rows and returns them oldest -> newest", async () => {
    // repo selects desc (newest first), then reverses in JS
    const rows = [
      makeRow({ id: "newest", captured_at: new Date("2026-06-23T12:10:00.000Z") }),
      makeRow({ id: "middle", captured_at: new Date("2026-06-23T12:05:00.000Z") }),
      makeRow({ id: "oldest", captured_at: new Date("2026-06-23T12:00:00.000Z") })
    ];
    const execute = vi.fn().mockResolvedValue(rows);
    const limit = vi.fn().mockReturnValue({ execute });
    const orderByDesc2 = vi.fn().mockReturnValue({ limit });
    const orderByDesc1 = vi.fn().mockReturnValue({ orderBy: orderByDesc2 });
    const selectAll = vi.fn().mockReturnValue({ orderBy: orderByDesc1 });
    const selectFrom = vi.fn().mockReturnValue({ selectAll });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { selectFrom } as any;

    const result = await listSystemHealthSamples(db, { limit: 60 });

    expect(selectFrom).toHaveBeenCalledWith("system_health_samples");
    expect(orderByDesc1).toHaveBeenCalledWith("captured_at", "desc");
    expect(orderByDesc2).toHaveBeenCalledWith("id", "desc");
    expect(limit).toHaveBeenCalledWith(60);
    expect(result.map((r) => r.id)).toEqual(["oldest", "middle", "newest"]);
  });
});
```

Run `pnpm --filter @sigmon/db test system-health-samples` and SEE it fail (module not found).

### Step 1.4 — Implement the repository

Create `packages/db/src/repositories/system-health-samples.ts`, mirroring `backups.ts` (record + camelCase mapper) and `system.ts` (read helpers). The `numDeletedRows` is a `bigint` returned by Kysely's `executeTakeFirst()` on `deleteFrom().execute()`; convert with `Number(...)`.

```ts
import type { Selectable, Transaction } from "kysely";
import type { Db } from "../client.js";
import type { Database, SystemHealthSamplesTable } from "../schema.js";

type SystemHealthSampleRow = Selectable<SystemHealthSamplesTable>;
type SystemHealthSamplesDb = Db | Transaction<Database>;

export type SystemHealthSampleRecord = {
  id: string;
  capturedAt: Date;
  postgresLatencyMs: number | null;
  redisLatencyMs: number | null;
  queueWaiting: number;
  queueActive: number;
  queueFailed: number;
};

function toSystemHealthSampleRecord(row: SystemHealthSampleRow): SystemHealthSampleRecord {
  return {
    id: row.id,
    capturedAt: row.captured_at,
    postgresLatencyMs: row.postgres_latency_ms,
    redisLatencyMs: row.redis_latency_ms,
    queueWaiting: row.queue_waiting,
    queueActive: row.queue_active,
    queueFailed: row.queue_failed
  };
}

export async function recordSystemHealthSample(
  db: SystemHealthSamplesDb,
  input: {
    capturedAt: Date;
    postgresLatencyMs: number | null;
    redisLatencyMs: number | null;
    queueWaiting: number;
    queueActive: number;
    queueFailed: number;
  }
): Promise<SystemHealthSampleRecord> {
  const row = await db
    .insertInto("system_health_samples")
    .values({
      captured_at: input.capturedAt,
      postgres_latency_ms: input.postgresLatencyMs,
      redis_latency_ms: input.redisLatencyMs,
      queue_waiting: input.queueWaiting,
      queue_active: input.queueActive,
      queue_failed: input.queueFailed
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toSystemHealthSampleRecord(row);
}

export async function pruneSystemHealthSamples(
  db: SystemHealthSamplesDb,
  input: { cutoff: Date }
): Promise<number> {
  const result = await db
    .deleteFrom("system_health_samples")
    .where("captured_at", "<", input.cutoff)
    .execute();

  return result.reduce((total, row) => total + Number(row.numDeletedRows), 0);
}

export async function listSystemHealthSamples(
  db: SystemHealthSamplesDb,
  input: { limit: number }
): Promise<SystemHealthSampleRecord[]> {
  const rows = await db
    .selectFrom("system_health_samples")
    .selectAll()
    .orderBy("captured_at", "desc")
    .orderBy("id", "desc")
    .limit(input.limit)
    .execute();

  return rows.map(toSystemHealthSampleRecord).reverse();
}
```

> Note for the test: `.execute()` on a Kysely `deleteFrom` returns an array of `{ numDeletedRows: bigint }`. The test stubs `execute` to resolve `[{ numDeletedRows: 7n }]`; the reducer yields `7`. Keep the test's mock chain (`deleteFrom → where → execute`) matching this implementation exactly.

### Step 1.5 — Run + commit

Run `pnpm --filter @sigmon/db test system-health-samples` and `pnpm --filter @sigmon/db build` (tsc) — both pass. Commit:

```
git add packages/db/migrations/0016_system_health_samples.sql packages/db/src/schema.ts packages/db/src/repositories/system-health-samples.ts packages/db/src/repositories/system-health-samples.test.ts
git commit -m "feat(db): add system_health_samples table and repository"
```

---

## Task 2 — Config (env vars + `config.systemHealthHistory` + config test)

**Deliverable:** `loadConfig()` exposes `config.systemHealthHistory = { enabled, sampleIntervalMinutes, retentionHours }` with the spec defaults and overrides, covered by config-test assertions; the new vars are documented in `.env.example` and `.claude/docs/SECRETS.md`.

### Step 2.1 — TDD: write failing config-test assertions

In `packages/config/test/config.test.ts`, add a defaults test and an overrides test that mirror the existing `loads backup defaults` / `loads explicit backup settings` / `rejects non-positive` style (`baseEnv()` helper already exists). Add after the source-map retention tests (before the closing of the `describe`):

```ts
  it("loads system health history defaults", () => {
    const config = loadConfig(baseEnv());

    expect(config.systemHealthHistory).toEqual({
      enabled: true,
      sampleIntervalMinutes: 5,
      retentionHours: 48
    });
  });

  it("loads explicit system health history settings", () => {
    const config = loadConfig({
      ...baseEnv(),
      SYSTEM_HEALTH_HISTORY_ENABLED: "false",
      SYSTEM_HEALTH_SAMPLE_INTERVAL_MINUTES: "10",
      SYSTEM_HEALTH_HISTORY_RETENTION_HOURS: "72"
    });

    expect(config.systemHealthHistory).toEqual({
      enabled: false,
      sampleIntervalMinutes: 10,
      retentionHours: 72
    });
  });

  it.each(["SYSTEM_HEALTH_SAMPLE_INTERVAL_MINUTES", "SYSTEM_HEALTH_HISTORY_RETENTION_HOURS"] as const)(
    "rejects non-positive %s",
    (fieldName) => {
      expect(() => loadConfig({ ...validEnv, [fieldName]: "0" })).toThrow();
    }
  );
```

Run `pnpm --filter @sigmon/config test` and SEE it fail (`config.systemHealthHistory` is `undefined`).

### Step 2.2 — Implement the env schema + config object

In `packages/config/src/index.ts`, add the three vars to `rawConfigSchema` (after the `SOURCE_MAPS_RETENTION_BATCH_SIZE` line, which is the last entry before the schema's closing `})`). Use the existing boolean pattern (identical to `RETENTION_ENABLED`) and the `optionalPositiveInteger(default)` helper:

```ts
  SOURCE_MAPS_RETENTION_BATCH_SIZE: optionalPositiveInteger(100),
  SYSTEM_HEALTH_HISTORY_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SYSTEM_HEALTH_SAMPLE_INTERVAL_MINUTES: optionalPositiveInteger(5),
  SYSTEM_HEALTH_HISTORY_RETENTION_HOURS: optionalPositiveInteger(48)
```

(Remove the trailing comma management note: the existing last line `SOURCE_MAPS_RETENTION_BATCH_SIZE: optionalPositiveInteger(100)` currently has NO trailing comma; add a comma to it and append the three new lines as shown above.)

Then add the returned config slice at the end of the returned object in `loadConfig` (after the `sourceMaps: { ... }` block, before the closing `};`):

```ts
    sourceMaps: {
      localDir: parsed.SOURCE_MAPS_LOCAL_DIR,
      maxUploadMb: parsed.SOURCE_MAPS_MAX_UPLOAD_MB,
      retention: {
        enabled: parsed.SOURCE_MAPS_RETENTION_ENABLED,
        days: parsed.SOURCE_MAPS_RETENTION_DAYS,
        batchSize: parsed.SOURCE_MAPS_RETENTION_BATCH_SIZE
      }
    },
    systemHealthHistory: {
      enabled: parsed.SYSTEM_HEALTH_HISTORY_ENABLED,
      sampleIntervalMinutes: parsed.SYSTEM_HEALTH_SAMPLE_INTERVAL_MINUTES,
      retentionHours: parsed.SYSTEM_HEALTH_HISTORY_RETENTION_HOURS
    }
```

(Add the trailing comma to the closing `}` of the `sourceMaps` block, then append the `systemHealthHistory` block as the new last entry.)

### Step 2.3 — Document env vars (`.env.example` + SECRETS.md)

In `.env.example`, append after the source-maps block (the file currently ends its source-maps section near `SOURCE_MAPS_RETENTION_ENABLED=true` and friends — add these three lines in that operational-config region, matching the `KEY=value` style with no spaces):

```
SYSTEM_HEALTH_HISTORY_ENABLED=true
SYSTEM_HEALTH_SAMPLE_INTERVAL_MINUTES=5
SYSTEM_HEALTH_HISTORY_RETENTION_HOURS=48
```

In `.claude/docs/SECRETS.md`, append three table rows mirroring the existing `RETENTION_*` rows (`| var | No | default | Non-secret operational config. ... |`):

```
| `SYSTEM_HEALTH_HISTORY_ENABLED` | No | `true` | Non-secret operational config. Enables the worker health-history sampler that records a bounded system_health_samples time-series. |
| `SYSTEM_HEALTH_SAMPLE_INTERVAL_MINUTES` | No | `5` | Non-secret operational config. Minutes between health-history samples. |
| `SYSTEM_HEALTH_HISTORY_RETENTION_HOURS` | No | `48` | Non-secret operational config. Age after which health-history samples are pruned on every sampler run. |
```

### Step 2.4 — Run + commit

Run `pnpm --filter @sigmon/config test` (pass) and `pnpm --filter @sigmon/config build`. Commit:

```
git add packages/config/src/index.ts packages/config/test/config.test.ts .env.example .claude/docs/SECRETS.md
git commit -m "feat(config): add system health history sampling config"
```

---

## Task 3 — Worker sample job (collect + run-once + scheduler + wire-up + test)

**Deliverable:** `apps/worker/src/system-health-samples.ts` with `collectHealthSample`, `runHealthSampleOnce`, and `startHealthSampleScheduler`; wired into `apps/worker/src/main.ts` gated by `runsScheduler && config.systemHealthHistory.enabled` with an ordered-shutdown stop fn; covered by a worker test mirroring the backup/retention scheduler tests.

### Step 3.1 — TDD: write the failing worker test

Create `apps/worker/test/system-health-samples.test.ts`. Mirror the structure of `apps/worker/test/backups.test.ts` (`startBackupScheduler` test at lines 666-698 uses injected `setTimeoutFn`/`setIntervalFn` + callback capture; `runBackupOnce` tests inject `now`/`withLock`/`recordBackupRun`). Cover the three exported functions:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  collectHealthSample,
  runHealthSampleOnce,
  startHealthSampleScheduler
} from "../src/system-health-samples.js";

const NOW = new Date("2026-06-23T12:00:00.000Z");

describe("collectHealthSample", () => {
  it("returns measured latencies and queue counts on success", async () => {
    const sample = await collectHealthSample({
      now: () => NOW,
      postgresPing: async () => undefined,
      redisPing: async () => "PONG",
      getQueueCounts: async () => ({ waiting: 4, active: 5, failed: 6 })
    });

    expect(sample.capturedAt).toEqual(NOW);
    expect(typeof sample.postgresLatencyMs).toBe("number");
    expect(typeof sample.redisLatencyMs).toBe("number");
    expect(sample.queueWaiting).toBe(4);
    expect(sample.queueActive).toBe(5);
    expect(sample.queueFailed).toBe(6);
  });

  it("uses null latency when a ping rejects and never throws", async () => {
    const sample = await collectHealthSample({
      now: () => NOW,
      postgresPing: async () => {
        throw new Error("postgres down");
      },
      redisPing: async () => {
        throw new Error("redis down");
      },
      getQueueCounts: async () => ({ waiting: 1, active: 2, failed: 3 })
    });

    expect(sample.postgresLatencyMs).toBeNull();
    expect(sample.redisLatencyMs).toBeNull();
    expect(sample.queueWaiting).toBe(1);
  });

  it("uses zero queue counts when the queue read rejects", async () => {
    const sample = await collectHealthSample({
      now: () => NOW,
      postgresPing: async () => undefined,
      redisPing: async () => "PONG",
      getQueueCounts: async () => {
        throw new Error("queue unavailable");
      }
    });

    expect(sample.queueWaiting).toBe(0);
    expect(sample.queueActive).toBe(0);
    expect(sample.queueFailed).toBe(0);
  });

  it("defaults missing queue count fields to zero", async () => {
    const sample = await collectHealthSample({
      now: () => NOW,
      postgresPing: async () => undefined,
      redisPing: async () => "PONG",
      getQueueCounts: async () => ({ waiting: 9 })
    });

    expect(sample.queueWaiting).toBe(9);
    expect(sample.queueActive).toBe(0);
    expect(sample.queueFailed).toBe(0);
  });
});

describe("runHealthSampleOnce", () => {
  it("records the collected sample then prunes with the retention cutoff", async () => {
    const collected = {
      capturedAt: NOW,
      postgresLatencyMs: 2,
      redisLatencyMs: 3,
      queueWaiting: 4,
      queueActive: 5,
      queueFailed: 6
    };
    const collect = vi.fn().mockResolvedValue(collected);
    const record = vi.fn().mockResolvedValue(undefined);
    const prune = vi.fn().mockResolvedValue(0);

    await runHealthSampleOnce({
      collect,
      record,
      prune,
      retentionHours: 48,
      now: () => NOW
    });

    expect(record).toHaveBeenCalledWith(collected);
    expect(prune).toHaveBeenCalledWith({
      cutoff: new Date(NOW.getTime() - 48 * 60 * 60 * 1000)
    });
    // record must run before prune
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(prune.mock.invocationCallOrder[0]);
  });
});

describe("startHealthSampleScheduler", () => {
  it("runs once after startup and prevents overlapping runs", async () => {
    const callbacks: Array<() => void> = [];
    let resolveRun!: () => void;
    const activeRun = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    const runOnce = vi.fn(() => activeRun);
    const setTimeoutFn = vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    const setIntervalFn = vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return 2 as unknown as ReturnType<typeof setInterval>;
    });
    const clearTimeoutFn = vi.fn();
    const clearIntervalFn = vi.fn();

    const stop = startHealthSampleScheduler({
      intervalMinutes: 5,
      runOnce,
      setTimeoutFn,
      setIntervalFn,
      clearTimeoutFn,
      clearIntervalFn
    });

    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);
    callbacks[0]();
    callbacks[1]();
    expect(runOnce).toHaveBeenCalledTimes(1);
    resolveRun();
    await stop();
    expect(clearTimeoutFn).toHaveBeenCalled();
    expect(clearIntervalFn).toHaveBeenCalled();
  });
});
```

Run `pnpm --filter @sigmon/worker test system-health-samples` and SEE it fail (module not found).

### Step 3.2 — Implement the sample job

Create `apps/worker/src/system-health-samples.ts`. The `collectHealthSample` timer mirrors `measure()` in `apps/api/src/system-health.ts` (latency = `Math.round(performance.now() - started)`, `null` on throw). The scheduler is a verbatim copy of `startRetentionScheduler` / `startBackupScheduler` (1s startup jitter, no-overlap guard, async stop). The `SystemHealthSampleInput` shape matches the repository's `recordSystemHealthSample` input exactly.

```ts
type SystemHealthSampleInput = {
  capturedAt: Date;
  postgresLatencyMs: number | null;
  redisLatencyMs: number | null;
  queueWaiting: number;
  queueActive: number;
  queueFailed: number;
};

type QueueCounts = { waiting?: number; active?: number; failed?: number };

async function measureLatency(fn: () => Promise<unknown>): Promise<number | null> {
  const started = performance.now();
  try {
    await fn();
    return Math.round(performance.now() - started);
  } catch {
    return null;
  }
}

export async function collectHealthSample(input: {
  now: () => Date;
  postgresPing: () => Promise<unknown>;
  redisPing: () => Promise<string>;
  getQueueCounts: () => Promise<QueueCounts>;
}): Promise<SystemHealthSampleInput> {
  const [postgresLatencyMs, redisLatencyMs, queueCounts] = await Promise.all([
    measureLatency(input.postgresPing),
    measureLatency(input.redisPing),
    input.getQueueCounts().catch(() => ({}) as QueueCounts)
  ]);

  return {
    capturedAt: input.now(),
    postgresLatencyMs,
    redisLatencyMs,
    queueWaiting: queueCounts.waiting ?? 0,
    queueActive: queueCounts.active ?? 0,
    queueFailed: queueCounts.failed ?? 0
  };
}

export async function runHealthSampleOnce(input: {
  collect: () => Promise<SystemHealthSampleInput>;
  record: (sample: SystemHealthSampleInput) => Promise<unknown>;
  prune: (input: { cutoff: Date }) => Promise<unknown>;
  retentionHours: number;
  now: () => Date;
}): Promise<void> {
  const sample = await input.collect();
  await input.record(sample);
  const cutoff = new Date(input.now().getTime() - input.retentionHours * 60 * 60 * 1000);
  await input.prune({ cutoff });
}

type IntervalHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export function startHealthSampleScheduler(input: {
  intervalMinutes: number;
  runOnce: () => Promise<unknown>;
  setIntervalFn?: (callback: () => void, delay: number) => IntervalHandle;
  setTimeoutFn?: (callback: () => void, delay: number) => TimeoutHandle;
  clearIntervalFn?: (handle: IntervalHandle) => void;
  clearTimeoutFn?: (handle: TimeoutHandle) => void;
}): () => Promise<void> {
  const setIntervalFn = input.setIntervalFn ?? setInterval;
  const setTimeoutFn = input.setTimeoutFn ?? setTimeout;
  const clearIntervalFn = input.clearIntervalFn ?? clearInterval;
  const clearTimeoutFn = input.clearTimeoutFn ?? clearTimeout;
  let stopped = false;
  let activeRun: Promise<void> | null = null;

  const tick = () => {
    if (stopped || activeRun) return;
    activeRun = (async () => {
      try {
        await input.runOnce();
      } catch (error) {
        console.error("Health sample scheduler run failed", error);
      } finally {
        activeRun = null;
      }
    })();
  };

  const startupTimer = setTimeoutFn(tick, 1000);
  const interval = setIntervalFn(tick, input.intervalMinutes * 60 * 1000);

  return async () => {
    stopped = true;
    clearTimeoutFn(startupTimer);
    clearIntervalFn(interval);
    await activeRun;
  };
}
```

Run `pnpm --filter @sigmon/worker test system-health-samples` and SEE it pass.

### Step 3.3 — Wire into `apps/worker/src/main.ts`

The sample job runs under the **scheduler** role, but the worker only creates a Redis connection + telemetry Queue under the **queue** role (`runsQueue`). To probe Redis/queue from the scheduler, lazily create a dedicated Redis client and telemetry Queue only when the sampler is enabled, and close them in the ordered shutdown.

a) Add imports (alongside the existing repository + worker-module imports):

```ts
import { createTelemetryQueue } from "@sigmon/queues";
import {
  listSystemHealthSamples,
  pruneSystemHealthSamples,
  recordSystemHealthSample
} from "@sigmon/db/repositories/system-health-samples.js";
import { collectHealthSample, runHealthSampleOnce, startHealthSampleScheduler } from "./system-health-samples.js";
import { sql } from "kysely";
```

> Check whether `sql` and `createTelemetryQueue` are already imported in `main.ts`; if so, do not duplicate the import. (`sql` is needed for `postgresPing`.)

b) After the `stopBackups` block (and before the `logger.info(... "Telemetry worker started")` line), add the sampler setup gated on `runsScheduler && config.systemHealthHistory.enabled`:

```ts
const healthSampleConnection =
  runsScheduler && config.systemHealthHistory.enabled
    ? new Redis(config.redisUrl, { maxRetriesPerRequest: null })
    : null;
const healthSampleQueue =
  runsScheduler && config.systemHealthHistory.enabled ? createTelemetryQueue(config.redisUrl) : null;

const stopHealthSamples =
  healthSampleConnection && healthSampleQueue
    ? startHealthSampleScheduler({
        intervalMinutes: config.systemHealthHistory.sampleIntervalMinutes,
        runOnce: () =>
          runHealthSampleOnce({
            now: () => new Date(),
            retentionHours: config.systemHealthHistory.retentionHours,
            collect: () =>
              collectHealthSample({
                now: () => new Date(),
                postgresPing: () => sql`select 1`.execute(db),
                redisPing: () => healthSampleConnection.ping(),
                getQueueCounts: () => healthSampleQueue.getJobCounts("waiting", "active", "failed")
              }),
            record: (sample) => recordSystemHealthSample(db, sample),
            prune: (input) => pruneSystemHealthSamples(db, input)
          })
      })
    : async () => {};
```

> `getJobCounts("waiting","active","failed")` returns `Promise<{ [index: string]: number }>` in BullMQ; the `QueueCounts` shape in `collectHealthSample` reads `.waiting/.active/.failed`, so this is type-compatible. `listSystemHealthSamples` is imported here only so it is available to the API layer wiring in Task 4 — if Task 3 lands first and the unused import trips lint, defer that single import to Task 4. (Prefer adding it in Task 4.)

c) Add stop steps to the ordered shutdown array in `shutdown()`, placing `stopHealthSamples` **first** (it is the newest scheduler; stop schedulers before heartbeats/connections), and close the dedicated Redis/queue after `stopBackups` but before `db.destroy`:

```ts
  await runShutdownSteps(
    [
      { name: "stopHealthSamples", run: () => stopHealthSamples() },
      { name: "stopBackups", run: () => stopBackups() },
      { name: "stopMonitors", run: () => stopMonitors() },
      { name: "stopAlerts", run: () => stopAlerts() },
      { name: "stopRetention", run: () => stopRetention() },
      { name: "stopSchedulerHeartbeat", run: () => stopSchedulerHeartbeat() },
      { name: "stopWorkerHeartbeat", run: () => stopWorkerHeartbeat() },
      { name: "worker.close", run: () => worker?.close() ?? Promise.resolve() },
      { name: "healthSampleQueue.close", run: () => healthSampleQueue?.close() ?? Promise.resolve() },
      { name: "healthSampleConnection.quit", run: () => healthSampleConnection?.quit() ?? Promise.resolve() },
      { name: "connection.quit", run: () => connection?.quit() ?? Promise.resolve() },
      { name: "db.destroy", run: () => db.destroy() }
    ],
    10_000,
    logger
  );
```

### Step 3.4 — Run + commit

Run `pnpm --filter @sigmon/worker test` (all pass) and `pnpm --filter @sigmon/worker build`. (`db.destroy` and `connection.quit` lines are unchanged context — only insert the new entries.) Commit:

```
git add apps/worker/src/system-health-samples.ts apps/worker/test/system-health-samples.test.ts apps/worker/src/main.ts
git commit -m "feat(worker): sample and prune system health history"
```

---

## Task 4 — API endpoint + console client (route + wire-up + test + client/type)

**Deliverable:** `GET /system/health/history?limit=N` returns `{ data: SystemHealthSampleResponse[] }` oldest→newest with the same auth as `/system/health`, wired in `apps/api/src/main.ts`; the console client exposes `getSystemHealthHistory` and the matching `SystemHealthSampleResponse` type. All API + console tests pass.

### Step 4.1 — TDD: extend `apps/api/test/system.test.ts`

Append a new `describe("system health history routes")` block (the existing `systemHealthSnapshot` fixture and `auth` const are reusable from the top of the file). Cover: 401 unauth, 501 when `getHistory` absent, `{ data }` oldest→newest for an authed user, and limit clamping.

```ts
const sampleHistory = [
  {
    capturedAt: "2026-06-23T12:00:00.000Z",
    postgresLatencyMs: 2,
    redisLatencyMs: 3,
    queueWaiting: 4,
    queueActive: 5,
    queueFailed: 6
  },
  {
    capturedAt: "2026-06-23T12:05:00.000Z",
    postgresLatencyMs: 7,
    redisLatencyMs: null,
    queueWaiting: 0,
    queueActive: 0,
    queueFailed: 0
  }
];

describe("system health history routes", () => {
  it("requires authentication", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: undefined,
      system: { getHealth: async () => systemHealthSnapshot, getHistory: async () => sampleHistory }
    });

    const response = await app.inject({ method: "GET", url: "/system/health/history" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns unavailable when the history dependency is missing", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth,
      system: { getHealth: async () => systemHealthSnapshot }
    });

    const response = await app.inject({ method: "GET", url: "/system/health/history" });
    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "system_health_history_unavailable" });
  });

  it("returns history oldest -> newest for authenticated users", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth,
      system: { getHealth: async () => systemHealthSnapshot, getHistory: async () => sampleHistory }
    });

    const response = await app.inject({ method: "GET", url: "/system/health/history" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: sampleHistory });
  });

  it("clamps the limit to [1, 480] and defaults to 60", async () => {
    const seen: number[] = [];
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth,
      system: {
        getHealth: async () => systemHealthSnapshot,
        getHistory: async ({ limit }) => {
          seen.push(limit);
          return sampleHistory;
        }
      }
    });

    await app.inject({ method: "GET", url: "/system/health/history" });
    await app.inject({ method: "GET", url: "/system/health/history?limit=0" });
    await app.inject({ method: "GET", url: "/system/health/history?limit=9999" });
    await app.inject({ method: "GET", url: "/system/health/history?limit=abc" });

    expect(seen).toEqual([60, 1, 480, 60]);
  });

  it("returns unavailable when the history dependency fails", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth,
      system: {
        getHealth: async () => systemHealthSnapshot,
        getHistory: async () => {
          throw new Error("history dependency failed");
        }
      }
    });

    const response = await app.inject({ method: "GET", url: "/system/health/history" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "system_health_history_unavailable" });
  });
});
```

Run `pnpm --filter @sigmon/api test system` and SEE it fail (route/dep absent → 404/501 mismatches).

### Step 4.2 — Implement the route + types in `apps/api/src/routes/system.ts`

Add the response type (after `SystemHealthSnapshot`), extend `SystemHealthDependencies`, and register the route inside `registerSystemRoutes` after the `/system/health` handler. Mirror the auth + envelope of `/system/health` exactly.

Add the exported type near the other exported types (e.g. after the `SystemHealthSnapshot` type ends):

```ts
export type SystemHealthSampleResponse = {
  capturedAt: string;
  postgresLatencyMs: number | null;
  redisLatencyMs: number | null;
  queueWaiting: number;
  queueActive: number;
  queueFailed: number;
};
```

Extend `SystemHealthDependencies`:

```ts
export type SystemHealthDependencies = {
  getHealth?: () => Promise<SystemHealthSnapshot>;
  getHistory?: (input: { limit: number }) => Promise<SystemHealthSampleResponse[]>;
};
```

Add a clamp helper above `registerSystemRoutes`:

```ts
function parseHistoryLimit(raw: unknown): number {
  const value = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(value)) return 60;
  return Math.min(480, Math.max(1, value));
}
```

Register the route inside `registerSystemRoutes`, after the existing `/system/health` handler (still within the function body):

```ts
  app.get("/system/health/history", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await options.auth?.findSessionUser(request as Parameters<AuthDependencies["findSessionUser"]>[0]);
    if (!user) {
      setCurrentUser(request, null);
      return reply.code(401).send({ error: "unauthenticated" });
    }
    setCurrentUser(request, user);

    if (!options.system?.getHistory) {
      return reply.code(501).send({ error: "system_health_history_unavailable" });
    }

    const limit = parseHistoryLimit((request.query as { limit?: unknown } | undefined)?.limit);

    try {
      return { data: await options.system.getHistory({ limit }) };
    } catch {
      return reply.code(503).send({ error: "system_health_history_unavailable" });
    }
  });
```

### Step 4.3 — Wire `getHistory` in `apps/api/src/main.ts`

Add the repository import (alongside the existing `@sigmon/db/repositories/system.js` imports):

```ts
import { listSystemHealthSamples } from "@sigmon/db/repositories/system-health-samples.js";
```

Extend the `system:` dependency block (currently `system: { getHealth: getSystemHealth }`):

```ts
  system: {
    getHealth: getSystemHealth,
    getHistory: ({ limit }) =>
      listSystemHealthSamples(db, { limit }).then((rows) =>
        rows.map((r) => ({
          capturedAt: r.capturedAt.toISOString(),
          postgresLatencyMs: r.postgresLatencyMs,
          redisLatencyMs: r.redisLatencyMs,
          queueWaiting: r.queueWaiting,
          queueActive: r.queueActive,
          queueFailed: r.queueFailed
        }))
      )
  },
```

Run `pnpm --filter @sigmon/api test system` and SEE it pass.

### Step 4.4 — Console client + type

In `apps/console/src/api/types.ts`, add the type (next to `SystemHealthResponse`, ~line 866):

```ts
export type SystemHealthSampleResponse = {
  capturedAt: string;
  postgresLatencyMs: number | null;
  redisLatencyMs: number | null;
  queueWaiting: number;
  queueActive: number;
  queueFailed: number;
};
```

In `apps/console/src/api/client.ts`:

a) Add `SystemHealthSampleResponse` to the type import block that already imports `SystemHealthResponse` (~line 47).

b) Add the method to the client interface, right after the `getSystemHealth` declaration (~line 250):

```ts
  getSystemHealth: () => Promise<AggregateResponse<SystemHealthResponse>>;
  getSystemHealthHistory: (params?: { limit?: number }) => Promise<AggregateResponse<SystemHealthSampleResponse[]>>;
```

c) Add the implementation right after the `getSystemHealth:` implementation (~line 784). The existing `request` + `path` helpers handle the envelope; build the optional `?limit=` with `URLSearchParams` (matching the codebase's query-building convention):

```ts
    getSystemHealth: () => request<AggregateResponse<SystemHealthResponse>>(path(apiBasePath, "/system/health")),
    getSystemHealthHistory: (params) => {
      const search = new URLSearchParams();
      if (params?.limit !== undefined) {
        search.set("limit", String(params.limit));
      }
      const query = search.toString();
      return request<AggregateResponse<SystemHealthSampleResponse[]>>(
        path(apiBasePath, `/system/health/history${query ? `?${query}` : ""}`)
      );
    },
```

> The console package has no dedicated client test for `getSystemHealth` (it is exercised via screen tests in Phase B). Adding a client test here is out of scope; type-checking via `pnpm build` is the gate for this step.

### Step 4.5 — Full verification gate + commit

Run the complete gate from the repo root and confirm each passes:

```
pnpm test
pnpm build
pnpm --filter @sigmon/sdk build
docker compose config
```

Commit:

```
git add apps/api/src/routes/system.ts apps/api/src/main.ts apps/api/test/system.test.ts apps/console/src/api/types.ts apps/console/src/api/client.ts
git commit -m "feat(api): expose system health history read endpoint"
```

---

## Self-review (completed before saving this plan)

- **Placeholder scan:** no `TODO`, `...`, `<fill in>`, or `// implement` left; every code step is verbatim and complete.
- **Migration ↔ schema column-name match:** `id`, `captured_at`, `postgres_latency_ms`, `redis_latency_ms`, `queue_waiting`, `queue_active`, `queue_failed` are identical between `0016_system_health_samples.sql` and `SystemHealthSamplesTable`. ✓
- **Schema ↔ repository row-mapper match:** `toSystemHealthSampleRecord` reads exactly those seven snake_case columns and maps to the seven camelCase record fields. ✓
- **Record ↔ worker input match:** `recordSystemHealthSample` input and `collectHealthSample` output share `{ capturedAt, postgresLatencyMs, redisLatencyMs, queueWaiting, queueActive, queueFailed }`. ✓
- **Repository ↔ route/console response match:** `SystemHealthSampleResponse` (route + console) is the record minus `id`, with `capturedAt` as ISO string; the main.ts mapper converts `capturedAt` via `.toISOString()` and passes the other six fields through. ✓
- **Naming clash check:** the new names use "sample"/"history" throughout; `SystemHealthSnapshot`/`createSystemHealthSnapshot` are untouched. ✓
- **Pruning semantics:** `runHealthSampleOnce` always prunes after recording with `cutoff = now − retentionHours`; `pruneSystemHealthSamples` deletes `where captured_at < cutoff` and returns the count. ✓
- **Endpoint contract:** default limit 60, clamp `[1,480]`, 501 when dep absent, 503 on throw, `{ data }` oldest→newest, same `findSessionUser` 401 auth. ✓
- **Config defaults:** `enabled` true, `sampleIntervalMinutes` 5, `retentionHours` 48; documented in `.env.example` + SECRETS.md. ✓
- **Test style match:** db repo test uses the mock-Kysely-builder convention; worker test mirrors `startBackupScheduler`/`runBackupOnce`; api test extends `system.test.ts` with `app.inject`. ✓
- **TDD + commit cadence:** each task writes a failing test first and ends with its own commit; commits omit AI trailers. ✓
