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

function traceStatusTone(status: string): string {
  if (status === "success") return "success";
  if (status === "error" || status === "failed") return "failed";
  return "neutral";
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
