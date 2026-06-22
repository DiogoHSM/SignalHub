# S1 · Console v2 — Overview screen

**Epic:** SignalMonitor Console v2 — dark redesign
**Issue:** PER-348
**Date:** 2026-06-22
**Status:** Draft for review
**Depends on:** F1 (primitives), F2 (shell + registry). Branch off `main` (foundation merged).

## Goal

Port the v2 **Overview** screen and flip the shell's `overview` registry entry from the legacy dashboard (light, in the island) to a real v2 screen (dark, inside `.sh-v2`). It's the first screen migration — proves the registry `legacy → v2` flip end-to-end.

Design source: `.claude/design-v2/app-screens-a.jsx` → `OverviewScreen` + `KpiGroup`. Match layout, sizes, charts, spacing exactly; **English copy** (the saved source is pt-BR — translate strings, e.g. "Pulso de …" → "Pulse of …", "Erros (24h)" → "Errors (24h)", "Custo de IA" → "AI cost", "Top tenants — atividade" → "Top tenants — activity", "Atividade recente" → "Recent activity", "Nenhum incidente ativo" → "No active incidents", "Ver incidentes" → "View incidents", "Ver regras" → "View rules", "vs. ontem" → "vs. yesterday").

## Data wiring (all backed today — see the S1 endpoint map)

A `useOverview(project, env, window)` hook composes existing client methods (no new backend):

- **`getOverview({ project_id, environment_id, window })`** → `kpis`, `trends`, `top`, `recent`. Powers the KPI groups, sparklines, LLM-cost-by-model bars, and the activity feed.
- **`getOperations({...})`** → incidents/alerts summary + `recent.incidents[0]` for the **health banner** (active incidents count, 30-min alerts, top-incident code/path). Mirrors how the Health Rail derives status.
- **`listEntityTenants({..., limit: 5})`** → **Top tenants** table (rank by `events` to match the design's "ranked by events"; show `llmCostUsd` + `errors`).

### Field map (design → response)

- **Health banner:** `getOperations` → `summary.incidents.{open,investigating}`, `summary.alerts.events.total`, `recent.incidents[0].{message, severity}` (+ path if present). All-clear variant when no open incidents.
- **KPI group "Health":** Errors(24h)=`kpis.errors`; Open incidents=`incidents` (from operations); Error rate=`(kpis.errors/kpis.traces)*100` (null-safe). Error sparkline=`trends.errors[].errors` (last 12).
- **KPI group "Usage":** Events=`kpis.events` (spark `trends.usage[].events`); Active users=`kpis.activeUsers`; Active tenants=`kpis.activeTenants`; Traces=`kpis.traces`; p95 trace=`kpis.p95TraceDurationMs` (spark `trends.latency[].p95TraceDurationMs`); Avg trace=`kpis.averageTraceDurationMs`.
- **KPI group "AI cost":** LLM calls=`kpis.llmCalls` (spark `trends.aiCost[].llmCalls`); Cost today=`kpis.llmCostUsd`; Tokens=`kpis.llmInputTokens+llmOutputTokens`; Top model=`top.llmModels[0].model`.
- **Deltas** (design shows "+8% vs yesterday" etc.): derive from `trends` (first vs last bucket) where meaningful; **omit the delta line when not derivable** rather than fabricate. (Per-KPI vs-prior deltas are not a first-class API field; this is acceptable — note as a possible future enhancement.)
- **Top tenants table:** `listEntityTenants.tenants[]` → `label` (name), `tenantId`, `events`, `llmCostUsd`, `errors`. The little per-row bars in the design are decorative; render a small `Bars` from the tenant's recent usage if available, else a flat/omitted spark (decorative only — don't fake data into a real chart; prefer omitting over fabricating).
- **LLM cost by model:** `top.llmModels[]` → `model`, `totalCostUsd`; bar width = cost / max(cost).
- **Recent activity feed:** merge `recent.errors`, `recent.failedTraces`, `recent.failedLlmCalls`, sort by `timestamp` desc, label by type (error/trace/llm) with the design's icons/colors. **Known limitation:** `overview.recent` is **failures-only** (no success events like the design's `dashboard.created`/`checkout.completed`). Ship the feed from available (failure) signals; **file a follow-up** for a unified mixed activity endpoint. The "live" pulse dot is cosmetic.

## Behavior

- **Time window:** the `Segmented` (1h/24h/7d/30d) drives the `window` param. Note: the backend `window` enum is `24h|7d|30d` (no `1h`). Either drop `1h` from the control or map it to `24h` — **drop `1h`** to match the API (the segmented shows 24h/7d/30d). Flag if exact design fidelity (keep 1h) is required.
- **Drill actions:** the design drills to tenant (S7) and incident (S3), which aren't built yet. For S1, wire: tenant row → navigate to `investigate` (tenants context) or no-op with a "coming with S7" affordance; recent-error/incident → navigate to `incidents`. Full drill-to-detail lands when S3/S7 ship. Use the shell's existing `navigate`; don't build S3/S7 here.
- **Loading/empty/error:** skeleton or `EmptyHint` while loading; graceful empty states (no tenants, no incidents → all-clear banner). Errors surface a toast + retain last data.
- **Export button:** present per design; wire to a CSV export of the overview KPIs if trivial, else a toast stub (note follow-up). Don't block.

## Registry flip

`src/v2/screens/registry.tsx`: change the `overview` entry from `{ kind: "legacy", … }` to `{ kind: "v2", render: (ctx) => <OverviewScreen project={ctx.project} environment={ctx.environment} navigate={…} /> }`. The v2 screen renders WITHOUT the `.console-legacy-island` (dark). Verify `renderSection("overview")` no longer wraps in the island (a `v2` entry renders directly).

## Module layout

```
apps/console/src/v2/screens/
  OverviewScreen.tsx        # the screen (uses F1 ui/v2 primitives + KpiGroup)
  OverviewScreen.test.tsx
  useOverview.ts            # composes getOverview + getOperations + listEntityTenants
  useOverview.test.ts
  registry.tsx              # MODIFY: overview → kind:"v2"
```

`KpiGroup` (from the design, in app-screens-a.jsx) is Overview-specific → colocate in `OverviewScreen.tsx` (or a small `kpi-group.tsx`), not the shared `ui/v2` (YAGNI until a second screen needs it).

## Testing

- **useOverview** — composes the three calls with the right params; merges + sorts the activity feed by timestamp desc; null-safe error-rate; handles empty tenants/incidents; surfaces error state.
- **OverviewScreen** — renders the health banner (incident variant vs all-clear) from props; renders 3 KPI groups with values; renders top-tenants rows (rank by events) with cost + error tag; LLM-cost-by-model bars; activity feed rows by type; window segmented changes trigger refetch; tenant/incident drill calls `navigate`.
- **registry** — `overview` is `kind:"v2"` and `renderSection("overview")` renders `OverviewScreen` **not** inside `.console-legacy-island`.
- No regression: full suite green; legacy Overview dashboard still reachable in the legacy shell.

## Verification

```sh
pnpm --filter @sigmon/console test
pnpm --filter @sigmon/console build
pnpm test    # repo-wide incl. branding contract (English copy — no "SignalHub", no pt-BR user strings)
```
Manual: `/?v2=1` → Overview renders dark with real data; window switch works; legacy screens unaffected.

## Out of scope / follow-ups (file as issues)

- Unified mixed (success+failure) **recent-activity** endpoint — S1 ships failures-only.
- Per-KPI vs-prior **deltas** as a first-class API field.
- Overview **CSV export** (if not trivially wired).
- Full **drill-to-detail** to tenant (S7) / incident (S3) — wired when those screens land.
