import type { Selectable, Transaction } from "kysely";
import { sql } from "kysely";
import type { Db } from "../client.js";
import type { BackupRunsTable, Database } from "../schema.js";

type BackupRunRow = Selectable<BackupRunsTable>;
type BackupDb = Db | Transaction<Database>;
const backupAdvisoryLockId = 927380402916;

export type BackupRunRecord = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: "success" | "failed";
  trigger: "scheduled" | "manual";
  filename: string;
  localPath: string;
  sizeBytes: number | null;
  s3Bucket: string | null;
  s3Key: string | null;
  errorMessage: string | null;
  createdAt: Date;
};

export type BackupStatusRecord = {
  latestSuccess: BackupRunRecord | null;
  latestFailure: BackupRunRecord | null;
};

function toSafeSizeBytes(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("backup size_bytes exceeds Number.MAX_SAFE_INTEGER");
  }
  return parsed;
}

function toBackupRunRecord(row: BackupRunRow): BackupRunRecord {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    trigger: row.trigger,
    filename: row.filename,
    localPath: row.local_path,
    sizeBytes: toSafeSizeBytes(row.size_bytes),
    s3Bucket: row.s3_bucket,
    s3Key: row.s3_key,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}

export async function recordBackupRun(
  db: BackupDb,
  input: {
    startedAt: Date;
    finishedAt: Date | null;
    status: "success" | "failed";
    trigger: "scheduled" | "manual";
    filename: string;
    localPath: string;
    sizeBytes: number | null;
    s3Bucket: string | null;
    s3Key: string | null;
    errorMessage: string | null;
  }
): Promise<BackupRunRecord> {
  const row = await db
    .insertInto("backup_runs")
    .values({
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      status: input.status,
      trigger: input.trigger,
      filename: input.filename,
      local_path: input.localPath,
      size_bytes: input.sizeBytes,
      s3_bucket: input.s3Bucket,
      s3_key: input.s3Key,
      error_message: input.errorMessage
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toBackupRunRecord(row);
}

async function getLatestBackupRun(db: BackupDb, status: "success" | "failed"): Promise<BackupRunRecord | null> {
  const row = await db
    .selectFrom("backup_runs")
    .selectAll()
    .where("status", "=", status)
    .orderBy("started_at", "desc")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();

  return row ? toBackupRunRecord(row) : null;
}

export async function getBackupStatus(db: BackupDb): Promise<BackupStatusRecord> {
  const [latestSuccess, latestFailure] = await Promise.all([
    getLatestBackupRun(db, "success"),
    getLatestBackupRun(db, "failed")
  ]);
  return { latestSuccess, latestFailure };
}

async function tryAcquireBackupSessionLock(db: BackupDb): Promise<boolean> {
  const result = await sql<{ locked: boolean }>`
    select pg_try_advisory_lock(${backupAdvisoryLockId}) as locked
  `.execute(db);
  return result.rows[0]?.locked === true;
}

async function releaseBackupSessionLock(db: BackupDb): Promise<void> {
  await sql`select pg_advisory_unlock(${backupAdvisoryLockId})`.execute(db);
}

export async function withBackupLock<T>(
  db: Db,
  run: () => Promise<T>
): Promise<{ locked: false } | { locked: true; result: T }> {
  return db.connection().execute(async (connectionDb) => {
    const locked = await tryAcquireBackupSessionLock(connectionDb);
    if (!locked) return { locked: false };
    try {
      return { locked: true, result: await run() };
    } finally {
      await releaseBackupSessionLock(connectionDb);
    }
  });
}
