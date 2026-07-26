// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildClickMapVM,
  buildFunnelQuery,
  buildFunnelVM,
  buildPathsVM,
  buildRetentionQuery,
  buildRetentionVM,
  parseFunnelSteps,
  useAnalyticsPanels,
} from "./useAnalyticsPanels";
import type {
  EventClickMapResponse,
  EventFunnelResponse,
  EventPathsResponse,
  EventRetentionResponse,
} from "../../api/types";

afterEach(() => vi.restoreAllMocks());

function funnelResponse(): EventFunnelResponse {
  return {
    window: "7d",
    generatedAt: "2026-06-23T00:00:00.000Z",
    scope: { projectId: "p", environmentId: "e" },
    range: { from: "2026-06-16T00:00:00.000Z", to: "2026-06-23T00:00:00.000Z" },
    totals: { entrants: 100, completed: 40, conversionPercent: 40 },
    steps: [{ index: 0, name: "signup.started", actors: 100, conversionPercent: 100, dropOffFromPreviousPercent: 0 }],
    sampleActors: [],
  };
}

function retentionResponse(): EventRetentionResponse {
  return {
    window: "30d",
    generatedAt: "2026-06-23T00:00:00.000Z",
    scope: { projectId: "p", environmentId: "e" },
    range: { from: "2026-05-24T00:00:00.000Z", to: "2026-06-23T00:00:00.000Z" },
    entryEvent: "signup.started",
    returnEvent: "app.opened",
    period: "weekly",
    intervals: 6,
    totals: { cohorts: 1, entrants: 10 },
    cohorts: [
      {
        cohortStart: "2026-06-01T00:00:00.000Z",
        cohortLabel: "Jun 1",
        entrants: 10,
        intervals: [{ index: 0, label: "W0", retainedActors: 10, retentionPercent: 100 }],
      },
    ],
  };
}

function pathsResponse(): EventPathsResponse {
  return {
    window: "7d",
    generatedAt: "2026-06-23T00:00:00.000Z",
    scope: { projectId: "p", environmentId: "e" },
    range: { from: "2026-06-16T00:00:00.000Z", to: "2026-06-23T00:00:00.000Z" },
    filters: {
      startEvent: "signup.started",
      endEvent: null,
      tenantId: null,
      userId: null,
      sessionId: null,
      traceId: null,
      segmentId: null,
      actorType: "auto",
      pathLength: 5,
    },
    totals: { actors: 10, paths: 1, events: 20 },
    paths: [
      {
        path: ["signup.started", "project.created"],
        actors: 10,
        occurrences: 12,
        firstSeenAt: "2026-06-16T00:00:00.000Z",
        lastSeenAt: "2026-06-23T00:00:00.000Z",
        sampleEvents: [{ id: "ev1", name: "project.created", timestamp: "2026-06-23T00:00:00.000Z", actorId: "u1", actorType: "user" }],
      },
    ],
  };
}

function clickMapResponse(): EventClickMapResponse {
  return {
    window: "7d",
    generatedAt: "2026-06-23T00:00:00.000Z",
    scope: { projectId: "p", environmentId: "e" },
    range: { from: "2026-06-16T00:00:00.000Z", to: "2026-06-23T00:00:00.000Z" },
    filters: { route: "/checkout", selector: null, tenantId: null, userId: null, sessionId: null, gridSize: 20 },
    totals: { clicks: 5, routes: 1, selectors: 1 },
    routes: [{ route: "/checkout", clicks: 5 }],
    selectors: [{ selector: "#buy", elementTag: "button", elementRole: null, clicks: 5 }],
    points: [{ xBucket: 1, yBucket: 2, clicks: 5, percent: 100 }],
  };
}

function makeClient(over: Record<string, unknown> = {}) {
  return {
    getEventFunnel: vi.fn(async () => ({ data: funnelResponse() })),
    getEventRetention: vi.fn(async () => ({ data: retentionResponse() })),
    getEventPaths: vi.fn(async () => ({ data: pathsResponse() })),
    getEventClickMap: vi.fn(async () => ({ data: clickMapResponse() })),
    ...over,
  } as never;
}

describe("parseFunnelSteps", () => {
  it("splits on newline/comma, trims, drops blanks, caps at 12", () => {
    expect(parseFunnelSteps("a\nb, c\n\n d ")).toEqual(["a", "b", "c", "d"]);
    const many = Array.from({ length: 20 }, (_, i) => `e${i}`).join("\n");
    expect(parseFunnelSteps(many)).toHaveLength(12);
  });
});

describe("buildFunnelQuery / buildRetentionQuery", () => {
  it("assembles the funnel query with the fixed 7d window and limit", () => {
    expect(buildFunnelQuery("p", "e", ["a", "b"])).toMatchObject({ projectId: "p", environmentId: "e", window: "7d", steps: ["a", "b"], limit: 20 });
  });

  it("assembles the retention query with the fixed 30d/weekly/6-interval defaults", () => {
    expect(buildRetentionQuery("p", "e", "signup.started", "app.opened")).toMatchObject({
      projectId: "p", environmentId: "e", window: "30d", entryEvent: "signup.started", returnEvent: "app.opened", period: "weekly", intervals: 6,
    });
  });
});

describe("VM builders", () => {
  it("buildFunnelVM / buildRetentionVM / buildPathsVM / buildClickMapVM map responses 1:1", () => {
    expect(buildFunnelVM(funnelResponse()).totals.conversionPercent).toBe(40);
    expect(buildRetentionVM(retentionResponse()).cohorts[0].intervals[0].retentionPercent).toBe(100);
    expect(buildPathsVM(pathsResponse()).paths[0].path).toEqual(["signup.started", "project.created"]);
    expect(buildClickMapVM(clickMapResponse()).points[0]).toMatchObject({ xBucket: 1, yBucket: 2, clicks: 5 });
  });
});

describe("useAnalyticsPanels", () => {
  it("all four panels start idle and fetch nothing on mount", () => {
    const client = makeClient();
    const { result } = renderHook(() => useAnalyticsPanels({ client, projectId: "p", environmentId: "e" }));
    expect(result.current.funnel.state).toBe("idle");
    expect(result.current.retention.state).toBe("idle");
    expect(result.current.paths.state).toBe("idle");
    expect(result.current.clickMap.state).toBe("idle");
    expect((client as never as { getEventFunnel: { mock: { calls: unknown[] } } }).getEventFunnel.mock.calls.length).toBe(0);
  });

  it("funnel: invalid with < 2 steps, ok with >= 2 steps", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useAnalyticsPanels({ client, projectId: "p", environmentId: "e" }));
    act(() => result.current.funnel.run("only-one"));
    expect(result.current.funnel.state).toBe("invalid");
    act(() => result.current.funnel.run("a\nb"));
    await waitFor(() => expect(result.current.funnel.state).toBe("ok"));
    expect(result.current.funnel.data?.totals.conversionPercent).toBe(40);
  });

  it("funnel: errors without throwing when getEventFunnel is absent", () => {
    const client = makeClient({ getEventFunnel: undefined });
    const { result } = renderHook(() => useAnalyticsPanels({ client, projectId: "p", environmentId: "e" }));
    act(() => result.current.funnel.run("a\nb"));
    expect(result.current.funnel.state).toBe("error");
  });

  it("retention: invalid without both events, ok with both", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useAnalyticsPanels({ client, projectId: "p", environmentId: "e" }));
    act(() => result.current.retention.run("signup.started", ""));
    expect(result.current.retention.state).toBe("invalid");
    act(() => result.current.retention.run("signup.started", "app.opened"));
    await waitFor(() => expect(result.current.retention.state).toBe("ok"));
    expect(result.current.retention.data?.totals.cohorts).toBe(1);
  });

  it("paths: invalid without start/end event, ok otherwise", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useAnalyticsPanels({ client, projectId: "p", environmentId: "e" }));
    act(() => result.current.paths.run({ startEvent: "", endEvent: "", actorType: "auto", pathLength: 5 }));
    expect(result.current.paths.state).toBe("invalid");
    act(() => result.current.paths.run({ startEvent: "signup.started", endEvent: "", actorType: "auto", pathLength: 5, segmentId: "seg1" }));
    await waitFor(() => expect(result.current.paths.state).toBe("ok"));
    expect((client as never as { getEventPaths: { mock: { calls: unknown[][] } } }).getEventPaths.mock.calls[0][0]).toMatchObject({ segmentId: "seg1" });
  });

  it("click map: invalid without a route, ok otherwise", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useAnalyticsPanels({ client, projectId: "p", environmentId: "e" }));
    act(() => result.current.clickMap.run({ route: "" }));
    expect(result.current.clickMap.state).toBe("invalid");
    act(() => result.current.clickMap.run({ route: "/checkout" }));
    await waitFor(() => expect(result.current.clickMap.state).toBe("ok"));
    expect(result.current.clickMap.data?.totals.clicks).toBe(5);
  });

  it("a panel erroring does not affect another panel's idle state", () => {
    const client = makeClient({ getEventRetention: undefined });
    const { result } = renderHook(() => useAnalyticsPanels({ client, projectId: "p", environmentId: "e" }));
    act(() => result.current.retention.run("a", "b"));
    expect(result.current.retention.state).toBe("error");
    expect(result.current.funnel.state).toBe("idle");
    expect(result.current.paths.state).toBe("idle");
    expect(result.current.clickMap.state).toBe("idle");
  });
});
