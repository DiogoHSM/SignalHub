import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { EventRecord, QueryFilters } from "../api/types";
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

export function EventInvestigationPanel({ client, projectId, environmentId, initialFilters }: Props) {
  const initialFilterKey = JSON.stringify(initialFilters ?? {});
  const hasSyncedInitialFilters = useRef(false);
  const [draftFilters, setDraftFilters] = useState<EventFilterValues>(() => filtersWithDefaults(initialFilters));
  const [appliedFilters, setAppliedFilters] = useState<EventFilterValues>(() => filtersWithDefaults(initialFilters));
  const [reloadToken, setReloadToken] = useState(0);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventRecord | undefined>();
  const [state, setState] = useState<LoadState>("loading");
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
            <EventList events={events} onSelect={setSelectedEvent} selectedEventId={selectedEvent?.id} />
          </>
        ) : null}
      </div>
      <EventDetailDrawer event={selectedEvent} />
    </section>
  );
}
