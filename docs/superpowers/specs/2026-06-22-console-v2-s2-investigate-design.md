# S2 · Console v2 — Investigate / Errors screen

**Epic:** SignalMonitor Console v2 — dark redesign
**Issue:** PER-349
**Date:** 2026-06-22
**Status:** Draft for review
**Depends on:** F1, F2, S1 (merged). Branch `feat/console-v2-s2-investigate` off main.

## Goal

Port the v2 **Investigate / Errors** screen and flip the `investigate` registry entry legacy→v2. Design source: `.claude/design-v2/app-screens-a.jsx` → `ErrorsScreen`. English copy (translate pt-BR: "severity: all", "status: …", "add filter", "Errors (24h)", "Open groups", "MTTR (7d)", "Top release", "volume / hour", column headers Error/Status/Trend/Priority/Events/Users/Tenants/Last).

## Data wiring (mostly backed; gaps degrade gracefully)

`useErrors(ctx, { window, severity, status })` composes:
- **`listErrorGroups({ project_id, environment_id, status?, severity?, release?, from?, to?, limit })`** → the error-group table rows. `ErrorGroupRecord` has: message, type, severity, `status` (open|investigating|resolved|ignored), `priority` (urgent|high|normal|low), `occurrenceCount`, `affectedUsersCount`, `affectedTenantsCount`, `lastSeenAt`, `latestRelease`, `latestErrorId`, `id`. **Fully backs the table.**
- **`getOverview({ window:"24h" })`** → tab-bar counts (`kpis.events/errors/traces/llmCalls/activeTenants/activeUsers`), summary "Errors (24h)" (`kpis.errors`), the **per-hour volume bars** (`trends.errors[].errors`, 24 buckets), and Critical count (sum `top.errorSeverity` where severity ∈ {critical,fatal}).

### Field map / transforms
- **Priority pill:** map `urgent→P1, high→P2, normal→P3, low→P4` (null → no pill). `PriorityPill` takes `P1..P4`.
- **Status pill:** `StatusPill` already maps open/investigating/resolved/ignored.
- **Severity tag/stripe:** critical→`--sev-critical`, error→`--sev-error`, warning→`--sev-warning` (+ fatal→critical color).
- **Last:** format `lastSeenAt` to relative ("8s","32s","1m","2h") client-side.
- **Tab bar counts:** from overview.kpis (Events/Errors/Traces/LLM/Tenants/Users). Tabs route: Events→overview, Traces→traces, LLM→llm, Tenants→investigate(tenants later)/navigate, Users→navigate; **Errors is the active tab**.
- **Filters:** severity segmented (all/critical/error/warning) → `severity` param; status filter (open/investigating) → `status` param; release filter → `release` param. Grouped/Raw toggle: ship **Grouped** (error-groups); "Raw" can be a stub/disabled until a raw-errors view is specced (note follow-up) — or wire to `listErrors` if trivial. Window segmented 24h/7d (no 1h) → `from/to`.
- **Drill:** row → `navigate("incidents")` for now (full incident detail = S3; the design drills to IncidentScreen which is S3 — until S3 ships, route to the incidents section). When S3 lands, drill renders the incident detail.

### Summary strip — gaps (degrade, don't fabricate; file follow-ups)
- **Errors (24h):** `kpis.errors` ✓
- **Critical:** sum of `top.errorSeverity` critical/fatal ✓ (compute)
- **Open groups:** count of error-groups with status open|investigating from the list response (note: bounded by `limit`; acceptable for the strip). ✓ (derive)
- **MTTR (7d):** **MISSING** — no API metric. This is a **B3 (incident triage) deliverable**. Show "—" in S2 now; wire when B3 lands. (Follow-up / B3 dependency.)
- **Top release:** **MISSING** — no top-release-by-errors metric. Show the most frequent `latestRelease` among the listed groups as a best-effort, or "—". File follow-up.
- **Per-row Trend sparkline (12pt):** **MISSING** — `ErrorGroupRecord` carries only `occurrenceCount`, no per-bucket series. **Omit the sparkline cell** (don't fabricate); keep the column slot minimal or drop it. File follow-up to add a `trend[]` to the error-group record (or a per-group trend endpoint).

## Registry flip
`registry.tsx`: flip `investigate` → `{ kind:"v2", render: (ctx) => <ErrorsScreen ctx={ctx} navigate={ctx.navigate} /> }` (renders dark, no island). The other nav sections stay legacy.

## Module layout
```
apps/console/src/v2/screens/
  useErrors.ts        + useErrors.test.ts      # listErrorGroups + overview compose
  ErrorsScreen.tsx    + ErrorsScreen.test.tsx  # tabs, filters, summary strip, table
  registry.tsx        # MODIFY: investigate → kind:"v2"
```
Reuse `PriorityPill`/`StatusPill`/`Segmented`/`SummaryStat`/`Divider`/`Bars`/`Sparkline`/`Icon` from `ui/v2`. A relative-time formatter: reuse the shared one if S1 created it, else a small local `formatRelative(lastSeenAt)`.

## Testing
- **useErrors** — composes listErrorGroups + overview with the right params; maps priority enum→P1-P4; severity/status filters pass through + refetch; Critical computed from top.errorSeverity; open-groups derived; relative-time mapping; error state.
- **ErrorsScreen** — tab bar with counts + active Errors tab; severity segmented filters rows + refetch; status/release filter affordances; summary strip (Errors 24h, Critical, Open groups real; MTTR "—"); volume bars from trends; table rows (severity stripe, message+id+sev tag, status pill, priority pill, events/users/tenants/last, NO fabricated sparkline); row click → navigate("incidents").
- **registry** — `investigate` is `kind:"v2"`, renders ErrorsScreen not in `.console-legacy-island`.
- No regression; English-only; full suite green.

## Verification
`pnpm --filter @sigmon/console test` · `build` · `pnpm test` (repo, branding). Manual `/?v2=1` → Investigate tab dark with real error groups; filters work; legacy unaffected.

## Out of scope / follow-ups (add to PER-364)
- MTTR(7d) summary stat — lands with **B3**; S2 shows "—" until then.
- Top-release-by-errors metric (S2 best-effort/—).
- Per-error-group **trend[]** (row sparkline) — add to the record or a per-group trend endpoint; S2 omits the spark.
- "Raw" errors view (S2 ships Grouped).
- Full drill-to-incident (S3): S2 routes to the incidents section until S3 lands.
