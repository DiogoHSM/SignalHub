import type { SpanRecord, TraceRecord } from "../api/types";
import { SpanTimeline } from "./SpanTimeline";

type SpanState = "idle" | "loading" | "ready" | "empty" | "unavailable";

type Props = {
  trace?: TraceRecord;
  spans: SpanRecord[];
  spanState: SpanState;
  onRetrySpans: () => void;
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

function label(value: string | null | undefined): string {
  return value ?? "none";
}

function spanCountLabel(count: number): string {
  return count === 1 ? "1 span" : `${count} spans`;
}

function spanKind(span: SpanRecord): string {
  const name = span.name.toLowerCase();
  if (name.includes("db") || name.includes("sql") || name.includes("postgres")) return "db";
  if (name.includes("llm") || name.includes("openai") || name.includes("model")) return "llm";
  if (name.includes("http") || name.includes("get ") || name.includes("post ") || name.includes("/")) return "http";
  return "app";
}

function traceStatusTone(status: string): string {
  if (status === "success") return "success";
  if (status === "error" || status === "failed") return "failed";
  return "neutral";
}

function isErrorStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === "error" || normalized === "failed" || normalized === "failure";
}

function countBy(values: string[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts, ([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 5);
}

function longestDuration(spans: SpanRecord[]): number | null {
  const durations = spans.map((span) => span.durationMs).filter((value): value is number => value !== null);
  return durations.length > 0 ? Math.max(...durations) : null;
}

function SpanAnalysis({ spans }: { spans: SpanRecord[] }) {
  const errorCount = spans.filter((span) => isErrorStatus(span.status)).length;
  const rootCount = spans.filter((span) => span.parentSpanId === null).length;
  const operations = countBy(spans.map(spanKind));
  const statuses = countBy(spans.map((span) => span.status.toLowerCase()));

  return (
    <section aria-label="Span analysis" className="span-analysis">
      <div className="span-analysis__metrics">
        <div aria-label="Total spans">
          <span>Total spans</span>
          <strong>{spans.length}</strong>
        </div>
        <div aria-label="Error spans">
          <span>Error spans</span>
          <strong>{errorCount}</strong>
        </div>
        <div aria-label="Root spans">
          <span>Root spans</span>
          <strong>{rootCount}</strong>
        </div>
        <div aria-label="Longest span">
          <span>Longest span</span>
          <strong>{duration(longestDuration(spans))}</strong>
        </div>
      </div>
      <div className="span-analysis__breakdown">
        <div>
          <h3>Operations</h3>
          {operations.map((operation) => (
            <span key={operation.label}>
              {operation.label} <strong>{spanCountLabel(operation.count)}</strong>
            </span>
          ))}
        </div>
        <div>
          <h3>Status</h3>
          {statuses.map((status) => (
            <span key={status.label}>{status.label} {status.count}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function TraceDetailDrawer({ trace, spans, spanState, onRetrySpans }: Props) {
  if (!trace) {
    return (
      <aside className="detail-drawer">
        <p className="muted-text">Select a trace to inspect its spans.</p>
      </aside>
    );
  }

  return (
    <aside className="detail-drawer trace-detail">
      <div className="panel-header">
        <h2>{trace.name}</h2>
      </div>
      <section aria-label="Trace summary" className="trace-summary">
        <div className="trace-summary__identity">
          <span className={`status-pill status-pill--${traceStatusTone(trace.status)}`}>{trace.status}</span>
          <code>{trace.traceId ?? trace.id}</code>
        </div>
        <div className="trace-summary__metrics">
          <span>{duration(trace.durationMs)}</span>
          <span>{spanCountLabel(spans.length)}</span>
          <span>Started {formatTimestamp(trace.startedAt)}</span>
          <span>Tenant {label(trace.tenantId)}</span>
          <span>User {label(trace.userId)}</span>
          <span>Release {label(trace.release)}</span>
        </div>
      </section>
      {spanState === "ready" ? <SpanAnalysis spans={spans} /> : null}
      <section className="json-section">
        <h3>Metadata JSON</h3>
        <pre>
          <code>{formatJson(trace.metadata)}</code>
        </pre>
      </section>
      {spanState === "loading" ? <p className="muted-text">Loading spans</p> : null}
      {spanState === "empty" ? <p className="muted-text">No spans found for this trace.</p> : null}
      {spanState === "unavailable" ? (
        <div className="status-box unavailable">
          <strong>Spans unavailable</strong>
          <button onClick={onRetrySpans} type="button">
            Retry spans
          </button>
        </div>
      ) : null}
      {spanState === "ready" ? <SpanTimeline spans={spans} /> : null}
    </aside>
  );
}
