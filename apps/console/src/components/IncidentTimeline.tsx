import type { ErrorGroupIncident, IncidentTimelineItem } from "../api/types";

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function formatValue(value: string | null): string {
  return value ?? "none";
}

function TimelineRows({ emptyCopy, items }: { emptyCopy: string; items: IncidentTimelineItem[] }) {
  if (items.length === 0) return <p className="muted-text">{emptyCopy}</p>;

  return (
    <ol className="incident-timeline-list">
      {items.map((item) => (
        <li className="incident-timeline-row" key={item.id}>
          <time dateTime={item.timestamp}>{formatTime(item.timestamp)}</time>
          <span>{item.kind}</span>
          <strong>{item.title}</strong>
          {item.level ? <span>{item.level}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function IncidentTimeline({ incident }: { incident: ErrorGroupIncident }) {
  return (
    <section className="incident-timeline" aria-label="Incident timeline">
      <section className="incident-related-card" aria-label="Related incident context">
        <h3>Related</h3>
        <div className="incident-detail-grid">
          <span>Trace {formatValue(incident.related.traceId)}</span>
          <span>Session {formatValue(incident.related.sessionId)}</span>
          <span>User {formatValue(incident.related.userId)}</span>
          <span>Tenant {formatValue(incident.related.tenantId)}</span>
        </div>
      </section>
      <section aria-label="Strongly related timeline">
        <h3>Strongly related</h3>
        <TimelineRows emptyCopy="No strongly related activity found." items={incident.stronglyRelated.items} />
      </section>
      <section aria-label="Nearby context timeline">
        <h3>Nearby context</h3>
        <p className="muted-text">Supporting context around the primary occurrence.</p>
        <TimelineRows emptyCopy="No nearby context found." items={incident.nearbyContext.items} />
      </section>
    </section>
  );
}
