import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ApiClient } from "../api/client";
import type {
  AnalyticsSegment,
  AnalyticsSegmentActorType,
  AnalyticsSegmentPreview,
  EventClickMapResponse,
  EventFunnelResponse,
  EventPathActorType,
  EventPathsResponse,
  EventPropertyCatalogResponse,
  EventRecord,
  EventRetentionResponse,
  QueryFilters
} from "../api/types";
import { EventDetailDrawer } from "./EventDetailDrawer";
import { EventFilters, type EventFilterValues } from "./EventFilters";
import { EventList } from "./EventList";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
  initialFilters?: Partial<EventFilterValues>;
};

type LoadState = "loading" | "ready" | "empty" | "unavailable";
type CatalogState = "loading" | "ready" | "empty" | "unavailable";
type FunnelState = "idle" | "loading" | "ready" | "invalid" | "unavailable";
type PathState = "idle" | "loading" | "ready" | "invalid" | "unavailable";
type RetentionState = "idle" | "loading" | "ready" | "invalid" | "unavailable";
type ClickMapState = "idle" | "loading" | "ready" | "invalid" | "unavailable";
type SegmentState = "loading" | "ready" | "unavailable";

const defaultFilters: EventFilterValues = {
  eventName: "",
  tenantId: "",
  userId: "",
  sessionId: "",
  traceId: "",
  from: "",
  to: "",
  limit: "50"
};

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(500, Math.max(1, Math.trunc(parsed)));
}

function queryFromValues(projectId: string, environmentId: string, values: EventFilterValues, segmentId?: string): QueryFilters {
  const query: QueryFilters = {
    projectId,
    environmentId,
    limit: toLimit(values.limit)
  };

  const eventName = values.eventName.trim();
  const tenantId = values.tenantId.trim();
  const userId = values.userId.trim();
  const sessionId = values.sessionId.trim();
  const traceId = values.traceId.trim();
  const from = toIso(values.from);
  const to = toIso(values.to);

  if (eventName) query.eventName = eventName;
  if (tenantId) query.tenantId = tenantId;
  if (userId) query.userId = userId;
  if (sessionId) query.sessionId = sessionId;
  if (traceId) query.traceId = traceId;
  if (from) query.from = from;
  if (to) query.to = to;
  if (segmentId) query.segmentId = segmentId;

  return query;
}

function filtersWithDefaults(initialFilters?: Partial<EventFilterValues>): EventFilterValues {
  return { ...defaultFilters, ...initialFilters };
}

function countKnown(values: Array<string | null>): number {
  return new Set(values.filter((value): value is string => Boolean(value))).size;
}

function topEvents(events: EventRecord[]): Array<{ name: string; count: number; percent: number }> {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.name, (counts.get(event.name) ?? 0) + 1);
  }

  return Array.from(counts, ([name, count]) => ({
    name,
    count,
    percent: events.length === 0 ? 0 : Math.round((count / events.length) * 100)
  }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 5);
}

function EventAnalyticsSummary({ events }: { events: EventRecord[] }) {
  const names = countKnown(events.map((event) => event.name));
  const tenants = countKnown(events.map((event) => event.tenantId));
  const users = countKnown(events.map((event) => event.userId));
  const top = topEvents(events);

  return (
    <div className="event-analytics">
      <section aria-label="Event analytics summary" className="event-analytics__summary">
        <div aria-label="Total events">
          <span>Total events</span>
          <strong>{events.length}</strong>
        </div>
        <div aria-label="Unique event names">
          <span>Event names</span>
          <strong>{names}</strong>
        </div>
        <div aria-label="Tenants observed">
          <span>Tenants</span>
          <strong>{tenants}</strong>
        </div>
        <div aria-label="Known users">
          <span>Known users</span>
          <strong>{users}</strong>
        </div>
      </section>
      <section aria-label="Top event names" className="event-analytics__top">
        <div className="event-analytics__top-header">
          <h3>Top event names</h3>
          <span>{top.length} tracked</span>
        </div>
        <div className="event-analytics__top-list">
          {top.map((item) => (
            <div key={item.name}>
              <span>{item.name}</span>
              <strong>{item.count} {item.count === 1 ? "event" : "events"}</strong>
              <small>{item.percent}% of current results</small>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatTypeCounts(typeCounts: Record<string, number>): string {
  return Object.entries(typeCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([type, count]) => `${type} ${count}`)
    .join(" / ");
}

function EventPropertyGovernance({
  catalog,
  state
}: {
  catalog: EventPropertyCatalogResponse | null;
  state: CatalogState;
}) {
  if (state === "loading") {
    return <p className="muted-text">Loading event property governance</p>;
  }
  if (state === "unavailable") {
    return <p className="muted-text">Event property governance unavailable</p>;
  }
  if (state === "empty" || !catalog) {
    return (
      <section aria-label="Event property governance" className="event-property-governance">
        <div className="event-property-governance__header">
          <div>
            <h3>Property governance</h3>
            <p>No event properties observed in this window.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Event property governance" className="event-property-governance">
      <div className="event-property-governance__header">
        <div>
          <h3>Property governance</h3>
          <p>Observed custom event properties over the last {catalog.window}.</p>
        </div>
        <div className="event-property-governance__stats">
          <span>
            Properties<strong>{catalog.totals.properties}</strong>
          </span>
          <span>
            Type conflicts<strong>{catalog.totals.conflictProperties}</strong>
          </span>
          <span>
            Similar names<strong>{catalog.totals.similarNameGroups}</strong>
          </span>
        </div>
      </div>
      <div className="event-property-governance__rows">
        {catalog.properties.slice(0, 8).map((property) => (
          <div className="event-property-governance__row" key={`${property.eventName}:${property.propertyName}`}>
            <div>
              <strong>{property.propertyName}</strong>
              <small>{property.eventName}</small>
            </div>
            <div>
              <span>{formatTypeCounts(property.typeCounts) || property.dominantType}</span>
              {property.hasTypeConflict ? <em>Type conflict</em> : null}
            </div>
            <div>
              <span>{property.coveragePercent}% coverage</span>
              <small>
                {property.totalOccurrences}/{property.eventCount} events
              </small>
            </div>
            <div>
              {property.sampleValues.length > 0 ? <code>{property.sampleValues.join(", ")}</code> : <span>No samples</span>}
              {property.similarPropertyNames.length > 0 ? <small>Similar: {property.similarPropertyNames.join(", ")}</small> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function parseFunnelSteps(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((step) => step.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function EventClickMapPanel({
  clickMap,
  route,
  selector,
  state,
  onRouteChange,
  onRun,
  onSelectorChange
}: {
  clickMap: EventClickMapResponse | null;
  route: string;
  selector: string;
  state: ClickMapState;
  onRouteChange: (value: string) => void;
  onRun: () => void;
  onSelectorChange: (value: string) => void;
}) {
  const gridSize = clickMap?.filters.gridSize ?? 20;
  const maxClicks = Math.max(1, ...((clickMap?.points ?? []).map((point) => point.clicks)));

  return (
    <section aria-label="Click map" className="event-click-map">
      <div className="event-click-map__header">
        <div>
          <h3>Click map</h3>
          <p>Opt-in browser clicks by route. Sigmon stores normalized coordinates and safe selectors, not text, values, DOM, or screenshots.</p>
        </div>
        {clickMap ? (
          <div className="event-click-map__score">
            <span>Clicks</span>
            <strong>{clickMap.totals.clicks}</strong>
            <small>{clickMap.totals.selectors} selectors</small>
          </div>
        ) : null}
      </div>
      <div className="event-click-map__builder">
        <label>
          Route
          <input value={route} onChange={(event) => onRouteChange(event.target.value)} placeholder="/checkout" />
        </label>
        <label>
          Selector
          <input value={selector} onChange={(event) => onSelectorChange(event.target.value)} placeholder="Optional selector" />
        </label>
        <button disabled={state === "loading"} onClick={onRun} type="button">
          {state === "loading" ? "Loading" : "Load click map"}
        </button>
      </div>
      {state === "invalid" ? <p className="event-click-map__notice">Add a route to load the click map.</p> : null}
      {state === "unavailable" ? <p className="event-click-map__notice">Click map unavailable.</p> : null}
      {state === "ready" && clickMap ? (
        <div className="event-click-map__content">
          <svg className="event-click-map__grid" role="img" aria-label={`Click density for ${clickMap.filters.route}`} viewBox="0 0 100 100">
            <rect className="event-click-map__frame" x="0" y="0" width="100" height="100" rx="2" />
            {clickMap.points.map((point) => {
              const size = 100 / gridSize;
              const opacity = Math.max(0.18, point.clicks / maxClicks);
              return (
                <rect
                  className="event-click-map__cell"
                  key={`${point.xBucket}:${point.yBucket}`}
                  x={point.xBucket * size}
                  y={point.yBucket * size}
                  width={size}
                  height={size}
                  style={{ "--click-strength": String(opacity) } as CSSProperties}
                />
              );
            })}
          </svg>
          <div className="event-click-map__lists">
            <div>
              <h4>Top selectors</h4>
              {clickMap.selectors.length === 0 ? <p>No selectors in this route.</p> : null}
              {clickMap.selectors.slice(0, 8).map((item) => (
                <button key={item.selector} onClick={() => onSelectorChange(item.selector)} type="button">
                  <span>{item.selector}</span>
                  <strong>{item.clicks}</strong>
                </button>
              ))}
            </div>
            <div>
              <h4>Routes</h4>
              {clickMap.routes.slice(0, 8).map((item) => (
                <button key={item.route} onClick={() => onRouteChange(item.route)} type="button">
                  <span>{item.route}</span>
                  <strong>{item.clicks}</strong>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function EventFunnelPanel({
  value,
  onChange,
  onRun,
  state,
  funnel
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  state: FunnelState;
  funnel: EventFunnelResponse | null;
}) {
  return (
    <section aria-label="Conversion funnel" className="event-funnel">
      <div className="event-funnel__header">
        <div>
          <h3>Conversion funnel</h3>
          <p>Enter 2+ event names in order. Sigmon counts actors that reached each step in the selected environment.</p>
        </div>
        {funnel ? (
          <div className="event-funnel__score">
            <span>Conversion</span>
            <strong>{funnel.totals.conversionPercent}%</strong>
            <small>
              {funnel.totals.completed}/{funnel.totals.entrants} completed
            </small>
          </div>
        ) : null}
      </div>
      <div className="event-funnel__builder">
        <label>
          Funnel steps
          <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} />
        </label>
        <button disabled={state === "loading"} onClick={onRun} type="button">
          {state === "loading" ? "Running" : "Run funnel"}
        </button>
      </div>
      {state === "invalid" ? <p className="event-funnel__notice">Add at least two event steps.</p> : null}
      {state === "unavailable" ? <p className="event-funnel__notice">Conversion funnel unavailable.</p> : null}
      {state === "ready" && funnel ? (
        <div className="event-funnel__steps">
          {funnel.steps.map((step) => (
            <div className="event-funnel__step" key={`${step.index}:${step.name}`}>
              <div>
                <span>Step {step.index + 1}</span>
                <strong>{step.name}</strong>
              </div>
              <div>
                <strong>{step.actors}</strong>
                <span>actors</span>
              </div>
              <div>
                <strong>{step.conversionPercent}%</strong>
                <span>conversion</span>
              </div>
              <div>
                <strong>Drop-off {step.dropOffFromPreviousPercent}%</strong>
                <span>from previous</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function EventPathfinderPanel({
  actorType,
  endEvent,
  onActorTypeChange,
  onDrilldownEvent,
  onEndEventChange,
  onPathLengthChange,
  onRun,
  onStartEventChange,
  pathLength,
  paths,
  startEvent,
  state
}: {
  actorType: EventPathActorType;
  endEvent: string;
  onActorTypeChange: (value: EventPathActorType) => void;
  onDrilldownEvent: (eventId: string) => void;
  onEndEventChange: (value: string) => void;
  onPathLengthChange: (value: string) => void;
  onRun: () => void;
  pathLength: string;
  paths: EventPathsResponse | null;
  startEvent: string;
  onStartEventChange: (value: string) => void;
  state: PathState;
}) {
  return (
    <section aria-label="User journey paths" className="event-pathfinder">
      <div className="event-pathfinder__header">
        <div>
          <h3>User journey paths</h3>
          <p>Find the most common event sequences for the current filters. Click a sample event to inspect it.</p>
        </div>
        {paths ? (
          <div className="event-pathfinder__score">
            <span>Paths</span>
            <strong>{paths.totals.paths}</strong>
            <small>{paths.totals.actors} actors</small>
          </div>
        ) : null}
      </div>
      <div className="event-pathfinder__builder">
        <label>
          Start event
          <input value={startEvent} onChange={(event) => onStartEventChange(event.target.value)} placeholder="signup.started" />
        </label>
        <label>
          End event
          <input value={endEvent} onChange={(event) => onEndEventChange(event.target.value)} placeholder="checkout.completed" />
        </label>
        <label>
          Actor
          <select value={actorType} onChange={(event) => onActorTypeChange(event.target.value as EventPathActorType)}>
            <option value="auto">Auto</option>
            <option value="user">User</option>
            <option value="tenant">Tenant</option>
            <option value="session">Session</option>
            <option value="trace">Trace</option>
          </select>
        </label>
        <label>
          Max depth
          <input min={2} max={8} type="number" value={pathLength} onChange={(event) => onPathLengthChange(event.target.value)} />
        </label>
        <button disabled={state === "loading"} onClick={onRun} type="button">
          {state === "loading" ? "Running" : "Find paths"}
        </button>
      </div>
      {state === "invalid" ? <p className="event-pathfinder__notice">Add a start event or an end event.</p> : null}
      {state === "unavailable" ? <p className="event-pathfinder__notice">Pathfinder unavailable.</p> : null}
      {state === "ready" && paths && paths.paths.length === 0 ? (
        <p className="event-pathfinder__notice">No paths matched the current filters.</p>
      ) : null}
      {state === "ready" && paths && paths.paths.length > 0 ? (
        <div className="event-pathfinder__paths">
          {paths.paths.map((path, index) => (
            <div className="event-pathfinder__path" key={`${index}:${path.path.join(">")}`}>
              <div className="event-pathfinder__path-main">
                <strong>{path.path.join(" -> ")}</strong>
                <span>
                  {path.actors} actors · {path.occurrences} occurrences · Last {new Date(path.lastSeenAt).toLocaleString()}
                </span>
              </div>
              <div className="event-pathfinder__samples" aria-label={`Sample events for ${path.path.join(" to ")}`}>
                {path.sampleEvents.map((event) => (
                  <button key={event.id} onClick={() => onDrilldownEvent(event.id)} type="button">
                    {event.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function EventRetentionPanel({
  entryEvent,
  onEntryEventChange,
  onReturnEventChange,
  onRun,
  retention,
  returnEvent,
  state
}: {
  entryEvent: string;
  onEntryEventChange: (value: string) => void;
  onReturnEventChange: (value: string) => void;
  onRun: () => void;
  retention: EventRetentionResponse | null;
  returnEvent: string;
  state: RetentionState;
}) {
  const intervalLabels = retention?.cohorts[0]?.intervals.map((interval) => interval.label) ?? [];

  return (
    <section aria-label="Retention curves" className="event-retention">
      <div className="event-retention__header">
        <div>
          <h3>Retention curves</h3>
          <p>Measure actors who enter on one event and return on another event over time.</p>
        </div>
        {retention ? (
          <div className="event-retention__score">
            <span>Cohorts</span>
            <strong>{retention.totals.cohorts}</strong>
            <small>{retention.totals.entrants} entrants</small>
          </div>
        ) : null}
      </div>
      <div className="event-retention__builder">
        <label>
          Entry event
          <input value={entryEvent} onChange={(event) => onEntryEventChange(event.target.value)} placeholder="signup.started" />
        </label>
        <label>
          Return event
          <input value={returnEvent} onChange={(event) => onReturnEventChange(event.target.value)} placeholder="app.opened" />
        </label>
        <button disabled={state === "loading"} onClick={onRun} type="button">
          {state === "loading" ? "Running" : "Run retention"}
        </button>
      </div>
      {state === "invalid" ? <p className="event-retention__notice">Add entry and return event names.</p> : null}
      {state === "unavailable" ? <p className="event-retention__notice">Retention curves unavailable.</p> : null}
      {state === "ready" && retention ? (
        <div className="event-retention__matrix">
          <div className="event-retention__row event-retention__row--header">
            <span>Cohort</span>
            <span>Entrants</span>
            {intervalLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          {retention.cohorts.length === 0 ? (
            <p className="event-retention__notice">No cohorts found for this window.</p>
          ) : (
            retention.cohorts.map((cohort) => (
              <div className="event-retention__row" key={cohort.cohortStart}>
                <strong>{cohort.cohortLabel}</strong>
                <span>{cohort.entrants}</span>
                {cohort.intervals.map((interval) => (
                  <span
                    className="event-retention__cell"
                    key={`${cohort.cohortStart}:${interval.index}`}
                    style={{ "--retention-strength": `${Math.max(0.08, interval.retentionPercent / 100)}` } as CSSProperties}
                  >
                    <strong>{interval.retentionPercent}%</strong>
                    <small>{interval.retainedActors}</small>
                  </span>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

function SegmentManager({
  activeSegmentId,
  client,
  environmentId,
  onSelectSegment,
  projectId,
  reloadToken
}: {
  activeSegmentId?: string;
  client: ApiClient;
  environmentId: string;
  onSelectSegment: (segmentId: string | undefined) => void;
  projectId: string;
  reloadToken: number;
}) {
  const [segments, setSegments] = useState<AnalyticsSegment[]>([]);
  const [previews, setPreviews] = useState<Record<string, AnalyticsSegmentPreview>>({});
  const [state, setState] = useState<SegmentState>("loading");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [actorType, setActorType] = useState<AnalyticsSegmentActorType>("user");
  const [eventName, setEventName] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [propertyValue, setPropertyValue] = useState("");
  const [window, setWindow] = useState<"24h" | "7d" | "30d">("30d");
  const [error, setError] = useState<string | null>(null);
  const [localReloadToken, setLocalReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!client.listAnalyticsSegments) {
      setState("unavailable");
      return;
    }
    setState("loading");
    void client
      .listAnalyticsSegments({ projectId, environmentId })
      .then(
        ({ segments }) => {
          if (cancelled) return;
          setSegments(segments);
          setState("ready");
        },
        () => {
          if (cancelled) return;
          setSegments([]);
          setState("unavailable");
        }
      );
    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId, reloadToken, localReloadToken]);

  useEffect(() => {
    if (!client.previewAnalyticsSegment || segments.length === 0) {
      return;
    }
    let cancelled = false;
    void Promise.all(
      segments.map((segment) =>
        client
          .previewAnalyticsSegment!(segment.id, { projectId, environmentId, limit: 3 })
          .then(({ preview }) => [segment.id, preview] as const)
          .catch(() => undefined)
      )
    ).then((entries) => {
      if (cancelled) return;
      setPreviews(Object.fromEntries(entries.filter((entry): entry is readonly [string, AnalyticsSegmentPreview] => Boolean(entry))));
    });
    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId, segments]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setActorType("user");
    setEventName("");
    setPropertyName("");
    setPropertyValue("");
    setWindow("30d");
    setError(null);
  }

  function editSegment(segment: AnalyticsSegment) {
    setEditingId(segment.id);
    setName(segment.name);
    setActorType(segment.actorType);
    setEventName(segment.definition.eventName ?? "");
    setPropertyName(segment.definition.propertyName ?? "");
    setPropertyValue(segment.definition.propertyValue ?? "");
    setWindow(segment.definition.window ?? "30d");
    setError(null);
  }

  async function saveSegment() {
    const trimmedName = name.trim();
    const trimmedEvent = eventName.trim();
    const trimmedProperty = propertyName.trim();
    const trimmedValue = propertyValue.trim();
    if (!trimmedName || (!trimmedEvent && !trimmedProperty)) {
      setError("Name and at least one event or property condition are required.");
      return;
    }
    const input = {
      name: trimmedName,
      actorType,
      definition: {
        window,
        ...(trimmedEvent ? { eventName: trimmedEvent } : {}),
        ...(trimmedProperty ? { propertyName: trimmedProperty } : {}),
        ...(trimmedValue ? { propertyValue: trimmedValue } : {})
      }
    };
    try {
      if (editingId) {
        await client.updateAnalyticsSegment?.(editingId, input);
      } else {
        await client.createAnalyticsSegment?.({ projectId, environmentId, ...input });
      }
      resetForm();
      setLocalReloadToken((current) => current + 1);
    } catch {
      setError("Could not save segment.");
    }
  }

  async function archiveSegment(segment: AnalyticsSegment) {
    try {
      await client.archiveAnalyticsSegment?.(segment.id);
      if (activeSegmentId === segment.id) {
        onSelectSegment(undefined);
      }
      setLocalReloadToken((current) => current + 1);
    } catch {
      setError("Could not archive segment.");
    }
  }

  if (state === "unavailable") {
    return <p className="muted-text">Saved segments unavailable</p>;
  }

  return (
    <section aria-label="Saved segments" className="event-segments">
      <div className="event-segments__header">
        <div>
          <h3>Saved segments</h3>
          <p>Reuse event/property cohorts as filters for this project environment.</p>
        </div>
        {activeSegmentId ? (
          <button onClick={() => onSelectSegment(undefined)} type="button">
            Clear segment filter
          </button>
        ) : null}
      </div>
      {state === "loading" ? <p className="muted-text">Loading saved segments</p> : null}
      <div className="event-segments__grid">
        <div className="event-segments__list">
          {segments.length === 0 && state === "ready" ? <p className="muted-text">No saved segments yet.</p> : null}
          {segments.map((segment) => {
            const preview = previews[segment.id];
            return (
              <div className={segment.id === activeSegmentId ? "event-segments__item is-active" : "event-segments__item"} key={segment.id}>
                <div>
                  <strong>{segment.name}</strong>
                  <small>
                    {segment.actorType}s · {segment.definition.window ?? "30d"} · {segment.definition.eventName ?? "any event"}
                  </small>
                  {segment.definition.propertyName ? (
                    <small>
                      {segment.definition.propertyName}
                      {segment.definition.propertyValue ? ` = ${segment.definition.propertyValue}` : " is present"}
                    </small>
                  ) : null}
                </div>
                <div className="event-segments__meta">
                  <span>{preview ? `${preview.actors} actors` : "Preview pending"}</span>
                  <button onClick={() => onSelectSegment(segment.id)} type="button">Use as filter</button>
                  <button onClick={() => editSegment(segment)} type="button">Edit</button>
                  <button onClick={() => void archiveSegment(segment)} type="button">Archive</button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="event-segments__form">
          <label>
            Segment name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Activated users" />
          </label>
          <label>
            Actor
            <select value={actorType} onChange={(event) => setActorType(event.target.value as AnalyticsSegmentActorType)}>
              <option value="user">Users</option>
              <option value="tenant">Tenants</option>
            </select>
          </label>
          <label>
            Window
            <select value={window} onChange={(event) => setWindow(event.target.value as "24h" | "7d" | "30d")}>
              <option value="24h">24h</option>
              <option value="7d">7d</option>
              <option value="30d">30d</option>
            </select>
          </label>
          <label>
            Event name
            <input value={eventName} onChange={(event) => setEventName(event.target.value)} placeholder="project.created" />
          </label>
          <label>
            Property name
            <input value={propertyName} onChange={(event) => setPropertyName(event.target.value)} placeholder="plan" />
          </label>
          <label>
            Property value
            <input value={propertyValue} onChange={(event) => setPropertyValue(event.target.value)} placeholder="team" />
          </label>
          {error ? <p className="event-segments__error">{error}</p> : null}
          <div className="event-segments__actions">
            <button onClick={() => void saveSegment()} type="button">{editingId ? "Save segment" : "Create segment"}</button>
            {editingId ? <button onClick={resetForm} type="button">Cancel</button> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export function EventInvestigationPanel({ client, projectId, environmentId, initialFilters }: Props) {
  const initialFilterKey = JSON.stringify(initialFilters ?? {});
  const hasSyncedInitialFilters = useRef(false);
  const [draftFilters, setDraftFilters] = useState<EventFilterValues>(() => filtersWithDefaults(initialFilters));
  const [appliedFilters, setAppliedFilters] = useState<EventFilterValues>(() => filtersWithDefaults(initialFilters));
  const [reloadToken, setReloadToken] = useState(0);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventRecord | undefined>();
  const [state, setState] = useState<LoadState>("loading");
  const [propertyCatalog, setPropertyCatalog] = useState<EventPropertyCatalogResponse | null>(null);
  const [propertyCatalogState, setPropertyCatalogState] = useState<CatalogState>("loading");
  const [clickMapRoute, setClickMapRoute] = useState("/");
  const [clickMapSelector, setClickMapSelector] = useState("");
  const [clickMap, setClickMap] = useState<EventClickMapResponse | null>(null);
  const [clickMapState, setClickMapState] = useState<ClickMapState>("idle");
  const [pathStartEvent, setPathStartEvent] = useState("signup.started");
  const [pathEndEvent, setPathEndEvent] = useState("");
  const [pathActorType, setPathActorType] = useState<EventPathActorType>("auto");
  const [pathLength, setPathLength] = useState("5");
  const [paths, setPaths] = useState<EventPathsResponse | null>(null);
  const [pathState, setPathState] = useState<PathState>("idle");
  const [funnelInput, setFunnelInput] = useState("signup.started\nproject.created");
  const [funnel, setFunnel] = useState<EventFunnelResponse | null>(null);
  const [funnelState, setFunnelState] = useState<FunnelState>("idle");
  const [retentionEntryEvent, setRetentionEntryEvent] = useState("signup.started");
  const [retentionReturnEvent, setRetentionReturnEvent] = useState("app.opened");
  const [retention, setRetention] = useState<EventRetentionResponse | null>(null);
  const [retentionState, setRetentionState] = useState<RetentionState>("idle");
  const [activeSegmentId, setActiveSegmentId] = useState<string | undefined>();
  const query = useMemo(
    () => queryFromValues(projectId, environmentId, appliedFilters, activeSegmentId),
    [projectId, environmentId, appliedFilters, activeSegmentId]
  );

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setSelectedEvent(undefined);

    void client.listEvents(query).then(
      ({ data }) => {
        if (cancelled) return;
        setEvents(data);
        setState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setEvents([]);
        setState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, query, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    if (!client.getEventPropertyCatalog) {
      setPropertyCatalog(null);
      setPropertyCatalogState("unavailable");
      return;
    }

    setPropertyCatalogState("loading");
    void client
      .getEventPropertyCatalog({ projectId, environmentId, window: "7d", limit: 50 })
      .then(
        ({ data }) => {
          if (cancelled) return;
          setPropertyCatalog(data);
          setPropertyCatalogState(data.properties.length > 0 ? "ready" : "empty");
        },
        () => {
          if (cancelled) return;
          setPropertyCatalog(null);
          setPropertyCatalogState("unavailable");
        }
      );

    return () => {
      cancelled = true;
    };
  }, [client, projectId, environmentId, reloadToken]);

  useEffect(() => {
    if (!hasSyncedInitialFilters.current) {
      hasSyncedInitialFilters.current = true;
      return;
    }

    const next = filtersWithDefaults(initialFilters);
    setDraftFilters(next);
    setAppliedFilters(next);
  }, [initialFilterKey]);

  function applyFilters() {
    setAppliedFilters({ ...draftFilters });
  }

  function resetFilters() {
    setDraftFilters(defaultFilters);
    setAppliedFilters({ ...defaultFilters });
    setActiveSegmentId(undefined);
    setReloadToken((current) => current + 1);
  }

  function retry() {
    setReloadToken((current) => current + 1);
  }

  function runClickMap() {
    const route = clickMapRoute.trim();
    const selector = clickMapSelector.trim();
    if (!route) {
      setClickMap(null);
      setClickMapState("invalid");
      return;
    }
    if (!client.getEventClickMap) {
      setClickMap(null);
      setClickMapState("unavailable");
      return;
    }

    setClickMapState("loading");
    void client
      .getEventClickMap({
        projectId,
        environmentId,
        window: "7d",
        route,
        ...(selector ? { selector } : {}),
        tenantId: appliedFilters.tenantId.trim() || undefined,
        userId: appliedFilters.userId.trim() || undefined,
        sessionId: appliedFilters.sessionId.trim() || undefined,
        gridSize: 20,
        limit: 80
      })
      .then(
        ({ data }) => {
          setClickMap(data);
          setClickMapState("ready");
        },
        () => {
          setClickMap(null);
          setClickMapState("unavailable");
        }
      );
  }

  function runPaths() {
    const startEvent = pathStartEvent.trim();
    const endEvent = pathEndEvent.trim();
    if (!startEvent && !endEvent) {
      setPaths(null);
      setPathState("invalid");
      return;
    }
    if (!client.getEventPaths) {
      setPaths(null);
      setPathState("unavailable");
      return;
    }

    const maxDepth = Number(pathLength);
    setPathState("loading");
    void client
      .getEventPaths({
        projectId,
        environmentId,
        window: "7d",
        ...(startEvent ? { startEvent } : {}),
        ...(endEvent ? { endEvent } : {}),
        tenantId: appliedFilters.tenantId.trim() || undefined,
        userId: appliedFilters.userId.trim() || undefined,
        sessionId: appliedFilters.sessionId.trim() || undefined,
        traceId: appliedFilters.traceId.trim() || undefined,
        from: toIso(appliedFilters.from),
        to: toIso(appliedFilters.to),
        segmentId: activeSegmentId,
        actorType: pathActorType,
        pathLength: Number.isFinite(maxDepth) ? Math.trunc(maxDepth) : 5,
        limit: 20
      })
      .then(
        ({ data }) => {
          setPaths(data);
          setPathState("ready");
        },
        () => {
          setPaths(null);
          setPathState("unavailable");
        }
      );
  }

  function drilldownEvent(eventId: string) {
    setSelectedEvent(undefined);
    const drilldownQuery: QueryFilters = {
      projectId,
      environmentId,
      eventId,
      limit: 1
    };
    setState("loading");
    void client.listEvents(drilldownQuery).then(
      ({ data }) => {
        setEvents(data);
        setSelectedEvent(data[0]);
        setState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        setEvents([]);
        setState("unavailable");
      }
    );
  }

  function runFunnel() {
    const steps = parseFunnelSteps(funnelInput);
    if (steps.length < 2) {
      setFunnel(null);
      setFunnelState("invalid");
      return;
    }
    if (!client.getEventFunnel) {
      setFunnel(null);
      setFunnelState("unavailable");
      return;
    }

    setFunnelState("loading");
    void client
      .getEventFunnel({ projectId, environmentId, window: "7d", steps, limit: 20 })
      .then(
        ({ data }) => {
          setFunnel(data);
          setFunnelState("ready");
        },
        () => {
          setFunnel(null);
          setFunnelState("unavailable");
        }
      );
  }

  function runRetention() {
    const entryEvent = retentionEntryEvent.trim();
    const returnEvent = retentionReturnEvent.trim();
    if (!entryEvent || !returnEvent) {
      setRetention(null);
      setRetentionState("invalid");
      return;
    }
    if (!client.getEventRetention) {
      setRetention(null);
      setRetentionState("unavailable");
      return;
    }

    setRetentionState("loading");
    void client
      .getEventRetention({
        projectId,
        environmentId,
        window: "30d",
        entryEvent,
        returnEvent,
        period: "weekly",
        intervals: 6
      })
      .then(
        ({ data }) => {
          setRetention(data);
          setRetentionState("ready");
        },
        () => {
          setRetention(null);
          setRetentionState("unavailable");
        }
      );
  }

  return (
    <section className="investigation-layout">
      <div className="panel event-panel">
        <div className="panel-header">
          <h2>Events</h2>
        </div>
        <EventFilters values={draftFilters} onApply={applyFilters} onChange={setDraftFilters} onReset={resetFilters} />
        {state === "loading" ? <p className="muted-text">Loading events</p> : null}
        {state === "unavailable" ? (
          <div className="status-box unavailable">
            <strong>Events unavailable</strong>
            <button onClick={retry} type="button">
              Retry
            </button>
          </div>
        ) : null}
        {state === "empty" ? <p className="muted-text">No events found</p> : null}
        {state === "ready" ? (
          <>
            <EventAnalyticsSummary events={events} />
            <EventPropertyGovernance catalog={propertyCatalog} state={propertyCatalogState} />
            <SegmentManager
              activeSegmentId={activeSegmentId}
              client={client}
              environmentId={environmentId}
              onSelectSegment={(segmentId) => {
                setActiveSegmentId(segmentId);
                setReloadToken((current) => current + 1);
              }}
              projectId={projectId}
              reloadToken={reloadToken}
            />
            <EventClickMapPanel
              clickMap={clickMap}
              onRouteChange={setClickMapRoute}
              onRun={runClickMap}
              onSelectorChange={setClickMapSelector}
              route={clickMapRoute}
              selector={clickMapSelector}
              state={clickMapState}
            />
            <EventPathfinderPanel
              actorType={pathActorType}
              endEvent={pathEndEvent}
              onActorTypeChange={setPathActorType}
              onDrilldownEvent={drilldownEvent}
              onEndEventChange={setPathEndEvent}
              onPathLengthChange={setPathLength}
              onRun={runPaths}
              onStartEventChange={setPathStartEvent}
              pathLength={pathLength}
              paths={paths}
              startEvent={pathStartEvent}
              state={pathState}
            />
            <EventFunnelPanel
              funnel={funnel}
              onChange={setFunnelInput}
              onRun={runFunnel}
              state={funnelState}
              value={funnelInput}
            />
            <EventRetentionPanel
              entryEvent={retentionEntryEvent}
              onEntryEventChange={setRetentionEntryEvent}
              onReturnEventChange={setRetentionReturnEvent}
              onRun={runRetention}
              retention={retention}
              returnEvent={retentionReturnEvent}
              state={retentionState}
            />
            <EventList events={events} onSelect={setSelectedEvent} selectedEventId={selectedEvent?.id} />
          </>
        ) : null}
      </div>
      <EventDetailDrawer event={selectedEvent} />
    </section>
  );
}
