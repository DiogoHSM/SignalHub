import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import type { LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import { promisify } from "node:util";
import { PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import {
  createSafeLookup,
  OutboundPolicy,
  validateOutboundHttpTransport
} from "@sigmon/config";
import { sanitizePreviewText } from "@sigmon/telemetry/sanitization";
import { buildLibpqSubprocess } from "./libpq-subprocess.js";

const execFileAsync = promisify(execFile);
const backupFilenamePattern = /^sigmon-\d{8}T\d{6}Z\.dump$/;
type ExecFileFn = (
  file: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; timeout?: number }
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
  timeoutMs?: number;
  execFileFn?: ExecFileFn;
};

export type UploadBackupInput = {
  filePath: string;
  key: string;
  s3: BackupS3Config;
  outboundPolicy?: OutboundPolicy;
  lookup?: LookupFunction;
  timeoutMs?: number;
  createClient?: (config: S3ClientConfig) => BackupS3Client;
  createReadStreamFn?: (path: string) => BackupReadStream;
  statFn?: typeof stat;
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
  outboundPolicy?: OutboundPolicy;
};

export type BackupConfig = BackupRuntimeConfig;
export type BackupRuntime = RunBackupOnceInput;

type BackupS3Client = {
  send: (command: PutObjectCommand, options?: { abortSignal?: AbortSignal }) => Promise<unknown>;
  destroy?: () => void;
};

const DEFAULT_S3_OPERATION_TIMEOUT_MS = 30_000;
const MAX_S3_SOCKETS = 4;

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
    (async (file: string, args: string[], options?: { env?: NodeJS.ProcessEnv; timeout?: number }) => {
      await execFileAsync(file, args, options);
    });
  const timeoutMs = input.timeoutMs ?? 300_000;
  let connection;
  try {
    connection = buildLibpqSubprocess(input.databaseUrl);
  } catch {
    await unlinkIfExists(input.outputPath);
    throw new Error("database_url_invalid");
  }
  const args = [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--no-password",
    "--file",
    input.outputPath,
    "--dbname",
    connection.argsConnection
  ];

  const options = {
    timeout: timeoutMs,
    env: connection.env
  };

  try {
    await execFileFn("pg_dump", args, options);
  } catch {
    await unlinkIfExists(input.outputPath);
    throw new Error("pg_dump failed");
  }
}

export async function uploadBackupToS3(input: UploadBackupInput): Promise<{ bucket: string; key: string }> {
  const policy = input.outboundPolicy ?? new OutboundPolicy();
  try {
    validateOutboundHttpTransport(input.s3.endpoint, policy, { requireHttps: true });
  } catch (error) {
    if (error instanceof Error && error.message === "outbound_https_required") {
      throw new Error("backup_s3_https_required");
    }
    throw new Error("backup_s3_endpoint_forbidden");
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_S3_OPERATION_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("backup_s3_timeout_invalid");
  }
  const lookup = createSafeLookup(policy, input.lookup);
  const httpAgent = new HttpAgent({ keepAlive: false, maxSockets: MAX_S3_SOCKETS, lookup });
  const httpsAgent = new HttpsAgent({
    keepAlive: false,
    maxSockets: MAX_S3_SOCKETS,
    lookup,
    rejectUnauthorized: true
  });
  const requestHandler = new NodeHttpHandler({
    httpAgent,
    httpsAgent,
    connectionTimeout: Math.min(5_000, timeoutMs),
    requestTimeout: timeoutMs,
    throwOnRequestTimeout: true,
    socketTimeout: timeoutMs
  });
  const createClient = input.createClient ?? ((config: S3ClientConfig) => new S3Client(config));
  const createReadStreamFn = input.createReadStreamFn ?? ((path: string) => createReadStream(path));
  const statFn = input.statFn ?? stat;
  const sidecarPath = `${input.filePath}.sha256`;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  let client: BackupS3Client | undefined;
  let primaryError: unknown;
  let stage: "client" | "sidecar" | "upload" = "client";
  try {
    client = createClient({
      endpoint: input.s3.endpoint,
      region: input.s3.region,
      credentials: {
        accessKeyId: input.s3.accessKeyId,
        secretAccessKey: input.s3.secretAccessKey
      },
      forcePathStyle: true,
      maxAttempts: 1,
      requestHandler
    });
    stage = "sidecar";
    await settleBeforeAbort(statFn(sidecarPath), controller.signal);

    stage = "upload";
    await uploadObjectToS3WithRetry({
      client,
      bucket: input.s3.bucket,
      key: input.key,
      filePath: input.filePath,
      contentType: "application/octet-stream",
      createReadStreamFn,
      abortSignal: controller.signal
    });
    await uploadObjectToS3WithRetry({
      client,
      bucket: input.s3.bucket,
      key: `${input.key}.sha256`,
      filePath: sidecarPath,
      contentType: "text/plain",
      createReadStreamFn,
      abortSignal: controller.signal
    });

    return { bucket: input.s3.bucket, key: input.key };
  } catch {
    primaryError = controller.signal.aborted
      ? new Error("backup_s3_timeout")
      : new Error(
          stage === "client"
            ? "backup_s3_client_failed"
            : stage === "sidecar"
              ? "backup_s3_sidecar_unavailable"
              : "backup_s3_upload_failed"
        );
    throw primaryError;
  } finally {
    clearTimeout(deadline);
    controller.abort();
    let cleanupError: unknown;
    try {
      client?.destroy?.();
    } catch (error) {
      cleanupError = error;
    }
    try {
      requestHandler.destroy();
    } catch (error) {
      cleanupError ??= error;
    }
    if (primaryError === undefined && cleanupError !== undefined) {
      throw new Error("backup_s3_cleanup_failed");
    }
  }
}

async function uploadObjectToS3WithRetry(input: {
  client: BackupS3Client;
  bucket: string;
  key: string;
  filePath: string;
  contentType: string;
  createReadStreamFn: (path: string) => BackupReadStream;
  abortSignal: AbortSignal;
  attempts?: number;
  baseDelayMs?: number;
}): Promise<void> {
  const attempts = input.attempts ?? 2;
  const baseDelayMs = input.baseDelayMs ?? 100;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (input.abortSignal.aborted) throw new Error("backup_s3_timeout");
    const body = input.createReadStreamFn(input.filePath);
    try {
      await settleBeforeAbort(
        input.client.send(
          new PutObjectCommand({
            Bucket: input.bucket,
            Key: input.key,
            Body: body,
            ContentType: input.contentType
          }),
          { abortSignal: input.abortSignal }
        ),
        input.abortSignal
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableS3Error(error)) {
        throw error;
      }
      await abortableSleep(Math.min(baseDelayMs * attempt, 1_000), input.abortSignal);
    } finally {
      body.destroy();
    }
  }

  throw lastError instanceof Error ? lastError : new Error("s3 upload failed");
}

function isRetryableS3Error(error: unknown): boolean {
  const status = readS3StatusCode(error);
  if (status === null) return true;
  return status === 408 || status === 429 || status >= 500;
}

function readS3StatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) return null;
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata;
  if (typeof metadata?.httpStatusCode !== "number") return null;
  return metadata.httpStatusCode;
}

async function settleBeforeAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("backup_s3_timeout");
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("backup_s3_timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

async function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("backup_s3_timeout");
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error("backup_s3_timeout"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
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
        const uploaded = await uploadBackup({
          filePath: localPath,
          key,
          s3: runtime.config.s3,
          outboundPolicy: runtime.outboundPolicy
        });
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
