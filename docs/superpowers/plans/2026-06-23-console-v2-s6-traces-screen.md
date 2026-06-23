# Console v2 S6 — Traces screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v2 Traces screen — a recent-traces index that opens a faithful single-trace view (header, summary strip, collapsible waterfall tree, span detail) wired to the existing `/query/traces` + `/query/traces/:id/spans` routes.

**Architecture:** Mirrors S4/S5: two race-guarded hooks (`useTraces` for the index list, `useTraceSpans` for the selected trace's spans → tree + summary VM via a pure `buildTraceDetail`) feeding a `TracesScreen` component that holds in-screen master-detail state (selected trace, collapsed set, selected span, waterfall filter). Then flip the registry `traces` section from legacy to v2.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + @testing-library/react (jsdom). UI primitives + formatters live in `apps/console/src/components/ui/v2/` (barrel `index.ts`).

## Global Constraints

- **All UI copy in English** (design source is pt-BR). e.g. "Traces", "Recent traces", "Has error", "Waterfall", "Expand all", "Span", "Dur", "Span detail", "Open incident", "Copy ID", "History", "Filters".
- **Every new DOM `*.test.ts(x)` file MUST carry `// @vitest-environment jsdom` as line 1.** The console `vite.config.ts` sets jsdom globally so `pnpm --filter @sigmon/console test` passes without it, but the repo-root `pnpm test` (`vitest run`) defaults to node and `renderHook`/`render` FAIL. (Pure-function-only test files do not need it, but it is harmless.)
- **No backend work.** `listTraces` / `listTraceSpans` already exist and are required (not optional) on `ApiClient`; all existing inline mocks already provide them.
- **No shell changes.** No new `DrillTarget`, no `ConsoleShellV2` edit. Selection is in-screen React state.
- **Do not render `span.input` / `span.output`** in the span-detail panel (size/sensitivity). Show derived attributes + bounded metadata only.
- `kind` and `service` are derived client-side (display-only heuristic) — backend has neither field.
- Span error detection: `span.error != null || /error|fail/i.test(span.status)`.
- Import primitives/formatters from the barrel `"../../components/ui/v2"`.
- Verbatim color map (from design): `{ http: var(--accent), db: var(--sev-info), llm: var(--sev-violet), cache: var(--sev-warning), internal: var(--fg-muted) }`.

---

### Task 1: Add `formatUtcTimestamp` formatter

**Files:**
- Modify: `apps/console/src/components/ui/v2/format.ts`
- Test: `apps/console/src/components/ui/v2/format.test.ts` (append; create if absent)

**Interfaces:**
- Produces: `formatUtcTimestamp(isoString: string): string` → e.g. `"2026-05-24 12:42:08.412 UTC"`; invalid input → `"—"`.

- [ ] **Step 1: Write the failing test**

Append to `apps/console/src/components/ui/v2/format.test.ts` (if the file does not exist, create it; pure functions, no jsdom pragma needed). Add an import for `formatUtcTimestamp` to the existing import from `"./format"` (or add a new import line):

```ts
import { describe, expect, it } from "vitest";
import { formatUtcTimestamp } from "./format";

describe("formatUtcTimestamp", () => {
  it("formats an ISO string as 'YYYY-MM-DD HH:MM:SS.mmm UTC'", () => {
    expect(formatUtcTimestamp("2026-05-24T12:42:08.412Z")).toBe("2026-05-24 12:42:08.412 UTC");
  });

  it("zero-pads all fields", () => {
    expect(formatUtcTimestamp("2026-01-02T03:04:05.006Z")).toBe("2026-01-02 03:04:05.006 UTC");
  });

  it("returns an em-dash for an invalid timestamp", () => {
    expect(formatUtcTimestamp("not-a-date")).toBe("—");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console exec vitest run src/components/ui/v2/format.test.ts`
Expected: FAIL (`formatUtcTimestamp` is not exported).

- [ ] **Step 3: Implement the formatter**

Append to `apps/console/src/components/ui/v2/format.ts`:

```ts
/**
 * Formats an ISO timestamp as "YYYY-MM-DD HH:MM:SS.mmm UTC" (UTC fields).
 * Invalid input returns an em-dash.
 */
export function formatUtcTimestamp(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  const ms = pad(d.getUTCMilliseconds(), 3);
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${ms} UTC`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sigmon/console exec vitest run src/components/ui/v2/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/ui/v2/format.ts apps/console/src/components/ui/v2/format.test.ts
git commit -m "feat(console): add formatUtcTimestamp formatter for trace timestamps"
```

---

### Task 2: `useTraces` hook (recent-traces index)

**Files:**
- Create: `apps/console/src/v2/screens/useTraces.ts`
- Test: `apps/console/src/v2/screens/useTraces.test.ts`

**Interfaces:**
- Consumes: `ApiClient["listTraces"]`, `TraceRecord`, `QueryListResponse` from `../../api/types` / `../../api/client`.
- Produces:
  - `isErrorStatus(status: string): boolean` (shared with Task 3)
  - `type TraceListItemVM = { id; traceId; name; status; hasError; durationMs: number|null; startedAt; tenantId: string|null; userId: string|null }`
  - `type UseTracesResult = { data: TraceListItemVM[] | null; status: "loading"|"ok"|"error"; reload: () => void }`
  - `useTraces({ client, projectId, environmentId }): UseTracesResult`

- [ ] **Step 1: Write the failing test**

Create `apps/console/src/v2/screens/useTraces.test.ts`:

```ts
// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTraces, isErrorStatus } from "./useTraces";
import type { QueryListResponse, TraceRecord } from "../../api/types";

afterEach(() => vi.restoreAllMocks());

function trace(over: Partial<TraceRecord> = {}): TraceRecord {
  return {
    id: "t1", projectId: "p", environmentId: "e", tenantId: "tenant_a", userId: "user_a",
    sessionId: null, traceId: "trace_a", timestamp: "2026-06-23T00:00:00.000Z",
    receivedAt: "2026-06-23T00:00:00.000Z", source: null, release: null, metadata: null,
    name: "POST /api/x", status: "success", startedAt: "2026-06-23T00:00:00.000Z",
    endedAt: "2026-06-23T00:00:02.000Z", durationMs: 2000, ...over,
  };
}

function makeClient(rows: TraceRecord[], over: Record<string, unknown> = {}) {
  return {
    listTraces: vi.fn(async (): Promise<QueryListResponse<TraceRecord>> => ({ data: rows })),
    ...over,
  } as never;
}

describe("isErrorStatus", () => {
  it("matches error-like statuses case-insensitively", () => {
    expect(isErrorStatus("error")).toBe(true);
    expect(isErrorStatus("FAILED")).toBe(true);
    expect(isErrorStatus("success")).toBe(false);
    expect(isErrorStatus("ok")).toBe(false);
  });
});

describe("useTraces", () => {
  it("maps traces to list items and derives traceId fallback + hasError", async () => {
    const client = makeClient([
      trace({ id: "t1", traceId: null, status: "error" }),
      trace({ id: "t2", traceId: "trace_b", status: "success", durationMs: null }),
    ]);
    const { result } = renderHook(() =>
      useTraces({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    const data = result.current.data!;
    expect(data[0].traceId).toBe("t1"); // null traceId falls back to id
    expect(data[0].hasError).toBe(true);
    expect(data[1].traceId).toBe("trace_b");
    expect(data[1].hasError).toBe(false);
    expect(data[1].durationMs).toBeNull();
    expect((client as never as { listTraces: { mock: { calls: unknown[][] } } }).listTraces.mock.calls[0][0])
      .toMatchObject({ projectId: "p", environmentId: "e", limit: 25 });
  });

  it("sets error status when the fetch fails", async () => {
    const client = makeClient([], { listTraces: vi.fn(async () => { throw new Error("boom"); }) });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useTraces({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
    errSpy.mockRestore();
  });

  it("does nothing without project/environment scope", () => {
    const client = makeClient([]);
    renderHook(() => useTraces({ client, projectId: undefined, environmentId: undefined }));
    expect((client as never as { listTraces: { mock: { calls: unknown[] } } }).listTraces.mock.calls.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/useTraces.test.ts`
Expected: FAIL (`useTraces` not found).

- [ ] **Step 3: Implement the hook**

Create `apps/console/src/v2/screens/useTraces.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { TraceRecord } from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type TraceListItemVM = {
  id: string;
  traceId: string;
  name: string;
  status: string;
  hasError: boolean;
  durationMs: number | null;
  startedAt: string;
  tenantId: string | null;
  userId: string | null;
};

export type UseTracesResult = {
  data: TraceListItemVM[] | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

type UseTracesArgs = {
  client: { listTraces: ApiClient["listTraces"] };
  projectId: string | undefined;
  environmentId: string | undefined;
};

const RECENT_TRACES_LIMIT = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A trace/span is errored when it carries an error payload or an error-like status. */
export function isErrorStatus(status: string): boolean {
  return /error|fail/i.test(status);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTraces({ client, projectId, environmentId }: UseTracesArgs): UseTracesResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<TraceListItemVM[] | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId) return;

    const gen = ++genRef.current;
    setStatus("loading");

    client
      .listTraces({ projectId, environmentId, limit: RECENT_TRACES_LIMIT })
      .then((res) => {
        if (gen !== genRef.current) return;
        const rows: TraceListItemVM[] = res.data.map((t) => ({
          id: t.id,
          traceId: t.traceId ?? t.id,
          name: t.name,
          status: t.status,
          hasError: isErrorStatus(t.status),
          durationMs: t.durationMs,
          startedAt: t.startedAt,
          tenantId: t.tenantId,
          userId: t.userId,
        }));
        setData(rows);
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, environmentId, tick]);

  return { data, status, reload };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/useTraces.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/v2/screens/useTraces.ts apps/console/src/v2/screens/useTraces.test.ts
git commit -m "feat(console): add useTraces hook for the v2 recent-traces index"
```

---

### Task 3: `useTraceSpans` hook + `buildTraceDetail` (span tree + summary)

**Files:**
- Create: `apps/console/src/v2/screens/useTraceSpans.ts`
- Test: `apps/console/src/v2/screens/useTraceSpans.test.ts`

**Interfaces:**
- Consumes: `ApiClient["listTraceSpans"]`, `SpanRecord` from types; `isErrorStatus` from `./useTraces`.
- Produces:
  - `type SpanKind = "llm"|"db"|"cache"|"http"|"internal"`
  - `const SPAN_KIND_COLOR: Record<SpanKind, string>`
  - `classifyKind(span: SpanRecord): SpanKind`
  - `isSpanErrored(span: SpanRecord): boolean`
  - `type SpanNodeVM = { id; name; service: string|null; kind: SpanKind; status; errored; level; hasChildren; offsetMs; durMs; costUsd: string|null; error: unknown; metadata: unknown }`
  - `type TraceSummaryVM = { totalMs; spanCount; llmCostUsd; llmTimeMs; dbTimeMs; errorCount }`
  - `type TraceDetailVM = { summary: TraceSummaryVM; spans: SpanNodeVM[] }`
  - `buildTraceDetail(spans: SpanRecord[]): TraceDetailVM` (pure)
  - `type UseTraceSpansResult = { data: TraceDetailVM | null; status: "loading"|"ok"|"error"; reload: () => void }`
  - `useTraceSpans({ client, projectId, environmentId, traceId }): UseTraceSpansResult`

- [ ] **Step 1: Write the failing test**

Create `apps/console/src/v2/screens/useTraceSpans.test.ts`:

```ts
// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTraceDetail, classifyKind, isSpanErrored, useTraceSpans } from "./useTraceSpans";
import type { QueryListResponse, SpanRecord } from "../../api/types";

afterEach(() => vi.restoreAllMocks());

function span(over: Partial<SpanRecord> = {}): SpanRecord {
  return {
    id: "s1", projectId: "p", environmentId: "e", tenantId: null, userId: null, sessionId: null,
    traceId: "trace_a", timestamp: "2026-06-23T00:00:00.000Z", receivedAt: "2026-06-23T00:00:00.000Z",
    source: null, release: null, metadata: null, parentSpanId: null, name: "root", status: "success",
    startedAt: "2026-06-23T00:00:00.000Z", endedAt: "2026-06-23T00:00:01.000Z", durationMs: 1000,
    input: null, output: null, error: null, costUsd: null, ...over,
  };
}

describe("classifyKind", () => {
  it("treats priced spans as llm", () => {
    expect(classifyKind(span({ costUsd: "0.01", name: "anything" }))).toBe("llm");
  });
  it("classifies by source/name heuristics", () => {
    expect(classifyKind(span({ name: "postgres.query" }))).toBe("db");
    expect(classifyKind(span({ name: "redis.cache.set" }))).toBe("cache");
    expect(classifyKind(span({ name: "POST /api/x" }))).toBe("http");
    expect(classifyKind(span({ name: "llm.gpt-5 generate" }))).toBe("llm");
    expect(classifyKind(span({ name: "do_work", source: "worker" }))).toBe("internal");
  });
});

describe("isSpanErrored", () => {
  it("is true when error payload present or status is error-like", () => {
    expect(isSpanErrored(span({ error: { message: "x" } }))).toBe(true);
    expect(isSpanErrored(span({ status: "error" }))).toBe(true);
    expect(isSpanErrored(span())).toBe(false);
  });
});

describe("buildTraceDetail", () => {
  it("returns an empty detail for no spans", () => {
    const d = buildTraceDetail([]);
    expect(d.spans).toEqual([]);
    expect(d.summary).toEqual({ totalMs: 0, spanCount: 0, llmCostUsd: 0, llmTimeMs: 0, dbTimeMs: 0, errorCount: 0 });
  });

  it("builds a depth-assigned, start-ordered tree from parentSpanId", () => {
    const spans = [
      span({ id: "root", parentSpanId: null, startedAt: "2026-06-23T00:00:00.000Z", endedAt: "2026-06-23T00:00:02.380Z", durationMs: 2380, name: "POST /api/dashboards" }),
      span({ id: "child_b", parentSpanId: "root", startedAt: "2026-06-23T00:00:00.038Z", durationMs: 240, name: "router.classify" }),
      span({ id: "child_a", parentSpanId: "root", startedAt: "2026-06-23T00:00:00.012Z", durationMs: 18, name: "auth.validate", source: "postgres" }),
      span({ id: "grandchild", parentSpanId: "child_b", startedAt: "2026-06-23T00:00:00.042Z", durationMs: 232, costUsd: "0.016", name: "llm.classify" }),
    ];
    const d = buildTraceDetail(spans);
    // DFS order with siblings sorted by start: root → child_a (12ms) → child_b (38ms) → grandchild
    expect(d.spans.map((s) => s.id)).toEqual(["root", "child_a", "child_b", "grandchild"]);
    expect(d.spans.map((s) => s.level)).toEqual([0, 1, 1, 2]);
    expect(d.spans.find((s) => s.id === "root")!.hasChildren).toBe(true);
    expect(d.spans.find((s) => s.id === "grandchild")!.hasChildren).toBe(false);
    // offsets relative to trace start
    expect(d.spans.find((s) => s.id === "child_a")!.offsetMs).toBe(12);
    // summary
    expect(d.summary.totalMs).toBe(2380);
    expect(d.summary.spanCount).toBe(4);
    expect(d.summary.llmCostUsd).toBeCloseTo(0.016);
    expect(d.summary.llmTimeMs).toBe(232); // grandchild is llm
    expect(d.summary.dbTimeMs).toBe(18);   // child_a classified db via source "postgres"
    expect(d.summary.errorCount).toBe(0);
  });

  it("treats orphan spans (missing parent) as roots and counts errors", () => {
    const spans = [
      span({ id: "a", parentSpanId: "ghost", status: "error", durationMs: 10 }),
      span({ id: "b", parentSpanId: null, error: { message: "boom" }, durationMs: 20 }),
    ];
    const d = buildTraceDetail(spans);
    expect(d.spans.map((s) => s.level)).toEqual([0, 0]);
    expect(d.summary.errorCount).toBe(2);
  });

  it("survives a parentSpanId cycle without infinite recursion", () => {
    const spans = [
      span({ id: "x", parentSpanId: "y" }),
      span({ id: "y", parentSpanId: "x" }),
    ];
    const d = buildTraceDetail(spans);
    expect(d.spans.length).toBe(2);
  });
});

describe("useTraceSpans", () => {
  function makeClient(rows: SpanRecord[], over: Record<string, unknown> = {}) {
    return {
      listTraceSpans: vi.fn(async (): Promise<QueryListResponse<SpanRecord>> => ({ data: rows })),
      ...over,
    } as never;
  }

  it("fetches spans and builds the detail VM", async () => {
    const client = makeClient([span({ id: "root" })]);
    const { result } = renderHook(() =>
      useTraceSpans({ client, projectId: "p", environmentId: "e", traceId: "trace_a" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.spans.length).toBe(1);
    expect((client as never as { listTraceSpans: { mock: { calls: unknown[][] } } }).listTraceSpans.mock.calls[0][0]).toBe("trace_a");
  });

  it("does not fetch without a traceId", () => {
    const client = makeClient([]);
    renderHook(() =>
      useTraceSpans({ client, projectId: "p", environmentId: "e", traceId: undefined }));
    expect((client as never as { listTraceSpans: { mock: { calls: unknown[] } } }).listTraceSpans.mock.calls.length).toBe(0);
  });

  it("sets error status when the fetch fails", async () => {
    const client = makeClient([], { listTraceSpans: vi.fn(async () => { throw new Error("boom"); }) });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useTraceSpans({ client, projectId: "p", environmentId: "e", traceId: "trace_a" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/useTraceSpans.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hook + builder**

Create `apps/console/src/v2/screens/useTraceSpans.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { SpanRecord } from "../../api/types";
import { isErrorStatus } from "./useTraces";

// ---------------------------------------------------------------------------
// Span kind (derived, display-only — backend has no `kind` field)
// ---------------------------------------------------------------------------

export type SpanKind = "llm" | "db" | "cache" | "http" | "internal";

/** Verbatim from the design. */
export const SPAN_KIND_COLOR: Record<SpanKind, string> = {
  http: "var(--accent)",
  db: "var(--sev-info)",
  llm: "var(--sev-violet)",
  cache: "var(--sev-warning)",
  internal: "var(--fg-muted)",
};

/** Heuristic classification (display-only). Priced spans are LLM; otherwise match source/name. */
export function classifyKind(span: SpanRecord): SpanKind {
  if (span.costUsd != null) return "llm";
  const s = `${span.source ?? ""} ${span.name ?? ""}`.toLowerCase();
  if (/\b(llm|gpt|claude|haiku|gemini|openai|anthropic|embed|completion)\b/.test(s)) return "llm";
  if (/\b(postgres|mysql|sqlite|sql|query|database|prisma|kysely|db)\b/.test(s)) return "db";
  if (/\b(redis|cache|memcache|memcached)\b/.test(s)) return "cache";
  if (/(https?:|\bget\b|\bpost\b|\bput\b|\bdelete\b|\bpatch\b|\/api\/|fetch|request)/.test(s)) return "http";
  return "internal";
}

export function isSpanErrored(span: SpanRecord): boolean {
  return span.error != null || isErrorStatus(span.status);
}

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type SpanNodeVM = {
  id: string;
  name: string;
  service: string | null;
  kind: SpanKind;
  status: string;
  errored: boolean;
  level: number;
  hasChildren: boolean;
  offsetMs: number;
  durMs: number;
  costUsd: string | null;
  error: unknown;
  metadata: unknown;
};

export type TraceSummaryVM = {
  totalMs: number;
  spanCount: number;
  llmCostUsd: number;
  llmTimeMs: number;
  dbTimeMs: number;
  errorCount: number;
};

export type TraceDetailVM = {
  summary: TraceSummaryVM;
  spans: SpanNodeVM[];
};

export type UseTraceSpansResult = {
  data: TraceDetailVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

type UseTraceSpansArgs = {
  client: { listTraceSpans: ApiClient["listTraceSpans"] };
  projectId: string | undefined;
  environmentId: string | undefined;
  traceId: string | undefined;
};

const SPANS_LIMIT = 500;

// ---------------------------------------------------------------------------
// Pure builder: spans → tree (flat, DFS-ordered) + summary
// ---------------------------------------------------------------------------

function parseTime(iso: string): number {
  return new Date(iso).getTime();
}

export function buildTraceDetail(spanRecords: SpanRecord[]): TraceDetailVM {
  if (spanRecords.length === 0) {
    return {
      summary: { totalMs: 0, spanCount: 0, llmCostUsd: 0, llmTimeMs: 0, dbTimeMs: 0, errorCount: 0 },
      spans: [],
    };
  }

  // Timing baseline.
  const startTimes = spanRecords.map((s) => parseTime(s.startedAt)).filter((n) => !Number.isNaN(n));
  const traceStart = startTimes.length ? Math.min(...startTimes) : 0;
  let traceEnd = traceStart;
  for (const s of spanRecords) {
    const end = parseTime(s.endedAt ?? s.startedAt);
    if (!Number.isNaN(end) && end > traceEnd) traceEnd = end;
  }
  const totalMs = Math.max(traceEnd - traceStart, 1);

  // Per-span derived metrics.
  const meta = new Map<string, { offsetMs: number; durMs: number; kind: SpanKind; errored: boolean }>();
  for (const s of spanRecords) {
    const st = parseTime(s.startedAt);
    const offsetMs = Number.isNaN(st) ? 0 : Math.max(st - traceStart, 0);
    let durMs: number;
    if (s.durationMs != null) {
      durMs = Math.max(s.durationMs, 0);
    } else {
      const en = parseTime(s.endedAt ?? s.startedAt);
      durMs = Number.isNaN(en) || Number.isNaN(st) ? 0 : Math.max(en - st, 0);
    }
    meta.set(s.id, { offsetMs, durMs, kind: classifyKind(s), errored: isSpanErrored(s) });
  }

  // Tree assembly.
  const byId = new Map(spanRecords.map((s) => [s.id, s]));
  const children = new Map<string, SpanRecord[]>();
  const roots: SpanRecord[] = [];
  for (const s of spanRecords) {
    const parentId = s.parentSpanId;
    if (parentId != null && byId.has(parentId)) {
      const arr = children.get(parentId) ?? [];
      arr.push(s);
      children.set(parentId, arr);
    } else {
      roots.push(s);
    }
  }
  const byStart = (a: SpanRecord, b: SpanRecord) => {
    const da = meta.get(a.id)!.offsetMs;
    const db = meta.get(b.id)!.offsetMs;
    if (da !== db) return da - db;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  roots.sort(byStart);
  for (const arr of children.values()) arr.sort(byStart);

  const flat: SpanNodeVM[] = [];
  const visited = new Set<string>();
  const walk = (s: SpanRecord, level: number) => {
    if (visited.has(s.id)) return;
    visited.add(s.id);
    const kids = children.get(s.id) ?? [];
    const m = meta.get(s.id)!;
    flat.push({
      id: s.id,
      name: s.name,
      service: s.source,
      kind: m.kind,
      status: s.status,
      errored: m.errored,
      level,
      hasChildren: kids.length > 0,
      offsetMs: m.offsetMs,
      durMs: m.durMs,
      costUsd: s.costUsd,
      error: s.error,
      metadata: s.metadata,
    });
    for (const k of kids) walk(k, level + 1);
  };
  for (const r of roots) walk(r, 0);
  // Cycle/orphan safety: append any span not reached via the root walk.
  for (const s of spanRecords) {
    if (!visited.has(s.id)) walk(s, 0);
  }

  // Summary.
  let llmCostUsd = 0;
  let llmTimeMs = 0;
  let dbTimeMs = 0;
  let errorCount = 0;
  for (const node of flat) {
    if (node.costUsd != null) {
      const c = Number(node.costUsd);
      if (Number.isFinite(c)) llmCostUsd += c;
    }
    if (node.kind === "llm") llmTimeMs += node.durMs;
    if (node.kind === "db") dbTimeMs += node.durMs;
    if (node.errored) errorCount += 1;
  }

  return {
    summary: { totalMs, spanCount: flat.length, llmCostUsd, llmTimeMs, dbTimeMs, errorCount },
    spans: flat,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTraceSpans({
  client,
  projectId,
  environmentId,
  traceId,
}: UseTraceSpansArgs): UseTraceSpansResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<TraceDetailVM | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId || !traceId) return;

    const gen = ++genRef.current;
    setStatus("loading");

    client
      .listTraceSpans(traceId, { projectId, environmentId, limit: SPANS_LIMIT })
      .then((res) => {
        if (gen !== genRef.current) return;
        setData(buildTraceDetail(res.data));
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, environmentId, traceId, tick]);

  return { data, status, reload };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/useTraceSpans.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/v2/screens/useTraceSpans.ts apps/console/src/v2/screens/useTraceSpans.test.ts
git commit -m "feat(console): add useTraceSpans hook with span tree + summary builder"
```

---

### Task 4: `TracesScreen` component (index ⇄ waterfall detail)

**Files:**
- Create: `apps/console/src/v2/screens/TracesScreen.tsx`
- Test: `apps/console/src/v2/screens/TracesScreen.test.tsx`

**Interfaces:**
- Consumes: `ScreenCtx` from `./registry`; `useTraces` + `TraceListItemVM` from `./useTraces`; `useTraceSpans` + `SpanNodeVM` + `SPAN_KIND_COLOR` from `./useTraceSpans`; primitives/formatters from `../../components/ui/v2`.
- Produces: `export function TracesScreen({ ctx }: { ctx: ScreenCtx })`.

**Behavior summary** (all locked in the spec):
- Guard missing project/env → EmptyHint. List `loading`/`error` states.
- `selectedTraceId` state: `undefined` → list view; set → detail view (rendered as `<TraceDetailView key={selectedTraceId} ... />` so per-trace state resets).
- List rows → `setSelectedTraceId(trace.id)`. Header actions = History/Filters pushToast stubs.
- Detail: header (back button, has-error tag, ids, UTC started, root name, subtitle), summary strip (+ kind legend), waterfall (Expand all + All/Slow/Errors Segmented; collapsible tree in All, flat filtered in Slow/Errors), span detail panel.
- "Open incident" → pushToast stub. "Copy ID" → clipboard + toast.

- [ ] **Step 1: Write the failing test**

Create `apps/console/src/v2/screens/TracesScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../api/types";
import { TracesScreen } from "./TracesScreen";
import type { ScreenCtx } from "./registry";
import * as useTracesModule from "./useTraces";
import * as useTraceSpansModule from "./useTraceSpans";
import type { TraceListItemVM } from "./useTraces";
import type { TraceDetailVM } from "./useTraceSpans";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project = { id: "p", name: "Demo" } as Project;
const environment = { id: "e", name: "production" } as Environment;

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: {} as never,
    project, environment, environments: [environment],
    onCreateEnvironment: vi.fn(), onArchiveProject: vi.fn(), onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(), onUpdateProject: vi.fn(), navigate: vi.fn(), back: vi.fn(),
    drill: vi.fn(), pushToast: vi.fn(), ...over,
  } as ScreenCtx;
}

const traces: TraceListItemVM[] = [
  { id: "t1", traceId: "trace_a", name: "POST /api/dashboards", status: "error", hasError: true,
    durationMs: 2380, startedAt: "2026-06-23T12:42:08.412Z", tenantId: "tenant_acme", userId: "user_8420" },
  { id: "t2", traceId: "trace_b", name: "GET /api/health", status: "success", hasError: false,
    durationMs: 12, startedAt: "2026-06-23T12:30:00.000Z", tenantId: null, userId: null },
];

const detail: TraceDetailVM = {
  summary: { totalMs: 2380, spanCount: 3, llmCostUsd: 0.024, llmTimeMs: 1716, dbTimeMs: 430, errorCount: 1 },
  spans: [
    { id: "root", name: "POST /api/dashboards", service: "api", kind: "http", status: "success",
      errored: false, level: 0, hasChildren: true, offsetMs: 0, durMs: 2380, costUsd: null, error: null, metadata: null },
    { id: "child", name: "postgres.query", service: "postgres", kind: "db", status: "success",
      errored: false, level: 1, hasChildren: false, offsetMs: 1145, durMs: 412, costUsd: null, error: null, metadata: null },
    { id: "err", name: "llm.gpt-5 explain", service: "openai", kind: "llm", status: "error",
      errored: true, level: 1, hasChildren: false, offsetMs: 1562, durMs: 642, costUsd: "0.0162",
      error: { message: "AbortError: signal timeout" }, metadata: { foo: "bar" } },
  ],
};

function mockList(data: TraceListItemVM[] | null, status: "loading" | "ok" | "error" = "ok") {
  vi.spyOn(useTracesModule, "useTraces").mockReturnValue({ data, status, reload: vi.fn() });
}
function mockSpans(data: TraceDetailVM | null, status: "loading" | "ok" | "error" = "ok") {
  vi.spyOn(useTraceSpansModule, "useTraceSpans").mockReturnValue({ data, status, reload: vi.fn() });
}

describe("TracesScreen — index", () => {
  it("guards missing project/env", () => {
    mockList(null, "loading");
    render(<TracesScreen ctx={makeCtx({ project: undefined, environment: undefined })} />);
    expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    mockList(null, "loading");
    const { rerender } = render(<TracesScreen ctx={makeCtx()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    mockList(null, "error");
    rerender(<TracesScreen ctx={makeCtx()} />);
    expect(screen.getByText(/could not load traces/i)).toBeInTheDocument();
  });

  it("renders the recent-traces list with title and rows", () => {
    mockList(traces);
    render(<TracesScreen ctx={makeCtx()} />);
    expect(screen.getByText("Traces")).toBeInTheDocument();
    expect(screen.getByText("POST /api/dashboards")).toBeInTheDocument();
    expect(screen.getByText("GET /api/health")).toBeInTheDocument();
  });

  it("History and Filters are stub toasts", async () => {
    mockList(traces);
    const ctx = makeCtx();
    render(<TracesScreen ctx={ctx} />);
    await userEvent.click(screen.getByText("History"));
    await userEvent.click(screen.getByText("Filters"));
    expect(ctx.pushToast).toHaveBeenCalledWith("Trace history is not yet available");
    expect(ctx.pushToast).toHaveBeenCalledWith("Trace filters are not yet available");
  });

  it("empty list shows a hint", () => {
    mockList([]);
    render(<TracesScreen ctx={makeCtx()} />);
    expect(screen.getByText(/no traces/i)).toBeInTheDocument();
  });
});

describe("TracesScreen — detail", () => {
  it("opens a trace into the waterfall view and renders header + summary", async () => {
    mockList(traces);
    mockSpans(detail);
    render(<TracesScreen ctx={makeCtx()} />);
    await userEvent.click(screen.getByText("POST /api/dashboards"));
    // header
    expect(screen.getByText(/has error/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-06-23 12:42:08.412 UTC/)).toBeInTheDocument();
    // summary strip
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByText("Spans")).toBeInTheDocument();
    expect(screen.getByText("Errors")).toBeInTheDocument();
    // waterfall section
    expect(screen.getByText("Waterfall")).toBeInTheDocument();
    expect(screen.getByText("Expand all")).toBeInTheDocument();
  });

  it("selecting a span shows its detail; error span shows error block; cost shown for llm", async () => {
    mockList(traces);
    mockSpans(detail);
    render(<TracesScreen ctx={makeCtx()} />);
    await userEvent.click(screen.getByText("POST /api/dashboards"));
    // default-selected span is the first errored one → error block visible
    expect(screen.getByText("Span detail")).toBeInTheDocument();
    expect(screen.getByText(/AbortError/)).toBeInTheDocument();
    expect(screen.getByText("$ 0.02")).toBeInTheDocument(); // cost of the llm span
  });

  it("Open incident is a stub toast; Copy ID toasts", async () => {
    mockList(traces);
    mockSpans(detail);
    const ctx = makeCtx();
    render(<TracesScreen ctx={ctx} />);
    await userEvent.click(screen.getByText("POST /api/dashboards"));
    await userEvent.click(screen.getByText("Open incident"));
    expect(ctx.pushToast).toHaveBeenCalledWith("Linking spans to incidents is not yet available");
    await userEvent.click(screen.getByText("Copy ID"));
    expect(ctx.pushToast).toHaveBeenCalledWith("Trace ID copied");
  });

  it("Errors filter narrows the waterfall to errored spans", async () => {
    mockList(traces);
    mockSpans(detail);
    render(<TracesScreen ctx={makeCtx()} />);
    await userEvent.click(screen.getByText("POST /api/dashboards"));
    const waterfall = screen.getByText("Waterfall").closest(".sh-card") as HTMLElement;
    await userEvent.click(within(waterfall).getByText("Errors"));
    // only the errored span name remains in the waterfall list
    expect(within(waterfall).queryByText("postgres.query")).not.toBeInTheDocument();
    expect(within(waterfall).getByText("llm.gpt-5 explain")).toBeInTheDocument();
  });

  it("back returns to the index", async () => {
    mockList(traces);
    mockSpans(detail);
    render(<TracesScreen ctx={makeCtx()} />);
    await userEvent.click(screen.getByText("POST /api/dashboards"));
    await userEvent.click(screen.getByText(/recent traces/i));
    expect(screen.getByText("Traces")).toBeInTheDocument();
    expect(screen.getByText("GET /api/health")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/TracesScreen.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the component**

Create `apps/console/src/v2/screens/TracesScreen.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { ScreenCtx } from "./registry";
import { useTraces } from "./useTraces";
import type { TraceListItemVM } from "./useTraces";
import { SPAN_KIND_COLOR, useTraceSpans } from "./useTraceSpans";
import type { SpanNodeVM } from "./useTraceSpans";
import {
  Divider,
  EmptyHint,
  formatLatency,
  formatUsd,
  formatUtcTimestamp,
  Icon,
  Kv,
  Legend,
  PageHead,
  relativeTime,
  Segmented,
  SummaryStat,
} from "../../components/ui/v2";

type WaterfallFilter = "All" | "Slow" | "Errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function boundText(s: string, max = 2000): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function stringifyUnknown(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function spanAttributes(span: SpanNodeVM): string {
  const attrs: Record<string, unknown> = {
    service: span.service ?? null,
    kind: span.kind,
    status: span.status,
    duration_ms: span.durMs,
    started_ms: span.offsetMs,
    cost_usd: span.costUsd ?? null,
  };
  if (span.metadata != null && typeof span.metadata === "object") {
    attrs.metadata = span.metadata;
  }
  return boundText(JSON.stringify(attrs, null, 2));
}

// Build the ruler tick labels (0 … totalMs) for the waterfall header.
function rulerLabels(totalMs: number): string[] {
  const t = Math.round(totalMs);
  return [
    "0",
    String(Math.round(totalMs * 0.25)),
    String(Math.round(totalMs * 0.5)),
    String(Math.round(totalMs * 0.75)),
    `${t}ms`,
  ];
}

// ---------------------------------------------------------------------------
// Index (recent traces)
// ---------------------------------------------------------------------------

function TraceListRow({ trace, onOpen }: { trace: TraceListItemVM; onOpen: () => void }) {
  return (
    <button
      className="sh-row sh-row--btn"
      style={{
        gridTemplateColumns: "1fr",
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "14px 18px",
        cursor: "pointer",
      }}
      onClick={onOpen}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        {trace.hasError ? (
          <span className="sh-tag critical">● Has error</span>
        ) : (
          <span className="sh-tag ok">{trace.status}</span>
        )}
        <span className="sh-tag mono">{trace.traceId}</span>
        <span className="sh-faint sh-mono" style={{ fontSize: 11 }}>
          {(trace.userId ?? "—")} · {(trace.tenantId ?? "—")}
        </span>
        <div style={{ flex: 1 }} />
        <span className="sh-faint sh-mono" style={{ fontSize: 11 }}>{relativeTime(trace.startedAt)}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span className="sh-mono" style={{ fontSize: 13, color: "var(--fg)" }}>{trace.name}</span>
        <div style={{ flex: 1 }} />
        <span className="sh-mono sh-muted" style={{ fontSize: 12 }}>{formatLatency(trace.durationMs)}</span>
        <Icon name="arrow" size={12} style={{ color: "var(--fg-faint)" }} />
      </div>
    </button>
  );
}

function TraceListView({ ctx, traces, onOpen }: {
  ctx: ScreenCtx;
  traces: TraceListItemVM[];
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <PageHead
        title="Traces"
        sub={
          <>
            Recent traces for{" "}
            <strong style={{ color: "var(--fg)" }}>
              {ctx.project?.name} · {ctx.environment?.name}
            </strong>{" "}
            — {traces.length} shown.
          </>
        }
        actions={
          <>
            <button className="sh-btn" onClick={() => ctx.pushToast("Trace history is not yet available")}>
              <Icon name="history" size={14} />
              History
            </button>
            <button className="sh-btn" onClick={() => ctx.pushToast("Trace filters are not yet available")}>
              <Icon name="filter" size={14} />
              Filters
            </button>
          </>
        }
      />
      <div className="sh-card" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div className="sh-card__head">
          <h2 className="sh-h2">Recent traces</h2>
          <span className="sh-tag">latest 25</span>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {traces.length === 0 ? (
            <EmptyHint icon="waterfall" title="No traces in this project" sub="Traces will appear here as they are ingested." />
          ) : (
            traces.map((t) => <TraceListRow key={t.id} trace={t} onOpen={() => onOpen(t.id)} />)
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail (waterfall + span detail)
// ---------------------------------------------------------------------------

function computeVisible(spans: SpanNodeVM[], filter: WaterfallFilter, collapsed: Set<string>, totalMs: number): SpanNodeVM[] {
  if (filter === "Errors") return spans.filter((s) => s.errored);
  if (filter === "Slow") {
    const threshold = totalMs * 0.05;
    return spans.filter((s) => s.durMs >= threshold).slice().sort((a, b) => b.durMs - a.durMs);
  }
  // All → collapsible tree
  const visible: SpanNodeVM[] = [];
  let hideBelow = Infinity;
  for (const s of spans) {
    if (s.level > hideBelow) continue;
    hideBelow = Infinity;
    visible.push(s);
    if (collapsed.has(s.id) && s.hasChildren) hideBelow = s.level;
  }
  return visible;
}

function WaterfallRow({ span, totalMs, treeMode, isCollapsed, isActive, onSelect, onToggle }: {
  span: SpanNodeVM;
  totalMs: number;
  treeMode: boolean;
  isCollapsed: boolean;
  isActive: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const left = (span.offsetMs / totalMs) * 100;
  const width = Math.max((span.durMs / totalMs) * 100, 0.4);
  const showToggle = treeMode && span.hasChildren;
  return (
    <div
      className={`sh-row span-row ${isActive ? "is-active" : ""}`}
      style={{ gridTemplateColumns: "280px 60px 1fr", padding: "9px 16px", cursor: "pointer" }}
      onClick={onSelect}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 5, paddingLeft: span.level * 16, minWidth: 0 }}>
        {showToggle ? (
          <button
            className="span-toggle"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            <Icon name="chevd" size={12} style={{ transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform .2s" }} />
          </button>
        ) : (
          <span style={{ width: 16, display: "inline-block", textAlign: "center", color: "var(--fg-faint)" }}>·</span>
        )}
        <span style={{ width: 8, height: 8, borderRadius: 2, background: SPAN_KIND_COLOR[span.kind], flex: "0 0 auto" }} />
        <span className="sh-mono" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {span.name}
        </span>
        {treeMode && isCollapsed && span.hasChildren ? (
          <span className="sh-tag mono" style={{ padding: "0 5px", fontSize: 9 }}>+</span>
        ) : null}
        {span.errored ? <span className="sh-tag critical" style={{ padding: "1px 5px", fontSize: 9 }}>ERR</span> : null}
      </div>
      <span className="sh-mono sh-muted" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{Math.round(span.durMs)}ms</span>
      <div style={{ position: "relative", height: 16, background: "var(--bg-canvas)", borderRadius: 2 }}>
        {[20, 40, 60, 80].map((p) => (
          <span key={p} style={{ position: "absolute", left: `${p}%`, top: 0, bottom: 0, width: 1, background: "var(--border-subtle)" }} />
        ))}
        <div
          style={{
            position: "absolute",
            left: `${left}%`,
            width: `${width}%`,
            top: 2,
            bottom: 2,
            borderRadius: 2,
            background: span.errored ? "var(--sev-critical)" : SPAN_KIND_COLOR[span.kind],
          }}
        />
      </div>
    </div>
  );
}

function SpanDetailPanel({ span, traceIdLabel, ctx }: { span: SpanNodeVM; traceIdLabel: string; ctx: ScreenCtx }) {
  const copyId = () => {
    try {
      navigator.clipboard?.writeText(traceIdLabel);
    } catch {
      /* clipboard unavailable — toast still confirms intent */
    }
    ctx.pushToast("Trace ID copied");
  };
  return (
    <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="sh-card__head">
        <h2 className="sh-h2">Span detail</h2>
        {span.errored ? <span className="sh-tag critical">error</span> : <span className="sh-tag ok">{span.kind}</span>}
      </div>
      <div className="sh-card__body" style={{ overflow: "auto", flex: 1, display: "grid", gap: 16, alignContent: "start" }}>
        <div>
          <div className="sh-eyebrow" style={{ marginBottom: 6 }}>Name</div>
          <div className="sh-mono" style={{ fontSize: 13, color: "var(--fg)" }}>{span.name}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Kv k="Started" v={`+${Math.round(span.offsetMs)} ms`} mono />
          <Kv k="Duration" v={`${Math.round(span.durMs)} ms`} mono />
          <Kv k="Service" v={span.service ?? "—"} mono />
          <Kv k="Kind" v={span.kind} mono />
          <Kv k="Status" v={span.status} mono tone={span.errored ? "danger" : null} />
          <Kv k="Cost" v={span.costUsd != null ? formatUsd(Number(span.costUsd)) : "—"} mono />
        </div>
        {span.errored ? (
          <div>
            <div className="sh-eyebrow" style={{ marginBottom: 6 }}>Error</div>
            <div className="sh-code" style={{ whiteSpace: "pre-wrap" }}>{boundText(stringifyUnknown(span.error)) || "—"}</div>
          </div>
        ) : null}
        <div>
          <div className="sh-eyebrow" style={{ marginBottom: 6 }}>Attributes</div>
          <div className="sh-code" style={{ maxHeight: 130, overflow: "auto", whiteSpace: "pre-wrap" }}>{spanAttributes(span)}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sh-btn primary" onClick={() => ctx.pushToast("Linking spans to incidents is not yet available")}>
            <Icon name="error" size={13} />
            Open incident
          </button>
          <button className="sh-btn" onClick={copyId}>
            <Icon name="copy" size={13} />
            Copy ID
          </button>
        </div>
      </div>
    </div>
  );
}

function TraceDetailView({ ctx, trace, onBack }: { ctx: ScreenCtx; trace: TraceListItemVM; onBack: () => void }) {
  const { data: detail, status } = useTraceSpans({
    client: ctx.client,
    projectId: ctx.project?.id,
    environmentId: ctx.environment?.id,
    traceId: trace.id,
  });

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<WaterfallFilter>("All");
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  // Default-select the first errored span (else the root) once spans load.
  useEffect(() => {
    if (!detail || detail.spans.length === 0) return;
    setSelectedSpanId((cur) => cur ?? (detail.spans.find((s) => s.errored)?.id ?? detail.spans[0].id));
  }, [detail]);

  const back = (
    <button className="sh-btn ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={onBack}>
      <Icon name="arrow" size={12} style={{ transform: "rotate(180deg)" }} />
      Recent traces
    </button>
  );

  const summary = detail?.summary;
  const hasError = trace.hasError || (summary ? summary.errorCount > 0 : false);
  const spanCount = summary?.spanCount ?? 0;
  const totalMs = summary?.totalMs ?? 0;
  const errorCount = summary?.errorCount ?? 0;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const spans = detail?.spans ?? [];
  const visible = computeVisible(spans, filter, collapsed, Math.max(totalMs, 1));
  const selectedSpan = spans.find((s) => s.id === selectedSpanId) ?? null;

  return (
    <>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
          {back}
          {hasError ? <span className="sh-tag warn">● Has error</span> : <span className="sh-tag ok">{trace.status}</span>}
          <span className="sh-tag mono">{trace.traceId}</span>
          <span className="sh-tag mono">{(trace.userId ?? "—")} · {(trace.tenantId ?? "—")}</span>
          <span className="sh-faint sh-mono" style={{ fontSize: 11 }}>started {formatUtcTimestamp(trace.startedAt)}</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: "6px 0", fontFamily: "var(--font-mono)" }}>{trace.name}</h1>
        <p className="sh-muted" style={{ margin: 0, fontSize: 13 }}>
          {spanCount} spans · {formatLatency(totalMs)} total · {errorCount} {errorCount === 1 ? "error" : "errors"}
        </p>
      </div>

      <div className="sh-card">
        <div className="sh-card__body" style={{ display: "flex", gap: 32, padding: "12px 18px", alignItems: "center", flexWrap: "wrap" }}>
          <SummaryStat label="Duration" value={formatLatency(totalMs)} />
          <Divider />
          <SummaryStat label="Spans" value={String(spanCount)} />
          <Divider />
          <SummaryStat label="LLM cost" value={formatUsd(summary?.llmCostUsd ?? 0)} mono />
          <Divider />
          <SummaryStat label="LLM time" value={formatLatency(summary?.llmTimeMs ?? 0)} />
          <Divider />
          <SummaryStat label="DB time" value={formatLatency(summary?.dbTimeMs ?? 0)} />
          <Divider />
          <SummaryStat label="Errors" value={String(errorCount)} tone={errorCount > 0 ? "danger" : undefined} />
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
            {(Object.entries(SPAN_KIND_COLOR) as [string, string][]).map(([k, c]) => (
              <Legend key={k} color={c} label={k} />
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Waterfall</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="sh-btn ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => setCollapsed(new Set())}>
                Expand all
              </button>
              <Segmented options={["All", "Slow", "Errors"]} value={filter} onChange={(v) => setFilter(v as WaterfallFilter)} />
            </div>
          </div>

          {status === "loading" && !detail ? (
            <EmptyHint icon="waterfall" title="Loading…" sub="Fetching spans." />
          ) : status === "error" ? (
            <EmptyHint icon="alert" title="Could not load spans" sub="Check your connection or try again." />
          ) : spans.length === 0 ? (
            <EmptyHint icon="waterfall" title="No spans for this trace" />
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "280px 60px 1fr",
                  borderBottom: "1px solid var(--border-subtle)",
                  padding: "8px 16px",
                  fontSize: 10.5,
                  color: "var(--fg-faint)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <span>Span</span>
                <span>Dur</span>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  {rulerLabels(Math.max(totalMs, 1)).map((label, i) => (
                    <span key={i}>{label}</span>
                  ))}
                </div>
              </div>
              <div style={{ overflow: "auto", flex: 1 }}>
                {visible.map((s) => (
                  <WaterfallRow
                    key={s.id}
                    span={s}
                    totalMs={Math.max(totalMs, 1)}
                    treeMode={filter === "All"}
                    isCollapsed={collapsed.has(s.id)}
                    isActive={s.id === selectedSpanId}
                    onSelect={() => setSelectedSpanId(s.id)}
                    onToggle={() => toggle(s.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {selectedSpan ? (
          <SpanDetailPanel span={selectedSpan} traceIdLabel={trace.traceId} ctx={ctx} />
        ) : (
          <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="sh-card__head"><h2 className="sh-h2">Span detail</h2></div>
            <EmptyHint icon="waterfall" title="Select a span" sub="Pick a span in the waterfall to inspect it." />
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function TracesScreen({ ctx }: { ctx: ScreenCtx }) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;
  const [selectedTraceId, setSelectedTraceId] = useState<string | undefined>(undefined);

  const { data, status } = useTraces({ client: ctx.client, projectId, environmentId });

  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="waterfall" title="No project selected" sub="Select a project and environment to view traces." />
      </div>
    );
  }

  if (status === "loading" && !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="waterfall" title="Loading…" sub="Fetching recent traces." />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="alert" title="Could not load traces" sub="Check your connection or try again." />
      </div>
    );
  }

  const selectedTrace = selectedTraceId ? data.find((t) => t.id === selectedTraceId) : undefined;

  if (selectedTrace) {
    return (
      <TraceDetailView
        key={selectedTrace.id}
        ctx={ctx}
        trace={selectedTrace}
        onBack={() => setSelectedTraceId(undefined)}
      />
    );
  }

  return <TraceListView ctx={ctx} traces={data} onOpen={setSelectedTraceId} />;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/TracesScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @sigmon/console exec tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/v2/screens/TracesScreen.tsx apps/console/src/v2/screens/TracesScreen.test.tsx
git commit -m "feat(console): add v2 Traces screen with collapsible waterfall"
```

---

### Task 5: Flip the registry `traces` section to v2

**Files:**
- Modify: `apps/console/src/v2/screens/registry.tsx`
- Test: `apps/console/src/v2/screens/registry.test.tsx`

**Interfaces:**
- Consumes: `TracesScreen` from `./TracesScreen`.

- [ ] **Step 1: Write/extend the failing test**

In `apps/console/src/v2/screens/registry.test.tsx`, add (mirroring the existing `llm` v2 assertions). First add near the other module imports at the top:

```tsx
import * as useTracesModule from "./useTraces";
```

Then add these tests inside the existing top-level `describe` block:

```tsx
it("routes traces to a v2 screen", () => {
  expect(SCREENS.traces.kind).toBe("v2");
});

it("renders the v2 Traces screen (not wrapped in the legacy island)", () => {
  vi.spyOn(useTracesModule, "useTraces").mockReturnValue({ data: null, status: "loading", reload: vi.fn() });
  const ctx = makeCtx();
  const node = renderSection("traces", ctx);
  const { container } = render(<>{node}</>);
  expect(container.querySelector(".sh-legacy-island")).toBeNull();
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
});
```

> If `registry.test.tsx` does not already define `makeCtx`/`render`/`screen` (it does for the `llm` tests added in S5), reuse the existing helpers in that file. Match the existing file's import style and the legacy-island class selector it already asserts against (S5 used the same pattern for `llm`). If the legacy-island wrapper class differs, use the same selector the existing `llm` "not in legacy island" test uses.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/registry.test.tsx`
Expected: FAIL (traces still legacy).

- [ ] **Step 3: Flip the registry + drop the now-unused import**

In `apps/console/src/v2/screens/registry.tsx`:

1. Remove the now-unused import (line 5): `import { InvestigationWorkspace } from "../../components/InvestigationWorkspace";` — the component itself stays in the codebase (`ConsoleShell.tsx` still uses it); only this registry import becomes dead after the flip.
2. Add after the `LlmScreen` import (line 12): `import { TracesScreen } from "./TracesScreen";`
3. Replace the `traces` entry:

```tsx
  traces: {
    kind: "v2",
    render: (ctx) => <TracesScreen ctx={ctx} />,
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/registry.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck (confirms no dangling InvestigationWorkspace reference)**

Run: `pnpm --filter @sigmon/console exec tsc -p tsconfig.json --noEmit`
Expected: no errors (the removed import is no longer referenced in registry).

- [ ] **Step 6: Full verification gate**

Run:
```bash
pnpm test
pnpm build
pnpm --filter @sigmon/sdk build
docker compose config
```
Expected: all exit 0. Every new DOM test file carries the jsdom pragma so repo-root `pnpm test` (node default) passes.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/v2/screens/registry.tsx apps/console/src/v2/screens/registry.test.tsx
git commit -m "feat(console): route the v2 Traces screen in the registry"
```

---

## Self-Review

- **Spec coverage:** trace header (T4), summary strip + kind legend (T4), collapsible waterfall with indent/expand-collapse/kind-color/ERR/duration/timeline-gridlines/All-Slow-Errors filter (T3 tree + T4 render), span detail panel with name/started/duration/service/kind/status/cost/error/attributes/open-incident/copy-id (T4), wired to `/query/traces/:id/spans` via `listTraceSpans` (T3). Recent-traces index for selection (T2 + T4). `formatUtcTimestamp` (T1). Registry flip + unused-import removal (T5). ✓
- **Placeholder scan:** none — every code step is complete. ✓
- **Type consistency:** `TraceListItemVM` (T2) consumed by `TracesScreen` (T4); `SpanNodeVM`/`TraceDetailVM`/`SPAN_KIND_COLOR` (T3) consumed by T4; `isErrorStatus` defined in T2, imported by T3; `buildTraceDetail` pure and unit-tested in T3; `useTraces`/`useTraceSpans` mocked by module spy in T4 tests (matches the S5 `useLlm` precedent). ✓
- **jsdom pragma:** present on `useTraces.test.ts`, `useTraceSpans.test.ts`, `TracesScreen.test.tsx`. `format.test.ts` is pure (no pragma needed). registry.test.tsx already carries it. ✓
