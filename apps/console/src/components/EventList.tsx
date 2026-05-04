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
  return value ?? "none";
}

export function EventList({ events, selectedEventId, onSelect }: Props) {
  return (
    <div className="event-list" role="list" aria-label="Events">
      {events.map((event) => (
        <button
          aria-pressed={event.id === selectedEventId}
          className="event-row"
          key={event.id}
          onClick={() => onSelect(event)}
          type="button"
        >
          <span>
            <strong>{event.name}</strong>
            <code>{event.id}</code>
          </span>
          <span>{formatTimestamp(event.timestamp)}</span>
          <span>{label(event.userId)}</span>
          <span>{label(event.tenantId)}</span>
        </button>
      ))}
    </div>
  );
}
