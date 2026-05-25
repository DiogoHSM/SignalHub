import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Bell, ExternalLink, HeartPulse, SearchCode, ShieldCheck, Timer } from "lucide-react";
import type { ApiClient } from "../api/client";
import type { OperationsResponse, OperationsStatus, OperationsWindow } from "../api/types";

type OperationsDashboardProps = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
  onOpenAlerts: () => void;
  onOpenMonitors: () => void;
  onOpenErrors: (filters?: { status?: "open" | "investigating"; severity?: string }) => void;
  onOpenTraces: (filters?: { traceName?: string }) => void;
  onOpenIncident: (groupId: string, options?: { errorId?: string }) => void;
};

type LoadState = "loading" | "ready" | "unavailable";

const windows: OperationsWindow[] = ["24h", "7d", "30d"];

function statusClass(status: OperationsStatus | "success" | "failed" | "warning" | "info" | "neutral"): string {
  if (status === "healthy" || status === "success") return "status-pill status-pill--success";
  if (status === "unhealthy" || status === "failed") return "status-pill status-pill--failed";
  if (status === "degraded" || status === "warning") return "status-pill status-pill--warning";
  return "status-pill status-pill--neutral";
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "No data";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "No data" : timestamp.toLocaleString();
}

function formatMs(value: number | null): string {
  return value === null ? "No data" : `${Math.round(value)} ms`;
}

function formatPercent(value: number | null): string {
  return value === null ? "No data" : `${Number(value.toFixed(2))}%`;
}

function statusLabel(status: OperationsStatus): string {
  if (status === "not_configured") return "not configured";
  return status;
}

function OperationsLoadingLayout() {
  return (
    <>
      <section className="operations-status-grid" aria-label="Operations loading">
        {Array.from({ length: 6 }, (_, index) => (
          <article className="operations-command-card overview-placeholder" key={index}>
            <span />
            <strong />
          </article>
        ))}
      </section>
      <section className="operations-recent-grid">
        {Array.from({ length: 3 }, (_, index) => (
          <article className="operations-command-card overview-placeholder" key={index}>
            <span />
            <span />
            <span />
          </article>
        ))}
      </section>
    </>
  );
}

function CommandCard({
  action,
  children,
  icon: Icon,
  label,
  metric,
  onClick,
  tone = "neutral"
}: {
  action?: string;
  children: ReactNode;
  icon: typeof ShieldCheck;
  label: string;
  metric: string;
  onClick?: () => void;
  tone?: "neutral" | "success" | "warning" | "failed";
}) {
  return (
    <article className="operations-command-card">
      <div className="operations-command-card__header">
        <span className={`operations-command-card__icon operations-command-card__icon--${tone}`}>
          <Icon aria-hidden="true" size={18} />
        </span>
        <span>{label}</span>
      </div>
      <strong className="operations-command-card__metric">{metric}</strong>
      <p className="muted-text">{children}</p>
      {onClick && action ? (
        <button className="small-action" onClick={onClick} type="button">
          {action}
          <ExternalLink aria-hidden="true" size={13} />
        </button>
      ) : null}
    </article>
  );
}

export function OperationsDashboard({
  client,
  projectId,
  environmentId,
  onOpenAlerts,
  onOpenErrors,
  onOpenIncident,
  onOpenMonitors,
  onOpenTraces
}: OperationsDashboardProps) {
  const [window, setWindow] = useState<OperationsWindow>("24h");
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<OperationsResponse | undefined>();

  useEffect(() => {
    if (!projectId || !environmentId) return;
    if (!client.getOperations) {
      setData(undefined);
      setState("unavailable");
      return;
    }

    let cancelled = false;
    setState("loading");

    void client.getOperations({ projectId, environmentId, window }).then(
      (result) => {
        if (cancelled) return;
        setData(result.data);
        setState("ready");
      },
      () => {
        if (cancelled) return;
        setData(undefined);
        setState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId, reloadToken, window]);

  function retry() {
    setReloadToken((current) => current + 1);
  }

  if (!projectId || !environmentId) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Operations</h2>
        </div>
        <p className="muted-text">Select a project and environment in Setup to view operations.</p>
      </section>
    );
  }

  return (
    <section className="operations-dashboard">
      <header className="operations-header">
        <div>
          <h2>Operations</h2>
          <p className="muted-text">Project health, alerts, monitors, incidents, and freshness for the selected environment.</p>
          {data ? <p className="muted-text">Generated {formatTimestamp(data.generatedAt)}</p> : null}
        </div>
        <div className="operations-header__actions">
          {data ? <span className={statusClass(data.status)}>{statusLabel(data.status)}</span> : null}
          <div className="overview-window-tabs" aria-label="Operations window">
            {windows.map((item) => (
              <button aria-pressed={window === item} key={item} onClick={() => setWindow(item)} type="button">
                {item}
              </button>
            ))}
          </div>
        </div>
      </header>

      {state === "loading" ? (
        <>
          <p className="muted-text" role="status">
            Loading operations
          </p>
          <OperationsLoadingLayout />
        </>
      ) : null}

      {state === "unavailable" ? (
        <div className="status-box unavailable" role="alert">
          <strong>Operations unavailable</strong>
          <button onClick={retry} type="button">
            Retry
          </button>
        </div>
      ) : null}

      {state === "ready" && data ? (
        <>
          <section className="operations-status-grid" aria-label="Operations command cards">
            <CommandCard icon={ShieldCheck} label="Project status" metric={statusLabel(data.status)} tone={data.status === "healthy" ? "success" : data.status === "unhealthy" ? "failed" : "warning"}>
              {data.setupGaps.length === 0 ? "Configured signals are reporting normally." : `${data.setupGaps.length} setup gaps need attention.`}
            </CommandCard>
            <CommandCard action="Open monitors" icon={HeartPulse} label="Monitors" metric={`${data.summary.monitors.total}`} onClick={onOpenMonitors} tone={data.summary.monitors.http.down + data.summary.monitors.heartbeat.down > 0 ? "failed" : "success"}>
              {data.summary.monitors.http.up + data.summary.monitors.heartbeat.up} up, {data.summary.monitors.http.down + data.summary.monitors.heartbeat.down} down.
            </CommandCard>
            <CommandCard action="Open alerts" icon={Bell} label="Alerts" metric={`${data.summary.alerts.events.total}`} onClick={onOpenAlerts} tone={data.summary.alerts.events.critical > 0 ? "failed" : data.summary.alerts.events.deliveryFailed > 0 ? "warning" : "neutral"}>
              {data.summary.alerts.rules.enabled} enabled rules, {data.summary.alerts.events.deliveryFailed} failed deliveries.
            </CommandCard>
            <CommandCard action="Open issues" icon={AlertTriangle} label="Incidents" metric={`${data.summary.incidents.open + data.summary.incidents.investigating}`} onClick={() => onOpenErrors({ status: "open" })} tone={data.summary.incidents.urgent + data.summary.incidents.high > 0 ? "warning" : "neutral"}>
              {data.summary.incidents.urgent} urgent, {data.summary.incidents.high} high priority.
            </CommandCard>
            <CommandCard action="Investigate traces" icon={Timer} label="Latency" metric={formatMs(data.summary.telemetry.p95TraceDurationMs)} onClick={() => onOpenTraces()} tone={data.summary.telemetry.p95TraceDurationMs === null ? "neutral" : "success"}>
              p95 trace latency, error rate {formatPercent(data.summary.telemetry.errorRatePercent)}.
            </CommandCard>
            <CommandCard action="Open telemetry" icon={SearchCode} label="Freshness" metric={formatTimestamp(data.summary.telemetry.lastEventAt ?? data.summary.telemetry.lastTraceAt ?? data.summary.telemetry.lastErrorAt)} onClick={() => onOpenErrors()} tone={data.summary.telemetry.events + data.summary.telemetry.errors + data.summary.telemetry.traces > 0 ? "success" : "warning"}>
              {data.summary.telemetry.events} events, {data.summary.telemetry.errors} errors, {data.summary.telemetry.traces} traces.
            </CommandCard>
          </section>

          {data.setupGaps.length > 0 ? (
            <section className="operations-gaps" aria-label="Setup gaps">
              {data.setupGaps.map((gap) => (
                <button
                  key={gap.key}
                  onClick={gap.action === "alerts" ? onOpenAlerts : gap.action === "monitors" ? onOpenMonitors : undefined}
                  type="button"
                >
                  <span className={statusClass(gap.severity)}>{gap.severity}</span>
                  {gap.label}
                </button>
              ))}
            </section>
          ) : null}

          <section className="operations-latency-table" aria-label="Top latency">
            <div className="panel-header">
              <h3>Top latency</h3>
            </div>
            {data.topLatency.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>P95</th>
                    <th>Traces</th>
                    <th>Failed</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.topLatency.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td>{formatMs(row.p95TraceDurationMs)}</td>
                      <td>{row.traces}</td>
                      <td>{row.failedTraces}</td>
                      <td>
                        <button className="small-action" onClick={() => onOpenTraces({ traceName: row.name })} type="button">
                          Investigate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted-text">No trace latency in this window.</p>
            )}
          </section>

          <section className="operations-recent-grid" aria-label="Recent operations activity">
            <article className="operations-command-card">
              <h3>Recent monitors</h3>
              {data.recent.monitors.length > 0 ? (
                <ul className="operations-list">
                  {data.recent.monitors.map((monitor) => (
                    <li key={monitor.id}>
                      <span className={statusClass(monitor.status === "up" ? "success" : monitor.status === "down" ? "failed" : monitor.status === "degraded" ? "warning" : "neutral")}>{monitor.status}</span>
                      <strong>{monitor.name}</strong>
                      <small>{formatTimestamp(monitor.lastCheckedAt ?? monitor.lastHeartbeatAt)}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-text">No monitors configured.</p>
              )}
            </article>
            <article className="operations-command-card">
              <h3>Recent alerts</h3>
              {data.recent.alerts.length > 0 ? (
                <ul className="operations-list">
                  {data.recent.alerts.map((alert) => (
                    <li key={alert.id}>
                      <span className={statusClass(alert.severity === "critical" ? "failed" : "warning")}>{alert.severity}</span>
                      <strong>{alert.message}</strong>
                      <small>{formatTimestamp(alert.triggeredAt)} · delivery {alert.latestDeliveryStatus ?? "pending"}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-text">No alert events in this window.</p>
              )}
            </article>
            <article className="operations-command-card">
              <h3>Recent incidents</h3>
              {data.recent.incidents.length > 0 ? (
                <ul className="operations-list">
                  {data.recent.incidents.map((incident) => (
                    <li key={incident.id}>
                      <span className={statusClass(incident.priority === "urgent" || incident.priority === "high" ? "warning" : "neutral")}>
                        {incident.priority ?? incident.status}
                      </span>
                      <button onClick={() => onOpenIncident(incident.id, { errorId: incident.latestErrorId ?? undefined })} type="button">
                        {incident.message}
                      </button>
                      <small>{formatTimestamp(incident.lastSeenAt)}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-text">No open incidents.</p>
              )}
            </article>
          </section>
        </>
      ) : null}
    </section>
  );
}
