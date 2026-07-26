import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { IconName } from "../../components/ui/v2";
import { formatCompact } from "../../components/ui/v2";
import type {
  DeadLetterJobActionResponse,
  DeadLetterJobResponse,
  SystemHealthResponse,
  SystemHealthSampleResponse,
  SystemStatus,
} from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type ServiceTone = "ok" | "warn" | "critical" | "idle";

export type SystemHeaderVM = { statusLabel: string; statusTone: ServiceTone };
export type SystemBannerVM = { tone: "warn" | "critical"; title: string; detail: string };

export type ServiceCardVM = {
  name: string;
  icon: IconName;
  tone: ServiceTone;
  statusLabel: string;
  meta: string;
  spark: number[] | null;
};

export type QueueRowVM = {
  name: string;
  waiting: number;
  active: number;
  completed: string;
  failed: number;
  deadLettered: number;
  tone: ServiceTone;
};
export type RetentionRowVM = { label: string; retentionLabel: string; deleted: number };
export type RetentionVM = { enabled: boolean; subLabel: string; rows: RetentionRowVM[] };
export type BackupsVM = {
  subLabel: string;
  latest: { filename: string; meta: string } | null;
  failure: { meta: string } | null;
  stale: boolean;
};

export type DeadLetterJobVM = {
  id: string;
  queueName: string;
  jobName: string;
  errorMessage: string;
  ageLabel: string;
};

export type DeadLetterJobActionVM = {
  id: string;
  action: "deleted" | "replayed" | "expired";
  actorEmail: string;
  ageLabel: string;
};

export type DeadLetterDetailVM = {
  payload: unknown;
  actions: DeadLetterJobActionVM[];
};

export type DlqVM = {
  status: "loading" | "ok" | "error";
  jobs: DeadLetterJobVM[];
};

export type SystemVM = {
  header: SystemHeaderVM;
  banner: SystemBannerVM | null;
  services: ServiceCardVM[];
  queues: QueueRowVM[];
  retention: RetentionVM;
  backups: BackupsVM;
  dlq: DlqVM;
};

export type MutationResult = { ok: true } | { ok: false; error: string };

export type UseSystemHealthResult = {
  data: SystemVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
  replayDeadLetterJob: (id: string) => Promise<MutationResult>;
  deleteDeadLetterJob: (id: string) => Promise<MutationResult>;
  loadDeadLetterJobDetail: (id: string) => Promise<DeadLetterDetailVM | null>;
};

// ---------------------------------------------------------------------------
// Local helpers (pure, deterministic — never read Date.now())
// ---------------------------------------------------------------------------

function statusToTone(s: SystemStatus): ServiceTone {
  if (s === "healthy") return "ok";
  if (s === "degraded") return "warn";
  return "critical";
}

function relativeTimeFrom(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = nowMs - t;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function formatBytes(value: number | null): string {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function sparkFrom(
  history: SystemHealthSampleResponse[],
  pick: (h: SystemHealthSampleResponse) => number | null,
): number[] | null {
  if (history.length === 0) return null;
  const vals = history.map(pick);
  if (vals.every((v) => v == null)) return null;
  return vals.map((v) => v ?? 0);
}

const SERVICE_DETAIL: Record<string, string> = {
  API: "The API service is unhealthy.",
  Worker: "The worker is not processing jobs.",
  Scheduler: "The scheduler is not running.",
  Postgres: "Postgres is unreachable or slow.",
  Redis: "Redis ping failed — cache and queue backing unavailable.",
};

function buildDeadLetterJobVM(job: DeadLetterJobResponse, nowMs: number): DeadLetterJobVM {
  return {
    id: job.id,
    queueName: job.queueName,
    jobName: job.jobName,
    errorMessage: job.errorMessage,
    ageLabel: relativeTimeFrom(job.createdAt, nowMs),
  };
}

function buildDeadLetterActionVM(action: DeadLetterJobActionResponse, nowMs: number): DeadLetterJobActionVM {
  return {
    id: action.id,
    action: action.action,
    actorEmail: action.actorEmail,
    ageLabel: relativeTimeFrom(action.createdAt, nowMs),
  };
}

const EMPTY_DLQ_VM: DlqVM = { status: "loading", jobs: [] };

// ---------------------------------------------------------------------------
// Pure VM builder
// ---------------------------------------------------------------------------

export function buildSystemVM(
  health: SystemHealthResponse,
  history: SystemHealthSampleResponse[],
  nowMs: number,
  dlq: DlqVM = EMPTY_DLQ_VM,
): SystemVM {
  const { api, worker, scheduler, postgres, redis } = health.services;

  const header: SystemHeaderVM = {
    statusTone: statusToTone(health.status),
    statusLabel: health.status === "healthy" ? "Operational" : health.status === "degraded" ? "Degraded" : "Unhealthy",
  };

  const heartbeatService = (svc: { status: SystemStatus; expected: boolean; role: string | null; lastHeartbeatAt: string | null }, name: string, icon: IconName, spark: number[] | null): ServiceCardVM => {
    const idle = svc.expected === false;
    return {
      name,
      icon,
      tone: idle ? "idle" : statusToTone(svc.status),
      statusLabel: idle ? "not expected" : svc.status,
      meta: `${svc.role ?? "—"} · heartbeat ${svc.lastHeartbeatAt ? relativeTimeFrom(svc.lastHeartbeatAt, nowMs) : "none"}`,
      spark,
    };
  };

  const services: ServiceCardVM[] = [
    { name: "API", icon: "server", tone: statusToTone(api.status), statusLabel: api.status, meta: `uptime ${formatUptime(api.uptimeSeconds)}`, spark: null },
    heartbeatService(worker, "Worker", "cpu", sparkFrom(history, (h) => h.queueActive)),
    heartbeatService(scheduler, "Scheduler", "clock", null),
    { name: "Postgres", icon: "db", tone: statusToTone(postgres.status), statusLabel: postgres.status, meta: `latency ${postgres.latencyMs ?? "—"}ms`, spark: sparkFrom(history, (h) => h.postgresLatencyMs) },
    { name: "Redis", icon: "redis", tone: statusToTone(redis.status), statusLabel: redis.status, meta: `latency ${redis.latencyMs ?? "—"}ms`, spark: sparkFrom(history, (h) => h.redisLatencyMs) },
  ];

  const queues: QueueRowVM[] = Object.entries(health.queues).map(([name, q]) => ({
    name,
    waiting: q.waiting,
    active: q.active,
    completed: formatCompact(q.completed),
    failed: q.failed,
    deadLettered: q.deadLettered,
    tone: q.failed > 0 || q.deadLettered > 0 ? "warn" : "ok",
  }));

  const r = health.retention;
  const lastRunIso = r.lastRun ? (r.lastRun.finishedAt ?? r.lastRun.startedAt) : null;
  const retention: RetentionVM = {
    enabled: r.enabled,
    subLabel: r.enabled ? `every ${r.intervalMinutes}m${lastRunIso ? ` · last run ${relativeTimeFrom(lastRunIso, nowMs)}` : ""}` : "disabled",
    rows: [
      { label: "Events", retentionLabel: `${r.policy.eventsDays}d`, deleted: r.lastRun?.deleted.events ?? 0 },
      { label: "Errors", retentionLabel: `${r.policy.errorsDays}d`, deleted: r.lastRun?.deleted.errors ?? 0 },
      { label: "Traces", retentionLabel: `${r.policy.tracesDays}d`, deleted: r.lastRun?.deleted.traces ?? 0 },
      { label: "Spans", retentionLabel: `${r.policy.spansDays}d`, deleted: r.lastRun?.deleted.spans ?? 0 },
      { label: "LLM calls", retentionLabel: `${r.policy.llmCallsDays}d`, deleted: r.lastRun?.deleted.llmCalls ?? 0 },
      { label: "Breadcrumbs", retentionLabel: `${r.policy.breadcrumbsDays}d`, deleted: r.lastRun?.deleted.breadcrumbs ?? 0 },
      { label: "Dead letters", retentionLabel: `${r.policy.deadLetterJobsDays}d`, deleted: r.lastRun?.deleted.deadLetterJobs ?? 0 },
    ],
  };

  const b = health.backups;
  const backups: BackupsVM = {
    subLabel: `every ${b.intervalHours}h · keep ${b.retentionDays}d · S3 ${b.s3Enabled ? "on" : "off"}`,
    latest: b.latestSuccess
      ? { filename: b.latestSuccess.filename, meta: `${relativeTimeFrom(b.latestSuccess.finishedAt ?? b.latestSuccess.startedAt, nowMs)} · ${formatBytes(b.latestSuccess.sizeBytes)}` }
      : null,
    failure: b.latestFailure
      ? { meta: `${relativeTimeFrom(b.latestFailure.finishedAt ?? b.latestFailure.startedAt, nowMs)} · ${b.latestFailure.errorMessage ?? "backup failed"}` }
      : null,
    stale: b.stale === true,
  };

  // Banner — first matching condition, severity ordered.
  let banner: SystemBannerVM | null = null;
  const critical = services.find((s) => s.tone === "critical");
  const queueUnhealthy = Object.values(health.queues).some((q) => q.status === "unhealthy");
  const queueFailing = queues.find((q) => q.failed > 0 || q.deadLettered > 0);
  const degraded = services.find((s) => s.tone === "warn");
  if (critical) {
    banner = { tone: "critical", title: `${critical.name} unhealthy`, detail: SERVICE_DETAIL[critical.name] ?? `${critical.name} is unhealthy.` };
  } else if (queueUnhealthy || queueFailing) {
    const q = queueFailing ?? queues[0];
    banner = {
      tone: "warn",
      title: q.deadLettered > 0 ? "Dead-letter jobs" : "Queue backlog",
      detail:
        q.deadLettered > 0
          ? `${q.name} queue has ${q.deadLettered} dead-letter job(s) to inspect.`
          : `${q.name} queue has ${q.failed} failed job(s).`,
    };
  } else if (r.lastRun?.status === "failed") {
    banner = { tone: "warn", title: "Retention run failed", detail: r.lastRun.errorMessage ?? "The last retention run failed." };
  } else if (backups.failure || backups.stale) {
    banner = { tone: "warn", title: "Backups need attention", detail: backups.stale ? "No recent successful backup." : (b.latestFailure?.errorMessage ?? "The last backup failed.") };
  } else if (degraded) {
    banner = { tone: "warn", title: `${degraded.name} degraded`, detail: `${degraded.name} is reporting degraded performance.` };
  }

  return { header, banner, services, queues, retention, backups, dlq };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type UseSystemHealthArgs = {
  client: {
    getSystemHealth: ApiClient["getSystemHealth"];
    getSystemHealthHistory: ApiClient["getSystemHealthHistory"];
    listDeadLetterJobs?: ApiClient["listDeadLetterJobs"];
    getDeadLetterJob?: ApiClient["getDeadLetterJob"];
    listDeadLetterJobActions?: ApiClient["listDeadLetterJobActions"];
    replayDeadLetterJob?: ApiClient["replayDeadLetterJob"];
    deleteDeadLetterJob?: ApiClient["deleteDeadLetterJob"];
  };
};

export function useSystemHealth({ client }: UseSystemHealthArgs): UseSystemHealthResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [history, setHistory] = useState<SystemHealthSampleResponse[]>([]);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const [dlqStatus, setDlqStatus] = useState<"loading" | "ok" | "error">("loading");
  const [dlqJobs, setDlqJobs] = useState<DeadLetterJobVM[]>([]);
  const dlqGenRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // Health + history — drives the top-level status/data of the screen.
  useEffect(() => {
    const gen = ++genRef.current;
    setStatus("loading");

    Promise.all([client.getSystemHealth(), client.getSystemHealthHistory({ limit: 48 })])
      .then(([healthRes, historyRes]) => {
        if (gen !== genRef.current) return;
        setHealth(healthRes.data);
        setHistory(historyRes.data);
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setHealth(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // Dead-letter job list — fetched independently so a failure here never
  // takes down the rest of the screen (fan-out tolerant).
  useEffect(() => {
    const gen = ++dlqGenRef.current;

    if (!client.listDeadLetterJobs) {
      setDlqStatus("ok");
      setDlqJobs([]);
      return;
    }

    setDlqStatus("loading");
    client
      .listDeadLetterJobs({ limit: 50 })
      .then((res) => {
        if (gen !== dlqGenRef.current) return;
        setDlqJobs(res.deadLetterJobs.map((job) => buildDeadLetterJobVM(job, Date.now())));
        setDlqStatus("ok");
      })
      .catch((err) => {
        if (gen !== dlqGenRef.current) return;
        console.error(err);
        setDlqJobs([]);
        setDlqStatus("error");
      });

    return () => {
      ++dlqGenRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const data = useMemo(() => {
    if (!health) return null;
    return buildSystemVM(health, history, Date.now(), { status: dlqStatus, jobs: dlqJobs });
  }, [health, history, dlqStatus, dlqJobs]);

  const replayDeadLetterJob = useCallback(
    async (id: string): Promise<MutationResult> => {
      if (!client.replayDeadLetterJob) {
        return { ok: false, error: "Replay is not available in this deployment." };
      }
      try {
        await client.replayDeadLetterJob(id);
        reload();
        return { ok: true };
      } catch (err) {
        console.error(err);
        return { ok: false, error: "Failed to replay the dead-letter job." };
      }
    },
    [client, reload],
  );

  const deleteDeadLetterJob = useCallback(
    async (id: string): Promise<MutationResult> => {
      if (!client.deleteDeadLetterJob) {
        return { ok: false, error: "Delete is not available in this deployment." };
      }
      try {
        await client.deleteDeadLetterJob(id);
        reload();
        return { ok: true };
      } catch (err) {
        console.error(err);
        return { ok: false, error: "Failed to delete the dead-letter job." };
      }
    },
    [client, reload],
  );

  const loadDeadLetterJobDetail = useCallback(
    async (id: string): Promise<DeadLetterDetailVM | null> => {
      if (!client.getDeadLetterJob) return null;

      const [jobResult, actionsResult] = await Promise.allSettled([
        client.getDeadLetterJob(id),
        client.listDeadLetterJobActions ? client.listDeadLetterJobActions(id) : Promise.resolve({ actions: [] }),
      ]);

      if (jobResult.status !== "fulfilled") {
        console.error(jobResult.reason);
        return null;
      }

      const actions =
        actionsResult.status === "fulfilled"
          ? actionsResult.value.actions.map((a) => buildDeadLetterActionVM(a, Date.now()))
          : [];

      return { payload: jobResult.value.deadLetterJob.payload, actions };
    },
    [client],
  );

  return { data, status, reload, replayDeadLetterJob, deleteDeadLetterJob, loadDeadLetterJobDetail };
}
