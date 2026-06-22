// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AggregateResponse, OperationsResponse, OverviewResponse, TenantListResponse } from "../../api/types";
import { useOverview } from "./useOverview";

// ---------------------------------------------------------------------------
// Canned data
// ---------------------------------------------------------------------------

const OVERVIEW: OverviewResponse = {
  window: "24h",
  generatedAt: "2026-06-22T00:00:00Z",
  scope: { projectId: "prj_1", environmentId: "env_1" },
  range: { from: "2026-06-21T00:00:00Z", to: "2026-06-22T00:00:00Z", bucket: "hour" },
  kpis: {
    events: 5000,
    activeUsers: 42,
    activeTenants: 10,
    errors: 80,
    openErrors: 20,
    traces: 400,
    failedTraces: 12,
    averageTraceDurationMs: 150,
    p95TraceDurationMs: 320,
    llmCalls: 200,
    failedLlmCalls: 5,
    llmInputTokens: 100000,
    llmOutputTokens: 50000,
    llmCostUsd: "3.50"
  },
  trends: {
    usage: Array.from({ length: 15 }, (_, i) => ({
      bucketStart: `2026-06-21T${String(i).padStart(2, "0")}:00:00Z`,
      events: i * 10,
      traces: i * 2,
      llmCalls: i
    })),
    errors: Array.from({ length: 15 }, (_, i) => ({
      bucketStart: `2026-06-21T${String(i).padStart(2, "0")}:00:00Z`,
      errors: i,
      openErrors: Math.floor(i / 2),
      severeErrors: 0
    })),
    latency: Array.from({ length: 15 }, (_, i) => ({
      bucketStart: `2026-06-21T${String(i).padStart(2, "0")}:00:00Z`,
      averageTraceDurationMs: 100 + i * 5,
      p95TraceDurationMs: 200 + i * 10
    })),
    aiCost: Array.from({ length: 15 }, (_, i) => ({
      bucketStart: `2026-06-21T${String(i).padStart(2, "0")}:00:00Z`,
      llmCostUsd: String((i * 0.1).toFixed(2)),
      llmCalls: i
    }))
  },
  top: {
    events: [{ name: "page_view", total: 3000 }],
    tenantsByUsage: [],
    tenantsByErrors: [],
    tenantsByLlmCalls: [],
    tenantsByLlmCost: [],
    llmProviders: [],
    llmModels: [
      { model: "gpt-4o", total: 120, totalCostUsd: "2.50" },
      { model: "claude-3-5-sonnet", total: 80, totalCostUsd: "1.00" }
    ],
    llmPrompts: [],
    errorSeverity: [],
    errorStatus: []
  },
  recent: {
    errors: [
      {
        id: "err_1",
        timestamp: "2026-06-22T00:05:00Z",
        message: "TypeError: Cannot read property 'x' of undefined",
        type: "TypeError",
        severity: "error",
        status: "open",
        tenantId: "t1",
        userId: null,
        traceId: null
      },
      {
        id: "err_2",
        timestamp: "2026-06-22T00:01:00Z",
        message: "SyntaxError: Unexpected token",
        type: "SyntaxError",
        severity: "warning",
        status: "open",
        tenantId: null,
        userId: null,
        traceId: null
      }
    ],
    failedTraces: [
      {
        id: "trace_1",
        timestamp: "2026-06-22T00:03:00Z",
        name: "/api/checkout",
        status: "error",
        durationMs: 512,
        tenantId: null,
        userId: "u1"
      }
    ],
    failedLlmCalls: [
      {
        id: "llm_1",
        timestamp: "2026-06-22T00:04:00Z",
        provider: "openai",
        model: "gpt-4o",
        promptName: "summarize",
        status: "error",
        costUsd: "0.02",
        tenantId: null,
        userId: null,
        traceId: null
      }
    ]
  }
};

const OPERATIONS: OperationsResponse = {
  window: "24h",
  generatedAt: "2026-06-22T00:00:00Z",
  scope: { projectId: "prj_1", environmentId: "env_1" },
  range: { from: "2026-06-21T00:00:00Z", to: "2026-06-22T00:00:00Z" },
  status: "degraded",
  summary: {
    monitors: {
      total: 3,
      http: { total: 2, up: 1, degraded: 0, down: 1, paused: 0, unknown: 0 },
      heartbeat: { total: 1, up: 1, degraded: 0, down: 0, paused: 0, unknown: 0 }
    },
    alerts: {
      rules: { total: 5, enabled: 5 },
      events: { total: 2, critical: 1, warning: 1, deliveryFailed: 0, deliveryPending: 0 }
    },
    telemetry: {
      events: 5000,
      errors: 80,
      traces: 400,
      failedTraces: 12,
      errorRatePercent: 20.0,
      p95TraceDurationMs: 320,
      lastEventAt: "2026-06-22T00:05:00Z",
      lastErrorAt: "2026-06-22T00:05:00Z",
      lastTraceAt: "2026-06-22T00:04:00Z"
    },
    incidents: {
      open: 2,
      investigating: 1,
      urgent: 1,
      high: 1,
      regressed: 0
    }
  },
  recent: {
    monitors: [],
    alerts: [
      {
        id: "alert_1",
        severity: "critical",
        triggeredAt: "2026-06-22T00:00:00Z",
        message: "P95 latency exceeded threshold",
        latestDeliveryStatus: "success"
      },
      {
        id: "alert_2",
        severity: "warning",
        triggeredAt: "2026-06-21T23:30:00Z",
        message: "Error rate high",
        latestDeliveryStatus: null
      }
    ],
    incidents: [
      {
        id: "inc_1",
        message: "NullPointerException in checkout flow",
        severity: "critical",
        status: "open",
        priority: "urgent",
        lastSeenAt: "2026-06-22T00:05:00Z",
        latestErrorId: "err_1"
      }
    ]
  },
  topLatency: [],
  setupGaps: []
};

const TENANTS: TenantListResponse = {
  window: "24h",
  generatedAt: "2026-06-22T00:00:00Z",
  scope: { projectId: "prj_1", environmentId: "env_1" },
  range: { from: "2026-06-21T00:00:00Z", to: "2026-06-22T00:00:00Z" },
  tenants: [
    {
      tenantId: "t_b",
      label: "Acme Corp",
      traits: {},
      keyTraits: {},
      isUnassigned: false,
      impactScore: 0.9,
      lastSeenAt: "2026-06-22T00:05:00Z",
      events: 2000,
      errors: 5,
      openErrors: 2,
      severeErrors: 0,
      traces: 100,
      failedTraces: 2,
      llmCalls: 50,
      failedLlmCalls: 0,
      llmCostUsd: "1.20",
      activeUsers: 10,
      activeSessions: 5
    },
    {
      tenantId: "t_a",
      label: "Beta LLC",
      traits: {},
      keyTraits: {},
      isUnassigned: false,
      impactScore: 0.7,
      lastSeenAt: "2026-06-22T00:04:00Z",
      events: 3000,
      errors: 2,
      openErrors: 1,
      severeErrors: 0,
      traces: 80,
      failedTraces: 1,
      llmCalls: 20,
      failedLlmCalls: 0,
      llmCostUsd: "0.80",
      activeUsers: 5,
      activeSessions: 3
    },
    {
      tenantId: "t_c",
      label: "Gamma Inc",
      traits: {},
      keyTraits: {},
      isUnassigned: false,
      impactScore: 0.5,
      lastSeenAt: "2026-06-22T00:03:00Z",
      events: 500,
      errors: 1,
      openErrors: 0,
      severeErrors: 0,
      traces: 20,
      failedTraces: 0,
      llmCalls: 5,
      failedLlmCalls: 0,
      llmCostUsd: "0.10",
      activeUsers: 2,
      activeSessions: 1
    }
  ]
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(
  overviewData: OverviewResponse = OVERVIEW,
  operationsData: OperationsResponse = OPERATIONS,
  tenantsData: TenantListResponse = TENANTS
) {
  return {
    getOverview: vi.fn().mockResolvedValue({ data: overviewData } as AggregateResponse<OverviewResponse>),
    getOperations: vi.fn().mockResolvedValue({ data: operationsData } as AggregateResponse<OperationsResponse>),
    listEntityTenants: vi.fn().mockResolvedValue({ data: tenantsData } as AggregateResponse<TenantListResponse>)
  };
}

const BASE_PARAMS = {
  projectId: "prj_1",
  environmentId: "env_1",
  window: "24h" as const
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useOverview", () => {
  it("starts in loading status and transitions to ok", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.status).toBe("ok"));

    expect(result.current.data).not.toBeNull();
  });

  it("maps banner from operations — incident present", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const { banner } = result.current.data!;
    // incidents = open + investigating = 2 + 1 = 3
    expect(banner.incidents).toBe(3);
    // alerts events total = 2
    expect(banner.alerts).toBe(2);
    // top incident comes from recent.incidents[0]
    expect(banner.top).not.toBeNull();
    expect(banner.top!.message).toBe("NullPointerException in checkout flow");
    expect(banner.top!.severity).toBe("critical");
  });

  it("maps banner all-clear when no incidents and no alerts", async () => {
    const opsAllClear: OperationsResponse = {
      ...OPERATIONS,
      summary: {
        ...OPERATIONS.summary,
        incidents: { open: 0, investigating: 0, urgent: 0, high: 0, regressed: 0 },
        alerts: {
          rules: { total: 0, enabled: 0 },
          events: { total: 0, critical: 0, warning: 0, deliveryFailed: 0, deliveryPending: 0 }
        }
      },
      recent: { ...OPERATIONS.recent, incidents: [] }
    };

    const client = makeClient(OVERVIEW, opsAllClear);
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const { banner } = result.current.data!;
    expect(banner.incidents).toBe(0);
    expect(banner.alerts).toBe(0);
    expect(banner.top).toBeNull();
  });

  it("computes errorRate correctly when traces > 0", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const { kpis } = result.current.data!;
    // errors=80, traces=400 → 80/400*100 = 20
    expect(kpis.errorRate).toBeCloseTo(20);
  });

  it("sets errorRate to null when traces = 0", async () => {
    const noTracesOverview: OverviewResponse = {
      ...OVERVIEW,
      kpis: { ...OVERVIEW.kpis, traces: 0, errors: 0 }
    };

    const client = makeClient(noTracesOverview);
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    expect(result.current.data!.kpis.errorRate).toBeNull();
  });

  it("maps kpis from overview (p95, llmCostUsd, topModel)", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const { kpis } = result.current.data!;
    expect(kpis.p95TraceDurationMs).toBe(320);
    expect(kpis.llmCostUsd).toBe("3.50");
    expect(kpis.topModel).toBe("gpt-4o");
  });

  it("maps averageTraceDurationMs from overview kpis", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    // OVERVIEW.kpis.averageTraceDurationMs = 150
    expect(result.current.data!.kpis.averageTraceDurationMs).toBe(150);
  });

  it("sets averageTraceDurationMs to null when missing from api response", async () => {
    const noAvg: OverviewResponse = {
      ...OVERVIEW,
      kpis: { ...OVERVIEW.kpis, averageTraceDurationMs: undefined as unknown as number }
    };
    const client = makeClient(noAvg);
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    expect(result.current.data!.kpis.averageTraceDurationMs).toBeNull();
  });

  it("sparklines are last 12 buckets of trends", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const { kpis } = result.current.data!;
    // trends have 15 buckets; last 12 = indices 3..14
    expect(kpis.errorsSparkline).toHaveLength(12);
    expect(kpis.usageSparkline).toHaveLength(12);
    expect(kpis.latencySparkline).toHaveLength(12);
    expect(kpis.aiCostSparkline).toHaveLength(12);
    // The last bucket of errors trend (index 14) has errors=14
    expect(kpis.errorsSparkline[11]).toBe(14);
  });

  it("activity is merged and sorted by timestamp descending", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const { activity } = result.current.data!;
    // We have: err_1 @00:05, llm_1 @00:04, trace_1 @00:03, err_2 @00:01
    expect(activity).toHaveLength(4);
    expect(activity[0].kind).toBe("error");
    expect(activity[0].timestamp).toBe("2026-06-22T00:05:00Z");
    expect(activity[1].kind).toBe("llm");
    expect(activity[1].timestamp).toBe("2026-06-22T00:04:00Z");
    expect(activity[2].kind).toBe("trace");
    expect(activity[2].timestamp).toBe("2026-06-22T00:03:00Z");
    expect(activity[3].kind).toBe("error");
    expect(activity[3].timestamp).toBe("2026-06-22T00:01:00Z");
  });

  it("activity items have correct kind, title, sub fields", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const { activity } = result.current.data!;
    const errorItem = activity[0];
    expect(errorItem.kind).toBe("error");
    expect(errorItem.title).toBe("TypeError: Cannot read property 'x' of undefined");
    expect(errorItem.sub).toBe("TypeError");

    const llmItem = activity[1];
    expect(llmItem.kind).toBe("llm");
    expect(llmItem.title).toContain("gpt-4o");

    const traceItem = activity[2];
    expect(traceItem.kind).toBe("trace");
    expect(traceItem.title).toBe("/api/checkout");
  });

  it("topTenants sorted by events descending, limited to 5", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const { topTenants } = result.current.data!;
    // t_a has 3000 events, t_b has 2000, t_c has 500
    expect(topTenants[0].id).toBe("t_a");
    expect(topTenants[0].events).toBe(3000);
    expect(topTenants[0].name).toBe("Beta LLC");
    expect(topTenants[1].id).toBe("t_b");
    expect(topTenants[1].events).toBe(2000);
    expect(topTenants).toHaveLength(3); // only 3 tenants in mock
  });

  it("topTenants maps costUsd and errors fields", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const { topTenants } = result.current.data!;
    expect(topTenants[0].costUsd).toBe("0.80"); // Beta LLC = t_a
    expect(topTenants[0].errors).toBe(2);
  });

  it("llmByModel maps top.llmModels to {model, costUsd}", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const { llmByModel } = result.current.data!;
    expect(llmByModel).toHaveLength(2);
    expect(llmByModel[0].model).toBe("gpt-4o");
    expect(llmByModel[0].costUsd).toBe("2.50");
    expect(llmByModel[1].model).toBe("claude-3-5-sonnet");
    expect(llmByModel[1].costUsd).toBe("1.00");
  });

  it("fires all three client calls concurrently on mount", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    expect(client.getOverview).toHaveBeenCalledTimes(1);
    expect(client.getOperations).toHaveBeenCalledTimes(1);
    expect(client.listEntityTenants).toHaveBeenCalledTimes(1);
  });

  it("passes correct query params to each client call", async () => {
    const client = makeClient();
    renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(client.getOverview).toHaveBeenCalled());

    expect(client.getOverview).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "24h"
    });
    expect(client.getOperations).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "24h"
    });
    expect(client.listEntityTenants).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        window: "24h",
        limit: 5
      })
    );
  });

  it("sets status to error when any call fails", async () => {
    const client = {
      getOverview: vi.fn().mockRejectedValue(new Error("network error")),
      getOperations: vi.fn().mockResolvedValue({ data: OPERATIONS }),
      listEntityTenants: vi.fn().mockResolvedValue({ data: TENANTS })
    };

    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });

  it("reload() refetches data", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    expect(client.getOverview).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.reload();
    });

    await waitFor(() => expect(client.getOverview).toHaveBeenCalledTimes(2));
  });

  it("does not update state after unmount (generation guard prevents post-unmount setState)", async () => {
    let resolveOverview!: (v: AggregateResponse<OverviewResponse>) => void;
    const pendingOverview = new Promise<AggregateResponse<OverviewResponse>>((res) => {
      resolveOverview = res;
    });

    const client = {
      getOverview: vi.fn().mockReturnValue(pendingOverview),
      getOperations: vi.fn().mockResolvedValue({ data: OPERATIONS }),
      listEntityTenants: vi.fn().mockResolvedValue({ data: TENANTS })
    };

    const { result, unmount } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    unmount();

    // Resolving after unmount should not throw / cause state updates
    act(() => {
      resolveOverview({ data: OVERVIEW });
    });

    // Status must remain loading — the generation guard prevented setState
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();
  });

  it("rapid reload() does not let stale fetch overwrite fresh data (generation counter)", async () => {
    // First call returns a deferred promise (slow / stale)
    let resolveStale!: (v: AggregateResponse<OverviewResponse>) => void;
    const stalePromise = new Promise<AggregateResponse<OverviewResponse>>((res) => {
      resolveStale = res;
    });

    // Second call resolves immediately with fresh data
    const freshOverview: OverviewResponse = {
      ...OVERVIEW,
      kpis: { ...OVERVIEW.kpis, events: 9999 }
    };

    let callCount = 0;
    const client = {
      getOverview: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return stalePromise;
        return Promise.resolve({ data: freshOverview } as AggregateResponse<OverviewResponse>);
      }),
      getOperations: vi.fn().mockResolvedValue({ data: OPERATIONS }),
      listEntityTenants: vi.fn().mockResolvedValue({ data: TENANTS })
    };

    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    // Trigger a second (fresh) fetch before the first one resolves
    act(() => {
      result.current.reload();
    });

    // Wait for the fresh fetch to settle
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.kpis.events).toBe(9999);

    // Now resolve the original stale promise — must NOT overwrite fresh data
    act(() => {
      resolveStale({ data: OVERVIEW }); // OVERVIEW has events=5000
    });

    // After stale resolution, fresh data (9999) must still be present
    expect(result.current.data!.kpis.events).toBe(9999);
  });

  it("topModel is null when llmModels is empty", async () => {
    const noModels: OverviewResponse = {
      ...OVERVIEW,
      top: { ...OVERVIEW.top, llmModels: [] }
    };

    const client = makeClient(noModels);
    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    expect(result.current.data!.kpis.topModel).toBeNull();
  });

  it("handles missing getOperations gracefully (all-clear banner)", async () => {
    const client = {
      getOverview: vi.fn().mockResolvedValue({ data: OVERVIEW }),
      getOperations: undefined,
      listEntityTenants: vi.fn().mockResolvedValue({ data: TENANTS })
    };

    const { result } = renderHook(() => useOverview({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    expect(result.current.data!.banner.incidents).toBe(0);
    expect(result.current.data!.banner.top).toBeNull();
  });
});
