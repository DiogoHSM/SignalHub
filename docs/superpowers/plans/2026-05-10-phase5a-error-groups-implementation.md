# Phase 5A Error Groups and Status Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add grouped error issues with mutable workflow status while preserving immutable raw error occurrences.

**Architecture:** Store operational grouping state in a new `error_groups` table and attach raw `errors` rows through `error_group_id`. The worker-owned persistence path computes deterministic grouping fingerprints and updates group lifecycle fields, while the API and console expose group triage as the default Errors workflow with raw occurrences preserved in a peer tab.

**Tech Stack:** TypeScript, Kysely, Postgres, Fastify, React, Vitest, Testcontainers.

---

## Scope Check

This plan implements only Phase 5A from `docs/superpowers/specs/2026-05-10-phase5a-error-groups-design.md`.

Included:

- deterministic error grouping,
- `error_groups` persistence and backfill,
- group lifecycle status,
- grouped query APIs,
- console `Groups` / `Raw occurrences` Errors layout,
- docs and memory updates.

Excluded:

- source maps,
- semantic or AI grouping,
- assignments/comments/SLA workflow,
- alerts from group status changes,
- generic issues for other signal types.

## File Structure

Create:

- `packages/db/migrations/0005_error_groups.sql` - schema changes for error groups and raw error group columns.
- `packages/db/src/repositories/error-groups.ts` - fingerprint helpers, group upsert, backfill, list/detail/status repositories.
- `apps/console/src/components/ErrorGroupList.tsx` - group rows.
- `apps/console/src/components/ErrorGroupDetail.tsx` - selected group detail and status controls.
- `apps/console/src/components/ErrorGroupFilters.tsx` - group filters.
- `apps/console/src/components/ErrorRawOccurrencesPanel.tsx` - extracted current raw occurrence workflow.
- `apps/console/src/components/ErrorGroupsPanel.tsx` - default grouped workflow.

Modify:

- `packages/db/src/migrate.ts` - register migration `0005_error_groups.sql`.
- `packages/db/src/schema.ts` - add `ErrorGroupsTable`, new `errors` columns, and database table mapping.
- `packages/db/src/repositories/telemetry-writes.ts` - group errors during inserts.
- `packages/db/src/repositories/telemetry-query.ts` - expose `errorGroupId` on raw errors and support raw filtering by `error_group_id`.
- `packages/db/test/repositories.test.ts` - repository and backfill coverage.
- `apps/worker/src/telemetry-worker.ts` - keep writer interface compatible with grouped insert.
- `apps/worker/src/main.ts` - run idempotent backfill on startup and use grouped insert dependencies.
- `apps/worker/test/telemetry-worker.test.ts` - verify error job forwards grouping-relevant fields.
- `apps/api/src/routes/query.ts` - add group filters and routes.
- `apps/api/src/main.ts` - wire group repository methods.
- `apps/api/test/query.test.ts` - grouped API coverage.
- `apps/console/src/api/types.ts` - group types and query inputs.
- `apps/console/src/api/client.ts` - group client methods and raw `errorGroupId` query encoding.
- `apps/console/src/api/client.test.ts` - URL and mutation tests.
- `apps/console/src/components/ErrorInvestigationPanel.tsx` - split into `Groups` and `Raw occurrences`.
- `apps/console/src/components/ErrorFilters.tsx` - add optional `errorGroupId`.
- `apps/console/src/components/ErrorList.tsx` - show `errorGroupId` in each raw occurrence row.
- `apps/console/src/components/ErrorDetailDrawer.tsx` - show `errorGroupId`.
- `apps/console/src/components/ErrorInvestigationPanel.test.tsx` - grouped UI coverage.
- `apps/console/src/styles.css` - tab, group list, detail, and status-control styling.
- `.claude/docs/ARCHITECTURE.md`
- `.claude/docs/PROJECT-SUMMARY.md`
- `.claude/docs/UI-UX.md`
- `.claude/docs/DECISIONS.md`
- `README.md`

Do not modify:

- SDK API surface,
- ingestion route payload schema,
- alert evaluator behavior,
- retention policy semantics,
- source-map or release artifact handling.

## Task 1: Schema and Fingerprint Model

**Files:**

- Create: `packages/db/migrations/0005_error_groups.sql`
- Create: `packages/db/src/repositories/error-groups.ts`
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/src/schema.ts`
- Test: `packages/db/test/repositories.test.ts`

- [x] **Step 1: Add failing migration and fingerprint tests**

In `packages/db/test/repositories.test.ts`, add these imports:

```ts
import {
  buildErrorGroupingFingerprint,
  extractTopStackFrame,
  normalizeErrorGroupingInput
} from "../src/repositories/error-groups.js";
```

Append these tests near the existing migration tests:

```ts
  it("runs error group migrations", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`select id, grouping_fingerprint, status from error_groups limit 0`.execute(db);
      await sql`select error_group_id, grouping_fingerprint from errors limit 0`.execute(db);
    });
  });

  it("builds deterministic fallback error grouping fingerprints", () => {
    const first = buildErrorGroupingFingerprint({
      message: "Payment failed for user 123456",
      type: "PaymentError",
      stack: "PaymentError: failed\n    at charge (/app/src/payments.ts:42:7)"
    });
    const second = buildErrorGroupingFingerprint({
      message: " payment   failed for user 999999 ",
      type: "paymenterror",
      stack: "PaymentError: failed\n    at charge (/app/src/payments.ts:42:7)"
    });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.source).toContain("paymenterror");
    expect(first.topStackFrame).toBe("at charge (/app/src/payments.ts:42:7)");
  });

  it("uses explicit error fingerprints without hashing the fallback source", () => {
    const result = buildErrorGroupingFingerprint({
      fingerprint: "checkout-provider-timeout",
      message: "Provider timeout",
      type: "TimeoutError",
      stack: "TimeoutError: provider timeout"
    });

    expect(result.fingerprint).toBe("checkout-provider-timeout");
    expect(result.source).toBe("explicit:checkout-provider-timeout");
  });

  it("normalizes error grouping input and extracts top stack frames", () => {
    expect(normalizeErrorGroupingInput("Checkout failed for request 018f1f31-8d48-7721-86b2-80f86fd87bb6")).toBe(
      "checkout failed for request {uuid}"
    );
    expect(extractTopStackFrame("Error: failed\n    at first (/app/a.ts:1:2)\n    at second (/app/b.ts:3:4)")).toBe(
      "at first (/app/a.ts:1:2)"
    );
  });
```

- [x] **Step 2: Run repository tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: fail because `error-groups.ts`, migration registration, schema fields, and tables do not exist.

- [x] **Step 3: Add error group migration**

Create `packages/db/migrations/0005_error_groups.sql`:

```sql
CREATE TABLE error_groups (
  id text PRIMARY KEY DEFAULT ('egrp_' || encode(gen_random_bytes(12), 'hex')),
  project_id text NOT NULL,
  environment_id text NOT NULL,
  grouping_fingerprint text NOT NULL,
  message text NOT NULL,
  type text,
  top_stack_frame text,
  severity text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  last_regressed_at timestamptz,
  occurrence_count integer NOT NULL DEFAULT 0,
  affected_users_count integer NOT NULL DEFAULT 0,
  affected_tenants_count integer NOT NULL DEFAULT 0,
  latest_error_id text,
  latest_release text,
  resolved_at timestamptz,
  ignored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id),
  CONSTRAINT error_groups_status_check CHECK (status IN ('open', 'investigating', 'resolved', 'ignored')),
  CONSTRAINT error_groups_occurrence_count_check CHECK (occurrence_count >= 0),
  CONSTRAINT error_groups_affected_users_count_check CHECK (affected_users_count >= 0),
  CONSTRAINT error_groups_affected_tenants_count_check CHECK (affected_tenants_count >= 0)
);

CREATE UNIQUE INDEX error_groups_scope_fingerprint_idx
  ON error_groups(project_id, environment_id, grouping_fingerprint);

CREATE INDEX error_groups_scope_status_seen_idx
  ON error_groups(project_id, environment_id, status, last_seen_at DESC);

CREATE INDEX error_groups_scope_severity_seen_idx
  ON error_groups(project_id, environment_id, severity, last_seen_at DESC);

ALTER TABLE errors
  ADD COLUMN error_group_id text REFERENCES error_groups(id),
  ADD COLUMN grouping_fingerprint text;

CREATE INDEX errors_group_time_idx ON errors(error_group_id, timestamp DESC);
CREATE INDEX errors_grouping_fingerprint_idx ON errors(project_id, environment_id, grouping_fingerprint);
```

- [x] **Step 4: Register migration**

In `packages/db/src/migrate.ts`, append the migration to `migrations`:

```ts
  { name: "0005_error_groups.sql", url: new URL("../migrations/0005_error_groups.sql", import.meta.url) }
```

The final array should include all five migrations in order:

```ts
const migrations = [
  { name: "0001_initial.sql", url: new URL("../migrations/0001_initial.sql", import.meta.url) },
  { name: "0002_operational_safety.sql", url: new URL("../migrations/0002_operational_safety.sql", import.meta.url) },
  { name: "0003_simple_alerts.sql", url: new URL("../migrations/0003_simple_alerts.sql", import.meta.url) },
  { name: "0004_backup_runs.sql", url: new URL("../migrations/0004_backup_runs.sql", import.meta.url) },
  { name: "0005_error_groups.sql", url: new URL("../migrations/0005_error_groups.sql", import.meta.url) }
];
```

- [x] **Step 5: Update schema types**

In `packages/db/src/schema.ts`, add these types above `ErrorsTable`:

```ts
export type ErrorGroupStatus = "open" | "investigating" | "resolved" | "ignored";

export interface ErrorGroupsTable {
  id: ColumnType<string, string | undefined, string>;
  project_id: string;
  environment_id: string;
  grouping_fingerprint: string;
  message: string;
  type: string | null;
  top_stack_frame: string | null;
  severity: string;
  status: ColumnType<ErrorGroupStatus, ErrorGroupStatus | undefined, ErrorGroupStatus>;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
  last_regressed_at: NullableTimestamp;
  occurrence_count: DefaultedInteger;
  affected_users_count: DefaultedInteger;
  affected_tenants_count: DefaultedInteger;
  latest_error_id: string | null;
  latest_release: string | null;
  resolved_at: NullableTimestamp;
  ignored_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

Add these columns to `ErrorsTable` after `context`:

```ts
  error_group_id: string | null;
  grouping_fingerprint: string | null;
```

Add the table mapping to `Database` before `errors`:

```ts
  error_groups: ErrorGroupsTable;
```

- [x] **Step 6: Implement fingerprint helpers**

Create `packages/db/src/repositories/error-groups.ts`:

```ts
import { createHash } from "node:crypto";

export type ErrorGroupStatus = "open" | "investigating" | "resolved" | "ignored";

export type ErrorGroupingInput = {
  fingerprint?: string | null;
  message: string;
  type?: string | null;
  stack?: string | null;
};

export type ErrorGroupingFingerprint = {
  fingerprint: string;
  source: string;
  topStackFrame: string | null;
};

const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const longNumberPattern = /\b\d{5,}\b/g;

export function normalizeErrorGroupingInput(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(uuidPattern, "{uuid}")
    .replace(longNumberPattern, "{number}")
    .replace(/\s+/g, " ");
}

export function extractTopStackFrame(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const frame = stack
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("at ") || line.includes("@"));
  return frame ?? null;
}

export function buildErrorGroupingFingerprint(input: ErrorGroupingInput): ErrorGroupingFingerprint {
  const explicit = input.fingerprint?.trim();
  const topStackFrame = extractTopStackFrame(input.stack);
  if (explicit) {
    return {
      fingerprint: explicit,
      source: `explicit:${explicit}`,
      topStackFrame
    };
  }

  const source = [
    normalizeErrorGroupingInput(input.type),
    normalizeErrorGroupingInput(input.message),
    normalizeErrorGroupingInput(topStackFrame)
  ].join("|");

  return {
    fingerprint: `fp_${createHash("sha256").update(source).digest("hex").slice(0, 32)}`,
    source,
    topStackFrame
  };
}
```

- [x] **Step 7: Run repository tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: pass for migration and fingerprint helper tests.

- [x] **Step 8: Commit**

```bash
git add packages/db/migrations/0005_error_groups.sql packages/db/src/migrate.ts packages/db/src/schema.ts packages/db/src/repositories/error-groups.ts packages/db/test/repositories.test.ts
git commit -m "feat: add error group schema and fingerprints"
```

## Task 2: Grouped Error Writes and Backfill

**Files:**

- Modify: `packages/db/src/repositories/error-groups.ts`
- Modify: `packages/db/src/repositories/telemetry-writes.ts`
- Modify: `apps/worker/src/main.ts`
- Test: `packages/db/test/repositories.test.ts`
- Test: `apps/worker/test/telemetry-worker.test.ts`

- [x] **Step 1: Add failing repository tests for grouping lifecycle**

In `packages/db/test/repositories.test.ts`, extend the error-groups import:

```ts
import {
  backfillErrorGroups,
  buildErrorGroupingFingerprint,
  extractTopStackFrame,
  getErrorGroup,
  listErrorGroups,
  normalizeErrorGroupingInput,
  updateErrorGroupStatus
} from "../src/repositories/error-groups.js";
```

Append these tests near the telemetry write/query tests:

```ts
  it("groups new error inserts and reopens resolved groups on recurrence", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await createProject(db, { id: "prj_grouping", name: "Grouping" });
      await createEnvironment(db, { id: "env_grouping", projectId: "prj_grouping", name: "production" });

      await insertError(db, {
        id: "err_grouping_1",
        projectId: "prj_grouping",
        environmentId: "env_grouping",
        timestamp: new Date("2026-05-10T12:00:00.000Z"),
        receivedAt: new Date("2026-05-10T12:00:01.000Z"),
        message: "Checkout failed for order 123456",
        type: "CheckoutError",
        severity: "critical",
        stack: "CheckoutError: failed\n    at pay (/app/pay.ts:10:2)",
        userId: "user_1",
        tenantId: "tenant_1",
        release: "1.0.0"
      });

      const groups = await listErrorGroups(db, {
        projectId: "prj_grouping",
        environmentId: "env_grouping",
        limit: 10
      });

      expect(groups).toHaveLength(1);
      expect(groups[0]).toEqual(
        expect.objectContaining({
          message: "Checkout failed for order 123456",
          status: "open",
          occurrenceCount: 1,
          affectedUsersCount: 1,
          affectedTenantsCount: 1,
          latestErrorId: "err_grouping_1",
          latestRelease: "1.0.0"
        })
      );

      await updateErrorGroupStatus(db, {
        id: groups[0]!.id,
        projectId: "prj_grouping",
        environmentId: "env_grouping",
        status: "resolved",
        now: new Date("2026-05-10T12:05:00.000Z")
      });

      await insertError(db, {
        id: "err_grouping_2",
        projectId: "prj_grouping",
        environmentId: "env_grouping",
        timestamp: new Date("2026-05-10T12:10:00.000Z"),
        receivedAt: new Date("2026-05-10T12:10:01.000Z"),
        message: "Checkout failed for order 999999",
        type: "CheckoutError",
        severity: "error",
        stack: "CheckoutError: failed\n    at pay (/app/pay.ts:10:2)",
        userId: "user_2",
        tenantId: "tenant_1",
        release: "1.0.1"
      });

      const reopened = await getErrorGroup(db, {
        id: groups[0]!.id,
        projectId: "prj_grouping",
        environmentId: "env_grouping"
      });

      expect(reopened).toEqual(
        expect.objectContaining({
          status: "open",
          occurrenceCount: 2,
          affectedUsersCount: 2,
          affectedTenantsCount: 1,
          latestErrorId: "err_grouping_2",
          latestRelease: "1.0.1",
          resolvedAt: null,
          lastRegressedAt: expect.any(Date)
        })
      );
    });
  });

  it("keeps ignored groups ignored when matching errors recur", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await createProject(db, { id: "prj_ignored_group", name: "Ignored Group" });
      await createEnvironment(db, { id: "env_ignored_group", projectId: "prj_ignored_group", name: "production" });

      await insertError(db, {
        id: "err_ignored_1",
        projectId: "prj_ignored_group",
        environmentId: "env_ignored_group",
        timestamp: new Date("2026-05-10T12:00:00.000Z"),
        receivedAt: new Date("2026-05-10T12:00:01.000Z"),
        message: "Known browser extension noise",
        severity: "warning",
        fingerprint: "browser-extension-noise"
      });

      const [group] = await listErrorGroups(db, {
        projectId: "prj_ignored_group",
        environmentId: "env_ignored_group",
        limit: 10
      });

      await updateErrorGroupStatus(db, {
        id: group!.id,
        projectId: "prj_ignored_group",
        environmentId: "env_ignored_group",
        status: "ignored",
        now: new Date("2026-05-10T12:05:00.000Z")
      });

      await insertError(db, {
        id: "err_ignored_2",
        projectId: "prj_ignored_group",
        environmentId: "env_ignored_group",
        timestamp: new Date("2026-05-10T12:10:00.000Z"),
        receivedAt: new Date("2026-05-10T12:10:01.000Z"),
        message: "Known browser extension noise",
        severity: "warning",
        fingerprint: "browser-extension-noise"
      });

      const ignored = await getErrorGroup(db, {
        id: group!.id,
        projectId: "prj_ignored_group",
        environmentId: "env_ignored_group"
      });

      expect(ignored).toEqual(expect.objectContaining({ status: "ignored", occurrenceCount: 2, lastRegressedAt: null }));
    });
  });

  it("backfills existing errors into groups idempotently", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await createProject(db, { id: "prj_backfill_groups", name: "Backfill Groups" });
      await createEnvironment(db, { id: "env_backfill_groups", projectId: "prj_backfill_groups", name: "production" });

      await sql`
        insert into errors (
          id, project_id, environment_id, timestamp, received_at, message, type, severity, stack, status, fingerprint, context
        )
        values
          ('err_backfill_1', 'prj_backfill_groups', 'env_backfill_groups', '2026-05-10T12:00:00.000Z', '2026-05-10T12:00:01.000Z', 'Backfill failed for user 123456', 'BackfillError', 'error', 'BackfillError: failed\n    at run (/app/run.ts:1:1)', 'open', null, '{}'),
          ('err_backfill_2', 'prj_backfill_groups', 'env_backfill_groups', '2026-05-10T12:05:00.000Z', '2026-05-10T12:05:01.000Z', 'Backfill failed for user 999999', 'BackfillError', 'critical', 'BackfillError: failed\n    at run (/app/run.ts:1:1)', 'open', null, '{}')
      `.execute(db);

      await backfillErrorGroups(db, { batchSize: 100 });
      await backfillErrorGroups(db, { batchSize: 100 });

      const groups = await listErrorGroups(db, {
        projectId: "prj_backfill_groups",
        environmentId: "env_backfill_groups",
        limit: 10
      });

      expect(groups).toHaveLength(1);
      expect(groups[0]).toEqual(
        expect.objectContaining({
          occurrenceCount: 2,
          severity: "critical",
          latestErrorId: "err_backfill_2"
        })
      );
    });
  });
```

- [x] **Step 2: Run repository tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: fail because group repositories and grouped insert behavior are not implemented.

- [x] **Step 3: Implement group repository functions**

In `packages/db/src/repositories/error-groups.ts`, keep the fingerprint helpers and add these exports:

```ts
import type { Selectable } from "kysely";
import { sql } from "kysely";
import type { Db } from "../client.js";
import type { ErrorGroupsTable } from "../schema.js";

type ErrorGroupRow = Selectable<ErrorGroupsTable>;

const severityRank: Record<string, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  critical: 4,
  fatal: 5
};

export type ErrorGroupRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  groupingFingerprint: string;
  message: string;
  type: string | null;
  topStackFrame: string | null;
  severity: string;
  status: ErrorGroupStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastRegressedAt: Date | null;
  occurrenceCount: number;
  affectedUsersCount: number;
  affectedTenantsCount: number;
  latestErrorId: string | null;
  latestRelease: string | null;
  resolvedAt: Date | null;
  ignoredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ErrorGroupFilters = {
  projectId: string;
  environmentId: string;
  status?: ErrorGroupStatus;
  severity?: string;
  fingerprint?: string;
  tenantId?: string;
  userId?: string;
  release?: string;
  from?: Date;
  to?: Date;
  limit?: number;
};

export type UpsertErrorGroupInput = {
  projectId: string;
  environmentId: string;
  message: string;
  type?: string | null;
  severity: string;
  stack?: string | null;
  fingerprint?: string | null;
  timestamp: Date;
  userId?: string | null;
  tenantId?: string | null;
  release?: string | null;
  errorId: string;
};

function toGroup(row: ErrorGroupRow): ErrorGroupRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    groupingFingerprint: row.grouping_fingerprint,
    message: row.message,
    type: row.type,
    topStackFrame: row.top_stack_frame,
    severity: row.severity,
    status: row.status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastRegressedAt: row.last_regressed_at,
    occurrenceCount: row.occurrence_count,
    affectedUsersCount: row.affected_users_count,
    affectedTenantsCount: row.affected_tenants_count,
    latestErrorId: row.latest_error_id,
    latestRelease: row.latest_release,
    resolvedAt: row.resolved_at,
    ignoredAt: row.ignored_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function strongerSeverity(current: string, next: string): string {
  return (severityRank[next] ?? 0) > (severityRank[current] ?? 0) ? next : current;
}

export async function upsertErrorGroupForOccurrence(db: Db, input: UpsertErrorGroupInput): Promise<ErrorGroupingFingerprint & { groupId: string }> {
  return db.transaction().execute(async (trx) => {
    const grouping = buildErrorGroupingFingerprint(input);
    const existing = await trx
      .selectFrom("error_groups")
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("environment_id", "=", input.environmentId)
      .where("grouping_fingerprint", "=", grouping.fingerprint)
      .executeTakeFirst();

    if (!existing) {
      const inserted = await trx
        .insertInto("error_groups")
        .values({
          project_id: input.projectId,
          environment_id: input.environmentId,
          grouping_fingerprint: grouping.fingerprint,
          message: input.message,
          type: input.type ?? null,
          top_stack_frame: grouping.topStackFrame,
          severity: input.severity,
          status: "open",
          first_seen_at: input.timestamp,
          last_seen_at: input.timestamp,
          occurrence_count: 1,
          affected_users_count: input.userId ? 1 : 0,
          affected_tenants_count: input.tenantId ? 1 : 0,
          latest_error_id: input.errorId,
          latest_release: input.release ?? null
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();
      return { ...grouping, groupId: inserted.id };
    }

    const nextStatus = existing.status === "resolved" ? "open" : existing.status;
    const lastRegressedAt = existing.status === "resolved" ? input.timestamp : existing.last_regressed_at;
    await trx
      .updateTable("error_groups")
      .set({
        severity: strongerSeverity(existing.severity, input.severity),
        status: nextStatus,
        last_seen_at: input.timestamp,
        last_regressed_at: lastRegressedAt,
        occurrence_count: sql<number>`occurrence_count + 1`,
        affected_users_count: sql<number>`(
          select count(distinct user_id)::int
          from errors
          where error_group_id = ${existing.id} and user_id is not null
        ) + ${input.userId ? 1 : 0}`,
        affected_tenants_count: sql<number>`(
          select count(distinct tenant_id)::int
          from errors
          where error_group_id = ${existing.id} and tenant_id is not null
        ) + ${input.tenantId ? 1 : 0}`,
        latest_error_id: input.errorId,
        latest_release: input.release ?? existing.latest_release,
        resolved_at: existing.status === "resolved" ? null : existing.resolved_at,
        updated_at: new Date()
      })
      .where("id", "=", existing.id)
      .execute();

    return { ...grouping, groupId: existing.id };
  });
}
```

Also add `listErrorGroups`, `getErrorGroup`, `updateErrorGroupStatus`, and `backfillErrorGroups` in the same file. Keep their implementation simple and direct:

```ts
function resolveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 50;
  return Math.min(500, Math.max(1, Math.trunc(limit)));
}

export async function listErrorGroups(db: Db, filters: ErrorGroupFilters): Promise<ErrorGroupRecord[]> {
  let query = db
    .selectFrom("error_groups")
    .selectAll()
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId);

  if (filters.status) query = query.where("status", "=", filters.status);
  if (filters.severity) query = query.where("severity", "=", filters.severity);
  if (filters.fingerprint) query = query.where("grouping_fingerprint", "=", filters.fingerprint);
  if (filters.release) query = query.where("latest_release", "=", filters.release);
  if (filters.from) query = query.where("last_seen_at", ">=", filters.from);
  if (filters.to) query = query.where("last_seen_at", "<", filters.to);

  const rows = await query
    .orderBy(sql<number>`case when status = 'open' and last_regressed_at is not null then 0 else 1 end`)
    .orderBy(sql<number>`case severity when 'critical' then 0 when 'error' then 1 else 2 end`)
    .orderBy(sql<number>`case status when 'open' then 0 when 'investigating' then 1 else 2 end`)
    .orderBy("last_seen_at", "desc")
    .limit(resolveLimit(filters.limit))
    .execute();

  return rows.map(toGroup);
}

export async function getErrorGroup(db: Db, input: { id: string; projectId: string; environmentId: string }): Promise<ErrorGroupRecord | null> {
  const row = await db
    .selectFrom("error_groups")
    .selectAll()
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .executeTakeFirst();
  return row ? toGroup(row) : null;
}

export async function updateErrorGroupStatus(
  db: Db,
  input: { id: string; projectId: string; environmentId: string; status: ErrorGroupStatus; now?: Date }
): Promise<ErrorGroupRecord | null> {
  const now = input.now ?? new Date();
  const row = await db
    .updateTable("error_groups")
    .set({
      status: input.status,
      resolved_at: input.status === "resolved" ? now : null,
      ignored_at: input.status === "ignored" ? now : null,
      updated_at: now
    })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .returningAll()
    .executeTakeFirst();
  return row ? toGroup(row) : null;
}

export async function backfillErrorGroups(db: Db, input: { batchSize?: number } = {}): Promise<{ processed: number }> {
  const rows = await db
    .selectFrom("errors")
    .selectAll()
    .where("error_group_id", "is", null)
    .orderBy("timestamp", "asc")
    .limit(resolveLimit(input.batchSize ?? 100))
    .execute();

  for (const row of rows) {
    const grouping = await upsertErrorGroupForOccurrence(db, {
      projectId: row.project_id,
      environmentId: row.environment_id,
      message: row.message,
      type: row.type,
      severity: row.severity,
      stack: row.stack,
      fingerprint: row.fingerprint,
      timestamp: row.timestamp,
      userId: row.user_id,
      tenantId: row.tenant_id,
      release: row.release,
      errorId: row.id
    });
    await db
      .updateTable("errors")
      .set({ error_group_id: grouping.groupId, grouping_fingerprint: grouping.fingerprint })
      .where("id", "=", row.id)
      .execute();
  }

  return { processed: rows.length };
}
```

Add this helper below `updateErrorGroupStatus` and call it after every raw error row is attached to a group:

```ts
export async function refreshErrorGroupStats(db: Db, groupId: string): Promise<void> {
  await sql`
    update error_groups
    set
      occurrence_count = stats.occurrence_count,
      affected_users_count = stats.affected_users_count,
      affected_tenants_count = stats.affected_tenants_count,
      first_seen_at = stats.first_seen_at,
      last_seen_at = stats.last_seen_at,
      latest_error_id = stats.latest_error_id,
      latest_release = stats.latest_release,
      updated_at = now()
    from (
      select
        count(*)::int as occurrence_count,
        count(distinct user_id) filter (where user_id is not null)::int as affected_users_count,
        count(distinct tenant_id) filter (where tenant_id is not null)::int as affected_tenants_count,
        min(timestamp) as first_seen_at,
        max(timestamp) as last_seen_at,
        (array_agg(id order by timestamp desc, received_at desc))[1] as latest_error_id,
        (array_agg(release order by timestamp desc, received_at desc) filter (where release is not null))[1] as latest_release
      from errors
      where error_group_id = ${groupId}
    ) stats
    where error_groups.id = ${groupId}
  `.execute(db);
}
```

In `backfillErrorGroups`, call the helper immediately after updating the raw error row:

```ts
    await refreshErrorGroupStats(db, grouping.groupId);
```

- [x] **Step 4: Group errors during insert**

In `packages/db/src/repositories/telemetry-writes.ts`, import:

```ts
import { refreshErrorGroupStats, upsertErrorGroupForOccurrence } from "./error-groups.js";
```

Extend `InsertErrorInput`:

```ts
  errorGroupId?: string;
  groupingFingerprint?: string;
```

Replace `insertError` with grouped insert plus a stats refresh after the raw row exists:

```ts
export async function insertError(db: Db, input: InsertErrorInput): Promise<void> {
  const grouping = await upsertErrorGroupForOccurrence(db, {
    projectId: input.projectId,
    environmentId: input.environmentId,
    message: input.message,
    type: input.type,
    severity: input.severity,
    stack: input.stack,
    fingerprint: input.fingerprint,
    timestamp: input.timestamp,
    userId: input.userId,
    tenantId: input.tenantId,
    release: input.release,
    errorId: input.id
  });

  await db
    .insertInto("errors")
    .values({
      ...baseColumns(input),
      message: input.message,
      type: nullable(input.type),
      severity: input.severity,
      stack: nullable(input.stack),
      status: input.status ?? "open",
      fingerprint: nullable(input.fingerprint),
      context: input.context ?? {},
      error_group_id: grouping.groupId,
      grouping_fingerprint: grouping.fingerprint
    })
    .execute();

  await refreshErrorGroupStats(db, grouping.groupId);
}
```

- [x] **Step 5: Run repository tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: pass for grouping lifecycle, ignored recurrence, and backfill tests.

- [x] **Step 6: Add worker startup backfill**

In `apps/worker/src/main.ts`, import:

```ts
import { backfillErrorGroups } from "@signal-hub/db/repositories/error-groups.js";
```

Before creating the BullMQ `Worker`, add:

```ts
await backfillErrorGroups(db, { batchSize: 500 });
```

This ensures existing errors are grouped before the worker processes new jobs.

- [x] **Step 7: Run worker tests**

Run:

```bash
pnpm --filter @signal-hub/worker test -- telemetry-worker.test.ts
```

Expected: pass. The worker unit tests should still assert that grouping-relevant error fields are passed to `insertError`.

- [x] **Step 8: Commit**

```bash
git add packages/db/src/repositories/error-groups.ts packages/db/src/repositories/telemetry-writes.ts packages/db/test/repositories.test.ts apps/worker/src/main.ts apps/worker/test/telemetry-worker.test.ts
git commit -m "feat: group error occurrences during persistence"
```

## Task 3: Raw Error Query Support for Groups

**Files:**

- Modify: `packages/db/src/repositories/telemetry-query.ts`
- Modify: `apps/api/src/routes/query.ts`
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Test: `packages/db/test/repositories.test.ts`
- Test: `apps/api/test/query.test.ts`
- Test: `apps/console/src/api/client.test.ts`

- [x] **Step 1: Add failing tests for raw error group fields and filters**

In `packages/db/test/repositories.test.ts`, add an assertion to a raw error query test or append:

```ts
  it("lists raw errors with error group identifiers and filters by group", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await createProject(db, { id: "prj_raw_group_filter", name: "Raw Group Filter" });
      await createEnvironment(db, { id: "env_raw_group_filter", projectId: "prj_raw_group_filter", name: "production" });

      await insertError(db, {
        id: "err_raw_group_filter_1",
        projectId: "prj_raw_group_filter",
        environmentId: "env_raw_group_filter",
        timestamp: new Date("2026-05-10T12:00:00.000Z"),
        receivedAt: new Date("2026-05-10T12:00:01.000Z"),
        message: "Grouped raw error",
        severity: "error",
        fingerprint: "grouped-raw-error"
      });

      const [raw] = await listErrors(db, {
        projectId: "prj_raw_group_filter",
        environmentId: "env_raw_group_filter",
        limit: 10
      });

      expect(raw?.errorGroupId).toEqual(expect.stringMatching(/^egrp_/));
      expect(raw?.groupingFingerprint).toBe("grouped-raw-error");

      const filtered = await listErrors(db, {
        projectId: "prj_raw_group_filter",
        environmentId: "env_raw_group_filter",
        errorGroupId: raw!.errorGroupId!,
        limit: 10
      });

      expect(filtered.map((error) => error.id)).toEqual(["err_raw_group_filter_1"]);
    });
  });
```

In `apps/api/test/query.test.ts`, add a test that `/query/errors` parses `error_group_id`:

```ts
  it("parses error_group_id for raw error queries", async () => {
    const app = await buildApp({
      readiness: async () => true,
      auth: {
        getCurrentUser: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true })
      },
      query: {
        listErrors: async (filters) => {
          expect(filters).toEqual(
            expect.objectContaining({
              projectId: "prj_1",
              environmentId: "env_1",
              errorGroupId: "egrp_1"
            })
          );
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/errors?project_id=prj_1&environment_id=env_1&error_group_id=egrp_1"
    });

    expect(response.statusCode).toBe(200);
  });
```

In `apps/console/src/api/client.test.ts`, update the existing error filter test to include `errorGroupId`:

```ts
    await createApiClient().listErrors({
      projectId: "prj_1",
      environmentId: "env_1",
      severity: "critical",
      status: "open",
      fingerprint: "fp_checkout_fetch",
      errorGroupId: "egrp_checkout"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/errors?project_id=prj_1&environment_id=env_1&severity=critical&status=open&fingerprint=fp_checkout_fetch&error_group_id=egrp_checkout",
      expect.objectContaining({ method: "GET" })
    );
```

- [x] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
pnpm --filter @signal-hub/api test -- query.test.ts
pnpm --filter @signal-hub/console test -- client.test.ts
```

Expected: fail because `errorGroupId` is not exposed or parsed.

- [x] **Step 3: Add `errorGroupId` to backend filter and raw records**

In `packages/db/src/repositories/telemetry-query.ts`, extend `TelemetryFilters`:

```ts
  errorGroupId?: string;
```

Extend `ErrorRecord`:

```ts
  errorGroupId: string | null;
  groupingFingerprint: string | null;
```

Update `toError`:

```ts
    errorGroupId: row.error_group_id,
    groupingFingerprint: row.grouping_fingerprint,
```

Update `listErrors`:

```ts
  if (filters.errorGroupId) query = query.where("error_group_id", "=", filters.errorGroupId);
```

- [x] **Step 4: Parse and encode `error_group_id`**

In `apps/api/src/routes/query.ts`, add `errorGroupId?: string;` to `QueryFilters`.

Inside `parseFilters`, in the `includeErrorFilters` block:

```ts
    const errorGroupId = optionalNonEmpty(raw, "error_group_id");

    if (errorGroupId) {
      filters.errorGroupId = errorGroupId;
    }
```

In `apps/console/src/api/types.ts`, add to `ErrorRecord`:

```ts
  errorGroupId: string | null;
  groupingFingerprint: string | null;
```

Add to `QueryFilters`:

```ts
  errorGroupId?: string;
```

In `apps/console/src/api/client.ts`, inside `queryPath` for `includeErrorFilters`:

```ts
    if (filters.errorGroupId) params.set("error_group_id", filters.errorGroupId);
```

- [x] **Step 5: Run focused tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
pnpm --filter @signal-hub/api test -- query.test.ts
pnpm --filter @signal-hub/console test -- client.test.ts
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add packages/db/src/repositories/telemetry-query.ts packages/db/test/repositories.test.ts apps/api/src/routes/query.ts apps/api/test/query.test.ts apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts
git commit -m "feat: expose error group raw occurrence filters"
```

## Task 4: Group Query API

**Files:**

- Modify: `packages/db/src/repositories/error-groups.ts`
- Modify: `apps/api/src/routes/query.ts`
- Modify: `apps/api/src/main.ts`
- Test: `packages/db/test/repositories.test.ts`
- Test: `apps/api/test/query.test.ts`

- [x] **Step 1: Add failing API tests for group list/detail/status**

In `apps/api/test/query.test.ts`, append:

```ts
  it("lists error groups with filters", async () => {
    const app = await buildApp({
      readiness: async () => true,
      auth: { getCurrentUser: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false }) },
      query: {
        listErrorGroups: async (filters) => {
          expect(filters).toEqual(
            expect.objectContaining({
              projectId: "prj_1",
              environmentId: "env_1",
              status: "open",
              severity: "critical",
              fingerprint: "fp_1",
              release: "1.2.3",
              limit: 25
            })
          );
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/error-groups?project_id=prj_1&environment_id=env_1&status=open&severity=critical&fingerprint=fp_1&release=1.2.3&limit=25"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [] });
  });

  it("gets an error group detail by id", async () => {
    const app = await buildApp({
      readiness: async () => true,
      auth: { getCurrentUser: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false }) },
      query: {
        getErrorGroup: async (id, filters) => {
          expect(id).toBe("egrp_1");
          expect(filters).toEqual(expect.objectContaining({ projectId: "prj_1", environmentId: "env_1" }));
          return { id: "egrp_1", status: "open" };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { id: "egrp_1", status: "open" } });
  });

  it("lists raw occurrences for an error group", async () => {
    const app = await buildApp({
      readiness: async () => true,
      auth: { getCurrentUser: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false }) },
      query: {
        listErrors: async (filters) => {
          expect(filters).toEqual(
            expect.objectContaining({
              projectId: "prj_1",
              environmentId: "env_1",
              errorGroupId: "egrp_1",
              limit: 25
            })
          );
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/error-groups/egrp_1/errors?project_id=prj_1&environment_id=env_1&limit=25"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [] });
  });

  it("updates an error group status", async () => {
    const app = await buildApp({
      readiness: async () => true,
      auth: { getCurrentUser: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false }) },
      query: {
        updateErrorGroupStatus: async (id, input) => {
          expect(id).toBe("egrp_1");
          expect(input).toEqual(
            expect.objectContaining({
              projectId: "prj_1",
              environmentId: "env_1",
              status: "resolved"
            })
          );
          return { id: "egrp_1", status: "resolved" };
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
      payload: { status: "resolved" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { id: "egrp_1", status: "resolved" } });
  });

  it("rejects invalid error group statuses", async () => {
    const app = await buildApp({
      readiness: async () => true,
      auth: { getCurrentUser: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false }) },
      query: {
        updateErrorGroupStatus: async () => ({ id: "egrp_1" })
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
      payload: { status: "closed" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });
```

- [x] **Step 2: Run API tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/api test -- query.test.ts
```

Expected: fail because query dependency types and routes do not exist.

- [x] **Step 3: Add query route types and parsers**

In `apps/api/src/routes/query.ts`, import or define:

```ts
const errorGroupParamsSchema = z.object({ id: z.string().trim().min(1) });
const errorGroupStatusSchema = z.enum(["open", "investigating", "resolved", "ignored"]);
```

Add types:

```ts
export type ErrorGroupStatus = "open" | "investigating" | "resolved" | "ignored";

export type ErrorGroupFilters = {
  projectId: string;
  environmentId: string;
  status?: ErrorGroupStatus;
  severity?: string;
  fingerprint?: string;
  tenantId?: string;
  userId?: string;
  release?: string;
  from?: Date;
  to?: Date;
  limit: number;
};

export type ErrorGroupScope = {
  projectId: string;
  environmentId: string;
};
```

Extend `QueryDependencies`:

```ts
  listErrorGroups?: (filters: ErrorGroupFilters) => Promise<unknown>;
  getErrorGroup?: (id: string, filters: ErrorGroupScope) => Promise<unknown | null>;
  updateErrorGroupStatus?: (id: string, input: ErrorGroupScope & { status: ErrorGroupStatus }) => Promise<unknown | null>;
```

Add parser:

```ts
function parseErrorGroupFilters(query: unknown): ErrorGroupFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) return undefined;

  const from = parseDate(raw, "from");
  const to = parseDate(raw, "to");
  if (from === null || to === null) return undefined;

  const status = optionalNonEmpty(raw, "status");
  if (status && !errorGroupStatusSchema.safeParse(status).success) return undefined;

  const filters: ErrorGroupFilters = {
    projectId,
    environmentId,
    limit: parseLimit(raw)
  };

  if (status) filters.status = status as ErrorGroupStatus;
  const severity = optionalNonEmpty(raw, "severity");
  const fingerprint = optionalNonEmpty(raw, "fingerprint");
  const tenantId = optionalNonEmpty(raw, "tenant_id");
  const userId = optionalNonEmpty(raw, "user_id");
  const release = optionalNonEmpty(raw, "release");
  if (severity) filters.severity = severity;
  if (fingerprint) filters.fingerprint = fingerprint;
  if (tenantId) filters.tenantId = tenantId;
  if (userId) filters.userId = userId;
  if (release) filters.release = release;
  if (from) filters.from = from;
  if (to) filters.to = to;
  return filters;
}

function parseErrorGroupScope(query: unknown): ErrorGroupScope | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  return projectId && environmentId ? { projectId, environmentId } : undefined;
}
```

- [x] **Step 4: Add route handlers**

In `apps/api/src/routes/query.ts`, add handlers before `registerQueryRoutes`:

```ts
async function handleErrorGroupListRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) return reply;
  if (!options.query?.listErrorGroups) return reply.status(501).send({ error: "query_method_unavailable" });
  const filters = parseErrorGroupFilters(request.query);
  if (!filters) return reply.status(400).send({ error: "invalid_query" });
  try {
    return reply.send({ data: await options.query.listErrorGroups(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleErrorGroupDetailRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) return reply;
  if (!options.query?.getErrorGroup) return reply.status(501).send({ error: "query_method_unavailable" });
  const params = errorGroupParamsSchema.safeParse(request.params);
  const scope = parseErrorGroupScope(request.query);
  if (!params.success || !scope) return reply.status(400).send({ error: "invalid_query" });
  try {
    const group = await options.query.getErrorGroup(params.data.id, scope);
    return group ? reply.send({ data: group }) : reply.status(404).send({ error: "error_group_not_found" });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleErrorGroupStatusRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) return reply;
  if (!options.query?.updateErrorGroupStatus) return reply.status(501).send({ error: "query_method_unavailable" });
  const params = errorGroupParamsSchema.safeParse(request.params);
  const scope = parseErrorGroupScope(request.query);
  const body = z.object({ status: errorGroupStatusSchema }).safeParse(request.body);
  if (!params.success || !scope || !body.success) return reply.status(400).send({ error: "invalid_query" });
  try {
    const group = await options.query.updateErrorGroupStatus(params.data.id, { ...scope, status: body.data.status });
    return group ? reply.send({ data: group }) : reply.status(404).send({ error: "error_group_not_found" });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleErrorGroupOccurrencesRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) return reply;
  if (!options.query?.listErrors) return reply.status(501).send({ error: "query_method_unavailable" });
  const params = errorGroupParamsSchema.safeParse(request.params);
  const filters = parseFilters(request.query, { includeErrorFilters: true });
  if (!params.success || !filters) return reply.status(400).send({ error: "invalid_query" });
  try {
    return reply.send({ data: await options.query.listErrors({ ...filters, errorGroupId: params.data.id }) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}
```

Register them before raw `/query/errors`:

```ts
  app.get("/query/error-groups", (request, reply) => handleErrorGroupListRoute(request, reply, options));
  app.get("/query/error-groups/:id/errors", (request, reply) => handleErrorGroupOccurrencesRoute(request, reply, options));
  app.get("/query/error-groups/:id", (request, reply) => handleErrorGroupDetailRoute(request, reply, options));
  app.patch("/query/error-groups/:id", (request, reply) => handleErrorGroupStatusRoute(request, reply, options));
```

- [x] **Step 5: Wire repositories in API main**

In `apps/api/src/main.ts`, import:

```ts
import {
  getErrorGroup,
  listErrorGroups,
  updateErrorGroupStatus
} from "@signal-hub/db/repositories/error-groups.js";
```

Add to the `query` object:

```ts
    listErrorGroups: (filters) => listErrorGroups(db, filters),
    getErrorGroup: (id, filters) => getErrorGroup(db, { id, ...filters }),
    updateErrorGroupStatus: (id, input) => updateErrorGroupStatus(db, { id, ...input }),
```

- [x] **Step 6: Run API tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/api test -- query.test.ts
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add apps/api/src/routes/query.ts apps/api/src/main.ts apps/api/test/query.test.ts packages/db/src/repositories/error-groups.ts packages/db/test/repositories.test.ts
git commit -m "feat: add error group query api"
```

## Task 5: Console API Client Types

**Files:**

- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Test: `apps/console/src/api/client.test.ts`

- [x] **Step 1: Add failing console client tests**

In `apps/console/src/api/client.test.ts`, append:

```ts
  it("encodes error group list filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listErrorGroups({
      projectId: "prj_1",
      environmentId: "env_1",
      status: "open",
      severity: "critical",
      fingerprint: "fp_1",
      release: "1.2.3",
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/error-groups?project_id=prj_1&environment_id=env_1&status=open&severity=critical&fingerprint=fp_1&release=1.2.3&limit=25",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("updates error group status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "egrp_1", status: "resolved" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().updateErrorGroupStatus("egrp_1", {
      projectId: "prj_1",
      environmentId: "env_1",
      status: "resolved"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "resolved" }) })
    );
  });
```

- [x] **Step 2: Run console client tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/console test -- client.test.ts
```

Expected: fail because group client methods and types do not exist.

- [x] **Step 3: Add console types**

In `apps/console/src/api/types.ts`, add:

```ts
export type ErrorGroupStatus = "open" | "investigating" | "resolved" | "ignored";

export type ErrorGroupRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  groupingFingerprint: string;
  message: string;
  type: string | null;
  topStackFrame: string | null;
  severity: string;
  status: ErrorGroupStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  lastRegressedAt: string | null;
  occurrenceCount: number;
  affectedUsersCount: number;
  affectedTenantsCount: number;
  latestErrorId: string | null;
  latestRelease: string | null;
  resolvedAt: string | null;
  ignoredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ErrorGroupQuery = {
  projectId: string;
  environmentId: string;
  status?: ErrorGroupStatus;
  severity?: string;
  fingerprint?: string;
  tenantId?: string;
  userId?: string;
  release?: string;
  from?: string | Date;
  to?: string | Date;
  limit?: number;
};

export type UpdateErrorGroupStatusInput = {
  projectId: string;
  environmentId: string;
  status: ErrorGroupStatus;
};
```

- [x] **Step 4: Add client methods**

In `apps/console/src/api/client.ts`, import the new types and extend `ApiClient`:

```ts
  ErrorGroupQuery,
  ErrorGroupRecord,
  UpdateErrorGroupStatusInput,
```

```ts
  listErrorGroups: (query: ErrorGroupQuery) => Promise<QueryListResponse<ErrorGroupRecord>>;
  getErrorGroup: (id: string, query: Pick<ErrorGroupQuery, "projectId" | "environmentId">) => Promise<AggregateResponse<ErrorGroupRecord>>;
  updateErrorGroupStatus: (id: string, input: UpdateErrorGroupStatusInput) => Promise<AggregateResponse<ErrorGroupRecord>>;
```

Add path helpers:

```ts
function errorGroupListPath(query: ErrorGroupQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  if (query.status) params.set("status", query.status);
  if (query.severity) params.set("severity", query.severity);
  if (query.fingerprint) params.set("fingerprint", query.fingerprint);
  if (query.tenantId) params.set("tenant_id", query.tenantId);
  if (query.userId) params.set("user_id", query.userId);
  if (query.release) params.set("release", query.release);
  if (query.from) params.set("from", query.from instanceof Date ? query.from.toISOString() : query.from);
  if (query.to) params.set("to", query.to instanceof Date ? query.to.toISOString() : query.to);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  return `/query/error-groups?${params.toString()}`;
}

function errorGroupScopePath(id: string, query: Pick<ErrorGroupQuery, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  return `/query/error-groups/${encodePathSegment(id)}?${params.toString()}`;
}
```

Add methods to `createApiClient`:

```ts
    listErrorGroups: (query) =>
      request<QueryListResponse<ErrorGroupRecord>>(path(apiBasePath, errorGroupListPath(query))),
    getErrorGroup: (id, query) =>
      request<AggregateResponse<ErrorGroupRecord>>(path(apiBasePath, errorGroupScopePath(id, query))),
    updateErrorGroupStatus: (id, input) =>
      request<AggregateResponse<ErrorGroupRecord>>(path(apiBasePath, errorGroupScopePath(id, input)), {
        method: "PATCH",
        body: { status: input.status }
      }),
```

- [x] **Step 5: Run console client tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/console test -- client.test.ts
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts
git commit -m "feat: add console error group api client"
```

## Task 6: Console Grouped Errors UI

**Files:**

- Create: `apps/console/src/components/ErrorGroupFilters.tsx`
- Create: `apps/console/src/components/ErrorGroupList.tsx`
- Create: `apps/console/src/components/ErrorGroupDetail.tsx`
- Create: `apps/console/src/components/ErrorGroupsPanel.tsx`
- Create: `apps/console/src/components/ErrorRawOccurrencesPanel.tsx`
- Modify: `apps/console/src/components/ErrorInvestigationPanel.tsx`
- Modify: `apps/console/src/components/ErrorFilters.tsx`
- Modify: `apps/console/src/components/ErrorList.tsx`
- Modify: `apps/console/src/components/ErrorDetailDrawer.tsx`
- Modify: `apps/console/src/styles.css`
- Test: `apps/console/src/components/ErrorInvestigationPanel.test.tsx`

- [ ] **Step 1: Add failing UI tests**

In `apps/console/src/components/ErrorInvestigationPanel.test.tsx`, add tests for the new layout:

```tsx
  it("opens on grouped errors by default", async () => {
    const client = {
      listErrorGroups: vi.fn().mockResolvedValue({
        data: [
          {
            id: "egrp_1",
            projectId: "prj_1",
            environmentId: "env_1",
            groupingFingerprint: "fp_checkout",
            message: "Checkout failed",
            type: "CheckoutError",
            topStackFrame: "at pay (/app/pay.ts:10:2)",
            severity: "critical",
            status: "open",
            firstSeenAt: "2026-05-10T12:00:00.000Z",
            lastSeenAt: "2026-05-10T12:05:00.000Z",
            lastRegressedAt: "2026-05-10T12:05:00.000Z",
            occurrenceCount: 3,
            affectedUsersCount: 2,
            affectedTenantsCount: 1,
            latestErrorId: "err_3",
            latestRelease: "1.0.1",
            resolvedAt: null,
            ignoredAt: null,
            createdAt: "2026-05-10T12:00:00.000Z",
            updatedAt: "2026-05-10T12:05:00.000Z"
          }
        ]
      }),
      listErrors: vi.fn(),
      updateErrorGroupStatus: vi.fn()
    } as unknown as ApiClient;

    render(<ErrorInvestigationPanel client={client} projectId="prj_1" environmentId="env_1" />);

    expect(await screen.findByText("Checkout failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Groups" })).toHaveAttribute("aria-pressed", "true");
    expect(client.listErrors).not.toHaveBeenCalled();
  });

  it("keeps raw occurrences available as a peer tab", async () => {
    const client = {
      listErrorGroups: vi.fn().mockResolvedValue({ data: [] }),
      listErrors: vi.fn().mockResolvedValue({
        data: [
          {
            id: "err_1",
            projectId: "prj_1",
            environmentId: "env_1",
            tenantId: null,
            userId: null,
            sessionId: null,
            traceId: null,
            timestamp: "2026-05-10T12:00:00.000Z",
            receivedAt: "2026-05-10T12:00:01.000Z",
            source: null,
            release: null,
            metadata: {},
            message: "Raw checkout failed",
            type: null,
            severity: "error",
            stack: null,
            status: "open",
            fingerprint: "fp_raw",
            context: {},
            errorGroupId: "egrp_1",
            groupingFingerprint: "fp_raw"
          }
        ]
      }),
      updateErrorGroupStatus: vi.fn()
    } as unknown as ApiClient;

    render(<ErrorInvestigationPanel client={client} projectId="prj_1" environmentId="env_1" />);

    await userEvent.click(screen.getByRole("button", { name: "Raw occurrences" }));

    expect(await screen.findByText("Raw checkout failed")).toBeInTheDocument();
    expect(client.listErrors).toHaveBeenCalledWith(expect.objectContaining({ projectId: "prj_1", environmentId: "env_1" }));
  });

  it("updates group status from the detail panel", async () => {
    const client = {
      listErrorGroups: vi.fn().mockResolvedValue({
        data: [
          {
            id: "egrp_1",
            projectId: "prj_1",
            environmentId: "env_1",
            groupingFingerprint: "fp_checkout",
            message: "Checkout failed",
            type: "CheckoutError",
            topStackFrame: null,
            severity: "critical",
            status: "open",
            firstSeenAt: "2026-05-10T12:00:00.000Z",
            lastSeenAt: "2026-05-10T12:05:00.000Z",
            lastRegressedAt: null,
            occurrenceCount: 3,
            affectedUsersCount: 2,
            affectedTenantsCount: 1,
            latestErrorId: "err_3",
            latestRelease: null,
            resolvedAt: null,
            ignoredAt: null,
            createdAt: "2026-05-10T12:00:00.000Z",
            updatedAt: "2026-05-10T12:05:00.000Z"
          }
        ]
      }),
      listErrors: vi.fn(),
      updateErrorGroupStatus: vi.fn().mockResolvedValue({ data: { id: "egrp_1", status: "resolved" } })
    } as unknown as ApiClient;

    render(<ErrorInvestigationPanel client={client} projectId="prj_1" environmentId="env_1" />);

    await userEvent.click(await screen.findByText("Checkout failed"));
    await userEvent.selectOptions(screen.getByLabelText("Group status"), "resolved");

    expect(client.updateErrorGroupStatus).toHaveBeenCalledWith("egrp_1", {
      projectId: "prj_1",
      environmentId: "env_1",
      status: "resolved"
    });
  });
```

- [ ] **Step 2: Run UI tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/console test -- ErrorInvestigationPanel.test.tsx
```

Expected: fail because grouped components and client calls do not exist.

- [ ] **Step 3: Extract raw occurrences panel**

Move the current `ErrorInvestigationPanel` raw list logic into `apps/console/src/components/ErrorRawOccurrencesPanel.tsx`. Export:

```tsx
export function ErrorRawOccurrencesPanel({ client, projectId, environmentId, initialFilters }: Props) {
  // Same state, queryFromValues, apply/reset/retry behavior currently in ErrorInvestigationPanel.
}
```

Add `errorGroupId` to `ErrorFilterValues` in `ErrorFilters.tsx`:

```ts
  errorGroupId: string;
```

Add a filter label:

```tsx
      <label>
        Error group
        <input value={values.errorGroupId} onChange={(event) => onChange(update(values, "errorGroupId", event.target.value))} />
      </label>
```

In raw query construction, include:

```ts
  const errorGroupId = values.errorGroupId.trim();
  if (errorGroupId) query.errorGroupId = errorGroupId;
```

- [ ] **Step 4: Add group filter/list/detail components**

Create `apps/console/src/components/ErrorGroupFilters.tsx`:

```tsx
import type { FormEvent } from "react";
import type { ErrorGroupStatus } from "../api/types";

export type ErrorGroupFilterValues = {
  status: "" | ErrorGroupStatus;
  severity: string;
  fingerprint: string;
  release: string;
  limit: string;
};

type Props = {
  values: ErrorGroupFilterValues;
  onChange: (values: ErrorGroupFilterValues) => void;
  onApply: () => void;
  onReset: () => void;
};

function update(values: ErrorGroupFilterValues, key: keyof ErrorGroupFilterValues, value: string): ErrorGroupFilterValues {
  return { ...values, [key]: value } as ErrorGroupFilterValues;
}

export function ErrorGroupFilters({ values, onChange, onApply, onReset }: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply();
  }

  return (
    <form className="event-filters" onSubmit={submit}>
      <label>
        Status
        <select value={values.status} onChange={(event) => onChange(update(values, "status", event.target.value))}>
          <option value="">Any</option>
          <option value="open">Open</option>
          <option value="investigating">Investigating</option>
          <option value="resolved">Resolved</option>
          <option value="ignored">Ignored</option>
        </select>
      </label>
      <label>
        Severity
        <input value={values.severity} onChange={(event) => onChange(update(values, "severity", event.target.value))} />
      </label>
      <label>
        Fingerprint
        <input value={values.fingerprint} onChange={(event) => onChange(update(values, "fingerprint", event.target.value))} />
      </label>
      <label>
        Release
        <input value={values.release} onChange={(event) => onChange(update(values, "release", event.target.value))} />
      </label>
      <label>
        Limit
        <input max="500" min="1" type="number" value={values.limit} onChange={(event) => onChange(update(values, "limit", event.target.value))} />
      </label>
      <div className="filter-actions">
        <button type="submit">Apply</button>
        <button onClick={onReset} type="button">Reset</button>
      </div>
    </form>
  );
}
```

Create `apps/console/src/components/ErrorGroupList.tsx`:

```tsx
import type { ErrorGroupRecord } from "../api/types";

type Props = {
  groups: ErrorGroupRecord[];
  selectedGroupId?: string;
  onSelect: (group: ErrorGroupRecord) => void;
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function label(value: string | null | undefined): string {
  return value ?? "none";
}

export function ErrorGroupList({ groups, selectedGroupId, onSelect }: Props) {
  return (
    <div className="event-list" aria-label="Error groups">
      {groups.map((group) => (
        <button
          aria-pressed={group.id === selectedGroupId}
          className="event-row error-group-row"
          key={group.id}
          onClick={() => onSelect(group)}
          type="button"
        >
          <span>
            <strong>{group.message}</strong>
            <code>{group.groupingFingerprint}</code>
          </span>
          <span>{group.severity}</span>
          <span>{group.status}</span>
          <span>{group.occurrenceCount}</span>
          <span>{group.affectedUsersCount} users</span>
          <span>{group.affectedTenantsCount} tenants</span>
          <span>{label(group.latestRelease)}</span>
          <span>{group.lastRegressedAt ? "regressed" : "stable"}</span>
          <span>{formatTimestamp(group.lastSeenAt)}</span>
        </button>
      ))}
    </div>
  );
}
```

Create `apps/console/src/components/ErrorGroupDetail.tsx`:

```tsx
import type { ErrorGroupRecord, ErrorGroupStatus } from "../api/types";

type Props = {
  group?: ErrorGroupRecord;
  onStatusChange: (status: ErrorGroupStatus) => void;
  onShowOccurrences: (groupId: string) => void;
};

function detailValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "none" : String(value);
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "none";
}

export function ErrorGroupDetail({ group, onStatusChange, onShowOccurrences }: Props) {
  if (!group) {
    return (
      <aside className="detail-drawer error-group-detail">
        <p className="muted-text">Select an error group to inspect its details.</p>
      </aside>
    );
  }

  return (
    <aside className="detail-drawer error-group-detail">
      <div>
        <h2>{group.message}</h2>
        <p className="muted-text">{group.type ?? group.groupingFingerprint}</p>
      </div>
      <label className="status-control">
        Group status
        <select value={group.status} onChange={(event) => onStatusChange(event.target.value as ErrorGroupStatus)}>
          <option value="open">Open</option>
          <option value="investigating">Investigating</option>
          <option value="resolved">Resolved</option>
          <option value="ignored">Ignored</option>
        </select>
      </label>
      <dl className="detail-grid">
        <dt>Occurrences</dt>
        <dd>{group.occurrenceCount}</dd>
        <dt>Affected users</dt>
        <dd>{group.affectedUsersCount}</dd>
        <dt>Affected tenants</dt>
        <dd>{group.affectedTenantsCount}</dd>
        <dt>Severity</dt>
        <dd>{group.severity}</dd>
        <dt>Latest release</dt>
        <dd>{detailValue(group.latestRelease)}</dd>
        <dt>First seen</dt>
        <dd>{formatTimestamp(group.firstSeenAt)}</dd>
        <dt>Last seen</dt>
        <dd>{formatTimestamp(group.lastSeenAt)}</dd>
        <dt>Last regressed</dt>
        <dd>{formatTimestamp(group.lastRegressedAt)}</dd>
        <dt>Resolved at</dt>
        <dd>{formatTimestamp(group.resolvedAt)}</dd>
        <dt>Ignored at</dt>
        <dd>{formatTimestamp(group.ignoredAt)}</dd>
        <dt>Latest error</dt>
        <dd>{detailValue(group.latestErrorId)}</dd>
        <dt>Top stack frame</dt>
        <dd>{detailValue(group.topStackFrame)}</dd>
      </dl>
      <button onClick={() => onShowOccurrences(group.id)} type="button">
        Show raw occurrences
      </button>
    </aside>
  );
}
```

- [ ] **Step 5: Add grouped panel and tabs**

Create `apps/console/src/components/ErrorGroupsPanel.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ErrorGroupRecord, ErrorGroupStatus } from "../api/types";
import { ErrorGroupDetail } from "./ErrorGroupDetail";
import { ErrorGroupFilters, type ErrorGroupFilterValues } from "./ErrorGroupFilters";
import { ErrorGroupList } from "./ErrorGroupList";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
  onShowOccurrences: (groupId: string) => void;
};

type LoadState = "loading" | "ready" | "empty" | "unavailable";

const defaultFilters: ErrorGroupFilterValues = {
  status: "",
  severity: "",
  fingerprint: "",
  release: "",
  limit: "50"
};

function toLimit(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.trunc(parsed))) : 50;
}

export function ErrorGroupsPanel({ client, projectId, environmentId, onShowOccurrences }: Props) {
  const [draftFilters, setDraftFilters] = useState<ErrorGroupFilterValues>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<ErrorGroupFilterValues>(defaultFilters);
  const [reloadToken, setReloadToken] = useState(0);
  const [groups, setGroups] = useState<ErrorGroupRecord[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ErrorGroupRecord | undefined>();
  const [state, setState] = useState<LoadState>("loading");
  const query = useMemo(
    () => ({
      projectId,
      environmentId,
      status: appliedFilters.status || undefined,
      severity: appliedFilters.severity.trim() || undefined,
      fingerprint: appliedFilters.fingerprint.trim() || undefined,
      release: appliedFilters.release.trim() || undefined,
      limit: toLimit(appliedFilters.limit)
    }),
    [projectId, environmentId, appliedFilters]
  );

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setSelectedGroup(undefined);
    void client.listErrorGroups(query).then(
      ({ data }) => {
        if (cancelled) return;
        setGroups(data);
        setState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setGroups([]);
        setState("unavailable");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [client, query, reloadToken]);

  async function updateStatus(status: ErrorGroupStatus) {
    if (!selectedGroup) return;
    const { data } = await client.updateErrorGroupStatus(selectedGroup.id, { projectId, environmentId, status });
    setSelectedGroup(data);
    setGroups((current) => current.map((group) => (group.id === data.id ? data : group)));
  }

  return (
    <section className="investigation-layout">
      <div className="panel event-panel">
        <div className="panel-header">
          <h2>Error groups</h2>
        </div>
        <ErrorGroupFilters
          values={draftFilters}
          onApply={() => setAppliedFilters({ ...draftFilters })}
          onChange={setDraftFilters}
          onReset={() => {
            setDraftFilters(defaultFilters);
            setAppliedFilters(defaultFilters);
            setReloadToken((current) => current + 1);
          }}
        />
        {state === "loading" ? <p className="muted-text">Loading error groups</p> : null}
        {state === "unavailable" ? (
          <div className="status-box unavailable">
            <strong>Error groups unavailable</strong>
            <button onClick={() => setReloadToken((current) => current + 1)} type="button">Retry</button>
          </div>
        ) : null}
        {state === "empty" ? <p className="muted-text">No error groups found</p> : null}
        {state === "ready" ? <ErrorGroupList groups={groups} onSelect={setSelectedGroup} selectedGroupId={selectedGroup?.id} /> : null}
      </div>
      <ErrorGroupDetail group={selectedGroup} onShowOccurrences={onShowOccurrences} onStatusChange={updateStatus} />
    </section>
  );
}
```

Replace `ErrorInvestigationPanel.tsx` with a tab shell:

```tsx
type ErrorView = "groups" | "raw";

export function ErrorInvestigationPanel({ client, projectId, environmentId, initialFilters }: Props) {
  const [view, setView] = useState<ErrorView>("groups");
  const [rawInitialFilters, setRawInitialFilters] = useState<Partial<ErrorFilterValues>>(initialFilters ?? {});

  function showRawGroup(groupId: string) {
    setRawInitialFilters({ errorGroupId: groupId });
    setView("raw");
  }

  return (
    <section className="error-investigation">
      <nav className="investigation-tabs" aria-label="Error views">
        <button aria-pressed={view === "groups"} onClick={() => setView("groups")} type="button">Groups</button>
        <button aria-pressed={view === "raw"} onClick={() => setView("raw")} type="button">Raw occurrences</button>
      </nav>
      {view === "groups" ? (
        <ErrorGroupsPanel client={client} environmentId={environmentId} onShowOccurrences={showRawGroup} projectId={projectId} />
      ) : (
        <ErrorRawOccurrencesPanel client={client} environmentId={environmentId} initialFilters={rawInitialFilters} projectId={projectId} />
      )}
    </section>
  );
}
```

- [ ] **Step 6: Update raw error display**

In `ErrorList.tsx`, show group id when present:

```tsx
<span>{error.errorGroupId ?? "ungrouped"}</span>
```

In `ErrorDetailDrawer.tsx`, add:

```tsx
<dt>Error group</dt>
<dd>{detailValue(error.errorGroupId)}</dd>
<dt>Grouping fingerprint</dt>
<dd>{detailValue(error.groupingFingerprint)}</dd>
```

- [ ] **Step 7: Add CSS**

In `apps/console/src/styles.css`, add compact styles:

```css
.error-investigation {
  display: grid;
  gap: 12px;
}

.error-group-row {
  grid-template-columns: minmax(220px, 1.5fr) 90px 110px 90px 90px 150px;
}

.error-group-detail {
  display: grid;
  gap: 12px;
}

.status-control {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

Use these exact class names in the new JSX so the CSS above applies without selector drift.

- [ ] **Step 8: Run UI tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/console test -- ErrorInvestigationPanel.test.tsx ErrorDetailDrawer.test.tsx client.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add apps/console/src/components/ErrorGroupFilters.tsx apps/console/src/components/ErrorGroupList.tsx apps/console/src/components/ErrorGroupDetail.tsx apps/console/src/components/ErrorGroupsPanel.tsx apps/console/src/components/ErrorRawOccurrencesPanel.tsx apps/console/src/components/ErrorInvestigationPanel.tsx apps/console/src/components/ErrorFilters.tsx apps/console/src/components/ErrorList.tsx apps/console/src/components/ErrorDetailDrawer.tsx apps/console/src/components/ErrorInvestigationPanel.test.tsx apps/console/src/styles.css
git commit -m "feat: add grouped error triage console"
```

## Task 7: Documentation and Memory

**Files:**

- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/DECISIONS.md`
- Modify: `README.md`
- Modify: `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`

- [ ] **Step 1: Update project docs**

Apply these documentation changes:

- `.claude/docs/ARCHITECTURE.md`: replace the sentence saying Errors does not group or mutate status with a paragraph explaining `error_groups`, immutable raw errors, group status workflow, and regression reopening.
- `.claude/docs/PROJECT-SUMMARY.md`: add `Grouped error issues with status workflow and regression reopening` to implemented capabilities after implementation.
- `.claude/docs/UI-UX.md`: update Errors UX to say the default Errors view is `Groups`, with `Raw occurrences` as a peer tab.
- `.claude/docs/DECISIONS.md`: add a dated decision:

```md
## 2026-05-10: Keep raw errors immutable and add mutable error groups

Decision: SignalHub stores operator workflow state on `error_groups` instead of rewriting raw error occurrences.

Rationale: Raw telemetry must remain auditable. Group status is an operational triage layer that can be resolved, ignored, or reopened on regression without changing historical error records.
```

- `README.md`: add a concise grouped Errors note in the console section:

```md
The Errors investigation view defaults to grouped error issues. Raw occurrences remain available in a peer tab and retain their immutable telemetry fields. Group status is an operator workflow state and does not rewrite raw error rows.
```

- [ ] **Step 2: Update memory**

Append to `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`:

```md
- Added and committed the Phase 5A Error Groups design spec and implementation plan in SignalHub.
- Approved direction: grouped error issues over immutable raw errors, deterministic fingerprinting with explicit fingerprint precedence, group statuses `open` / `investigating` / `resolved` / `ignored`, resolved-group regression reopening, ignored groups staying ignored, and the console layout `Groups + Raw occurrences`.
```

- [ ] **Step 3: Commit SignalHub docs**

```bash
git add .claude/docs/ARCHITECTURE.md .claude/docs/PROJECT-SUMMARY.md .claude/docs/UI-UX.md .claude/docs/DECISIONS.md README.md
git commit -m "docs: document grouped error workflow"
```

- [ ] **Step 4: Commit memory**

From `/Users/diogo/Developer/Github/claude-config`:

```bash
git add projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
git commit -m "docs: update signalhub phase 5a memory"
```

## Task 8: Final Verification and Plan Completion

**Files:**

- Modify: `docs/superpowers/plans/2026-05-10-phase5a-error-groups-implementation.md`

- [ ] **Step 1: Run full tests**

Run:

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 2: Run build**

Run:

```bash
pnpm build
```

Expected: all workspace builds pass.

- [ ] **Step 3: Run Compose config verification**

Run:

```bash
docker compose config --quiet
```

Expected: exit code `0`.

- [ ] **Step 4: Run doctor safe local mode**

Run:

```bash
cp .env.example /tmp/signalhub-doctor.env
pnpm run doctor -- --env-file /tmp/signalhub-doctor.env
```

Expected: exit code `0`. API health warnings are acceptable if no local API is running.

- [ ] **Step 5: Mark plan tasks complete**

Update this plan file by changing all completed checkboxes from `- [ ]` to `- [x]`.

- [ ] **Step 6: Commit plan completion**

```bash
git add docs/superpowers/plans/2026-05-10-phase5a-error-groups-implementation.md
git commit -m "docs: mark phase 5a implementation complete"
```

- [ ] **Step 7: Merge and push**

After verification passes on the feature branch:

```bash
git switch main
git merge <phase-5a-branch>
pnpm test
pnpm build
docker compose config --quiet
git push origin main
```

Expected: `origin/main` contains Phase 5A implementation and the local feature worktree can be removed.
