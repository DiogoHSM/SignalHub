# S5 · LLM observability screen (PER-352) — Design

**Status:** Approved-by-source (Claude Design `LlmScreen` + Linear PER-352 scope). Part of the standing autonomous epic "SignalMonitor Console v2 — dark redesign".

**Goal:** Replace the legacy LLM investigation panel with a v2 dark-redesign **LLM observability** screen that consumes the merged B2 aggregation backend (`/query/llm/summary`, `/by-tenant`, `/by-prompt`, `/cost-by-model`).

**Design source:** `.claude/design-v2/app-screens-b.jsx` → `LlmScreen` + `StackedArea` (pulled fresh from DesignSync this cycle; full source captured in the plan).

## Scope (from PER-352)

- Page head: actions row.
- 5 BigKpi: calls, cost (24h + run-rate sub), avg latency, p95 latency, error rate.
- Stacked-area **cost-by-model** chart + legend.
- Top-tenants-by-cost list (share bars, drill→tenant).
- Prompts ranking table (calls, avg tokens, avg/p95 latency, error rate, cost).
- Wire to B2 aggregations + cost-by-model series.

## Architecture

Mirrors the S4 Incidents pattern exactly:

- **`useLlm` hook** (`apps/console/src/v2/screens/useLlm.ts`) — fetches the 4 B2 endpoints in parallel, assembles an `LlmVM`, exposes `{ data, status, reload }` with a race-guard (`genRef`) identical to `useIncidents`.
- **`LlmScreen` component** (`apps/console/src/v2/screens/LlmScreen.tsx`) — `({ ctx }: { ctx: ScreenCtx })`, local `window` state (`Segmented`), renders PageHead + KPI grid + cost-by-model card + top-tenants card + prompts table.
- **`StackedArea` component** (`apps/console/src/components/ui/v2/charts.tsx`) — new SVG stacked-area chart driven by real `{ buckets, series }`.
- **4 client methods** (`apps/console/src/api/client.ts`) + 4 path builders + local response types (`apps/console/src/api/types.ts`).
- **Registry flip** (`apps/console/src/v2/screens/registry.tsx`) — `llm` section `legacy` → `v2`.

### Data flow

```
LlmScreen (window state)
  → useLlm({ client, projectId, environmentId, window })
      → client.getLlmSummary({projectId, environmentId, window})       → LlmSummary
      → client.getLlmByTenant(...)                                     → LlmTenantRow[]
      → client.getLlmByPrompt(...)                                     → LlmPromptRow[]
      → client.getLlmCostByModel(...)                                  → LlmCostByModel
  → LlmVM { kpis, costByModel, tenants, prompts }
```

## Backend contract (B2, already merged — verbatim shapes)

```ts
interface LlmSummary    { calls: number; failedCalls: number; costUsd: string;
                          avgTokens: number|null; avgLatencyMs: number|null; p95LatencyMs: number|null }
interface LlmTenantRow  { tenantId: string; calls: number; failedCalls: number; costUsd: string;
                          avgTokens: number|null; avgLatencyMs: number|null; p95LatencyMs: number|null }
interface LlmPromptRow  { promptName: string; model: string; calls: number; failedCalls: number; costUsd: string;
                          avgTokens: number|null; avgLatencyMs: number|null; p95LatencyMs: number|null }
interface LlmCostByModelSeries { model: string; costs: string[] }   // costs[i] aligns to buckets[i]
interface LlmCostByModel       { buckets: string[]; series: LlmCostByModelSeries[] }
```

- All routes respond `{ data: <T> }`. Filters: `project_id`, `environment_id`, `window` (`24h`|`7d`|`30d`, default `24h`), snake_case query params (mirrors `overviewPath`).
- `costUsd` is a numeric **string**. `failedCalls`, `calls` are numbers. Averages/p95 are `number|null`.
- `getLlmByTenant` excludes null tenants; capped 10; ordered by cost desc. `getLlmByPrompt` capped 20; grouped prompt+model; null prompt → `"Unspecified"`. `getLlmCostByModel` top-5 models; zero-fill `"0"` for empty buckets (vs `"0.000000"` populated) — **parse to number** before charting.
- Backend returns **no tenant display name** (only `tenantId`), **no KPI deltas**, **no per-KPI sparkline series** (calls/latency over time). These degrade (see Decisions).

## Decisions (locked)

1. **Client methods are OPTIONAL on `ApiClient`** (`getLlmSummary?` … `getLlmCostByModel?`), matching the `getOperations?` / `getIncidentMttr?` precedent. The real client object provides them unconditionally; only LLM-touching test mocks add them, minimizing churn across the 23 inline client mocks. `useLlm` degrades gracefully if a method is absent.

2. **Header actions = window `Segmented` (24h/7d/30d) + `Export CSV` stub.** The design's `By prompt` / `By tenant` buttons are dropped: both rankings are always visible on this screen, so the buttons would be no-ops. A real window selector (Overview precedent) is needed to exercise B2's window param and is more useful. `Export CSV` is a `pushToast` stub ("CSV export is not yet available") — backend export is a PER-364 follow-up. Window drives all 4 fetches and is reflected in card titles.

3. **KPI deltas and per-KPI sparklines are omitted** (no backend series for them). `BigKpi.delta`/`spark` are optional → simply not passed. Uniform degrade across all 5 tiles (no mixed treatment). Logged to PER-364.

4. **KPIs computed from `LlmSummary`:**
   - Calls = `calls` (compact-formatted).
   - Cost (window) = `Number(costUsd)` → `$X.XX`; **run-rate sub** = window cost projected to 30 days (`24h→×30`, `7d→/7×30`, `30d→×1`) → `≈ $Y / mo`.
   - Avg latency = `avgLatencyMs` (ms/s format; null → `—`).
   - p95 latency = `p95LatencyMs` (ms/s; null → `—`).
   - Error rate = `failedCalls / calls` as `%` (calls 0 → `0%`). Color `--sev-critical`.
   - Colors per design: calls `--sev-violet`, cost `--accent`, avg `--sev-info`, p95 `--sev-warning`, error `--sev-critical`.

5. **Cost-by-model stacked area** consumes `{ buckets, series }`; costs parsed string→number. Colors assigned from a fixed 5-slot palette `[--sev-violet, --accent, --sev-info, --sev-warning, --sev-critical]` cycled by series index. Legend rendered by the screen from `series` (dynamic models, up to 5). Empty series → `EmptyHint` ("No LLM cost data in this window").

6. **Top tenants list** from `LlmTenantRow[]`:
   - Label = `tenantId` (no display name available; logged to PER-364 to resolve from traits).
   - Cost = `Number(costUsd)` → `$X.XX`; share = `rowCost / Number(summary.costUsd)` (0 if summary cost 0); share bar width = `share×100%`.
   - Sub = `N calls` (compact).
   - **Drill→tenant degraded:** rows are buttons that `pushToast("Tenant detail is not yet available")` until S7 (PER-354) wires the tenant drill target. (Matches S4 stub convention; avoids touching the shell's `DrillTarget` in this screen-scoped task.)
   - Empty → `EmptyHint`.

7. **Prompts ranking table** from `LlmPromptRow[]` (already cost-sorted, cap 20):
   - Columns: `Prompt · model` | Calls | Avg tokens | Avg latency | Error rate | Cost | p95.
   - `promptName` (already `"Unspecified"` when null) + `model` sub.
   - Avg tokens null → `—`; latencies null → `—`; error rate = `failedCalls/calls` %; cost `$X.XX`.
   - Error-rate color thresholds per design: `>1%` critical, `>0.4%` warning, else muted.
   - Header tags: `N prompts` + `sorted by cost`. Rows non-interactive (design has a decorative chevron only).

8. **All copy in English** (CLAUDE.md mandate; design is pt-BR). Card titles: "Cost by model — {window}", "Top tenants — cost", "Prompts — ranked by cost".

9. **Registry:** flip `llm` → `{ kind: "v2", render: (ctx) => <LlmScreen ctx={ctx} /> }`. `traces`/`alerts`/`system`/`settings` stay legacy. `InvestigationWorkspace` import retained (traces still uses it). Update `registry.test`.

10. **Loading/error/guards** identical to S4: no project/env → `EmptyHint`; `status==="loading"` → loading hint; `status==="error"` → error hint. Summary fetch failure → screen `error`; secondary (tenant/prompt/cost-by-model) failures degrade their own section to empty (mirrors `useIncidents` MTTR `.catch`).

## Out of scope → PER-364 follow-ups

- KPI deltas + per-KPI sparklines (need period-over-period + per-bucket calls/latency series).
- Tenant display-name resolution in `by-tenant`.
- CSV export endpoint + wired button.
- `By prompt` / `By tenant` header affordances (scroll-to or filtered views).
- Tenant drill target (lands with S7/PER-354).

## Verification

`pnpm test` (console + repo) green, `pnpm build` green, `pnpm --filter @sigmon/sdk build`, `docker compose config`. No regression to legacy LLM panel removal path (traces still imports `InvestigationWorkspace`).
