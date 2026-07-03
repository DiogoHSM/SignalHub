import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Bell, CheckCircle2, ExternalLink, HeartPulse, SearchCode, ShieldCheck, Timer } from "lucide-react";
import type { ApiClient } from "../api/client";
import type { OperationsAnomaly, OperationsResponse, OperationsStatus, OperationsWindow } from "../api/types";

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

type RecommendedAction = {
  key: string;
  title: string;
  description: string;
  action: string;
  tone: "success" | "warning" | "failed" | "neutral";
  onClick: () => void;
};

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

function formatAnomalyValue(anomaly: OperationsAnomaly, value: number): string {
  if (anomaly.type === "trace_p95_latency") return `${Math.round(value)} ms`;
  if (anomaly.type === "error_rate") return `${Number(value.toFixed(2))}%`;
  if (anomaly.type === "llm_cost") return `$${value.toFixed(2)}`;
  return `${Math.round(value)}`;
}

function formatAnomalyChange(value: number | null): string {
  if (value === null) return "new baseline";
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
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

function buildRecommendedActions(
  data: OperationsResponse,
  handlers: {
    onOpenAlerts: () => void;
    onOpenErrors: (filters?: { status?: "open" | "investigating"; severity?: string }) => void;
    onOpenMonitors: () => void;
    onOpenTraces: (filters?: { traceName?: string }) => void;
  }
): RecommendedAction[] {
  const downMonitors = data.summary.monitors.http.down + data.summary.monitors.heartbeat.down;
  const degradedMonitors = data.summary.monitors.http.degraded + data.summary.monitors.heartbeat.degraded;
  const activeIncidents = data.summary.incidents.open + data.summary.incidents.investigating;
  const setupMonitorGaps = data.setupGaps.filter((gap) => gap.action === "monitors").length;
  const slowestTrace = data.topLatency[0];
  const topAnomaly = data.anomalies[0];
  const actions: RecommendedAction[] = [];

  if (topAnomaly) {
    actions.push({
      key: "anomaly",
      title: topAnomaly.severity === "critical" ? "Respond to critical anomaly" : "Review detected anomaly",
      description: `${topAnomaly.label}: ${topAnomaly.reason}`,
      action: topAnomaly.suggestedAlertRuleType ? "Review alert rule" : "Inspect signal",
      tone: topAnomaly.severity === "critical" ? "failed" : "warning",
      onClick: topAnomaly.drilldown === "traces"
        ? () => handlers.onOpenTraces({ traceName: topAnomaly.routePattern ?? undefined })
        : topAnomaly.drilldown === "alerts"
          ? handlers.onOpenAlerts
          : () => handlers.onOpenErrors({ status: "open" })
    });
  }

  if (activeIncidents > 0) {
    actions.push({
      key: "incidents",
      title: "Investigate active incidents",
      description: `${activeIncidents} active incidents, including ${data.summary.incidents.high} high priority.`,
      action: "Open incidents",
      tone: data.summary.incidents.urgent > 0 ? "failed" : "warning",
      onClick: () => handlers.onOpenErrors({ status: "open" })
    });
  }

  if (downMonitors > 0 || degradedMonitors > 0 || setupMonitorGaps > 0) {
    actions.push({
      key: "monitors",
      title: downMonitors > 0 ? "Recover down monitors" : "Fix monitor coverage gaps",
      description:
        downMonitors > 0
          ? `${downMonitors} monitors are down and ${degradedMonitors} are degraded.`
          : `${setupMonitorGaps} monitor setup gaps are still open.`,
      action: "Open monitors",
      tone: downMonitors > 0 ? "failed" : "warning",
      onClick: handlers.onOpenMonitors
    });
  }

  if (data.summary.alerts.events.critical > 0 || data.summary.alerts.events.deliveryFailed > 0) {
    actions.push({
      key: "alerts",
      title: data.summary.alerts.events.critical > 0 ? "Review critical alert firings" : "Review failed alert deliveries",
      description: `${data.summary.alerts.events.critical} critical alerts and ${data.summary.alerts.events.deliveryFailed} failed deliveries in this window.`,
      action: "Open alerts",
      tone: data.summary.alerts.events.critical > 0 ? "failed" : "warning",
      onClick: handlers.onOpenAlerts
    });
  }

  if (slowestTrace && slowestTrace.p95TraceDurationMs >= 500) {
    actions.push({
      key: "latency",
      title: "Inspect slow traces",
      description: `${slowestTrace.name} is the slowest route at p95 ${formatMs(slowestTrace.p95TraceDurationMs)} across ${slowestTrace.traces} traces.`,
      action: "Open trace",
      tone: slowestTrace.failedTraces > 0 ? "warning" : "neutral",
      onClick: () => handlers.onOpenTraces({ traceName: slowestTrace.name })
    });
  }

  if (data.summary.telemetry.errorRatePercent !== null && data.summary.telemetry.errorRatePercent >= 5) {
    actions.push({
      key: "error-rate",
      title: "Check error-rate outlier",
      description: `Error rate is ${formatPercent(data.summary.telemetry.errorRatePercent)} for this window.`,
      action: "Open errors",
      tone: data.summary.telemetry.errorRatePercent >= 10 ? "failed" : "warning",
      onClick: () => handlers.onOpenErrors({ status: "open" })
    });
  }

  return actions.slice(0, 4);
}

function anomalyTone(severity: OperationsAnomaly["severity"]): "neutral" | "warning" | "failed" {
  if (severity === "critical") return "failed";
  if (severity === "warning") return "warning";
  return "neutral";
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

  function openAnomaly(anomaly: OperationsAnomaly) {
    if (anomaly.drilldown === "traces") {
      onOpenTraces({ traceName: anomaly.routePattern ?? undefined });
      return;
    }
    if (anomaly.drilldown === "alerts") {
      onOpenAlerts();
      return;
    }
    if (anomaly.drilldown === "errors") {
      onOpenErrors({ status: "open" });
    }
  }

  const recommendedActions = data
    ? buildRecommendedActions(data, { onOpenAlerts, onOpenErrors, onOpenMonitors, onOpenTraces })
    : [];

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
          <section aria-label="Recommended next actions" className="operations-next-actions">
            <div className="panel-header">
              <div>
                <h3>Recommended next actions</h3>
                <p className="muted-text">Prioritized from incidents, monitors, alerts, latency, and telemetry drift.</p>
              </div>
            </div>
            {recommendedActions.length > 0 ? (
              <div className="operations-next-actions__list">
                {recommendedActions.map((item) => (
                  <button className={`operations-next-action operations-next-action--${item.tone}`} key={item.key} onClick={item.onClick} type="button">
                    <span className={`operations-command-card__icon operations-command-card__icon--${item.tone}`}>
                      {item.tone === "success" ? <CheckCircle2 aria-hidden="true" size={18} /> : <AlertTriangle aria-hidden="true" size={18} />}
                    </span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                    <span className="operations-next-action__cta">
                      {item.action}
                      <ExternalLink aria-hidden="true" size={13} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="operations-next-actions__empty">
                <CheckCircle2 aria-hidden="true" size={20} />
                <div>
                  <strong>No urgent actions</strong>
                  <p className="muted-text">Signals look stable for this window. Keep this open and watch for drift.</p>
                </div>
              </div>
            )}
          </section>

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

          <section className="operations-anomalies" aria-label="Detected anomalies">
            <div className="panel-header">
              <div>
                <h3>Anomaly detection</h3>
                <p className="muted-text">Current window compared with the previous equivalent baseline.</p>
              </div>
              <span className={statusClass(data.anomalies.some((item) => item.severity === "critical") ? "failed" : data.anomalies.length > 0 ? "warning" : "success")}>
                {data.anomalies.length === 0 ? "stable" : `${data.anomalies.length} detected`}
              </span>
            </div>
            {data.anomalies.length > 0 ? (
              <div className="operations-anomalies__list">
                {data.anomalies.map((anomaly) => (
                  <article className={`operations-anomaly operations-anomaly--${anomalyTone(anomaly.severity)}`} key={anomaly.id}>
                    <div>
                      <span className={statusClass(anomaly.severity === "critical" ? "failed" : anomaly.severity === "warning" ? "warning" : "neutral")}>
                        {anomaly.severity}
                      </span>
                      <h4>{anomaly.label}</h4>
                      <p>{anomaly.reason}</p>
                    </div>
                    <dl>
                      <div>
                        <dt>Observed</dt>
                        <dd>{formatAnomalyValue(anomaly, anomaly.observedValue)}</dd>
                      </div>
                      <div>
                        <dt>Baseline</dt>
                        <dd>{formatAnomalyValue(anomaly, anomaly.baselineValue)}</dd>
                      </div>
                      <div>
                        <dt>Change</dt>
                        <dd>{formatAnomalyChange(anomaly.changePercent)}</dd>
                      </div>
                      <div>
                        <dt>Samples</dt>
                        <dd>{anomaly.sampleSize} / {anomaly.baselineSampleSize}</dd>
                      </div>
                    </dl>
                    <div className="operations-anomaly__footer">
                      <span>{anomaly.threshold}</span>
                      {anomaly.suggestedAlertRuleType ? <span>Suggested rule: {anomaly.suggestedAlertRuleType}</span> : <span>Use as context signal</span>}
                      {anomaly.drilldown === "errors" || anomaly.drilldown === "traces" || anomaly.drilldown === "alerts" ? (
                        <button className="small-action" onClick={() => openAnomaly(anomaly)} type="button">
                          Drill down
                          <ExternalLink aria-hidden="true" size={13} />
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="operations-next-actions__empty">
                <CheckCircle2 aria-hidden="true" size={20} />
                <div>
                  <strong>No anomalies detected</strong>
                  <p className="muted-text">Volume, error rate, latency, and LLM cost are within the previous-window baseline.</p>
                </div>
              </div>
            )}
          </section>

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
