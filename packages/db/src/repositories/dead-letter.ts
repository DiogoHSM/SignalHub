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
