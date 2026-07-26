// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import type { UserListResponse, UserSummary } from "../../api/types";
import { useUsers, userKey, type UserSort } from "./useUsers";

afterEach(() => vi.restoreAllMocks());

function makeUser(overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    userId: "user_1",
    label: "user_1",
    traits: {},
    keyTraits: {},
    isAnonymous: false,
    impactScore: 10,
    firstSeenAt: "2026-06-01T00:00:00Z",
    lastSeenAt: "2026-06-22T00:00:00Z",
    profileUpdatedAt: null,
    events: 100,
    errors: 1,
    openErrors: 1,
    severeErrors: 0,
    traces: 10,
    failedTraces: 0,
    llmCalls: 5,
    failedLlmCalls: 0,
    llmCostUsd: "1.00",
    activeTenants: 1,
    activeSessions: 1,
    ...overrides,
  };
}

const USER_HIGH_IMPACT = makeUser({ userId: "user_hi", label: "High impact", impactScore: 90, lastSeenAt: "2026-06-22T00:00:00Z", events: 500 });
const USER_LOW_IMPACT = makeUser({ userId: "user_lo", label: "Low impact", impactScore: 5, lastSeenAt: "2026-06-20T00:00:00Z", events: 10, llmCostUsd: "9.00" });
const USER_ANON = makeUser({ userId: null, label: "Anonymous", isAnonymous: true, impactScore: 99 });

function listResponse(over: Partial<UserListResponse> = {}): { data: UserListResponse } {
  return {
    data: {
      window: "7d",
      generatedAt: "",
      scope: { projectId: "p", environmentId: "e" },
      range: { from: "", to: "" },
      users: [USER_HIGH_IMPACT, USER_LOW_IMPACT],
      ...over,
    },
  };
}

function makeClient(over: Partial<ApiClient> = {}) {
  return {
    listUsersActivity: vi.fn().mockResolvedValue(listResponse()),
    ...over,
  } as unknown as Pick<ApiClient, "listUsersActivity">;
}

const BASE = { projectId: "p", environmentId: "e", window: "7d" as const, sort: "impact" as const };

describe("userKey", () => {
  it("collapses anonymous users to _anonymous", () => {
    expect(userKey(USER_ANON)).toBe("_anonymous");
    expect(userKey(USER_HIGH_IMPACT)).toBe("user_hi");
  });

  it("falls back to _anonymous when userId is null even if not flagged anonymous", () => {
    expect(userKey({ userId: null, isAnonymous: false })).toBe("_anonymous");
  });
});

describe("useUsers", () => {
  it("returns rows in server order and sends sort/limit to the server", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useUsers({ client, ...BASE }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.rows.map((r) => r.key)).toEqual(["user_hi", "user_lo"]);
    expect(client.listUsersActivity).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "impact", limit: 50 })
    );
  });

  it("rounds a raw floating-point impact score to at most one decimal in the row VM", async () => {
    const client = makeClient({
      listUsersActivity: vi.fn().mockResolvedValue({
        data: {
          window: "7d", generatedAt: "", scope: { projectId: "p", environmentId: "e" }, range: { from: "", to: "" },
          users: [makeUser({ userId: "user_raw", label: "Raw", impactScore: 172.00814425 })],
        },
      }),
    });
    const { result } = renderHook(() => useUsers({ client, ...BASE }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.rows[0].impactScore).toBe(172);
  });

  it("maps the llmCost view sort to the server's llm_cost wire value", async () => {
    const client = makeClient();
    renderHook(() => useUsers({ client, ...BASE, sort: "llmCost" }));
    await waitFor(() => expect(client.listUsersActivity).toHaveBeenCalled());
    expect(client.listUsersActivity).toHaveBeenCalledWith(expect.objectContaining({ sort: "llm_cost" }));
  });

  it("refetches (resetting the list) when sort changes — sort is server-side now", async () => {
    const client = makeClient();
    const { result, rerender } = renderHook(({ sort }: { sort: UserSort }) => useUsers({ client, ...BASE, sort }), {
      initialProps: { sort: "impact" },
    });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(client.listUsersActivity).toHaveBeenCalledTimes(1);

    rerender({ sort: "llmCost" });
    await waitFor(() => expect(client.listUsersActivity).toHaveBeenCalledTimes(2));
    expect(client.listUsersActivity).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "llm_cost" }));
  });

  it("forwards search and tenantId only when provided", async () => {
    const client = makeClient();
    renderHook(() => useUsers({ client, ...BASE, search: "acme", tenantId: "tenant_1" }));
    await waitFor(() => expect(client.listUsersActivity).toHaveBeenCalled());
    expect(client.listUsersActivity).toHaveBeenCalledWith(
      expect.objectContaining({ search: "acme", tenantId: "tenant_1" })
    );
  });

  it("omits search/tenantId when absent", async () => {
    const client = makeClient();
    renderHook(() => useUsers({ client, ...BASE }));
    await waitFor(() => expect(client.listUsersActivity).toHaveBeenCalled());
    const query = vi.mocked(client.listUsersActivity).mock.calls[0][0];
    expect(query.search).toBeUndefined();
    expect(query.tenantId).toBeUndefined();
  });

  it("sets status to error when the request fails", async () => {
    const client = makeClient({ listUsersActivity: vi.fn().mockRejectedValue(new Error("boom")) } as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useUsers({ client, ...BASE }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
    errSpy.mockRestore();
  });

  it("race-guards against an earlier request resolving after a later one", async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const listUsersActivity = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve(listResponse({ users: [USER_HIGH_IMPACT] })));
    const client = makeClient({ listUsersActivity } as never);
    const { result, rerender } = renderHook(({ tenantId }) => useUsers({ client, ...BASE, tenantId }), {
      initialProps: { tenantId: "a" },
    });
    rerender({ tenantId: "b" });
    await waitFor(() => expect(result.current.status).toBe("ok"));

    // The stale first request resolves after the second — it must not clobber the fresh result.
    resolveFirst(listResponse({ users: [USER_LOW_IMPACT] }));
    await Promise.resolve();
    expect(result.current.data!.rows.map((r) => r.key)).toEqual(["user_hi"]);
  });

  describe("cursor pagination", () => {
    it("hasMore reflects whether the server returned a cursor", async () => {
      const client = makeClient({
        listUsersActivity: vi.fn().mockResolvedValue(listResponse({ cursor: "cursor_1" })),
      } as never);
      const { result } = renderHook(() => useUsers({ client, ...BASE }));
      await waitFor(() => expect(result.current.status).toBe("ok"));
      expect(result.current.data!.hasMore).toBe(true);
    });

    it("loadMore concatenates the next page using the returned cursor instead of replacing the list", async () => {
      const listUsersActivity = vi
        .fn()
        .mockResolvedValueOnce(listResponse({ users: [USER_HIGH_IMPACT], cursor: "cursor_1" }))
        .mockResolvedValueOnce(listResponse({ users: [USER_LOW_IMPACT], cursor: undefined }));
      const client = makeClient({ listUsersActivity } as never);
      const { result } = renderHook(() => useUsers({ client, ...BASE }));

      await waitFor(() => expect(result.current.status).toBe("ok"));
      expect(result.current.data!.rows.map((r) => r.key)).toEqual(["user_hi"]);
      expect(result.current.data!.hasMore).toBe(true);

      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.loadingMore).toBe(false));

      expect(listUsersActivity).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "cursor_1" }));
      expect(result.current.data!.rows.map((r) => r.key)).toEqual(["user_hi", "user_lo"]);
      expect(result.current.data!.hasMore).toBe(false);
    });

    it("loadMore is a no-op without a cursor", async () => {
      const listUsersActivity = vi.fn().mockResolvedValue(listResponse({ cursor: undefined }));
      const client = makeClient({ listUsersActivity } as never);
      const { result } = renderHook(() => useUsers({ client, ...BASE }));
      await waitFor(() => expect(result.current.status).toBe("ok"));

      act(() => result.current.loadMore());
      expect(listUsersActivity).toHaveBeenCalledTimes(1);
    });

    it("resets the cursor and list on reload", async () => {
      const listUsersActivity = vi
        .fn()
        .mockResolvedValueOnce(listResponse({ users: [USER_HIGH_IMPACT], cursor: "cursor_1" }))
        .mockResolvedValueOnce(listResponse({ users: [USER_HIGH_IMPACT], cursor: "cursor_1" }));
      const client = makeClient({ listUsersActivity } as never);
      const { result } = renderHook(() => useUsers({ client, ...BASE }));
      await waitFor(() => expect(result.current.status).toBe("ok"));

      act(() => result.current.reload());
      await waitFor(() => expect(listUsersActivity).toHaveBeenCalledTimes(2));
      const lastQuery = vi.mocked(listUsersActivity).mock.calls[1][0];
      expect(lastQuery.cursor).toBeUndefined();
    });
  });
});
