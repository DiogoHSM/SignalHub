# B2 · Backend — LLM aggregations by tenant & by prompt

**Epic:** SignalMonitor Console v2 — dark redesign
**Issue:** PER-345
**Date:** 2026-06-22
**Status:** Draft for review
**Depends on:** nothing new (extends existing `telemetry-query` + `/query` route surface). Branch `feat/console-v2-b2-llm-aggregations` off main.
**Feeds:** S5 (PER-352, LLM observability screen). Backend-only — no console client/UI in this cycle.

## Goal

Add the backend data sources the v2 **LLM observability screen** (`LlmScreen`, design pulled fresh from DesignSync `app-screens-b.jsx`) needs and that don't exist yet:

1. A **window-wide LLM summary** (calls, failed calls, cost, avg tokens, avg latency, p95 latency) → powers the 5 KPI tiles (Calls, Cost, Avg latency, p95 latency, Error rate).
2. A **by-tenant ranking** (top-N by cost) with the full metric set → powers the "Top tenants — cost" card.
3. A **by-prompt ranking** (top-N by cost, grouped by prompt + model) with the full metric set → powers the "Prompts — ranking by cost" table.
4. A **cost-by-model time series** (top-N models, per-bucket cost over the window) → powers the "Cost by model — 24h" stacked-area chart.

Today, LLM aggregates exist only as `getLlmAggregates` (totals: calls/tokens/cost, no latency/p95/error-rate) plus top-5 by-model/provider/prompt/tenant rankings embedded inside `getOverview` (count + cost only, no avg tokens / avg latency / p95 / error rate). None are exposed as dedicated, window-parametrized endpoints with the metric set S5 renders. B2 adds four dedicated repository functions + four routes + tests.

All four respect **project / environment / window** filters (window ∈ `"24h" | "7d" | "30d"`, default `"24h"`), mirroring the existing overview window contract exactly.

## Design-derived field requirements (from `LlmScreen`)

- **KPI tiles (5):** Calls, Cost (window), Avg latency (ms), p95 latency (ms), Error rate (%). (KPI deltas vs prior window and per-KPI sparklines shown in the mock are **out of scope** for B2 — see follow-ups; S5 degrades.)
- **Top tenants card:** per tenant — display name (S5 resolves; B2 returns `tenantId`), calls, cost, cost-share %. Drill target `tenant`.
- **Prompts ranking table:** per row — `prompt · model`, calls, avg tokens, avg latency, error rate %, cost, p95.
- **Cost-by-model stacked area:** up to 4–5 model series over the window (legend lists the models), one cost value per time bucket.

**Cost share** is NOT precomputed per row. The summary returns the window-wide total cost; S5 derives each row's share as `rowCost / summary.costUsd`. This stays correct even though rankings are truncated to top-N (a precomputed per-row share over a truncated set would be wrong), and keeps the SQL simple.

**Error rate** is NOT precomputed. Each summary/ranking row returns raw `calls` and `failedCalls` (`status <> 'success'`, the established convention — see `telemetry-query.ts:777`, `entities-query.ts:322`; ingest enum is `success|error|pending`, so `failedCalls` counts `error`+`pending`). S5 derives `failedCalls / calls`. Avoids SQL float-formatting decisions and is exactly testable.

**Cost** is returned as a numeric string (`sum(cost_usd)::text`), mirroring every existing cost aggregate (`cost_usd` is `numeric(18,6)`; strings preserve precision).

## Data layer — `packages/db/src/repositories/telemetry-query.ts`

Reuse the existing window plumbing: `OverviewWindow` (`"24h"|"7d"|"30d"`), `resolveOverviewRange(window)` → `{ from, to, bucket }` (24h→`hour`, 7d/30d→`day`), and `bucketExpression(bucket, "timestamp")`. Reuse `toNumber` for integer coercion. p95 mirrors the existing trace precedent: `percentile_cont(0.95) within group (order by latency_ms)` with `latency_ms is not null` (`telemetry-query.ts:775`).

Shared filter type: a new `LlmAggregateFilters = { projectId: string; environmentId: string; window: OverviewWindow }`. All four functions take `(db, filters)`, resolve the range once, and scope every query by `project_id`, `environment_id`, `timestamp >= from`, `timestamp <= to`.

### Per-group metric expressions (used by summary, by-tenant, by-prompt)
```
count(*)                                                          → calls
count(*) filter (where status <> 'success')                      → failedCalls   (or sum(case when status <> 'success' then 1 else 0 end))
coalesce(sum(cost_usd), 0)::text                                 → costUsd        (string)
avg(input_tokens + output_tokens)                                → avgTokens      (number | null)
avg(latency_ms) filter (where latency_ms is not null)            → avgLatencyMs   (number | null)
percentile_cont(0.95) within group (order by latency_ms)         → p95LatencyMs   (number | null; latency_ms is not null filter applied)
```
`avgTokens`, `avgLatencyMs`, `p95LatencyMs` are `number | null` (null only when a group has no qualifying rows — which cannot happen for a returned ranking row, but the summary may be null on an empty window). Round avg* to integers via `toNumber` after fetch (DB returns numeric; `toNumber` already coerces; keep as the rounded ms/token integer to match KPI display — `Math.round` in JS after coercion).

### 1. `getLlmSummary(db, filters: LlmAggregateFilters): Promise<LlmSummary>`
Single-row aggregate over the scoped window. No grouping.
```ts
export interface LlmSummary {
  calls: number;
  failedCalls: number;
  costUsd: string;
  avgTokens: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}
```
Empty window → `{ calls: 0, failedCalls: 0, costUsd: "0", avgTokens: null, avgLatencyMs: null, p95LatencyMs: null }`.

### 2. `getLlmByTenant(db, filters): Promise<LlmTenantRow[]>`
Group by `tenant_id`, `tenant_id is not null` (mirrors the existing overview tenant ranking — null-tenant calls excluded since the card drills into a tenant). Order by `sum(cost_usd) desc, tenant_id asc`. **Cap: top 10.**
```ts
export interface LlmTenantRow {
  tenantId: string;
  calls: number;
  failedCalls: number;
  costUsd: string;
  avgTokens: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}
```
Tenant **display name** is NOT returned: `tenant_profiles` has no name column (only `traits` jsonb). S5 resolves the name from traits or shows the id — same degrade idiom as prior screens. (Follow-up: expose tenant display name.)

### 3. `getLlmByPrompt(db, filters): Promise<LlmPromptRow[]>`
Group by `(coalesce(prompt_name, 'Unspecified'), model)` — each row is a prompt+model pair, matching the design's `prompt · model` rows and the existing `coalesce(prompt_name, 'Unspecified')` null convention. Order by `sum(cost_usd) desc, prompt_name asc, model asc`. **Cap: top 20.**
```ts
export interface LlmPromptRow {
  promptName: string;   // 'Unspecified' when null
  model: string;
  calls: number;
  failedCalls: number;
  costUsd: string;
  avgTokens: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}
```

### 4. `getLlmCostByModel(db, filters): Promise<LlmCostByModel>`
Two scoped queries + JS assembly:
- **(a) Top models:** `select model, coalesce(sum(cost_usd),0)::text from llm_calls where <scope> group by model order by sum(cost_usd) desc, model asc limit 5`. **Cap: top 5 models.** No "Other" bucket (matches design; document the cap).
- **(b) Per-bucket cost** for those models only: `select model, <bucketExpression> as bucket_start, coalesce(sum(cost_usd),0)::text as cost_usd from llm_calls where <scope> and model in (<top models>) group by model, bucket_start`. (If top-models is empty, skip query (b) and return empty series.)
- **JS assembly:** build the full bucket axis from `resolveOverviewRange` (`from`→`to` stepped by `bucket`: hourly for 24h, daily for 7d/30d), formatted with the same `to_char` shape `bucketExpression` produces so keys line up. For each top model, produce a cost string per bucket, **zero-filled** (`"0"`) for buckets with no rows, aligned to the axis order (ascending).
```ts
export interface LlmCostByModelSeries { model: string; costs: string[]; }   // costs[i] aligns to buckets[i]
export interface LlmCostByModel { buckets: string[]; series: LlmCostByModelSeries[]; }
```
Bucket-axis generation is a new small pure helper (`buildBucketAxis(from, to, bucket)`) — testable in isolation. Buckets are ISO strings matching `bucketExpression`'s `YYYY-MM-DD"T"HH24:MI:SS.MS"Z"` format, truncated to the hour/day.

## API layer — `apps/api/src/routes/query.ts`

Add four window-parametrized routes mirroring `/query/overview` exactly (auth gate → `parseLlmAggregateFilters` → `{ data }` envelope; 501 when method unwired, 400 on bad filters, 503 on query throw).

- `GET /query/llm/summary`       → `getLlmSummary`
- `GET /query/llm/by-tenant`     → `getLlmByTenant`
- `GET /query/llm/by-prompt`     → `getLlmByPrompt`
- `GET /query/llm/cost-by-model` → `getLlmCostByModel`

**`parseLlmAggregateFilters(query)`** — identical contract to `parseOverviewFilters` (required `project_id`/`environment_id`; `window` default `"24h"`, only `24h|7d|30d` accepted else `undefined`). Returns `LlmAggregateFilters | undefined`. (Mirror, don't share, to keep the existing function untouched; or factor a shared `parseWindowFilters` if cleaner — implementer's call, but do not change `parseOverviewFilters`'s behavior.)

**Route handlers** follow `handleOverviewRoute` shape: one generic `handleLlmAggregateRoute(request, reply, options, hasMethod, run)` is acceptable (preferred — DRY across the four), each route passing its method presence check + runner.

**`QueryDependencies`** (`query.ts:149`) — add four optional methods:
```ts
getLlmSummary?: (filters: LlmAggregateFilters) => Promise<unknown>;
getLlmByTenant?: (filters: LlmAggregateFilters) => Promise<unknown>;
getLlmByPrompt?: (filters: LlmAggregateFilters) => Promise<unknown>;
getLlmCostByModel?: (filters: LlmAggregateFilters) => Promise<unknown>;
```
Keep `LlmAggregateFilters` exported from the route module (or import from db) — match how `OverviewFilters` is declared/used there.

## Composition root — `apps/api/src/main.ts` (~line 495)

Bind the four new methods alongside `getOverview`:
```ts
getLlmSummary: (filters) => getLlmSummary(db, filters),
getLlmByTenant: (filters) => getLlmByTenant(db, filters),
getLlmByPrompt: (filters) => getLlmByPrompt(db, filters),
getLlmCostByModel: (filters) => getLlmCostByModel(db, filters),
```
Add the imports from `@sigmon/db` (or the repositories barrel) next to the existing `getOverview` import.

## Module layout
```
packages/db/src/repositories/telemetry-query.ts   # MODIFY: + LlmAggregateFilters, LlmSummary, LlmTenantRow, LlmPromptRow, LlmCostByModel(+Series); + getLlmSummary/getLlmByTenant/getLlmByPrompt/getLlmCostByModel; + buildBucketAxis helper
packages/db/src/index.ts (barrel)                 # MODIFY: re-export new functions + types (match how getOverview is exported)
packages/db/test/repositories.test.ts             # MODIFY: + db-level tests for the 4 functions (withDb + insertLlmCall)
apps/api/src/routes/query.ts                       # MODIFY: + LlmAggregateFilters dep methods, parseLlmAggregateFilters, handleLlmAggregateRoute, 4 route registrations
apps/api/src/main.ts                               # MODIFY: bind 4 methods + imports
apps/api/test/query.llm-aggregates.test.ts         # NEW: route tests (buildApp mock query + app.inject) for the 4 routes
```

## Testing

**DB-level (`packages/db/test/repositories.test.ts`, `withDb` + `insertLlmCall`):** seed a project/environment + a spread of `llm_calls` across tenants/prompts/models/statuses/latencies/timestamps, then assert:
- `getLlmSummary`: calls + failedCalls (status `error` and `pending` both count as failed, `success` does not); costUsd sum string; avgTokens = avg(input+output); avgLatencyMs ignores null latency; p95LatencyMs via percentile; empty window → zero/null shape.
- `getLlmByTenant`: groups by tenant, excludes null tenant, ordered by cost desc, capped at 10, per-row metric set correct.
- `getLlmByPrompt`: groups by (prompt_name, model), null prompt → `'Unspecified'`, ordered by cost desc, capped at 20, metric set correct.
- `getLlmCostByModel`: top-5 models by cost; buckets axis covers the window at the right granularity (hourly for 24h, daily for 7d); each series zero-filled and aligned; cost summed into the correct bucket; empty window → `{ buckets: [...], series: [] }`.
- `buildBucketAxis`: unit test the hour/day stepping + ISO format for a known from/to.
- Window scoping: a row outside `[from,to]` is excluded; project/environment scoping excludes other projects/envs.

**Route-level (`apps/api/test/query.llm-aggregates.test.ts`, `buildApp` + `app.inject`):** for each of the 4 routes — 401 unauthenticated; 501 when the query method is unwired; 400 on missing project_id/environment_id and on invalid window; 200 returns `{ data }` from the mocked method; window default `"24h"` and explicit `7d`/`30d` pass through to the mock (assert the filter the mock received). Mirror `query.fleet.test.ts`.

**Regression:** `pnpm test` (repo) + `pnpm build` + `pnpm --filter @sigmon/sdk build` + `docker compose config` all green. No branding regression. No console/UI changes in this cycle.

## Verification
`pnpm --filter @sigmon/db test` · `pnpm --filter @sigmon/api test` · `pnpm test` · `pnpm build` · `docker compose config`.

## Out of scope / follow-ups (PER-364 unless noted)
- **KPI deltas (prior-window comparison) + per-KPI sparklines** — the mock shows `+22%`/sparkline per tile; B2 returns point-in-window values only. S5 degrades (omit delta/sparkline or derive a coarse sparkline from cost-by-model). Follow-up: prior-window delta + per-KPI hourly series endpoint.
- **Tenant display name** — B2 returns `tenantId`; `tenant_profiles` has no name column. Follow-up: expose tenant display name (from traits or a dedicated column) in the by-tenant ranking.
- **Export CSV** — the design's "Export CSV" action has no backend; S5 stubs it (pushToast). Follow-up: real export endpoint.
- **"Other" model bucket** in cost-by-model — capped at top-5 models, remainder dropped (matches design). Follow-up if an "Other" rollup is wanted.
- **Console client + S5 screen** — next item (PER-352), separate cycle.
