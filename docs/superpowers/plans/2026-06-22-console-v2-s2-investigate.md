# Console v2 — S2 Investigate/Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Port the v2 Investigate/Errors screen; flip the `investigate` registry entry legacy→v2. No backend changes.

**Architecture:** `useErrors` composes `listErrorGroups` + `getOverview`; `ErrorsScreen` renders tabs + filters + summary strip + error-group table via F1 `ui/v2` primitives; `registry.tsx` flips `investigate` to `kind:"v2"`.

**Tech:** React 19, TS, Vitest. Builds on F1/F2/S1.

## Global Constraints
- Package `@sigmon/console`; branch `feat/console-v2-s2-investigate`.
- **English copy**; no "SignalHub" (branding contract); no pt-BR user strings.
- **Repo-gate gotchas (apply proactively):** any new v2 `*.test.ts` (not `.tsx`) that uses DOM/`renderHook` MUST start with `// @vitest-environment jsdom` (root vitest only jsdom's `.test.tsx`). Any no-branding test assertion must NOT contain the literal `SignalHub` — build the needle from parts (`"Signal"+"Hub"`).
- Fidelity to `.claude/design-v2/app-screens-a.jsx` `ErrorsScreen`; use F1 primitives (`PriorityPill`/`StatusPill`/`Segmented`/`SummaryStat`/`Divider`/`Bars`/`Sparkline`/`Icon`). Read real shapes in `api/types.ts` (`ErrorGroupRecord`, `OverviewResponse`).
- Don't fabricate: omit the per-row trend sparkline (no per-bucket data on `ErrorGroupRecord`); MTTR shows "—" (B3-dependent).
- Window enum 24h/7d (no 1h).

## File Structure
```
apps/console/src/v2/screens/
  useErrors.ts      + useErrors.test.ts        # (.test.ts uses renderHook → add jsdom pragma)
  ErrorsScreen.tsx  + ErrorsScreen.test.tsx
  registry.tsx      # MODIFY: investigate → kind:"v2"
```

---

### Task 1: useErrors hook
**Files:** Create `apps/console/src/v2/screens/useErrors.ts` + `useErrors.test.ts` (**start the test file with `// @vitest-environment jsdom`**).

**Interfaces:**
- Read `api/client.ts` + `api/types.ts` for `listErrorGroups(query)` (`QueryListResponse<ErrorGroupRecord>`) and `getOverview` (`AggregateResponse<OverviewResponse>`). `ErrorGroupRecord`: `{ id, message, type, severity, status, priority: "urgent"|"high"|"normal"|"low"|null, occurrenceCount, affectedUsersCount, affectedTenantsCount, lastSeenAt, latestRelease, latestErrorId }`.
- `useErrors({ client, projectId, environmentId, window, severity, status }) → { data: ErrorsVM|null; status; reload() }`. `ErrorsVM`: `{ tabs: {events,errors,traces,llm,tenants,users (numbers from overview.kpis)}, summary: { errors24h, openGroups, critical, mttr: null, topRelease: string|null }, volume: number[] (trends.errors[].errors), rows: ErrorRowVM[] }`.
  - `ErrorRowVM`: `{ id, message, severity, status, priority: "P1"|"P2"|"P3"|"P4"|null (map urgent→P1/high→P2/normal→P3/low→P4), events: occurrenceCount, users: affectedUsersCount|null, tenants: affectedTenantsCount|null, last: relativeTime(lastSeenAt) }`. NO trend field (omitted).
  - `summary.critical` = sum `overview.top.errorSeverity` where severity ∈ {critical,fatal}; `openGroups` = count of fetched rows with status ∈ {open,investigating}; `mttr` = null (B3); `topRelease` = most frequent `latestRelease` among rows or null.
- Fire `listErrorGroups` (with severity/status filters) + `getOverview({window:"24h"})` concurrently; refetch on param change; gen-counter guard (reuse S1's pattern) for stale-fetch + unmount; `reload()`.

- [ ] Step 1: failing test (jsdom pragma) — mock client; assert priority map, summary.critical computed, openGroups derived, mttr null, volume from trends, rows mapped, filters passed + refetch, error state.
- [ ] Step 2: `pnpm --filter @sigmon/console test -- v2/screens/useErrors` → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: → PASS.
- [ ] Step 5: commit `feat(console-v2): useErrors hook (PER-349)`.

---

### Task 2: ErrorsScreen component
**Files:** Create `apps/console/src/v2/screens/ErrorsScreen.tsx` + `ErrorsScreen.test.tsx`.

**Interfaces:** `ErrorsScreen({ ctx, navigate })`. Manages window/severity/status filter state; calls `useErrors`. Ports `ErrorsScreen` from `.claude/design-v2/app-screens-a.jsx`, English copy.
- Tab bar (Events/Errors/Traces/LLM/Tenants/Users + counts from VM; Errors active). Tab routes: Events→navigate("overview"), Traces→navigate("traces"), LLM→navigate("llm"), Tenants/Users→navigate("investigate") for now.
- Filter row: severity segmented (all/critical/error/warning) → drives useErrors; status + release filter buttons (functional or affordance); Grouped/Raw segmented (ship Grouped; Raw disabled/stub); window 24h/7d.
- Summary strip via `SummaryStat`+`Divider`: Errors(24h), Open groups, Critical, MTTR "—", Top release; volume `Bars` (critical color).
- Table: header row + rows. Each row: severity stripe, message (mono, truncate) + id tag + sev tag, `StatusPill`, **NO sparkline cell** (omit — column dropped or minimal), `PriorityPill` (null→none), events/users/tenants (tabular, "—" when null), last (faint). Row click → `navigate("incidents")`.
- Loading → skeleton/`EmptyHint`; empty → EmptyHint "No error groups".
- **No-branding test:** if you assert absence of the legacy brand, build the needle from parts (no literal `SignalHub`).

- [ ] Step 1: failing test — feed a VM (mock useErrors or client); assert tab counts + active Errors; severity filter changes + refetch; summary strip (errors/open/critical real, MTTR "—"); volume bars; table rows (no fabricated sparkline; priority pill mapped; null users/tenants → "—"); row click→navigate("incidents"); English-only.
- [ ] Step 2: → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: → PASS.
- [ ] Step 5: commit `feat(console-v2): ErrorsScreen (PER-349)`.

---

### Task 3: registry flip
**Files:** Modify `registry.tsx`; update `registry.test.tsx`.
- [ ] Step 1: test asserts `SCREENS.investigate.kind==="v2"` and `renderSection("investigate", ctx)` renders ErrorsScreen NOT in `.console-legacy-island`.
- [ ] Step 2: → FAIL.
- [ ] Step 3: flip `investigate` → `{ kind:"v2", render: (ctx) => <ErrorsScreen ctx={ctx} navigate={ctx.navigate} /> }`.
- [ ] Step 4: → PASS; full console suite green.
- [ ] Step 5: commit `feat(console-v2): flip investigate registry entry to v2 (PER-349)`.

---

### Task 4: Full S2 verification
- [ ] `pnpm --filter @sigmon/console test` → pass.
- [ ] `pnpm --filter @sigmon/console build` → clean (watch for inline-mock `ApiClient` test files needing the new client method if any was added — none expected here).
- [ ] `pnpm test` repo-wide → green (branding + jsdom configs). Fix any `.test.ts`-needs-jsdom or literal-SignalHub gotcha proactively.
- [ ] Manual `/?v2=1` → Investigate dark with real error groups; filters work; legacy unaffected.

## Notes
- Reuse S1's relative-time formatter if it exists; else add `formatRelative(iso)` (e.g., "8s","32s","1m","2h","3d").
- `ui/v2` barrel: `apps/console/src/components/ui/v2/index.ts`.
