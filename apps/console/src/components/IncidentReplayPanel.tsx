import type { IncidentReplay } from "../api/types";

type ReplayBreadcrumb = {
  kind: string;
  timeRelative: string;
  title: string;
};

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

function productEventLabel(event: NonNullable<IncidentReplay["productEvents"]>[number]): string {
  return `Product event: ${event.name}`;
}

function errorOffsetMs(replay: IncidentReplay, errorTimestamp?: string | null): number | null {
  if (!errorTimestamp) return null;
  const startedAt = new Date(replay.startedAt).getTime();
  const errorAt = new Date(errorTimestamp).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(errorAt)) return null;
  return Math.max(0, errorAt - startedAt);
}

export function IncidentReplayPanel({
  breadcrumbs = [],
  errorTimestamp,
  replay,
  stack
}: {
  breadcrumbs?: ReplayBreadcrumb[];
  errorTimestamp?: string | null;
  replay: IncidentReplay | null;
  stack?: string | null;
}) {
  if (!replay) {
    return (
      <section className="incident-replay-panel" aria-label="Session replay">
        <h3>Replay</h3>
        <p className="muted-text">No replay linked to this error.</p>
      </section>
    );
  }

  const errorOffset = errorOffsetMs(replay, errorTimestamp);
  const timeline = [
    ...replay.events.map((event, index) => ({
      key: `replay-${event.offsetMs}-${event.type}-${index}`,
      offsetMs: event.offsetMs,
      kind: event.type,
      title: eventTitle(event)
    })),
    ...(replay.productEvents ?? []).map((event) => ({
      key: `product-${event.id}`,
      offsetMs: event.offsetMs,
      kind: "product",
      title: productEventLabel(event)
    })),
    ...(errorOffset == null
      ? []
      : [
          {
            key: "error-moment",
            offsetMs: errorOffset,
            kind: "error moment",
            title: stack?.split("\n")[0] ?? "Error occurred"
          }
        ])
  ].sort((left, right) => left.offsetMs - right.offsetMs || left.key.localeCompare(right.key));

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
        {errorOffset != null ? <span>Error moment {formatOffset(errorOffset)}</span> : null}
      </div>
      <ol className="incident-replay-events">
        {timeline.length === 0 ? (
          <li className="muted-text">Replay has no timeline events.</li>
        ) : null}
        {timeline.map((event) => (
            <li className={event.key === "error-moment" ? "incident-replay-events__error" : undefined} key={event.key}>
              <span className="incident-replay-offset">{formatOffset(event.offsetMs)}</span>
              <span className="incident-replay-kind">{event.kind}</span>
              <span className="incident-replay-title">{event.title}</span>
            </li>
          ))}
      </ol>
      {(stack || breadcrumbs.length > 0) ? (
        <div className="incident-replay-context">
          {stack ? (
            <div>
              <h4>Stack at error</h4>
              <code>{stack.split("\n")[0]}</code>
            </div>
          ) : null}
          {breadcrumbs.length > 0 ? (
            <div>
              <h4>Breadcrumbs before error</h4>
              <ul>
                {breadcrumbs.slice(-5).map((breadcrumb, index) => (
                  <li key={`${breadcrumb.kind}-${breadcrumb.title}-${index}`}>
                    <span>{breadcrumb.kind}</span>
                    <strong>{breadcrumb.title}</strong>
                    <small>{breadcrumb.timeRelative}</small>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
