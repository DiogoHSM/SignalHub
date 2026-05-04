import type { TraceRecord } from "../api/types";

type Props = {
  traces: TraceRecord[];
  selectedTraceId?: string;
  onSelect: (trace: TraceRecord) => void;
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function duration(value: number | null): string {
  return value === null ? "none" : `${value} ms`;
}

function label(value: string | null): string {
  return value ?? "none";
}

export function TraceList({ traces, selectedTraceId, onSelect }: Props) {
  return (
    <div className="event-list" aria-label="Traces">
      {traces.map((trace) => (
        <button
          aria-pressed={trace.id === selectedTraceId}
          className="event-row trace-row"
          key={trace.id}
          onClick={() => onSelect(trace)}
          type="button"
        >
          <span>
            <strong>{trace.name}</strong>
            <code>{trace.traceId ?? trace.id}</code>
          </span>
          <span>{trace.status}</span>
          <span>{duration(trace.durationMs)}</span>
          <span>{formatTimestamp(trace.startedAt)}</span>
          <span>{label(trace.userId)}</span>
          <span>{label(trace.tenantId)}</span>
        </button>
      ))}
    </div>
  );
}
