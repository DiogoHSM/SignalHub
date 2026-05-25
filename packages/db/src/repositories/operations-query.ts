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

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

export async function getOperations(db: Db, filters: OperationsFilters): Promise<OperationsResponse> {
  const { from, to } = resolveOperationsRange(filters.window, filters.now);

  const monitorRows = await db
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
    .execute() as MonitorRow[];

  const alertRuleRow = await db
    .selectFrom("alert_rules")
    .select(({ fn }) => [
      fn.countAll<string>().as("total"),
      sql<string>`count(*) filter (where enabled = true)`.as("enabled")
    ])
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId)
    .where("archived_at", "is", null)
    .executeTakeFirstOrThrow();

  const alertEventResult = await sql<AlertEventRow>`
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
  `.execute(db);

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
      (select count(*) from scoped_traces where status <> 'success') as failed_traces,
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
      count(*) filter (where status <> 'success') as failed_traces
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
    setupGaps
  };
}
