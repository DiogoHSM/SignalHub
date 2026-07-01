import { dirname } from "node:path";
import type {
  BackgroundComponentHealth,
  SystemBackupHealthRun,
  SystemHealthSnapshot,
  SystemQueueCounts,
  SystemStatus
} from "./routes/system.js";

type RetentionPolicy = SystemHealthSnapshot["retention"]["policy"];
type IngestionFreshness = {
  lastEventAt: Date | null;
  lastErrorAt: Date | null;
  lastTraceAt: Date | null;
  lastSpanAt: Date | null;
  lastLlmCallAt: Date | null;
};
type RetentionDeletedCounts = {
  events: number;
  errors: number;
  traces: number;
  spans: number;
  llmCalls: number;
  webVitals: number;
  breadcrumbs: number;
  deadLetterJobs: number;
  sourceMapArtifacts: number;
  sourceMapFiles: number;
};
type RetentionRun = {
  id: string;
  status: "success" | "failed";
  startedAt: Date;
  finishedAt: Date | null;
  deleted: RetentionDeletedCounts;
  errorMessage: string | null;
};
type HeartbeatRecord = {
  lastHeartbeatAt: Date;
  metadata?: unknown;
};

type RuntimeConfigSummary = {
  nodeEnv: string;
  consoleEnabled: boolean;
  publicEndpointConfigured: boolean;
  googleOAuthEnabled: boolean;
  smtpConfigured: boolean;
  alertsEnabled: boolean;
  alertsIntervalMinutes: number;
  monitorsEnabled: boolean;
  monitorsIntervalMinutes: number;
  sourceMapRetentionEnabled: boolean;
};
export type BackupRun = {
  id: string;
  status: "success" | "failed";
  trigger: "scheduled" | "manual";
  startedAt: Date;
  finishedAt: Date | null;
  filename: string;
  localPath: string;
  sizeBytes: number | null;
  s3Bucket: string | null;
  s3Key: string | null;
  errorMessage: string | null;
  createdAt?: Date;
};

export type SystemHealthProbeDependencies = {
  retention: {
    enabled: boolean;
    intervalMinutes: number;
    policy: RetentionPolicy;
  };
  backups: {
    enabled: boolean;
    intervalHours: number;
    retentionDays: number;
    s3Enabled: boolean;
  };
  runtime?: RuntimeConfigSummary;
  uptimeSeconds?: () => number;
  now?: () => Date;
  postgresPing: () => Promise<unknown>;
  redisPing: () => Promise<string>;
  getQueueCounts: () => Promise<Partial<SystemQueueCounts>>;
  getDeadLetterCount?: () => Promise<number>;
  getHeartbeat?: () => Promise<HeartbeatRecord | null>;
  getHeartbeats?: () => Promise<{
    worker: HeartbeatRecord | null;
    scheduler: HeartbeatRecord | null;
  }>;
  getIngestionFreshness: () => Promise<IngestionFreshness>;
  getLastRetentionRun: () => Promise<RetentionRun | null>;
  getBackupStatus: () => Promise<{ latestSuccess: BackupRun | null; latestFailure: BackupRun | null }>;
};

type TimedProbe<T> = { ok: true; value: T; latencyMs: number } | { ok: false; latencyMs: null };
type Probe<T> = { ok: true; value: T } | { ok: false };

const emptyQueueCounts: SystemQueueCounts = {
  waiting: 0,
  active: 0,
  completed: 0,
  failed: 0,
  delayed: 0,
  deadLettered: 0
};

const emptyIngestionFreshness: IngestionFreshness = {
  lastEventAt: null,
  lastErrorAt: null,
  lastTraceAt: null,
  lastSpanAt: null,
  lastLlmCallAt: null
};

async function measure<T>(fn: () => Promise<T>): Promise<TimedProbe<T>> {
  const started = performance.now();
  try {
    const value = await fn();
    return { ok: true, value, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

async function probe<T>(fn: () => Promise<T>): Promise<Probe<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch {
    return { ok: false };
  }
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function metadataRole(metadata: unknown): BackgroundComponentHealth["role"] {
  if (!metadata || typeof metadata !== "object" || !("role" in metadata)) return null;
  const role = (metadata as { role?: unknown }).role;
  return role === "all" || role === "queue" || role === "scheduler" ? role : null;
}

function componentHealth(input: {
  heartbeat: HeartbeatRecord | null;
  expected: boolean;
  now: Date;
}): BackgroundComponentHealth {
  const stale =
    input.expected &&
    (!input.heartbeat?.lastHeartbeatAt || input.now.getTime() - input.heartbeat.lastHeartbeatAt.getTime() > 150_000);

  return {
    status: stale ? "degraded" : "healthy",
    expected: input.expected,
    role: metadataRole(input.heartbeat?.metadata),
    lastHeartbeatAt: isoOrNull(input.heartbeat?.lastHeartbeatAt)
  };
}

function queueCountsOrFallback(
  result: Probe<Partial<SystemQueueCounts>>,
  deadLetterCount: Probe<number>
): SystemHealthSnapshot["queues"]["telemetry"] {
  if (!result.ok) {
    return { status: "unhealthy", errorMessage: "Queue counts unavailable", ...emptyQueueCounts };
  }

  const deadLettered = deadLetterCount.ok ? deadLetterCount.value : 0;
  return {
    status: !deadLetterCount.ok || deadLettered > 0 ? "degraded" : "healthy",
    errorMessage: deadLetterCount.ok ? null : "Dead-letter count unavailable",
    waiting: result.value.waiting ?? 0,
    active: result.value.active ?? 0,
    completed: result.value.completed ?? 0,
    failed: result.value.failed ?? 0,
    delayed: result.value.delayed ?? 0,
    deadLettered
  };
}

function toBackupHealthRun(run: BackupRun | null): SystemBackupHealthRun | null {
  if (!run) return null;

  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt.toISOString(),
    finishedAt: isoOrNull(run.finishedAt),
    filename: run.filename,
    sizeBytes: run.sizeBytes,
    s3Bucket: run.s3Bucket,
    s3Key: run.s3Key,
    errorMessage: redactBackupErrorMessage(run.errorMessage, run.localPath)
  };
}

function toRetentionPolicy(policy: RetentionPolicy): RetentionPolicy {
  return {
    eventsDays: policy.eventsDays,
    errorsDays: policy.errorsDays,
    tracesDays: policy.tracesDays,
    spansDays: policy.spansDays,
    llmCallsDays: policy.llmCallsDays,
    breadcrumbsDays: policy.breadcrumbsDays,
    deadLetterJobsDays: policy.deadLetterJobsDays,
    sourceMapsEnabled: policy.sourceMapsEnabled,
    sourceMapsDays: policy.sourceMapsDays,
    sourceMapsBatchSize: policy.sourceMapsBatchSize
  };
}

function toRetentionDeletedCounts(deleted: RetentionDeletedCounts): RetentionDeletedCounts {
  return {
    events: deleted.events,
    errors: deleted.errors,
    traces: deleted.traces,
    spans: deleted.spans,
    llmCalls: deleted.llmCalls,
    webVitals: deleted.webVitals,
    breadcrumbs: deleted.breadcrumbs,
    deadLetterJobs: deleted.deadLetterJobs,
    sourceMapArtifacts: deleted.sourceMapArtifacts,
    sourceMapFiles: deleted.sourceMapFiles
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactBackupErrorMessage(message: string | null, localPath: string): string | null {
  if (!message) return null;

  const localDir = dirname(localPath);
  return message
    .replace(new RegExp(escapeRegex(localPath), "g"), "[REDACTED_PATH]")
    .replace(new RegExp(escapeRegex(localDir), "g"), "[REDACTED_PATH]");
}

function isBackupStale(input: {
  enabled: boolean;
  intervalHours: number;
  now: Date;
  latestSuccess: BackupRun | null;
}): boolean | null {
  if (!input.enabled) return null;
  if (!input.latestSuccess) return true;

  const latestSuccessAt = input.latestSuccess.finishedAt ?? input.latestSuccess.startedAt;
  return input.now.getTime() - latestSuccessAt.getTime() > input.intervalHours * 2 * 60 * 60 * 1000;
}

function hasNewerBackupFailure(input: {
  enabled: boolean;
  latestSuccess: BackupRun | null;
  latestFailure: BackupRun | null;
}): boolean {
  if (!input.enabled || !input.latestFailure) return false;
  if (!input.latestSuccess) return true;

  return input.latestFailure.startedAt.getTime() > input.latestSuccess.startedAt.getTime();
}

export async function createSystemHealthSnapshot(
  dependencies: SystemHealthProbeDependencies
): Promise<SystemHealthSnapshot> {
  const generatedAt = dependencies.now?.() ?? new Date();
  const schedulerExpected = dependencies.runtime
    ? dependencies.runtime.alertsEnabled ||
      dependencies.runtime.monitorsEnabled ||
      dependencies.retention.enabled ||
      dependencies.backups.enabled
    : false;
  const getHeartbeats =
    dependencies.getHeartbeats ??
    (async () => ({
      worker: (await dependencies.getHeartbeat?.()) ?? null,
      scheduler: null
    }));

  const [postgres, redisReady, queueCounts, deadLetterCount, heartbeats, freshness, retentionRun, backupStatus] = await Promise.all([
    measure(dependencies.postgresPing),
    measure(dependencies.redisPing),
    probe(dependencies.getQueueCounts),
    dependencies.getDeadLetterCount ? probe(dependencies.getDeadLetterCount) : Promise.resolve({ ok: true, value: 0 } as const),
    probe(getHeartbeats),
    probe(dependencies.getIngestionFreshness),
    probe(dependencies.getLastRetentionRun),
    probe(dependencies.getBackupStatus)
  ]);

  const dbProbeFailed = !heartbeats.ok || !freshness.ok || !retentionRun.ok || !backupStatus.ok;
  const heartbeatsValue = heartbeats.ok ? heartbeats.value : { worker: null, scheduler: null };
  const freshnessValue = freshness.ok ? freshness.value : emptyIngestionFreshness;
  const retentionRunValue = retentionRun.ok ? retentionRun.value : null;
  const backupStatusValue = backupStatus.ok ? backupStatus.value : { latestSuccess: null, latestFailure: null };
  const workerHealth = componentHealth({ heartbeat: heartbeatsValue.worker, expected: true, now: generatedAt });
  const schedulerHealth = componentHealth({
    heartbeat: heartbeatsValue.scheduler,
    expected: schedulerExpected,
    now: generatedAt
  });
  const queueUnavailable = !queueCounts.ok;
  const postgresStatus: SystemStatus = !postgres.ok ? "unhealthy" : dbProbeFailed ? "degraded" : "healthy";
  const redisStatus: SystemStatus = redisReady.ok && redisReady.value === "PONG" ? "healthy" : "unhealthy";
  const retentionFailed = retentionRunValue?.status === "failed";
  const backupStale = backupStatus.ok
    ? isBackupStale({
        enabled: dependencies.backups.enabled,
        intervalHours: dependencies.backups.intervalHours,
        now: generatedAt,
        latestSuccess: backupStatusValue.latestSuccess
      })
    : null;
  const backupFailureNewer = hasNewerBackupFailure({
    enabled: dependencies.backups.enabled,
    latestSuccess: backupStatusValue.latestSuccess,
    latestFailure: backupStatusValue.latestFailure
  });
  const deadLettersPresent = deadLetterCount.ok && deadLetterCount.value > 0;
  const deadLetterProbeUnavailable = !deadLetterCount.ok;
  const status: SystemStatus =
    postgresStatus === "unhealthy" || redisStatus === "unhealthy" || queueUnavailable
      ? "unhealthy"
      : postgresStatus === "degraded" ||
          workerHealth.status === "degraded" ||
          schedulerHealth.status === "degraded" ||
          deadLetterProbeUnavailable ||
          deadLettersPresent ||
          retentionFailed ||
          backupStale ||
          backupFailureNewer
        ? "degraded"
        : "healthy";
  const runtime = dependencies.runtime ?? {
    nodeEnv: "unknown",
    consoleEnabled: false,
    publicEndpointConfigured: false,
    googleOAuthEnabled: false,
    smtpConfigured: false,
    alertsEnabled: false,
    alertsIntervalMinutes: 0,
    monitorsEnabled: false,
    monitorsIntervalMinutes: 0,
    sourceMapRetentionEnabled: dependencies.retention.policy.sourceMapsEnabled
  };

  return {
    generatedAt: generatedAt.toISOString(),
    status,
    services: {
      api: { status: "healthy", uptimeSeconds: dependencies.uptimeSeconds?.() ?? Math.floor(process.uptime()) },
      postgres: { status: postgresStatus, latencyMs: postgres.latencyMs },
      redis: { status: redisStatus, latencyMs: redisReady.latencyMs },
      worker: workerHealth,
      scheduler: schedulerHealth
    },
    deployment: {
      api: {
        nodeEnv: runtime.nodeEnv,
        consoleEnabled: runtime.consoleEnabled,
        publicEndpointConfigured: runtime.publicEndpointConfigured,
        googleOAuthEnabled: runtime.googleOAuthEnabled,
        smtpConfigured: runtime.smtpConfigured
      },
      background: {
        queueExpected: true,
        schedulerExpected,
        alertsEnabled: runtime.alertsEnabled,
        alertsIntervalMinutes: runtime.alertsIntervalMinutes,
        monitorsEnabled: runtime.monitorsEnabled,
        monitorsIntervalMinutes: runtime.monitorsIntervalMinutes,
        retentionEnabled: dependencies.retention.enabled,
        retentionIntervalMinutes: dependencies.retention.intervalMinutes,
        backupsEnabled: dependencies.backups.enabled,
        backupsIntervalHours: dependencies.backups.intervalHours
      },
      storage: {
        backupS3Enabled: dependencies.backups.s3Enabled,
        sourceMapRetentionEnabled: runtime.sourceMapRetentionEnabled
      }
    },
    queues: {
      telemetry: queueCountsOrFallback(queueCounts, deadLetterCount)
    },
    ingestion: {
      lastEventAt: isoOrNull(freshnessValue.lastEventAt),
      lastErrorAt: isoOrNull(freshnessValue.lastErrorAt),
      lastTraceAt: isoOrNull(freshnessValue.lastTraceAt),
      lastSpanAt: isoOrNull(freshnessValue.lastSpanAt),
      lastLlmCallAt: isoOrNull(freshnessValue.lastLlmCallAt)
    },
    retention: {
      enabled: dependencies.retention.enabled,
      intervalMinutes: dependencies.retention.intervalMinutes,
      lastRun: retentionRunValue
        ? {
            id: retentionRunValue.id,
            status: retentionRunValue.status,
            startedAt: retentionRunValue.startedAt.toISOString(),
            finishedAt: isoOrNull(retentionRunValue.finishedAt),
            deleted: toRetentionDeletedCounts(retentionRunValue.deleted),
            errorMessage: retentionRunValue.errorMessage
          }
        : null,
      policy: toRetentionPolicy(dependencies.retention.policy)
    },
    backups: {
      enabled: dependencies.backups.enabled,
      intervalHours: dependencies.backups.intervalHours,
      retentionDays: dependencies.backups.retentionDays,
      s3Enabled: dependencies.backups.s3Enabled,
      stale: backupStale,
      latestSuccess: toBackupHealthRun(backupStatusValue.latestSuccess),
      latestFailure: toBackupHealthRun(backupStatusValue.latestFailure)
    }
  };
}
