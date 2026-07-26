// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import type { UserSummary } from "../../api/types";
import { recentValue, sortUsers, sortValue, useUsers, userKey, type UserSort } from "./useUsers";

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
const USER_TIE_A = makeUser({ userId: "user_tie_a", label: "Tie A", impactScore: 50, lastSeenAt: "2026-06-21T00:00:00Z", events: 20 });
const USER_TIE_B = makeUser({ userId: "user_tie_b", label: "Tie B", impactScore: 50, lastSeenAt: "2026-06-21T00:00:00Z", events: 40 });
const USER_ANON = makeUser({ userId: null, label: "Anonymous", isAnonymous: true, impactScore: 99 });

function makeClient(over: Partial<ApiClient> = {}) {
  return {
    listUsersActivity: vi.fn().mockResolvedValue({
      data: { window: "7d", generatedAt: "", scope: { projectId: "p", environmentId: "e" }, range: { from: "", to: "" }, users: [USER_LOW_IMPACT, USER_HIGH_IMPACT] },
    }),
    ...over,
  } as unknown as Pick<ApiClient, "listUsersActivity">;
}

const BASE = { projectId: "p", environmentId: "e", window: "7d" as const, sort: "impact" as const };

describe("userKey / sortValue / recentValue", () => {
  it("collapses anonymous users to _anonymous", () => {
    expect(userKey(USER_ANON)).toBe("_anonymous");
    expect(userKey(USER_HIGH_IMPACT)).toBe("user_hi");
  });

  it("falls back to _anonymous when userId is null even if not flagged anonymous", () => {
    expect(userKey({ userId: null, isAnonymous: false })).toBe("_anonymous");
  });

  it("sortValue reads the right metric per sort", () => {
    expect(sortValue(USER_HIGH_IMPACT, "impact")).toBe(90);
    expect(sortValue(USER_HIGH_IMPACT, "usage")).toBe(500);
    expect(sortValue(USER_LOW_IMPACT, "llmCost")).toBe(9);
    expect(sortValue(USER_HIGH_IMPACT, "recent")).toBe(recentValue(USER_HIGH_IMPACT));
  });
});

describe("sortUsers", () => {
  it("sorts descending by impact by default, tie-broken by lastSeenAt then events then label", () => {
    const sorted = sortUsers([USER_LOW_IMPACT, USER_TIE_B, USER_TIE_A, USER_HIGH_IMPACT], "impact");
    expect(sorted.map((u) => u.userId)).toEqual(["user_hi", "user_tie_b", "user_tie_a", "user_lo"]);
  });

  it("sorts by usage, errors, and llmCost metrics", () => {
    expect(sortUsers([USER_LOW_IMPACT, USER_HIGH_IMPACT], "usage").map((u) => u.userId)).toEqual(["user_hi", "user_lo"]);
    expect(sortUsers([USER_LOW_IMPACT, USER_HIGH_IMPACT], "llmCost").map((u) => u.userId)).toEqual(["user_lo", "user_hi"]);
  });
});

describe("useUsers", () => {
  it("returns rows sorted by impact by default", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useUsers({ client, ...BASE }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.rows.map((r) => r.key)).toEqual(["user_hi", "user_lo"]);
  });

  it("re-sorts without refetching when sort changes", async () => {
    const client = makeClient();
    const { result, rerender } = renderHook(({ sort }: { sort: UserSort }) => useUsers({ client, ...BASE, sort }), {
      initialProps: { sort: "impact" },
    });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    rerender({ sort: "llmCost" });
    expect(result.current.data!.rows.map((r) => r.key)).toEqual(["user_lo", "user_hi"]);
    expect(client.listUsersActivity).toHaveBeenCalledTimes(1);
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
      .mockImplementationOnce(() =>
        Promise.resolve({ data: { window: "7d", generatedAt: "", scope: { projectId: "p", environmentId: "e" }, range: { from: "", to: "" }, users: [USER_HIGH_IMPACT] } })
      );
    const client = makeClient({ listUsersActivity } as never);
    const { result, rerender } = renderHook(({ tenantId }) => useUsers({ client, ...BASE, tenantId }), {
      initialProps: { tenantId: "a" },
    });
    rerender({ tenantId: "b" });
    await waitFor(() => expect(result.current.status).toBe("ok"));

    // The stale first request resolves after the second — it must not clobber the fresh result.
    resolveFirst({ data: { window: "7d", generatedAt: "", scope: { projectId: "p", environmentId: "e" }, range: { from: "", to: "" }, users: [USER_LOW_IMPACT] } });
    await Promise.resolve();
    expect(result.current.data!.rows.map((r) => r.key)).toEqual(["user_hi"]);
  });
});
