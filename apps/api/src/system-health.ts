import type { SystemHealthSnapshot, SystemQueueCounts, SystemStatus } from "./routes/system.js";

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
};
type RetentionRun = {
  id: string;
  status: "success" | "failed";
  startedAt: Date;
  finishedAt: Date | null;
  deleted: RetentionDeletedCounts;
  errorMessage: string | null;
};

export type SystemHealthProbeDependencies = {
  retention: {
    enabled: boolean;
    intervalMinutes: number;
    policy: RetentionPolicy;
  };
  uptimeSeconds?: () => number;
  now?: () => Date;
  postgresPing: () => Promise<unknown>;
  redisPing: () => Promise<string>;
  getQueueCounts: () => Promise<Partial<SystemQueueCounts>>;
  getHeartbeat: () => Promise<{ lastHeartbeatAt: Date } | null>;
  getIngestionFreshness: () => Promise<IngestionFreshness>;
  getLastRetentionRun: () => Promise<RetentionRun | null>;
};

type TimedProbe<T> = { ok: true; value: T; latencyMs: number } | { ok: false; latencyMs: null };
type Probe<T> = { ok: true; value: T } | { ok: false };

const emptyQueueCounts: SystemQueueCounts = {
  waiting: 0,
  active: 0,
  completed: 0,
  failed: 0,
  delayed: 0
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

function queueCountsOrFallback(
  result: Probe<Partial<SystemQueueCounts>>
): SystemHealthSnapshot["queues"]["telemetry"] {
  if (!result.ok) {
    return { status: "unhealthy", errorMessage: "Queue counts unavailable", ...emptyQueueCounts };
  }

  return {
    status: "healthy",
    errorMessage: null,
    waiting: result.value.waiting ?? 0,
    active: result.value.active ?? 0,
    completed: result.value.completed ?? 0,
    failed: result.value.failed ?? 0,
    delayed: result.value.delayed ?? 0
  };
}

export async function createSystemHealthSnapshot(
  dependencies: SystemHealthProbeDependencies
): Promise<SystemHealthSnapshot> {
  const generatedAt = dependencies.now?.() ?? new Date();
  const [postgres, redisReady, queueCounts, heartbeat, freshness, retentionRun] = await Promise.all([
    measure(dependencies.postgresPing),
    measure(dependencies.redisPing),
    probe(dependencies.getQueueCounts),
    probe(dependencies.getHeartbeat),
    probe(dependencies.getIngestionFreshness),
    probe(dependencies.getLastRetentionRun)
  ]);

  const dbProbeFailed = !heartbeat.ok || !freshness.ok || !retentionRun.ok;
  const heartbeatValue = heartbeat.ok ? heartbeat.value : null;
  const freshnessValue = freshness.ok ? freshness.value : emptyIngestionFreshness;
  const retentionRunValue = retentionRun.ok ? retentionRun.value : null;
  const workerStale =
    !heartbeatValue?.lastHeartbeatAt || generatedAt.getTime() - heartbeatValue.lastHeartbeatAt.getTime() > 150_000;
  const queueUnavailable = !queueCounts.ok;
  const postgresStatus: SystemStatus = !postgres.ok ? "unhealthy" : dbProbeFailed ? "degraded" : "healthy";
  const redisStatus: SystemStatus = redisReady.ok && redisReady.value === "PONG" ? "healthy" : "unhealthy";
  const workerStatus: SystemStatus = workerStale ? "degraded" : "healthy";
  const retentionFailed = retentionRunValue?.status === "failed";
  const status: SystemStatus =
    postgresStatus === "unhealthy" || redisStatus === "unhealthy" || queueUnavailable
      ? "unhealthy"
      : postgresStatus === "degraded" || workerStatus === "degraded" || retentionFailed
        ? "degraded"
        : "healthy";

  return {
    generatedAt: generatedAt.toISOString(),
    status,
    services: {
      api: { status: "healthy", uptimeSeconds: dependencies.uptimeSeconds?.() ?? Math.floor(process.uptime()) },
      postgres: { status: postgresStatus, latencyMs: postgres.latencyMs },
      redis: { status: redisStatus, latencyMs: redisReady.latencyMs },
      worker: { status: workerStatus, lastHeartbeatAt: isoOrNull(heartbeatValue?.lastHeartbeatAt) }
    },
    queues: {
      telemetry: queueCountsOrFallback(queueCounts)
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
            deleted: retentionRunValue.deleted,
            errorMessage: retentionRunValue.errorMessage
          }
        : null,
      policy: dependencies.retention.policy
    }
  };
}
