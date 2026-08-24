import { describe, expect, it, vi } from "vitest";
import type { SigmonClient } from "../client.js";
import { handleUserJourney, userJourneyTool } from "./user_journey.js";

function userRow(index: number) {
  return {
    userId: `user-${index}`,
    label: `User ${index}`,
    traits: {},
    keyTraits: {},
    isAnonymous: false,
    impactScore: index,
    firstSeenAt: null,
    lastSeenAt: null,
    profileUpdatedAt: null,
    events: 1,
    errors: 0,
    openErrors: 0,
    severeErrors: 0,
    traces: 0,
    failedTraces: 0,
    llmCalls: 0,
    failedLlmCalls: 0,
    llmCostUsd: "0",
    activeTenants: 1,
    activeSessions: 1
  };
}

function tenantRow(index: number) {
  return {
    tenantId: `tenant-${index}`,
    label: `Tenant ${index}`,
    traits: {},
    keyTraits: {},
    isUnassigned: false,
    impactScore: index,
    firstSeenAt: null,
    lastSeenAt: null,
    profileUpdatedAt: null,
    events: 1,
    errors: 0,
    openErrors: 0,
    severeErrors: 0,
    traces: 0,
    failedTraces: 0,
    llmCalls: 0,
    failedLlmCalls: 0,
    llmCostUsd: "0",
    activeUsers: 1,
    activeSessions: 1
  };
}

function timelineItem(index: number) {
  return {
    id: `item-${index}`,
    type: "event" as const,
    timestamp: "2026-08-20T00:00:00.000Z",
    receivedAt: "2026-08-20T00:00:00.000Z",
    tenantId: null,
    userId: `user-${index}`,
    sessionId: "session-1",
    traceId: null,
    source: null,
    release: null,
    title: `Step ${index}`,
    level: null,
    data: { raw: "should be pruned" }
  };
}

function makeFakeClient(overrides: Partial<SigmonClient> = {}): SigmonClient {
  return {
    listUsers: vi.fn(async () => ({
      window: "24h",
      generatedAt: "2026-08-20T00:00:00.000Z",
      scope: { projectId: "p1", environmentId: "e1" },
      range: { from: "2026-08-19T00:00:00.000Z", to: "2026-08-20T00:00:00.000Z" },
      users: [userRow(1)],
      cursor: undefined
    })),
    listEntityTenants: vi.fn(async () => ({
      window: "24h",
      generatedAt: "2026-08-20T00:00:00.000Z",
      scope: { projectId: "p1", environmentId: "e1" },
      range: { from: "2026-08-19T00:00:00.000Z", to: "2026-08-20T00:00:00.000Z" },
      tenants: [tenantRow(1)],
      cursor: undefined
    })),
    getSessionTimeline: vi.fn(async () => ({
      sessionId: "session-1",
      scope: { projectId: "p1", environmentId: "e1" },
      range: { from: null, to: null },
      items: [timelineItem(1)],
      page: { nextCursor: null, previousCursor: null }
    })),
    ...overrides
  } as unknown as SigmonClient;
}

describe("userJourneyTool schema", () => {
  it("declares the expected name and subjectType enum", () => {
    expect(userJourneyTool.name).toBe("user_journey");
    expect((userJourneyTool.inputSchema.properties.subjectType as { enum: string[] }).enum).toEqual(["user", "tenant"]);
  });
});

describe("handleUserJourney", () => {
  it("defaults to subjectType user and calls listUsers with the given filters", async () => {
    const client = makeFakeClient();

    const result = await handleUserJourney(client, { search: "diogo", tenantId: "tenant-1", window: "7d", limit: 10 });

    expect(client.listUsers).toHaveBeenCalledWith({
      window: "7d",
      search: "diogo",
      tenantId: "tenant-1",
      limit: 10,
      sort: undefined,
      cursor: undefined
    });
    expect(client.listEntityTenants).not.toHaveBeenCalled();
    expect(result.subjectType).toBe("user");
    expect(result.users).toHaveLength(1);
  });

  it("calls listEntityTenants when subjectType is tenant", async () => {
    const client = makeFakeClient();

    const result = await handleUserJourney(client, { subjectType: "tenant", search: "acme" });

    expect(client.listEntityTenants).toHaveBeenCalledWith({
      window: undefined,
      search: "acme",
      limit: undefined,
      sort: undefined,
      cursor: undefined
    });
    expect(client.listUsers).not.toHaveBeenCalled();
    expect(result.tenants).toHaveLength(1);
  });

  it("fetches the session timeline when sessionId is given, and prunes item `data` by default", async () => {
    const client = makeFakeClient();

    const result = await handleUserJourney(client, { sessionId: "session-1", sessionBefore: 5, sessionAfter: 5 });

    expect(client.getSessionTimeline).toHaveBeenCalledWith("session-1", {
      tenantId: undefined,
      userId: undefined,
      from: undefined,
      to: undefined,
      center: undefined,
      before: 5,
      after: 5,
      types: undefined,
      limit: undefined
    });
    const timeline = result.timeline as { items: Array<Record<string, unknown>> };
    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0]!.data).toBeUndefined();
  });

  it("keeps item `data` when includeRawDetail is set", async () => {
    const client = makeFakeClient();

    const result = await handleUserJourney(client, { sessionId: "session-1", includeRawDetail: true });

    const timeline = result.timeline as { items: Array<Record<string, unknown>> };
    expect(timeline.items[0]!.data).toEqual({ raw: "should be pruned" });
  });

  it("marks truncated when the users section exceeds the response budget cap", async () => {
    const oversized = Array.from({ length: 30 }, (_, i) => userRow(i));
    const client = makeFakeClient({
      listUsers: vi.fn(async () => ({
        window: "24h" as const,
        generatedAt: "2026-08-20T00:00:00.000Z",
        scope: { projectId: "p1", environmentId: "e1" },
        range: { from: "2026-08-19T00:00:00.000Z", to: "2026-08-20T00:00:00.000Z" },
        users: oversized,
        cursor: undefined
      }))
    });

    const result = await handleUserJourney(client);

    expect(result.users).toHaveLength(20);
    expect(result.truncated).toEqual([expect.objectContaining({ section: "users", returned: 20, total: 30 })]);
  });
});
