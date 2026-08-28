import { sql } from "kysely";
import type { Db } from "../client.js";

export type OperationsWindow = "24h" | "7d" | "30d";
export type OperationsStatus = "healthy" | "degraded" | "unhealthy" | "not_configured";
export type MonitorKind = "http" | "heartbeat";
export type MonitorStatus = "unknown" | "up" | "down" | "degraded" | "paused";
export type AlertSeverity = "info" | "warning" | "critical";
export type DeliveryStatus = "success" | "failed" | null;
export type ErrorGroupStatus = "open" | "investigating" | "resolved" | "ignored";
export type ErrorGroupPriority = "urgent" | "high" | "normal" | "low";
export type OperationsAnomalyType = "event_volume" | "error_volume" | "error_rate" | "trace_p95_latency" | "llm_cost";
export type OperationsAnomalySeverity = "info" | "warning" | "critical";

export type OperationsFilters = {
  projectId: string;
  environmentId: string;
  window: OperationsWindow;
  now?: Date;
};

export type StatusCounts = {
  total: number;
  up: number;
  degraded: number;
  down: number;
  paused: number;
  unknown: number;
};

export type RecentMonitor = {
  id: string;
  kind: MonitorKind;
  name: string;
  status: MonitorStatus;
  lastCheckedAt: string | null;
  lastHeartbeatAt: string | null;
  lastCheckLatencyMs: number | null;
  lastCheckErrorMessage: string | null;
};

export type RecentAlert = {
  id: string;
  severity: AlertSeverity;
  triggeredAt: string;
  message: string;
  latestDeliveryStatus: DeliveryStatus;
};

export type RecentIncident = {
  id: string;
  message: string;
  severity: string;
  status: ErrorGroupStatus;
  priority: ErrorGroupPriority | null;
  lastSeenAt: string;
  latestErrorId: string | null;
};

export type SetupGap = {
  key: "http_monitor" | "heartbeat_monitor" | "alert_rule" | "notification_channel" | "recent_telemetry";
  label: string;
  severity: "info" | "warning";
  action: "monitors" | "alerts" | "setup" | "overview";
};

export type OperationsAnomaly = {
  id: string;
  type: OperationsAnomalyType;
  label: string;
  severity: OperationsAnomalySeverity;
  observedValue: number;
  baselineValue: number;
  changePercent: number | null;
  sampleSize: number;
  baselineSampleSize: number;
  threshold: string;
  reason: string;
  suggestedAlertRuleType: "error_count" | "error_rate" | "trace_p95_latency" | "llm_cost" | null;
  routePattern: string | null;
  drilldown: "events" | "errors" | "traces" | "llm" | "alerts";
};

export type OperationsPredictionSeverity = "low" | "medium" | "high" | "critical";
export type OperationsPredictionConfidence = "low" | "medium" | "high";

export type OperationsPredictionFactor = {
  key: string;
  label: string;
  impact: "positive" | "negative";
  weight: number;
  observedValue: number;
  baselineValue: number | null;
  reason: string;
};

export type OperationsPrediction = {
  id: string;
  type: "operational_risk";
  label: string;
  horizon: "next_window";
  severity: OperationsPredictionSeverity;
  score: number;
  confidence: OperationsPredictionConfidence;
  probabilityPercent: number;
  validation: {
    baselineWindow: { from: string; to: string };
    currentWindow: { from: string; to: string };
    baselineRiskScore: number;
    delta: number;
    sampleSize: number;
    baselineSampleSize: number;
    method: "heuristic-weighted-baseline-v1";
  };
  factors: OperationsPredictionFactor[];
  suggestedDrilldown: "operations" | "alerts" | "monitors" | "errors" | "traces";
};

export type OperationsResponse = {
  window: OperationsWindow;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string; to: string };
  status: OperationsStatus;
  summary: {
    monitors: {
      total: number;
      http: StatusCounts;
      heartbeat: StatusCounts;
    };
    alerts: {
      rules: { total: number; enabled: number };
      events: { total: number; critical: number; warning: number; deliveryFailed: number; deliveryPending: number };
    };
    telemetry: {
      events: number;
      errors: number;
      traces: number;
      failedTraces: number;
      errorRatePercent: number | null;
      p95TraceDurationMs: number | null;
      lastEventAt: string | null;
      lastErrorAt: string | null;
      lastTraceAt: string | null;
    };
    incidents: { open: number; investigating: number; urgent: number; high: number; regressed: number };
  };
  recent: {
    monitors: RecentMonitor[];
    alerts: RecentAlert[];
    incidents: RecentIncident[];
  };
  topLatency: Array<{ name: string; p95TraceDurationMs: number; traces: number; failedTraces: number }>;
  anomalies: OperationsAnomaly[];
  predictions: OperationsPrediction[];
  setupGaps: SetupGap[];
};

type MonitorRow = {
  id: string;
  kind: MonitorKind;
  name: string;
  enabled: boolean;
  status: MonitorStatus;
  last_checked_at: Date | string | null;
  last_heartbeat_at: Date | string | null;
  last_check_latency_ms: number | null;
  last_check_error_message: string | null;
};

type AlertEventRow = {
  id: string;
  severity: AlertSeverity;
  triggered_at: Date | string;
  message: string;
  latest_delivery_status: DeliveryStatus;
};

type IncidentRow = {
  id: string;
  message: string;
  severity: string;
  status: ErrorGroupStatus;
  priority: ErrorGroupPriority | null;
  last_seen_at: Date | string;
  latest_error_id: string | null;
};

type RiskSignalSnapshot = {
  events: number;
  errors: number;
  traces: number;
  failedTraces: number;
  alertEvents: number;
  criticalAlertEvents: number;
  warningAlertEvents: number;
  deliveryFailures: number;
  errorRatePercent: number;
  p95TraceDurationMs: number;
};

const emptyStatusCounts = (): StatusCounts => ({
  total: 0,
  up: 0,
  degraded: 0,
  down: 0,
  paused: 0,
  unknown: 0
});

function resolveOperationsRange(window: OperationsWindow, now = new Date()): { from: Date; to: Date } {
  const to = new Date(now);
  const from = new Date(to);
  if (window === "24h") from.setUTCHours(from.getUTCHours() - 24);
  if (window === "7d") from.setUTCDate(from.getUTCDate() - 7);
  if (window === "30d") from.setUTCDate(from.getUTCDate() - 30);
  return { from, to };
}

function toFiniteSafeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      return null;
    }
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER ? parsed : null;
}

function toNumber(value: unknown): number {
  return toFiniteSafeNumber(value) ?? 0;
}

function toNullableNumber(value: unknown): number | null {
  return toFiniteSafeNumber(value);
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function previousOperationsRange(from: Date, to: Date): { from: Date; to: Date } {
  const durationMs = to.getTime() - from.getTime();
  return {
    from: new Date(from.getTime() - durationMs),
    to: new Date(from)
  };
}

function percentChange(observed: number, baseline: number): number | null {
  if (baseline <= 0) return null;
  return ((observed - baseline) / baseline) * 100;
}

function formatCompactMetric(value: number): string {
  if (Math.abs(value) >= 100) return String(Math.round(value));
  if (Math.abs(value) >= 10) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(2).replace(/\.00$/, "").replace(/0$/, "");
}

function anomalyId(type: OperationsAnomalyType, routePattern: string | null): string {
  return `anom_${type}_${(routePattern ?? "global").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "global"}`;
}

function ratio(observed: number, baseline: number): number {
  return baseline <= 0 ? Number.POSITIVE_INFINITY : observed / baseline;
}

function compareVolumeAnomaly(input: {
  type: "event_volume" | "error_volume";
  label: string;
  observed: number;
  baseline: number;
  suggestedAlertRuleType: "error_count" | null;
  drilldown: "events" | "errors";
}): OperationsAnomaly | null {
  if (input.observed < 10 || input.baseline < 3) return null;
  const multiplier = ratio(input.observed, input.baseline);
  const delta = input.observed - input.baseline;
  if (multiplier < 3 && delta < 25) return null;

  const severity: OperationsAnomalySeverity = multiplier >= 5 || delta >= 100 ? "critical" : "warning";
  return {
    id: anomalyId(input.type, null),
    type: input.type,
    label: input.label,
    severity,
    observedValue: input.observed,
    baselineValue: input.baseline,
    changePercent: percentChange(input.observed, input.baseline),
    sampleSize: input.observed,
    baselineSampleSize: input.baseline,
    threshold: ">=3x baseline or +25 signals",
    reason: `${input.label} is ${formatCompactMetric(multiplier)}x the previous ${input.baseline}-signal baseline.`,
    suggestedAlertRuleType: input.suggestedAlertRuleType,
    routePattern: null,
    drilldown: input.drilldown
  };
}

function compareRateAnomaly(input: { observed: number; baseline: number; sampleSize: number; baselineSampleSize: number }): OperationsAnomaly | null {
  if (input.sampleSize < 10 || input.baselineSampleSize < 10) return null;
  if (input.observed < 5) return null;
  const multiplier = ratio(input.observed, Math.max(input.baseline, 0.1));
  const delta = input.observed - input.baseline;
  if (delta < 5 && multiplier < 2) return null;

  const severity: OperationsAnomalySeverity = input.observed >= 10 && (delta >= 10 || multiplier >= 3) ? "critical" : "warning";
  return {
    id: anomalyId("error_rate", null),
    type: "error_rate",
    label: "Error rate",
    severity,
    observedValue: input.observed,
    baselineValue: input.baseline,
    changePercent: percentChange(input.observed, input.baseline),
    sampleSize: input.sampleSize,
    baselineSampleSize: input.baselineSampleSize,
    threshold: ">=5pp over baseline or >=2x baseline",
    reason: `Error rate reached ${formatCompactMetric(input.observed)}% versus ${formatCompactMetric(input.baseline)}% in the prior window.`,
    suggestedAlertRuleType: "error_rate",
    routePattern: null,
    drilldown: "errors"
  };
}

function compareLatencyAnomaly(input: {
  route: string;
  observed: number;
  baseline: number;
  sampleSize: number;
  baselineSampleSize: number;
}): OperationsAnomaly | null {
  if (input.sampleSize < 10 || input.baselineSampleSize < 10) return null;
  if (input.observed < 500) return null;
  const multiplier = ratio(input.observed, input.baseline);
  const delta = input.observed - input.baseline;
  if (multiplier < 2 && delta < 500) return null;

  const severity: OperationsAnomalySeverity = input.observed >= 1500 || multiplier >= 4 ? "critical" : "warning";
  return {
    id: anomalyId("trace_p95_latency", input.route),
    type: "trace_p95_latency",
    label: `${input.route} p95 latency`,
    severity,
    observedValue: input.observed,
    baselineValue: input.baseline,
    changePercent: percentChange(input.observed, input.baseline),
    sampleSize: input.sampleSize,
    baselineSampleSize: input.baselineSampleSize,
    threshold: ">=500 ms and >=2x baseline",
    reason: `p95 latency is ${formatCompactMetric(input.observed)} ms versus ${formatCompactMetric(input.baseline)} ms for the same route baseline.`,
    suggestedAlertRuleType: "trace_p95_latency",
    routePattern: input.route,
    drilldown: "traces"
  };
}

function compareLlmCostAnomaly(input: { observed: number; baseline: number; sampleSize: number; baselineSampleSize: number }): OperationsAnomaly | null {
  if (input.sampleSize < 1 || input.observed < 1) return null;
  const multiplier = ratio(input.observed, input.baseline);
  const delta = input.observed - input.baseline;
  if (input.baseline > 0 && multiplier < 2.5 && delta < 5) return null;
  if (input.baseline === 0 && input.observed < 5) return null;

  const severity: OperationsAnomalySeverity = input.observed >= 25 || multiplier >= 5 ? "critical" : "warning";
  return {
    id: anomalyId("llm_cost", null),
    type: "llm_cost",
    label: "LLM cost",
    severity,
    observedValue: input.observed,
    baselineValue: input.baseline,
    changePercent: percentChange(input.observed, input.baseline),
    sampleSize: input.sampleSize,
    baselineSampleSize: input.baselineSampleSize,
    threshold: ">=2.5x baseline or +$5",
    reason: `LLM cost is $${formatCompactMetric(input.observed)} versus $${formatCompactMetric(input.baseline)} in the prior window.`,
    suggestedAlertRuleType: "llm_cost",
    routePattern: null,
    drilldown: "llm"
  };
}

async function detectOperationsAnomalies(
  db: Db,
  filters: OperationsFilters,
  range: { from: Date; to: Date }
): Promise<OperationsAnomaly[]> {
  const baseline = previousOperationsRange(range.from, range.to);
  const aggregateResult = await sql<{
    current_events: unknown;
    baseline_events: unknown;
    current_errors: unknown;
    baseline_errors: unknown;
    current_traces: unknown;
    baseline_traces: unknown;
    current_error_rate_percent: unknown;
    baseline_error_rate_percent: unknown;
    current_llm_calls: unknown;
    baseline_llm_calls: unknown;
    current_llm_cost: unknown;
    baseline_llm_cost: unknown;
  }>`
    with current_events as (
      select count(*)::numeric as total
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${range.from}
        and timestamp <= ${range.to}
    ),
    baseline_events as (
      select count(*)::numeric as total
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${baseline.from}
        and timestamp < ${baseline.to}
    ),
    current_errors as (
      select count(*)::numeric as total
      from errors
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${range.from}
        and timestamp <= ${range.to}
    ),
    baseline_errors as (
      select count(*)::numeric as total
      from errors
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${baseline.from}
        and timestamp < ${baseline.to}
    ),
    current_traces as (
      select count(*)::numeric as total
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${range.from}
        and timestamp <= ${range.to}
    ),
    baseline_traces as (
      select count(*)::numeric as total
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${baseline.from}
        and timestamp < ${baseline.to}
    ),
    current_llm as (
      select count(*)::numeric as calls, coalesce(sum(cost_usd), 0)::numeric as cost
      from llm_calls
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${range.from}
        and timestamp <= ${range.to}
    ),
    baseline_llm as (
      select count(*)::numeric as calls, coalesce(sum(cost_usd), 0)::numeric as cost
      from llm_calls
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${baseline.from}
        and timestamp < ${baseline.to}
    )
    select
      current_events.total as current_events,
      baseline_events.total as baseline_events,
      current_errors.total as current_errors,
      baseline_errors.total as baseline_errors,
      current_traces.total as current_traces,
      baseline_traces.total as baseline_traces,
      case when current_traces.total = 0 then 0 else (current_errors.total / current_traces.total) * 100 end as current_error_rate_percent,
      case when baseline_traces.total = 0 then 0 else (baseline_errors.total / baseline_traces.total) * 100 end as baseline_error_rate_percent,
      current_llm.calls as current_llm_calls,
      baseline_llm.calls as baseline_llm_calls,
      current_llm.cost as current_llm_cost,
      baseline_llm.cost as baseline_llm_cost
    from current_events, baseline_events, current_errors, baseline_errors, current_traces, baseline_traces, current_llm, baseline_llm
  `.execute(db);

  const row = aggregateResult.rows[0];
  if (!row) return [];

  const anomalies = [
    compareVolumeAnomaly({
      type: "event_volume",
      label: "Event volume",
      observed: toNumber(row.current_events),
      baseline: toNumber(row.baseline_events),
      suggestedAlertRuleType: null,
      drilldown: "events"
    }),
    compareVolumeAnomaly({
      type: "error_volume",
      label: "Error volume",
      observed: toNumber(row.current_errors),
      baseline: toNumber(row.baseline_errors),
      suggestedAlertRuleType: "error_count",
      drilldown: "errors"
    }),
    compareRateAnomaly({
      observed: toNumber(row.current_error_rate_percent),
      baseline: toNumber(row.baseline_error_rate_percent),
      sampleSize: toNumber(row.current_traces),
      baselineSampleSize: toNumber(row.baseline_traces)
    }),
    compareLlmCostAnomaly({
      observed: toNumber(row.current_llm_cost),
      baseline: toNumber(row.baseline_llm_cost),
      sampleSize: toNumber(row.current_llm_calls),
      baselineSampleSize: toNumber(row.baseline_llm_calls)
    })
  ].filter((item): item is OperationsAnomaly => item !== null);

  const routeBaselineResult = await sql<{
    name: string;
    current_p95_trace_duration_ms: unknown;
    baseline_p95_trace_duration_ms: unknown;
    current_traces: unknown;
    baseline_traces: unknown;
  }>`
    with current_routes as (
      select name,
        percentile_cont(0.95) within group (order by duration_ms) as p95_trace_duration_ms,
        count(*) as traces
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${range.from}
        and timestamp <= ${range.to}
        and duration_ms is not null
      group by name
    ),
    baseline_routes as (
      select name,
        percentile_cont(0.95) within group (order by duration_ms) as p95_trace_duration_ms,
        count(*) as traces
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${baseline.from}
        and timestamp < ${baseline.to}
        and duration_ms is not null
      group by name
    )
    select current_routes.name,
      current_routes.p95_trace_duration_ms as current_p95_trace_duration_ms,
      baseline_routes.p95_trace_duration_ms as baseline_p95_trace_duration_ms,
      current_routes.traces as current_traces,
      baseline_routes.traces as baseline_traces
    from current_routes
    inner join baseline_routes on baseline_routes.name = current_routes.name
    order by current_routes.p95_trace_duration_ms desc nulls last, current_routes.traces desc
    limit 10
  `.execute(db);

  for (const routeRow of routeBaselineResult.rows) {
    const anomaly = compareLatencyAnomaly({
      route: routeRow.name,
      observed: toNumber(routeRow.current_p95_trace_duration_ms),
      baseline: toNumber(routeRow.baseline_p95_trace_duration_ms),
      sampleSize: toNumber(routeRow.current_traces),
      baselineSampleSize: toNumber(routeRow.baseline_traces)
    });
    if (anomaly) anomalies.push(anomaly);
  }

  return anomalies
    .sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity] || (b.changePercent ?? 0) - (a.changePercent ?? 0);
    })
    .slice(0, 6);
}

function monitorStatusCounts(rows: MonitorRow[], kind: MonitorKind): StatusCounts {
  return rows
    .filter((row) => row.kind === kind)
    .reduce((counts, row) => {
      counts.total += 1;
      counts[row.status] += 1;
      return counts;
    }, emptyStatusCounts());
}

function buildSetupGaps(input: {
  httpMonitors: number;
  heartbeatMonitors: number;
  enabledAlertRules: number;
  enabledChannels: number;
  recentTelemetry: number;
}): SetupGap[] {
  const gaps: SetupGap[] = [];
  if (input.httpMonitors === 0) {
    gaps.push({ key: "http_monitor", label: "No HTTP uptime monitor", severity: "warning", action: "monitors" });
  }
  if (input.heartbeatMonitors === 0) {
    gaps.push({ key: "heartbeat_monitor", label: "No heartbeat monitor", severity: "warning", action: "monitors" });
  }
  if (input.enabledAlertRules === 0) {
    gaps.push({ key: "alert_rule", label: "No enabled alert rule", severity: "warning", action: "alerts" });
  }
  if (input.enabledChannels === 0) {
    gaps.push({
      key: "notification_channel",
      label: "No enabled notification channel",
      severity: "warning",
      action: "alerts"
    });
  }
  if (input.recentTelemetry === 0) {
    gaps.push({ key: "recent_telemetry", label: "No telemetry in this window", severity: "info", action: "overview" });
  }
  return gaps;
}

function resolveStatus(input: {
  monitorRows: MonitorRow[];
  enabledAlertRules: number;
  alertCritical: number;
  deliveryFailed: number;
  recentTelemetry: number;
  historicalTelemetry: number;
  incidents: { urgent: number; high: number };
}): OperationsStatus {
  const enabledMonitors = input.monitorRows.filter((row) => row.enabled);
  if (enabledMonitors.length === 0 && input.enabledAlertRules === 0 && input.recentTelemetry === 0) {
    return "not_configured";
  }
  if (
    enabledMonitors.some((row) => row.status === "down") ||
    input.alertCritical > 0
  ) {
    return "unhealthy";
  }
  if (
    enabledMonitors.some((row) => row.status === "degraded" || row.status === "unknown") ||
    input.deliveryFailed > 0 ||
    input.incidents.urgent > 0 ||
    input.incidents.high > 0 ||
    (input.recentTelemetry === 0 && input.historicalTelemetry > 0)
  ) {
    return "degraded";
  }
  return "healthy";
}

async function getRiskSignalSnapshot(db: Db, filters: OperationsFilters, range: { from: Date; to: Date }): Promise<RiskSignalSnapshot> {
  const result = await sql<{
    events: unknown;
    errors: unknown;
    traces: unknown;
    failed_traces: unknown;
    alert_events: unknown;
    critical_alert_events: unknown;
    warning_alert_events: unknown;
    delivery_failures: unknown;
    error_rate_percent: unknown;
    p95_trace_duration_ms: unknown;
  }>`
    with scoped_events as (
      select id
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${range.from}
        and timestamp <= ${range.to}
    ),
    scoped_errors as (
      select id
      from errors
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${range.from}
        and timestamp <= ${range.to}
    ),
    scoped_traces as (
      select status, duration_ms
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${range.from}
        and timestamp <= ${range.to}
    ),
    scoped_alerts as (
      select alert_events.id,
        alert_events.severity,
        latest_delivery.status as latest_delivery_status
      from alert_events
      left join lateral (
        select status
        from notification_deliveries
        where notification_deliveries.alert_event_id = alert_events.id
        order by attempted_at desc, created_at desc
        limit 1
      ) latest_delivery on true
      where alert_events.project_id = ${filters.projectId}
        and alert_events.environment_id = ${filters.environmentId}
        and alert_events.triggered_at >= ${range.from}
        and alert_events.triggered_at <= ${range.to}
    )
    select
      (select count(*) from scoped_events) as events,
      (select count(*) from scoped_errors) as errors,
      (select count(*) from scoped_traces) as traces,
      (select count(*) from scoped_traces where status = 'error') as failed_traces,
      (select count(*) from scoped_alerts) as alert_events,
      (select count(*) from scoped_alerts where severity = 'critical') as critical_alert_events,
      (select count(*) from scoped_alerts where severity = 'warning') as warning_alert_events,
      (select count(*) from scoped_alerts where latest_delivery_status = 'failed') as delivery_failures,
      case
        when (select count(*) from scoped_traces) = 0 then 0
        else (((select count(*) from scoped_errors)::numeric / (select count(*) from scoped_traces)::numeric) * 100)
      end as error_rate_percent,
      coalesce((select percentile_cont(0.95) within group (order by duration_ms) from scoped_traces where duration_ms is not null), 0) as p95_trace_duration_ms
  `.execute(db);
  const row = result.rows[0];
  return {
    events: toNumber(row?.events),
    errors: toNumber(row?.errors),
    traces: toNumber(row?.traces),
    failedTraces: toNumber(row?.failed_traces),
    alertEvents: toNumber(row?.alert_events),
    criticalAlertEvents: toNumber(row?.critical_alert_events),
    warningAlertEvents: toNumber(row?.warning_alert_events),
    deliveryFailures: toNumber(row?.delivery_failures),
    errorRatePercent: toNumber(row?.error_rate_percent),
    p95TraceDurationMs: toNumber(row?.p95_trace_duration_ms)
  };
}

function riskSeverity(score: number): OperationsPredictionSeverity {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function riskConfidence(currentSampleSize: number, baselineSampleSize: number): OperationsPredictionConfidence {
  if (currentSampleSize >= 50 && baselineSampleSize >= 20) return "high";
  if (currentSampleSize >= 10 || baselineSampleSize >= 10) return "medium";
  return "low";
}

function compactFactorValue(value: number): string {
  if (Math.abs(value) >= 100) return String(Math.round(value));
  if (Math.abs(value) >= 10) return String(Number(value.toFixed(1)));
  return String(Number(value.toFixed(2)));
}

function buildRiskScore(input: {
  snapshot: RiskSignalSnapshot;
  monitorDown: number;
  monitorDegraded: number;
  incidents: { open: number; investigating: number; urgent: number; high: number; regressed: number };
  anomalies: OperationsAnomaly[];
  setupGaps: SetupGap[];
  historicalTelemetry: number;
}): { score: number; factors: OperationsPredictionFactor[] } {
  const factors: OperationsPredictionFactor[] = [];
  const addFactor = (
    key: string,
    label: string,
    weight: number,
    observedValue: number,
    baselineValue: number | null,
    reason: string,
    impact: "positive" | "negative" = "negative"
  ) => {
    if (weight <= 0) return;
    factors.push({ key, label, impact, weight, observedValue, baselineValue, reason });
  };

  const criticalAnomalies = input.anomalies.filter((anomaly) => anomaly.severity === "critical").length;
  const warningAnomalies = input.anomalies.filter((anomaly) => anomaly.severity === "warning").length;
  addFactor(
    "critical_anomalies",
    "Critical anomalies",
    criticalAnomalies * 18 + warningAnomalies * 8,
    criticalAnomalies + warningAnomalies,
    null,
    `${criticalAnomalies} critical and ${warningAnomalies} warning anomalies versus the previous window.`
  );

  addFactor(
    "down_monitors",
    "Down monitors",
    input.monitorDown * 25 + input.monitorDegraded * 10,
    input.monitorDown + input.monitorDegraded,
    null,
    `${input.monitorDown} monitors are down and ${input.monitorDegraded} are degraded or unknown.`
  );

  addFactor(
    "urgent_incidents",
    "Urgent incidents",
    input.incidents.urgent * 22 + input.incidents.regressed * 10,
    input.incidents.urgent + input.incidents.regressed,
    null,
    `${input.incidents.urgent} urgent incidents and ${input.incidents.regressed} regressions are active.`
  );

  addFactor(
    "high_priority_incidents",
    "High priority incidents",
    input.incidents.high * 12 + Math.max(input.incidents.open + input.incidents.investigating - input.incidents.high - input.incidents.urgent, 0) * 4,
    input.incidents.open + input.incidents.investigating,
    null,
    `${input.incidents.open + input.incidents.investigating} active incidents include ${input.incidents.high} high priority groups.`
  );

  addFactor(
    "critical_alerts",
    "Critical alert firings",
    input.snapshot.criticalAlertEvents * 16 + input.snapshot.warningAlertEvents * 5,
    input.snapshot.criticalAlertEvents + input.snapshot.warningAlertEvents,
    null,
    `${input.snapshot.criticalAlertEvents} critical and ${input.snapshot.warningAlertEvents} warning alert events fired.`
  );

  addFactor(
    "alert_delivery_failures",
    "Alert delivery failures",
    input.snapshot.deliveryFailures * 10,
    input.snapshot.deliveryFailures,
    null,
    `${input.snapshot.deliveryFailures} alert deliveries failed in this window.`
  );

  addFactor(
    "error_rate",
    "Error rate",
    input.snapshot.errorRatePercent >= 10 ? 22 : input.snapshot.errorRatePercent >= 5 ? 12 : 0,
    input.snapshot.errorRatePercent,
    null,
    `Error rate is ${compactFactorValue(input.snapshot.errorRatePercent)}% across ${input.snapshot.traces} traces.`
  );

  addFactor(
    "failed_traces",
    "Failed traces",
    input.snapshot.failedTraces >= 10 ? 12 : input.snapshot.failedTraces > 0 ? 6 : 0,
    input.snapshot.failedTraces,
    null,
    `${input.snapshot.failedTraces} traces failed in this window.`
  );

  addFactor(
    "p95_latency",
    "P95 latency",
    input.snapshot.p95TraceDurationMs >= 1500 ? 16 : input.snapshot.p95TraceDurationMs >= 750 ? 10 : input.snapshot.p95TraceDurationMs >= 500 ? 6 : 0,
    input.snapshot.p95TraceDurationMs,
    null,
    `Global p95 trace latency is ${Math.round(input.snapshot.p95TraceDurationMs)} ms.`
  );

  addFactor(
    "telemetry_freshness",
    "Telemetry freshness",
    input.snapshot.events + input.snapshot.errors + input.snapshot.traces === 0 && input.historicalTelemetry > 0 ? 10 : 0,
    input.snapshot.events + input.snapshot.errors + input.snapshot.traces,
    null,
    "This environment had telemetry before, but none arrived in the current window."
  );

  addFactor(
    "setup_gaps",
    "Setup gaps",
    input.historicalTelemetry > 0 ? Math.min(input.setupGaps.filter((gap) => gap.severity === "warning").length * 5, 15) : 0,
    input.setupGaps.length,
    null,
    `${input.setupGaps.length} setup gaps reduce monitoring coverage.`
  );

  const sortedFactors = factors
    .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
    .slice(0, 8);
  const score = Math.min(100, Math.round(sortedFactors.reduce((total, factor) => total + factor.weight, 0)));
  return { score, factors: sortedFactors };
}

function suggestedRiskDrilldown(factors: OperationsPredictionFactor[]): OperationsPrediction["suggestedDrilldown"] {
  const top = factors[0]?.key;
  if (!top) return "operations";
  if (top.includes("monitor")) return "monitors";
  if (top.includes("alert")) return "alerts";
  if (top.includes("latency") || top.includes("trace")) return "traces";
  if (top.includes("incident") || top.includes("error")) return "errors";
  return "operations";
}

async function buildOperationsPredictions(input: {
  db: Db;
  filters: OperationsFilters;
  range: { from: Date; to: Date };
  monitorRows: MonitorRow[];
  incidentSummary: { open: number; investigating: number; urgent: number; high: number; regressed: number };
  anomalies: OperationsAnomaly[];
  setupGaps: SetupGap[];
  historicalTelemetry: number;
}): Promise<OperationsPrediction[]> {
  const baselineRange = previousOperationsRange(input.range.from, input.range.to);
  const [currentSnapshot, baselineSnapshot] = await Promise.all([
    getRiskSignalSnapshot(input.db, input.filters, input.range),
    getRiskSignalSnapshot(input.db, input.filters, baselineRange)
  ]);
  const currentMonitorDown = input.monitorRows.filter((row) => row.enabled && row.status === "down").length;
  const currentMonitorDegraded = input.monitorRows.filter((row) => row.enabled && (row.status === "degraded" || row.status === "unknown")).length;
  const current = buildRiskScore({
    snapshot: currentSnapshot,
    monitorDown: currentMonitorDown,
    monitorDegraded: currentMonitorDegraded,
    incidents: input.incidentSummary,
    anomalies: input.anomalies,
    setupGaps: input.setupGaps,
    historicalTelemetry: input.historicalTelemetry
  });
  const baseline = buildRiskScore({
    snapshot: baselineSnapshot,
    monitorDown: 0,
    monitorDegraded: 0,
    incidents: { open: 0, investigating: 0, urgent: 0, high: 0, regressed: 0 },
    anomalies: [],
    setupGaps: [],
    historicalTelemetry: input.historicalTelemetry
  });
  const currentSampleSize = currentSnapshot.events + currentSnapshot.errors + currentSnapshot.traces + currentSnapshot.alertEvents;
  const baselineSampleSize = baselineSnapshot.events + baselineSnapshot.errors + baselineSnapshot.traces + baselineSnapshot.alertEvents;
  const score = current.score;

  return [
    {
      id: "pred_operational_risk",
      type: "operational_risk",
      label: "Operational risk",
      horizon: "next_window",
      severity: riskSeverity(score),
      score,
      confidence: riskConfidence(currentSampleSize, baselineSampleSize),
      probabilityPercent: Math.min(95, Math.max(5, Math.round(5 + score * 0.9))),
      validation: {
        baselineWindow: { from: baselineRange.from.toISOString(), to: baselineRange.to.toISOString() },
        currentWindow: { from: input.range.from.toISOString(), to: input.range.to.toISOString() },
        baselineRiskScore: baseline.score,
        delta: score - baseline.score,
        sampleSize: currentSampleSize,
        baselineSampleSize,
        method: "heuristic-weighted-baseline-v1"
      },
      factors: current.factors,
      suggestedDrilldown: suggestedRiskDrilldown(current.factors)
    }
  ];
}

export async function getOperations(db: Db, filters: OperationsFilters): Promise<OperationsResponse> {
  const { from, to } = resolveOperationsRange(filters.window, filters.now);

  const [monitorRows, alertRuleRow, alertEventResult] = await Promise.all([
    db
      .selectFrom("monitors")
      .select([
        "id",
        "kind",
        "name",
        "enabled",
        "status",
        "last_checked_at",
        "last_heartbeat_at",
        "last_check_latency_ms",
        "last_check_error_message"
      ])
      .where("project_id", "=", filters.projectId)
      .where("environment_id", "=", filters.environmentId)
      .where("archived_at", "is", null)
      .orderBy(
        sql<number>`case status when 'down' then 0 when 'degraded' then 1 when 'unknown' then 2 when 'up' then 3 when 'paused' then 4 else 5 end`
      )
      .orderBy("updated_at", "desc")
      .limit(10)
      .execute() as Promise<MonitorRow[]>,
    db
      .selectFrom("alert_rules")
      .select(({ fn }) => [
        fn.countAll<string>().as("total"),
        sql<string>`count(*) filter (where enabled = true)`.as("enabled")
      ])
      .where("project_id", "=", filters.projectId)
      .where("environment_id", "=", filters.environmentId)
      .where("archived_at", "is", null)
      .executeTakeFirstOrThrow(),
    sql<AlertEventRow>`
      select alert_events.id,
        alert_events.severity,
        alert_events.triggered_at,
        alert_events.message,
        latest_delivery.status as latest_delivery_status
      from alert_events
      left join lateral (
        select status
        from notification_deliveries
        where notification_deliveries.alert_event_id = alert_events.id
        order by attempted_at desc, created_at desc
        limit 1
      ) latest_delivery on true
      where alert_events.project_id = ${filters.projectId}
        and alert_events.environment_id = ${filters.environmentId}
        and alert_events.triggered_at >= ${from}
        and alert_events.triggered_at <= ${to}
      order by alert_events.triggered_at desc, alert_events.created_at desc
      limit 10
    `.execute(db)
  ]);
  const anomaliesPromise = detectOperationsAnomalies(db, filters, { from, to });

  const alertSummary = alertEventResult.rows.reduce(
    (summary, row) => {
      summary.total += 1;
      if (row.severity === "critical") summary.critical += 1;
      if (row.severity === "warning") summary.warning += 1;
      if (row.latest_delivery_status === "failed") summary.deliveryFailed += 1;
      if (row.latest_delivery_status === null) summary.deliveryPending += 1;
      return summary;
    },
    { total: 0, critical: 0, warning: 0, deliveryFailed: 0, deliveryPending: 0 }
  );

  const telemetryResult = await sql<{
    events: unknown;
    errors: unknown;
    traces: unknown;
    failed_traces: unknown;
    last_event_at: Date | string | null;
    last_error_at: Date | string | null;
    last_trace_at: Date | string | null;
    p95_trace_duration_ms: unknown;
    error_rate_percent: unknown;
  }>`
    with scoped_events as (
      select timestamp
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    scoped_errors as (
      select timestamp
      from errors
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    scoped_traces as (
      select timestamp, status, duration_ms
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    )
    select
      (select count(*) from scoped_events) as events,
      (select count(*) from scoped_errors) as errors,
      (select count(*) from scoped_traces) as traces,
      (select count(*) from scoped_traces where status = 'error') as failed_traces,
      (select max(timestamp) from scoped_events) as last_event_at,
      (select max(timestamp) from scoped_errors) as last_error_at,
      (select max(timestamp) from scoped_traces) as last_trace_at,
      (select percentile_cont(0.95) within group (order by duration_ms) from scoped_traces where duration_ms is not null) as p95_trace_duration_ms,
      case
        when (select count(*) from scoped_traces) = 0 then null
        else (((select count(*) from scoped_errors)::numeric / (select count(*) from scoped_traces)::numeric) * 100)
      end as error_rate_percent
  `.execute(db);
  const telemetryRow = telemetryResult.rows[0];

  const incidentRows = await db
    .selectFrom("error_groups")
    .select(["id", "message", "severity", "status", "priority", "last_seen_at", "latest_error_id"])
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId)
    .where("status", "in", ["open", "investigating"])
    .orderBy(sql<number>`case priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end`)
    .orderBy(
      sql<number>`case severity when 'fatal' then 0 when 'critical' then 1 when 'error' then 2 when 'warning' then 3 when 'info' then 4 when 'debug' then 5 else 6 end`
    )
    .orderBy("last_seen_at", "desc")
    .limit(5)
    .execute() as IncidentRow[];

  const incidentSummaryRow = await db
    .selectFrom("error_groups")
    .select(() => [
      sql<string>`count(*) filter (where status = 'open')`.as("open"),
      sql<string>`count(*) filter (where status = 'investigating')`.as("investigating"),
      sql<string>`count(*) filter (where status in ('open', 'investigating') and priority = 'urgent')`.as("urgent"),
      sql<string>`count(*) filter (where status in ('open', 'investigating') and priority = 'high')`.as("high"),
      sql<string>`count(*) filter (where status in ('open', 'investigating') and last_regressed_at >= ${from})`.as("regressed")
    ])
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId)
    .executeTakeFirstOrThrow();

  const topLatencyResult = await sql<{
    name: string;
    p95_trace_duration_ms: unknown;
    traces: unknown;
    failed_traces: unknown;
  }>`
    select name,
      percentile_cont(0.95) within group (order by duration_ms) as p95_trace_duration_ms,
      count(*) as traces,
      count(*) filter (where status = 'error') as failed_traces
    from traces
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
      and duration_ms is not null
    group by name
    order by p95_trace_duration_ms desc nulls last, count(*) desc, name asc
    limit 5
  `.execute(db);

  const enabledChannelResult = await sql<{ total: unknown }>`
    with scoped_channel_ids as (
      select notification_channel_id as id
      from alert_rules
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and archived_at is null
        and notification_channel_id is not null
      union
      select notification_channel_id as id
      from monitors
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and archived_at is null
        and notification_channel_id is not null
    )
    select count(distinct notification_channels.id) as total
    from notification_channels
    inner join scoped_channel_ids on scoped_channel_ids.id = notification_channels.id
    where notification_channels.enabled = true
      and notification_channels.archived_at is null
  `.execute(db);

  const historicalTelemetryResult = await sql<{ total: unknown }>`
    select
      (select count(*) from events where project_id = ${filters.projectId} and environment_id = ${filters.environmentId}) +
      (select count(*) from errors where project_id = ${filters.projectId} and environment_id = ${filters.environmentId}) +
      (select count(*) from traces where project_id = ${filters.projectId} and environment_id = ${filters.environmentId}) as total
  `.execute(db);

  const httpCounts = monitorStatusCounts(monitorRows, "http");
  const heartbeatCounts = monitorStatusCounts(monitorRows, "heartbeat");
  const recentTelemetry = toNumber(telemetryRow.events) + toNumber(telemetryRow.errors) + toNumber(telemetryRow.traces);
  const alertRules = {
    total: toNumber(alertRuleRow.total),
    enabled: toNumber(alertRuleRow.enabled)
  };
  const incidentSummary = {
    open: toNumber(incidentSummaryRow.open),
    investigating: toNumber(incidentSummaryRow.investigating),
    urgent: toNumber(incidentSummaryRow.urgent),
    high: toNumber(incidentSummaryRow.high),
    regressed: toNumber(incidentSummaryRow.regressed)
  };
  const setupGaps = buildSetupGaps({
    httpMonitors: httpCounts.total,
    heartbeatMonitors: heartbeatCounts.total,
    enabledAlertRules: alertRules.enabled,
    enabledChannels: toNumber(enabledChannelResult.rows[0]?.total),
    recentTelemetry
  });
  const status = resolveStatus({
    monitorRows,
    enabledAlertRules: alertRules.enabled,
    alertCritical: alertSummary.critical,
    deliveryFailed: alertSummary.deliveryFailed,
    recentTelemetry,
    historicalTelemetry: toNumber(historicalTelemetryResult.rows[0]?.total),
    incidents: { urgent: incidentSummary.urgent, high: incidentSummary.high }
  });
  const anomalies = await anomaliesPromise;
  const predictions = await buildOperationsPredictions({
    db,
    filters,
    range: { from, to },
    monitorRows,
    incidentSummary,
    anomalies,
    setupGaps,
    historicalTelemetry: toNumber(historicalTelemetryResult.rows[0]?.total)
  });

  return {
    window: filters.window,
    generatedAt: to.toISOString(),
    scope: {
      projectId: filters.projectId,
      environmentId: filters.environmentId
    },
    range: {
      from: from.toISOString(),
      to: to.toISOString()
    },
    status,
    summary: {
      monitors: {
        total: monitorRows.length,
        http: httpCounts,
        heartbeat: heartbeatCounts
      },
      alerts: {
        rules: alertRules,
        events: alertSummary
      },
      telemetry: {
        events: toNumber(telemetryRow.events),
        errors: toNumber(telemetryRow.errors),
        traces: toNumber(telemetryRow.traces),
        failedTraces: toNumber(telemetryRow.failed_traces),
        errorRatePercent: toNullableNumber(telemetryRow.error_rate_percent),
        p95TraceDurationMs: toNullableNumber(telemetryRow.p95_trace_duration_ms),
        lastEventAt: toIso(telemetryRow.last_event_at),
        lastErrorAt: toIso(telemetryRow.last_error_at),
        lastTraceAt: toIso(telemetryRow.last_trace_at)
      },
      incidents: incidentSummary
    },
    recent: {
      monitors: monitorRows.map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        status: row.status,
        lastCheckedAt: toIso(row.last_checked_at),
        lastHeartbeatAt: toIso(row.last_heartbeat_at),
        lastCheckLatencyMs: row.last_check_latency_ms,
        lastCheckErrorMessage: row.last_check_error_message
      })),
      alerts: alertEventResult.rows.map((row) => ({
        id: row.id,
        severity: row.severity,
        triggeredAt: toIso(row.triggered_at) ?? to.toISOString(),
        message: row.message,
        latestDeliveryStatus: row.latest_delivery_status
      })),
      incidents: incidentRows.map((row) => ({
        id: row.id,
        message: row.message,
        severity: row.severity,
        status: row.status,
        priority: row.priority,
        lastSeenAt: toIso(row.last_seen_at) ?? to.toISOString(),
        latestErrorId: row.latest_error_id
      }))
    },
    topLatency: topLatencyResult.rows.map((row) => ({
      name: row.name,
      p95TraceDurationMs: toNumber(row.p95_trace_duration_ms),
      traces: toNumber(row.traces),
      failedTraces: toNumber(row.failed_traces)
    })),
    anomalies,
    predictions,
    setupGaps
  };
}

export const __test = {
  toNumber,
  toNullableNumber
};
