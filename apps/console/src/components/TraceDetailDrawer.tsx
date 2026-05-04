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

function detailValue(value: string | null | undefined): string {
  return value ?? "none";
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function duration(value: number | null): string {
  return value === null ? "none" : `${value} ms`;
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
    <aside className="detail-drawer">
      <div className="panel-header">
        <h2>{trace.name}</h2>
      </div>
      <dl className="detail-grid">
        <dt>ID</dt>
        <dd>
          <code>{trace.id}</code>
        </dd>
        <dt>Trace</dt>
        <dd>{detailValue(trace.traceId)}</dd>
        <dt>Project</dt>
        <dd>{trace.projectId}</dd>
        <dt>Environment</dt>
        <dd>{trace.environmentId}</dd>
        <dt>Status</dt>
        <dd>{trace.status}</dd>
        <dt>Duration</dt>
        <dd>{duration(trace.durationMs)}</dd>
        <dt>Started</dt>
        <dd>{formatTimestamp(trace.startedAt)}</dd>
        <dt>Ended</dt>
        <dd>{trace.endedAt ? formatTimestamp(trace.endedAt) : "none"}</dd>
        <dt>Tenant</dt>
        <dd>{detailValue(trace.tenantId)}</dd>
        <dt>User</dt>
        <dd>{detailValue(trace.userId)}</dd>
        <dt>Session</dt>
        <dd>{detailValue(trace.sessionId)}</dd>
        <dt>Source</dt>
        <dd>{detailValue(trace.source)}</dd>
        <dt>Release</dt>
        <dd>{detailValue(trace.release)}</dd>
      </dl>
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
