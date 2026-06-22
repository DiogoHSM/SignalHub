# B1 · Console v2 — Cross-project fleet-rollup endpoint

**Epic:** [SignalMonitor Console v2 — dark redesign](https://linear.app/data4ward/project/signalmonitor-console-v2-dark-redesign-d974e381fc64)
**Issue:** PER-344
**Date:** 2026-06-21
**Status:** Ready for review

## Goal

Add `GET /query/fleet` — a single authenticated endpoint that returns aggregate health across
every project the operator has access to. It powers the Console v2 Health Rail: a right-side
panel that shows per-project status cards and a fleet rollup (total ok/warning/critical counts,
incident and alert totals, aggregate LLM cost, and an overall health verdict).

Today every query endpoint (`/query/overview`, `/query/operations`) requires a specific
`(project_id, environment_id)` pair; there is no cross-project view. This endpoint closes that
gap by collecting each project's default environment data in a single request, aggregating, and
returning a single response.

Design authority: `.claude/design-v2/app-data.jsx` — `PROJECTS` array + `fleetRollup()`
function. Each field in the response contract below maps directly to a value in that mock.

## Decisions (locked)

- **Single route, single round-trip.** The Health Rail calls one endpoint; no client-side fan-out.
- **Production environment only.** Per-project health is always scoped to the `production`
  environment (or the lexically-first environment if no `production` env exists). Cross-env
  Health Rail is out of scope for v2.
- **24 h window fixed for fleet view.** The `window` parameter is accepted but fixed to `"24h"`
  for v1 of this endpoint. Multi-window fleet rollup is a later extension.
- **Auth: any authenticated human session.** Same `requireHumanUser()` pattern as all `/query/*`
  routes — no admin restriction. All projects visible to the session are included (today that
  means all non-archived projects, since there is no per-user project ACL).
- **New repository function, reusing existing primitives.** The endpoint calls a new
  `getFleetRollup(db, opts)` function in `packages/db/src/repositories/fleet-query.ts`, which
  composes parallel calls to the existing `getOperations` and targeted subset queries from
  `getOverview` rather than duplicating SQL.
- **No persistent cache for v1.** Results are computed on demand. An in-process short-TTL cache
  (e.g. 10 s per unique session+window key) may be added during implementation without a spec
  change.
- **Delta fields — compute in v1.** `errorRateDelta`, `llmCostDeltaUsd`, `p95DeltaMs` are
  included in the v1 response (not deferred). Each requires a second comparison-window query per
  project covering `[now-2×window, now-window]`. This doubles the per-project DB query count
  for those fields; in-process caching (10 s TTL) mitigates repeated fleet polls.
- **`topIncident` — full shape with counts.** `occurrenceCount` and `affectedUsers` are included
  via a join against `error_groups` (using `latestErrorId` from the `RecentIncident` shape).
- **Infra dots — instance-wide from `/system/health`.** The `api`/`db`/`redis`/`queue` slots
  reflect the health of the single SignalMonitor instance, not per-project monitors. The value
  is sourced once from the existing `GET /system/health` snapshot and attached as the same `infra`
  object to every project in the response. No schema change, no monitor-naming convention, no
  `role`/`tag` column required.
- **Per-env breakdown — lazy-loaded on card expand.** The `/query/fleet` response is
  project-level only; `envs[]` is not included. A separate lightweight endpoint
  `GET /query/fleet/projects/:id/environments` returns env-level data when a card is expanded.

## Architecture

### 1. Route

```
GET /query/fleet
```

**Auth:** `requireHumanUser()` — cookie session. Reuses the existing helper from `query.ts`.

**Query parameters:**

| Param    | Type                           | Required | Default | Notes                                      |
|----------|--------------------------------|----------|---------|--------------------------------------------|
| `window` | `"24h" \| "7d" \| "30d"`      | no       | `"24h"` | Accepted for forwards-compatibility; logic is currently pinned to 24 h. Non-enum values → 400. |

**Errors:** same error codes as existing query routes — `401 unauthenticated`, `400 invalid_query`.

**Registration:** add handler in `apps/api/src/routes/query.ts` alongside the existing overview
and operations handlers, following the identical plugin pattern (`fastify.get("/query/fleet", …)`).

### 1b. Per-environment endpoint

```
GET /query/fleet/projects/:id/environments
```

**Auth:** `requireHumanUser()` — same session cookie as the fleet endpoint.

**Path parameter:** `:id` — the project id (same `id` as returned in `FleetProject.id`).

**Response:**

```ts
type FleetProjectEnvsResponse = {
  data: {
    projectId: string;
    envs: FleetProjectEnv[];
  };
};

type FleetProjectEnv = {
  name: string;                   // "production", "staging", etc.
  status: "ok" | "warning" | "critical";
  incidents: number;
  errorRatePercent: number | null;
  events: number;
  note: string | null;            // e.g. "no data" if env has zero events in window
};
```

**Computation:** for each non-archived environment of the project, run `getOperations(db,
{ projectId, environmentId, window })` (production first, then remaining envs). Extract
`{ name, status, incidents, errorRatePercent, events }`. Cap at 5 environments per project.
`note` is `"no data"` if `events === 0` and `status === "ok"`, otherwise `null`.

**Errors:** `401 unauthenticated`, `404` if project id is unknown or archived.

**Performance:** one `getOperations` call per environment (capped at 5). This is a separate
round-trip triggered only when the user expands a card, keeping the main fleet payload light.

### 2. Response contract

```ts
// Top-level envelope (matches existing query routes)
type FleetResponse = {
  data: FleetData;
};

type FleetData = {
  window: "24h" | "7d" | "30d";
  generatedAt: string;           // ISO timestamp

  /** One entry per non-archived project, sorted by status severity then name. */
  projects: FleetProject[];

  /** Aggregate across all projects. */
  rollup: FleetRollup;
};

type FleetProject = {
  id: string;
  name: string;

  /** Derived operational health verdict for this project. See §3.1. */
  status: "ok" | "warning" | "critical";

  // --- Incident & alert counts ---
  incidents: number;             // open + investigating
  alerts: number;                // alert_events triggered in window

  // --- Error rate ---
  errorRatePercent: number | null;   // (errors / traces) * 100; null if no traces
  errorRateDelta: number | null;     // pp change vs prior equivalent window; null if no prior data

  /** 12-point hourly error-count sparkline over the window (index 0 = oldest). */
  errorTrend: number[];

  // --- Volume ---
  events: number;                // event count in window
  activeUsers: number;           // distinct user_id in window
  activeTenants: number;         // distinct tenant_id in window

  // --- LLM ---
  llmCostUsd: string;            // numeric string, e.g. "142.18"
  llmCostDeltaUsd: string | null;  // delta vs prior equivalent window; null if no prior data

  // --- Latency ---
  p95TraceDurationMs: number | null;
  p95DeltaMs: number | null;     // delta vs prior equivalent window; null if no prior data

  // --- Infrastructure health ---
  // Instance-wide: same object on every project card. Sourced from GET /system/health. See §3.6.
  infra: {
    api:   "ok" | "warning" | "critical";
    db:    "ok" | "warning" | "critical";
    redis: "ok" | "warning" | "critical";
    queue: "ok" | "warning" | "critical";
  };

  /** Most severe open incident, if any. */
  topIncident: {
    message: string;
    traceOrRouteName: string | null;
    occurrenceCount: number;      // from error_groups.occurrence_count via latestErrorId join
    affectedUsers: number;        // from error_groups.affected_users_count via latestErrorId join
    severity: "critical" | "warning";
  } | null;

  // NOTE: envs[] is NOT included in the fleet response.
  // Fetch GET /query/fleet/projects/:id/environments on card expand.
};

type FleetRollup = {
  counts: { ok: number; warning: number; critical: number };
  incidents: number;              // sum across all projects
  alerts: number;                 // sum across all projects
  llmCostUsd: string;             // sum across all projects, numeric string
  overall: "ok" | "warning" | "critical";  // critical > warning > ok
  total: number;                  // total project count
};
```

### 3. Field computation

#### 3.1 Project status (`status`)

Reuse the `resolveStatus` logic already defined in `packages/db/src/repositories/operations-query.ts`.
Call `getOperations(db, { projectId, environmentId, window })` for each project's production
environment and read the top-level `status` field it returns (`"healthy" | "degraded" |
"unhealthy" | "not_configured"`). Map to the response type:

| `getOperations` result | `FleetProject.status` |
|------------------------|-----------------------|
| `"healthy"`            | `"ok"`                |
| `"degraded"`           | `"warning"`           |
| `"unhealthy"`          | `"critical"`          |
| `"not_configured"`     | `"ok"`                |

#### 3.2 Error rate, events, users, tenants, LLM cost, p95

Call `getOverview(db, { projectId, environmentId, window })` (already exists in
`packages/db/src/repositories/telemetry-query.ts`) and extract:

| Response field            | Source in `getOverview` result        |
|---------------------------|---------------------------------------|
| `errorRatePercent`        | `summary.telemetry.errorRatePercent` from `getOperations`, or recomputed: `(kpis.errors / kpis.traces) * 100` — use whichever avoids a second query |
| `events`                  | `kpis.events`                        |
| `activeUsers`             | `kpis.activeUsers`                   |
| `activeTenants`           | `kpis.activeTenants`                 |
| `llmCostUsd`              | `kpis.llmCostUsd`                    |
| `p95TraceDurationMs`      | `kpis.p95TraceDurationMs`            |

Since both `getOperations` and `getOverview` are needed anyway (for status + metrics), the
implementation calls them concurrently per project via `Promise.all`.

#### 3.3 errorTrend (12-point sparkline)

Extract from `getOverview` result: `trends.errors` — an array of `{ bucketStart, errors }`.
For the `"24h"` window, `getOverview` already returns hourly buckets; slice to the last 12 or
pad with zeros if fewer buckets exist. Map to `number[]` (error counts only, not openErrors).

#### 3.4 Delta fields (`errorRateDelta`, `llmCostDeltaUsd`, `p95DeltaMs`)

Delta fields are computed in v1. For each project, a second set of queries is run against the
prior equivalent window `[now-2×window, now-window]`:

- Run `getOverview(db, { projectId, environmentId, window: priorWindowRange })` for the
  prior window to obtain `errorRatePercent`, `llmCostUsd`, and `p95TraceDurationMs`.
- Compute deltas: `delta = currentValue - priorValue`. Return `null` if prior window has no
  data (zero events or null metrics).

**Query cost:** this doubles the `getOverview` calls per project (one current + one prior).
With N projects, the total `getOverview` calls becomes `2N` instead of `N`. These fire
concurrently within the existing `Promise.all` fan-out. The in-process 10-second TTL cache
(keyed by `projectId + window`) mitigates repeated fleet polls hitting the same data.

#### 3.5 Incident counts and `topIncident`

From `getOperations` result:

- `incidents`: `summary.incidents.open + summary.incidents.investigating`
- `alerts`: `summary.alerts.events.total`
- `topIncident`: from `recent.incidents[0]` (the first entry in the list, which is already
  sorted by priority + severity). Map fields:

```ts
topIncident = incident == null ? null : {
  message: incident.message,
  traceOrRouteName: null,         // not available in RecentIncident; always null for now
  occurrenceCount: errorGroup.occurrence_count,    // joined from error_groups via latestErrorId
  affectedUsers: errorGroup.affected_users_count,  // joined from error_groups via latestErrorId
  severity: incident.severity === "critical" ? "critical" : "warning",
};
```

The fleet query joins `error_groups` using `incident.latestErrorId` to resolve
`occurrenceCount` and `affectedUsers`. If the join returns no row (e.g. error_group was
deleted), fall back to `occurrenceCount: 0, affectedUsers: 0`.

#### 3.6 Infrastructure health (`infra`)

The `infra` object represents the health of the **single SignalMonitor instance**, not
per-project monitors. It is the same for every project card — sourced once per fleet request
from the existing `GET /system/health` snapshot (the internal system-health check already
reports api, db, redis, and queue component statuses).

**Approach:**
1. Fetch the system-health snapshot once at the start of `getFleetRollup`.
2. Map each component status to `"ok" | "warning" | "critical"` using the same scale as
   existing health checks.
3. Attach the resulting `infra` object to every `FleetProject` in the response (same reference).

This is a deliberate simplification: infra status is instance-wide, not per-project. There is
no monitor-naming convention, no `role`/`tag` column, and no schema migration required.

#### 3.7 Fleet rollup

Computed in-process from the `projects[]` array after all per-project data is assembled:

```ts
rollup = {
  counts: {
    ok:       projects.filter(p => p.status === "ok").length,
    warning:  projects.filter(p => p.status === "warning").length,
    critical: projects.filter(p => p.status === "critical").length,
  },
  incidents: projects.reduce((s, p) => s + p.incidents, 0),
  alerts:    projects.reduce((s, p) => s + p.alerts, 0),
  llmCostUsd: projects.reduce((s, p) => s + parseFloat(p.llmCostUsd), 0).toFixed(2),
  overall:   projects.some(p => p.status === "critical") ? "critical"
           : projects.some(p => p.status === "warning")  ? "warning"
           : "ok",
  total: projects.length,
};
```

### 4. Repository function

**File:** `packages/db/src/repositories/fleet-query.ts` (new file)

**Export:**

```ts
export async function getFleetRollup(
  db: DbClient,
  opts: { window: "24h" | "7d" | "30d" }
): Promise<FleetRollupResult>
```

**Implementation outline (no code, illustrative only):**

1. Fetch all non-archived projects via `packages/db/src/repositories/admin.ts` →
   `getProjects()` (or equivalent admin repo function).
2. For each project, resolve its production environment id (or lexically-first env) via
   `getProjectEnvironments(db, projectId)`.
3. Fetch system-health snapshot once (for the shared `infra` object).
4. Fan out concurrently (all projects in parallel via `Promise.all`) — for each
   `(projectId, environmentId)` pair:
   - `getOperations(db, { projectId, environmentId, window })` — status, incidents, alerts,
     top incident (+ join to `error_groups` for `occurrenceCount`/`affectedUsers`).
   - `getOverview(db, { projectId, environmentId, window: currentWindow })` — events, users,
     tenants, llmCost, p95, errorTrend buckets.
   - `getOverview(db, { projectId, environmentId, window: priorWindow })` — prior-window
     metrics for delta computation.
5. Assemble `FleetProject[]` (attach shared `infra` object), then compute `FleetRollup`
   in-process.

**Performance note:** With N projects, this is `N × 3` concurrent Postgres queries per fleet
request (operations + current overview + prior overview). For a typical small fleet (≤ 10
projects), all queries fire in a single `Promise.all` round. The prior-window queries are the
same shape as current-window queries and benefit from the same indexes
(`(project_id, environment_id, timestamp)`). The fleet payload itself is lighter than the
original design because `envs[]` is not included — per-env data is fetched lazily on card
expand via `GET /query/fleet/projects/:id/environments`.

**Caching:** For v1, add a simple in-process `Map` keyed by `window` value with a 10-second
TTL. The fleet endpoint is read-only and the Health Rail polls it periodically; a short TTL
prevents thundering-herd on the DB without adding Redis dependency. A Redis-backed cache with
a 30-second TTL can replace this if the fleet grows to 20+ projects.

### 5. Project visibility scoping

All non-archived projects are included. The existing `getProjects()` admin repo function
already filters `archived_at IS NULL`. There is no per-user project ACL in the current schema
— every authenticated session sees all projects. If per-user ACLs are introduced later, the
fleet function must accept a `userId` filter and delegate scope enforcement to the repo layer,
not the route handler.

### 6. Module layout

```
apps/api/src/routes/
  query.ts                         # add GET /query/fleet and GET /query/fleet/projects/:id/environments handlers here

packages/db/src/repositories/
  fleet-query.ts                   # new: getFleetRollup()
  telemetry-query.ts               # existing: getOverview() — reused, not modified
  operations-query.ts              # existing: getOperations() — reused, not modified
  admin.ts                         # existing: getProjects(), getProjectEnvironments() — reused
```

No schema migrations required — the fleet rollup is purely derived from existing tables.

## Testing

The project uses Vitest colocated tests. For `fleet-query.ts`:

- **Unit (mock DB):** stub `getOperations` and `getOverview` return values; assert that
  `getFleetRollup` correctly maps status codes, accumulates rollup totals, handles a project
  with no traces (`errorRatePercent = null`), and sorts `projects[]` by severity then name.
- **Status mapping:** assert all four `getOperations` status values map to the correct
  `FleetProject.status`.
- **Rollup math:** assert `overall` is `"critical"` if any project is critical, `"warning"` if
  any is warning but none critical, `"ok"` if all ok.
- **Delta computation:** assert delta is the arithmetic difference between current and prior
  window values; assert `null` when prior window has no data.
- **`topIncident` shape:** assert `occurrenceCount` and `affectedUsers` are populated from the
  `error_groups` join; assert fallback to `0` when join returns no row.
- **Infra object:** assert the same `infra` reference is attached to every project; assert
  system-health snapshot is fetched exactly once per `getFleetRollup` call.
- **Empty fleet:** zero projects → rollup with all zeros and `overall: "ok"`.

For `GET /query/fleet/projects/:id/environments`:

- **Auth guard:** unauthenticated request → 401.
- **Unknown project:** non-existent or archived project id → 404.
- **Success:** assert response has `data.envs[]` with correct shape; assert production env
  appears first; assert capped at 5 envs.

For the route handler in `query.ts`:

- **Auth guard:** unauthenticated request → 401.
- **Invalid window param:** `window=foo` → 400.
- **Success:** assert response envelope has `data.projects` (no `envs` field on each project)
  and `data.rollup`.

## Verification

```sh
pnpm test                            # all packages
pnpm --filter @sigmon/api build
pnpm tsc --noEmit                    # from workspace root
```

Manual smoke:
```sh
curl -s -b <session-cookie> "http://localhost:3000/query/fleet" | jq '.data.rollup'
curl -s -b <session-cookie> "http://localhost:3000/query/fleet/projects/<id>/environments" | jq '.data.envs'
```

## Out of scope (B1)

- Multi-window fleet view (`window=7d`, `window=30d`) — accepted param, same 24 h logic for v1.
- Per-user project ACL scoping — not in current schema.
- Redis-backed distributed cache — in-process TTL cache is sufficient for ≤ 20 projects.
- `topIncident.traceOrRouteName` — not available in `RecentIncident`; always `null` for v1.

## Resolved decisions

**A — Delta fields in v1 (resolved: COMPUTE NOW):**
`errorRateDelta`, `llmCostDeltaUsd`, and `p95DeltaMs` are computed in v1 via a second
prior-window `getOverview` query per project. This doubles per-project `getOverview` calls
(`2N` total). The 10-second in-process cache mitigates thundering-herd on the DB.

**B — `topIncident` detail fields (resolved: FULL, with counts):**
`occurrenceCount` and `affectedUsers` are included. The fleet query joins `error_groups` using
`incident.latestErrorId` to resolve these fields. Fallback to `0` if the join returns no row.
`traceOrRouteName` remains `null` (not available in `RecentIncident`).

**C — Infrastructure health slot naming (resolved: DERIVE FROM `/system/health`, INSTANCE-WIDE):**
The `infra` object is sourced once from the existing `GET /system/health` snapshot and
attached as the same object to every project. No monitor-naming convention, no schema change,
no `role`/`tag` column. Infra status is instance-wide by design.

**D — Production environment resolution:**
Each project resolves to its `production` environment (case-insensitive match) or the
lexically-first environment as fallback. Projects with no environments are excluded (returned
as `not_configured` → mapped to `"ok"` in fleet status).

**E — `envs[]` depth vs performance (resolved: LAZY-LOAD ON CARD EXPAND):**
`envs[]` is not included in the `/query/fleet` response. The env accordion fetches
`GET /query/fleet/projects/:id/environments` on card expand (one extra round-trip, triggered
only on user interaction). This keeps the fleet payload lighter and eliminates the N-envs
fan-out from the main request.
