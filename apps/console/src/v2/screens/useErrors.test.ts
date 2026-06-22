// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AggregateResponse,
  ErrorGroupRecord,
  OverviewResponse,
  QueryListResponse
} from "../../api/types";
import { useErrors } from "./useErrors";

// ---------------------------------------------------------------------------
// Canned data
// ---------------------------------------------------------------------------

function makeGroup(overrides: Partial<ErrorGroupRecord> = {}): ErrorGroupRecord {
  return {
    id: "eg_1",
    projectId: "prj_1",
    environmentId: "env_1",
    groupingFingerprint: "fp1",
    message: "TypeError: cannot read 'x'",
    type: "TypeError",
    topStackFrame: null,
    severity: "error",
    status: "open",
    priority: "urgent",
    firstSeenAt: "2026-06-01T00:00:00Z",
    lastSeenAt: "2026-06-22T00:00:00Z",
    lastRegressedAt: null,
    occurrenceCount: 42,
    affectedUsersCount: 7,
    affectedTenantsCount: 3,
    latestErrorId: "err_1",
    latestRelease: "v1.2.0",
    resolvedAt: null,
    ignoredAt: null,
    assignedToUserId: null,
    incidentNumber: null,
    silencedUntil: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-22T00:00:00Z",
    ...overrides
  };
}

const GROUP_1 = makeGroup({ id: "eg_1", priority: "urgent", status: "open", severity: "critical", latestRelease: "v1.2.0" });
const GROUP_2 = makeGroup({ id: "eg_2", priority: "high", status: "investigating", severity: "error", latestRelease: "v1.2.0" });
const GROUP_3 = makeGroup({ id: "eg_3", priority: "normal", status: "resolved", severity: "fatal", latestRelease: "v1.1.0" });
const GROUP_4 = makeGroup({ id: "eg_4", priority: "low", status: "ignored", severity: "warning", latestRelease: "v1.1.0" });
const GROUP_5 = makeGroup({ id: "eg_5", priority: null, status: "open", severity: "info", latestRelease: null });

const ERROR_GROUPS: ErrorGroupRecord[] = [GROUP_1, GROUP_2, GROUP_3, GROUP_4, GROUP_5];

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
    usage: Array.from({ length: 5 }, (_, i) => ({
      bucketStart: `2026-06-21T${String(i).padStart(2, "0")}:00:00Z`,
      events: i * 10,
      traces: i * 2,
      llmCalls: i
    })),
    errors: Array.from({ length: 5 }, (_, i) => ({
      bucketStart: `2026-06-21T${String(i).padStart(2, "0")}:00:00Z`,
      errors: i + 1,
      openErrors: Math.floor(i / 2),
      severeErrors: 0
    })),
    latency: Array.from({ length: 5 }, (_, i) => ({
      bucketStart: `2026-06-21T${String(i).padStart(2, "0")}:00:00Z`,
      averageTraceDurationMs: 100 + i * 5,
      p95TraceDurationMs: 200 + i * 10
    })),
    aiCost: Array.from({ length: 5 }, (_, i) => ({
      bucketStart: `2026-06-21T${String(i).padStart(2, "0")}:00:00Z`,
      llmCostUsd: String((i * 0.1).toFixed(2)),
      llmCalls: i
    }))
  },
  top: {
    events: [],
    tenantsByUsage: [],
    tenantsByErrors: [],
    tenantsByLlmCalls: [],
    tenantsByLlmCost: [],
    llmProviders: [],
    llmModels: [],
    llmPrompts: [],
    errorSeverity: [
      { severity: "critical", total: 15 },
      { severity: "fatal", total: 5 },
      { severity: "error", total: 50 },
      { severity: "warning", total: 10 }
    ],
    errorStatus: []
  },
  recent: { errors: [], failedTraces: [], failedLlmCalls: [] }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(
  groups: ErrorGroupRecord[] = ERROR_GROUPS,
  overview: OverviewResponse = OVERVIEW
) {
  return {
    listErrorGroups: vi.fn().mockResolvedValue({ data: groups } as QueryListResponse<ErrorGroupRecord>),
    getOverview: vi.fn().mockResolvedValue({ data: overview } as AggregateResponse<OverviewResponse>)
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

describe("useErrors", () => {
  it("starts in loading status and transitions to ok", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data).not.toBeNull();
  });

  it("maps priority: urgent→P1, high→P2, normal→P3, low→P4, null→null", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const rows = result.current.data!.rows;
    const rowById = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(rowById["eg_1"].priority).toBe("P1"); // urgent
    expect(rowById["eg_2"].priority).toBe("P2"); // high
    expect(rowById["eg_3"].priority).toBe("P3"); // normal
    expect(rowById["eg_4"].priority).toBe("P4"); // low
    expect(rowById["eg_5"].priority).toBeNull(); // null
  });

  it("maps row fields: id, message, severity, status, events, users, tenants", async () => {
    const client = makeClient([GROUP_1]);
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const row = result.current.data!.rows[0];
    expect(row.id).toBe("eg_1");
    expect(row.message).toBe("TypeError: cannot read 'x'");
    expect(row.severity).toBe("critical");
    expect(row.status).toBe("open");
    expect(row.events).toBe(42); // occurrenceCount
    expect(row.users).toBe(7);   // affectedUsersCount
    expect(row.tenants).toBe(3); // affectedTenantsCount
  });

  it("row.last is a relative-time string for lastSeenAt", async () => {
    const recentGroup = makeGroup({ lastSeenAt: new Date(Date.now() - 60_000).toISOString() });
    const client = makeClient([recentGroup]);
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const row = result.current.data!.rows[0];
    expect(typeof row.last).toBe("string");
    expect(row.last.length).toBeGreaterThan(0);
    // should look like "1m ago" or similar relative time
    expect(row.last).toMatch(/ago|just now|s ago|m ago|h ago|d ago/i);
  });

  it("row has no 'trend' field", async () => {
    const client = makeClient([GROUP_1]);
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const row = result.current.data!.rows[0];
    expect("trend" in row).toBe(false);
  });

  it("summary.errors24h = kpis.errors from overview", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    expect(result.current.data!.summary.errors24h).toBe(80);
  });

  it("summary.critical = sum of top.errorSeverity where severity is critical or fatal", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    // critical=15, fatal=5 → 20
    expect(result.current.data!.summary.critical).toBe(20);
  });

  it("summary.openGroups = count of fetched rows with status open or investigating", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    // GROUP_1=open, GROUP_2=investigating, GROUP_3=resolved, GROUP_4=ignored, GROUP_5=open → 3
    expect(result.current.data!.summary.openGroups).toBe(3);
  });

  it("summary.mttr is always null", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    expect(result.current.data!.summary.mttr).toBeNull();
  });

  it("summary.topRelease = most frequent latestRelease among rows", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    // v1.2.0 appears in GROUP_1, GROUP_2 (2 times)
    // v1.1.0 appears in GROUP_3, GROUP_4 (2 times)
    // null in GROUP_5
    // tie: both v1.2.0 and v1.1.0 have count 2 — whichever is first wins
    const topRelease = result.current.data!.summary.topRelease;
    expect(topRelease).toBe("v1.2.0");
  });

  it("summary.topRelease is null when all latestRelease are null", async () => {
    const groups = [makeGroup({ latestRelease: null }), makeGroup({ latestRelease: null })];
    const client = makeClient(groups);
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    expect(result.current.data!.summary.topRelease).toBeNull();
  });

  it("volume = trends.errors[].errors", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    // OVERVIEW.trends.errors has 5 buckets with errors 1,2,3,4,5
    expect(result.current.data!.volume).toEqual([1, 2, 3, 4, 5]);
  });

  it("tabs mapped from overview.kpis: events, errors, traces, llm, tenants, users", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    const { tabs } = result.current.data!;
    expect(tabs.events).toBe(5000);
    expect(tabs.errors).toBe(80);
    expect(tabs.traces).toBe(400);
    expect(tabs.llm).toBe(200);    // kpis.llmCalls
    expect(tabs.tenants).toBe(10); // kpis.activeTenants
    expect(tabs.users).toBe(42);   // kpis.activeUsers
  });

  it("passes severity filter to listErrorGroups", async () => {
    const client = makeClient();
    renderHook(() => useErrors({ client, ...BASE_PARAMS, severity: "critical" }));

    await waitFor(() => expect(client.listErrorGroups).toHaveBeenCalled());

    expect(client.listErrorGroups).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "critical" })
    );
  });

  it("passes status filter to listErrorGroups", async () => {
    const client = makeClient();
    renderHook(() => useErrors({ client, ...BASE_PARAMS, status: "open" }));

    await waitFor(() => expect(client.listErrorGroups).toHaveBeenCalled());

    expect(client.listErrorGroups).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open" })
    );
  });

  it("passes correct projectId and environmentId to both calls", async () => {
    const client = makeClient();
    renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(client.getOverview).toHaveBeenCalled());

    expect(client.listErrorGroups).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "prj_1", environmentId: "env_1" })
    );
    expect(client.getOverview).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "prj_1", environmentId: "env_1", window: "24h" })
    );
  });

  it("makes both API calls concurrently on mount", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    expect(client.listErrorGroups).toHaveBeenCalledTimes(1);
    expect(client.getOverview).toHaveBeenCalledTimes(1);
  });

  it("sets status to error when listErrorGroups fails", async () => {
    const client = {
      listErrorGroups: vi.fn().mockRejectedValue(new Error("network error")),
      getOverview: vi.fn().mockResolvedValue({ data: OVERVIEW })
    };

    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });

  it("sets status to error when getOverview fails", async () => {
    const client = {
      listErrorGroups: vi.fn().mockResolvedValue({ data: ERROR_GROUPS }),
      getOverview: vi.fn().mockRejectedValue(new Error("network error"))
    };

    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });

  it("reload() refetches data", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(client.listErrorGroups).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.reload();
    });

    await waitFor(() => expect(client.listErrorGroups).toHaveBeenCalledTimes(2));
    expect(client.getOverview).toHaveBeenCalledTimes(2);
  });

  it("refetches when projectId changes", async () => {
    const client = makeClient();
    let projectId = "prj_1";
    const { result, rerender } = renderHook(() =>
      useErrors({ client, projectId, environmentId: "env_1", window: "24h" })
    );

    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(client.listErrorGroups).toHaveBeenCalledTimes(1);

    projectId = "prj_2";
    rerender();

    await waitFor(() => expect(client.listErrorGroups).toHaveBeenCalledTimes(2));
    expect(client.listErrorGroups).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: "prj_2" })
    );
  });

  it("refetches when severity filter changes", async () => {
    const client = makeClient();
    let severity: string | undefined = undefined;
    const { result, rerender } = renderHook(() =>
      useErrors({ client, ...BASE_PARAMS, severity })
    );

    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(client.listErrorGroups).toHaveBeenCalledTimes(1);

    severity = "critical";
    rerender();

    await waitFor(() => expect(client.listErrorGroups).toHaveBeenCalledTimes(2));
    expect(client.listErrorGroups).toHaveBeenLastCalledWith(
      expect.objectContaining({ severity: "critical" })
    );
  });

  it("does not update state after unmount (generation guard)", async () => {
    let resolveGroups!: (v: QueryListResponse<ErrorGroupRecord>) => void;
    const pendingGroups = new Promise<QueryListResponse<ErrorGroupRecord>>((res) => {
      resolveGroups = res;
    });

    const client = {
      listErrorGroups: vi.fn().mockReturnValue(pendingGroups),
      getOverview: vi.fn().mockResolvedValue({ data: OVERVIEW })
    };

    const { result, unmount } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    unmount();

    act(() => {
      resolveGroups({ data: ERROR_GROUPS });
    });

    // Status must remain loading — generation guard prevented setState
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();
  });

  it("stale fetch does not overwrite fresh data (generation counter)", async () => {
    let resolveStale!: (v: QueryListResponse<ErrorGroupRecord>) => void;
    const stalePromise = new Promise<QueryListResponse<ErrorGroupRecord>>((res) => {
      resolveStale = res;
    });

    const freshGroup = makeGroup({ id: "fresh_1", message: "FreshError", occurrenceCount: 9999 });

    let callCount = 0;
    const client = {
      listErrorGroups: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return stalePromise;
        return Promise.resolve({ data: [freshGroup] } as QueryListResponse<ErrorGroupRecord>);
      }),
      getOverview: vi.fn().mockResolvedValue({ data: OVERVIEW })
    };

    const { result } = renderHook(() => useErrors({ client, ...BASE_PARAMS }));

    // Trigger a second (fresh) fetch before the first one resolves
    act(() => {
      result.current.reload();
    });

    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.rows[0].events).toBe(9999);

    // Resolve the stale promise — must NOT overwrite fresh data
    act(() => {
      resolveStale({ data: ERROR_GROUPS });
    });

    // Fresh data still wins
    expect(result.current.data!.rows[0].events).toBe(9999);
  });
});
