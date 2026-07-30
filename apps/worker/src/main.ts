import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { sql } from "kysely";
import { createStructuredLogger, loadConfig } from "@sigmon/config";
import { createDb } from "@sigmon/db";
import { createTelemetryQueue } from "@sigmon/queues";
import type { TelemetryJobPayload } from "@sigmon/queues";
import { recordBackupRun, withBackupLock } from "@sigmon/db/repositories/backups.js";
import { backfillErrorGroups } from "@sigmon/db/repositories/error-groups.js";
import {
  insertBreadcrumb,
  insertClickEvent,
  insertError,
  insertEvent,
  insertLlmCall,
  insertProfile,
  insertSessionReplay,
  insertSpan,
  insertTrace,
  insertWebVital
} from "@sigmon/db/repositories/telemetry-writes.js";
import { getDataGovernancePolicy } from "@sigmon/db/repositories/data-governance.js";
import { deleteExpiredDeadLetterJobs, insertDeadLetterJob } from "@sigmon/db/repositories/dead-letter.js";
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
  isErrorGroupSilenced,
  listAlertEscalationsDue,
  listActiveAlertRules,
  markAlertEventEscalated,
  recordAlertEvent,
  recordNotificationDelivery,
  updateAlertRuleEvaluation,
  withAlertEvaluationLock
} from "@sigmon/db/repositories/alerts.js";
import {
  listDueHttpMonitors,
  listStaleHeartbeatMonitors,
  recordMonitorAlertEvent,
  recordMonitorCheck,
  withMonitorEvaluationLock
} from "@sigmon/db/repositories/monitors.js";
import {
  listActiveWarehouseDestinations,
  recordWarehouseExportRun,
  selectWarehouseExportBatch,
  updateWarehouseDestinationCursor,
  withWarehouseExportLock
} from "@sigmon/db/repositories/warehouse-exports.js";
import {
  getEventRollupWatermark,
  runEventHourlyRollupBackfill,
  setEventRollupWatermark,
  upsertEventActorDaily,
  withEventRollupLock,
  EVENT_ACTOR_DAILY_ROLLUP
} from "@sigmon/db/repositories/event-rollups.js";
import { deliverNotification, runAlertEvaluationOnce, startAlertScheduler } from "./alerts.js";
import { runBackupOnce, startBackupScheduler } from "./backups.js";
import { startHeartbeat } from "./heartbeat.js";
import {
  checkHttpMonitor,
  runMonitorEvaluationOnce,
  startMonitorScheduler,
  type MonitorCheckResult
} from "./monitors.js";
import {
  backfillErrorGroupsUntilDrained,
  buildDeadLetterJobInput,
  processTelemetryJob,
  type TelemetryWriter
} from "./telemetry-worker.js";
import { runRetentionOnce, startRetentionScheduler } from "./retention.js";
import { runEventRollupOnce, startEventRollupScheduler } from "./event-rollups.js";
import { deleteExpiredSourceMapArtifacts } from "./source-map-retention.js";
import { runShutdownSteps, runSignalShutdown } from "./runtime.js";
import {
  pruneSystemHealthSamples,
  recordSystemHealthSample
} from "@sigmon/db/repositories/system-health-samples.js";
import { collectHealthSample, runHealthSampleOnce, startHealthSampleScheduler } from "./system-health-samples.js";
import {
  runWarehouseExportOnce,
  startWarehouseExportScheduler,
  writePostgresWarehouseBatch
} from "./warehouse-exports.js";
import { recordSurveyResponse } from "@sigmon/db/repositories/surveys.js";
import { recordFeedbackItem } from "@sigmon/db/repositories/feedback-widget.js";

const logger = createStructuredLogger("worker");
const config = loadConfig();
// PER-449: the worker runs long-lived jobs (rollups, retention, backups, source-map cleanup) that
// can legitimately exceed the timeout applied to the API's read pool, so it defaults to disabled
// (DB_WORKER_STATEMENT_TIMEOUT_MS=0) and is opt-in via its own env var.
const db = createDb(config.databaseUrl, { statementTimeoutMs: config.db.workerStatementTimeoutMs });
const runsQueue = config.worker.role === "all" || config.worker.role === "queue";
const runsScheduler = config.worker.role === "all" || config.worker.role === "scheduler";
const connection = runsQueue
  ? new Redis(config.redisUrl, {
      maxRetriesPerRequest: null
    })
  : null;

const writer: TelemetryWriter = {
  getDataGovernancePolicy: (input) => getDataGovernancePolicy(db, input),
  insertEvent: (input) => insertEvent(db, input),
  insertError: (input) => insertError(db, input),
  insertLlmCall: (input) => insertLlmCall(db, input),
  insertTrace: (input) => insertTrace(db, input),
  insertSpan: (input) => insertSpan(db, input),
  insertWebVital: (input) => insertWebVital(db, input),
  insertClickEvent: (input) => insertClickEvent(db, input),
  insertSessionReplay: (input) => insertSessionReplay(db, input),
  insertProfile: (input) => insertProfile(db, input),
  insertSurveyResponse: (input) => recordSurveyResponse(db, input).then(() => undefined),
  insertFeedbackItem: (input) => recordFeedbackItem(db, input).then(() => undefined),
  insertBreadcrumb: (input) => insertBreadcrumb(db, input)
};

const worker = connection
  ? new Worker<TelemetryJobPayload, void, TelemetryJobPayload["kind"]>(
      "telemetry",
      async (job) => {
        await processTelemetryJob(job.data, writer);
      },
      { connection }
    )
  : null;

if (runsQueue) {
  void backfillErrorGroupsUntilDrained((input) => backfillErrorGroups(db, input), 500).catch((error) => {
    logger.error({ error }, "Error group backfill failed");
  });
}

const heartbeatMetadata = {
  role: config.worker.role,
  queue: runsQueue,
  scheduler: runsScheduler,
  alerts: runsScheduler && config.alerts.enabled,
  monitors: runsScheduler && config.monitors.enabled,
  warehouseExports: runsScheduler && config.warehouseExports.enabled,
  retention: runsScheduler && config.retention.enabled,
  eventRollups: runsScheduler && config.eventRollups.enabled,
  backups: runsScheduler && config.backups.enabled
};
const stopWorkerHeartbeat = runsQueue
  ? startHeartbeat({
      beat: () =>
        upsertHeartbeat(db, {
          component: "worker",
          heartbeatAt: new Date(),
          metadata: heartbeatMetadata
        })
    })
  : async () => {};
const stopSchedulerHeartbeat = runsScheduler
  ? startHeartbeat({
      beat: () =>
        upsertHeartbeat(db, {
          component: "scheduler",
          heartbeatAt: new Date(),
          metadata: heartbeatMetadata
        })
    })
  : async () => {};

const retentionPolicy = {
  eventsDays: config.retention.eventsDays,
  errorsDays: config.retention.errorsDays,
  tracesDays: config.retention.tracesDays,
  spansDays: config.retention.spansDays,
  llmCallsDays: config.retention.llmCallsDays,
  profilesDays: config.retention.profilesDays,
  breadcrumbsDays: config.retention.breadcrumbsDays,
  deadLetterJobsDays: config.retention.deadLetterJobsDays,
  sourceMapsEnabled: config.sourceMaps.retention.enabled,
  sourceMapsDays: config.sourceMaps.retention.days,
  sourceMapsBatchSize: config.sourceMaps.retention.batchSize
};

const stopRetention = runsScheduler && config.retention.enabled
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
                  }),
                deleteExpiredDeadLetterJobs: () =>
                  deleteExpiredDeadLetterJobs(lockedDb, {
                    cutoff: new Date(Date.now() - config.retention.deadLetterJobsDays * 24 * 60 * 60 * 1000),
                    batchSize: config.retention.batchSize
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

const stopEventRollups = runsScheduler && config.eventRollups.enabled
  ? startEventRollupScheduler({
      intervalMinutes: config.eventRollups.intervalMinutes,
      runOnce: () =>
        runEventRollupOnce({
          now: () => new Date(),
          lookbackDays: config.eventRollups.lookbackDays,
          maintenanceWindowDays: 2,
          maxDaysPerTick: 60,
          withLock: (run) =>
            withEventRollupLock(db, async () => {
              const dailyResult = await run();
              await runEventHourlyRollupBackfill(db, {
                now: new Date(),
                lookbackHours: config.eventRollups.lookbackDays * 24,
                maxBackfillHoursPerScope: 24
              });
              return dailyResult;
            }),
          readWatermark: () => getEventRollupWatermark(db, { rollup: EVENT_ACTOR_DAILY_ROLLUP }),
          writeWatermark: (watermarkAt) =>
            setEventRollupWatermark(db, { rollup: EVENT_ACTOR_DAILY_ROLLUP, watermarkAt }),
          rollupDay: ({ from, to }) => upsertEventActorDaily(db, { from, to })
        })
    })
  : async () => {};

const stopAlerts = runsScheduler && config.alerts.enabled
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
              windowEnd,
              routePattern: rule.routePattern,
              minimumSampleSize: rule.minimumSampleSize
            }),
          recordAlertEvent: (input) => recordAlertEvent(db, input),
          updateRuleEvaluation: (input) => updateAlertRuleEvaluation(db, input),
          isErrorGroupSilenced: (input) => isErrorGroupSilenced(db, input),
          listEscalationsDue: (input) => listAlertEscalationsDue(db, input),
          markEscalated: (id, escalatedAt) => markAlertEventEscalated(db, id, escalatedAt),
          deliver: (channel, payload) =>
            deliverNotification({
              channel,
              payload,
              smtp: config.smtp,
              timeoutMs: config.alerts.webhookTimeoutMs,
              nodeEnv: config.nodeEnv,
              publicEndpoint: config.console.publicEndpoint
            }),
          recordDelivery: (input) => recordNotificationDelivery(db, input)
        })
    })
  : async () => {};

const stopMonitors = runsScheduler && config.monitors.enabled
  ? startMonitorScheduler({
      intervalMinutes: config.monitors.intervalMinutes,
      runOnce: () =>
        runMonitorEvaluationOnce({
          now: () => new Date(),
          withLock: (run) => withMonitorEvaluationLock(db, run),
          maxConcurrency: config.monitors.maxConcurrency,
          listDueHttpMonitors: () =>
            listDueHttpMonitors(db, { now: new Date(), limit: config.monitors.maxConcurrency }),
          listStaleHeartbeatMonitors: () =>
            listStaleHeartbeatMonitors(db, { now: new Date(), limit: config.monitors.maxConcurrency }),
          checkHttpMonitor: (monitor): Promise<MonitorCheckResult> =>
            checkHttpMonitor({ monitor, timeoutMs: config.monitors.httpTimeoutMs }),
          recordMonitorCheck: (input) => recordMonitorCheck(db, input),
          recordAlertEvent: (input) => recordMonitorAlertEvent(db, input),
          getNotificationChannel: (id) => getNotificationChannel(db, id),
          deliver: (channel, payload) =>
            deliverNotification({
              channel,
              payload,
              smtp: config.smtp,
              timeoutMs: config.alerts.webhookTimeoutMs,
              nodeEnv: config.nodeEnv,
              publicEndpoint: config.console.publicEndpoint
            }),
          recordDelivery: (input) => recordNotificationDelivery(db, input)
        })
    })
  : async () => {};

const stopWarehouseExports = runsScheduler && config.warehouseExports.enabled
  ? startWarehouseExportScheduler({
      intervalMinutes: config.warehouseExports.intervalMinutes,
      runOnce: () =>
        runWarehouseExportOnce({
          now: () => new Date(),
          withLock: (run) => withWarehouseExportLock(db, run),
          listActiveDestinations: () => listActiveWarehouseDestinations(db),
          selectBatch: (destination, input) => selectWarehouseExportBatch(db, destination, input),
          writeBatch: (input) => writePostgresWarehouseBatch(input),
          updateCursor: (input) => updateWarehouseDestinationCursor(db, input),
          recordRun: (input) => recordWarehouseExportRun(db, input)
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

const stopBackups = runsScheduler && config.backups.enabled
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

const healthSampleConnection =
  runsScheduler && config.systemHealthHistory.enabled
    ? new Redis(config.redisUrl, { maxRetriesPerRequest: null })
    : null;
const healthSampleQueue =
  runsScheduler && config.systemHealthHistory.enabled ? createTelemetryQueue(config.redisUrl) : null;

const stopHealthSamples =
  healthSampleConnection && healthSampleQueue
    ? startHealthSampleScheduler({
        intervalMinutes: config.systemHealthHistory.sampleIntervalMinutes,
        runOnce: () =>
          runHealthSampleOnce({
            now: () => new Date(),
            retentionHours: config.systemHealthHistory.retentionHours,
            collect: () =>
              collectHealthSample({
                now: () => new Date(),
                postgresPing: () => sql`select 1`.execute(db),
                redisPing: () => healthSampleConnection.ping(),
                getQueueCounts: () => healthSampleQueue.getJobCounts("waiting", "active", "failed")
              }),
            record: (sample) => recordSystemHealthSample(db, sample),
            prune: (input) => pruneSystemHealthSamples(db, input)
          })
      })
    : async () => {};

logger.info({ role: config.worker.role, queueName: runsQueue ? "telemetry" : null }, "Telemetry worker started");

worker?.on("completed", (job) => {
  logger.info({ jobId: job.id ?? "unknown", jobName: job.name }, "Processed telemetry job");
});

worker?.on("failed", (job, error) => {
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

worker?.on("error", (error) => {
  logger.error({ error }, "Telemetry worker error");
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, "Telemetry worker shutting down");

  await runShutdownSteps(
    [
      { name: "stopHealthSamples", run: () => stopHealthSamples() },
      { name: "stopBackups", run: () => stopBackups() },
      { name: "stopWarehouseExports", run: () => stopWarehouseExports() },
      { name: "stopMonitors", run: () => stopMonitors() },
      { name: "stopAlerts", run: () => stopAlerts() },
      { name: "stopRetention", run: () => stopRetention() },
      { name: "stopEventRollups", run: () => stopEventRollups() },
      { name: "stopSchedulerHeartbeat", run: () => stopSchedulerHeartbeat() },
      { name: "stopWorkerHeartbeat", run: () => stopWorkerHeartbeat() },
      { name: "worker.close", run: () => worker?.close() ?? Promise.resolve() },
      { name: "healthSampleQueue.close", run: () => healthSampleQueue?.close() ?? Promise.resolve() },
      { name: "healthSampleConnection.quit", run: () => healthSampleConnection?.quit() ?? Promise.resolve() },
      { name: "connection.quit", run: () => connection?.quit() ?? Promise.resolve() },
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
