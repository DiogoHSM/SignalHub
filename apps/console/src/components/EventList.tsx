import type { EventRecord } from "../api/types";

type Props = {
  events: EventRecord[];
  selectedEventId?: string;
  onSelect: (event: EventRecord) => void;
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function label(value: string | null): string {
  return value ?? "anonymous";
}

function contextLabel(event: EventRecord): string {
  return event.traceId ?? event.sessionId ?? "none";
}

function propertySummary(properties: unknown): string[] {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];

  return Object.entries(properties as Record<string, unknown>)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);
}

export function EventList({ events, selectedEventId, onSelect }: Props) {
  return (
    <div className="event-list" aria-label="Events">
      {events.map((event) => (
        <button
          aria-pressed={event.id === selectedEventId}
          className="event-row"
          key={event.id}
          onClick={() => onSelect(event)}
          type="button"
        >
          <span className="event-row__identity">
            <strong>{event.name}</strong>
            <code>{event.id}</code>
          </span>
          <span className="event-row__time">{formatTimestamp(event.timestamp)}</span>
          <span className="event-row__meta">
            <small>Source</small>
            {event.source ?? "unknown"}
          </span>
          <span className="event-row__meta">
            <small>User</small>
            {label(event.userId)}
          </span>
          <span className="event-row__meta">
            <small>Tenant</small>
            {event.tenantId ?? "none"}
          </span>
          <span className="event-row__meta">
            <small>Context</small>
            {contextLabel(event)}
          </span>
          <span className="event-row__properties">
            {propertySummary(event.properties).map((property) => (
              <span key={property}>{property}</span>
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}
