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
          <Kv k="Elapsed" v={`${Math.round(span.durMs)} ms`} mono />
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
          <SummaryStat label="LLM cost" value={`$ ${(summary?.llmCostUsd ?? 0).toFixed(4)}`} mono />
          <Divider />
          <SummaryStat label="LLM time" value={formatLatency(summary?.llmTimeMs ?? 0)} />
          <Divider />
          <SummaryStat label="DB time" value={formatLatency(summary?.dbTimeMs ?? 0)} />
          <Divider />
          <SummaryStat label="Error count" value={String(errorCount)} tone={errorCount > 0 ? "danger" : undefined} />
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
