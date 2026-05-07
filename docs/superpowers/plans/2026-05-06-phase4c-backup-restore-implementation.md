# Phase 4C Backup and Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add self-hosted Postgres backup and restore operations with local backups, optional S3-compatible upload, backup status metadata, and operator documentation.

**Architecture:** The worker owns scheduled backups, matching the existing retention and alert schedulers. Backups are created with `pg_dump` custom format into a local directory, optionally uploaded to S3-compatible storage, and recorded as metadata-only `backup_runs` rows in Postgres. Manual scripts reuse the same backup implementation; restore remains an explicit destructive operator command.

**Tech Stack:** TypeScript, Fastify, Kysely/Postgres, worker scheduler, Node child processes, `@aws-sdk/client-s3`, React, Vitest, Docker Compose, `pg_dump`, `pg_restore`.

---

## Scope Check

This plan covers one cohesive subsystem: self-hosted backup and restore for the Postgres database. It does not implement Redis backup, WAL archiving, point-in-time recovery, in-app restore, client-side encryption, or remote object retention pruning.

## File Structure

Create:

- `packages/db/migrations/0004_backup_runs.sql` - backup run metadata table and indexes.
- `packages/db/src/repositories/backups.ts` - backup run CRUD, latest status reads, and advisory lock helper.
- `apps/worker/src/backups.ts` - backup orchestration, `pg_dump` runner, local pruning, S3 upload, and scheduler.
- `apps/worker/test/backups.test.ts` - backup runner and scheduler unit tests.
- `scripts/backup-create.ts` - manual backup command.
- `scripts/backup-restore.ts` - explicit destructive restore command.

Modify:

- `packages/config/src/index.ts` - backup and S3-compatible config parsing.
- `packages/config/test/config.test.ts` - backup config tests.
- `packages/db/src/migrate.ts` - include `0004_backup_runs.sql`.
- `packages/db/src/schema.ts` - `backup_runs` table type.
- `packages/db/test/repositories.test.ts` - migration and repository integration tests.
- `apps/worker/package.json` - add `@aws-sdk/client-s3`.
- `apps/worker/src/main.ts` - start and stop backup scheduler.
- `apps/api/src/routes/system.ts` - extend system health response type.
- `apps/api/src/system-health.ts` - include backup status and stale logic.
- `apps/api/src/main.ts` - wire backup status dependencies.
- `apps/api/test/system.test.ts` - backup health tests.
- `apps/console/src/api/types.ts` - backup health response types.
- `apps/console/src/components/SystemHealthPanel.tsx` - render backup status.
- `apps/console/src/components/SystemHealthPanel.test.tsx` - backup status UI tests.
- `apps/console/src/components/ConsoleShell.test.tsx` - update health fixtures.
- `apps/console/src/api/client.test.ts` - update health fixture.
- `package.json` - add `backup:create` and `backup:restore` scripts.
- `Dockerfile` - install Postgres client tools.
- `docker-compose.yml` - add backup volume mount to worker.
- `.env.example` - backup configuration.
- `README.md` - backup/R2/restore docs.
- `.claude/docs/ARCHITECTURE.md`, `.claude/docs/DEPLOYMENT.md`, `.claude/docs/SECRETS.md`, `.claude/docs/INFRASTRUCTURE.md`, `.claude/docs/PROJECT-SUMMARY.md`, `.claude/docs/UI-UX.md` - project docs.

## Task 1: Backup Configuration

**Files:**

- Modify: `packages/config/src/index.ts`
- Test: `packages/config/test/config.test.ts`

- [x] **Step 1: Add failing config tests**

Add tests beside the alert config tests:

```ts
it("loads backup defaults", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    PORT: "3000",
    DATABASE_URL: "postgres://user:pass@localhost:5432/signalhub",
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "a-secure-session-secret-with-enough-length",
    API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
    BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
    BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple",
    GOOGLE_OAUTH_ENABLED: "false"
  });

  expect(config.backups).toEqual({
    enabled: true,
    intervalHours: 24,
    localDir: "/var/lib/signalhub/backups",
    retentionDays: 14,
    s3: {
      enabled: false,
      endpoint: "",
      region: "auto",
      bucket: "",
      accessKeyId: "",
      secretAccessKey: "",
      prefix: "signalhub"
    }
  });
});

it("loads explicit backup settings", () => {
  const config = loadConfig({
    ...validEnv,
    BACKUPS_ENABLED: "false",
    BACKUPS_INTERVAL_HOURS: "6",
    BACKUPS_LOCAL_DIR: "/tmp/signalhub-backups",
    BACKUPS_RETENTION_DAYS: "7",
    BACKUPS_S3_ENABLED: "true",
    BACKUPS_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
    BACKUPS_S3_REGION: "auto",
    BACKUPS_S3_BUCKET: "signalhub-backups",
    BACKUPS_S3_ACCESS_KEY_ID: "access-key",
    BACKUPS_S3_SECRET_ACCESS_KEY: "secret-key",
    BACKUPS_S3_PREFIX: "prod/signalhub"
  });

  expect(config.backups).toEqual({
    enabled: false,
    intervalHours: 6,
    localDir: "/tmp/signalhub-backups",
    retentionDays: 7,
    s3: {
      enabled: true,
      endpoint: "https://example.r2.cloudflarestorage.com",
      region: "auto",
      bucket: "signalhub-backups",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      prefix: "prod/signalhub"
    }
  });
});

it.each(["BACKUPS_INTERVAL_HOURS", "BACKUPS_RETENTION_DAYS"] as const)("rejects non-positive %s", (fieldName) => {
  expect(() => loadConfig({ ...validEnv, [fieldName]: "0" })).toThrow();
});

it("requires S3 settings when backup S3 upload is enabled", () => {
  expect(() =>
    loadConfig({
      ...validEnv,
      BACKUPS_S3_ENABLED: "true",
      BACKUPS_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      BACKUPS_S3_BUCKET: "signalhub-backups",
      BACKUPS_S3_ACCESS_KEY_ID: "access-key"
    })
  ).toThrow("BACKUPS_S3_SECRET_ACCESS_KEY is required when backup S3 upload is enabled");
});
```

- [x] **Step 2: Run config tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/config test
```

Expected: fail because `config.backups` does not exist.

- [x] **Step 3: Implement backup config**

In `packages/config/src/index.ts`, add schema fields after alert config:

```ts
BACKUPS_ENABLED: z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true"),
BACKUPS_INTERVAL_HOURS: optionalPositiveInteger(24),
BACKUPS_LOCAL_DIR: z.preprocess(emptyStringToUndefined, z.string().min(1).default("/var/lib/signalhub/backups")),
BACKUPS_RETENTION_DAYS: optionalPositiveInteger(14),
BACKUPS_S3_ENABLED: z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true"),
BACKUPS_S3_ENDPOINT: optionalEnvUrl,
BACKUPS_S3_REGION: z.preprocess(emptyStringToUndefined, z.string().default("auto")),
BACKUPS_S3_BUCKET: optionalEnvString,
BACKUPS_S3_ACCESS_KEY_ID: optionalEnvString,
BACKUPS_S3_SECRET_ACCESS_KEY: optionalEnvString,
BACKUPS_S3_PREFIX: z.preprocess(emptyStringToUndefined, z.string().default("signalhub"))
```

After Google OAuth validation, add:

```ts
if (parsed.BACKUPS_S3_ENABLED) {
  if (!parsed.BACKUPS_S3_ENDPOINT) throw new Error("BACKUPS_S3_ENDPOINT is required when backup S3 upload is enabled");
  if (!parsed.BACKUPS_S3_BUCKET) throw new Error("BACKUPS_S3_BUCKET is required when backup S3 upload is enabled");
  if (!parsed.BACKUPS_S3_ACCESS_KEY_ID) throw new Error("BACKUPS_S3_ACCESS_KEY_ID is required when backup S3 upload is enabled");
  if (!parsed.BACKUPS_S3_SECRET_ACCESS_KEY) {
    throw new Error("BACKUPS_S3_SECRET_ACCESS_KEY is required when backup S3 upload is enabled");
  }
}
```

Return:

```ts
backups: {
  enabled: parsed.BACKUPS_ENABLED,
  intervalHours: parsed.BACKUPS_INTERVAL_HOURS,
  localDir: parsed.BACKUPS_LOCAL_DIR,
  retentionDays: parsed.BACKUPS_RETENTION_DAYS,
  s3: {
    enabled: parsed.BACKUPS_S3_ENABLED,
    endpoint: parsed.BACKUPS_S3_ENDPOINT ?? "",
    region: parsed.BACKUPS_S3_REGION,
    bucket: parsed.BACKUPS_S3_BUCKET ?? "",
    accessKeyId: parsed.BACKUPS_S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: parsed.BACKUPS_S3_SECRET_ACCESS_KEY ?? "",
    prefix: parsed.BACKUPS_S3_PREFIX
  }
}
```

- [x] **Step 4: Run config tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/config test
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add packages/config/src/index.ts packages/config/test/config.test.ts
git commit -m "feat: add backup configuration"
```

## Task 2: Backup Metadata Table and Repository

**Files:**

- Create: `packages/db/migrations/0004_backup_runs.sql`
- Create: `packages/db/src/repositories/backups.ts`
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/src/schema.ts`
- Test: `packages/db/test/repositories.test.ts`

- [x] **Step 1: Add failing migration and repository tests**

Add tests to `packages/db/test/repositories.test.ts`:

```ts
import {
  getBackupStatus,
  recordBackupRun,
  withBackupLock
} from "../src/repositories/backups.js";
```

Add near migration coverage:

```ts
it("runs backup metadata migrations", async () => {
  await sql`select id, status, trigger, filename, s3_key from backup_runs limit 0`.execute(db);
});
```

Add repository coverage near system repository tests:

```ts
it("records backup runs and reads latest status", async () => {
  const failed = await recordBackupRun(db, {
    startedAt: new Date("2026-05-06T01:00:00.000Z"),
    finishedAt: new Date("2026-05-06T01:00:05.000Z"),
    status: "failed",
    trigger: "scheduled",
    filename: "signalhub-20260506T010000Z.dump",
    localPath: "/var/lib/signalhub/backups/signalhub-20260506T010000Z.dump",
    sizeBytes: null,
    s3Bucket: null,
    s3Key: null,
    errorMessage: "pg_dump failed"
  });
  const success = await recordBackupRun(db, {
    startedAt: new Date("2026-05-06T02:00:00.000Z"),
    finishedAt: new Date("2026-05-06T02:00:07.000Z"),
    status: "success",
    trigger: "manual",
    filename: "signalhub-20260506T020000Z.dump",
    localPath: "/var/lib/signalhub/backups/signalhub-20260506T020000Z.dump",
    sizeBytes: 1234,
    s3Bucket: "signalhub-backups",
    s3Key: "prod/signalhub/signalhub-20260506T020000Z.dump",
    errorMessage: null
  });

  const status = await getBackupStatus(db);

  expect(failed.status).toBe("failed");
  expect(success.status).toBe("success");
  expect(status.latestSuccess).toMatchObject({ id: success.id, sizeBytes: 1234 });
  expect(status.latestFailure).toMatchObject({ id: failed.id, errorMessage: "pg_dump failed" });
});

it("uses a backup advisory lock", async () => {
  const first = await withBackupLock(db, async () => {
    const nested = await withBackupLock(db, async () => "nested");
    return nested;
  });

  expect(first).toEqual({ locked: true, result: { locked: false } });
});
```

- [x] **Step 2: Run DB tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: fail because migration and repository do not exist.

- [x] **Step 3: Add backup migration**

Create `packages/db/migrations/0004_backup_runs.sql`:

```sql
CREATE TABLE backup_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  trigger text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  filename text NOT NULL,
  local_path text NOT NULL,
  size_bytes bigint,
  s3_bucket text,
  s3_key text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX backup_runs_started_at_idx ON backup_runs(started_at DESC);
CREATE INDEX backup_runs_success_started_at_idx ON backup_runs(started_at DESC) WHERE status = 'success';
CREATE INDEX backup_runs_failed_started_at_idx ON backup_runs(started_at DESC) WHERE status = 'failed';
```

Add to `packages/db/src/migrate.ts`:

```ts
{ name: "0004_backup_runs.sql", url: new URL("../migrations/0004_backup_runs.sql", import.meta.url) }
```

- [x] **Step 4: Add schema types**

Add to `packages/db/src/schema.ts`:

```ts
export interface BackupRunsTable {
  id: ColumnType<string, string | undefined, string>;
  started_at: Timestamp;
  finished_at: NullableTimestamp;
  status: "success" | "failed";
  trigger: "scheduled" | "manual";
  filename: string;
  local_path: string;
  size_bytes: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  s3_bucket: string | null;
  s3_key: string | null;
  error_message: string | null;
  created_at: Timestamp;
}
```

Add `backup_runs: BackupRunsTable;` to `Database`.

- [x] **Step 5: Add repository**

Create `packages/db/src/repositories/backups.ts`:

```ts
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

function toBackupRunRecord(row: BackupRunRow): BackupRunRecord {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    trigger: row.trigger,
    filename: row.filename,
    localPath: row.local_path,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
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

async function tryAcquireBackupTransactionLock(db: BackupDb): Promise<boolean> {
  const result = await sql<{ locked: boolean }>`
    select pg_try_advisory_xact_lock(${backupAdvisoryLockId}) as locked
  `.execute(db);
  return result.rows[0]?.locked === true;
}

export async function withBackupLock<T>(
  db: Db,
  run: () => Promise<T>
): Promise<{ locked: false } | { locked: true; result: T }> {
  return db.transaction().execute(async (trx) => {
    const locked = await tryAcquireBackupTransactionLock(trx);
    if (!locked) return { locked: false };
    return { locked: true, result: await run() };
  });
}
```

- [x] **Step 6: Run DB tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add packages/db/migrations/0004_backup_runs.sql packages/db/src/migrate.ts packages/db/src/schema.ts packages/db/src/repositories/backups.ts packages/db/test/repositories.test.ts
git commit -m "feat: add backup metadata repository"
```

## Task 3: Backup Runner and S3 Upload

**Files:**

- Modify: `apps/worker/package.json`
- Create: `apps/worker/src/backups.ts`
- Create: `apps/worker/test/backups.test.ts`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: Add S3 dependency**

Run:

```bash
pnpm --filter @signal-hub/worker add @aws-sdk/client-s3
```

Expected: `apps/worker/package.json` and `pnpm-lock.yaml` update.

- [x] **Step 2: Add failing backup runner tests**

Create `apps/worker/test/backups.test.ts`:

```ts
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  createBackupFilename,
  pruneLocalBackups,
  runBackupOnce,
  startBackupScheduler
} from "../src/backups.js";

describe("createBackupFilename", () => {
  it("uses a UTC timestamp and no secrets", () => {
    expect(createBackupFilename(new Date("2026-05-06T12:34:56.000Z"))).toBe("signalhub-20260506T123456Z.dump");
  });
});

describe("runBackupOnce", () => {
  it("creates a local backup, uploads to S3 when enabled, records success, and prunes old local files", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "signalhub-backups-"));
    const oldFile = join(localDir, "signalhub-old.dump");
    await writeFile(oldFile, "old");
    await utimes(oldFile, new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-01T00:00:00.000Z"));

    const recordBackupRun = vi.fn(async (input) => input);
    const upload = vi.fn(async () => ({ bucket: "bucket", key: "prod/signalhub/signalhub-20260506T120000Z.dump" }));

    try {
      const result = await runBackupOnce({
        now: () => new Date("2026-05-06T12:00:00.000Z"),
        trigger: "scheduled",
        config: {
          enabled: true,
          intervalHours: 24,
          localDir,
          retentionDays: 14,
          databaseUrl: "postgres://user:pass@localhost:5432/signalhub",
          s3: {
            enabled: true,
            endpoint: "https://example.r2.cloudflarestorage.com",
            region: "auto",
            bucket: "bucket",
            accessKeyId: "access",
            secretAccessKey: "secret",
            prefix: "prod/signalhub"
          }
        },
        withLock: async (run) => ({ locked: true, result: await run() }),
        dumpDatabase: async (input) => {
          await writeFile(input.outputPath, "backup-content");
        },
        uploadBackup: upload,
        recordBackupRun
      });

      expect(result).toEqual({ ran: true, skipped: false });
      expect(await readFile(join(localDir, "signalhub-20260506T120000Z.dump"), "utf8")).toBe("backup-content");
      await expect(stat(oldFile)).rejects.toThrow();
      expect(upload).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: join(localDir, "signalhub-20260506T120000Z.dump"),
          key: "prod/signalhub/signalhub-20260506T120000Z.dump"
        })
      );
      expect(recordBackupRun).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "success",
          trigger: "scheduled",
          sizeBytes: 14,
          s3Bucket: "bucket",
          s3Key: "prod/signalhub/signalhub-20260506T120000Z.dump",
          errorMessage: null
        })
      );
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it("records a sanitized failed run when pg_dump fails", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "signalhub-backups-"));
    const recordBackupRun = vi.fn(async (input) => input);

    try {
      await expect(
        runBackupOnce({
          now: () => new Date("2026-05-06T12:00:00.000Z"),
          trigger: "manual",
          config: {
            enabled: true,
            intervalHours: 24,
            localDir,
            retentionDays: 14,
            databaseUrl: "postgres://user:password@localhost:5432/signalhub",
            s3: { enabled: false, endpoint: "", region: "auto", bucket: "", accessKeyId: "", secretAccessKey: "", prefix: "signalhub" }
          },
          withLock: async (run) => ({ locked: true, result: await run() }),
          dumpDatabase: async () => {
            throw new Error("pg_dump failed password=secret");
          },
          recordBackupRun
        })
      ).resolves.toEqual({ ran: true, skipped: false });

      expect(recordBackupRun).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          trigger: "manual",
          errorMessage: "pg_dump failed password=[REDACTED]"
        })
      );
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it("skips when another worker holds the backup lock", async () => {
    const recordBackupRun = vi.fn();
    const result = await runBackupOnce({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      trigger: "scheduled",
      config: {
        enabled: true,
        intervalHours: 24,
        localDir: "/tmp/backups",
        retentionDays: 14,
        databaseUrl: "postgres://user:pass@localhost:5432/signalhub",
        s3: { enabled: false, endpoint: "", region: "auto", bucket: "", accessKeyId: "", secretAccessKey: "", prefix: "signalhub" }
      },
      withLock: async () => ({ locked: false }),
      dumpDatabase: vi.fn(),
      recordBackupRun
    });

    expect(result).toEqual({ ran: false, skipped: true });
    expect(recordBackupRun).not.toHaveBeenCalled();
  });
});

describe("startBackupScheduler", () => {
  it("runs once after startup and prevents overlapping runs", async () => {
    const callbacks: Array<() => void> = [];
    let resolveRun!: () => void;
    const activeRun = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    const runOnce = vi.fn(() => activeRun);
    const stop = startBackupScheduler({
      intervalHours: 1,
      runOnce,
      setTimeoutFn: (callback) => {
        callbacks.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      setIntervalFn: (callback) => {
        callbacks.push(callback);
        return 2 as unknown as ReturnType<typeof setInterval>;
      },
      clearTimeoutFn: vi.fn(),
      clearIntervalFn: vi.fn()
    });

    callbacks[0]();
    callbacks[1]();
    expect(runOnce).toHaveBeenCalledTimes(1);
    resolveRun();
    await stop();
  });
});
```

- [x] **Step 3: Run worker backup tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/worker test -- backups.test.ts
```

Expected: fail because `apps/worker/src/backups.ts` does not exist.

- [x] **Step 4: Implement backup runner**

Create `apps/worker/src/backups.ts` with these public exports and implementation:

```ts
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { sanitizePreviewText } from "@signal-hub/telemetry/sanitization";

export type BackupS3Config = {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
};

export type BackupRuntimeConfig = {
  enabled: boolean;
  intervalHours: number;
  localDir: string;
  retentionDays: number;
  databaseUrl: string;
  s3: BackupS3Config;
};

export type BackupRunInput = {
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
};

type DumpDatabase = (input: { databaseUrl: string; outputPath: string }) => Promise<void>;
type UploadBackup = (input: {
  config: BackupS3Config;
  filePath: string;
  key: string;
}) => Promise<{ bucket: string; key: string }>;

export function createBackupFilename(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `signalhub-${stamp}.dump`;
}

export function createBackupS3Key(prefix: string, filename: string): string {
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, "");
  return normalizedPrefix ? `${normalizedPrefix}/${filename}` : filename;
}

export async function dumpPostgresDatabase(input: { databaseUrl: string; outputPath: string }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", input.outputPath, input.databaseUrl], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `pg_dump exited with code ${code ?? "unknown"}`));
    });
  });
}

export async function uploadBackupToS3(input: {
  config: BackupS3Config;
  filePath: string;
  key: string;
}): Promise<{ bucket: string; key: string }> {
  const client = new S3Client({
    endpoint: input.config.endpoint,
    region: input.config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: input.config.accessKeyId,
      secretAccessKey: input.config.secretAccessKey
    }
  });
  await client.send(
    new PutObjectCommand({
      Bucket: input.config.bucket,
      Key: input.key,
      Body: createReadStream(input.filePath),
      ContentType: "application/octet-stream"
    })
  );
  return { bucket: input.config.bucket, key: input.key };
}

export async function pruneLocalBackups(input: { localDir: string; now: Date; retentionDays: number }): Promise<void> {
  const cutoff = input.now.getTime() - input.retentionDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(input.localDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.startsWith("signalhub-") && entry.name.endsWith(".dump"))
      .map(async (entry) => {
        const path = join(input.localDir, entry.name);
        const info = await stat(path);
        if (info.mtime.getTime() < cutoff) {
          await rm(path, { force: true });
        }
      })
  );
}

export async function runBackupOnce(input: {
  now: () => Date;
  trigger: "scheduled" | "manual";
  config: BackupRuntimeConfig;
  withLock: <T>(run: () => Promise<T>) => Promise<{ locked: false } | { locked: true; result: T }>;
  dumpDatabase?: DumpDatabase;
  uploadBackup?: UploadBackup;
  recordBackupRun: (input: BackupRunInput) => Promise<unknown>;
}): Promise<{ ran: boolean; skipped: boolean }> {
  const lockResult = await input.withLock(async () => {
    const startedAt = input.now();
    const filename = createBackupFilename(startedAt);
    const localPath = join(input.config.localDir, filename);
    let sizeBytes: number | null = null;
    let s3Bucket: string | null = null;
    let s3Key: string | null = null;

    try {
      await mkdir(input.config.localDir, { recursive: true });
      await (input.dumpDatabase ?? dumpPostgresDatabase)({
        databaseUrl: input.config.databaseUrl,
        outputPath: localPath
      });
      sizeBytes = (await stat(localPath)).size;

      if (input.config.s3.enabled) {
        const key = createBackupS3Key(input.config.s3.prefix, basename(localPath));
        const uploaded = await (input.uploadBackup ?? uploadBackupToS3)({
          config: input.config.s3,
          filePath: localPath,
          key
        });
        s3Bucket = uploaded.bucket;
        s3Key = uploaded.key;
      }

      await pruneLocalBackups({ localDir: input.config.localDir, now: input.now(), retentionDays: input.config.retentionDays });
      await input.recordBackupRun({
        startedAt,
        finishedAt: input.now(),
        status: "success",
        trigger: input.trigger,
        filename,
        localPath,
        sizeBytes,
        s3Bucket,
        s3Key,
        errorMessage: null
      });
    } catch (error) {
      await input.recordBackupRun({
        startedAt,
        finishedAt: input.now(),
        status: "failed",
        trigger: input.trigger,
        filename,
        localPath,
        sizeBytes,
        s3Bucket,
        s3Key,
        errorMessage: sanitizePreviewText(error instanceof Error ? error.message : String(error)) ?? "backup failed"
      });
    }
  });

  if (!lockResult.locked) return { ran: false, skipped: true };
  return { ran: true, skipped: false };
}

type IntervalHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export function startBackupScheduler(input: {
  intervalHours: number;
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
        console.error("Backup scheduler run failed", error);
      } finally {
        activeRun = null;
      }
    })();
  };

  const startupTimer = setTimeoutFn(tick, 1000);
  const interval = setIntervalFn(tick, input.intervalHours * 60 * 60 * 1000);

  return async () => {
    stopped = true;
    clearTimeoutFn(startupTimer);
    clearIntervalFn(interval);
    await activeRun;
  };
}
```

- [x] **Step 5: Run worker backup tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/worker test -- backups.test.ts
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add apps/worker/package.json apps/worker/src/backups.ts apps/worker/test/backups.test.ts pnpm-lock.yaml
git commit -m "feat: add backup runner"
```

## Task 4: Worker Backup Scheduler

**Files:**

- Modify: `apps/worker/src/main.ts`
- Test: `apps/worker/test/telemetry-worker.test.ts`

- [x] **Step 1: Add scheduler coverage to worker tests**

In `apps/worker/test/telemetry-worker.test.ts`, import:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackupOnce, startBackupScheduler } from "../src/backups.js";
```

Add focused tests:

```ts
describe("backup scheduler integration helpers", () => {
  it("records a scheduled backup through injected dependencies", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "signalhub-main-backups-"));
    const recordBackupRun = vi.fn(async (input) => input);
    try {
      const result = await runBackupOnce({
        now: () => new Date("2026-05-06T12:00:00.000Z"),
        trigger: "scheduled",
        config: {
          enabled: true,
          intervalHours: 24,
          localDir,
          retentionDays: 14,
          databaseUrl: "postgres://user:pass@localhost:5432/signalhub",
          s3: { enabled: false, endpoint: "", region: "auto", bucket: "", accessKeyId: "", secretAccessKey: "", prefix: "signalhub" }
        },
        withLock: async (run) => ({ locked: true, result: await run() }),
        dumpDatabase: async ({ outputPath }) => {
          await writeFile(outputPath, "backup-content");
        },
        recordBackupRun
      });

      expect(result).toEqual({ ran: true, skipped: false });
      expect(recordBackupRun).toHaveBeenCalledWith(expect.objectContaining({ status: "success", trigger: "scheduled" }));
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });
});
```

- [x] **Step 2: Run worker tests and verify current behavior**

Run:

```bash
pnpm --filter @signal-hub/worker test -- telemetry-worker.test.ts
```

Expected: pass.

- [x] **Step 3: Wire backup scheduler in worker main**

In `apps/worker/src/main.ts`, import:

```ts
import { recordBackupRun, withBackupLock } from "@signal-hub/db/repositories/backups.js";
import { runBackupOnce, startBackupScheduler } from "./backups.js";
```

Create config:

```ts
const backupConfig = {
  enabled: config.backups.enabled,
  intervalHours: config.backups.intervalHours,
  localDir: config.backups.localDir,
  retentionDays: config.backups.retentionDays,
  databaseUrl: config.databaseUrl,
  s3: config.backups.s3
};
```

Start scheduler after alerts:

```ts
const stopBackups = config.backups.enabled
  ? startBackupScheduler({
      intervalHours: config.backups.intervalHours,
      runOnce: () =>
        runBackupOnce({
          now: () => new Date(),
          trigger: "scheduled",
          config: backupConfig,
          withLock: (run) => withBackupLock(db, run),
          recordBackupRun: (input) => recordBackupRun(db, input)
        })
    })
  : async () => {};
```

Add `stopBackups()` to the shutdown `Promise.allSettled` list before retention:

```ts
const stopResults = await Promise.allSettled([stopBackups(), stopAlerts(), stopRetention(), stopHeartbeat(), worker.close()]);
```

- [x] **Step 4: Run worker tests and build**

Run:

```bash
pnpm --filter @signal-hub/worker test
pnpm --filter @signal-hub/worker build
```

Expected: both pass.

- [x] **Step 5: Commit**

```bash
git add apps/worker/src/main.ts apps/worker/test/telemetry-worker.test.ts
git commit -m "feat: schedule worker backups"
```

## Task 5: Manual Backup and Restore Scripts

**Files:**

- Create: `scripts/backup-create.ts`
- Create: `scripts/backup-restore.ts`
- Modify: `package.json`
- Test: `apps/worker/test/backups.test.ts`

- [x] **Step 1: Add failing restore confirmation tests**

Add to `apps/worker/test/backups.test.ts`:

```ts
import { parseRestoreArgs } from "../../../scripts/backup-restore.js";

describe("parseRestoreArgs", () => {
  it("requires a file path and explicit --yes", () => {
    expect(() => parseRestoreArgs(["node", "backup-restore.ts"])).toThrow("Usage: pnpm backup:restore -- <file> --yes");
    expect(() => parseRestoreArgs(["node", "backup-restore.ts", "backup.dump"])).toThrow("Restore requires --yes");
    expect(parseRestoreArgs(["node", "backup-restore.ts", "backup.dump", "--yes"])).toEqual({ filePath: "backup.dump" });
  });
});
```

- [x] **Step 2: Run script-related tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/worker test -- backups.test.ts
```

Expected: fail because `scripts/backup-restore.ts` does not exist.

- [x] **Step 3: Add manual backup script**

Create `scripts/backup-create.ts`:

```ts
import { pathToFileURL } from "node:url";
import { loadConfig } from "../packages/config/src/index.js";
import { createDb } from "../packages/db/src/client.js";
import { migrate } from "../packages/db/src/migrate.js";
import { recordBackupRun, withBackupLock } from "../packages/db/src/repositories/backups.js";
import { runBackupOnce } from "../apps/worker/src/backups.js";

export async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  try {
    await migrate(db);
    const result = await runBackupOnce({
      now: () => new Date(),
      trigger: "manual",
      config: {
        enabled: true,
        intervalHours: config.backups.intervalHours,
        localDir: config.backups.localDir,
        retentionDays: config.backups.retentionDays,
        databaseUrl: config.databaseUrl,
        s3: config.backups.s3
      },
      withLock: (run) => withBackupLock(db, run),
      recordBackupRun: (input) => recordBackupRun(db, input)
    });
    console.log(result.skipped ? "Backup skipped because another backup is running" : "Backup completed");
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
```

- [x] **Step 4: Add restore script**

Create `scripts/backup-restore.ts`:

```ts
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../packages/config/src/index.js";

export function parseRestoreArgs(argv: string[]): { filePath: string } {
  const args = argv.slice(2);
  const filePath = args.find((arg) => arg !== "--yes");
  if (!filePath) {
    throw new Error("Usage: pnpm backup:restore -- <file> --yes");
  }
  if (!args.includes("--yes")) {
    throw new Error("Restore requires --yes");
  }
  return { filePath };
}

export async function restoreBackup(input: { databaseUrl: string; filePath: string }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pg_restore",
      ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", input.databaseUrl, input.filePath],
      { stdio: ["ignore", "inherit", "pipe"] }
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `pg_restore exited with code ${code ?? "unknown"}`));
    });
  });
}

export async function main(argv = process.argv): Promise<void> {
  const { filePath } = parseRestoreArgs(argv);
  const config = loadConfig();
  await restoreBackup({ databaseUrl: config.databaseUrl, filePath });
  console.log("Backup restored");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
```

- [x] **Step 5: Add package scripts**

In root `package.json`, add:

```json
"backup:create": "tsx scripts/backup-create.ts",
"backup:restore": "tsx scripts/backup-restore.ts"
```

- [x] **Step 6: Run tests and script help checks**

Run:

```bash
pnpm --filter @signal-hub/worker test -- backups.test.ts
pnpm backup:restore
```

Expected: tests pass; `pnpm backup:restore` exits non-zero with `Usage: pnpm backup:restore -- <file> --yes`.

- [x] **Step 7: Commit**

```bash
git add scripts/backup-create.ts scripts/backup-restore.ts package.json apps/worker/test/backups.test.ts
git commit -m "feat: add backup operator scripts"
```

## Task 6: System Health Backup Status

**Files:**

- Modify: `apps/api/src/routes/system.ts`
- Modify: `apps/api/src/system-health.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/test/system.test.ts`

- [x] **Step 1: Add failing API health tests**

In `apps/api/test/system.test.ts`, extend the snapshot fixture with:

```ts
backups: {
  enabled: true,
  intervalHours: 24,
  retentionDays: 14,
  s3Enabled: true,
  stale: false,
  latestSuccess: {
    id: "bkp_1",
    status: "success",
    trigger: "scheduled",
    startedAt: "2026-05-06T00:00:00.000Z",
    finishedAt: "2026-05-06T00:00:05.000Z",
    filename: "signalhub-20260506T000000Z.dump",
    sizeBytes: 1234,
    s3Bucket: "signalhub-backups",
    s3Key: "prod/signalhub/signalhub-20260506T000000Z.dump",
    errorMessage: null
  },
  latestFailure: null
}
```

Add `createSystemHealthSnapshot` coverage:

```ts
it("includes backup status and marks stale backups degraded", async () => {
  const snapshot = await createSystemHealthSnapshot({
    now: () => new Date("2026-05-06T12:00:00.000Z"),
    retention: {
      enabled: true,
      intervalMinutes: 60,
      policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180 }
    },
    backups: {
      enabled: true,
      intervalHours: 4,
      retentionDays: 14,
      s3Enabled: true
    },
    postgresPing: async () => undefined,
    redisPing: async () => "PONG",
    getQueueCounts: async () => ({}),
    getHeartbeat: async () => ({ lastHeartbeatAt: new Date("2026-05-06T11:59:00.000Z") }),
    getIngestionFreshness: async () => ({
      lastEventAt: null,
      lastErrorAt: null,
      lastTraceAt: null,
      lastSpanAt: null,
      lastLlmCallAt: null
    }),
    getLastRetentionRun: async () => null,
    getBackupStatus: async () => ({
      latestSuccess: {
        id: "bkp_1",
        status: "success",
        trigger: "scheduled",
        startedAt: new Date("2026-05-06T00:00:00.000Z"),
        finishedAt: new Date("2026-05-06T00:00:05.000Z"),
        filename: "signalhub-20260506T000000Z.dump",
        localPath: "/var/lib/signalhub/backups/signalhub-20260506T000000Z.dump",
        sizeBytes: 1234,
        s3Bucket: "signalhub-backups",
        s3Key: "prod/signalhub/signalhub-20260506T000000Z.dump",
        errorMessage: null,
        createdAt: new Date("2026-05-06T00:00:05.000Z")
      },
      latestFailure: null
    })
  });

  expect(snapshot.status).toBe("degraded");
  expect(snapshot.backups.stale).toBe(true);
  expect(JSON.stringify(snapshot)).not.toContain("/var/lib/signalhub");
});
```

- [x] **Step 2: Run API system tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/api test -- system.test.ts
```

Expected: fail because backup health types/dependencies are missing.

- [x] **Step 3: Extend system route types**

In `apps/api/src/routes/system.ts`, add:

```ts
backups: {
  enabled: boolean;
  intervalHours: number;
  retentionDays: number;
  s3Enabled: boolean;
  stale: boolean | null;
  latestSuccess: {
    id: string;
    status: "success" | "failed";
    trigger: "scheduled" | "manual";
    startedAt: string;
    finishedAt: string | null;
    filename: string;
    sizeBytes: number | null;
    s3Bucket: string | null;
    s3Key: string | null;
    errorMessage: string | null;
  } | null;
  latestFailure: {
    id: string;
    status: "success" | "failed";
    trigger: "scheduled" | "manual";
    startedAt: string;
    finishedAt: string | null;
    filename: string;
    sizeBytes: number | null;
    s3Bucket: string | null;
    s3Key: string | null;
    errorMessage: string | null;
  } | null;
};
```

- [x] **Step 4: Extend `createSystemHealthSnapshot`**

In `apps/api/src/system-health.ts`, add dependency types:

```ts
type BackupRun = {
  id: string;
  status: "success" | "failed";
  trigger: "scheduled" | "manual";
  startedAt: Date;
  finishedAt: Date | null;
  filename: string;
  localPath: string;
  sizeBytes: number | null;
  s3Bucket: string | null;
  s3Key: string | null;
  errorMessage: string | null;
};
```

Add dependencies:

```ts
backups: {
  enabled: boolean;
  intervalHours: number;
  retentionDays: number;
  s3Enabled: boolean;
};
getBackupStatus: () => Promise<{ latestSuccess: BackupRun | null; latestFailure: BackupRun | null }>;
```

Probe backup status with the other DB probes. Add helpers:

```ts
function toBackupHealthRun(run: BackupRun | null) {
  return run
    ? {
        id: run.id,
        status: run.status,
        trigger: run.trigger,
        startedAt: run.startedAt.toISOString(),
        finishedAt: isoOrNull(run.finishedAt),
        filename: run.filename,
        sizeBytes: run.sizeBytes,
        s3Bucket: run.s3Bucket,
        s3Key: run.s3Key,
        errorMessage: run.errorMessage
      }
    : null;
}

function isBackupStale(input: { enabled: boolean; intervalHours: number; now: Date; latestSuccess: BackupRun | null }): boolean | null {
  if (!input.enabled) return null;
  if (!input.latestSuccess) return true;
  return input.now.getTime() - input.latestSuccess.startedAt.getTime() > input.intervalHours * 2 * 60 * 60 * 1000;
}
```

Include `backupStale` and latest failed backup in overall status:

```ts
const backupFailed = backupStatusValue.latestFailure?.startedAt && (!backupStatusValue.latestSuccess || backupStatusValue.latestFailure.startedAt > backupStatusValue.latestSuccess.startedAt);
const backupStale = isBackupStale({ enabled: dependencies.backups.enabled, intervalHours: dependencies.backups.intervalHours, now: generatedAt, latestSuccess: backupStatusValue.latestSuccess });
```

Add to degraded status conditions:

```ts
backupStale === true || backupFailed
```

Return `backups`.

- [x] **Step 5: Wire API main**

In `apps/api/src/main.ts`, import:

```ts
import { getBackupStatus } from "@signal-hub/db/repositories/backups.js";
```

Pass:

```ts
backups: {
  enabled: config.backups.enabled,
  intervalHours: config.backups.intervalHours,
  retentionDays: config.backups.retentionDays,
  s3Enabled: config.backups.s3.enabled
},
getBackupStatus: () => getBackupStatus(db)
```

- [x] **Step 6: Run API system tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/api test -- system.test.ts
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add apps/api/src/routes/system.ts apps/api/src/system-health.ts apps/api/src/main.ts apps/api/test/system.test.ts
git commit -m "feat: expose backup health status"
```

## Task 7: Console Backup Status

**Files:**

- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/components/SystemHealthPanel.tsx`
- Modify: `apps/console/src/components/SystemHealthPanel.test.tsx`
- Modify: `apps/console/src/components/ConsoleShell.test.tsx`
- Modify: `apps/console/src/api/client.test.ts`

- [x] **Step 1: Add failing console tests**

In `apps/console/src/components/SystemHealthPanel.test.tsx`, extend `healthyResponse()` with backup status:

```ts
backups: {
  enabled: true,
  intervalHours: 24,
  retentionDays: 14,
  s3Enabled: true,
  stale: false,
  latestSuccess: {
    id: "bkp_1",
    status: "success",
    trigger: "scheduled",
    startedAt: "2026-05-06T00:00:00.000Z",
    finishedAt: "2026-05-06T00:00:05.000Z",
    filename: "signalhub-20260506T000000Z.dump",
    sizeBytes: 1234,
    s3Bucket: "signalhub-backups",
    s3Key: "prod/signalhub/signalhub-20260506T000000Z.dump",
    errorMessage: null
  },
  latestFailure: null
}
```

Add:

```ts
it("renders backup status without local paths or credentials", async () => {
  const api = client(async () => ({ data: healthyResponse() }));
  render(<SystemHealthPanel client={api} />);

  expect(await screen.findByRole("heading", { name: "Backups" })).toBeInTheDocument();
  expect(screen.getByText("Enabled")).toBeInTheDocument();
  expect(screen.getByText("S3 enabled")).toBeInTheDocument();
  expect(screen.getByText("signalhub-20260506T000000Z.dump")).toBeInTheDocument();
  expect(screen.getByText("1234 bytes")).toBeInTheDocument();
  expect(screen.queryByText(/var\/lib\/signalhub/)).not.toBeInTheDocument();
  expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();
});
```

Update any other `SystemHealthResponse` fixtures in console tests with the same `backups` shape.

- [x] **Step 2: Run console tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/console test -- SystemHealthPanel.test.tsx
```

Expected: fail because types/UI do not include backups.

- [x] **Step 3: Add console types**

In `apps/console/src/api/types.ts`, add:

```ts
export type BackupHealthRun = {
  id: string;
  status: "success" | "failed";
  trigger: "scheduled" | "manual";
  startedAt: string;
  finishedAt: string | null;
  filename: string;
  sizeBytes: number | null;
  s3Bucket: string | null;
  s3Key: string | null;
  errorMessage: string | null;
};
```

Add to `SystemHealthResponse`:

```ts
backups: {
  enabled: boolean;
  intervalHours: number;
  retentionDays: number;
  s3Enabled: boolean;
  stale: boolean | null;
  latestSuccess: BackupHealthRun | null;
  latestFailure: BackupHealthRun | null;
};
```

- [x] **Step 4: Render backup card**

In `apps/console/src/components/SystemHealthPanel.tsx`, add:

```ts
function formatBytes(value: number | null): string {
  return value === null ? "No data" : `${value} bytes`;
}
```

Add a `Backups` card in the `System operations` grid:

```tsx
<article className="system-card">
  <div className="system-card__header">
    <h3>Backups</h3>
    <span className={health.backups.stale ? "status-pill status-pill--degraded" : "status-pill status-pill--neutral"}>
      {health.backups.enabled ? "Enabled" : "Disabled"}
    </span>
  </div>
  <dl>
    <div>
      <dt>Interval</dt>
      <dd>{health.backups.intervalHours} hours</dd>
    </div>
    <div>
      <dt>Local retention</dt>
      <dd>{health.backups.retentionDays} days</dd>
    </div>
    <div>
      <dt>Offsite</dt>
      <dd>{health.backups.s3Enabled ? "S3 enabled" : "S3 disabled"}</dd>
    </div>
    <div>
      <dt>Stale</dt>
      <dd>{health.backups.stale === null ? "Not applicable" : health.backups.stale ? "Yes" : "No"}</dd>
    </div>
    {health.backups.latestSuccess ? (
      <>
        <div>
          <dt>Latest success</dt>
          <dd>{formatTimestamp(health.backups.latestSuccess.startedAt)}</dd>
        </div>
        <div>
          <dt>Filename</dt>
          <dd>{health.backups.latestSuccess.filename}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(health.backups.latestSuccess.sizeBytes)}</dd>
        </div>
      </>
    ) : (
      <div>
        <dt>Latest success</dt>
        <dd>No data</dd>
      </div>
    )}
    {health.backups.latestFailure ? (
      <div>
        <dt>Latest failure</dt>
        <dd>{health.backups.latestFailure.errorMessage ?? formatTimestamp(health.backups.latestFailure.startedAt)}</dd>
      </div>
    ) : null}
  </dl>
</article>
```

- [x] **Step 5: Run console tests and build**

Run:

```bash
pnpm --filter @signal-hub/console test -- SystemHealthPanel.test.tsx ConsoleShell.test.tsx client.test.ts
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add apps/console/src/api/types.ts apps/console/src/components/SystemHealthPanel.tsx apps/console/src/components/SystemHealthPanel.test.tsx apps/console/src/components/ConsoleShell.test.tsx apps/console/src/api/client.test.ts
git commit -m "feat: show backup health in console"
```

## Task 8: Compose, Docker, and Documentation

**Files:**

- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/DEPLOYMENT.md`
- Modify: `.claude/docs/SECRETS.md`
- Modify: `.claude/docs/INFRASTRUCTURE.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `.claude/docs/UI-UX.md`

- [x] **Step 1: Add Postgres client tools to Docker image**

In `Dockerfile`, add after `WORKDIR /app`:

```dockerfile
RUN apk add --no-cache postgresql16-client
```

- [x] **Step 2: Add backup volume to Compose**

In `docker-compose.yml`, add worker volume:

```yaml
    volumes:
      - backup_data:/var/lib/signalhub/backups
```

Add volume:

```yaml
  backup_data:
```

- [x] **Step 3: Add env examples**

In `.env.example`, add:

```dotenv
BACKUPS_ENABLED=true
BACKUPS_INTERVAL_HOURS=24
BACKUPS_LOCAL_DIR=/var/lib/signalhub/backups
BACKUPS_RETENTION_DAYS=14
BACKUPS_S3_ENABLED=false
BACKUPS_S3_ENDPOINT=
BACKUPS_S3_REGION=auto
BACKUPS_S3_BUCKET=
BACKUPS_S3_ACCESS_KEY_ID=
BACKUPS_S3_SECRET_ACCESS_KEY=
BACKUPS_S3_PREFIX=signalhub
```

- [x] **Step 4: Update README backup docs**

Add a `Backups and Restore` section:

````md
## Backups and Restore

SignalHub can create scheduled Postgres logical backups from the worker. Backups use `pg_dump` custom format and are written to `BACKUPS_LOCAL_DIR`. Docker Compose mounts this path as the `backup_data` volume.

Manual backup:

```sh
pnpm backup:create
```

Manual restore is destructive. Stop the API and worker before restoring:

```sh
docker compose stop api worker
pnpm backup:restore -- /var/lib/signalhub/backups/signalhub-YYYYMMDDTHHMMSSZ.dump --yes
docker compose start api worker
```

For Cloudflare R2, create a private bucket and scoped R2 token, then set:

```dotenv
BACKUPS_S3_ENABLED=true
BACKUPS_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
BACKUPS_S3_REGION=auto
BACKUPS_S3_BUCKET=signalhub-backups
BACKUPS_S3_ACCESS_KEY_ID=<r2-access-key-id>
BACKUPS_S3_SECRET_ACCESS_KEY=<r2-secret-access-key>
BACKUPS_S3_PREFIX=production/signalhub
```

Remote backup retention is controlled by bucket lifecycle rules in this slice.
````

- [x] **Step 5: Update project docs**

Update docs with these facts:

- `ARCHITECTURE.md`: worker owns backup scheduler; `backup_runs` stores metadata only.
- `DEPLOYMENT.md`: backup setup, R2 config, manual restore procedure, restore requires API/worker stopped.
- `SECRETS.md`: list S3 variables with safe examples and note credentials are environment-only.
- `INFRASTRUCTURE.md`: add `backup_data` Compose volume and optional S3-compatible bucket.
- `PROJECT-SUMMARY.md`: current phase includes backup/restore.
- `UI-UX.md`: System panel includes backup status.

- [x] **Step 6: Validate Compose**

Run:

```bash
docker compose config --quiet
```

Expected: exits 0.

- [x] **Step 7: Commit**

```bash
git add Dockerfile docker-compose.yml .env.example README.md .claude/docs/ARCHITECTURE.md .claude/docs/DEPLOYMENT.md .claude/docs/SECRETS.md .claude/docs/INFRASTRUCTURE.md .claude/docs/PROJECT-SUMMARY.md .claude/docs/UI-UX.md
git commit -m "docs: document backup restore operations"
```

## Task 9: Final Verification and Visual Check

**Files:**

- Modify only the exact files responsible for defects found during verification.

- [ ] **Step 1: Run full tests**

Run:

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 2: Run production build**

Run:

```bash
pnpm build
```

Expected: all workspace builds pass.

- [ ] **Step 3: Validate Compose**

Run:

```bash
docker compose config --quiet
```

Expected: exits 0.

- [ ] **Step 4: Verify backup scripts fail safely without destructive action**

Run:

```bash
pnpm backup:restore
pnpm backup:restore -- /tmp/nonexistent-signalhub-backup.dump
```

Expected: both exit non-zero. The first prints usage; the second prints that restore requires `--yes`.

- [ ] **Step 5: Browser visual check**

Run the console dev server:

```bash
pnpm dev:console
```

Use browser automation with mocked `/console/config`, `/auth/me`, `/admin/projects`, `/admin/projects/:id/environments`, and `/system/health`.

Verify at `1440x1000` and `390x900`:

- System tab is visible.
- Backup card renders enabled, interval, local retention, S3 status, stale status, latest success, filename, and size.
- Backup local path is not rendered.
- S3 credentials are not rendered.
- No horizontal page overflow.
- No browser console errors.

- [ ] **Step 6: Commit verification fixes if needed**

If verification fixes are needed:

```bash
git status -sb
git add path/to/fixed-file
git commit -m "fix: polish backup restore verification"
```

If no fixes are needed, do not create an empty commit.
