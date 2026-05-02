import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";

export type TelemetryJobKind = "event" | "error" | "llm" | "trace" | "span";

export type TelemetryJobPayload = {
  kind: TelemetryJobKind;
  id: string;
  projectId: string;
  environmentId: string;
  payload: Record<string, unknown>;
};

export function createTelemetryQueue(redisUrl: string): Queue<TelemetryJobPayload> {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  return new Queue<TelemetryJobPayload>("telemetry", {
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

export async function enqueueTelemetryJob(queue: Queue<TelemetryJobPayload>, payload: TelemetryJobPayload) {
  return queue.add(payload.kind, payload);
}
