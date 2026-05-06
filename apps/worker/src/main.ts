import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadConfig } from "@signal-hub/config";
import { createDb } from "@signal-hub/db";
import type { TelemetryJobPayload } from "@signal-hub/queues";
import {
  insertError,
  insertEvent,
  insertLlmCall,
  insertSpan,
  insertTrace
} from "@signal-hub/db/repositories/telemetry-writes.js";
import { insertDeadLetterJob } from "@signal-hub/db/repositories/dead-letter.js";
import {
  deleteExpiredTelemetry,
  recordRetentionRun,
  releaseRetentionLock,
  tryAcquireRetentionLock,
  upsertHeartbeat
} from "@signal-hub/db/repositories/system.js";
import { startHeartbeat } from "./heartbeat.js";
import { buildDeadLetterJobInput, processTelemetryJob, type TelemetryWriter } from "./telemetry-worker.js";
import { runRetentionOnce, startRetentionScheduler } from "./retention.js";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const connection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null
});

const writer: TelemetryWriter = {
  insertEvent: (input) => insertEvent(db, input),
  insertError: (input) => insertError(db, input),
  insertLlmCall: (input) => insertLlmCall(db, input),
  insertTrace: (input) => insertTrace(db, input),
  insertSpan: (input) => insertSpan(db, input)
};

const worker = new Worker<TelemetryJobPayload, void, TelemetryJobPayload["kind"]>(
  "telemetry",
  async (job) => {
    await processTelemetryJob(job.data, writer);
  },
  { connection }
);

const stopHeartbeat = startHeartbeat({
  beat: () => upsertHeartbeat(db, { component: "worker", heartbeatAt: new Date() })
});

const retentionPolicy = {
  eventsDays: config.retention.eventsDays,
  errorsDays: config.retention.errorsDays,
  tracesDays: config.retention.tracesDays,
  spansDays: config.retention.spansDays,
  llmCallsDays: config.retention.llmCallsDays
};

const stopRetention = config.retention.enabled
  ? startRetentionScheduler({
      intervalMinutes: config.retention.intervalMinutes,
      runOnce: () =>
        runRetentionOnce({
          now: () => new Date(),
          policy: retentionPolicy,
          batchSize: config.retention.batchSize,
          tryAcquireLock: () => tryAcquireRetentionLock(db),
          releaseLock: () => releaseRetentionLock(db),
          deleteExpiredTelemetry: () =>
            deleteExpiredTelemetry(db, {
              now: new Date(),
              batchSize: config.retention.batchSize,
              ...retentionPolicy
            }),
          recordRetentionRun: (input) => recordRetentionRun(db, input)
        })
    })
  : () => {};

worker.on("completed", (job) => {
  console.info(`Processed telemetry job ${job.id ?? "unknown"} (${job.name})`);
});

worker.on("failed", (job, error) => {
  console.error(`Telemetry job ${job?.id ?? "unknown"} failed`, error);
  if (!job) {
    return;
  }

  const configuredAttempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  if (job.attemptsMade < configuredAttempts) {
    return;
  }

  void insertDeadLetterJob(
    db,
    buildDeadLetterJobInput({
      queueName: job.queueName,
      jobName: job.name,
      payload: job.data,
      error
    })
  ).catch((deadLetterError: unknown) => {
    console.error(`Failed to record dead-letter job ${job.id ?? "unknown"}`, deadLetterError);
  });
});

worker.on("error", (error) => {
  console.error("Telemetry worker error", error);
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.info(`Received ${signal}, shutting down telemetry worker`);
  stopRetention();
  stopHeartbeat();

  const results = [await Promise.allSettled([worker.close()]), await Promise.allSettled([connection.quit(), db.destroy()])].flat();
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Telemetry worker shutdown step failed", result.reason);
    }
  }
}

process.once("SIGINT", (signal) => {
  void shutdown(signal).finally(() => process.exit(0));
});

process.once("SIGTERM", (signal) => {
  void shutdown(signal).finally(() => process.exit(0));
});
