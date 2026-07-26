// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEventsSummary,
  buildPropertyCatalogVM,
  DEFAULT_EVENT_FILTERS,
  queryFromValues,
  toIso,
  toLimit,
  useEvents,
} from "./useEvents";
import type { EventFilterValues } from "./useEvents";
import type { EventPropertyCatalogResponse, EventRecord } from "../../api/types";

afterEach(() => vi.restoreAllMocks());

function event(over: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "ev1",
    projectId: "p",
    environmentId: "e",
    tenantId: "tenant_a",
    userId: "user_a",
    sessionId: "sess_a",
    traceId: null,
    timestamp: "2026-06-23T00:00:00.000Z",
    receivedAt: "2026-06-23T00:00:00.000Z",
    source: "browser",
    release: "1.0.0",
    metadata: null,
    name: "signup.started",
    replayId: null,
    properties: null,
    ...over,
  };
}

function catalog(over: Partial<EventPropertyCatalogResponse> = {}): EventPropertyCatalogResponse {
  return {
    window: "7d",
    generatedAt: "2026-06-23T00:00:00.000Z",
    scope: { projectId: "p", environmentId: "e" },
    range: { from: "2026-06-16T00:00:00.000Z", to: "2026-06-23T00:00:00.000Z" },
    totals: { events: 10, properties: 1, conflictProperties: 0, similarNameGroups: 0 },
    properties: [
      {
        eventName: "signup.started",
        propertyName: "plan",
        totalOccurrences: 10,
        eventCount: 10,
        coveragePercent: 100,
        dominantType: "string",
        typeCounts: { string: 10 },
        hasTypeConflict: false,
        sampleValues: ["team"],
        similarPropertyNames: [],
        lastSeenAt: "2026-06-23T00:00:00.000Z",
      },
    ],
    similarNameGroups: [],
    ...over,
  };
}

function makeClient(rows: EventRecord[], over: Record<string, unknown> = {}) {
  return {
    listEvents: vi.fn(async () => ({ data: rows })),
    listSessionReplays: vi.fn(async () => ({ data: [] })),
    getEventPropertyCatalog: vi.fn(async () => ({ data: catalog() })),
    ...over,
  } as never;
}

describe("query helpers", () => {
  it("toIso converts a valid datetime-local string, undefined for invalid/empty", () => {
    expect(toIso("")).toBeUndefined();
    expect(toIso("not-a-date")).toBeUndefined();
    expect(toIso("2026-06-23T00:00")).toBe(new Date("2026-06-23T00:00").toISOString());
  });

  it("toLimit clamps to [1, 500] and defaults to 50 for non-finite input", () => {
    expect(toLimit("not-a-number")).toBe(50);
    expect(toLimit("0")).toBe(1);
    expect(toLimit("50000")).toBe(500);
    expect(toLimit("120")).toBe(120);
  });

  it("queryFromValues only sets trimmed, non-empty fields plus segmentId", () => {
    const values: EventFilterValues = { ...DEFAULT_EVENT_FILTERS, eventName: " signup.started ", tenantId: "  " };
    const query = queryFromValues("p", "e", values, "seg1");
    expect(query).toMatchObject({ projectId: "p", environmentId: "e", eventName: "signup.started", segmentId: "seg1", limit: 50 });
    expect(query.tenantId).toBeUndefined();
  });
});

describe("buildEventsSummary", () => {
  it("counts unique names/tenants/users and ranks the top 5 event names", () => {
    const events = [event({ name: "a" }), event({ name: "a" }), event({ name: "b" }), event({ tenantId: "tenant_b", userId: null })];
    const summary = buildEventsSummary(events);
    expect(summary.total).toBe(4);
    expect(summary.uniqueNames).toBe(3);
    expect(summary.tenants).toBe(2);
    expect(summary.top[0]).toMatchObject({ name: "a", count: 2 });
  });
});

describe("buildPropertyCatalogVM", () => {
  it("maps totals and formats type-count labels", () => {
    const vm = buildPropertyCatalogVM(catalog());
    expect(vm.totals).toMatchObject({ properties: 1, conflictProperties: 0 });
    expect(vm.properties[0].typeCountsLabel).toBe("string 10");
  });
});

describe("useEvents", () => {
  it("fans out listEvents + listSessionReplays + getEventPropertyCatalog and maps rows", async () => {
    const client = makeClient([event()]);
    const { result } = renderHook(() =>
      useEvents({ client, projectId: "p", environmentId: "e", filters: DEFAULT_EVENT_FILTERS })
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.rows[0]).toMatchObject({ id: "ev1", name: "signup.started" });
    expect(result.current.data?.replaySamplesStatus).toBe("ok");
    expect(result.current.data?.propertyCatalogStatus).toBe("ok");
    expect(result.current.data?.propertyCatalog?.properties).toHaveLength(1);
  });

  it("tolerates listSessionReplays/getEventPropertyCatalog being absent — main status stays ok", async () => {
    const client = makeClient([event()], { listSessionReplays: undefined, getEventPropertyCatalog: undefined });
    const { result } = renderHook(() =>
      useEvents({ client, projectId: "p", environmentId: "e", filters: DEFAULT_EVENT_FILTERS })
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.replaySamplesStatus).toBe("error");
    expect(result.current.data?.propertyCatalogStatus).toBe("error");
    expect(result.current.data?.rows).toHaveLength(1);
  });

  it("tolerates listSessionReplays/getEventPropertyCatalog rejecting — main status stays ok", async () => {
    const client = makeClient([event()], {
      listSessionReplays: vi.fn(async () => { throw new Error("boom"); }),
      getEventPropertyCatalog: vi.fn(async () => { throw new Error("boom"); }),
    });
    const { result } = renderHook(() =>
      useEvents({ client, projectId: "p", environmentId: "e", filters: DEFAULT_EVENT_FILTERS })
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.replaySamplesStatus).toBe("error");
    expect(result.current.data?.propertyCatalogStatus).toBe("error");
  });

  it("sets error status and null data when listEvents rejects", async () => {
    const client = makeClient([], { listEvents: vi.fn(async () => { throw new Error("boom"); }) });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useEvents({ client, projectId: "p", environmentId: "e", filters: DEFAULT_EVENT_FILTERS })
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
    errSpy.mockRestore();
  });

  it("passes segmentId through to listEvents and listSessionReplays", async () => {
    const client = makeClient([event()]);
    renderHook(() =>
      useEvents({ client, projectId: "p", environmentId: "e", filters: DEFAULT_EVENT_FILTERS, segmentId: "seg1" })
    );
    await waitFor(() => expect((client as never as { listEvents: { mock: { calls: unknown[][] } } }).listEvents.mock.calls.length).toBeGreaterThan(0));
    expect((client as never as { listEvents: { mock: { calls: unknown[][] } } }).listEvents.mock.calls[0][0]).toMatchObject({ segmentId: "seg1" });
    expect((client as never as { listSessionReplays: { mock: { calls: unknown[][] } } }).listSessionReplays.mock.calls[0][0]).toMatchObject({ segmentId: "seg1" });
  });

  it("does nothing without project/environment scope", () => {
    const client = makeClient([]);
    renderHook(() => useEvents({ client, projectId: undefined, environmentId: undefined, filters: DEFAULT_EVENT_FILTERS }));
    expect((client as never as { listEvents: { mock: { calls: unknown[] } } }).listEvents.mock.calls.length).toBe(0);
  });

  it("ignores a stale response when filters change before the first request resolves (genRef race guard)", async () => {
    let resolveFirst: (value: { data: EventRecord[] }) => void = () => {};
    const firstPromise = new Promise<{ data: EventRecord[] }>((resolve) => {
      resolveFirst = resolve;
    });
    const listEvents = vi.fn()
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(async () => ({ data: [event({ id: "ev2", name: "second" })] }));
    const client = makeClient([], { listEvents });

    const { result, rerender } = renderHook(
      ({ filters }: { filters: EventFilterValues }) => useEvents({ client, projectId: "p", environmentId: "e", filters }),
      { initialProps: { filters: DEFAULT_EVENT_FILTERS } }
    );

    rerender({ filters: { ...DEFAULT_EVENT_FILTERS, eventName: "second" } });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.rows[0]?.id).toBe("ev2");

    // Resolving the stale first request afterwards must not clobber the newer result.
    resolveFirst({ data: [event({ id: "ev1", name: "first" })] });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.data?.rows[0]?.id).toBe("ev2");
  });
});
