# S6 · Traces screen (collapsible waterfall tree) (PER-353) — Design

**Status:** Approved-by-source (Claude Design `TracesScreen` + Linear PER-353 scope). Part of the standing autonomous epic "SignalMonitor Console v2 — dark redesign".

**Goal:** Replace the legacy traces investigation island with a v2 dark-redesign **Traces** screen: a recent-traces index that opens a faithful single-trace view — trace header, summary strip, collapsible waterfall tree, and span detail — consuming the existing `/query/traces` + `/query/traces/:id/spans` routes.

**Design source:** `app-screens-b.jsx` → `TracesScreen` (pulled fresh from DesignSync this cycle; full source captured in the plan).

## Scope (from PER-353)

- Trace header: has-error tag, trace/user/tenant ids, started timestamp, root name.
- Summary strip: duration, spans, LLM cost/time, DB time, errors, kind legend.
- **Collapsible waterfall**: span tree with indent, expand/collapse, kind color, ERR badge, duration, timeline bar with gridlines; All/Slow/Errors filter.
- Span detail panel: name, started/duration/service/kind/status/cost, error block, attributes JSON, open-incident + copy-id.
- Wire to `/query/traces/:id/spans`.

## Backend contract (already merged — verbatim, no backend work in S6)

Both client methods already exist and are **required** (not optional) on `ApiClient`, so all existing inline mocks already provide them — no mock churn (unlike S5).

```ts
// apps/console/src/api/client.ts
listTraces:     (filters: QueryFilters) => Promise<QueryListResponse<TraceRecord>>;            // GET /query/traces
listTraceSpans: (traceId: string, filters: QueryFilters) => Promise<QueryListResponse<SpanRecord>>; // GET /query/traces/:id/spans

// apps/console/src/api/types.ts (verbatim)
type TraceRecord = { id; projectId; environmentId; tenantId: string|null; userId: string|null;
  sessionId: string|null; traceId: string|null; timestamp: string; receivedAt: string;
  source: string|null; release: string|null; metadata: unknown; name: string; status: string;
  startedAt: string; endedAt: string|null; durationMs: number|null };
type SpanRecord = { ...same scope fields...; traceId: string; parentSpanId: string|null;
  name: string; status: string; startedAt: string; endedAt: string|null; durationMs: number|null;
  input: unknown|null; output: unknown|null; error: unknown|null; costUsd: string|null };
type QueryListResponse<T> = { data: T[]; cursor?: string };
type QueryFilters = { projectId; environmentId; tenantId?; userId?; sessionId?; traceId?;
  from?: Date|string; to?: Date|string; limit?: number; cursor?: string; /* + others */ };
```

- `/query/traces` orders by `timestamp desc`, `limit` default 50 / max 500.
- `/query/traces/:id/spans` enforces `traceId` from the path; spans are returned ordered `timestamp desc` (NOT structurally ordered — the screen builds the tree).
- **No `kind` field. No `service` field** (closest is `source`). **No span `start` offset** (only absolute `startedAt`). **No `level` / tree depth** (only `parentSpanId`). All four design fields are derived client-side (see Decisions).

## Architecture (mirrors the S4/S5 hook + screen pattern)

- **`useTraces` hook** (`apps/console/src/v2/screens/useTraces.ts`) — fetches `listTraces` (recent index, `limit: 25`), maps to `TraceListItemVM[]`, race-guarded by `genRef` exactly like `useIncidents`/`useLlm`. Returns `{ data: TraceListItemVM[] | null, status, reload }`.
- **`useTraceSpans` hook** (`apps/console/src/v2/screens/useTraceSpans.ts`) — given a selected `traceId`, fetches `listTraceSpans`, builds the **span tree + summary VM** (`TraceDetailVM`). Race-guarded. No fetch when `traceId` is `undefined`. Returns `{ data: TraceDetailVM | null, status, reload }`.
- **`TracesScreen` component** (`apps/console/src/v2/screens/TracesScreen.tsx`) — `({ ctx }: { ctx: ScreenCtx })`. Holds `selectedTraceId` + waterfall view state (collapsed set, selected span id, filter). Renders **master-detail in-screen**: list (index) ⇄ detail (waterfall).
- **Formatter** (`apps/console/src/components/ui/v2/format.ts`) — add `formatUtcTimestamp(iso)`.
- **Registry flip** (`apps/console/src/v2/screens/registry.tsx`) — `traces` `legacy` → `v2`; remove the now-unused `InvestigationWorkspace` import from registry (the component itself stays — `ConsoleShell.tsx` still uses it).

No new shell `DrillTarget`, no `ConsoleShellV2` change.

### Data flow

```
TracesScreen
  selectedTraceId = undefined        → list view
    useTraces({client, projectId, environmentId})        → TraceListItemVM[]   (limit 25, recent)
  selectedTraceId = "<id>"           → detail view
    useTraceSpans({client, projectId, environmentId, traceId}) → TraceDetailVM
      { header, summary, spans: SpanNodeVM[] (flat, ordered, with level/hasChildren/offsetMs/durMs/kind), spansById }
```

## Decisions (locked)

1. **Master-detail in-screen, list-first.** The Traces section lands on a **recent-traces index** (consistent with sibling v2 sections — Incidents lands on a list, not a pre-drilled item; the design mock necessarily shows a single trace because a static mock can't model selection). Clicking a trace sets `selectedTraceId` and shows the design's faithful single-trace view; a back affordance ("← Recent traces") clears it. Selection is **in-screen React state, NOT a shell drill** — no `ConsoleShellV2`/`DrillTarget` changes (matches the S5 precedent of keeping drills screen-scoped). The trace-detail view is the design ported verbatim.

2. **Recent-traces index** from `TraceListItemVM[]` (`listTraces`, `limit: 25`):
   - Row = button → `setSelectedTraceId(trace.id)`.
   - Shows: error/status tag (errored → `sh-tag critical "● Has error"`, else `sh-tag ok` with `status`), root name (`name`, mono), trace id (`traceId ?? id`, mono), `tenantId`/`userId` (each `—` when null), duration (`formatLatency(durationMs)`), started (`relativeTime(startedAt)`).
   - Header: `PageHead title="Traces"`, sub = `<>Recent traces for <strong>{project.name} · {env}</strong> — {n} shown.</>`. Actions: `History` + `Filters` (both `pushToast` stubs → "Trace history is not yet available" / "Trace filters are not yet available"; design's two header buttons preserved as stubs, mirroring S4/S5). English copy.
   - Empty list → `EmptyHint icon="waterfall" title="No traces in this project" sub="…"`.

3. **Span tree construction** (`useTraceSpans`, the algorithm-critical piece):
   - `byId = Map(span.id → span)`. `children = Map(parentSpanId → SpanRecord[])`, each child list sorted by `startedAt` asc (tie-break: `id` asc) for stable waterfall order.
   - **Roots** = spans whose `parentSpanId` is `null` OR whose parent id is not present in `byId` (orphans treated as roots). Roots sorted by `startedAt` asc.
   - **DFS** from each root, assigning `level` (root = 0, child = parent.level + 1), producing a **flat ordered list** `SpanNodeVM[]` with `{ span, level, hasChildren }`. `hasChildren` = the span has ≥1 child in `children`.
   - **Cycle guard:** a `visited: Set<id>`; if a span id is already visited, skip it (prevents infinite recursion on malformed `parentSpanId` cycles).
   - **Timing:** `traceStart = min(parseTime(startedAt))` across all spans. `traceEnd = max(parseTime(endedAt ?? startedAt))`. `totalMs = max(traceEnd - traceStart, 1)` (guard ≤0 → 1). Per span: `offsetMs = parseTime(startedAt) - traceStart` (clamp ≥0); `durMs = durationMs ?? (endedAt ? parseTime(endedAt) - parseTime(startedAt) : 0)` (clamp ≥0). `parseTime` = `new Date(iso).getTime()`; if `NaN`, treat that span's time as `traceStart` (offset 0).

4. **Kind derivation** (`kind` is NOT a backend field; derived client-side, display-only, no truth claim). `classifyKind(span): "llm"|"db"|"cache"|"http"|"internal"`:
   - `costUsd != null` → `"llm"` (strongest signal: priced spans are LLM calls).
   - else lowercase `` `${source ?? ""} ${name ?? ""}` `` and match in order:
     - `/\b(llm|gpt|claude|haiku|gemini|openai|anthropic|embed|completion)\b/` → `"llm"`
     - `/\b(postgres|mysql|sqlite|sql|query|database|prisma|kysely|db)\b/` → `"db"`
     - `/\b(redis|cache|memcache|memcached)\b/` → `"cache"`
     - `/(https?:|\bget\b|\bpost\b|\bput\b|\bdelete\b|\bpatch\b|\/api\/|fetch|request)/` → `"http"`
   - else → `"internal"`.
   - `kindColor = { http: var(--accent), db: var(--sev-info), llm: var(--sev-violet), cache: var(--sev-warning), internal: var(--fg-muted) }` (verbatim from design).
   - Richer/authoritative kind+service from span attributes is a **PER-364 follow-up**.

5. **Error detection** (`status` value set is not contractually fixed). A span is errored iff `span.error != null` **OR** `/error|fail/i.test(span.status)`. Trace-level "has error" = any span errored OR `/error|fail/i.test(trace.status)`. The waterfall bar uses `var(--sev-critical)` for errored spans (overrides kind color); errored rows show an `ERR` tag.

6. **Summary strip** (`TraceDetailVM.summary`, derived from spans):
   - Duration = `formatLatency(totalMs)`.
   - Spans = span count.
   - LLM cost = `formatUsd(sum(Number(costUsd) for spans with costUsd != null))` (non-finite → skip).
   - LLM time = `formatLatency(sum(durMs for kind==="llm"))`.
   - DB time = `formatLatency(sum(durMs for kind==="db"))`.
   - Errors = errored-span count; `SummaryStat tone={errors > 0 ? "danger" : undefined}`.
   - Kind legend: `Object.entries(kindColor).map(([k,c]) => <Legend color={c} label={k}/>)` (all five kinds, verbatim from design).

7. **Trace header** (detail view top):
   - Tags row: `← Recent traces` back button; has-error → `sh-tag warn "● Has error"` (design uses `warn`); `sh-tag mono` trace id (`traceId ?? id`); `sh-tag mono` `{userId ?? "—"} · {tenantId ?? "—"}`; faint `started {formatUtcTimestamp(startedAt)}`.
   - `<h1>` mono = root span name (`spans[0].name` of the tree) — fallback to `trace.name` when spans empty.
   - Sub `<p>`: `{n} spans · {formatLatency(totalMs)} total · {errors} error(s)` (English; pluralize "error"/"errors").

8. **Waterfall** (left card, `1.7fr`):
   - Head: `Waterfall` + `Expand all` ghost button (clears collapsed set) + `Segmented options={["All","Slow","Errors"]}` (functional, wired via `onChange`).
   - Column header grid `280px 60px 1fr`: `Span` | `Dur` | timeline ruler labels `0 / 500 / 1000 / 1500 / 2000 / {totalMs}ms` (design shows fixed labels; render `0` and `{round(totalMs)}ms` at the ends with three evenly-spaced interior ticks computed from `totalMs` — not hardcoded 500/1000/… since `totalMs` varies).
   - **Filtering:**
     - `All` → full collapsible tree (respecting the collapsed set; a collapsed span hides its descendants, shows a `+` tag).
     - `Errors` → **flat** list of errored spans only (no collapse, indentation preserved for readability).
     - `Slow` → **flat** list of spans with `durMs >= 0.05 * totalMs` (≥5% of trace duration), sorted by `durMs` desc.
   - Rows (`span-row`, `is-active` when `span.id === selectedSpanId`, `cursor: pointer`, click → `setSelectedSpanId`): indent `paddingLeft: level*16`; chevron toggle (`chevd`, rotates `-90deg` when collapsed) when `hasChildren` else a faint `·`; kind color dot; span name (mono, ellipsis); `+` tag when collapsed; `ERR` tag when errored; `{durMs}ms`; timeline track (`var(--bg-canvas)`) with 4 interior gridlines at 20/40/60/80% and a positioned bar `left: offsetMs/totalMs*100%`, `width: max(durMs/totalMs*100%, 0.4%)`, colored `var(--sev-critical)` if errored else `kindColor[kind]`.
   - Collapse/expand + selected span are **screen state**; default collapsed = empty set (all expanded); default selected span = first errored span if any, else the root (`spans[0]`).
   - Empty spans (trace has zero spans) → `EmptyHint icon="waterfall" title="No spans for this trace"` inside the card; span-detail card hidden/guarded.

9. **Span detail** (right card, `1fr`):
   - Head: `Span detail` + tag (`sh-tag critical "error"` when errored, else `sh-tag ok` with `kind`).
   - `Name` eyebrow + mono name.
   - 2-col `Kv` grid: `Started` = `+{offsetMs} ms`; `Duration` = `{durMs} ms`; `Service` = `source ?? "—"`; `Kind` = derived kind; `Status` = `status` (`tone="danger"` when errored); `Cost` = `costUsd != null ? formatUsd(Number(costUsd)) : "—"`.
   - **Error block** (only when errored): `sh-eyebrow "Error"` + `sh-code` rendering `stringifyUnknown(span.error)` (string as-is; object → `JSON.stringify(…, null, 2)`; bounded to ~2000 chars, truncate with `…`). Plain text (no token-class syntax highlighting — that was decorative in the mock; real error content is rendered safely as text).
   - **Attributes block:** `sh-eyebrow "Attributes"` + `sh-code` (`maxHeight: 130, overflow:auto`) rendering a **derived** attributes object as pretty JSON: `{ service: source ?? null, kind, status, duration_ms: durMs, started_ms: offsetMs, cost_usd: costUsd ?? null }`, plus `metadata` only when it is a non-null object (stringified, bounded). **Do NOT render `span.input` / `span.output`** (avoids dumping potentially large/sensitive prompt/response payloads — the mock's Attributes block also showed only metadata-style fields).
   - Buttons: `Open incident` (primary) → **`pushToast("Linking spans to incidents is not yet available")`** stub — NOT `ctx.drill("incident", …)`, because a span carries no `errorGroupId` (the design drilled with `null`; we degrade to a stub, mirroring S5's tenant-drill stub; logged to PER-364). `Copy ID` → best-effort `navigator.clipboard?.writeText(traceId ?? id)` then `pushToast("Trace ID copied")`.

10. **Loading / error / guards** identical to S4/S5:
    - No project/env → `EmptyHint icon="waterfall" title="No project selected"`.
    - List `status==="loading"` (no data) → loading hint; list `status==="error"` → `EmptyHint icon="alert" title="Could not load traces"`.
    - In detail view: span fetch `loading` → loading hint inside the detail; span fetch `error` → `EmptyHint icon="alert" title="Could not load spans"` (back button still available).
    - `useTraces`/`useTraceSpans` failures set `status:"error"` (console-logged), do not throw.

11. **All copy in English** (CLAUDE.md mandate; design is pt-BR). "Traces", "Recent traces", "Has error", "Waterfall", "Expand all", "Span", "Dur", "Span detail", "Open incident", "Copy ID", "History", "Filters", etc.

## Out of scope → PER-364 follow-ups

- Authoritative span `kind` + `service` from span attributes (S6 uses a display heuristic).
- Trace list filtering, history, pagination/cursor, and time-window selector (S6 shows recent 25).
- Span→incident linking (needs span-level error-group association).
- Span `input`/`output` payload inspection (intentionally omitted for safety/size).
- Cross-section drill into a trace (e.g., from the Tenant timeline) via a shell `"trace"` DrillTarget (lands with S7+).

## Verification

`pnpm test` (console + repo-root) green, `pnpm build` green, `pnpm --filter @sigmon/sdk build`, `docker compose config`. No regression: `InvestigationWorkspace` component untouched and still used by `ConsoleShell.tsx`; only the unused registry import removed. Every new DOM `*.test.ts(x)` carries `// @vitest-environment jsdom` as line 1 (S5 controller lesson).
