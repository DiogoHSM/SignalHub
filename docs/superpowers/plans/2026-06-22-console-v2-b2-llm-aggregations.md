# B2 — LLM aggregations by tenant & by prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four dedicated, window-parametrized LLM aggregation data sources (summary, by-tenant, by-prompt, cost-by-model time series) in the db repository and expose them as `/query/llm/*` API routes, feeding the S5 LLM screen.

**Architecture:** New repository functions in `packages/db/src/repositories/telemetry-query.ts` reusing the existing `OverviewWindow`/`resolveOverviewRange`/`bucketExpression`/`toNumber` plumbing and the `percentile_cont(0.95)` precedent. Four routes in `apps/api/src/routes/query.ts` mirror `/query/overview` (auth → parse window filters → `{ data }` envelope). Bound in the `apps/api/src/main.ts` composition root.

**Tech Stack:** TypeScript ESM, Kysely (raw `sql` tagged templates), Postgres 16, Fastify 5, Vitest, testcontainers (`withDb`).

## Global Constraints

- Window ∈ `"24h" | "7d" | "30d"`, default `"24h"`; invalid window → route returns 400 (`parseLlmAggregateFilters` returns `undefined`). Mirror `parseOverviewFilters` exactly; do NOT modify `parseOverviewFilters`.
- All queries scoped by `project_id`, `environment_id`, `timestamp >= from`, `timestamp <= to` from `resolveOverviewRange(window)`.
- `failedCalls` = `status <> 'success'` (counts `error` + `pending`). Established convention.
- Cost returned as numeric string (`coalesce(sum(cost_usd), 0)::text`). Never a JS number.
- Error rate and cost share are NOT precomputed — return raw `calls`/`failedCalls` and the window total cost (in summary); S5 derives.
- Caps: by-tenant top **10**, by-prompt top **20**, cost-by-model top **5** models. No "Other" bucket.
- `avgTokens`/`avgLatencyMs`/`p95LatencyMs` are `number | null`, rounded to integers (`Math.round`) after coercion; null only when no qualifying rows.
- `prompt_name` null → `'Unspecified'` (group key). by-tenant excludes null `tenant_id`.
- Response envelope: `reply.send({ data })`. 501 when method unwired, 400 bad filters, 503 on query throw, 401 unauthenticated.
- English only; no `SignalHub` literals in new code. Backend-only — no console/UI changes.
- Verification gate: `pnpm test` && `pnpm build` && `pnpm --filter @sigmon/sdk build` && `docker compose config`.

---

### Task 1: DB — shared types, `buildBucketAxis` helper, and `getLlmSummary`

**Files:**
- Modify: `packages/db/src/repositories/telemetry-query.ts` (add types + helper + `getLlmSummary`)
- Test: `packages/db/test/repositories.test.ts` (add `getLlmSummary` + `buildBucketAxis` tests)

**Interfaces:**
- Consumes: existing `OverviewWindow`, `resolveOverviewRange`, `bucketExpression`, `toNumber`, `Db`, `sql` (all already in the file).
- Produces: `LlmAggregateFilters`, `LlmSummary`, `buildBucketAxis(from, to, bucket)`, `getLlmSummary(db, filters)` — consumed by Tasks 2–4.

- [ ] **Step 1: Add the shared types** near the other exported aggregate types (e.g. after `LlmAggregates`).

```ts
export interface LlmAggregateFilters {
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
}

export interface LlmSummary {
  calls: number;
  failedCalls: number;
  costUsd: string;
  avgTokens: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}
```

- [ ] **Step 2: Add a helper to round a coerced numeric to an integer or null.** Place near `toNumber`.

```ts
function toRoundedOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}
```

- [ ] **Step 3: Add `buildBucketAxis`.** Produces ISO bucket-start strings matching `bucketExpression`'s `to_char(date_trunc(...), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` output (UTC, truncated to hour/day), ascending, inclusive of the bucket containing `from` through the bucket containing `to`.

```ts
function formatBucketStart(d: Date): string {
  // Matches Postgres to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') on a truncated timestamp.
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:00:00.000Z`; // hour granularity default; day handled below
}

export function buildBucketAxis(from: Date, to: Date, bucket: OverviewTrendBucket): string[] {
  const stepHours = bucket === "hour" ? 1 : 24;
  const start = new Date(from);
  start.setUTCMinutes(0, 0, 0);
  if (bucket === "day") {
    start.setUTCHours(0, 0, 0, 0);
  }
  const axis: string[] = [];
  const cursor = new Date(start);
  while (cursor <= to) {
    const yyyy = cursor.getUTCFullYear().toString().padStart(4, "0");
    const mm = (cursor.getUTCMonth() + 1).toString().padStart(2, "0");
    const dd = cursor.getUTCDate().toString().padStart(2, "0");
    const hh = bucket === "hour" ? cursor.getUTCHours().toString().padStart(2, "0") : "00";
    axis.push(`${yyyy}-${mm}-${dd}T${hh}:00:00.000Z`);
    cursor.setUTCHours(cursor.getUTCHours() + stepHours);
  }
  return axis;
}
```
> Note: `formatBucketStart` above is illustrative of the format; the canonical producer is `buildBucketAxis`. If `formatBucketStart` is unused, omit it — only `buildBucketAxis` is required. `OverviewTrendBucket` is already exported from this file.

- [ ] **Step 4: Add `getLlmSummary`.** Single-row aggregate, scoped to the window.

```ts
export async function getLlmSummary(db: Db, filters: LlmAggregateFilters): Promise<LlmSummary> {
  const { from, to } = resolveOverviewRange(filters.window);
  const row = await sql<{
    calls: unknown;
    failed_calls: unknown;
    cost_usd: string;
    avg_tokens: unknown;
    avg_latency_ms: unknown;
    p95_latency_ms: unknown;
  }>`
    select
      count(*) as calls,
      count(*) filter (where status <> 'success') as failed_calls,
      coalesce(sum(cost_usd), 0)::text as cost_usd,
      avg(input_tokens + output_tokens) as avg_tokens,
      avg(latency_ms) filter (where latency_ms is not null) as avg_latency_ms,
      percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
  `.execute(db);

  const r = row.rows[0];
  return {
    calls: toNumber(r?.calls ?? 0),
    failedCalls: toNumber(r?.failed_calls ?? 0),
    costUsd: r?.cost_usd ?? "0",
    avgTokens: toRoundedOrNull(r?.avg_tokens),
    avgLatencyMs: toRoundedOrNull(r?.avg_latency_ms),
    p95LatencyMs: toRoundedOrNull(r?.p95_latency_ms)
  };
}
```
> `percentile_cont` with `latency_ms is not null` rows only: Postgres `percentile_cont` ignores NULLs in the ordering set automatically, so an explicit filter is not required for correctness, but matches the trace precedent's intent. Returns NULL when no non-null latencies → `toRoundedOrNull` → `null`.

- [ ] **Step 5: Write db tests** in `packages/db/test/repositories.test.ts` using `withDb` + `insertLlmCall`. Seed a project + environment (reuse existing seeding helpers in the file) and llm_calls covering: `success`/`error`/`pending` statuses, varied `input_tokens`/`output_tokens`/`latency_ms` (some null), and at least one row outside the 24h window. Assert:
  - `calls` counts all in-window rows; `failedCalls` counts `error`+`pending` (not `success`).
  - `costUsd` equals the summed string.
  - `avgTokens` = round(avg(input+output)); `avgLatencyMs` ignores null latency; `p95LatencyMs` is the 95th percentile (use a small known set where p95 is determinate).
  - A row dated outside the window is excluded.
  - Empty window (different project) → `{ calls: 0, failedCalls: 0, costUsd: "0", avgTokens: null, avgLatencyMs: null, p95LatencyMs: null }`.
  - `buildBucketAxis(new Date("2026-06-22T03:30:00Z"), new Date("2026-06-22T06:10:00Z"), "hour")` → `["2026-06-22T03:00:00.000Z","2026-06-22T04:00:00.000Z","2026-06-22T05:00:00.000Z","2026-06-22T06:00:00.000Z"]`; and a `"day"` case across 3 days.

- [ ] **Step 6: Run db tests** — `pnpm --filter @sigmon/db test`. Expected: PASS.

- [ ] **Step 7: Commit** — `feat: add LLM summary aggregate + bucket-axis helper (PER-345)`.

---

### Task 2: DB — `getLlmByTenant` and `getLlmByPrompt`

**Files:**
- Modify: `packages/db/src/repositories/telemetry-query.ts`
- Test: `packages/db/test/repositories.test.ts`

**Interfaces:**
- Consumes: `LlmAggregateFilters`, `resolveOverviewRange`, `toNumber`, `toRoundedOrNull` (Task 1).
- Produces: `LlmTenantRow`, `LlmPromptRow`, `getLlmByTenant`, `getLlmByPrompt` — consumed by Task 4.

- [ ] **Step 1: Add the row types.**

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

export interface LlmPromptRow {
  promptName: string;
  model: string;
  calls: number;
  failedCalls: number;
  costUsd: string;
  avgTokens: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}
```

- [ ] **Step 2: Add `getLlmByTenant`** (cap 10, excludes null tenant, order by cost desc then tenant_id asc).

```ts
export async function getLlmByTenant(db: Db, filters: LlmAggregateFilters): Promise<LlmTenantRow[]> {
  const { from, to } = resolveOverviewRange(filters.window);
  const result = await sql<{
    tenant_id: string;
    calls: unknown;
    failed_calls: unknown;
    cost_usd: string;
    avg_tokens: unknown;
    avg_latency_ms: unknown;
    p95_latency_ms: unknown;
  }>`
    select
      tenant_id,
      count(*) as calls,
      count(*) filter (where status <> 'success') as failed_calls,
      coalesce(sum(cost_usd), 0)::text as cost_usd,
      avg(input_tokens + output_tokens) as avg_tokens,
      avg(latency_ms) filter (where latency_ms is not null) as avg_latency_ms,
      percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
      and tenant_id is not null
    group by tenant_id
    order by sum(cost_usd) desc, tenant_id asc
    limit 10
  `.execute(db);

  return result.rows.map((r) => ({
    tenantId: r.tenant_id,
    calls: toNumber(r.calls),
    failedCalls: toNumber(r.failed_calls),
    costUsd: r.cost_usd,
    avgTokens: toRoundedOrNull(r.avg_tokens),
    avgLatencyMs: toRoundedOrNull(r.avg_latency_ms),
    p95LatencyMs: toRoundedOrNull(r.p95_latency_ms)
  }));
}
```

- [ ] **Step 3: Add `getLlmByPrompt`** (cap 20, group by coalesced prompt + model, order by cost desc then prompt asc then model asc).

```ts
export async function getLlmByPrompt(db: Db, filters: LlmAggregateFilters): Promise<LlmPromptRow[]> {
  const { from, to } = resolveOverviewRange(filters.window);
  const result = await sql<{
    prompt_name: string;
    model: string;
    calls: unknown;
    failed_calls: unknown;
    cost_usd: string;
    avg_tokens: unknown;
    avg_latency_ms: unknown;
    p95_latency_ms: unknown;
  }>`
    select
      coalesce(prompt_name, 'Unspecified') as prompt_name,
      model,
      count(*) as calls,
      count(*) filter (where status <> 'success') as failed_calls,
      coalesce(sum(cost_usd), 0)::text as cost_usd,
      avg(input_tokens + output_tokens) as avg_tokens,
      avg(latency_ms) filter (where latency_ms is not null) as avg_latency_ms,
      percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
    group by coalesce(prompt_name, 'Unspecified'), model
    order by sum(cost_usd) desc, prompt_name asc, model asc
    limit 20
  `.execute(db);

  return result.rows.map((r) => ({
    promptName: r.prompt_name,
    model: r.model,
    calls: toNumber(r.calls),
    failedCalls: toNumber(r.failed_calls),
    costUsd: r.cost_usd,
    avgTokens: toRoundedOrNull(r.avg_tokens),
    avgLatencyMs: toRoundedOrNull(r.avg_latency_ms),
    p95LatencyMs: toRoundedOrNull(r.p95_latency_ms)
  }));
}
```

- [ ] **Step 4: Write db tests.** Seed llm_calls across ≥2 tenants (+ some null-tenant rows), ≥2 prompts each with ≥2 models, plus a null prompt_name row. Assert:
  - `getLlmByTenant`: only non-null tenants; ordered by cost desc; per-row calls/failedCalls/cost/avgTokens/avg+p95 latency correct; null-tenant rows excluded; (optionally seed 11 tenants to assert the cap of 10).
  - `getLlmByPrompt`: one row per (prompt, model) pair; null prompt → `'Unspecified'`; ordered by cost desc; metric set correct.

- [ ] **Step 5: Run db tests** — `pnpm --filter @sigmon/db test`. Expected: PASS.

- [ ] **Step 6: Commit** — `feat: add LLM by-tenant and by-prompt rankings (PER-345)`.

---

### Task 3: DB — `getLlmCostByModel` time series + barrel exports

**Files:**
- Modify: `packages/db/src/repositories/telemetry-query.ts`
- Modify: `packages/db/src/index.ts` (barrel — re-export all new functions + types)
- Test: `packages/db/test/repositories.test.ts`

**Interfaces:**
- Consumes: `LlmAggregateFilters`, `resolveOverviewRange`, `bucketExpression`, `buildBucketAxis` (Task 1).
- Produces: `LlmCostByModelSeries`, `LlmCostByModel`, `getLlmCostByModel` — consumed by Task 4.

- [ ] **Step 1: Add the types.**

```ts
export interface LlmCostByModelSeries {
  model: string;
  costs: string[]; // costs[i] aligns to buckets[i]
}

export interface LlmCostByModel {
  buckets: string[];
  series: LlmCostByModelSeries[];
}
```

- [ ] **Step 2: Add `getLlmCostByModel`** — top-5 models query, per-(model,bucket) query, JS zero-fill assembly.

```ts
export async function getLlmCostByModel(db: Db, filters: LlmAggregateFilters): Promise<LlmCostByModel> {
  const { from, to, bucket } = resolveOverviewRange(filters.window);
  const buckets = buildBucketAxis(from, to, bucket);

  const topModels = await sql<{ model: string }>`
    select model
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
    group by model
    order by sum(cost_usd) desc, model asc
    limit 5
  `.execute(db);

  const models = topModels.rows.map((r) => r.model);
  if (models.length === 0) {
    return { buckets, series: [] };
  }

  const bucketExpr = bucketExpression(bucket, "timestamp");
  const perBucket = await sql<{ model: string; bucket_start: string; cost_usd: string }>`
    select
      model,
      ${bucketExpr} as bucket_start,
      coalesce(sum(cost_usd), 0)::text as cost_usd
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
      and model in (${sql.join(models)})
    group by model, bucket_start
  `.execute(db);

  // index: model -> (bucket_start -> cost string)
  const byModel = new Map<string, Map<string, string>>();
  for (const row of perBucket.rows) {
    let m = byModel.get(row.model);
    if (!m) {
      m = new Map();
      byModel.set(row.model, m);
    }
    m.set(row.bucket_start, row.cost_usd);
  }

  const series: LlmCostByModelSeries[] = models.map((model) => {
    const m = byModel.get(model);
    return {
      model,
      costs: buckets.map((b) => m?.get(b) ?? "0")
    };
  });

  return { buckets, series };
}
```
> `sql.join(models)` produces the parameterized `in (...)` list (Kysely's `sql.join` defaults to `, ` separator). Verify the import — `sql` is already imported in this file; `sql.join` is part of the same helper. If `sql.join` is unavailable in the installed Kysely version, fall back to building the `in` list via `sql.ref`-free interpolation of each value with `sql.join(models.map((m) => sql\`${m}\`))`.

- [ ] **Step 3: Re-export from the barrel** `packages/db/src/index.ts`. Add the four functions and all new types (`LlmAggregateFilters`, `LlmSummary`, `LlmTenantRow`, `LlmPromptRow`, `LlmCostByModelSeries`, `LlmCostByModel`, and `buildBucketAxis` if not already covered) to the existing `telemetry-query` re-export block — match exactly how `getOverview`/`OverviewFilters` are exported there.

- [ ] **Step 4: Write db tests.** Seed llm_calls for ≥6 models (to assert top-5 cap) across ≥2 buckets within a 24h window. Assert:
  - `buckets` length matches the hourly axis for 24h; for a 7d window the axis is daily.
  - `series` has ≤5 entries, ordered by total cost desc.
  - Each series' `costs` array length == `buckets` length, zero-filled for empty buckets, with the right cost in the bucket that has data.
  - Empty window → `{ buckets: [...non-empty axis...], series: [] }`.

- [ ] **Step 5: Run db tests + build** — `pnpm --filter @sigmon/db test && pnpm --filter @sigmon/db build`. Expected: PASS / clean.

- [ ] **Step 6: Commit** — `feat: add LLM cost-by-model time series (PER-345)`.

---

### Task 4: API — routes, filter parser, dependency methods, composition root, route tests

**Files:**
- Modify: `apps/api/src/routes/query.ts` (deps type + parser + handler + 4 routes)
- Modify: `apps/api/src/main.ts` (bind 4 methods + imports)
- Test: `apps/api/test/query.llm-aggregates.test.ts` (NEW)

**Interfaces:**
- Consumes: `getLlmSummary`/`getLlmByTenant`/`getLlmByPrompt`/`getLlmCostByModel` + `LlmAggregateFilters` from `@sigmon/db` (Tasks 1–3); existing `requireHumanUser`, `parseRequiredId`, `optionalNonEmpty`, `QueryRouteOptions`, `buildApp` test helper.
- Produces: 4 `/query/llm/*` routes.

- [ ] **Step 1: Declare `LlmAggregateFilters` in the route module** (import the type from `@sigmon/db` alongside the existing `OverviewFilters` import, OR declare a local structural type matching it — match how `OverviewFilters` is currently sourced in `query.ts`).

- [ ] **Step 2: Add the four optional methods to `QueryDependencies`** (`query.ts:~149`):

```ts
getLlmSummary?: (filters: LlmAggregateFilters) => Promise<unknown>;
getLlmByTenant?: (filters: LlmAggregateFilters) => Promise<unknown>;
getLlmByPrompt?: (filters: LlmAggregateFilters) => Promise<unknown>;
getLlmCostByModel?: (filters: LlmAggregateFilters) => Promise<unknown>;
```

- [ ] **Step 3: Add `parseLlmAggregateFilters`** (mirror `parseOverviewFilters`, do not modify the original):

```ts
function parseLlmAggregateFilters(query: unknown): LlmAggregateFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) {
    return undefined;
  }
  const rawWindow = optionalNonEmpty(raw, "window") ?? "24h";
  if (rawWindow !== "24h" && rawWindow !== "7d" && rawWindow !== "30d") {
    return undefined;
  }
  return { projectId, environmentId, window: rawWindow };
}
```

- [ ] **Step 4: Add a shared handler** (mirror `handleOverviewRoute`):

```ts
async function handleLlmAggregateRoute(
  request: FastifyRequest,
  reply: FastifyReply,
  options: QueryRouteOptions,
  hasMethod: () => boolean,
  run: (filters: LlmAggregateFilters) => Promise<unknown>
) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }
  if (!hasMethod()) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }
  const filters = parseLlmAggregateFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }
  try {
    return reply.send({ data: await run(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}
```

- [ ] **Step 5: Register the four routes** (next to `/query/overview`):

```ts
app.get("/query/llm/summary", (request, reply) =>
  handleLlmAggregateRoute(request, reply, options,
    () => !!options.query?.getLlmSummary,
    (filters) => options.query!.getLlmSummary!(filters)));

app.get("/query/llm/by-tenant", (request, reply) =>
  handleLlmAggregateRoute(request, reply, options,
    () => !!options.query?.getLlmByTenant,
    (filters) => options.query!.getLlmByTenant!(filters)));

app.get("/query/llm/by-prompt", (request, reply) =>
  handleLlmAggregateRoute(request, reply, options,
    () => !!options.query?.getLlmByPrompt,
    (filters) => options.query!.getLlmByPrompt!(filters)));

app.get("/query/llm/cost-by-model", (request, reply) =>
  handleLlmAggregateRoute(request, reply, options,
    () => !!options.query?.getLlmCostByModel,
    (filters) => options.query!.getLlmCostByModel!(filters)));
```

- [ ] **Step 6: Bind in the composition root** `apps/api/src/main.ts` (~line 495, in the `query: { ... }` object), and add imports from `@sigmon/db` next to the existing `getOverview` import:

```ts
getLlmSummary: (filters) => getLlmSummary(db, filters),
getLlmByTenant: (filters) => getLlmByTenant(db, filters),
getLlmByPrompt: (filters) => getLlmByPrompt(db, filters),
getLlmCostByModel: (filters) => getLlmCostByModel(db, filters),
```

- [ ] **Step 7: Write route tests** `apps/api/test/query.llm-aggregates.test.ts` mirroring `query.fleet.test.ts`. For each of the four routes:
  - 401 unauthenticated (use the unauthenticated auth stub).
  - 501 when the query method is absent from the mock.
  - 400 on missing `project_id`/`environment_id`, and on `window=bogus`.
  - 200 returns `{ data }` from a mocked method.
  - Default window `"24h"` and explicit `7d`/`30d` reach the mock — capture the `filters` arg the mock received and assert `filters.window`.

- [ ] **Step 8: Run api tests** — `pnpm --filter @sigmon/api test`. Expected: PASS.

- [ ] **Step 9: Full gate** — `pnpm test && pnpm build && pnpm --filter @sigmon/sdk build && docker compose config`. Expected: all green.

- [ ] **Step 10: Commit** — `feat: expose /query/llm aggregation routes (PER-345)`.
