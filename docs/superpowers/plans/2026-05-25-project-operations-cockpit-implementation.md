# Project Operations Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project/environment-scoped `Operations` cockpit that summarizes monitored health, alert state, p95 latency, error rate, ingestion freshness, and active incidents, with drilldowns into existing Monitors, Alerts, Investigate, and Incident views.

**Architecture:** Keep global `System` as Sigmon install health. Add a read-only project `Operations` mode backed by `GET /query/operations`, using a new DB aggregate repository that joins monitors, alert rules/events/deliveries, error groups, and telemetry. The console consumes one aggregate endpoint and routes actions to existing detailed screens.

**Tech Stack:** TypeScript, Fastify, Kysely/Postgres, React, Vite, Vitest, Testing Library, lucide-react.

---

## Scope

- Add `GET /query/operations?project_id=prj_1&environment_id=env_1&window=24h|7d|30d`.
- Add DB aggregate repository `packages/db/src/repositories/operations-query.ts`.
- Add console API types/client support.
- Add `Operations` tab between `Overview` and `Investigate`.
- Add `OperationsDashboard` with status command center layout and drilldown buttons.
- Update docs for the new split between global `System` and project `Operations`.

Out of scope for this plan:

- Creating or editing monitors/alerts inline inside `Operations`.
- Changing alert evaluation semantics.
- Adding notification-channel settings UI beyond existing `AlertsPanel`.
- Adding background worker behavior.

---

## Contract

The new API returns an aggregate envelope:

```ts
type OperationsWindow = "24h" | "7d" | "30d";
type OperationsStatus = "healthy" | "degraded" | "unhealthy" | "not_configured";

type OperationsResponse = {
  window: OperationsWindow;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string; to: string };
  status: OperationsStatus;
  summary: {
    monitors: {
      total: number;
      http: { total: number; up: number; degraded: number; down: number; paused: number; unknown: number };
      heartbeat: { total: number; up: number; degraded: number; down: number; paused: number; unknown: number };
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
    incidents: {
      open: number;
      investigating: number;
      urgent: number;
      high: number;
      regressed: number;
    };
  };
  recent: {
    monitors: Array<{
      id: string;
      kind: "http" | "heartbeat";
      name: string;
      status: "unknown" | "up" | "down" | "degraded" | "paused";
      lastCheckedAt: string | null;
      lastHeartbeatAt: string | null;
      lastCheckLatencyMs: number | null;
      lastCheckErrorMessage: string | null;
    }>;
    alerts: Array<{
      id: string;
      severity: "info" | "warning" | "critical";
      triggeredAt: string;
      message: string;
      latestDeliveryStatus: "success" | "failed" | null;
    }>;
    incidents: Array<{
      id: string;
      message: string;
      severity: string;
      status: "open" | "investigating" | "resolved" | "ignored";
      priority: "urgent" | "high" | "normal" | "low" | null;
      lastSeenAt: string;
      latestErrorId: string | null;
    }>;
  };
  topLatency: Array<{ name: string; p95TraceDurationMs: number; traces: number; failedTraces: number }>;
  setupGaps: Array<{
    key: "http_monitor" | "heartbeat_monitor" | "alert_rule" | "notification_channel" | "recent_telemetry";
    label: string;
    severity: "info" | "warning";
    action: "monitors" | "alerts" | "setup" | "overview";
  }>;
};
```

Status calculation:

- `not_configured`: no monitors, no enabled alert rules, and no recent events/errors/traces in the selected window.
- `unhealthy`: any enabled HTTP monitor is `down`, any enabled heartbeat monitor is `down`, or a critical alert event fired in the selected window.
- `degraded`: any enabled monitor is `degraded` or `unknown`, any alert delivery failed in the selected window, an urgent/high open issue exists, or telemetry exists historically but no events/errors/traces landed in the selected window.
- `healthy`: all other configured states.

---

## Task 1: Add DB Aggregate Tests

- [ ] Modify [packages/db/test/repositories.test.ts](/Users/diogo/Developer/Github/SignalHub/packages/db/test/repositories.test.ts).

- [ ] Add `getOperations` to the imports from `../src/repositories/operations-query.js`.

```ts
import { getOperations } from "../src/repositories/operations-query.js";
```

- [ ] Add a repository test near the overview tests:

```ts
it("builds project operations health from monitors alerts incidents and telemetry", async () => {
  await withDb(async (db) => {
    await migrate(db);

    const project = await createProject(db, { name: "Operations Project" });
    const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
    const now = new Date("2026-05-25T12:00:00.000Z");
    const inWindow = new Date("2026-05-25T11:50:00.000Z");
    const receivedAt = new Date("2026-05-25T11:50:01.000Z");

    const channel = await createNotificationChannel(db, {
      name: "Ops email",
      type: "email",
      emailRecipients: ["ops@example.com"],
      enabled: true
    });

    const httpMonitor = await createHttpMonitor(db, {
      projectId: project.id,
      environmentId: environment.id,
      notificationChannelId: channel.id,
      name: "API uptime",
      url: "https://api.example.com/health",
      method: "GET",
      intervalMinutes: 5,
      timeoutMs: 5000,
      expectedStatus: "2xx",
      failureThreshold: 2,
      recoveryThreshold: 2,
      enabled: true
    });
    await recordMonitorCheck(db, {
      monitorId: httpMonitor.id,
      checkedAt: inWindow,
      status: "success",
      latencyMs: 82,
      responseStatus: 200
    });

    await createHeartbeatMonitor(db, {
      projectId: project.id,
      environmentId: environment.id,
      notificationChannelId: channel.id,
      name: "Queue worker heartbeat",
      expectedIntervalMinutes: 5,
      graceMinutes: 2,
      secretHash: "hashed-secret",
      enabled: true
    });

    const rule = await createAlertRule(db, {
      projectId: project.id,
      environmentId: environment.id,
      notificationChannelId: channel.id,
      name: "Checkout p95",
      type: "trace_p95_latency",
      severity: "warning",
      windowMinutes: 10,
      threshold: "750",
      cooldownMinutes: 20,
      routePattern: "checkout",
      minimumSampleSize: 1,
      enabled: true
    });
    const alertEvent = await recordAlertEvent(db, {
      rule,
      triggeredAt: inWindow,
      windowStart: new Date("2026-05-25T11:40:00.000Z"),
      windowEnd: inWindow,
      observedValue: "900",
      message: "Checkout p95 latency is high",
      metadata: {}
    });
    await recordNotificationDelivery(db, {
      alertEventId: alertEvent.id,
      notificationChannelId: channel.id,
      status: "failed",
      attemptedAt: inWindow,
      responseStatus: null,
      errorMessage: "smtp unavailable"
    });

    await insertEvent(db, {
      projectId: project.id,
      environmentId: environment.id,
      id: "evt_operations_1",
      name: "checkout.started",
      timestamp: inWindow,
      receivedAt
    });
    const errorInput = {
      projectId: project.id,
      environmentId: environment.id,
      id: "err_operations_1",
      message: "Checkout failed",
      severity: "critical",
      status: "open",
      traceId: "trace_checkout_1",
      timestamp: inWindow,
      receivedAt
    };
    await insertError(db, errorInput);
    await insertTrace(db, {
      projectId: project.id,
      environmentId: environment.id,
      id: "trc_checkout_1",
      traceId: "trace_checkout_1",
      name: "checkout",
      status: "error",
      timestamp: inWindow,
      receivedAt,
      startedAt: inWindow,
      durationMs: 900
    });

    const operations = await getOperations(db, {
      projectId: project.id,
      environmentId: environment.id,
      window: "24h",
      now
    });

    expect(operations.status).toBe("degraded");
    expect(operations.summary.monitors.total).toBe(2);
    expect(operations.summary.alerts.events.deliveryFailed).toBe(1);
    expect(operations.summary.telemetry).toMatchObject({
      events: 1,
      errors: 1,
      traces: 1,
      failedTraces: 1,
      errorRatePercent: 100
    });
    expect(operations.topLatency).toEqual([
      { name: "checkout", p95TraceDurationMs: 900, traces: 1, failedTraces: 1 }
    ]);
    expect(operations.recent.alerts[0]).toMatchObject({
      message: "Checkout p95 latency is high",
      latestDeliveryStatus: "failed"
    });
    expect(operations.setupGaps.map((gap) => gap.key)).not.toContain("http_monitor");
  });
});
```

- [ ] Add a second test for empty environments:

```ts
it("marks operations as not configured when no operational data exists", async () => {
  await withDb(async (db) => {
    await migrate(db);

    const project = await createProject(db, { name: "Empty Operations Project" });
    const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

    const operations = await getOperations(db, {
      projectId: project.id,
      environmentId: environment.id,
      window: "24h",
      now: new Date("2026-05-25T12:00:00.000Z")
    });

    expect(operations.status).toBe("not_configured");
    expect(operations.setupGaps.map((gap) => gap.key)).toEqual([
      "http_monitor",
      "heartbeat_monitor",
      "alert_rule",
      "notification_channel",
      "recent_telemetry"
    ]);
  });
});
```

- [ ] Run the focused DB test and confirm it fails because `operations-query.js` does not exist:

```bash
pnpm --filter @sigmon/db test -- repositories.test.ts --runInBand
```

---

## Task 2: Implement `operations-query` Repository

- [ ] Create [packages/db/src/repositories/operations-query.ts](/Users/diogo/Developer/Github/SignalHub/packages/db/src/repositories/operations-query.ts).

- [ ] Use this public shape:

```ts
import { sql } from "kysely";
import type { Db } from "../client.js";

export type OperationsWindow = "24h" | "7d" | "30d";
export type OperationsStatus = "healthy" | "degraded" | "unhealthy" | "not_configured";

export type OperationsFilters = {
  projectId: string;
  environmentId: string;
  window: OperationsWindow;
  now?: Date;
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
```

- [ ] Add local helpers:

```ts
type StatusCounts = { total: number; up: number; degraded: number; down: number; paused: number; unknown: number };

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

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
```

- [ ] Implement `getOperations(db, filters)` with these queries:

1. `monitorRows`: active monitors scoped by `project_id`, `environment_id`, `archived_at is null`, ordered unhealthy first.
2. `alertRuleRow`: total and enabled alert rules scoped by project/environment.
3. `alertEventRows`: alert events in the selected range with latest delivery status via the same lateral join pattern used by `listAlertEvents`.
4. `telemetryRow`: counts events/errors/traces, failed traces, last timestamps, error rate percent, and p95 trace duration.
5. `incidentRows`: top open/investigating error groups ordered by priority, severity, regressed, and last seen.
6. `incidentSummaryRow`: counts open, investigating, urgent, high, and regressed groups.
7. `topLatencyRows`: grouped traces by `name`, with p95 and failed count, ordered by p95 desc.
8. `enabledChannelRow`: count enabled non-archived notification channels.
9. `historicalTelemetryRow`: count any telemetry for the scope before deciding stale configured states.

- [ ] Use this p95/error-rate SQL pattern inside the telemetry query:

```sql
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
```

- [ ] Build `setupGaps` in TypeScript:

```ts
const setupGaps: SetupGap[] = [];
if (monitorSummary.http.total === 0) setupGaps.push({ key: "http_monitor", label: "No HTTP uptime monitor", severity: "warning", action: "monitors" });
if (monitorSummary.heartbeat.total === 0) setupGaps.push({ key: "heartbeat_monitor", label: "No heartbeat monitor", severity: "warning", action: "monitors" });
if (alertRules.enabled === 0) setupGaps.push({ key: "alert_rule", label: "No enabled alert rule", severity: "warning", action: "alerts" });
if (enabledChannels === 0) setupGaps.push({ key: "notification_channel", label: "No enabled notification channel", severity: "warning", action: "alerts" });
if (telemetryTotal === 0) setupGaps.push({ key: "recent_telemetry", label: "No telemetry in this window", severity: "info", action: "overview" });
```

- [ ] Implement `status` with the contract rules. Use enabled monitor rows for `down/degraded/unknown` checks so disabled monitors do not poison the status.

- [ ] Run:

```bash
pnpm --filter @sigmon/db test -- repositories.test.ts --runInBand
```

Expected result: the new operations repository tests pass.

- [ ] Commit:

```bash
git add packages/db/src/repositories/operations-query.ts packages/db/test/repositories.test.ts
git commit -m "feat: add project operations aggregate"
```

---

## Task 3: Add API Route

- [ ] Modify [apps/api/src/routes/query.ts](/Users/diogo/Developer/Github/SignalHub/apps/api/src/routes/query.ts).

- [ ] Add types:

```ts
export type OperationsWindow = "24h" | "7d" | "30d";

export type OperationsFilters = {
  projectId: string;
  environmentId: string;
  window: OperationsWindow;
};
```

- [ ] Add dependency field:

```ts
getOperations?: (filters: OperationsFilters) => Promise<unknown>;
```

- [ ] Add parser, mirroring `parseOverviewFilters`:

```ts
function parseOperationsFilters(query: unknown): OperationsFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) return undefined;

  const rawWindow = optionalNonEmpty(raw, "window") ?? "24h";
  if (rawWindow !== "24h" && rawWindow !== "7d" && rawWindow !== "30d") return undefined;

  return { projectId, environmentId, window: rawWindow };
}
```

- [ ] Add handler:

```ts
async function handleOperationsRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) return reply;

  if (!options.query?.getOperations) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseOperationsFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getOperations(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}
```

- [ ] Register route inside `registerQueryRoutes` near `/query/overview`:

```ts
app.get("/query/operations", (request, reply) => handleOperationsRoute(request, reply, options));
```

- [ ] Modify [apps/api/src/main.ts](/Users/diogo/Developer/Github/SignalHub/apps/api/src/main.ts):

```ts
import { getOperations } from "@sigmon/db/repositories/operations-query.js";
```

and wire:

```ts
getOperations: (filters) => getOperations(db, filters),
```

- [ ] Modify [apps/api/test/query.test.ts](/Users/diogo/Developer/Github/SignalHub/apps/api/test/query.test.ts).

- [ ] Add tests:

```ts
it("forwards default operations filters", async () => {
  const receivedFilters: unknown[] = [];
  app = await buildApp({
    readiness,
    auth: humanAuth,
    query: {
      getOperations: async (filters) => {
        receivedFilters.push(filters);
        return { status: "healthy" };
      }
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/query/operations?project_id=prj_1&environment_id=env_1"
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ data: { status: "healthy" } });
  expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", window: "24h" }]);
});
```

```ts
it("rejects unsupported operations windows", async () => {
  app = await buildApp({
    readiness,
    auth: humanAuth,
    query: { getOperations: async () => ({ status: "healthy" }) }
  });

  const response = await app.inject({
    method: "GET",
    url: "/query/operations?project_id=prj_1&environment_id=env_1&window=custom"
  });

  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: "invalid_query" });
});
```

```ts
it("returns 501 when operations query dependency is missing", async () => {
  app = await buildApp({ readiness, auth: humanAuth, query: {} });

  const response = await app.inject({
    method: "GET",
    url: "/query/operations?project_id=prj_1&environment_id=env_1"
  });

  expect(response.statusCode).toBe(501);
  expect(response.json()).toEqual({ error: "query_method_unavailable" });
});
```

- [ ] Run:

```bash
pnpm --filter @sigmon/api test -- query.test.ts
```

- [ ] Commit:

```bash
git add apps/api/src/routes/query.ts apps/api/src/main.ts apps/api/test/query.test.ts
git commit -m "feat: expose project operations query"
```

---

## Task 4: Add Console API Types And Client

- [ ] Modify [apps/console/src/api/types.ts](/Users/diogo/Developer/Github/SignalHub/apps/console/src/api/types.ts).

- [ ] Add the `Operations*` types from the API contract after `OverviewResponse`.

- [ ] Modify [apps/console/src/api/client.ts](/Users/diogo/Developer/Github/SignalHub/apps/console/src/api/client.ts).

- [ ] Import `OperationsQuery` and `OperationsResponse`.

- [ ] Add client method:

```ts
getOperations: (query: OperationsQuery) => Promise<AggregateResponse<OperationsResponse>>;
```

- [ ] Add path helper:

```ts
function operationsPath(query: OperationsQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  return `/query/operations?${params.toString()}`;
}
```

- [ ] Wire:

```ts
getOperations: (query) => request<AggregateResponse<OperationsResponse>>(path(apiBasePath, operationsPath(query))),
```

- [ ] Modify [apps/console/src/api/client.test.ts](/Users/diogo/Developer/Github/SignalHub/apps/console/src/api/client.test.ts).

- [ ] Add `operationsResponse()` fixture and path test:

```ts
it("encodes operations query params", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: operationsResponse() }));
  vi.stubGlobal("fetch", fetchMock);

  await createApiClient().getOperations({
    projectId: "prj_1",
    environmentId: "env_1",
    window: "7d"
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/query/operations?project_id=prj_1&environment_id=env_1&window=7d",
    expect.objectContaining({ method: "GET" })
  );
});
```

- [ ] Run:

```bash
pnpm --filter @sigmon/console test -- client.test.ts
```

- [ ] Commit:

```bash
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts
git commit -m "feat: add operations console client"
```

---

## Task 5: Add Operations Navigation And Shell Wiring

- [ ] Modify [apps/console/src/components/ConsoleModeTabs.tsx](/Users/diogo/Developer/Github/SignalHub/apps/console/src/components/ConsoleModeTabs.tsx).

- [ ] Extend mode union:

```ts
export type ConsoleMode = "setup" | "overview" | "operations" | "investigate" | "alerts" | "monitors" | "artifacts" | "system";
```

- [ ] Add `Operations` between `Overview` and `Investigate`:

```ts
{ mode: "operations", label: "Operations", icon: ActivitySquare }
```

Use an available lucide icon such as `ActivitySquare`, `RadioTower`, or `HeartPulse`; keep `System` using `MonitorCheck`.

- [ ] Modify [apps/console/src/components/ConsoleModeTabs.test.tsx](/Users/diogo/Developer/Github/SignalHub/apps/console/src/components/ConsoleModeTabs.test.tsx) to expect and click `Operations`.

- [ ] Modify [apps/console/src/components/ConsoleShell.tsx](/Users/diogo/Developer/Github/SignalHub/apps/console/src/components/ConsoleShell.tsx).

- [ ] Import `OperationsDashboard`.

- [ ] Add handlers:

```ts
function openOperationsMonitors() {
  setActiveMode("monitors");
}

function openOperationsAlerts() {
  setActiveMode("alerts");
}

function openOperationsErrors(filters: { status?: "open" | "investigating"; severity?: string } = {}) {
  setInvestigationDrilldown((current) => ({
    nonce: (current?.nonce ?? 0) + 1,
    tab: "errors",
    filters: { errors: filters }
  }));
  setActiveMode("investigate");
}

function openOperationsTraces(filters: { traceName?: string } = {}) {
  setInvestigationDrilldown((current) => ({
    nonce: (current?.nonce ?? 0) + 1,
    tab: "traces",
    filters: { traces: filters }
  }));
  setActiveMode("investigate");
}
```

If `InvestigationInitialFilters` lacks trace-name filtering, add the `traceName` field to trace initial filters and map it to the existing trace name input.

- [ ] Render the panel:

```tsx
<div hidden={activeMode !== "operations"}>
  {activeMode === "operations" ? (
    <OperationsDashboard
      client={client}
      environmentId={activeEnvironment?.id}
      onOpenAlerts={openOperationsAlerts}
      onOpenIncident={openErrorGroupIncident}
      onOpenMonitors={openOperationsMonitors}
      onOpenErrors={openOperationsErrors}
      onOpenTraces={openOperationsTraces}
      projectId={activeProject?.id}
    />
  ) : null}
</div>
```

- [ ] Add `operations: "Operations"` to `modeLabel`.

- [ ] Modify [apps/console/src/components/ConsoleShell.test.tsx](/Users/diogo/Developer/Github/SignalHub/apps/console/src/components/ConsoleShell.test.tsx):

1. Add `getOperations: vi.fn()` to the default client.
2. Add an `operationsResponse()` fixture.
3. Add a test that clicking `Operations` lazy-loads `getOperations`.
4. Add a test that a monitor drilldown button switches to `Monitors`.
5. Add a test that an alert drilldown button switches to `Alerts`.

- [ ] Run:

```bash
pnpm --filter @sigmon/console test -- ConsoleModeTabs.test.tsx ConsoleShell.test.tsx
```

- [ ] Commit:

```bash
git add apps/console/src/components/ConsoleModeTabs.tsx apps/console/src/components/ConsoleModeTabs.test.tsx apps/console/src/components/ConsoleShell.tsx apps/console/src/components/ConsoleShell.test.tsx
git commit -m "feat: add operations console mode"
```

---

## Task 6: Build `OperationsDashboard`

- [ ] Create [apps/console/src/components/OperationsDashboard.tsx](/Users/diogo/Developer/Github/SignalHub/apps/console/src/components/OperationsDashboard.tsx).

- [ ] Create [apps/console/src/components/OperationsDashboard.test.tsx](/Users/diogo/Developer/Github/SignalHub/apps/console/src/components/OperationsDashboard.test.tsx).

- [ ] Component props:

```ts
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
```

- [ ] Follow the `OverviewDashboard` loading pattern:

```ts
const windows: OperationsWindow[] = ["24h", "7d", "30d"];
type LoadState = "loading" | "ready" | "unavailable";
```

- [ ] Layout:

1. Header with title `Operations`, generated timestamp, status pill, and window segmented control.
2. Command cards:
   - `Project status`
   - `Monitors`
   - `Alerts`
   - `Incidents`
   - `Latency`
   - `Telemetry freshness`
3. `Setup gaps` row when gaps exist.
4. `Top latency` table with route/name and drilldown.
5. `Recent activity` split list: monitors, alerts, incidents.

- [ ] Drilldowns:

```tsx
<button onClick={onOpenMonitors} type="button">Open monitors</button>
<button onClick={onOpenAlerts} type="button">Open alerts</button>
<button onClick={() => onOpenErrors({ status: "open" })} type="button">Open issues</button>
<button onClick={() => onOpenTraces({ traceName: row.name })} type="button">Investigate trace</button>
<button onClick={() => onOpenIncident(incident.id, { errorId: incident.latestErrorId ?? undefined })} type="button">
  Open incident
</button>
```

- [ ] Empty state:

```tsx
if (!projectId || !environmentId) {
  return (
    <section className="panel">
      <div className="panel-header"><h2>Operations</h2></div>
      <p className="muted-text">Select a project and environment in Setup to view operations.</p>
    </section>
  );
}
```

- [ ] Tests:

1. Shows empty scope copy without calling `getOperations`.
2. Loads operation cards and status from `client.getOperations`.
3. Preserves layout while loading.
4. Retries after unavailable request.
5. Ignores stale responses when scope/window changes.
6. Calls monitor, alert, incident, error, and trace drilldown handlers.
7. Shows setup gaps when returned.

- [ ] Run:

```bash
pnpm --filter @sigmon/console test -- OperationsDashboard.test.tsx
```

---

## Task 7: Style The Operations Cockpit

- [ ] Modify [apps/console/src/styles.css](/Users/diogo/Developer/Github/SignalHub/apps/console/src/styles.css).

- [ ] Add classes without nesting cards inside cards:

```css
.operations-dashboard {}
.operations-header {}
.operations-status-grid {}
.operations-command-card {}
.operations-command-card__header {}
.operations-command-card__metric {}
.operations-gaps {}
.operations-latency-table {}
.operations-recent-grid {}
```

- [ ] Keep visual rules aligned with PR #11:

- dense operational dashboard, not marketing layout
- stable card heights for the command-card row
- icon buttons or concise command buttons
- no hero, no decorative gradients, no nested cards
- dark-first contrast matching existing `overview-*` and `system-*` surfaces

- [ ] Run console tests:

```bash
pnpm --filter @sigmon/console test -- OperationsDashboard.test.tsx ConsoleShell.test.tsx
```

- [ ] Commit Task 6 and Task 7 together:

```bash
git add apps/console/src/components/OperationsDashboard.tsx apps/console/src/components/OperationsDashboard.test.tsx apps/console/src/styles.css
git commit -m "feat: add operations cockpit UI"
```

---

## Task 8: Documentation

- [ ] Modify [.claude/docs/UI-UX.md](/Users/diogo/Developer/Github/SignalHub/.claude/docs/UI-UX.md).

Add:

```md
## Console Operations Mode

`Operations` is the project/environment cockpit for monitored application health. It sits between `Overview` and `Investigate`.

- `Overview` remains product and telemetry summary.
- `Operations` summarizes monitored health, alert state, p95 latency, error rate, ingestion freshness, and open incidents for the selected project/environment.
- `System` remains global Sigmon install health: API, Postgres, Redis, workers, scheduler, SMTP, retention, and backups.
- Drilldowns from `Operations` route to existing Monitors, Alerts, Investigate, and Incident views.
```

- [ ] Modify [.claude/docs/ARCHITECTURE.md](/Users/diogo/Developer/Github/SignalHub/.claude/docs/ARCHITECTURE.md).

Add the endpoint and repository:

```md
- `GET /query/operations` aggregates monitors, alert events, alert rules, notification delivery state, error groups, and telemetry for one project/environment.
- `packages/db/src/repositories/operations-query.ts` owns the aggregate status calculation for the project operations cockpit.
```

- [ ] Modify [.claude/docs/PROJECT-SUMMARY.md](/Users/diogo/Developer/Github/SignalHub/.claude/docs/PROJECT-SUMMARY.md) if it lists console modes; add `Operations`.

- [ ] Modify docs generated for public API only if `/query/*` routes are already documented there. If Scalar currently focuses ingestion/admin public APIs, leave `/query/operations` out of public docs and keep it in internal architecture docs.

- [ ] Commit:

```bash
git add .claude/docs/UI-UX.md .claude/docs/ARCHITECTURE.md .claude/docs/PROJECT-SUMMARY.md
git commit -m "docs: document project operations cockpit"
```

---

## Task 9: Final Verification

- [ ] Run focused tests:

```bash
pnpm --filter @sigmon/db test -- repositories.test.ts --runInBand
pnpm --filter @sigmon/api test -- query.test.ts
pnpm --filter @sigmon/console test -- client.test.ts ConsoleModeTabs.test.tsx ConsoleShell.test.tsx OperationsDashboard.test.tsx
```

- [ ] Run full verification:

```bash
pnpm test
pnpm build
git diff --check
```

- [ ] Inspect changed files:

```bash
git status -sb
git diff --stat origin/main HEAD
```

- [ ] Confirm `audit.md` is still untracked and unstaged.

- [ ] Push:

```bash
git push origin HEAD:main
```

---

## Implementation Notes

- Keep `SystemHealthPanel` global. Do not move global service health into project `Operations`.
- `OperationsDashboard` should use the selected project/environment only. It should not summarize all projects.
- A self-monitoring `sigmon.app` project can be created by the user like any other project; no special product logic is needed.
- Prefer one aggregate endpoint over multiple parallel console calls. This keeps status calculation consistent between UI and future docs/API clients.
- Keep `Operations` read-only for this phase. Existing `MonitorsPanel` and `AlertsPanel` remain the edit/config areas.
- If trace investigation cannot filter by trace name yet, extend trace initial filters narrowly and include tests. Do not broaden all investigation filter contracts.
- Use existing status-pill styles where possible before adding new color variants.
