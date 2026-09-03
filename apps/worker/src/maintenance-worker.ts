import { Worker, type Job } from "bullmq";
import { Redis, type RedisOptions } from "ioredis";
import {
  maintenanceQueueName,
  type MaintenanceJob,
  type MaintenanceJobKind
} from "@sigmon/queues";
import type { BackupTrigger } from "./backups.js";

type MaintenanceRunResult = { ran: boolean; skipped: boolean };

export type MaintenanceWorkerDependencies = {
  runBackupOnce: (input: { trigger: BackupTrigger; throwOnFailure: boolean }) => Promise<MaintenanceRunResult>;
};

type MaintenanceProcessor = (job: Pick<Job<MaintenanceJob, void, MaintenanceJobKind>, "data" | "name">) => Promise<void>;
type MaintenanceConnection = Redis;
type MaintenanceWorker = Pick<Worker<MaintenanceJob, void, MaintenanceJobKind>, "close"> & {
  on?: (event: "error", listener: (error: Error) => void) => unknown;
};

type CreateConnection = (redisUrl: string, options: RedisOptions) => MaintenanceConnection;
type CreateWorker = (
  name: string,
  processor: MaintenanceProcessor,
  options: { connection: MaintenanceConnection; concurrency: number }
) => MaintenanceWorker;

export type MaintenanceWorkerRuntime = {
  close: () => Promise<void>;
};

function isCanonicalIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isMaintenanceJob(value: unknown): value is MaintenanceJob {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join("|") !== "kind|requestedAt|requestedBy") return false;

  return (
    record.kind === "backup.create" &&
    typeof record.requestedBy === "string" &&
    record.requestedBy.length > 0 &&
    record.requestedBy === record.requestedBy.trim() &&
    isCanonicalIsoInstant(record.requestedAt)
  );
}

export async function handleMaintenanceJob(
  data: unknown,
  dependencies: MaintenanceWorkerDependencies
): Promise<void> {
  if (!isMaintenanceJob(data)) {
    throw new Error("invalid_maintenance_job");
  }

  try {
    await dependencies.runBackupOnce({ trigger: "manual", throwOnFailure: true });
  } catch {
    throw new Error("backup_failed");
  }
}

export function handleMaintenanceQueueJob(
  job: { name: string; data: unknown },
  dependencies: MaintenanceWorkerDependencies
): Promise<void> {
  if (job.name !== "backup.create") {
    return Promise.reject(new Error("invalid_maintenance_job"));
  }
  return handleMaintenanceJob(job.data, dependencies);
}

export function createMaintenanceWorkerForRole(input: {
  role: "all" | "queue" | "scheduler";
  redisUrl: string;
  backupsEnabled: boolean;
  runBackupOnce: MaintenanceWorkerDependencies["runBackupOnce"];
  onError?: (error: Error) => void;
  createConnection?: CreateConnection;
  createWorker?: CreateWorker;
}): MaintenanceWorkerRuntime | null {
  if (input.role === "queue") return null;

  const createConnection = input.createConnection ?? ((redisUrl, options) => new Redis(redisUrl, options));
  const createWorker =
    input.createWorker ??
    ((name, processor, options) =>
      new Worker<MaintenanceJob, void, MaintenanceJobKind>(name, processor, {
        connection: options.connection,
        concurrency: options.concurrency
      }));
  const connection = createConnection(input.redisUrl, { maxRetriesPerRequest: null });
  const worker = createWorker(
    maintenanceQueueName,
    (job) => handleMaintenanceQueueJob(job, { runBackupOnce: input.runBackupOnce }),
    { connection, concurrency: 1 }
  );
  worker.on?.("error", input.onError ?? (() => undefined));

  return {
    close: async () => {
      try {
        await worker.close();
      } finally {
        await connection.quit();
      }
    }
  };
}
