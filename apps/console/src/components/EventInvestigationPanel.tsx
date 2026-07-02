import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { EventFunnelResponse, EventPropertyCatalogResponse, EventRecord, QueryFilters } from "../api/types";
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

function queryFromValues(projectId: string, environmentId: string, values: EventFilterValues): QueryFilters {
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
  const [funnelInput, setFunnelInput] = useState("signup.started\nproject.created");
  const [funnel, setFunnel] = useState<EventFunnelResponse | null>(null);
  const [funnelState, setFunnelState] = useState<FunnelState>("idle");
  const query = useMemo(
    () => queryFromValues(projectId, environmentId, appliedFilters),
    [projectId, environmentId, appliedFilters]
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
    setReloadToken((current) => current + 1);
  }

  function retry() {
    setReloadToken((current) => current + 1);
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
            <EventFunnelPanel
              funnel={funnel}
              onChange={setFunnelInput}
              onRun={runFunnel}
              state={funnelState}
              value={funnelInput}
            />
            <EventList events={events} onSelect={setSelectedEvent} selectedEventId={selectedEvent?.id} />
          </>
        ) : null}
      </div>
      <EventDetailDrawer event={selectedEvent} />
    </section>
  );
}
