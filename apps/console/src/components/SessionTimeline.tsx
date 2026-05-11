import type { SessionTimelineItem, SessionTimelineResponse } from "../api/types";

type Props = {
  timeline?: SessionTimelineResponse;
  isLoading: boolean;
  error?: string | null;
  highlightedErrorId?: string;
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function itemLabel(item: SessionTimelineItem): string {
  if (item.type === "llm") return "LLM";
  return item.type.charAt(0).toUpperCase() + item.type.slice(1);
}

function levelClass(level: string | null): string {
  if (level === "error" || level === "fatal" || level === "critical") return "status-pill status-pill--failed";
  if (level === "warning") return "status-pill status-pill--degraded";
  return "status-pill status-pill--neutral";
}

export function SessionTimeline({ timeline, isLoading, error, highlightedErrorId }: Props) {
  return (
    <section className="session-timeline">
      <div className="session-timeline__header">
        <h3>Session context</h3>
      </div>
      {isLoading ? <p className="muted-text">Loading session context</p> : null}
      {error ? <p className="muted-text">{error}</p> : null}
      {!isLoading && !error && timeline && timeline.items.length === 0 ? <p className="muted-text">No session context found.</p> : null}
      {!isLoading && !error && timeline && timeline.items.length > 0 ? (
        <ol aria-label="Session context timeline" className="session-timeline__list">
          {timeline.items.map((item) => {
            const selected = item.type === "error" && item.id === highlightedErrorId;
            return (
              <li
                aria-label={selected ? "Selected error timeline item" : undefined}
                className={selected ? "session-timeline__item session-timeline__item--selected" : "session-timeline__item"}
                key={`${item.type}:${item.id}`}
              >
                <div className="session-timeline__meta">
                  <span className="session-timeline__time">{formatTimestamp(item.timestamp)}</span>
                  <span className={levelClass(item.level)}>{item.level ?? itemLabel(item)}</span>
                </div>
                <strong>{item.title}</strong>
                <p className="muted-text">
                  {itemLabel(item)}
                  {item.traceId ? ` - trace ${item.traceId}` : ""}
                </p>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
