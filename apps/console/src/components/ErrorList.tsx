import type { ErrorRecord } from "../api/types";

type Props = {
  errors: ErrorRecord[];
  selectedErrorId?: string;
  onSelect: (error: ErrorRecord) => void;
  onOpenIncident?: (groupId: string, options: { errorId: string }) => void;
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

export function ErrorList({ errors, selectedErrorId, onOpenIncident, onSelect }: Props) {
  return (
    <div className="event-list" aria-label="Errors">
      {errors.map((error) => {
        const groupId = error.errorGroupId;
        return (
          <div
            className="event-row error-row"
            data-selected={error.id === selectedErrorId ? "true" : undefined}
            key={error.id}
          >
            <button
              aria-pressed={error.id === selectedErrorId}
              className="event-row-select"
              onClick={() => onSelect(error)}
              type="button"
            >
              <strong>{error.message}</strong>
              <code>{error.id}</code>
              <span>{error.severity}</span>
              <span>{error.status}</span>
              <span>{typeLabel(error)}</span>
              <span>{formatTimestamp(error.timestamp)}</span>
              <span>{label(groupId)}</span>
              <span>{label(error.userId)}</span>
              <span>{label(error.tenantId)}</span>
              <span>{contextLabel(error)}</span>
            </button>
            {onOpenIncident && groupId ? (
              <button className="event-row-action" onClick={() => onOpenIncident(groupId, { errorId: error.id })} type="button">
                Open incident
              </button>
            ) : (
              <span />
            )}
          </div>
        );
      })}
    </div>
  );
}
