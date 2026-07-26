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
  makeTenant({ tenantId: "tenant_acme", label: "Acme Inc", impactScore: 42, events: 1000, errors: 5, llmCostUsd: "12.50" }),
  makeTenant({ tenantId: "tenant_globex", label: "Globex", impactScore: 90, events: 200, errors: 50, llmCostUsd: "80.00", lastSeenAt: "2026-07-24T10:00:00.000Z" }),
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
  it("loads tenants and builds rows sorted by impact by default", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useTenants({ client, projectId: "p", environmentId: "e", window: "24h", search: "", sort: "impact" }));

    await waitFor(() => expect(result.current.status).toBe("ok"));
    const vm = result.current.data!;
    // Globex has higher impactScore (90 > 42) so it sorts first
    expect(vm.rows.map((r) => r.tenantId)).toEqual(["tenant_globex", "tenant_acme"]);
    expect(vm.rows[0].llmCostUsd).toBeCloseTo(80);
    expect(vm.rows[0].keyTraits).toEqual([{ key: "plan", value: "enterprise" }]);
    expect(vm.rows[0].lastSeen).not.toBe("—");
  });

  it("sorts by usage, errors, llmCost, and recent", async () => {
    const client = makeClient();

    const { result: byUsage } = renderHook(() =>
      useTenants({ client, projectId: "p", environmentId: "e", window: "24h", search: "", sort: "usage" }));
    await waitFor(() => expect(byUsage.current.status).toBe("ok"));
    expect(byUsage.current.data!.rows.map((r) => r.tenantId)).toEqual(["tenant_acme", "tenant_globex"]);

    const { result: byErrors } = renderHook(() =>
      useTenants({ client, projectId: "p", environmentId: "e", window: "24h", search: "", sort: "errors" }));
    await waitFor(() => expect(byErrors.current.status).toBe("ok"));
    expect(byErrors.current.data!.rows.map((r) => r.tenantId)).toEqual(["tenant_globex", "tenant_acme"]);

    const { result: byCost } = renderHook(() =>
      useTenants({ client, projectId: "p", environmentId: "e", window: "24h", search: "", sort: "llmCost" }));
    await waitFor(() => expect(byCost.current.status).toBe("ok"));
    expect(byCost.current.data!.rows.map((r) => r.tenantId)).toEqual(["tenant_globex", "tenant_acme"]);

    const { result: byRecent } = renderHook(() =>
      useTenants({ client, projectId: "p", environmentId: "e", window: "24h", search: "", sort: "recent" }));
    await waitFor(() => expect(byRecent.current.status).toBe("ok"));
    expect(byRecent.current.data!.rows.map((r) => r.tenantId)).toEqual(["tenant_globex", "tenant_acme"]);
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

  it("loadMore increases the limit, replaces rows, and tracks hasMore", async () => {
    const listEntityTenants = vi
      .fn()
      .mockResolvedValueOnce(listResponse({ tenants: Array.from({ length: 50 }, (_, i) => makeTenant({ tenantId: `t${i}` })) }))
      .mockResolvedValueOnce(
        listResponse({ tenants: Array.from({ length: 60 }, (_, i) => makeTenant({ tenantId: `t${i}` })) })
      );
    const client = makeClient({ listEntityTenants });
    const { result } = renderHook(() =>
      useTenants({ client, projectId: "p", environmentId: "e", window: "24h", search: "", sort: "impact" }));

    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.rows.length).toBe(50);
    expect(result.current.data!.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(false));

    expect(listEntityTenants.mock.calls[1][0]).toMatchObject({ limit: 100 });
    expect(result.current.data!.rows.length).toBe(60);
    expect(result.current.data!.hasMore).toBe(false);
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

  it("reload triggers a refetch", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useTenants({ client, projectId: "p", environmentId: "e", window: "24h", search: "", sort: "impact" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    act(() => result.current.reload());
    await waitFor(() =>
      expect((client as never as { listEntityTenants: { mock: { calls: unknown[] } } }).listEntityTenants.mock.calls.length).toBe(2)
    );
  });
});
