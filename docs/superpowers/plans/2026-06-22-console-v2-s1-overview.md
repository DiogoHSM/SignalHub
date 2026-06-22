# Console v2 — S1 Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Port the v2 Overview screen and flip the shell's `overview` registry entry from legacy→v2 (dark, inside `.sh-v2`), wired to existing endpoints.

**Architecture:** A `useOverview` hook composes `getOverview` + `getOperations` + `listEntityTenants`; `OverviewScreen` renders the design's layout via F1 `ui/v2` primitives; `registry.tsx` flips `overview` to `kind:"v2"`. No backend changes.

**Tech Stack:** React 19, TS, Vite, Vitest. Builds on F1 (`ui/v2`) + F2 (shell, registry, `ScreenCtx`).

## Global Constraints

- Package `@sigmon/console`. Branch `feat/console-v2-s1-overview` (off main).
- **English UI copy** (translate the pt-BR design strings). No "SignalHub" (branding contract).
- Fidelity: match `.claude/design-v2/app-screens-a.jsx` `OverviewScreen`+`KpiGroup` layout/sizes/charts; use F1 primitives (`PageHead`, `Segmented`, `Sparkline`, `Bars`, `Card`, `Icon`, `sev`) — never re-roll them.
- Data shapes are the real ones from `apps/console/src/api/types.ts` (`OverviewResponse`, `TenantListResponse`, `OperationsResponse`) — read them; don't invent. Money is decimal strings.
- Window enum is `24h|7d|30d` (no `1h`) — the segmented shows those three.
- Don't fabricate data into charts: if a value/series isn't available, omit the spark/delta rather than invent.
- Tests colocate; follow F2 `v2/` test patterns (mock the client).

## File Structure
```
apps/console/src/v2/screens/
  useOverview.ts        + useOverview.test.ts   # compose 3 calls, merge activity feed
  OverviewScreen.tsx    + OverviewScreen.test.tsx # ported screen (+ KpiGroup colocated)
  registry.tsx          # MODIFY: overview → kind:"v2"
```

---

### Task 1: useOverview hook

**Files:** Create `apps/console/src/v2/screens/useOverview.ts` + `useOverview.test.ts`.

**Interfaces:**
- Read `apps/console/src/api/client.ts` + `api/types.ts` for `getOverview`/`getOperations`/`listEntityTenants` signatures and `OverviewResponse`/`OperationsResponse`/`TenantListResponse`.
- Produce `useOverview({ client, projectId, environmentId, window }): { data: OverviewVM | null; status: "loading"|"ok"|"error"; reload() }` where `OverviewVM` is a view-model the screen consumes: `{ banner, kpis (the 3 groups' values + sparks), topTenants, llmByModel, activity }`.
  - `banner`: from operations — `{ incidents: number, alerts: number, top: { message, severity, path? } | null }` (null → all-clear).
  - `kpis`: from overview.kpis + trends (errors/usage/latency/aiCost sparkline arrays, last 12), errorRate = traces>0 ? errors/traces*100 : null, topModel = top.llmModels[0]?.model.
  - `topTenants`: listEntityTenants.tenants (limit 5, sorted by events desc) → `{ id, name(label), events, costUsd, errors }`.
  - `llmByModel`: overview.top.llmModels → `{ model, costUsd }`.
  - `activity`: merge overview.recent.{errors,failedTraces,failedLlmCalls} into one list sorted by timestamp desc, each `{ kind:"error"|"trace"|"llm", title, sub, timestamp }`.

- [ ] **Step 1:** Write failing test — mock client returning canned overview+operations+tenants; assert the hook maps banner (incident + all-clear), errorRate null when traces=0, activity merged+sorted desc, topTenants sorted by events, llmByModel mapped. Loading→ok transition; error path sets status "error".
- [ ] **Step 2:** Run `pnpm --filter @sigmon/console test -- v2/screens/useOverview` → FAIL.
- [ ] **Step 3:** Implement: fire the three client calls (Promise.all) on mount + when params change; map to `OverviewVM`; cancellation flag on unmount; `reload()` re-fetches.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(console-v2): useOverview hook (PER-348)`.

---

### Task 2: OverviewScreen component

**Files:** Create `apps/console/src/v2/screens/OverviewScreen.tsx` + `OverviewScreen.test.tsx`.

**Interfaces:**
- `OverviewScreen({ ctx, navigate, window?, onWindowChange? })` — `ctx` carries `{ client, project, environment }` (from F2 `ScreenCtx`; read `registry.tsx` for its shape). Manages `window` state (default "24h"), calls `useOverview`.
- Port `OverviewScreen` + `KpiGroup` from `.claude/design-v2/app-screens-a.jsx` to TSX, **English copy**, driven by the VM. Colocate `KpiGroup` here (Overview-specific). Use `PageHead`/`Segmented`/`Sparkline`/`Bars`/`Card`/`Icon` from `ui/v2`.
- Banner: incident variant (severity stripe) vs all-clear; "View incidents"→`navigate("incidents")`, "View rules"→`navigate("alerts")`.
- Top-tenant row click → `navigate("investigate")` (full tenant drill lands with S7). Activity error/incident rows → `navigate("incidents")`; llm→`navigate("llm")`; trace→`navigate("traces")`.
- Loading → skeleton/`EmptyHint`; error → toast via ctx (if available) or inline message.

- [ ] **Step 1:** Write failing test — mock `useOverview` (or the client) to feed a VM; assert: incident banner renders message+counts; all-clear variant when no incidents; 3 KPI groups with mapped values; top-tenant rows (name, cost, err tag) and click→navigate("investigate"); llm-by-model bars; activity rows by kind; window `Segmented` change calls the window setter/refetch.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the screen (verbatim layout, English copy, VM-driven).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(console-v2): OverviewScreen (PER-348)`.

---

### Task 3: registry flip + ctx navigate

**Files:** Modify `apps/console/src/v2/screens/registry.tsx`; if needed `ConsoleShellV2.tsx` (pass `navigate` into ctx); update `registry.test.tsx`.

- [ ] **Step 1:** Update `registry.test.tsx` — assert `SCREENS.overview.kind === "v2"` and `renderSection("overview", ctx)` renders `OverviewScreen` and is **NOT** wrapped in `.console-legacy-island`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Flip `overview` entry to `{ kind: "v2", render: (ctx) => <OverviewScreen ctx={ctx} navigate={ctx.navigate} /> }`. If `ScreenCtx`/ConsoleShellV2 doesn't already expose `navigate`, add it (read F2's `renderSection`/ctx wiring; pass the shell's `navigate`). Ensure `renderSection` renders `v2` entries directly (no island) — confirm the F2 logic already does this.
- [ ] **Step 4:** Run → PASS; then full console suite `pnpm --filter @sigmon/console test` → green (legacy overview still works in legacy shell).
- [ ] **Step 5:** Commit `feat(console-v2): flip overview registry entry to v2 (PER-348)`.

---

### Task 4: Full S1 verification

- [ ] **Step 1:** `pnpm --filter @sigmon/console test` → pass.
- [ ] **Step 2:** `pnpm --filter @sigmon/console lint && pnpm --filter @sigmon/console build` → clean.
- [ ] **Step 3:** `pnpm test` repo-wide → green (branding contract incl.; no pt-BR user strings, no "SignalHub").
- [ ] **Step 4:** Manual: `/?v2=1` → Overview dark with real data; window switch refetches; other sections still legacy. Don't commit scratch.

## Notes
- `ui/v2` barrel: `apps/console/src/components/ui/v2/index.ts`.
- Read `OverviewResponse`/`TenantListResponse`/`OperationsResponse` in `api/types.ts` before mapping — exact field names matter (e.g. `kpis.p95TraceDurationMs`, `top.llmModels[].totalCostUsd`, `tenants[].llmCostUsd`).
- The per-row tenant bars in the design are decorative; render from real data if available, else omit (don't fabricate).
