import type { Selectable, Transaction } from "kysely";
import { sql } from "kysely";
import type { Db } from "../client.js";
import type { Database, RetentionRunsTable } from "../schema.js";
import type { DataGovernanceRetentionCategory } from "./data-governance.js";
import { retentionCategorySpecs, type RetentionTable } from "./effective-retention.js";

type RetentionRunRow = Selectable<RetentionRunsTable>;
type SystemDb = Db | Transaction<Database>;

const retentionAdvisoryLockId = 927380402914;
const defaultMaxBatchesPerTable = 25;
const retentionTableSet = new Set<string>(retentionCategorySpecs.map((spec) => spec.table));
const retentionCategorySet = new Set<string>(retentionCategorySpecs.map((spec) => spec.category));

function assertRetentionTable(tableName: string): asserts tableName is RetentionTable {
  if (!retentionTableSet.has(tableName)) {
    throw new Error(`retention table is not allowed: ${tableName}`);
  }
}

export type RetentionPolicy = {
  eventsDays: number;
  errorsDays: number;
  tracesDays: number;
  spansDays: number;
  llmCallsDays: number;
  profilesDays: number;
  breadcrumbsDays: number;
  deadLetterJobsDays: number;
  sourceMapsEnabled: boolean;
  sourceMapsDays: number;
  sourceMapsBatchSize: number;
};

export type RetentionExecutionOptions = RetentionPolicy & {
  now: Date;
  batchSize: number;
  maxBatchesPerTable?: number;
};

export type RetentionDeletedCounts = {
  events: number;
  errors: number;
  traces: number;
  spans: number;
  llmCalls: number;
  webVitals: number;
  profiles: number;
  breadcrumbs: number;
  deadLetterJobs: number;
  sourceMapArtifacts: number;
  sourceMapFiles: number;
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

export function toRetentionRunRecord(row: RetentionRunRow): RetentionRunRecord {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
    deleted: {
      events: row.deleted_events,
      errors: row.deleted_errors,
      traces: row.deleted_traces,
      spans: row.deleted_spans,
      llmCalls: row.deleted_llm_calls,
      webVitals: row.deleted_web_vitals,
      profiles: row.deleted_profiles,
      breadcrumbs: row.deleted_breadcrumbs,
      deadLetterJobs: row.deleted_dead_letter_jobs,
      sourceMapArtifacts: row.deleted_source_map_artifacts,
      sourceMapFiles: row.deleted_source_map_files
    },
    policy: {
      eventsDays: row.events_days,
      errorsDays: row.errors_days,
      tracesDays: row.traces_days,
      spansDays: row.spans_days,
      llmCallsDays: row.llm_calls_days,
      profilesDays: row.profiles_days,
      breadcrumbsDays: row.breadcrumbs_days,
      deadLetterJobsDays: row.dead_letter_jobs_days,
      sourceMapsEnabled: row.source_maps_enabled,
      sourceMapsDays: row.source_maps_days,
      sourceMapsBatchSize: row.source_maps_batch_size
    }
  };
}

async function tryAcquireRetentionTransactionLock(db: SystemDb): Promise<boolean> {
  const result = await sql<{ locked: boolean }>`
    select pg_try_advisory_xact_lock(${retentionAdvisoryLockId}) as locked
  `.execute(db);
  return result.rows[0]?.locked === true;
}

export async function withRetentionLock<T>(
  db: Db,
  run: (lockedDb: Transaction<Database>) => Promise<T>
): Promise<{ locked: false } | { locked: true; result: T }> {
  return db.transaction().execute(async (trx) => {
    const locked = await tryAcquireRetentionTransactionLock(trx);
    if (!locked) {
      return { locked: false };
    }

    try {
      return { locked: true, result: await run(trx) };
    } catch (error) {
      throw new Error(
        `retention_delete_failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? { cause: error } : undefined
      );
    }
  });
}

export async function upsertHeartbeat(
  db: SystemDb,
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

export async function getHeartbeat(
  db: SystemDb,
  component: string
): Promise<{ component: string; lastHeartbeatAt: Date; metadata: unknown } | null> {
  const row = await db
    .selectFrom("system_heartbeats")
    .select(["component", "last_heartbeat_at", "metadata"])
    .where("component", "=", component)
    .executeTakeFirst();

  return row ? { component: row.component, lastHeartbeatAt: row.last_heartbeat_at, metadata: row.metadata } : null;
}

async function deleteExpiredFromTable(db: SystemDb, tableName: string, cutoff: Date, batchSize: number): Promise<number> {
  assertRetentionTable(tableName);

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

async function deleteExpiredFromTableForScope(
  db: SystemDb,
  tableName: string,
  cutoff: Date,
  batchSize: number,
  projectId: string,
  environmentId: string
): Promise<number> {
  assertRetentionTable(tableName);

  const result = await sql<{ deleted_count: string }>`
    with deleted_rows as (
      delete from ${sql.table(tableName)}
      where ctid in (
        select ctid from ${sql.table(tableName)}
        where project_id = ${projectId}
          and environment_id = ${environmentId}
          and timestamp < ${cutoff}
        order by timestamp asc
        limit ${batchSize}
      )
      returning 1
    )
    select count(*)::text as deleted_count from deleted_rows
  `.execute(db);

  return Number(result.rows[0]?.deleted_count ?? 0);
}

async function deleteExpiredBatchesFromTable(
  db: SystemDb,
  tableName: string,
  cutoff: Date,
  batchSize: number,
  maxBatches: number
): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const deleted = await deleteExpiredFromTable(db, tableName, cutoff, batchSize);
    total += deleted;
    if (deleted < batchSize) return total;
  }
  return total;
}

async function deleteExpiredBatchesFromTableForScope(
  db: SystemDb,
  tableName: string,
  cutoff: Date,
  batchSize: number,
  maxBatches: number,
  projectId: string,
  environmentId: string
): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const deleted = await deleteExpiredFromTableForScope(db, tableName, cutoff, batchSize, projectId, environmentId);
    total += deleted;
    if (deleted < batchSize) return total;
  }
  return total;
}

export function normalizeGovernanceRetentionPolicy(value: unknown): Partial<Record<DataGovernanceRetentionCategory, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const policy: Partial<Record<DataGovernanceRetentionCategory, number>> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!retentionCategorySet.has(key)) continue;
    const days = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (Number.isInteger(days) && days >= 1 && days <= 3650) {
      policy[key as DataGovernanceRetentionCategory] = days;
    }
  }
  return policy;
}

function emptyDeletedCounts(): RetentionDeletedCounts {
  return {
    events: 0,
    errors: 0,
    traces: 0,
    spans: 0,
    llmCalls: 0,
    webVitals: 0,
    profiles: 0,
    breadcrumbs: 0,
    deadLetterJobs: 0,
    sourceMapArtifacts: 0,
    sourceMapFiles: 0
  };
}

function addDeletedCounts(left: RetentionDeletedCounts, right: RetentionDeletedCounts): RetentionDeletedCounts {
  return {
    events: left.events + right.events,
    errors: left.errors + right.errors,
    traces: left.traces + right.traces,
    spans: left.spans + right.spans,
    llmCalls: left.llmCalls + right.llmCalls,
    webVitals: left.webVitals + right.webVitals,
    profiles: left.profiles + right.profiles,
    breadcrumbs: left.breadcrumbs + right.breadcrumbs,
    deadLetterJobs: left.deadLetterJobs + right.deadLetterJobs,
    sourceMapArtifacts: left.sourceMapArtifacts + right.sourceMapArtifacts,
    sourceMapFiles: left.sourceMapFiles + right.sourceMapFiles
  };
}

function addDeletedCountsInPlace(target: RetentionDeletedCounts, source: RetentionDeletedCounts): void {
  target.events += source.events;
  target.errors += source.errors;
  target.traces += source.traces;
  target.spans += source.spans;
  target.llmCalls += source.llmCalls;
  target.webVitals += source.webVitals;
  target.profiles += source.profiles;
  target.breadcrumbs += source.breadcrumbs;
  target.deadLetterJobs += source.deadLetterJobs;
  target.sourceMapArtifacts += source.sourceMapArtifacts;
  target.sourceMapFiles += source.sourceMapFiles;
}

async function deleteExpiredTelemetryForGovernancePolicies(
  db: SystemDb,
  options: RetentionExecutionOptions
): Promise<RetentionDeletedCounts> {
  const rows = await db
    .selectFrom("data_governance_policies")
    .select(["project_id", "environment_id", "retention_policy"])
    .execute();
  const cutoff = (days: number) => new Date(options.now.getTime() - days * 24 * 60 * 60 * 1000);
  const maxBatches = options.maxBatchesPerTable ?? defaultMaxBatchesPerTable;
  const totals = emptyDeletedCounts();

  for (const row of rows) {
    const policy = normalizeGovernanceRetentionPolicy(row.retention_policy);
    const scoped = emptyDeletedCounts();

    if (policy.events !== undefined) {
      scoped.events +=
        (await deleteExpiredBatchesFromTableForScope(db, "events", cutoff(policy.events), options.batchSize, maxBatches, row.project_id, row.environment_id)) +
        (await deleteExpiredBatchesFromTableForScope(db, "session_replays", cutoff(policy.events), options.batchSize, maxBatches, row.project_id, row.environment_id));
    }
    if (policy.clicks !== undefined) {
      scoped.events += await deleteExpiredBatchesFromTableForScope(
        db,
        "click_events",
        cutoff(policy.clicks),
        options.batchSize,
        maxBatches,
        row.project_id,
        row.environment_id
      );
    }
    if (policy.replays !== undefined) {
      scoped.events += await deleteExpiredBatchesFromTableForScope(
        db,
        "session_replays",
        cutoff(policy.replays),
        options.batchSize,
        maxBatches,
        row.project_id,
        row.environment_id
      );
    }
    if (policy.errors !== undefined) {
      scoped.errors += await deleteExpiredBatchesFromTableForScope(db, "errors", cutoff(policy.errors), options.batchSize, maxBatches, row.project_id, row.environment_id);
    }
    if (policy.traces !== undefined) {
      scoped.traces += await deleteExpiredBatchesFromTableForScope(db, "traces", cutoff(policy.traces), options.batchSize, maxBatches, row.project_id, row.environment_id);
    }
    if (policy.spans !== undefined) {
      scoped.spans += await deleteExpiredBatchesFromTableForScope(db, "spans", cutoff(policy.spans), options.batchSize, maxBatches, row.project_id, row.environment_id);
    }
    if (policy.llmCalls !== undefined) {
      scoped.llmCalls += await deleteExpiredBatchesFromTableForScope(db, "llm_calls", cutoff(policy.llmCalls), options.batchSize, maxBatches, row.project_id, row.environment_id);
    }
    if (policy.webVitals !== undefined) {
      scoped.webVitals += await deleteExpiredBatchesFromTableForScope(db, "web_vitals", cutoff(policy.webVitals), options.batchSize, maxBatches, row.project_id, row.environment_id);
    }
    if (policy.profiles !== undefined) {
      scoped.profiles += await deleteExpiredBatchesFromTableForScope(db, "profiles", cutoff(policy.profiles), options.batchSize, maxBatches, row.project_id, row.environment_id);
    }
    if (policy.breadcrumbs !== undefined) {
      scoped.breadcrumbs += await deleteExpiredBatchesFromTableForScope(db, "breadcrumbs", cutoff(policy.breadcrumbs), options.batchSize, maxBatches, row.project_id, row.environment_id);
    }

    addDeletedCountsInPlace(totals, scoped);
  }

  return totals;
}

export const __test = { deleteExpiredBatchesFromTable };

export async function deleteExpiredTelemetry(db: SystemDb, options: RetentionExecutionOptions): Promise<RetentionDeletedCounts> {
  const cutoff = (days: number) => new Date(options.now.getTime() - days * 24 * 60 * 60 * 1000);
  const maxBatches = options.maxBatchesPerTable ?? defaultMaxBatchesPerTable;

  const globalDeleted = {
    events:
      (await deleteExpiredBatchesFromTable(db, "events", cutoff(options.eventsDays), options.batchSize, maxBatches)) +
      (await deleteExpiredBatchesFromTable(db, "click_events", cutoff(options.eventsDays), options.batchSize, maxBatches)) +
      (await deleteExpiredBatchesFromTable(db, "session_replays", cutoff(options.eventsDays), options.batchSize, maxBatches)),
    errors: await deleteExpiredBatchesFromTable(db, "errors", cutoff(options.errorsDays), options.batchSize, maxBatches),
    traces: await deleteExpiredBatchesFromTable(db, "traces", cutoff(options.tracesDays), options.batchSize, maxBatches),
    spans: await deleteExpiredBatchesFromTable(db, "spans", cutoff(options.spansDays), options.batchSize, maxBatches),
    llmCalls: await deleteExpiredBatchesFromTable(db, "llm_calls", cutoff(options.llmCallsDays), options.batchSize, maxBatches),
    webVitals: await deleteExpiredBatchesFromTable(
      db,
      "web_vitals",
      cutoff(options.eventsDays),
      options.batchSize,
      maxBatches
    ),
    profiles: await deleteExpiredBatchesFromTable(
      db,
      "profiles",
      cutoff(options.profilesDays),
      options.batchSize,
      maxBatches
    ),
    breadcrumbs: await deleteExpiredBatchesFromTable(
      db,
      "breadcrumbs",
      cutoff(options.breadcrumbsDays),
      options.batchSize,
      maxBatches
    ),
    deadLetterJobs: 0,
    sourceMapArtifacts: 0,
    sourceMapFiles: 0
  };
  const scopedDeleted = await deleteExpiredTelemetryForGovernancePolicies(db, options);
  return addDeletedCounts(globalDeleted, scopedDeleted);
}

export async function recordRetentionRun(
  db: SystemDb,
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
      deleted_web_vitals: input.deleted.webVitals,
      deleted_profiles: input.deleted.profiles,
      deleted_breadcrumbs: input.deleted.breadcrumbs,
      deleted_dead_letter_jobs: input.deleted.deadLetterJobs,
      deleted_source_map_artifacts: input.deleted.sourceMapArtifacts,
      deleted_source_map_files: input.deleted.sourceMapFiles,
      events_days: input.policy.eventsDays,
      errors_days: input.policy.errorsDays,
      traces_days: input.policy.tracesDays,
      spans_days: input.policy.spansDays,
      llm_calls_days: input.policy.llmCallsDays,
      profiles_days: input.policy.profilesDays,
      breadcrumbs_days: input.policy.breadcrumbsDays,
      dead_letter_jobs_days: input.policy.deadLetterJobsDays,
      source_maps_enabled: input.policy.sourceMapsEnabled,
      source_maps_days: input.policy.sourceMapsDays,
      source_maps_batch_size: input.policy.sourceMapsBatchSize
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toRetentionRunRecord(row);
}

export async function getLastRetentionRun(db: SystemDb): Promise<RetentionRunRecord | null> {
  const row = await db
    .selectFrom("retention_runs")
    .selectAll()
    .orderBy("started_at", "desc")
    .limit(1)
    .executeTakeFirst();

  return row ? toRetentionRunRecord(row) : null;
}

export async function getIngestionFreshness(db: SystemDb): Promise<{
  lastEventAt: Date | null;
  lastErrorAt: Date | null;
  lastTraceAt: Date | null;
  lastSpanAt: Date | null;
  lastLlmCallAt: Date | null;
}> {
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
