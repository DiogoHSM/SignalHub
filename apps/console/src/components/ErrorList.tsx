import type { ErrorRecord } from "../api/types";

type Props = {
  errors: ErrorRecord[];
  selectedErrorId?: string;
  onSelect: (error: ErrorRecord) => void;
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function label(value: string | null | undefined): string {
  return value ?? "none";
}

function typeLabel(error: ErrorRecord): string {
  return error.type ?? error.fingerprint ?? "none";
}

function contextLabel(error: ErrorRecord): string {
  return error.traceId ?? error.sessionId ?? "none";
}

export function ErrorList({ errors, selectedErrorId, onSelect }: Props) {
  return (
    <div className="event-list" aria-label="Errors">
      {errors.map((error) => (
        <button
          aria-pressed={error.id === selectedErrorId}
          className="event-row error-row"
          key={error.id}
          onClick={() => onSelect(error)}
          type="button"
        >
          <span>
            <strong>{error.message}</strong>
            <code>{error.id}</code>
          </span>
          <span>{error.severity}</span>
          <span>{error.status}</span>
          <span>{typeLabel(error)}</span>
          <span>{formatTimestamp(error.timestamp)}</span>
          <span>{label(error.userId)}</span>
          <span>{label(error.tenantId)}</span>
          <span>{contextLabel(error)}</span>
        </button>
      ))}
    </div>
  );
}
