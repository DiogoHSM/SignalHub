import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { SystemHealthResponse, SystemStatus } from "../api/types";

type LoadState = "loading" | "ready" | "unavailable";
type ServiceStatus = SystemStatus | "success" | "failed";

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

const retentionPolicyLabels: Array<[keyof SystemHealthResponse["retention"]["policy"], string]> = [
  ["eventsDays", "events"],
  ["errorsDays", "errors"],
  ["tracesDays", "traces"],
  ["spansDays", "spans"],
  ["llmCallsDays", "LLM calls"]
];

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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function ServiceCard({
  name,
  status,
  children
}: {
  name: string;
  status: ServiceStatus;
  children: React.ReactNode;
}) {
  return (
    <article className="system-card">
      <div className="system-card__header">
        <h3>{name}</h3>
        <span className={statusClass(status)}>{status}</span>
      </div>
      <dl>{children}</dl>
    </article>
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
          <h2>System</h2>
          <p className="muted-text">Read-only operational status for core services and background work.</p>
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
            <ServiceCard name="Worker" status={health.services.worker.status}>
              <dt>Last heartbeat</dt>
              <dd>{formatTimestamp(health.services.worker.lastHeartbeatAt)}</dd>
            </ServiceCard>
          </section>

          <section className="system-grid" aria-label="System operations">
            <article className="system-card">
              <h3>Queues</h3>
              <dl>
                {queueLabels.map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{health.queues.telemetry[key]}</dd>
                  </div>
                ))}
              </dl>
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
                        events {health.retention.lastRun.deleted.events}, errors {health.retention.lastRun.deleted.errors}, traces{" "}
                        {health.retention.lastRun.deleted.traces}, spans {health.retention.lastRun.deleted.spans}, LLM calls{" "}
                        {health.retention.lastRun.deleted.llmCalls}
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
          </section>
        </>
      ) : null}
    </section>
  );
}
