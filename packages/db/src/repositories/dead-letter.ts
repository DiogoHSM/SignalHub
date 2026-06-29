import type { Selectable } from "kysely";
import { sql } from "kysely";
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
  cursor?: string;
}

export interface DeadLetterJobPage {
  deadLetterJobs: DeadLetterJob[];
  cursor?: string;
}

type DeadLetterJobCursorPayload = {
  createdAt: string;
  id: string;
};

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

function encodeDeadLetterJobCursor(row: DeadLetterJobRow): string {
  const payload: DeadLetterJobCursorPayload = {
    createdAt: row.created_at.toISOString(),
    id: row.id
  };

  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeDeadLetterJobCursor(cursor: string): DeadLetterJobCursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid_cursor");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("invalid_cursor");
  }

  const payload = parsed as Partial<DeadLetterJobCursorPayload>;
  const createdAt = typeof payload.createdAt === "string" ? new Date(payload.createdAt) : null;
  if (
    typeof payload.id !== "string" ||
    createdAt === null ||
    Number.isNaN(createdAt.getTime())
  ) {
    throw new Error("invalid_cursor");
  }

  return payload as DeadLetterJobCursorPayload;
}

export async function listDeadLetterJobs(
  db: Db,
  input: ListDeadLetterJobsInput = {}
): Promise<DeadLetterJobPage> {
  const limit = boundedLimit(input.limit);
  let query = db
    .selectFrom("dead_letter_jobs")
    .selectAll();

  if (input.cursor) {
    const cursor = decodeDeadLetterJobCursor(input.cursor);
    const cursorCreatedAt = new Date(cursor.createdAt);
    query = query.where(sql<boolean>`(
      created_at < ${cursorCreatedAt}
      or (created_at = ${cursorCreatedAt} and id < ${cursor.id})
    )`);
  }

  const rows = await query
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(limit + 1)
    .execute();

  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows.at(-1);

  return {
    deadLetterJobs: pageRows.map(toDeadLetterJob),
    cursor: rows.length > limit && lastRow ? encodeDeadLetterJobCursor(lastRow) : undefined
  };
}

export async function getDeadLetterJob(db: Db, id: string): Promise<DeadLetterJob | undefined> {
  const row = await db
    .selectFrom("dead_letter_jobs")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  return row ? toDeadLetterJob(row) : undefined;
}

export async function countDeadLetterJobs(db: Db): Promise<number> {
  const row = await db
    .selectFrom("dead_letter_jobs")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .executeTakeFirstOrThrow();
  const count = Number(row.count);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export async function deleteDeadLetterJob(db: Db, id: string): Promise<boolean> {
  const result = await db.deleteFrom("dead_letter_jobs").where("id", "=", id).executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}
