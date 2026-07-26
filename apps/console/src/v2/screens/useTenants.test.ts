// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTenants } from "./useTenants";
import type { AggregateResponse, TenantListResponse, TenantSummary } from "../../api/types";

afterEach(() => vi.restoreAllMocks());

function makeTenant(over: Partial<TenantSummary> = {}): TenantSummary {
  return {
    tenantId: "tenant_acme",
    label: "Acme Inc",
    traits: {},
    keyTraits: { plan: "enterprise" },
    isUnassigned: false,
    impactScore: 42,
    lastSeenAt: "2026-07-20T10:00:00.000Z",
    events: 1000,
    errors: 5,
    openErrors: 2,
    severeErrors: 1,
    traces: 200,
    failedTraces: 3,
    llmCalls: 80,
    failedLlmCalls: 1,
    llmCostUsd: "12.50",
    activeUsers: 30,
    activeSessions: 40,
    ...over,
  };
}

const tenants: TenantSummary[] = [
  makeTenant({ tenantId: "tenant_globex", label: "Globex", impactScore: 90, events: 200, errors: 50, llmCostUsd: "80.00", lastSeenAt: "2026-07-24T10:00:00.000Z" }),
  makeTenant({ tenantId: "tenant_acme", label: "Acme Inc", impactScore: 42, events: 1000, errors: 5, llmCostUsd: "12.50" }),
];

function listResponse(over: Partial<TenantListResponse> = {}): AggregateResponse<TenantListResponse> {
  return {
    data: {
      window: "24h",
      generatedAt: "2026-07-25T00:00:00.000Z",
      scope: { projectId: "p", environmentId: "e" },
      range: { from: "2026-07-24T00:00:00.000Z", to: "2026-07-25T00:00:00.000Z" },
      tenants,
      ...over,
    },
  };
}

function makeClient(over: Record<string, unknown> = {}) {
  return {
    listEntityTenants: vi.fn(async () => listResponse()),
    ...over,
  } as never;
}

describe("useTenants", () => {
  it("loads tenants in server order and sends sort/limit to the server", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useTenants({ client, projectId: "p", environmentId: "e", window: "24h", search: "", sort: "impact" }));

    await waitFor(() => expect(result.current.status).toBe("ok"));
    const vm = result.current.data!;
    expect(vm.rows.map((r) => r.tenantId)).toEqual(["tenant_globex", "tenant_acme"]);
    expect(vm.rows[0].llmCostUsd).toBeCloseTo(80);
    expect(vm.rows[0].keyTraits).toEqual([{ key: "plan", value: "enterprise" }]);
    expect(vm.rows[0].lastSeen).not.toBe("—");
    expect((client as never as { listEntityTenants: { mock: { calls: unknown[][] } } }).listEntityTenants.mock.calls[0][0]).toMatchObject({
      sort: "impact",
      limit: 50,
    });
  });

  it("maps the llmCost view sort to the server's llm_cost wire value and refetches on sort change", async () => {
    const client = makeClient();
    const { result, rerender } = renderHook(
      ({ sort }: { sort: "impact" | "usage" | "errors" | "llmCost" | "recent" }) =>
        useTenants({ client, projectId: "p", environmentId: "e", window: "24h", search: "", sort }),
      { initialProps: { sort: "impact" } }
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect((client as never as { listEntityTenants: { mock: { calls: unknown[] } } }).listEntityTenants.mock.calls.length).toBe(1);

    rerender({ sort: "llmCost" });
    await waitFor(() =>
      expect((client as never as { listEntityTenants: { mock: { calls: unknown[] } } }).listEntityTenants.mock.calls.length).toBe(2)
    );
    expect((client as never as { listEntityTenants: { mock: { calls: unknown[][] } } }).listEntityTenants.mock.calls[1][0]).toMatchObject({
      sort: "llm_cost",
    });
  });

  it("passes trimmed search to the client and refetches on search change", async () => {
    const client = makeClient();
    const { rerender } = renderHook(
      ({ search }) => useTenants({ client, projectId: "p", environmentId: "e", window: "24h", search, sort: "impact" }),
      { initialProps: { search: "" } }
    );

    await waitFor(() => expect((client as never as { listEntityTenants: { mock: { calls: unknown[] } } }).listEntityTenants.mock.calls.length).toBe(1));

    rerender({ search: "  acme  " });
    await waitFor(() => expect((client as never as { listEntityTenants: { mock: { calls: unknown[] } } }).listEntityTenants.mock.calls.length).toBe(2));

    const lastCall = (client as never as { listEntityTenants: { mock: { calls: unknown[][] } } }).listEntityTenants.mock.calls[1][0] as {
      search?: string;
    };
    expect(lastCall.search).toBe("acme");
  });

  it("loadMore concatenates the next page via cursor instead of replacing the list", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => makeTenant({ tenantId: `t${i}` }));
    const page2 = Array.from({ length: 10 }, (_, i) => makeTenant({ tenantId: `t${50 + i}` }));
    const listEntityTenants = vi
      .fn()
      .mockResolvedValueOnce(listResponse({ tenants: page1, cursor: "cursor_1" }))
      .mockResolvedValueOnce(listResponse({ tenants: page2, cursor: undefined }));
    const client = makeClient({ listEntityTenants });
    const { result } = renderHook(() =>
      useTenants({ client, projectId: "p", environmentId: "e", window: "24h", search: "", sort: "impact" }));

    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.rows.length).toBe(50);
    expect(result.current.data!.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(false));

    expect(listEntityTenants.mock.calls[1][0]).toMatchObject({ limit: 50, cursor: "cursor_1" });
    expect(result.current.data!.rows.length).toBe(60);
    expect(result.current.data!.hasMore).toBe(false);
  });

  it("loadMore is a no-op without a cursor", async () => {
    const listEntityTenants = vi.fn().mockResolvedValue(listResponse({ cursor: undefined }));
    const client = makeClient({ listEntityTenants });
    const { result } = renderHook(() =>
      useTenants({ client, projectId: "p", environmentId: "e", window: "24h", search: "", sort: "impact" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    act(() => result.current.loadMore());
    expect(listEntityTenants).toHaveBeenCalledTimes(1);
  });

  it("sets error status and clears data when the request fails", async () => {
    const client = makeClient({ listEntityTenants: vi.fn(async () => { throw new Error("boom"); }) });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useTenants({ client, projectId: "p", environmentId: "e", window: "24h", search: "", sort: "impact" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
    errSpy.mockRestore();
  });

  it("does nothing without project/environment scope", () => {
    const client = makeClient();
    renderHook(() => useTenants({ client, projectId: undefined, environmentId: undefined, window: "24h", search: "", sort: "impact" }));
    expect((client as never as { listEntityTenants: { mock: { calls: unknown[] } } }).listEntityTenants.mock.calls.length).toBe(0);
  });

  it("reload triggers a refetch and resets any cursor", async () => {
    const listEntityTenants = vi.fn().mockResolvedValue(listResponse({ cursor: "cursor_1" }));
    const client = makeClient({ listEntityTenants });
    const { result } = renderHook(() =>
      useTenants({ client, projectId: "p", environmentId: "e", window: "24h", search: "", sort: "impact" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    act(() => result.current.reload());
    await waitFor(() => expect(listEntityTenants.mock.calls.length).toBe(2));
    const lastQuery = listEntityTenants.mock.calls[1][0] as { cursor?: string };
    expect(lastQuery.cursor).toBeUndefined();
  });
});
