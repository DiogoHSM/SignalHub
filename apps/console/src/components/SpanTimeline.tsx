import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { SpanRecord } from "../api/types";

type Props = {
  spans: SpanRecord[];
};

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function duration(value: number | null): string {
  return value === null ? "none" : `${value} ms`;
}

function ordered(spans: SpanRecord[]): SpanRecord[] {
  return [...spans].sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime());
}

function label(value: string | null | undefined): string {
  return value ?? "none";
}

function money(value: string | null): string {
  return value === null ? "none" : `$${value}`;
}

function spanKind(span: SpanRecord): string {
  const name = span.name.toLowerCase();
  if (name.includes("db") || name.includes("sql") || name.includes("postgres")) return "db";
  if (name.includes("llm") || name.includes("openai") || name.includes("model")) return "llm";
  if (name.includes("http") || name.includes("get ") || name.includes("post ") || name.includes("/")) return "http";
  return "app";
}

function statusTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "success" || normalized === "ok") return "success";
  if (normalized === "error" || normalized === "failed" || normalized === "failure") return "failed";
  if (normalized === "pending" || normalized === "running") return "warning";
  return "neutral";
}

function timelineBounds(spans: SpanRecord[]) {
  const starts = spans.map((span) => new Date(span.startedAt).getTime()).filter(Number.isFinite);
  const minStart = starts.length > 0 ? Math.min(...starts) : 0;
  const maxEnd = spans.reduce((current, span) => {
    const start = new Date(span.startedAt).getTime();
    const durationMs = span.durationMs ?? 0;
    const end = Number.isFinite(start) ? start + Math.max(durationMs, 0) : current;
    return Math.max(current, end);
  }, minStart);
  return { minStart, total: Math.max(maxEnd - minStart, 1) };
}

function waterfallStyle(span: SpanRecord, minStart: number, total: number): CSSProperties {
  const start = new Date(span.startedAt).getTime();
  const durationMs = Math.max(span.durationMs ?? 0, 1);
  const offset = Number.isFinite(start) ? ((start - minStart) / total) * 100 : 0;
  const width = Math.max((durationMs / total) * 100, 4);
  return {
    "--span-offset": `${Math.min(Math.max(offset, 0), 96)}%`,
    "--span-width": `${Math.min(width, 100)}%`
  } as CSSProperties;
}

export function SpanTimeline({ spans }: Props) {
  const orderedSpans = useMemo(() => ordered(spans), [spans]);
  const { minStart, total } = useMemo(() => timelineBounds(orderedSpans), [orderedSpans]);
  const [selectedSpanId, setSelectedSpanId] = useState<string | undefined>(orderedSpans[0]?.id);
  const selectedSpan = orderedSpans.find((span) => span.id === selectedSpanId) ?? orderedSpans[0];

  useEffect(() => {
    setSelectedSpanId(orderedSpans[0]?.id);
  }, [orderedSpans]);

  if (!selectedSpan) return null;

  return (
    <section className="span-waterfall-shell">
      <section aria-label="Trace waterfall" className="span-waterfall">
        <div className="span-waterfall__header">
          <h3>Waterfall</h3>
          <span>{orderedSpans.length} spans</span>
        </div>
        <div className="span-waterfall__rows">
          {orderedSpans.map((span) => (
            <button
              aria-pressed={span.id === selectedSpan.id}
              className={`span-waterfall__row span-waterfall__row--${statusTone(span.status)} span-waterfall__row--${spanKind(
                span
              )}`}
              key={span.id}
              onClick={() => setSelectedSpanId(span.id)}
              style={waterfallStyle(span, minStart, total)}
              type="button"
            >
              <span className="span-waterfall__name">
                <strong>{span.name}</strong>
                <small>{spanKind(span)}</small>
              </span>
              <span className="span-waterfall__bar" aria-hidden="true" />
              <span className="span-waterfall__meta">
                <span>{duration(span.durationMs)}</span>
                <span className={`status-pill status-pill--${statusTone(span.status)}`}>{span.status}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
      <section aria-label="Selected span details" className="span-detail-panel">
        <div className="span-detail-panel__header">
          <h3>{selectedSpan.name}</h3>
          <span className={`status-pill status-pill--${statusTone(selectedSpan.status)}`}>{selectedSpan.status}</span>
        </div>
        <div className="span-detail-panel__chips">
          <span>ID {selectedSpan.id}</span>
          <span>Parent {label(selectedSpan.parentSpanId)}</span>
          <span>Started {formatTimestamp(selectedSpan.startedAt)}</span>
          <span>Duration {duration(selectedSpan.durationMs)}</span>
          <span>Cost {money(selectedSpan.costUsd)}</span>
        </div>
        <section className="json-section">
          <h4>Input JSON</h4>
          <pre>
            <code>{formatJson(selectedSpan.input)}</code>
          </pre>
        </section>
        <section className="json-section">
          <h4>Output JSON</h4>
          <pre>
            <code>{formatJson(selectedSpan.output)}</code>
          </pre>
        </section>
        <section className="json-section">
          <h4>Error JSON</h4>
          <pre>
            <code>{formatJson(selectedSpan.error)}</code>
          </pre>
        </section>
        <section className="json-section">
          <h4>Metadata JSON</h4>
          <pre>
            <code>{formatJson(selectedSpan.metadata)}</code>
          </pre>
        </section>
      </section>
    </section>
  );
}
