import type { Selectable, Transaction } from "kysely";
import { sql } from "kysely";
import type { Db } from "../client.js";
import type { Database, RetentionRunsTable } from "../schema.js";

type RetentionRunRow = Selectable<RetentionRunsTable>;
type SystemDb = Db | Transaction<Database>;

const retentionAdvisoryLockId = 927380402914;
const defaultMaxBatchesPerTable = 25;
const retentionTables = [
  "events",
  "click_events",
  "errors",
  "traces",
  "spans",
  "llm_calls",
  "web_vitals",
  "profiles",
  "breadcrumbs"
] as const;
type RetentionTable = (typeof retentionTables)[number];
const retentionTableSet = new Set<string>(retentionTables);

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

export const __test = { deleteExpiredBatchesFromTable };

export async function deleteExpiredTelemetry(db: SystemDb, options: RetentionExecutionOptions): Promise<RetentionDeletedCounts> {
  const cutoff = (days: number) => new Date(options.now.getTime() - days * 24 * 60 * 60 * 1000);
  const maxBatches = options.maxBatchesPerTable ?? defaultMaxBatchesPerTable;

  return {
    events:
      (await deleteExpiredBatchesFromTable(db, "events", cutoff(options.eventsDays), options.batchSize, maxBatches)) +
      (await deleteExpiredBatchesFromTable(db, "click_events", cutoff(options.eventsDays), options.batchSize, maxBatches)),
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
