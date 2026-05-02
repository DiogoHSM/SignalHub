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
import { processTelemetryJob, type TelemetryWriter } from "./telemetry-worker.js";

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

worker.on("completed", (job) => {
  console.info(`Processed telemetry job ${job.id ?? "unknown"} (${job.name})`);
});

worker.on("failed", (job, error) => {
  console.error(`Telemetry job ${job?.id ?? "unknown"} failed`, error);
});

worker.on("error", (error) => {
  console.error("Telemetry worker error", error);
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.info(`Received ${signal}, shutting down telemetry worker`);

  const results = await Promise.allSettled([worker.close(), connection.quit(), db.destroy()]);
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
