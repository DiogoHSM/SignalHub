// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import type { UserDetailResponse } from "../../api/types";
import { useUserDetail } from "./useUserDetail";

afterEach(() => vi.restoreAllMocks());

function makeDetail(overrides: Partial<UserDetailResponse> = {}): UserDetailResponse {
  return {
    window: "7d",
    generatedAt: "",
    scope: { projectId: "p", environmentId: "e" },
    range: { from: "", to: "" },
    user: {
      userId: "user_1", label: "user_1", traits: {}, keyTraits: {}, isAnonymous: false, impactScore: 10,
      firstSeenAt: "2026-06-01T00:00:00Z", lastSeenAt: "2026-06-22T00:00:00Z", profileUpdatedAt: null,
      events: 100, errors: 1, openErrors: 1, severeErrors: 0, traces: 10, failedTraces: 0,
      llmCalls: 5, failedLlmCalls: 0, llmCostUsd: "1.00", activeTenants: 1, activeSessions: 1,
    },
    recentSessions: [],
    timeline: [
      { type: "event", id: "e1", timestamp: "2026-06-22T00:00:00Z", label: "page_view", tenantId: null, sessionId: null, traceId: null, eventName: "page_view" },
    ],
    ...overrides,
  };
}

function makeClient(over: Partial<ApiClient> = {}) {
  return {
    getUserDetail: vi.fn().mockResolvedValue({ data: makeDetail() }),
    ...over,
  } as unknown as Pick<ApiClient, "getUserDetail">;
}

const BASE = { projectId: "p", environmentId: "e", window: "7d" as const };

describe("useUserDetail", () => {
  it("does not fetch when userId is null", () => {
    const client = makeClient();
    const { result } = renderHook(() => useUserDetail({ client, ...BASE, userId: null }));
    expect(client.getUserDetail).not.toHaveBeenCalled();
    expect(result.current.status).toBe("ok");
    expect(result.current.data).toBeNull();
  });

  it("does not fetch for the collapsed anonymous key", () => {
    const client = makeClient();
    const { result } = renderHook(() => useUserDetail({ client, ...BASE, userId: "_anonymous" }));
    expect(client.getUserDetail).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it("fetches detail for a concrete userId", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useUserDetail({ client, ...BASE, userId: "user_1" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.user.userId).toBe("user_1");
    expect(client.getUserDetail).toHaveBeenCalledWith("user_1", expect.objectContaining({ projectId: "p", environmentId: "e", window: "7d" }));
  });

  it("loadMore is a no-op without a cursor", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useUserDetail({ client, ...BASE, userId: "user_1" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    result.current.loadMore();
    expect(client.getUserDetail).toHaveBeenCalledTimes(1);
    expect(result.current.loadingMore).toBe(false);
  });

  it("loadMore concatenates the timeline using the cursor and clears it on the response", async () => {
    const page2 = makeDetail({
      cursor: undefined,
      timeline: [
        { type: "trace", id: "t1", timestamp: "2026-06-21T00:00:00Z", label: "GET /x", tenantId: null, sessionId: null, traceId: "tr1", status: "success", durationMs: 12, name: "GET /x" },
      ],
    });
    const getUserDetail = vi.fn()
      .mockResolvedValueOnce({ data: makeDetail({ cursor: "cur_1" }) })
      .mockResolvedValueOnce({ data: page2 });
    const client = makeClient({ getUserDetail } as never);
    const { result } = renderHook(() => useUserDetail({ client, ...BASE, userId: "user_1" }));
    await waitFor(() => expect(result.current.data?.cursor).toBe("cur_1"));

    result.current.loadMore();
    await waitFor(() => expect(result.current.data?.timeline.length).toBe(2));
    expect(result.current.loadingMore).toBe(false);

    expect(result.current.data!.timeline.map((t) => t.id)).toEqual(["e1", "t1"]);
    expect(result.current.data!.cursor).toBeUndefined();
    expect(getUserDetail).toHaveBeenLastCalledWith("user_1", expect.objectContaining({ cursor: "cur_1" }));
  });

  it("sets loadMoreError and preserves existing data when the load-more request fails", async () => {
    const getUserDetail = vi.fn()
      .mockResolvedValueOnce({ data: makeDetail({ cursor: "cur_1" }) })
      .mockRejectedValueOnce(new Error("boom"));
    const client = makeClient({ getUserDetail } as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useUserDetail({ client, ...BASE, userId: "user_1" }));
    await waitFor(() => expect(result.current.data?.cursor).toBe("cur_1"));

    result.current.loadMore();
    await waitFor(() => expect(result.current.loadMoreError).toBe(true));
    expect(result.current.data!.timeline.map((t) => t.id)).toEqual(["e1"]);
    errSpy.mockRestore();
  });

  it("resets to a fresh fetch when the selected userId changes", async () => {
    const client = makeClient();
    const { result, rerender } = renderHook(({ userId }) => useUserDetail({ client, ...BASE, userId }), {
      initialProps: { userId: "user_1" as string | null },
    });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    rerender({ userId: null });
    expect(result.current.data).toBeNull();
    expect(result.current.status).toBe("ok");
  });

  it("sets error status when the request fails", async () => {
    const client = makeClient({ getUserDetail: vi.fn().mockRejectedValue(new Error("boom")) } as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useUserDetail({ client, ...BASE, userId: "user_1" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
    errSpy.mockRestore();
  });

  it("race-guards against a stale request resolving after a newer one", async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const getUserDetail = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve({ data: makeDetail({ user: { ...makeDetail().user, userId: "user_2", label: "user_2" } }) }));
    const client = makeClient({ getUserDetail } as never);
    const { result, rerender } = renderHook(({ userId }) => useUserDetail({ client, ...BASE, userId }), {
      initialProps: { userId: "user_1" },
    });
    rerender({ userId: "user_2" });
    await waitFor(() => expect(result.current.data?.user.userId).toBe("user_2"));

    resolveFirst({ data: makeDetail({ user: { ...makeDetail().user, userId: "user_1_stale" } }) });
    await Promise.resolve();
    expect(result.current.data!.user.userId).toBe("user_2");
  });
});
