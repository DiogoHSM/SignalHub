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
