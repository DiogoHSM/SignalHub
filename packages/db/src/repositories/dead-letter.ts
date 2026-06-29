import type { Selectable, Transaction } from "kysely";
import { sql } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { Database, DeadLetterJobActionsTable, DeadLetterJobsTable } from "../schema.js";

type DeadLetterJobRow = Selectable<DeadLetterJobsTable>;
type DeadLetterJobActionRow = Selectable<DeadLetterJobActionsTable>;
type DeadLetterDb = Db | Transaction<Database>;

export interface DeadLetterJob {
  id: string;
  projectId: string | null;
  environmentId: string | null;
  queueName: string;
  jobName: string;
  payload: unknown;
  errorMessage: string;
  createdAt: Date;
}

export interface InsertDeadLetterJobInput {
  projectId?: string | null;
  environmentId?: string | null;
  queueName: string;
  jobName: string;
  payload: unknown;
  errorMessage: string;
}

export type DeadLetterJobActionType = "deleted" | "replayed" | "expired";

export interface DeadLetterJobAction {
  id: string;
  deadLetterJobId: string;
  queueName: string;
  jobName: string;
  action: DeadLetterJobActionType;
  actorUserId: string | null;
  actorEmail: string;
  metadata: unknown;
  createdAt: Date;
}

export interface DeadLetterJobActor {
  userId: string | null;
  email: string;
}

export interface DeadLetterJobActionInput {
  action: DeadLetterJobActionType;
  actor: DeadLetterJobActor;
  metadata?: unknown;
}

export interface ListDeadLetterJobsInput {
  limit?: number;
  cursor?: string;
  queueName?: string;
  jobName?: string;
  error?: string;
  createdFrom?: Date;
  createdTo?: Date;
  status?: "pending";
}

export interface DeadLetterJobPage {
  deadLetterJobs: DeadLetterJob[];
  cursor?: string;
}

type DeadLetterJobCursorPayload = {
  createdAt: string;
  id: string;
  filterKey: string;
};

type DeadLetterJobCursorFilters = {
  queueName: string | null;
  jobName: string | null;
  error: string | null;
  createdFrom: string | null;
  createdTo: string | null;
  status: "pending" | null;
};

function toDeadLetterJob(row: DeadLetterJobRow): DeadLetterJob {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    queueName: row.queue_name,
    jobName: row.job_name,
    payload: row.payload,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}

function toDeadLetterJobAction(row: DeadLetterJobActionRow): DeadLetterJobAction {
  return {
    id: row.id,
    deadLetterJobId: row.dead_letter_job_id,
    queueName: row.queue_name,
    jobName: row.job_name,
    action: row.action,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    metadata: row.metadata,
    createdAt: row.created_at
  };
}

export async function insertDeadLetterJob(db: DeadLetterDb, input: InsertDeadLetterJobInput): Promise<DeadLetterJob> {
  const row = await db
    .insertInto("dead_letter_jobs")
    .values({
      id: createId("dlj"),
      project_id: input.projectId ?? null,
      environment_id: input.environmentId ?? null,
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

function deadLetterJobCursorFilterKey(input: ListDeadLetterJobsInput): string {
  const filters: DeadLetterJobCursorFilters = {
    queueName: input.queueName ?? null,
    jobName: input.jobName ?? null,
    error: input.error ?? null,
    createdFrom: input.createdFrom?.toISOString() ?? null,
    createdTo: input.createdTo?.toISOString() ?? null,
    status: input.status ?? null
  };

  return JSON.stringify(filters);
}

function encodeDeadLetterJobCursor(input: ListDeadLetterJobsInput, row: DeadLetterJobRow): string {
  const payload: DeadLetterJobCursorPayload = {
    createdAt: row.created_at.toISOString(),
    id: row.id,
    filterKey: deadLetterJobCursorFilterKey(input)
  };

  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function decodeDeadLetterJobCursor(input: ListDeadLetterJobsInput, cursor: string): DeadLetterJobCursorPayload {
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
    typeof payload.filterKey !== "string" ||
    createdAt === null ||
    Number.isNaN(createdAt.getTime())
  ) {
    throw new Error("invalid_cursor");
  }
  if (payload.filterKey !== deadLetterJobCursorFilterKey(input)) {
    throw new Error("invalid_cursor_scope");
  }

  return payload as DeadLetterJobCursorPayload;
}

export async function listDeadLetterJobs(
  db: DeadLetterDb,
  input: ListDeadLetterJobsInput = {}
): Promise<DeadLetterJobPage> {
  const limit = boundedLimit(input.limit);
  let query = db
    .selectFrom("dead_letter_jobs")
    .selectAll();

  if (input.queueName) {
    query = query.where("queue_name", "=", input.queueName);
  }
  if (input.jobName) {
    query = query.where("job_name", "=", input.jobName);
  }
  if (input.error) {
    query = query.where(sql<boolean>`error_message ilike ${`%${escapeLikePattern(input.error)}%`} escape '\\'`);
  }
  if (input.createdFrom) {
    query = query.where("created_at", ">=", input.createdFrom);
  }
  if (input.createdTo) {
    query = query.where("created_at", "<=", input.createdTo);
  }

  if (input.cursor) {
    const cursor = decodeDeadLetterJobCursor(input, input.cursor);
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
    cursor: rows.length > limit && lastRow ? encodeDeadLetterJobCursor(input, lastRow) : undefined
  };
}

export async function getDeadLetterJob(db: DeadLetterDb, id: string): Promise<DeadLetterJob | undefined> {
  const row = await db
    .selectFrom("dead_letter_jobs")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  return row ? toDeadLetterJob(row) : undefined;
}

export async function listDeadLetterJobActions(db: DeadLetterDb, deadLetterJobId: string): Promise<DeadLetterJobAction[]> {
  const rows = await db
    .selectFrom("dead_letter_job_actions")
    .selectAll()
    .where("dead_letter_job_id", "=", deadLetterJobId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();

  return rows.map(toDeadLetterJobAction);
}

export async function recordDeadLetterJobAction(
  db: DeadLetterDb,
  deadLetterJob: DeadLetterJob,
  input: DeadLetterJobActionInput
): Promise<DeadLetterJobAction> {
  const row = await db
    .insertInto("dead_letter_job_actions")
    .values({
      id: createId("dla"),
      dead_letter_job_id: deadLetterJob.id,
      queue_name: deadLetterJob.queueName,
      job_name: deadLetterJob.jobName,
      action: input.action,
      actor_user_id: input.actor.userId,
      actor_email: input.actor.email,
      metadata: input.metadata ?? {}
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDeadLetterJobAction(row);
}

export async function countDeadLetterJobs(
  db: DeadLetterDb,
  input: { projectId?: string; environmentId?: string } = {}
): Promise<number> {
  let query = db
    .selectFrom("dead_letter_jobs")
    .select((eb) => eb.fn.countAll<string>().as("count"));

  if (input.projectId) {
    query = query.where("project_id", "=", input.projectId);
  }
  if (input.environmentId) {
    query = query.where("environment_id", "=", input.environmentId);
  }

  const row = await query
    .executeTakeFirstOrThrow();
  const count = Number(row.count);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export async function deleteDeadLetterJob(db: DeadLetterDb, id: string): Promise<boolean> {
  const result = await db.deleteFrom("dead_letter_jobs").where("id", "=", id).executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}

export async function deleteDeadLetterJobWithAction(
  db: Db,
  id: string,
  input: DeadLetterJobActionInput
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom("dead_letter_jobs")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();

    if (!row) {
      return false;
    }

    const deadLetterJob = toDeadLetterJob(row);
    const result = await trx.deleteFrom("dead_letter_jobs").where("id", "=", id).executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) {
      return false;
    }
    await recordDeadLetterJobAction(trx, deadLetterJob, input);
    return true;
  });
}

export async function deleteExpiredDeadLetterJobs(
  db: DeadLetterDb,
  input: { cutoff: Date; batchSize: number }
): Promise<number> {
  const rows = await db
    .selectFrom("dead_letter_jobs")
    .selectAll()
    .where("created_at", "<", input.cutoff)
    .orderBy("created_at", "asc")
    .orderBy("id", "asc")
    .limit(input.batchSize)
    .execute();

  if (rows.length === 0) {
    return 0;
  }

  const jobs = rows.map(toDeadLetterJob);
  const ids = jobs.map((job) => job.id);
  const deleted = await db
    .deleteFrom("dead_letter_jobs")
    .where("id", "in", ids)
    .returning("id")
    .execute();

  const deletedIds = new Set(deleted.map((row) => row.id));
  const deletedJobs = jobs.filter((job) => deletedIds.has(job.id));
  if (deletedJobs.length === 0) {
    return 0;
  }

  await db
    .insertInto("dead_letter_job_actions")
    .values(
      deletedJobs.map((job) => ({
        id: createId("dla"),
        dead_letter_job_id: job.id,
        queue_name: job.queueName,
        job_name: job.jobName,
        action: "expired" as const,
        actor_user_id: null,
        actor_email: "system:retention",
        metadata: { cutoff: input.cutoff.toISOString() }
      }))
    )
    .execute();

  return deletedJobs.length;
}
