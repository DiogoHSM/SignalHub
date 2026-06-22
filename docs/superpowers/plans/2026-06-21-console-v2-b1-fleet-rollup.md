# Console v2 — B1 Cross-project Fleet Rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /query/fleet` (cross-project health rollup) + `GET /query/fleet/projects/:id/environments` (lazy per-env), powering the Console v2 Health Rail, by composing existing per-project repository functions — no new SQL of substance, no schema migration.

**Architecture:** A new `getFleetRollup(db, opts)` in `packages/db/src/repositories/fleet-query.ts` fans out over all non-archived projects, calling the existing `getOperations` + `getOverview` (current and prior window) per project concurrently, joining `error_groups` for top-incident counts, attaching an instance-wide `infra` object from the system-health snapshot, and computing the rollup in-process. Two thin handlers in `apps/api/src/routes/query.ts` expose it with a 10 s in-process TTL cache.

**Tech Stack:** Fastify (API), Drizzle/Postgres repos (`packages/db`), Vitest. Follows existing `/query/overview` + `/query/operations` patterns.

## Global Constraints

- Package filters: `@sigmon/api`, `@sigmon/db`. Repo-wide checks: `pnpm test`, `pnpm build`.
- **Reuse, don't duplicate SQL.** `getFleetRollup` composes existing repo functions (`getOperations` in `operations-query.ts`, `getOverview` in `telemetry-query.ts`, `getProjects`/`getProjectEnvironments` in `admin.ts`, the system-health snapshot repo). The only new query is the `error_groups` join for `topIncident` counts (by `latestErrorId`) — and only if `getOperations` doesn't already surface them.
- **Auth:** both routes use the existing `requireHumanUser()` from `query.ts`. No admin restriction. All non-archived projects are visible (no per-user ACL exists).
- **Response envelope** matches existing query routes: `{ data: … }`. Field names, types, and shapes are EXACTLY as in the B1 spec §2 / §1b (`docs/superpowers/specs/2026-06-21-console-v2-b1-fleet-rollup-design.md`) — copy them verbatim. Money as numeric strings (`"142.18"`), counts as numbers, nullable metrics as `… | null`.
- **Decisions (locked):** deltas computed (prior-window query per project); `topIncident` full with `occurrenceCount`/`affectedUsers`; `infra` instance-wide from `/system/health` (same object on every project); `envs[]` NOT in fleet response (lazy endpoint); production env (or lexically-first) only; `window` accepted but pinned to 24 h logic.
- **No schema migration.** Purely derived from existing tables.
- Tests colocate (Vitest), follow existing `packages/db` repo tests and `apps/api` route tests.

## File Structure

```
packages/db/src/repositories/
  fleet-query.ts            # NEW: getFleetRollup() + getProjectFleetEnvironments() + result types
  fleet-query.test.ts       # NEW
  operations-query.ts       # reused (read for signatures; not modified)
  telemetry-query.ts        # reused (read for signatures; not modified)
  admin.ts                  # reused: getProjects, getProjectEnvironments
  system.ts                 # reused: system-health snapshot (read for the infra source)
apps/api/src/routes/
  query.ts                  # MODIFY: register the two handlers + 10s TTL cache
  query.fleet.test.ts       # NEW route tests (or add to existing query route test file, matching its pattern)
```

---

### Task 1: `getFleetRollup` repository function

**Files:**
- Create: `packages/db/src/repositories/fleet-query.ts`
- Test: `packages/db/src/repositories/fleet-query.test.ts`

**Interfaces:**
- Produces `getFleetRollup(db, opts: { window: "24h"|"7d"|"30d" }): Promise<FleetData>` and the exported types `FleetData`, `FleetProject`, `FleetRollup` — **shapes copied verbatim from B1 spec §2** (`docs/superpowers/specs/2026-06-21-console-v2-b1-fleet-rollup-design.md` lines under "### 2. Response contract"). `FleetData` omits the top envelope (`{ data }` is added by the route).
- Consumes (read these first for their exact opts + return shapes — do NOT assume): `getOperations` (`operations-query.ts`), `getOverview` (`telemetry-query.ts`), `getProjects` + `getProjectEnvironments` (`admin.ts`), and the system-health snapshot function (`system.ts`). Map per B1 spec §3.

- [ ] **Step 1: Read the composed functions' signatures.** Open `operations-query.ts` (`getOperations` opts + result: `status`, `summary.incidents.{open,investigating}`, `summary.alerts.events.total`, `recent.incidents[]` incl. `message`/`severity`/`latestErrorId`, `summary.telemetry.errorRatePercent`), `telemetry-query.ts` (`getOverview` opts + result: `kpis.{events,activeUsers,activeTenants,llmCostUsd,p95TraceDurationMs}`, `trends.errors[]`), `admin.ts` (`getProjects`, `getProjectEnvironments`), `system.ts` (health snapshot component statuses). **Confirm how the window is passed.** If `getOverview` accepts only an enum window (not an arbitrary `[from,to]` range), the prior-window delta query needs a range-capable variant — if so, STOP and report DONE_WITH_CONCERNS describing the gap (do not invent a range param). Record the real signatures in your report.

- [ ] **Step 2: Write the failing unit test** — `fleet-query.test.ts`. `vi.mock` the composed modules so the test is pure. Cover (assert against the verbatim shape):

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
// vi.mock("./operations-query"), ("./telemetry-query"), ("./admin"), ("./system") — return controllable stubs
import { getFleetRollup } from "./fleet-query";

// helpers build stub getOperations/getOverview results keyed by projectId/window
describe("getFleetRollup", () => {
  it("maps getOperations status → FleetProject.status for all four values", async () => { /* healthy→ok, degraded→warning, unhealthy→critical, not_configured→ok */ });
  it("computes rollup counts/overall (critical>warning>ok) and summed totals", async () => { /* overall critical if any critical */ });
  it("computes deltas as current−prior, null when prior window has no data", async () => {});
  it("populates topIncident occurrenceCount/affectedUsers from the error_groups join; falls back to 0 when no row", async () => {});
  it("attaches the SAME instance-wide infra object to every project and fetches system-health once", async () => {});
  it("excludes archived projects, resolves production env (or lexically-first), sorts by severity then name", async () => {});
  it("errorRatePercent is null when no traces; errorTrend is a 12-point number[]", async () => {});
  it("empty fleet → counts all zero, overall 'ok', total 0", async () => {});
});
```

- [ ] **Step 3: Run to verify it fails** — `pnpm --filter @sigmon/db test -- fleet-query` → FAIL (no module).

- [ ] **Step 4: Implement `fleet-query.ts`** per B1 spec §3–§4:
  - Export the `FleetData`/`FleetProject`/`FleetRollup` types verbatim from the spec.
  - `getProjects()` → non-archived; for each, resolve prod env (case-insensitive `production`, else lexically-first; skip projects with no env, treated as `not_configured`→`ok`).
  - Fetch the system-health snapshot once; build the shared `infra` object (map component statuses to `ok|warning|critical`).
  - `Promise.all` over projects, each doing `getOperations(current)`, `getOverview(current)`, `getOverview(prior)` concurrently; map fields per §3.1–§3.5; join `error_groups` by `recent.incidents[0].latestErrorId` for top-incident counts (fallback 0).
  - Assemble `FleetProject[]` (attach the shared `infra`), sort by severity (critical→warning→ok) then name, compute `FleetRollup` per §3.7. `generatedAt` = caller-injectable clock or `new Date().toISOString()` (inject a `now`/clock param if needed for deterministic tests).

- [ ] **Step 5: Run to verify it passes** — `pnpm --filter @sigmon/db test -- fleet-query` → PASS.

- [ ] **Step 6: Commit** — `git add packages/db/src/repositories/fleet-query.ts packages/db/src/repositories/fleet-query.test.ts && git commit -m "feat(db): getFleetRollup cross-project aggregation (PER-344)"`

---

### Task 2: per-environment fleet function

**Files:**
- Modify: `packages/db/src/repositories/fleet-query.ts` (add function + type)
- Test: `packages/db/src/repositories/fleet-query.test.ts` (add cases)

**Interfaces:** Produces `getProjectFleetEnvironments(db, opts: { projectId: string; window: "24h"|"7d"|"30d" }): Promise<{ projectId: string; envs: FleetProjectEnv[] }>` with `FleetProjectEnv` exactly per B1 spec §1b (`name`, `status`, `incidents`, `errorRatePercent`, `events`, `note`). Throws/returns a sentinel for unknown/archived project so the route can map to 404.

- [ ] **Step 1: Write the failing test** — add to `fleet-query.test.ts`: returns one entry per non-archived env (mock `getProjectEnvironments` + `getOperations`), production first, capped at 5, `note: "no data"` when `events===0 && status==="ok"` else `null`; unknown/archived project → the documented sentinel/throw.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** per §1b: resolve project (404 path if unknown/archived), list non-archived envs (production first), `getOperations` per env, map fields, cap 5.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(db): getProjectFleetEnvironments lazy per-env fleet data (PER-344)"`

---

### Task 3: route handlers + TTL cache

**Files:**
- Modify: `apps/api/src/routes/query.ts`
- Test: `apps/api/src/routes/query.fleet.test.ts` (or extend the existing query-route test file following its pattern)

**Interfaces:**
- `GET /query/fleet` — `requireHumanUser()`; validate `window` ∈ {24h,7d,30d} (default 24h; invalid → 400); call cached `getFleetRollup`; respond `{ data }`.
- `GET /query/fleet/projects/:id/environments` — `requireHumanUser()`; call `getProjectFleetEnvironments`; unknown/archived → 404; respond `{ data: { projectId, envs } }`.
- 10 s in-process TTL cache (a module-level `Map` keyed by `window`) wrapping `getFleetRollup` only; the per-env route is uncached.

- [ ] **Step 1: Read** how existing `/query/overview` + `/query/operations` handlers are registered in `query.ts` (auth wiring, query validation, error envelope, how they obtain `db`). Mirror it exactly.
- [ ] **Step 2: Write the failing route tests** — mirror the existing query-route test setup (build the fastify app, inject a session). Assert: unauthenticated → 401 (both routes); `GET /query/fleet?window=foo` → 400; `GET /query/fleet` success → body has `data.projects` (each WITHOUT an `envs` field) + `data.rollup`; `GET /query/fleet/projects/:id/environments` success → `data.envs[]`, unknown id → 404. Stub `getFleetRollup`/`getProjectFleetEnvironments` (vi.mock the repo) so route tests don't hit the DB.
- [ ] **Step 3: Run → fail.**
- [ ] **Step 4: Implement** the two handlers + the TTL cache helper (`getCachedFleet(window)`: return cached value if `< 10_000ms` old, else compute+store; keyed by `window`). Keep handlers thin.
- [ ] **Step 5: Run → pass.**
- [ ] **Step 6: Commit** — `git commit -m "feat(api): GET /query/fleet + per-env route with 10s TTL cache (PER-344)"`

---

### Task 4: Full B1 verification

**Files:** none.

- [ ] **Step 1:** `pnpm --filter @sigmon/db test -- fleet-query && pnpm --filter @sigmon/api test` → pass.
- [ ] **Step 2:** `pnpm build` (or `pnpm --filter @sigmon/api build` + `pnpm --filter @sigmon/db build`) → clean.
- [ ] **Step 3:** `pnpm test` repo-wide → all green (incl. branding contract; no regressions in existing query routes).
- [ ] **Step 4: Manual smoke** (optional, if a dev DB is up): `curl -b <session> localhost:3000/query/fleet | jq '.data.rollup'` and the per-env route. Note results; nothing to commit.

---

## Notes for the implementer
- The composed functions are the contract — read `operations-query.ts`, `telemetry-query.ts`, `admin.ts`, `system.ts` before writing `fleet-query.ts`; the spec's field map (§3) tells you which result field feeds which response field.
- The single genuine risk is the prior-window delta query: if `getOverview` can't express an arbitrary prior `[from,to]` range, escalate (DONE_WITH_CONCERNS) rather than inventing one — the controller will decide (add a range-capable overview variant, or ship deltas null with a follow-up).
- Keep `getFleetRollup` pure (no caching inside) so it stays unit-testable; the TTL cache lives in the route layer.
- `infra` is instance-wide by design — one system-health fetch per fleet request, same object on every project. A test asserts the single fetch.
