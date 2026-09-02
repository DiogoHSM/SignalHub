import { Queue } from "bullmq";
import type { RedisOptions } from "ioredis";

export const maintenanceQueueName = "sigmon-maintenance";

export type MaintenanceJobKind = "backup.create";

export type MaintenanceJob = {
  kind: MaintenanceJobKind;
  requestedBy: string;
  requestedAt: string;
};

export type MaintenanceQueue = Queue<MaintenanceJob, void, MaintenanceJobKind>;

function producerConnection(redisUrl: string): RedisOptions & { url: string } {
  return {
    url: redisUrl,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1_000,
    retryStrategy: (attempt) => Math.min(attempt * 100, 1_000)
  };
}

export function createMaintenanceQueue(redisUrl: string): MaintenanceQueue {
  return new Queue<MaintenanceJob, void, MaintenanceJobKind>(maintenanceQueueName, {
    connection: producerConnection(redisUrl),
    skipVersionCheck: true,
    skipWaitingForReady: true,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1_000
      },
      removeOnComplete: 1_000,
      removeOnFail: 5_000
    }
  });
}

export function createBackupCreationJobId(requestedAt: string): string {
  const instant = new Date(requestedAt);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error("invalid_maintenance_job");
  }

  const minute = instant.toISOString().slice(0, 16).replaceAll("-", "").replace(":", "");
  return `backup-create-${minute}Z`;
}

async function waitForProducerReady(queue: MaintenanceQueue, timeoutMs = 1_000): Promise<void> {
  const client = await queue.client;
  if (client.status === "ready") return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      client.off("ready", onReady);
      client.off("end", onEnd);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("maintenance_queue_unavailable"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("maintenance_queue_unavailable"));
    }, timeoutMs);
    timer.unref?.();
    client.once("ready", onReady);
    client.once("end", onEnd);

    if (client.status === "ready") onReady();
  });
}

export async function enqueueBackupCreation(queue: MaintenanceQueue, payload: MaintenanceJob) {
  await waitForProducerReady(queue);
  return queue.add(payload.kind, payload, { jobId: createBackupCreationJobId(payload.requestedAt) });
}
