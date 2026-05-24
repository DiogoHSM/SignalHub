import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import type { Readable } from "node:stream";
import { promisify } from "node:util";
import { PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { sanitizePreviewText } from "@sigmon/telemetry/sanitization";

const execFileAsync = promisify(execFile);
const backupFilenamePattern = /^sigmon-\d{8}T\d{6}Z\.dump$/;
type ExecFileFn = (
  file: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv }
) => Promise<unknown>;
type BackupReadStream = Readable & { destroy: (error?: Error) => void };

export type BackupTrigger = "scheduled" | "manual";

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
  trigger: BackupTrigger;
  filename: string;
  localPath: string;
  sizeBytes: number | null;
  checksumSha256: string | null;
  s3Bucket: string | null;
  s3Key: string | null;
  errorMessage: string | null;
};

export type DumpDatabaseInput = {
  databaseUrl: string;
  outputPath: string;
  execFileFn?: ExecFileFn;
};

export type UploadBackupInput = {
  filePath: string;
  key: string;
  s3: BackupS3Config;
  createClient?: (config: S3ClientConfig) => { send: (command: PutObjectCommand) => Promise<unknown> };
  createReadStreamFn?: (path: string) => BackupReadStream;
};

export type RunBackupOnceInput = {
  now: () => Date;
  trigger: BackupTrigger;
  config: BackupRuntimeConfig;
  withLock: <T>(run: () => Promise<T>) => Promise<{ locked: false } | { locked: true; result: T }>;
  dumpDatabase?: (input: DumpDatabaseInput) => Promise<void>;
  uploadBackup?: (input: UploadBackupInput) => Promise<{ bucket: string; key: string }>;
  pruneBackups?: typeof pruneLocalBackups;
  recordBackupRun: (input: BackupRunInput) => Promise<unknown>;
};

export type BackupConfig = BackupRuntimeConfig;
export type BackupRuntime = RunBackupOnceInput;

export function createBackupFilename(now: Date): string {
  const year = now.getUTCFullYear().toString().padStart(4, "0");
  const month = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = now.getUTCDate().toString().padStart(2, "0");
  const hours = now.getUTCHours().toString().padStart(2, "0");
  const minutes = now.getUTCMinutes().toString().padStart(2, "0");
  const seconds = now.getUTCSeconds().toString().padStart(2, "0");
  return `sigmon-${year}${month}${day}T${hours}${minutes}${seconds}Z.dump`;
}

export function createBackupS3Key(prefix: string, filename: string): string {
  const trimmedPrefix = prefix.replace(/^\/+|\/+$/g, "");
  return trimmedPrefix === "" ? filename : `${trimmedPrefix}/${filename}`;
}

export async function calculateFileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

export async function writeChecksumSidecar(filePath: string, checksum: string): Promise<void> {
  await writeFile(`${filePath}.sha256`, `${checksum}  ${basename(filePath)}\n`, "utf8");
}

export async function dumpPostgresDatabase(input: DumpDatabaseInput): Promise<void> {
  const execFileFn =
    input.execFileFn ??
    (async (file: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
      await execFileAsync(file, args, options);
    });
  const databaseUrl = new URL(input.databaseUrl);
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
  const username = decodeURIComponent(databaseUrl.username);
  const password = decodeURIComponent(databaseUrl.password);
  const sanitizedConnectionUrl = new URL(databaseUrl);
  sanitizedConnectionUrl.password = "";
  const args = [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file",
    input.outputPath,
    "--dbname"
  ];

  if (databaseUrl.search !== "") {
    args.push(sanitizedConnectionUrl.toString());
  } else {
    args.push(databaseName, "--host", databaseUrl.hostname);

    if (databaseUrl.port !== "") {
      args.push("--port", databaseUrl.port);
    }

    if (username !== "") {
      args.push("--username", username);
    }
  }

  const options = password === "" ? undefined : { env: { ...process.env, PGPASSWORD: password } };

  try {
    await execFileFn("pg_dump", args, options);
  } catch {
    throw new Error("pg_dump failed");
  }
}

export async function uploadBackupToS3(input: UploadBackupInput): Promise<{ bucket: string; key: string }> {
  const createClient = input.createClient ?? ((config: S3ClientConfig) => new S3Client(config));
  const createReadStreamFn = input.createReadStreamFn ?? ((path: string) => createReadStream(path));
  const sidecarPath = `${input.filePath}.sha256`;
  const client = createClient({
    endpoint: input.s3.endpoint,
    region: input.s3.region,
    credentials: {
      accessKeyId: input.s3.accessKeyId,
      secretAccessKey: input.s3.secretAccessKey
    },
    forcePathStyle: true
  });
  await stat(sidecarPath);
  const body = createReadStreamFn(input.filePath);
  const sidecarBody = createReadStreamFn(sidecarPath);

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: input.s3.bucket,
        Key: input.key,
        Body: body,
        ContentType: "application/octet-stream"
      })
    );
    await client.send(
      new PutObjectCommand({
        Bucket: input.s3.bucket,
        Key: `${input.key}.sha256`,
        Body: sidecarBody,
        ContentType: "text/plain"
      })
    );
  } finally {
    body.destroy();
    sidecarBody.destroy();
  }

  return { bucket: input.s3.bucket, key: input.key };
}

export async function pruneLocalBackups(input: {
  localDir: string;
  retentionDays: number;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const cutoffMs = now.getTime() - input.retentionDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(input.localDir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || !backupFilenamePattern.test(entry.name)) return;

      const filePath = join(input.localDir, entry.name);
      const fileStat = await stat(filePath);
      if (fileStat.mtimeMs < cutoffMs) {
        await unlink(filePath);
        await unlinkIfExists(`${filePath}.sha256`);
      }
    })
  );
}

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function runBackupOnce(runtime: RunBackupOnceInput): Promise<{ ran: boolean; skipped: boolean }> {
  const startedAt = runtime.now();
  const filename = createBackupFilename(startedAt);
  const localPath = join(runtime.config.localDir, filename);
  const dumpDatabase = runtime.dumpDatabase ?? dumpPostgresDatabase;
  const uploadBackup = runtime.uploadBackup ?? uploadBackupToS3;
  const pruneBackups = runtime.pruneBackups ?? pruneLocalBackups;

  try {
    const lockResult = await runtime.withLock(async () => {
      await mkdir(runtime.config.localDir, { recursive: true });
      await dumpDatabase({ databaseUrl: runtime.config.databaseUrl, outputPath: localPath });
      const fileStat = await stat(localPath);
      const checksumSha256 = await calculateFileSha256(localPath);
      await writeChecksumSidecar(localPath, checksumSha256);
      let s3Bucket: string | null = null;
      let s3Key: string | null = null;

      if (runtime.config.s3.enabled) {
        const key = createBackupS3Key(runtime.config.s3.prefix, filename);
        const uploaded = await uploadBackup({ filePath: localPath, key, s3: runtime.config.s3 });
        s3Bucket = uploaded.bucket;
        s3Key = uploaded.key;
      }

      await pruneBackups({
        localDir: runtime.config.localDir,
        retentionDays: runtime.config.retentionDays,
        now: startedAt
      });

      await runtime.recordBackupRun({
        startedAt,
        finishedAt: runtime.now(),
        status: "success",
        trigger: runtime.trigger,
        filename,
        localPath,
        sizeBytes: fileStat.size,
        checksumSha256,
        s3Bucket,
        s3Key,
        errorMessage: null
      });
    });

    if (!lockResult.locked) return { ran: false, skipped: true };
    return { ran: true, skipped: false };
  } catch (error) {
    await runtime.recordBackupRun({
      startedAt,
      finishedAt: runtime.now(),
      status: "failed",
      trigger: runtime.trigger,
      filename,
      localPath,
      sizeBytes: null,
      checksumSha256: null,
      s3Bucket: null,
      s3Key: null,
      errorMessage: sanitizeBackupError(error)
    });

    return { ran: true, skipped: false };
  }
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

function sanitizeBackupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const withoutUrlCredentials = message.replace(/([a-z][a-z0-9+.-]*:\/\/)([^:\s/@]+):([^@\s/]+)@/gi, "$1$2:[REDACTED]@");
  return sanitizePreviewText(withoutUrlCredentials) ?? "backup failed";
}
