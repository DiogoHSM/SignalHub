# Phase 3 Overview Dashboard Design

## Source

This design extends `PRD.md` v0.2 and the completed Phase 3 console work:

- Integration Console setup flow.
- Read-only Events investigation.
- Read-only Errors investigation.
- Read-only Traces investigation.
- Read-only LLM investigation.

The approved next direction is A then B: build a complete Overview Dashboard first, then build deeper User/Tenant investigation in a later slice. Logs and Alerts are explicitly deferred to a later phase/session.

## Product Boundary

In scope:

- Add an `Overview` mode to the console as a peer to `Setup` and `Investigate`.
- Keep Overview scoped to the selected project and environment.
- Support fixed windows: `24h`, `7d`, and `30d`.
- Show complete operational summary from existing telemetry: usage, active users, active tenants, errors, traces, latency, LLM calls, tokens, and cost.
- Show four mini trends:
  - Usage: events, traces, and LLM calls.
  - Errors: error count plus open/error-severity signal.
  - Latency: trace latency over time.
  - AI cost: LLM cost over time.
- Show top 5 ranked lists with drilldown intent:
  - Event names.
  - Tenants by usage, errors, AI calls, and AI cost.
  - LLM providers, models, and prompts.
  - Error severity and status.
- Show recent important signals:
  - Recent errors.
  - Recent failed traces.
  - Recent failed LLM calls.
- Keep Overview read-only.
- Use existing telemetry tables only.

Out of scope:

- Cross-project or all-environment overview.
- Logs ingestion or log overview.
- Alerts, notification channels, alert history, or rule evaluation.
- New storage tables, daily rollups, materialized views, or retention jobs.
- User, tenant, or session profile tables.
- Custom date ranges.
- Mutating telemetry state.
- Configurable dashboards.
- Full charting suite beyond the four mini trends.
- New charting dependency.

## Recommended Approach

Add one read-only overview query contract:

```txt
GET /query/overview
```

The endpoint should accept:

- `project_id`
- `environment_id`
- `window`, one of `24h`, `7d`, or `30d`

The API should return one complete response containing KPI cards, mini trends, top lists, and recent important signals. This keeps Overview semantics centralized in backend tests and prevents the console from orchestrating many loosely related query calls.

Do not build Overview by composing the existing raw-list endpoints in the frontend. The existing endpoints are useful for investigation, but Overview needs consistent time-window semantics, top lists, trend buckets, and cross-table distinct identity counts.

## Backend Contract

`GET /query/overview` requires a human session and the same project/environment query scope as existing query routes.

Request query:

```txt
project_id=prj_1
environment_id=env_1
window=24h | 7d | 30d
```

Invalid or missing values:

- Missing `project_id` or `environment_id`: `400 invalid_query`.
- Missing `window`: default to `24h`.
- Unsupported `window`: `400 invalid_query`.
- Query dependency unavailable: `501 query_method_unavailable`.
- Query execution failure: `503 query_unavailable`.

Response shape:

```ts
type OverviewWindow = "24h" | "7d" | "30d";

type OverviewResponse = {
  window: OverviewWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
    bucket: "hour" | "day";
  };
  kpis: {
    events: number;
    activeUsers: number;
    activeTenants: number;
    errors: number;
    openErrors: number;
    traces: number;
    failedTraces: number;
    averageTraceDurationMs: number;
    p95TraceDurationMs: number | null;
    llmCalls: number;
    failedLlmCalls: number;
    llmInputTokens: number;
    llmOutputTokens: number;
    llmCostUsd: string;
  };
  trends: {
    usage: Array<{
      bucketStart: string;
      events: number;
      traces: number;
      llmCalls: number;
    }>;
    errors: Array<{
      bucketStart: string;
      errors: number;
      openErrors: number;
      severeErrors: number;
    }>;
    latency: Array<{
      bucketStart: string;
      averageTraceDurationMs: number;
      p95TraceDurationMs: number | null;
    }>;
    aiCost: Array<{
      bucketStart: string;
      llmCostUsd: string;
      llmCalls: number;
    }>;
  };
  top: {
    events: Array<{ name: string; total: number }>;
    tenantsByUsage: Array<{ tenantId: string; total: number }>;
    tenantsByErrors: Array<{ tenantId: string; total: number }>;
    tenantsByLlmCalls: Array<{ tenantId: string; total: number }>;
    tenantsByLlmCost: Array<{ tenantId: string; totalCostUsd: string }>;
    llmProviders: Array<{ provider: string; total: number; totalCostUsd: string }>;
    llmModels: Array<{ model: string; total: number; totalCostUsd: string }>;
    llmPrompts: Array<{ promptName: string; total: number; totalCostUsd: string }>;
    errorSeverity: Array<{ severity: string; total: number }>;
    errorStatus: Array<{ status: string; total: number }>;
  };
  recent: {
    errors: Array<OverviewRecentError>;
    failedTraces: Array<OverviewRecentTrace>;
    failedLlmCalls: Array<OverviewRecentLlmCall>;
  };
};
```

Recent records should be compact row shapes, not full detail records. Include the fields needed to render the row and support a drilldown target:

- Recent errors: id, timestamp, message, type, severity, status, tenantId, userId, traceId.
- Recent failed traces: id, timestamp, name, status, durationMs, tenantId, userId.
- Recent failed LLM calls: id, timestamp, provider, model, promptName, status, costUsd, tenantId, userId, traceId.

## Data Semantics

All metrics are scoped to the selected project, selected environment, and selected window.

Window ranges:

- `24h`: from now minus 24 hours to now, bucketed hourly.
- `7d`: from now minus 7 days to now, bucketed daily.
- `30d`: from now minus 30 days to now, bucketed daily.

Use the server clock for `now`. The response should include `generatedAt`, `range.from`, and `range.to` so the frontend can render an honest time window.

Identity counts:

- `activeUsers`: distinct non-null `user_id` across events, errors, traces, and LLM calls.
- `activeTenants`: distinct non-null `tenant_id` across events, errors, traces, and LLM calls.
- No user/session/tenant tables are introduced in this slice.

Events:

- `kpis.events`: total event rows in range.
- `top.events`: top 5 event names by count.

Errors:

- `kpis.errors`: total error rows in range.
- `kpis.openErrors`: total error rows where `status = 'open'`.
- `trends.errors.openErrors`: bucketed open errors.
- `trends.errors.severeErrors`: bucketed errors where severity is `error`, `critical`, or `fatal` if present. Unknown severity values are ignored for this severe count.
- `top.errorSeverity`: top severity counts.
- `top.errorStatus`: top status counts.

Traces:

- `kpis.traces`: total trace rows in range.
- `kpis.failedTraces`: traces where status is not `success`.
- `averageTraceDurationMs`: average of non-null trace duration values, defaulting to 0 when none exist.
- `p95TraceDurationMs`: p95 of non-null trace duration values using Postgres percentile SQL. Return `null` only when the selected window has no non-null trace durations.

LLM:

- `kpis.llmCalls`: total LLM call rows in range.
- `kpis.failedLlmCalls`: LLM calls where status is not `success`.
- Token totals sum input and output token columns.
- Cost totals use decimal-safe SQL aggregation and return strings.
- Top provider/model/prompt lists include counts and total cost.
- Null prompt names should render as `none` or `Unspecified` in the frontend, but the API may return a stable string label.

Tenants:

- Tenant top lists should exclude null tenant ids.
- `tenantsByUsage` counts all telemetry rows across events, errors, traces, and LLM calls.
- `tenantsByErrors` counts error rows.
- `tenantsByLlmCalls` counts LLM call rows.
- `tenantsByLlmCost` sums LLM cost.

Trend buckets:

- Buckets with no data should still be returned with zero values, so the UI can render stable mini trends.
- Bucket labels should use ISO timestamps in `bucketStart`.
- All four mini trends should use the same bucket boundaries for a selected window.

## Frontend Structure

Add Overview as a peer top-level console mode:

```txt
Setup | Overview | Investigate
```

Recommended components:

- `ConsoleModeTabs`
  - Adds `Overview`.
  - Keeps `Setup` as the safest default if project/environment setup is missing.

- `ConsoleShell`
  - Owns selected console mode.
  - Renders `OverviewDashboard` only when `Overview` is active.
  - Does not query Overview while `Setup` or `Investigate` is active.

- `OverviewDashboard`
  - Owns selected window, loading state, unavailable state, retry, and stale-response guard.
  - Calls `client.getOverview({ projectId, environmentId, window })`.
  - Shows setup-required state when project or environment is missing.
  - Renders KPI grid, mini trend band, ranked lists, and recent important signals.

- `OverviewKpiGrid`
  - Compact cards for event volume, active users, active tenants, errors/open errors, traces/latency, LLM calls/tokens/cost.

- `OverviewMiniTrends`
  - Four small trend panels: usage, errors, latency, AI cost.
  - Use lightweight in-app SVG/CSS rendering. Do not add a chart dependency in this slice.

- `OverviewTopLists`
  - Renders top 5 lists.
  - Top list rows switch to `Investigate` with the relevant tab and filter prefilled.

- `OverviewRecentSignals`
  - Shows recent errors, failed traces, and failed LLM calls as dense rows.
  - Rows should be read-only and point operators toward the matching investigation tab.

## UX Behavior

Overview behavior:

- Requires selected project and environment.
- Defaults to `24h`.
- Supports `24h`, `7d`, and `30d` segmented window control.
- Window changes reload the Overview query.
- Loading state should preserve layout shape.
- Unavailable state should show a retry action.
- Empty or zero-data state should render honest zero metrics and clear helper text.
- Stale responses after project/environment/window changes must not overwrite newer state.

Layout priority:

1. Scope and time window are visible at the top.
2. KPI cards are first because they answer current health quickly.
3. Mini trends come next to show direction over time.
4. Ranked lists follow for diagnosis.
5. Recent important signals sit at the bottom as an investigation starting point.

Top 5 drilldown behavior:

- Top event rows switch to `Investigate` > `Events` with `eventName` prefilled.
- Top error severity/status rows switch to `Investigate` > `Errors` with `severity` or `status` prefilled.
- Top LLM provider/model/prompt rows switch to `Investigate` > `LLM` with `provider`, `model`, or `promptName` prefilled.
- Top tenant usage rows switch to `Investigate` > `Events` with `tenantId` prefilled.
- Top tenant error rows switch to `Investigate` > `Errors` with `tenantId` prefilled.
- Top tenant LLM rows switch to `Investigate` > `LLM` with `tenantId` prefilled.
- Recent important signal rows remain read-only in this slice. They communicate the matching investigation tab but do not need exact-record deep links.

## Error Handling

Backend:

- Missing project or environment returns `400 invalid_query`.
- Unsupported window returns `400 invalid_query`.
- Repository/query errors return `503 query_unavailable`.
- Missing overview query dependency returns `501 query_method_unavailable`.

Frontend:

- Missing project/environment: show the existing setup-required guidance.
- Loading: show skeleton or muted loading state in the Overview layout.
- Unavailable: show `Overview unavailable` and a `Retry` action.
- Empty: show zero metrics and a short message that no telemetry exists for the selected window.
- Partial backend responses are not expected; if the endpoint succeeds, the response should include every top-level section with empty arrays or zero values as needed.

## Testing Plan

Backend route tests:

- `GET /query/overview` forwards `project_id`, `environment_id`, and default `window: "24h"`.
- Accepts `24h`, `7d`, and `30d`.
- Rejects unsupported `window`.
- Returns `501` when the query dependency is missing.
- Returns `503` when the query dependency throws.

Repository tests:

- Seed telemetry across multiple projects, environments, windows, users, tenants, statuses, severities, event names, providers, models, and prompts.
- Verify selected project/environment/window filtering.
- Verify KPI totals.
- Verify distinct active users and tenants across all telemetry tables.
- Verify top 5 event names, tenants, LLM provider/model/prompt lists, error severity/status lists.
- Verify recent errors, failed traces, and failed LLM calls exclude successful/irrelevant rows.
- Verify bucketed trends include zero-filled buckets and share the same bucket boundaries.
- Verify cost aggregation returns a string.

Console API client tests:

- Encodes Overview query params.
- Defaults or passes window consistently.
- Does not encode unrelated investigation filters.

Frontend tests:

- Overview does not query until the Overview mode is active.
- Missing project/environment shows setup guidance.
- Default Overview query uses selected project/environment and `24h`.
- Window changes reload the query.
- KPI cards render the response values.
- Mini trends render all four trend sections.
- Top lists render top 5 rows.
- Top list drilldowns switch to the correct investigation tab with the expected filter prefilled.
- Recent important signals render errors, failed traces, and failed LLM calls.
- Unavailable state and retry work.
- Stale responses are ignored.

Final verification:

```sh
pnpm test
pnpm build
docker compose config --quiet
```

## Documentation Updates

After implementation, update:

- `.claude/docs/ARCHITECTURE.md`: document `GET /query/overview` and Overview query semantics.
- `.claude/docs/UI-UX.md`: document Overview mode, KPI/trend/list layout, and selected project/environment scope.
- `.claude/docs/PROJECT-SUMMARY.md`: add Overview Dashboard to implemented Phase 3 capabilities.
- `CLAUDE.md`: update only if a durable new convention is introduced.

## Open Follow-Ups

These are intentionally deferred:

- Users/Tenants investigation workspace.
- Drilldown prefill if it requires broad console state refactoring.
- Cross-project/all-environment overview.
- Custom date range.
- Daily rollups or materialized aggregates.
- Logs ingestion and logs UI.
- Alerts MVP.
