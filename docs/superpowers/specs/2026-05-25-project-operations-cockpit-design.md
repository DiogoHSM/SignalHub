# Project Operations Cockpit Design

Date: 2026-05-25
Status: Approved for spec review

## Goal

Add a project/environment-scoped `Operations` mode that answers the operator question: "Is this project healthy right now?"

The new mode complements, but does not replace:

- `Overview`: analytical summary of telemetry and product usage.
- `Investigate`: raw and grouped signal investigation.
- `Alerts`: alert rule and notification-channel configuration.
- `Monitors`: HTTP and heartbeat monitor configuration.
- `System`: global health of the Sigmon installation itself.

## Product Model

`System` remains global and installation-scoped. It is about Sigmon's own API, database, Redis, queue worker, scheduler, SMTP config, retention, source maps, and backups.

`Operations` is project-scoped. It uses the active project and environment and summarizes that monitored application's health: uptime, heartbeats, error rate, latency, open incidents, firing alerts, and setup gaps.

This separation matters because `my.sigmon.app` can itself be monitored as a normal project, for dogfooding, while `System` still reports whether the self-hosted Sigmon install is functioning.

## Navigation

Add `Operations` as a primary rail mode between `Overview` and `Investigate`.

The rail should communicate this hierarchy:

- `Overview`: what happened and how usage is trending.
- `Operations`: whether the selected project/environment is healthy now.
- `Investigate`: why a signal or incident happened.
- `Alerts`, `Monitors`, and `Artifacts`: specialized operational/admin surfaces.
- `System`: Sigmon installation health, visually/admin conceptually separate from project health.

The first implementation can keep `Alerts`, `Monitors`, and `System` in the rail. `Operations` links into them rather than hiding them.

## Scope

The first version is a read-only cockpit with contextual links and drilldowns.

It should show:

- Overall project health status for the active environment.
- A compact KPI strip:
  - HTTP monitors up/down.
  - Heartbeats fresh/stale.
  - Error rate.
  - p95 latency.
  - Open critical or high-priority incidents.
  - Firing alerts.
- Recent operational activity:
  - alert events;
  - monitor checks;
  - recent open/regressed incidents.
- Setup gaps:
  - no HTTP monitors;
  - no heartbeat monitors;
  - no alert rules;
  - no email or webhook channel;
  - no recent telemetry.
- Drilldown cards or rows for:
  - Monitors;
  - Alerts;
  - Incidents;
  - Latency/traces;
  - Errors.

The first version does not create or edit monitors, alert rules, channels, projects, or environments directly. Those actions remain in the specialized screens.

## Backend API

Create a new project/environment-scoped query endpoint:

```http
GET /query/operations?project_id=...&environment_id=...&window=24h
```

Supported windows should match the existing Overview convention where practical:

- `24h`
- `7d`
- `30d`

The endpoint returns a UI-ready aggregate response. It should not require the console to fan out across Overview, Alerts, Monitors, Errors, and Traces endpoints.

Suggested response shape:

```ts
type OperationsStatus = "healthy" | "degraded" | "unhealthy" | "not_configured";

type OperationsResponse = {
  generatedAt: string;
  projectId: string;
  environmentId: string;
  window: "24h" | "7d" | "30d";
  status: OperationsStatus;
  summary: {
    httpMonitors: { up: number; down: number; degraded: number; paused: number };
    heartbeatMonitors: { fresh: number; stale: number; paused: number };
    errorRate: { percentage: number | null; errors: number; traces: number };
    latency: { p95Ms: number | null; sampleSize: number };
    incidents: { open: number; critical: number; high: number; regressed: number };
    alerts: { firing: number; recent: number; deliveryFailures: number };
    ingestion: { lastEventAt: string | null; lastErrorAt: string | null; lastTraceAt: string | null };
  };
  recent: {
    alertEvents: Array<{
      id: string;
      ruleName: string;
      severity: string;
      status: string;
      triggeredAt: string;
    }>;
    monitorChecks: Array<{
      id: string;
      monitorId: string;
      monitorName: string;
      kind: "http" | "heartbeat";
      status: string;
      checkedAt: string;
      latencyMs: number | null;
    }>;
    incidents: Array<{
      groupId: string;
      message: string;
      severity: string;
      priority: string | null;
      status: string;
      occurrenceCount: number;
      lastSeenAt: string;
    }>;
  };
  topLatency: Array<{
    name: string;
    p95Ms: number;
    sampleSize: number;
  }>;
  setupGaps: Array<{
    kind: "http_monitor" | "heartbeat_monitor" | "alert_rule" | "notification_channel" | "telemetry";
    severity: "info" | "warning";
    title: string;
    action: "monitors" | "alerts" | "setup";
  }>;
};
```

The exact names may be adjusted to match existing repository and API conventions, but the endpoint should stay aggregate and UI-ready.

## Status Rules

Initial status can be conservative:

- `unhealthy` if any HTTP monitor is down, any heartbeat monitor is stale, or critical alerts are firing.
- `degraded` if monitors are degraded, alert delivery is failing, p95 is above a configured alert threshold, high-priority incidents are open, or telemetry is stale.
- `not_configured` if the project has no monitor, alert, or recent telemetry data.
- `healthy` otherwise.

If a metric lacks data, it should not pretend to be healthy. The UI should label it clearly as `No data` or `Not configured`.

## UI Layout

Use the Status Command Center layout:

1. Header with project/environment context, generated time, window control, and overall status.
2. KPI strip with six compact cards:
   - HTTP;
   - Heartbeats;
   - Error rate;
   - P95 latency;
   - Open incidents;
   - Alerts firing.
3. Main grid:
   - operational timeline/recent activity;
   - setup gaps;
   - drilldown cards for Monitors, Alerts, Incidents, Errors, and Traces.

The visual style should follow the current redesign foundation:

- dark-first console shell;
- compact cards;
- restrained green signal accents;
- dense operational typography;
- no marketing hero;
- no nested cards.

## Drilldowns

Operations is read-only, but every meaningful card should provide a clear next step.

Expected drilldowns:

- HTTP monitor down or heartbeat stale -> `Monitors`.
- Alert firing or delivery failure -> `Alerts`.
- Open incident -> Incident view for the error group.
- Error rate -> `Investigate > Errors` scoped to the active project/environment and window.
- P95 latency route/name -> `Investigate > Traces` with the trace name filter.
- Missing setup -> `Monitors`, `Alerts`, or `Setup` depending on the gap.

The first implementation may navigate to the target mode with seeded filters rather than selecting a specific row, if row-level selection would create too much coupling.

## Empty And Loading States

If no project is selected, show the same setup-oriented empty state pattern used by other project-scoped modes.

If no environment is selected, point the operator to Setup.

If the project has telemetry but no monitors or alert rules, the cockpit should still render and show setup gaps.

If the operations endpoint fails, show a retryable unavailable state without clearing project/environment context.

## Testing

Backend tests should cover:

- authenticated operations query route;
- required project/environment scope;
- summary aggregation for monitors, heartbeats, alerts, traces, and errors;
- `not_configured` status when no operational data exists;
- unhealthy/degraded precedence;
- setup gap generation.

Frontend tests should cover:

- Operations mode appears in the rail;
- selected project/environment context is shown;
- KPI strip renders healthy/degraded/unhealthy/no-data states;
- setup gaps render with correct target actions;
- drilldown actions switch to the expected mode and pass filters where supported;
- unavailable and empty states are stable.

## Documentation

Update:

- `.claude/docs/UI-UX.md` with the Operations/System separation.
- `README.md` or deployment docs only if the new endpoint changes operator-facing setup guidance.

## Non-Goals

- No configuration forms inside Operations.
- No new alert rule types.
- No monitor CRUD changes.
- No replacement of Overview.
- No replacement of System.
- No per-user customizable dashboards.
