import { describe, expect, it, vi } from "vitest";
import type { SigmonClient } from "../client.js";
import { handleSearchEvents, searchEventsTool } from "./search_events.js";

function eventRow(index: number) {
  return {
    id: `event-${index}`,
    projectId: "p1",
    environmentId: "e1",
    tenantId: null,
    userId: `user-${index}`,
    sessionId: "session-1",
    traceId: null,
    timestamp: "2026-08-20T00:00:00.000Z",
    receivedAt: "2026-08-20T00:00:00.000Z",
    source: "web",
    release: null,
    metadata: { ua: "should be pruned" },
    name: "page_view",
    replayId: null,
    properties: { pageUrl: "/should/be/pruned?token=secret", apiToken: "secret" }
  };
}

function propertyRow(index: number) {
  return {
    eventName: "page_view",
    propertyName: `prop-${index}`,
    totalOccurrences: index,
    eventCount: index,
    coveragePercent: 100,
    dominantType: "string",
    typeCounts: { string: index },
    hasTypeConflict: false,
    sampleValues: ["a"],
    similarPropertyNames: [],
    lastSeenAt: null
  };
}

function makeFakeClient(overrides: Partial<SigmonClient> = {}): SigmonClient {
  return {
    listEvents: vi.fn(async () => ({ data: [eventRow(1)], cursor: null })),
    getEventPropertyCatalog: vi.fn(async () => ({
      window: "24h",
      generatedAt: "2026-08-20T00:00:00.000Z",
      scope: { projectId: "p1", environmentId: "e1" },
      range: { from: "2026-08-19T00:00:00.000Z", to: "2026-08-20T00:00:00.000Z" },
      totals: { events: 1, properties: 1, conflictProperties: 0, similarNameGroups: 0 },
      properties: [propertyRow(1)],
      similarNameGroups: []
    })),
    ...overrides
  } as unknown as SigmonClient;
}

describe("searchEventsTool schema", () => {
  it("declares the expected name", () => {
    expect(searchEventsTool.name).toBe("search_events");
    expect(searchEventsTool.inputSchema.type).toBe("object");
  });
});

describe("handleSearchEvents", () => {
  it("composes listEvents with the given filters and prunes properties/metadata by default", async () => {
    const client = makeFakeClient();

    const result = await handleSearchEvents(client, { eventName: "page_view", tenantId: "tenant-1", limit: 10 });

    expect(client.listEvents).toHaveBeenCalledWith({
      eventName: "page_view",
      eventId: undefined,
      segmentId: undefined,
      tenantId: "tenant-1",
      userId: undefined,
      sessionId: undefined,
      traceId: undefined,
      from: undefined,
      to: undefined,
      limit: 10,
      cursor: undefined
    });
    expect(client.getEventPropertyCatalog).not.toHaveBeenCalled();

    const events = result.events as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0]!.properties).toBeUndefined();
    expect(events[0]!.metadata).toBeUndefined();
    expect(events[0]!.name).toBe("page_view");
  });

  it("prunes properties/metadata when only the tool call opts in", async () => {
    const client = makeFakeClient();

    const result = await handleSearchEvents(client, { includeRawDetail: true });

    const events = result.events as Array<Record<string, unknown>>;
    expect(events[0]!.properties).toBeUndefined();
    expect(events[0]!.metadata).toBeUndefined();
  });

  it("returns sanitized event properties only after both gates opt in", async () => {
    const result = await handleSearchEvents(makeFakeClient(), { includeRawDetail: true }, { allowRawDetail: true });

    const events = result.events as Array<Record<string, unknown>>;
    expect(events[0]!.properties).toEqual({ pageUrl: "/should/be/pruned?token=%5BREDACTED%5D", apiToken: "[REDACTED]" });
    expect(result).toMatchObject({ rawDetailIncluded: true });
  });

  it("also fetches the property catalog when includeCatalog is set", async () => {
    const client = makeFakeClient();

    const result = await handleSearchEvents(client, { includeCatalog: true, catalogWindow: "7d", catalogLimit: 5 });

    expect(client.getEventPropertyCatalog).toHaveBeenCalledWith({ window: "7d", limit: 5 });
    const catalog = result.catalog as { properties: unknown[]; similarNameGroups: unknown[] };
    expect(catalog.properties).toHaveLength(1);
    expect(catalog.similarNameGroups).toHaveLength(0);
  });

  it("marks truncated when the events section exceeds the response budget cap", async () => {
    const oversized = Array.from({ length: 22 }, (_, i) => eventRow(i));
    const client = makeFakeClient({ listEvents: vi.fn(async () => ({ data: oversized, cursor: "next" })) });

    const result = await handleSearchEvents(client);

    expect(result.events).toHaveLength(20);
    expect(result.truncated).toEqual([expect.objectContaining({ section: "events", returned: 20, total: 22 })]);
  });
});
