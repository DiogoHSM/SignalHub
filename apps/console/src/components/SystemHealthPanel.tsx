import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { SystemHealthResponse, SystemStatus } from "../api/types";

type LoadState = "loading" | "ready" | "unavailable";
type ServiceStatus = SystemStatus | "success" | "failed" | "neutral";
type ReadinessTone = "healthy" | "degraded" | "unhealthy" | "neutral";

type Props = {
  client: ApiClient;
};

const queueLabels: Array<[keyof SystemHealthResponse["queues"]["telemetry"], string]> = [
  ["waiting", "Waiting"],
  ["active", "Active"],
  ["completed", "Completed"],
  ["failed", "Failed"],
  ["delayed", "Delayed"]
];

const ingestionLabels: Array<[keyof SystemHealthResponse["ingestion"], string]> = [
  ["lastEventAt", "Events"],
  ["lastErrorAt", "Errors"],
  ["lastTraceAt", "Traces"],
  ["lastSpanAt", "Spans"],
  ["lastLlmCallAt", "LLM calls"]
];

type RetentionPolicyDayKey =
  | "eventsDays"
  | "errorsDays"
  | "tracesDays"
  | "spansDays"
  | "llmCallsDays"
  | "breadcrumbsDays"
  | "sourceMapsDays";

const retentionPolicyLabels: Array<[RetentionPolicyDayKey, string]> = [
  ["eventsDays", "events"],
  ["errorsDays", "errors"],
  ["tracesDays", "traces"],
  ["spansDays", "spans"],
  ["llmCallsDays", "LLM calls"],
  ["breadcrumbsDays", "breadcrumbs"],
  ["sourceMapsDays", "source maps"]
];

type ReadinessItem = {
  key: string;
  label: string;
  detail: string;
  tone: ReadinessTone;
};

type AttentionItem = {
  key: string;
  label: string;
  detail: string;
};

function statusClass(status: ServiceStatus): string {
  return `status-pill status-pill--${status}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "No data";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "No data" : timestamp.toLocaleString();
}

function formatLatency(value: number | null): string {
  return value === null ? "No data" : `${value} ms`;
}

function formatBytes(value: number | null): string {
  return value === null ? "No data" : `${value} bytes`;
}

function formatRole(role: "all" | "queue" | "scheduler" | null): string {
  return role ? `WORKER_ROLE=${role}` : "No role metadata";
}

function enabledLabel(enabled: boolean): string {
  return enabled ? "Enabled" : "Disabled";
}

function configuredLabel(configured: boolean): string {
  return configured ? "Configured" : "Missing";
}

function backupStatusLabel(backups: SystemHealthResponse["backups"]): string {
  if (!backups.enabled) return "Disabled";
  if (backups.stale === null) return "Unknown";
  return "Enabled";
}

function backupStatusClass(backups: SystemHealthResponse["backups"]): string {
  if (backups.enabled && backups.stale !== false) return "status-pill status-pill--degraded";
  return "status-pill status-pill--neutral";
}

function backupStaleLabel(backups: SystemHealthResponse["backups"]): string {
  if (!backups.enabled) return "Not applicable";
  if (backups.stale === null) return "Unknown";
  return backups.stale ? "Yes" : "No";
}

function buildReadinessItems(health: SystemHealthResponse): ReadinessItem[] {
  const queueExpected = health.deployment.background.queueExpected;
  const schedulerExpected = health.deployment.background.schedulerExpected;

  return [
    {
      key: "public-endpoint",
      label: health.deployment.api.publicEndpointConfigured ? "Public endpoint ready" : "Public endpoint missing",
      detail: health.deployment.api.publicEndpointConfigured ? "External SDK and docs links can resolve." : "Set the public API endpoint before handing SDK setup to teams.",
      tone: health.deployment.api.publicEndpointConfigured ? "healthy" : "degraded"
    },
    {
      key: "queue-worker",
      label: !queueExpected ? "Queue worker optional" : health.services.worker.status === "healthy" ? "Queue worker running" : "Queue worker stale",
      detail: !queueExpected ? "This installation does not expect a queue worker." : formatRole(health.services.worker.role),
      tone: !queueExpected ? "neutral" : health.services.worker.status === "healthy" ? "healthy" : "degraded"
    },
    {
      key: "scheduler",
      label: !schedulerExpected ? "Scheduler optional" : health.services.scheduler.status === "healthy" ? "Scheduler running" : "Scheduler stale",
      detail: !schedulerExpected ? "This installation does not expect a scheduler." : formatRole(health.services.scheduler.role),
      tone: !schedulerExpected ? "neutral" : health.services.scheduler.status === "healthy" ? "healthy" : "degraded"
    },
    {
      key: "smtp",
      label: health.deployment.api.smtpConfigured ? "SMTP configured" : "SMTP missing",
      detail: health.deployment.api.smtpConfigured ? "Email-capable notification channels can send." : "Configure SMTP before relying on email alerts.",
      tone: health.deployment.api.smtpConfigured ? "healthy" : "degraded"
    },
    {
      key: "backups",
      label: !health.deployment.background.backupsEnabled ? "Backups disabled" : health.backups.stale ? "Backups stale" : "Backups scheduled",
      detail: health.deployment.storage.backupS3Enabled ? "Offsite backup storage enabled." : "Offsite backup storage disabled.",
      tone: !health.deployment.background.backupsEnabled || health.backups.stale ? "degraded" : "healthy"
    },
    {
      key: "retention",
      label: health.deployment.background.retentionEnabled ? "Retention enabled" : "Retention disabled",
      detail: health.deployment.storage.sourceMapRetentionEnabled ? "Source-map retention cleanup enabled." : "Source-map retention cleanup disabled.",
      tone: health.deployment.background.retentionEnabled ? "healthy" : "degraded"
    }
  ];
}

function buildAttentionItems(health: SystemHealthResponse): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (health.queues.telemetry.status !== "healthy") {
    items.push({
      key: "queue",
      label: "Queue telemetry unhealthy",
      detail: health.queues.telemetry.errorMessage ?? "Queue counts are unavailable."
    });
  }

  if (!health.retention.enabled) {
    items.push({
      key: "retention-disabled",
      label: "Retention disabled",
      detail: "Old telemetry will not be pruned until retention is enabled."
    });
  }

  if (health.retention.lastRun?.status === "failed") {
    items.push({
      key: "retention-failed",
      label: "Last retention run failed",
      detail: health.retention.lastRun.errorMessage ?? "Review worker logs for the retention job failure."
    });
  }

  if (health.backups.enabled && health.backups.stale) {
    items.push({
      key: "backups-stale",
      label: "Backups stale",
      detail: "No fresh successful backup has been recorded inside the expected interval."
    });
  }

  if (health.backups.latestFailure) {
    items.push({
      key: "backup-failed",
      label: "Latest backup failed",
      detail: health.backups.latestFailure.errorMessage ?? "Review worker logs for the backup failure."
    });
  }

  return items;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function ServiceCard({
  name,
  status,
  statusLabel,
  children
}: {
  name: string;
  status: ServiceStatus;
  statusLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="system-card">
      <div className="system-card__header">
        <h3>{name}</h3>
        <span className={statusLabel ? "status-pill status-pill--neutral" : statusClass(status)}>
          {statusLabel ?? status}
        </span>
      </div>
      <dl>{children}</dl>
    </article>
  );
}

function SystemAttentionBanner({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;

  return (
    <section aria-label="System needs attention" className="system-attention-banner" role="alert">
      <div>
        <span className="section-label">Installation warning</span>
        <strong>System needs attention</strong>
        <p>These checks are read-only. Use server logs, EasyPanel, or the doctor CLI to repair the underlying service.</p>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <strong>{item.label}</strong>
            <span>{item.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SystemHealthPanel({ client }: Props) {
  const [state, setState] = useState<LoadState>("loading");
  const [health, setHealth] = useState<SystemHealthResponse | undefined>();
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState("loading");

    void client
      .getSystemHealth()
      .then(({ data }) => {
        if (cancelled) return;
        setHealth(data);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setHealth(undefined);
        setState("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [client, retryToken]);

  function retry() {
    setRetryToken((current) => current + 1);
  }

  return (
    <section className="system-panel">
      <header aria-label="System health summary" className="system-panel__header" role="group">
        <div>
          <h2>System health</h2>
          <p className="muted-text">Read-only installation health for core services, background work, retention, and backups.</p>
          {health ? <p className="muted-text">Generated {formatTimestamp(health.generatedAt)}</p> : null}
        </div>
        {health ? <span className={statusClass(health.status)}>{health.status}</span> : null}
      </header>

      {state === "loading" ? (
        <p className="muted-text" role="status">
          Loading system health
        </p>
      ) : null}
      {state === "unavailable" ? (
        <div className="status-box unavailable" role="alert">
          <strong>System health unavailable</strong>
          <button onClick={retry} type="button">
            Retry
          </button>
        </div>
      ) : null}

      {state === "ready" && health ? (
        <>
          <SystemAttentionBanner items={buildAttentionItems(health)} />

          <section aria-label="Installation readiness" className="system-readiness">
            {buildReadinessItems(health).map((item) => (
              <article className={`system-readiness__item system-readiness__item--${item.tone}`} key={item.key}>
                <span className={statusClass(item.tone)}>{item.tone === "healthy" ? "ready" : item.tone}</span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </article>
            ))}
          </section>

          <section className="system-grid" aria-label="System services">
            <ServiceCard name="API" status={health.services.api.status}>
              <dt>Uptime</dt>
              <dd>{formatDuration(health.services.api.uptimeSeconds)}</dd>
            </ServiceCard>
            <ServiceCard name="Postgres" status={health.services.postgres.status}>
              <dt>Latency</dt>
              <dd>{formatLatency(health.services.postgres.latencyMs)}</dd>
            </ServiceCard>
            <ServiceCard name="Redis" status={health.services.redis.status}>
              <dt>Latency</dt>
              <dd>{formatLatency(health.services.redis.latencyMs)}</dd>
            </ServiceCard>
            <ServiceCard
              name="Queue worker"
              status={health.services.worker.status}
              statusLabel={health.services.worker.expected ? undefined : "Not expected"}
            >
              <dt>Role</dt>
              <dd>{formatRole(health.services.worker.role)}</dd>
              <dt>Last heartbeat</dt>
              <dd>{formatTimestamp(health.services.worker.lastHeartbeatAt)}</dd>
            </ServiceCard>
            <ServiceCard
              name="Scheduler"
              status={health.services.scheduler.status}
              statusLabel={health.services.scheduler.expected ? undefined : "Not expected"}
            >
              <dt>Role</dt>
              <dd>{formatRole(health.services.scheduler.role)}</dd>
              <dt>Last heartbeat</dt>
              <dd>{formatTimestamp(health.services.scheduler.lastHeartbeatAt)}</dd>
            </ServiceCard>
          </section>

          <section className="system-grid" aria-label="System operations">
            <article className="system-card">
              <div className="system-card__header">
                <h3>Deploy config</h3>
                <span className="status-pill status-pill--neutral">{health.deployment.api.nodeEnv}</span>
              </div>
              <dl>
                <div>
                  <dt>API console</dt>
                  <dd>{enabledLabel(health.deployment.api.consoleEnabled)}</dd>
                </div>
                <div>
                  <dt>Public endpoint</dt>
                  <dd>{configuredLabel(health.deployment.api.publicEndpointConfigured)}</dd>
                </div>
                <div>
                  <dt>Google OAuth</dt>
                  <dd>{enabledLabel(health.deployment.api.googleOAuthEnabled)}</dd>
                </div>
                <div>
                  <dt>SMTP</dt>
                  <dd>{health.deployment.api.smtpConfigured ? "SMTP configured" : "SMTP missing"}</dd>
                </div>
                <div>
                  <dt>Alerts</dt>
                  <dd>
                    {enabledLabel(health.deployment.background.alertsEnabled)}, every{" "}
                    {health.deployment.background.alertsIntervalMinutes} minutes
                  </dd>
                </div>
                <div>
                  <dt>Monitors</dt>
                  <dd>
                    {enabledLabel(health.deployment.background.monitorsEnabled)}, every{" "}
                    {health.deployment.background.monitorsIntervalMinutes} minutes
                  </dd>
                </div>
                <div>
                  <dt>Retention</dt>
                  <dd>
                    {enabledLabel(health.deployment.background.retentionEnabled)}, every{" "}
                    {health.deployment.background.retentionIntervalMinutes} minutes
                  </dd>
                </div>
                <div>
                  <dt>Backups</dt>
                  <dd>
                    {enabledLabel(health.deployment.background.backupsEnabled)}, every{" "}
                    {health.deployment.background.backupsIntervalHours} hours
                  </dd>
                </div>
                <div>
                  <dt>Backup S3</dt>
                  <dd>{enabledLabel(health.deployment.storage.backupS3Enabled)}</dd>
                </div>
                <div>
                  <dt>Source map retention</dt>
                  <dd>{enabledLabel(health.deployment.storage.sourceMapRetentionEnabled)}</dd>
                </div>
              </dl>
            </article>

            <article className="system-card">
              <div className="system-card__header">
                <h3>Queues</h3>
                <span className={statusClass(health.queues.telemetry.status)}>{health.queues.telemetry.status}</span>
              </div>
              {health.queues.telemetry.status === "unhealthy" ? (
                <p className="muted-text">{health.queues.telemetry.errorMessage ?? "Queue counts unavailable"}</p>
              ) : (
                <dl>
                  {queueLabels.map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{health.queues.telemetry[key]}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </article>

            <article className="system-card">
              <h3>Ingestion freshness</h3>
              <dl>
                {ingestionLabels.map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{formatTimestamp(health.ingestion[key])}</dd>
                  </div>
                ))}
              </dl>
            </article>

            <article className="system-card">
              <div className="system-card__header">
                <h3>Retention</h3>
                <span className="status-pill status-pill--neutral">{health.retention.enabled ? "Enabled" : "Disabled"}</span>
              </div>
              <dl>
                <div>
                  <dt>Interval</dt>
                  <dd>{health.retention.intervalMinutes} minutes</dd>
                </div>
                <div>
                  <dt>Policy</dt>
                  <dd>
                    {retentionPolicyLabels.map(([key, label]) => (
                      <span key={key}>{`${label} ${health.retention.policy[key]}d`}</span>
                    ))}
                    <span>{`source maps ${health.retention.policy.sourceMapsEnabled ? "enabled" : "disabled"}`}</span>
                    <span>{`source maps batch ${health.retention.policy.sourceMapsBatchSize}`}</span>
                  </dd>
                </div>
                {health.retention.lastRun ? (
                  <>
                    <div>
                      <dt>Last run</dt>
                      <dd>
                        <span className={statusClass(health.retention.lastRun.status)}>{health.retention.lastRun.status}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Started</dt>
                      <dd>{formatTimestamp(health.retention.lastRun.startedAt)}</dd>
                    </div>
                    <div>
                      <dt>Finished</dt>
                      <dd>{formatTimestamp(health.retention.lastRun.finishedAt)}</dd>
                    </div>
                    <div>
                      <dt>Deleted</dt>
                      <dd>
                        <span>events {health.retention.lastRun.deleted.events}</span>
                        <span>errors {health.retention.lastRun.deleted.errors}</span>
                        <span>traces {health.retention.lastRun.deleted.traces}</span>
                        <span>spans {health.retention.lastRun.deleted.spans}</span>
                        <span>LLM calls {health.retention.lastRun.deleted.llmCalls}</span>
                        <span>breadcrumbs {health.retention.lastRun.deleted.breadcrumbs}</span>
                        <span>
                          source maps {health.retention.lastRun.deleted.sourceMapArtifacts} artifacts,{" "}
                          {health.retention.lastRun.deleted.sourceMapFiles} files
                        </span>
                      </dd>
                    </div>
                    {health.retention.lastRun.errorMessage ? (
                      <div>
                        <dt>Error</dt>
                        <dd>{health.retention.lastRun.errorMessage}</dd>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div>
                    <dt>Last run</dt>
                    <dd>No data</dd>
                  </div>
                )}
              </dl>
            </article>

            <article className="system-card">
              <div className="system-card__header">
                <h3>Backups</h3>
                <span className={backupStatusClass(health.backups)}>{backupStatusLabel(health.backups)}</span>
              </div>
              <dl>
                <div>
                  <dt>Interval</dt>
                  <dd>{health.backups.intervalHours} hours</dd>
                </div>
                <div>
                  <dt>Local retention</dt>
                  <dd>{health.backups.retentionDays} days</dd>
                </div>
                <div>
                  <dt>Offsite</dt>
                  <dd>{health.backups.s3Enabled ? "S3 enabled" : "S3 disabled"}</dd>
                </div>
                <div>
                  <dt>Stale</dt>
                  <dd>{backupStaleLabel(health.backups)}</dd>
                </div>
                {health.backups.latestSuccess ? (
                  <>
                    <div>
                      <dt>Latest success</dt>
                      <dd>{formatTimestamp(health.backups.latestSuccess.startedAt)}</dd>
                    </div>
                    <div>
                      <dt>Filename</dt>
                      <dd>{health.backups.latestSuccess.filename}</dd>
                    </div>
                    <div>
                      <dt>Size</dt>
                      <dd>{formatBytes(health.backups.latestSuccess.sizeBytes)}</dd>
                    </div>
                  </>
                ) : (
                  <div>
                    <dt>Latest success</dt>
                    <dd>No data</dd>
                  </div>
                )}
                {health.backups.latestFailure ? (
                  <div>
                    <dt>Latest failure</dt>
                    <dd>{health.backups.latestFailure.errorMessage ?? formatTimestamp(health.backups.latestFailure.startedAt)}</dd>
                  </div>
                ) : null}
              </dl>
            </article>
          </section>
        </>
      ) : null}
    </section>
  );
}
