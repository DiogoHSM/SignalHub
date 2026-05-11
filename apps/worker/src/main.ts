import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadConfig } from "@signal-hub/config";
import { createDb } from "@signal-hub/db";
import type { TelemetryJobPayload } from "@signal-hub/queues";
import { recordBackupRun, withBackupLock } from "@signal-hub/db/repositories/backups.js";
import { backfillErrorGroups } from "@signal-hub/db/repositories/error-groups.js";
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
  upsertHeartbeat,
  withRetentionLock
} from "@signal-hub/db/repositories/system.js";
import {
  evaluateAlertRule,
  getNotificationChannel,
  listActiveAlertRules,
  recordAlertEvent,
  recordNotificationDelivery,
  updateAlertRuleEvaluation,
  withAlertEvaluationLock
} from "@signal-hub/db/repositories/alerts.js";
import { deliverWebhook, runAlertEvaluationOnce, startAlertScheduler } from "./alerts.js";
import { runBackupOnce, startBackupScheduler } from "./backups.js";
import { startHeartbeat } from "./heartbeat.js";
import {
  backfillErrorGroupsUntilDrained,
  buildDeadLetterJobInput,
  processTelemetryJob,
  type TelemetryWriter
} from "./telemetry-worker.js";
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

void backfillErrorGroupsUntilDrained((input) => backfillErrorGroups(db, input), 500).catch((error) => {
  console.error("Error group backfill failed", error);
});

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
          withLock: (run) =>
            withRetentionLock(db, (lockedDb) =>
              run({
                deleteExpiredTelemetry: () =>
                  deleteExpiredTelemetry(lockedDb, {
                    now: new Date(),
                    batchSize: config.retention.batchSize,
                    ...retentionPolicy
                  })
              })
            ),
          recordRetentionRun: (input) => recordRetentionRun(db, input)
        })
    })
  : async () => {};

const stopAlerts = config.alerts.enabled
  ? startAlertScheduler({
      intervalMinutes: config.alerts.intervalMinutes,
      runOnce: () =>
        runAlertEvaluationOnce({
          now: () => new Date(),
          withLock: (run) => withAlertEvaluationLock(db, run),
          listActiveRules: () => listActiveAlertRules(db),
          getNotificationChannel: (id) => getNotificationChannel(db, id),
          evaluateRule: (rule, windowStart, windowEnd) =>
            evaluateAlertRule(db, {
              projectId: rule.projectId,
              environmentId: rule.environmentId,
              type: rule.type,
              windowStart,
              windowEnd
            }),
          recordAlertEvent: (input) => recordAlertEvent(db, input),
          updateRuleEvaluation: (input) => updateAlertRuleEvaluation(db, input),
          deliver: (channel, payload) =>
            deliverWebhook({
              channel,
              payload,
              timeoutMs: config.alerts.webhookTimeoutMs,
              nodeEnv: config.nodeEnv
            }),
          recordDelivery: (input) => recordNotificationDelivery(db, input)
        })
    })
  : async () => {};

const backupConfig = {
  enabled: config.backups.enabled,
  intervalHours: config.backups.intervalHours,
  localDir: config.backups.localDir,
  retentionDays: config.backups.retentionDays,
  databaseUrl: config.databaseUrl,
  s3: config.backups.s3
};

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

  const stopResults = await Promise.allSettled([
    stopBackups(),
    stopAlerts(),
    stopRetention(),
    stopHeartbeat(),
    worker.close()
  ]);
  const resourceResults = await Promise.allSettled([connection.quit(), db.destroy()]);
  const results = [...stopResults, ...resourceResults];
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
