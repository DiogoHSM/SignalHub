import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { ApmWindow, EventPropertyCatalogResponse, EventRecord, QueryFilters, SessionReplaySample } from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type EventFilterValues = {
  eventName: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  traceId: string;
  from: string;
  to: string;
  limit: string;
};

export const DEFAULT_EVENT_FILTERS: EventFilterValues = {
  eventName: "",
  tenantId: "",
  userId: "",
  sessionId: "",
  traceId: "",
  from: "",
  to: "",
  limit: "50",
};

export type EventRowVM = {
  id: string;
  name: string;
  timestamp: string;
  source: string | null;
  release: string | null;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  replayId: string | null;
  properties: unknown;
  metadata: unknown;
};

export type EventTopNameVM = { name: string; count: number; percent: number };

export type EventsSummaryVM = {
  total: number;
  uniqueNames: number;
  tenants: number;
  users: number;
  top: EventTopNameVM[];
};

export type ReplaySampleVM = {
  id: string;
  replayId: string;
  route: string | null;
  durationMs: number | null;
  startedAt: string;
  userId: string | null;
  tenantId: string | null;
  linkedEventName: string | null;
  linkedErrorMessage: string | null;
};

export type PropertyCatalogItemVM = {
  eventName: string;
  propertyName: string;
  dominantType: string;
  typeCountsLabel: string;
  hasTypeConflict: boolean;
  coveragePercent: number;
  totalOccurrences: number;
  eventCount: number;
  sampleValues: string[];
  similarPropertyNames: string[];
};

export type PropertyCatalogVM = {
  window: ApmWindow;
  totals: { events: number; properties: number; conflictProperties: number; similarNameGroups: number };
  properties: PropertyCatalogItemVM[];
};

export type EventsVM = {
  rows: EventRowVM[];
  summary: EventsSummaryVM;
  replaySamples: ReplaySampleVM[];
  replaySamplesStatus: "loading" | "ok" | "error";
  propertyCatalog: PropertyCatalogVM | null;
  propertyCatalogStatus: "loading" | "ok" | "error";
};

export type UseEventsResult = {
  data: EventsVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

type UseEventsArgs = {
  client: {
    listEvents: ApiClient["listEvents"];
    listSessionReplays?: ApiClient["listSessionReplays"];
    getEventPropertyCatalog?: ApiClient["getEventPropertyCatalog"];
  };
  projectId: string | undefined;
  environmentId: string | undefined;
  filters: EventFilterValues;
  /** Saved segment applied as a filter — only wired for /query/events and /query/replays (client.ts:644). */
  segmentId?: string;
};

const PROPERTY_CATALOG_WINDOW: ApmWindow = "7d";
const PROPERTY_CATALOG_LIMIT = 50;
const REPLAY_SAMPLES_LIMIT = 10;

// ---------------------------------------------------------------------------
// Pure query helpers
// ---------------------------------------------------------------------------

export function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function toLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(500, Math.max(1, Math.trunc(parsed)));
}

export function queryFromValues(
  projectId: string,
  environmentId: string,
  values: EventFilterValues,
  segmentId?: string
): QueryFilters {
  const query: QueryFilters = {
    projectId,
    environmentId,
    limit: toLimit(values.limit),
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

// ---------------------------------------------------------------------------
// Pure VM builders
// ---------------------------------------------------------------------------

function countKnown(values: Array<string | null>): number {
  return new Set(values.filter((value): value is string => Boolean(value))).size;
}

function topEvents(events: EventRecord[]): EventTopNameVM[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.name, (counts.get(event.name) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({
    name,
    count,
    percent: events.length === 0 ? 0 : Math.round((count / events.length) * 100),
  }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 5);
}

export function buildEventsSummary(events: EventRecord[]): EventsSummaryVM {
  return {
    total: events.length,
    uniqueNames: countKnown(events.map((event) => event.name)),
    tenants: countKnown(events.map((event) => event.tenantId)),
    users: countKnown(events.map((event) => event.userId)),
    top: topEvents(events),
  };
}

function mapEventRow(event: EventRecord): EventRowVM {
  return {
    id: event.id,
    name: event.name,
    timestamp: event.timestamp,
    source: event.source,
    release: event.release,
    tenantId: event.tenantId,
    userId: event.userId,
    sessionId: event.sessionId,
    traceId: event.traceId,
    replayId: event.replayId,
    properties: event.properties,
    metadata: event.metadata,
  };
}

function mapReplaySample(sample: SessionReplaySample): ReplaySampleVM {
  return {
    id: sample.id,
    replayId: sample.replayId,
    route: sample.route,
    durationMs: sample.durationMs,
    startedAt: sample.startedAt,
    userId: sample.userId,
    tenantId: sample.tenantId,
    linkedEventName: sample.linkedEventName,
    linkedErrorMessage: sample.linkedErrorMessage,
  };
}

function formatTypeCounts(typeCounts: Record<string, number>): string {
  return Object.entries(typeCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([type, count]) => `${type} ${count}`)
    .join(" / ");
}

export function buildPropertyCatalogVM(response: EventPropertyCatalogResponse): PropertyCatalogVM {
  return {
    window: response.window,
    totals: response.totals,
    properties: response.properties.map((property) => ({
      eventName: property.eventName,
      propertyName: property.propertyName,
      dominantType: property.dominantType,
      typeCountsLabel: formatTypeCounts(property.typeCounts) || property.dominantType,
      hasTypeConflict: property.hasTypeConflict,
      coveragePercent: property.coveragePercent,
      totalOccurrences: property.totalOccurrences,
      eventCount: property.eventCount,
      sampleValues: property.sampleValues,
      similarPropertyNames: property.similarPropertyNames,
    })),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useEvents({ client, projectId, environmentId, filters, segmentId }: UseEventsArgs): UseEventsResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<EventsVM | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (!projectId || !environmentId) return;

    const gen = ++genRef.current;
    setStatus("loading");

    const query = queryFromValues(projectId, environmentId, filters, segmentId);

    const eventsPromise = client.listEvents(query);

    const sampleQuery: Parameters<NonNullable<ApiClient["listSessionReplays"]>>[0] = {
      projectId,
      environmentId,
      limit: REPLAY_SAMPLES_LIMIT,
      ...(filters.tenantId.trim() ? { tenantId: filters.tenantId.trim() } : {}),
      ...(filters.userId.trim() ? { userId: filters.userId.trim() } : {}),
      ...(filters.eventName.trim() ? { eventName: filters.eventName.trim() } : {}),
      ...(segmentId ? { segmentId } : {}),
    };
    const replaysPromise = client.listSessionReplays
      ? client.listSessionReplays(sampleQuery).then((res) => res.data).catch(() => null)
      : Promise.resolve(null);

    const catalogPromise = client.getEventPropertyCatalog
      ? client
          .getEventPropertyCatalog({ projectId, environmentId, window: PROPERTY_CATALOG_WINDOW, limit: PROPERTY_CATALOG_LIMIT })
          .then((res) => res.data)
          .catch(() => null)
      : Promise.resolve(null);

    Promise.all([eventsPromise, replaysPromise, catalogPromise])
      .then(([eventsRes, replays, catalog]) => {
        if (gen !== genRef.current) return;
        setData({
          rows: eventsRes.data.map(mapEventRow),
          summary: buildEventsSummary(eventsRes.data),
          replaySamples: replays ? replays.map(mapReplaySample) : [],
          replaySamplesStatus: client.listSessionReplays ? (replays ? "ok" : "error") : "error",
          propertyCatalog: catalog ? buildPropertyCatalogVM(catalog) : null,
          propertyCatalogStatus: client.getEventPropertyCatalog ? (catalog ? "ok" : "error") : "error",
        });
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, environmentId, filtersKey, segmentId, tick]);

  return { data, status, reload: () => setTick((t) => t + 1) };
}
