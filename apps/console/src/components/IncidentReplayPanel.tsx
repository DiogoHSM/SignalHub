import type { IncidentReplay } from "../api/types";

function formatDuration(value: number | null): string {
  if (value === null) return "unknown";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function formatOffset(value: number): string {
  if (value < 1000) return `+${value} ms`;
  return `+${(value / 1000).toFixed(1)} s`;
}

function eventTitle(event: IncidentReplay["events"][number]): string {
  if (event.selector) return event.selector;
  if (event.route) return event.route;
  return event.message ?? event.type;
}

export function IncidentReplayPanel({ replay }: { replay: IncidentReplay | null }) {
  if (!replay) {
    return (
      <section className="incident-replay-panel" aria-label="Session replay">
        <h3>Replay</h3>
        <p className="muted-text">No replay linked to this error.</p>
      </section>
    );
  }

  return (
    <section className="incident-replay-panel" aria-label="Session replay">
      <div className="incident-replay-header">
        <div>
          <h3>Replay</h3>
          <p className="muted-text">{replay.route ?? "unknown route"}</p>
        </div>
        <span className="status-pill">{replay.masked ? "Masked" : "Unmasked"}</span>
      </div>
      <div className="incident-replay-meta">
        <span>ID {replay.replayId}</span>
        <span>{replay.eventCount} events</span>
        <span>{formatDuration(replay.durationMs)}</span>
      </div>
      <ol className="incident-replay-events">
        {replay.events.length === 0 ? <li className="muted-text">Replay has no timeline events.</li> : null}
        {replay.events.map((event, index) => (
          <li key={`${event.offsetMs}-${event.type}-${index}`}>
            <span className="incident-replay-offset">{formatOffset(event.offsetMs)}</span>
            <span className="incident-replay-kind">{event.type}</span>
            <span className="incident-replay-title">{eventTitle(event)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
