import { Queue } from "bullmq";
import type { RedisOptions } from "ioredis";

export type TelemetryJobKind = "event" | "error" | "llm" | "trace" | "span";

export type TelemetryJobPayload = {
  kind: TelemetryJobKind;
  id: string;
  projectId: string;
  environmentId: string;
  payload: Record<string, unknown>;
};

export type TelemetryQueue = Queue<TelemetryJobPayload, unknown, TelemetryJobKind>;

export function createTelemetryQueue(redisUrl: string): TelemetryQueue {
  const connection: RedisOptions & { url: string } = {
    url: redisUrl,
    maxRetriesPerRequest: null
  };

  return new Queue<TelemetryJobPayload, unknown, TelemetryJobKind>("telemetry", {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 1000
      },
      removeOnComplete: 1000,
      removeOnFail: false
    }
  });
}

export async function enqueueTelemetryJob(queue: TelemetryQueue, payload: TelemetryJobPayload) {
  return queue.add(payload.kind, payload);
}
