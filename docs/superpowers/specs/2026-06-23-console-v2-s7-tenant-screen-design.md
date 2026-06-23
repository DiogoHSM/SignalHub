# S7 · Tenant detail screen (PER-354) — Design

**Status:** Approved-by-source (Claude Design `TenantScreen` + Linear PER-354 scope). Part of the standing autonomous epic "SignalMonitor Console v2 — dark redesign".

**Goal:** Add a v2 dark-redesign **Tenant detail** screen, reachable as a shell **drill target**, that consumes the already-merged entity backend (`GET /query/entities/tenants/:id` → `getEntityTenantDetail`). Wiring this screen also activates the tenant drill that S5 (LLM top-tenants) stubbed.

**Design source:** `.claude/design-v2/app-screens-b.jsx` → `TenantScreen` (pulled fresh from DesignSync this cycle; full source captured in the plan).

## Scope (from PER-354)

Tenant header (avatar, id, active tag, plan/onboarded, Open in CRM, Watch tenant); 6 BigKpi (active users, events, LLM cost, errors, p95, sessions); unified timeline (events/errors/llm/traces, color-coded, drill); top users list (avatar, role, events, cost); features-used bars. Wire to `/query/entities/tenants/:id`.

## Architecture

Mirrors the S4/S5/S6 screen pattern, but the Tenant screen is a **drill target** (it needs a `tenantId` supplied from elsewhere), so it follows the **`IncidentScreen` precedent**, not a nav-section flip.

- **`useTenant` hook** (`apps/console/src/v2/screens/useTenant.ts`) — fetches `getEntityTenantDetail(tenantId, { projectId, environmentId, window })`, exposes `{ data, status, reload }` with the `genRef` race-guard identical to `useLlm`/`useIncidents`/`useTraces`. `data` is the raw `TenantDetailResponse`.
- **Pure `buildTenantVM(response): TenantDetailVM`** (same file, exported) — transforms the response into a render-ready VM (header fields, KPI values, per-row timeline display attrs, top-user rows, signal-mix bars). Pure → unit-tested directly, mirrors S6's `buildTraceDetail`.
- **`TenantScreen` component** (`apps/console/src/v2/screens/TenantScreen.tsx`) — `({ ctx, tenantId }: { ctx: ScreenCtx; tenantId: string })`, local `window` state (`Segmented` 24h/7d/30d), renders header + 6 KPI grid + unified timeline + top users + activity-by-type bars.
- **Shell drill wiring** (`apps/console/src/v2/screens/registry.tsx` types + `apps/console/src/v2/ConsoleShellV2.tsx`) — extend `DrillTarget` to `"incident" | "tenant"`, make `DrillParams` a discriminated union, extend the `detail` state union, and route `detail.target === "tenant"` to `TenantScreen`.
- **Activate the S5 stub** (`apps/console/src/v2/screens/LlmScreen.tsx`) — top-tenants rows call `ctx.drill("tenant", { tenantId })` instead of the `pushToast` stub.
- **New formatter** (`apps/console/src/components/ui/v2/format.ts`) — `formatClockUtc(iso): string` → `"HH:MM:SS"` UTC for timeline rows.

### Data flow

```
ConsoleShellV2 (detail.target==="tenant" → TenantScreen tenantId=detail.tenantId)
  TenantScreen (window state)
    → useTenant({ client, projectId, environmentId, tenantId, window })
        → client.getEntityTenantDetail(tenantId, {projectId, environmentId, window}) → TenantDetailResponse
    → buildTenantVM(response) → TenantDetailVM { header, kpis, timeline[], topUsers[], signalBars[] }
```

## Backend contract (entity backend, already merged — verbatim shapes)

```ts
type EntityWindow = "24h" | "7d" | "30d";
type EntitySignalType = "event" | "error" | "trace" | "llm";

type TenantSummary = {
  tenantId: string | null; label: string; traits: Record<string, unknown>;
  keyTraits: Record<string, string>; isUnassigned: boolean; impactScore: number;
  lastSeenAt: string | null;
  events: number; errors: number; openErrors: number; severeErrors: number;
  traces: number; failedTraces: number; llmCalls: number; failedLlmCalls: number;
  llmCostUsd: string; activeUsers: number; activeSessions: number;
};
type TenantTopUser = { userId: string; events: number; errors: number; traces: number;
  llmCalls: number; llmCostUsd: string; lastSeenAt: string };
type TenantTimelineRow =
  | { type:"event"; id; timestamp; label; userId; sessionId; traceId; eventName }
  | { type:"error"; id; timestamp; label; userId; sessionId; traceId; severity; status; message }
  | { type:"trace"; id; timestamp; label; userId; sessionId; traceId; status; durationMs:number|null; name }
  | { type:"llm";   id; timestamp; label; userId; sessionId; traceId; provider; model; promptName:string|null; status; costUsd };
type TenantDetailResponse = { window; generatedAt; scope; range; tenant: TenantSummary;
  topUsers: TenantTopUser[]; timeline: TenantTimelineRow[]; cursor?: string };
type TenantDetailQuery = { projectId; environmentId; window; userId?; signalType?; limit?; cursor? };
```

- `getEntityTenantDetail(tenantId, query)` is **required** on `ApiClient` (not optional). Response is wrapped `{ data: TenantDetailResponse }`.
- `costUsd`/`llmCostUsd` are numeric **strings** → `Number(...)` before formatting.
- **Backend does NOT provide:** per-tenant p95 latency; a per-tenant features-used breakdown; an `errorGroupId`/`groupId` on timeline error rows; a display name or role on `topUsers` (only `userId`); an `onboarded`/`first_seen_at` field in the response. These degrade (see Decisions) and are logged to PER-364.

## Decisions (locked)

1. **Tenant is a shell DRILL TARGET, not a nav section.** This matches the `v2-drill-navigation` model and the `IncidentScreen` precedent (a `tenantId` must arrive from a drilling screen). Changes:
   - `registry.tsx`: `export type DrillTarget = "incident" | "tenant";` and a discriminated `DrillParams = { groupId: string; errorId?: string } | { tenantId: string };`.
   - `ConsoleShellV2.tsx`: detail state union `{ target:"incident"; groupId; errorId? } | { target:"tenant"; tenantId } | null`; `handleDrill` narrows on `target` to build the correct detail object; the render ternary becomes `detail.target === "tenant" ? <TenantScreen ctx tenantId={detail.tenantId}/> : <IncidentScreen .../>`. `navigate(section)` still clears `detail` (unchanged). No `ScreenCtx` change (`drill`/`back` are already generic).
   - `TenantScreen({ ctx, tenantId })` mirrors `IncidentScreen({ ctx, groupId, errorId })`: reads `projectId`/`environmentId` off `ctx`, drives `useTenant`, exposes a back button via `ctx.back()`.

2. **`LlmScreen` top-tenants rows are wired** to `ctx.drill("tenant", { tenantId: row.tenantId })`, replacing the S5 `pushToast("Tenant detail is not yet available")` stub. (Traces had no tenant stub; nothing to change there.)

3. **Single window selector** (`Segmented` 24h/7d/30d, default `24h`) in the page-head actions, driving the one `getEntityTenantDetail` window. The design's mixed per-tile windows ("(7d)"/"(24h)") are dropped — one window governs the whole detail call, like S5. Card/section copy reflects the selected window where the design shows one.

4. **6 KPI tiles** computed from `TenantSummary`, in design order, **deltas/sparks omitted** (no period-over-period or per-bucket series — uniform degrade, like S5):
   - 1 Active users = `activeUsers` (`formatCompact`).
   - 2 Events = `events` (`formatCompact`).
   - 3 LLM cost = `formatUsd(Number(llmCostUsd))`, color `--sev-violet`.
   - 4 Errors = `errors` (`formatCompact`), color `--sev-critical`.
   - 5 **Traces** = `traces` (`formatCompact`), color `--sev-warning` — **substitutes the design's "p95 latency"**, which has no per-tenant backend value (logged to PER-364). Keeps the 6-tile layout with a real metric rather than an empty "—" tile.
   - 6 Sessions = `activeSessions` (`formatCompact`).
   - Labels are plain (no per-tile window suffix); the window lives in the page head.

5. **Tenant header** (verbatim avatar gradient + layout from design):
   - Avatar = first two chars of `tenant.label` (fallback `tenantId`), uppercased, on the design's `linear-gradient(135deg, oklch(0.66 0.14 290), oklch(0.58 0.16 230))`.
   - `sh-h1` = `tenant.label`. `sh-tag mono` = `tenant.tenantId ?? "—"`.
   - Status tag = `keyTraits.status` if present, else `lastSeenAt != null ? "active" : "inactive"` (accent dot for active).
   - Meta line = `plan: {keyTraits.plan ?? "—"}` · `last seen {relativeTime(lastSeenAt)}` (substitutes the design's "onboarded {date}", which the response doesn't carry — logged to PER-364).
   - Actions: **"Open in CRM"** → `pushToast("CRM integration is not yet available")` stub; **"Watch tenant"** → `pushToast("Watching {label}")` (matches the design toast). Both are honest stubs (no backend persistence; logged to PER-364). A back button (`ctx.back()`) is added to the header, mirroring `IncidentScreen`.

6. **Unified timeline** from `timeline: TenantTimelineRow[]` (first page only — `getEntityTenantDetail` default `limit`; cursor pagination is a PER-364 follow-up). Each row maps via `buildTenantVM` to `{ clock, icon, tone, title, sub, tag?, navTo? }`:
   - `event` → icon `activity`, tone neutral/ok; title `eventName`; sub `userId · sessionId` (nullable parts omitted); non-interactive.
   - `error` → icon `error`, tone = `/critical|fatal|error/i.test(severity) ? "critical" : "warning"`; title `message`; sub `userId`; tag `severity`. **Non-interactive** — no `groupId` to drill to a specific incident (logged to PER-364).
   - `trace` → icon `waterfall`, tone `info`; title `name`; sub `formatLatency(durationMs) · userId`; **`navTo:"traces"`** (section nav, matches design `nav("traces")`).
   - `llm` → icon `sparkles`, tone `violet`; title `promptName ?? model`; sub `provider/model · formatUsd(Number(costUsd))`; **`navTo:"llm"`**.
   - Time column = `formatClockUtc(timestamp)` (`"HH:MM:SS"`). Header legend tags (events/errors/llm/traces) are display-only (signalType filtering is a PER-364 follow-up). Empty timeline → `EmptyHint`.

7. **Top users** from `topUsers: TenantTopUser[]`:
   - Avatar initials from `userId`; primary label = `userId` (no display name available → logged to PER-364), sub = `last seen {relativeTime(lastSeenAt)}`.
   - Columns: events (`formatCompact`) + cost (`formatUsd(Number(llmCostUsd))`, violet). The design's **role tag is dropped** (no role on `TenantTopUser`; logged to PER-364).
   - Empty → `EmptyHint`.

8. **"Features used" bars → reinterpreted as "Activity by type"** (NOTABLE DIVERGENCE, see below). No per-tenant feature breakdown exists in the backend. To preserve the 4-bar visual with **real** data, render four bars from `TenantSummary` signal counts: Events (`--accent`), LLM calls (`--sev-violet`), Traces (`--sev-info`), Errors (`--sev-critical`); bar width = `count / max(counts, 1)`. Card title "Activity by type". Authoritative per-feature usage is logged to PER-364.

9. **All copy in English** (CLAUDE.md mandate; design is pt-BR). Card titles: "Unified timeline", "Top users", "Activity by type". Page head: title "Tenant", sub describes the project/env scope.

10. **Loading/error/guards** identical to S4–S6: no project/env → `EmptyHint`; missing `tenantId` (defensive) → `EmptyHint`; `status==="loading"` → loading hint; `status==="error"` → error hint. The single detail fetch failing sets screen `error` (no partial-section degrade — it's one call).

## Notable divergence (flagged)

The design's **"Features mais usadas"** card implies a per-tenant, per-named-feature usage ranking. The backend exposes no such aggregation per tenant. Rather than ship an empty card (poor fidelity for a redesign that prizes aesthetics) or invent client-side guesses, S7 renders an honest **"Activity by type"** bar card from the real signal-type counts already in `TenantSummary`. This preserves the visual weight and uses real data; the authoritative feature-usage breakdown is deferred to a backend follow-up (PER-364). Recorded here as the one divergence from a literal design transcription.

## Out of scope → PER-364 follow-ups

- Per-tenant p95 latency KPI (no backend value).
- Authoritative per-tenant features-used breakdown (drives the "Activity by type" placeholder).
- Timeline cursor pagination / "Load more" and signalType filtering.
- Timeline error row → specific incident drill (needs `errorGroupId` on the row).
- Top-users display name + role resolution from `user_profiles` traits.
- Tenant "onboarded" date + "active" status from authoritative profile fields.
- "Open in CRM" + persisted "Watch tenant".

## Verification

`pnpm test` (console + repo) green, `pnpm build` green, `pnpm --filter @sigmon/sdk build`, `docker compose config`. No regression to the incident drill path (the shell render switch must still route `"incident"` to `IncidentScreen` unchanged) and no regression to legacy sections. New DOM `*.test.ts(x)` files MUST carry `// @vitest-environment jsdom` as line 1.
