// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSessionTimelineVM, useEventDetail } from "./useEventDetail";
import type { IncidentReplay, SessionTimelineResponse } from "../../api/types";

afterEach(() => vi.restoreAllMocks());

function replay(over: Partial<IncidentReplay> = {}): IncidentReplay {
  return {
    id: "r1",
    replayId: "replay_1",
    route: "/checkout",
    startedAt: "2026-06-23T00:00:00.000Z",
    endedAt: "2026-06-23T00:01:00.000Z",
    durationMs: 60000,
    eventCount: 4,
    masked: true,
    events: [],
    ...over,
  };
}

function timeline(over: Partial<SessionTimelineResponse> = {}): SessionTimelineResponse {
  return {
    sessionId: "sess_1",
    scope: { projectId: "p", environmentId: "e" },
    range: { from: null, to: null },
    items: [
      {
        id: "i1",
        type: "event",
        timestamp: "2026-06-23T00:00:00.000Z",
        receivedAt: "2026-06-23T00:00:00.000Z",
        tenantId: null,
        userId: null,
        sessionId: "sess_1",
        traceId: "trace_1",
        source: null,
        release: null,
        title: "signup.started",
        level: null,
        data: null,
      },
    ],
    page: { nextCursor: null, previousCursor: null },
    ...over,
  };
}

function makeClient(over: Record<string, unknown> = {}) {
  return {
    getSessionReplayDetail: vi.fn(async () => ({ data: replay() })),
    getSessionTimeline: vi.fn(async () => ({ data: timeline() })),
    ...over,
  } as never;
}

describe("buildSessionTimelineVM", () => {
  it("maps timeline items to row VMs", () => {
    const vm = buildSessionTimelineVM(timeline());
    expect(vm).toEqual([{ id: "i1", type: "event", timestamp: "2026-06-23T00:00:00.000Z", title: "signup.started", level: null, traceId: "trace_1" }]);
  });
});

describe("useEventDetail", () => {
  it("is idle for both when no event is selected", () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useEventDetail({ client, projectId: "p", environmentId: "e", event: undefined })
    );
    expect(result.current.replayStatus).toBe("idle");
    expect(result.current.timelineStatus).toBe("idle");
  });

  it("loads replay when replayId is present and session timeline when sessionId is present", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useEventDetail({
        client,
        projectId: "p",
        environmentId: "e",
        event: { replayId: "replay_1", sessionId: "sess_1", timestamp: "2026-06-23T00:00:00.000Z" },
      })
    );
    await waitFor(() => expect(result.current.replayStatus).toBe("ok"));
    await waitFor(() => expect(result.current.timelineStatus).toBe("ok"));
    expect(result.current.replay?.replayId).toBe("replay_1");
    expect(result.current.timeline[0].title).toBe("signup.started");
  });

  it("replay stays idle without a replayId; timeline stays idle without a sessionId", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useEventDetail({
        client,
        projectId: "p",
        environmentId: "e",
        event: { replayId: null, sessionId: null, timestamp: "2026-06-23T00:00:00.000Z" },
      })
    );
    expect(result.current.replayStatus).toBe("idle");
    expect(result.current.timelineStatus).toBe("idle");
  });

  it("replay errors when getSessionReplayDetail is absent, without blocking the timeline fetch", async () => {
    const client = makeClient({ getSessionReplayDetail: undefined });
    const { result } = renderHook(() =>
      useEventDetail({
        client,
        projectId: "p",
        environmentId: "e",
        event: { replayId: "replay_1", sessionId: "sess_1", timestamp: "2026-06-23T00:00:00.000Z" },
      })
    );
    await waitFor(() => expect(result.current.replayStatus).toBe("error"));
    await waitFor(() => expect(result.current.timelineStatus).toBe("ok"));
  });

  it("one fetch failing does not affect the other", async () => {
    const client = makeClient({ getSessionReplayDetail: vi.fn(async () => { throw new Error("boom"); }) });
    const { result } = renderHook(() =>
      useEventDetail({
        client,
        projectId: "p",
        environmentId: "e",
        event: { replayId: "replay_1", sessionId: "sess_1", timestamp: "2026-06-23T00:00:00.000Z" },
      })
    );
    await waitFor(() => expect(result.current.replayStatus).toBe("error"));
    await waitFor(() => expect(result.current.timelineStatus).toBe("ok"));
    expect(result.current.timeline).toHaveLength(1);
  });
});
