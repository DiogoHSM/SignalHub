import type { Selectable } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { DeadLetterJobsTable } from "../schema.js";

type DeadLetterJobRow = Selectable<DeadLetterJobsTable>;

export interface DeadLetterJob {
  id: string;
  queueName: string;
  jobName: string;
  payload: unknown;
  errorMessage: string;
  createdAt: Date;
}

export interface InsertDeadLetterJobInput {
  queueName: string;
  jobName: string;
  payload: unknown;
  errorMessage: string;
}

export interface ListDeadLetterJobsInput {
  limit?: number;
}

function toDeadLetterJob(row: DeadLetterJobRow): DeadLetterJob {
  return {
    id: row.id,
    queueName: row.queue_name,
    jobName: row.job_name,
    payload: row.payload,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}

export async function insertDeadLetterJob(db: Db, input: InsertDeadLetterJobInput): Promise<DeadLetterJob> {
  const row = await db
    .insertInto("dead_letter_jobs")
    .values({
      id: createId("dlj"),
      queue_name: input.queueName,
      job_name: input.jobName,
      payload: input.payload,
      error_message: input.errorMessage
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDeadLetterJob(row);
}

function boundedLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 50;
  }
  return Math.max(1, Math.min(Math.trunc(limit), 250));
}

export async function listDeadLetterJobs(
  db: Db,
  input: ListDeadLetterJobsInput = {}
): Promise<DeadLetterJob[]> {
  const rows = await db
    .selectFrom("dead_letter_jobs")
    .selectAll()
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(boundedLimit(input.limit))
    .execute();

  return rows.map(toDeadLetterJob);
}

export async function getDeadLetterJob(db: Db, id: string): Promise<DeadLetterJob | undefined> {
  const row = await db
    .selectFrom("dead_letter_jobs")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  return row ? toDeadLetterJob(row) : undefined;
}

export async function deleteDeadLetterJob(db: Db, id: string): Promise<boolean> {
  const result = await db.deleteFrom("dead_letter_jobs").where("id", "=", id).executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}
