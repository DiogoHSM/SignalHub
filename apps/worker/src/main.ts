import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { createStructuredLogger, loadConfig } from "@sigmon/config";
import { createDb } from "@sigmon/db";
import type { TelemetryJobPayload } from "@sigmon/queues";
import { recordBackupRun, withBackupLock } from "@sigmon/db/repositories/backups.js";
import { backfillErrorGroups } from "@sigmon/db/repositories/error-groups.js";
import {
  insertBreadcrumb,
  insertError,
  insertEvent,
  insertLlmCall,
  insertSpan,
  insertTrace
} from "@sigmon/db/repositories/telemetry-writes.js";
import { insertDeadLetterJob } from "@sigmon/db/repositories/dead-letter.js";
import {
  deleteExpiredTelemetry,
  recordRetentionRun,
  upsertHeartbeat,
  withRetentionLock
} from "@sigmon/db/repositories/system.js";
import {
  listExpiredSourceMapArtifacts,
  softDeleteSourceMapArtifactForRetention
} from "@sigmon/db/repositories/source-maps.js";
import {
  evaluateAlertRule,
  getNotificationChannel,
  listActiveAlertRules,
  recordAlertEvent,
  recordNotificationDelivery,
  updateAlertRuleEvaluation,
  withAlertEvaluationLock
} from "@sigmon/db/repositories/alerts.js";
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
import { deleteExpiredSourceMapArtifacts } from "./source-map-retention.js";
import { runShutdownSteps, runSignalShutdown } from "./runtime.js";

const logger = createStructuredLogger("worker");
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
  insertSpan: (input) => insertSpan(db, input),
  insertBreadcrumb: (input) => insertBreadcrumb(db, input)
};

const worker = new Worker<TelemetryJobPayload, void, TelemetryJobPayload["kind"]>(
  "telemetry",
  async (job) => {
    await processTelemetryJob(job.data, writer);
  },
  { connection }
);

void backfillErrorGroupsUntilDrained((input) => backfillErrorGroups(db, input), 500).catch((error) => {
  logger.error({ error }, "Error group backfill failed");
});

const stopHeartbeat = startHeartbeat({
  beat: () => upsertHeartbeat(db, { component: "worker", heartbeatAt: new Date() })
});

const retentionPolicy = {
  eventsDays: config.retention.eventsDays,
  errorsDays: config.retention.errorsDays,
  tracesDays: config.retention.tracesDays,
  spansDays: config.retention.spansDays,
  llmCallsDays: config.retention.llmCallsDays,
  breadcrumbsDays: config.retention.breadcrumbsDays,
  sourceMapsEnabled: config.sourceMaps.retention.enabled,
  sourceMapsDays: config.sourceMaps.retention.days,
  sourceMapsBatchSize: config.sourceMaps.retention.batchSize
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
          deleteExpiredSourceMapArtifacts: () =>
            deleteExpiredSourceMapArtifacts({
              localDir: config.sourceMaps.localDir,
              now: new Date(),
              retentionDays: config.sourceMaps.retention.days,
              batchSize: config.sourceMaps.retention.batchSize,
              listExpiredArtifacts: (input) => listExpiredSourceMapArtifacts(db, input),
              softDeleteArtifact: (id) => softDeleteSourceMapArtifactForRetention(db, id)
            }),
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
          deliver: (channel, payload) => {
            if (channel.type !== "webhook") {
              return Promise.resolve({
                status: "failed",
                responseStatus: null,
                errorMessage: "Email delivery is not configured"
              });
            }

            return deliverWebhook({
              channel,
              payload,
              timeoutMs: config.alerts.webhookTimeoutMs,
              nodeEnv: config.nodeEnv
            });
          },
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

logger.info({ queueName: "telemetry" }, "Telemetry worker started");

worker.on("completed", (job) => {
  logger.info({ jobId: job.id ?? "unknown", jobName: job.name }, "Processed telemetry job");
});

worker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id ?? "unknown", jobName: job?.name, error }, "Telemetry job failed");
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
    logger.error(
      { jobId: job.id ?? "unknown", jobName: job.name, error: deadLetterError },
      "Failed to record dead-letter job"
    );
  });
});

worker.on("error", (error) => {
  logger.error({ error }, "Telemetry worker error");
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, "Telemetry worker shutting down");

  await runShutdownSteps(
    [
      { name: "stopBackups", run: () => stopBackups() },
      { name: "stopAlerts", run: () => stopAlerts() },
      { name: "stopRetention", run: () => stopRetention() },
      { name: "stopHeartbeat", run: () => stopHeartbeat() },
      { name: "worker.close", run: () => worker.close() },
      { name: "connection.quit", run: () => connection.quit() },
      { name: "db.destroy", run: () => db.destroy() }
    ],
    10_000,
    logger
  );
}

process.once("SIGINT", (signal) => {
  void runSignalShutdown({
    shutdown: () => shutdown(signal),
    logger,
    failureMessage: "Telemetry worker shutdown failed"
  });
});

process.once("SIGTERM", (signal) => {
  void runSignalShutdown({
    shutdown: () => shutdown(signal),
    logger,
    failureMessage: "Telemetry worker shutdown failed"
  });
});
