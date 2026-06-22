# S4 · Console v2 — Incidents list screen

**Epic:** SignalMonitor Console v2 — dark redesign
**Issue:** PER-351
**Date:** 2026-06-22
**Status:** Draft for review
**Depends on:** F1, F2, S2, **B3**, **S3** (all merged). Branch `feat/console-v2-s4-incidents-list` off main.

## Goal

Port the v2 **Incidents list** screen (`IncidentsScreen`) — a priority-ordered triage list of active incidents (error groups in `open`/`investigating` status) with KPI tiles and drill-to-detail. Design source: `.claude/design-v2/app-screens-b.jsx` (`IncidentsScreen`). English copy (translate the pt-BR strings). This **flips the `incidents` nav section from legacy `InvestigationWorkspace` to the new v2 screen.** Read-only list + drill — the only write workflow (triage actions) lives in the S3 incident detail this screen drills into, so the "read-only unless a design explicitly introduces a mutation workflow" constraint holds.

## Navigation model (reuses S3 drill/back — no shell change)

The drill/back foundation landed in S3 (`ScreenCtx.drill`/`back`, `ConsoleShellV2` `detail` state, clear-on-section-nav). S4 only:
- Flips `registry.tsx` `incidents` entry from `kind: "legacy"` (`InvestigationWorkspace`) to `kind: "v2"` rendering `<IncidentsScreen ctx={ctx} />`. (Keep the `InvestigationWorkspace` import — `llm`/`traces` sections still use it.)
- Each incident card click calls `ctx.drill("incident", { groupId: row.id })` — the existing shell renders `IncidentScreen` over the section. No `ConsoleShellV2` change needed.

## Data wiring

`useIncidents(ctx)` composes the list fetch + KPI sources, mirroring `useErrors.ts` (loading/ok/error states, `genRef` stale-fetch guard, reads `projectId`/`environmentId` from ctx, maps to a VM, `reload()`).

- **Active incidents (cards):** two concurrent `listErrorGroups({ projectId, environmentId, status, limit: 100 })` calls — `status: "open"` and `status: "investigating"` — merged (statuses are mutually exclusive, no dedup needed). The server has **no sort param**, so sort client-side: priority rank `urgent(0) < high(1) < normal(2) < low(3) < null(4)`, then `lastSeenAt` desc.
- **KPI tiles (4):**
  - **Active** = merged active list length (`open + investigating` count of what was loaded).
  - **P1 critical** = merged list filtered to `priority === "urgent"` length.
  - **MTTR (7d)** = `getIncidentMttr({ projectId, environmentId, window: "7d" }).mttrMs` → `formatDurationShort`.
  - **Resolved (7d)** = `getIncidentMttr(...).resolvedCount`.
  - Rationale for deriving Active/P1 from the list rather than `getOperations`: the tile count then matches exactly the cards shown, and avoids window-semantics ambiguity for status-snapshot counts. The `limit: 100`/status cap is a non-issue for the self-hosted single-install target. (`getOperations.summary.incidents` as a precision source is a possible later refinement → follow-up.)
- **New client method (`api/client.ts` + `api/types.ts`):** `getIncidentMttr(query: IncidentMttrQuery) => Promise<AggregateResponse<IncidentMttrResult>>` following the existing `*Path()` + `request<T>()` pattern. Path `/query/incidents/mttr?project_id&environment_id&window`. **Confirm the exact server response shape** by reading the `GET /query/incidents/mttr` handler in `apps/api/src/routes/query.ts`; spec assumes `IncidentMttrResult = { mttrMs: number | null; resolvedCount: number; windowDays: number }`. `IncidentMttrQuery = { projectId: string; environmentId: string; window?: "24h" | "7d" | "30d" }`.
- **Extend console `ErrorGroupRecord` (`api/types.ts`)** with the B3 fields the server already returns but the console type omits: `assignedToUserId: string | null`, `incidentNumber: string | null`, `silencedUntil: string | null`. **Verify** these are actually serialized in the list response (read `packages/db` `ErrorGroupRecord` + the `toGroup` mapper at `error-groups.ts` and the route — Explore confirmed the mapper includes them at lines ~156-158). If the list response does NOT carry them, report DONE_WITH_CONCERNS and degrade (omit INC#/assignee on cards + follow-up).
- **Assignee initials:** the list carries only `assignedToUserId` (an id), not an email. Call `listUsers()` (admin-gated `/admin/users`) to build an `id → email` map for initials. **Degrade exactly as S3:** on 401/403 (non-admin) or id-not-found, show a generic "assigned" avatar (no initials) when `assignedToUserId` is set, and the `unassigned` tag when null. Do not fabricate. Reuse the IncidentScreen avatar-initials derivation (initials from email local part) for consistency.

### View-model (`IncidentRowVM` + `IncidentsVM`) field map
- **Per card (`IncidentRowVM`):** `id` (= group id, the drill param), `severity` (→ stripe class + sev tag tone, reuse the `ErrorsScreen` severity mapping), `priority` (→ `PriorityPill`, map urgent→P1…low→P4 via the existing `useErrors` PRIORITY_MAP), `status` (→ `StatusPill`, `open`/`investigating` map directly), `incidentNumber` (→ INC# mono tag, omit when null), `openedRelative` = `relativeTime(firstSeenAt)`, `assignee: { initials } | "generic" | null`, `message` (mono), `occurrenceCount`, `affectedUsersCount`, `affectedTenantsCount`.
- **KPIs (`IncidentsVM.kpis`):** `{ active: number; p1: number; mttrLabel: string; resolved7d: number }`.
- **Trend sparkline:** the list carries **no per-group hourly series** (same gap S3 hit for the occurrence bars). **Degrade: omit the sparkline.** Do not fabricate the 12-point trend. Let the card's bottom-row spacer flex to fill. Reuse the existing PER-364 follow-up (per-group occurrence/trend endpoint) — render the sparkline once it lands.

## Module layout
```
apps/console/src/
  api/types.ts                 # MODIFY: extend ErrorGroupRecord (assignedToUserId, incidentNumber, silencedUntil); add IncidentMttrQuery + IncidentMttrResult
  api/client.ts                # MODIFY: getIncidentMttr method + incidentMttrPath helper
  components/ui/v2/format.ts   # MODIFY: add formatDurationShort(ms: number | null): string  (+ test)
  v2/screens/registry.tsx      # MODIFY: incidents section → kind "v2" IncidentsScreen
  v2/screens/useIncidents.ts   + useIncidents.test.ts      # NEW: fetch + KPIs + VM
  v2/screens/IncidentsScreen.tsx + IncidentsScreen.test.tsx # NEW: the screen
```
Reuse F1 `ui/v2` primitives: `PageHead`/`BigKpi`/`PriorityPill`/`StatusPill`/`Icon`/`EmptyHint` + `relativeTime`/`formatCompact`/`formatDurationShort` formatters. Avatar: there is no v2 Avatar component — render the design's `tb-avatar` CSS class as a small inline `<span className="tb-avatar">` (matches IncidentScreen note avatars).

### English copy
History · Filters · "Priority triage for **{project} · {env}** — {n} active." · Active · P1 critical · MTTR (7d) · Resolved (7d) · Active incidents · "sorted by priority" · occurrences · users · tenants · unassigned · "opened {rel} ago" · "Open →".

### Page-head actions (History / Filters)
The design shows non-functional History/Filters buttons. No backing behavior exists. **Render them as stubs** (preserve page-head fidelity) wired to `ctx.pushToast("Incident history is not yet available")` / `ctx.pushToast("Incident filtering is not yet available")` — matching the S3 Create-issue stub idiom. File a follow-up for real list filtering/history.

## Testing
- **useIncidents** — merges open+investigating into the active list; sorts by priority rank then lastSeenAt desc; derives kpis.active/p1; maps mttrLabel from getIncidentMttr.mttrMs (incl. null→"—") and resolved7d from resolvedCount; assignee map from listUsers; listUsers 401/403 → generic-avatar flag (no initials); incidentNumber/assignee/status/priority VM mapping; stale-fetch guard (genRef, reuse useErrors pattern); loading + error states; reload().
- **IncidentsScreen** — renders 4 KPI tiles with derived values; renders one card per active incident (sev tag + stripe, PriorityPill, StatusPill, INC# when present/omitted when null, opened-relative, assignee avatar initials / generic / unassigned tag, mono message, occurrences/users/tenants counts); sparkline omitted (no fabricated trend); card click → `ctx.drill("incident", { groupId })`; History/Filters → pushToast stubs; empty state (no active incidents) → EmptyHint; English-only.
- **format** — `formatDurationShort`: ms→"42 min", sub-hour minutes, hours with one decimal for ≥60min, null→"—", 0→"0 min" (pick + assert exact thresholds).
- **registry** — `incidents` section is now `kind: "v2"` and renders IncidentsScreen (update registry.test if it asserts the legacy shape).
- No regression; full suite green; branding (no literal `SignalHub` — split-needle); any `.test.ts` using renderHook gets `// @vitest-environment jsdom`.

## Verification
`pnpm --filter @sigmon/console test` · `pnpm --filter @sigmon/console build` · `pnpm test` (repo, branding) · `pnpm build`. Manual `/?v2=1` → Incidents nav → v2 list with KPI tiles + active cards; click a card → S3 Incident detail opens; back returns to the list; legacy `llm`/`traces` unaffected.

## Out of scope / follow-ups (PER-364)
- **Per-group trend sparkline** — no hourly series on list items; S4 omits the card sparkline. (Same follow-up as S3's occurrence bars — per-group trend endpoint, then render.)
- **Incident list filtering + history** — History/Filters page-head buttons are pushToast stubs; real filtering (by priority/status/assignee) deferred.
- **Assignee initials for non-admins** — list response carries only `assignedToUserId`; non-admins (no `listUsers`) see generic avatars. Expose assignee `{ id, email }` in the error-groups list response so all viewers get initials.
- **`getOperations`-backed Active/P1 counts** — possible precision refinement over list-derived counts (true server status counts, no limit cap).
