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
