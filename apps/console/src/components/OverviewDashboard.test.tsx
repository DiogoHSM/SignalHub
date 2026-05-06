import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { OverviewResponse } from "../api/types";
import { OverviewDashboard } from "./OverviewDashboard";

function overviewResponse(overrides: Partial<OverviewResponse> = {}): OverviewResponse {
  return {
    window: "24h",
    generatedAt: "2026-05-05T12:00:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: {
      from: "2026-05-04T12:00:00.000Z",
      to: "2026-05-05T12:00:00.000Z",
      bucket: "hour"
    },
    kpis: {
      events: 18,
      activeUsers: 4,
      activeTenants: 2,
      errors: 3,
      openErrors: 1,
      traces: 7,
      failedTraces: 1,
      averageTraceDurationMs: 250,
      p95TraceDurationMs: 400,
      llmCalls: 5,
      failedLlmCalls: 1,
      llmInputTokens: 1200,
      llmOutputTokens: 800,
      llmCostUsd: "1.250000"
    },
    trends: {
      usage: [
        { bucketStart: "2026-05-05T10:00:00.000Z", events: 10, traces: 4, llmCalls: 2 },
        { bucketStart: "2026-05-05T11:00:00.000Z", events: 18, traces: 7, llmCalls: 5 }
      ],
      errors: [
        { bucketStart: "2026-05-05T10:00:00.000Z", errors: 1, openErrors: 1, severeErrors: 0 },
        { bucketStart: "2026-05-05T11:00:00.000Z", errors: 3, openErrors: 1, severeErrors: 1 }
      ],
      latency: [
        { bucketStart: "2026-05-05T10:00:00.000Z", averageTraceDurationMs: 125, p95TraceDurationMs: 250 },
        { bucketStart: "2026-05-05T11:00:00.000Z", averageTraceDurationMs: 250, p95TraceDurationMs: 400 }
      ],
      aiCost: [
        { bucketStart: "2026-05-05T10:00:00.000Z", llmCostUsd: "0.500000", llmCalls: 2 },
        { bucketStart: "2026-05-05T11:00:00.000Z", llmCostUsd: "1.250000", llmCalls: 5 }
      ]
    },
    top: {
      events: [{ name: "dashboard_created", total: 8 }],
      tenantsByUsage: [{ tenantId: "tenant_1", total: 10 }],
      tenantsByErrors: [{ tenantId: "tenant_1", total: 2 }],
      tenantsByLlmCalls: [{ tenantId: "tenant_1", total: 5 }],
      tenantsByLlmCost: [{ tenantId: "tenant_1", totalCostUsd: "1.250000" }],
      llmProviders: [{ provider: "openai", total: 5, totalCostUsd: "1.250000" }],
      llmModels: [{ model: "gpt-5", total: 5, totalCostUsd: "1.250000" }],
      llmPrompts: [{ promptName: "summarize_signal", total: 3, totalCostUsd: "0.750000" }],
      errorSeverity: [{ severity: "critical", total: 1 }],
      errorStatus: [{ status: "open", total: 1 }]
    },
    recent: {
      errors: [
        {
          id: "err_1",
          timestamp: "2026-05-05T12:00:00.000Z",
          message: "Checkout fetch failed",
          type: "TypeError",
          severity: "critical",
          status: "open",
          tenantId: "tenant_1",
          userId: "user_1",
          traceId: "trace_1"
        }
      ],
      failedTraces: [
        {
          id: "trc_1",
          timestamp: "2026-05-05T12:00:00.000Z",
          name: "checkout",
          status: "error",
          durationMs: 500,
          tenantId: "tenant_1",
          userId: "user_1"
        }
      ],
      failedLlmCalls: [
        {
          id: "llm_1",
          timestamp: "2026-05-05T12:00:00.000Z",
          provider: "openai",
          model: "gpt-5",
          promptName: "summarize_signal",
          status: "error",
          costUsd: "0.250000",
          tenantId: "tenant_1",
          userId: "user_1",
          traceId: "trace_1"
        }
      ]
    },
    ...overrides
  };
}

function client(overrides: Partial<ApiClient>): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn(),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    listTraces: vi.fn(),
    listTraceSpans: vi.fn(),
    listLlmCalls: vi.fn(),
    getLlmAggregates: vi.fn(),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn().mockResolvedValue({ data: overviewResponse() }),
    getSystemHealth: vi.fn(),
    listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [] } }),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [] } }),
    getUserDetail: vi.fn().mockResolvedValue({ data: { window: "7d", generatedAt: "2026-05-05T12:00:00.000Z", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" }, user: { userId: "user_1", label: "user_1", isAnonymous: false, impactScore: 0, lastSeenAt: null, events: 0, errors: 0, openErrors: 0, severeErrors: 0, traces: 0, failedTraces: 0, llmCalls: 0, failedLlmCalls: 0, llmCostUsd: "0", activeTenants: 0, activeSessions: 0 }, recentSessions: [], timeline: [] } }),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
});

describe("OverviewDashboard", () => {
  it("shows setup guidance without project or environment", () => {
    render(<OverviewDashboard client={client({})} onDrilldown={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("Select a project and environment in Setup to view the overview.")).toBeInTheDocument();
  });

  it("loads overview cards trends top lists and recent signals", async () => {
    const api = client({
      getOverview: vi.fn().mockResolvedValue({ data: overviewResponse() })
    });

    render(<OverviewDashboard client={api} environmentId="env_1" onDrilldown={vi.fn()} projectId="prj_1" />);

    expect(screen.getByText("Loading overview")).toBeInTheDocument();
    expect(await screen.findByText("18")).toBeInTheDocument();
    const kpis = screen.getByLabelText("Overview KPIs");
    expect(within(kpis).getByText("Events")).toBeInTheDocument();
    expect(screen.getByText("Active users")).toBeInTheDocument();
    expect(screen.getByText("Active tenants")).toBeInTheDocument();
    expect(screen.getByText("LLM cost")).toBeInTheDocument();
    expect(screen.getByText("Usage trend")).toBeInTheDocument();
    expect(screen.getByText("Error trend")).toBeInTheDocument();
    expect(screen.getByText("Latency trend")).toBeInTheDocument();
    expect(screen.getByText("AI cost trend")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dashboard_created/ })).toBeInTheDocument();
    expect(screen.getByText("Checkout fetch failed")).toBeInTheDocument();
    expect(screen.getByText("checkout")).toBeInTheDocument();
    expect(api.getOverview).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", window: "24h" });
  });

  it("preserves the overview layout shape while loading", () => {
    const pending = deferred<{ data: OverviewResponse }>();
    const api = client({
      getOverview: vi.fn().mockReturnValue(pending.promise)
    });

    render(<OverviewDashboard client={api} environmentId="env_1" onDrilldown={vi.fn()} projectId="prj_1" />);

    expect(screen.getByText("Loading overview")).toBeInTheDocument();
    expect(screen.getByLabelText("Overview KPIs")).toBeInTheDocument();
    expect(screen.getByLabelText("Overview trends")).toBeInTheDocument();
    expect(screen.getByLabelText("Overview top lists")).toBeInTheDocument();
    expect(screen.getByLabelText("Overview recent signals")).toBeInTheDocument();
  });

  it("renders approved usage and error trend series", async () => {
    const api = client({
      getOverview: vi.fn().mockResolvedValue({ data: overviewResponse() })
    });

    render(<OverviewDashboard client={api} environmentId="env_1" onDrilldown={vi.fn()} projectId="prj_1" />);

    const usageTrend = (await screen.findByText("Usage trend")).closest("article");
    const errorTrend = screen.getByText("Error trend").closest("article");

    expect(usageTrend).not.toBeNull();
    expect(errorTrend).not.toBeNull();
    expect(within(usageTrend!).getByText("Events")).toBeInTheDocument();
    expect(within(usageTrend!).getByText("Traces")).toBeInTheDocument();
    expect(within(usageTrend!).getByText("LLM calls")).toBeInTheDocument();
    expect(within(errorTrend!).getByText("Errors")).toBeInTheDocument();
    expect(within(errorTrend!).getByText("Open")).toBeInTheDocument();
    expect(within(errorTrend!).getByText("Severe")).toBeInTheDocument();
  });

  it("reloads when the window changes", async () => {
    const getOverview = vi
      .fn()
      .mockResolvedValueOnce({ data: overviewResponse() })
      .mockResolvedValueOnce({ data: overviewResponse({ window: "7d" }) });
    const api = client({ getOverview });

    render(<OverviewDashboard client={api} environmentId="env_1" onDrilldown={vi.fn()} projectId="prj_1" />);

    await screen.findByText("Usage trend");
    await userEvent.click(screen.getByRole("button", { name: "7d" }));

    await waitFor(() => expect(getOverview).toHaveBeenLastCalledWith({ projectId: "prj_1", environmentId: "env_1", window: "7d" }));
  });

  it("shows unavailable state and retries", async () => {
    const getOverview = vi.fn().mockRejectedValueOnce(new Error("query failed")).mockResolvedValueOnce({ data: overviewResponse() });
    const api = client({ getOverview });

    render(<OverviewDashboard client={api} environmentId="env_1" onDrilldown={vi.fn()} projectId="prj_1" />);

    expect(await screen.findByText("Overview unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Usage trend")).toBeInTheDocument();
    expect(getOverview).toHaveBeenCalledTimes(2);
  });

  it("ignores stale overview responses", async () => {
    const first = deferred<{ data: OverviewResponse }>();
    const getOverview = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ data: overviewResponse({ kpis: { ...overviewResponse().kpis, events: 99 } }) });
    const api = client({ getOverview });

    render(<OverviewDashboard client={api} environmentId="env_1" onDrilldown={vi.fn()} projectId="prj_1" />);
    await userEvent.click(screen.getByRole("button", { name: "7d" }));

    expect(await screen.findByText("99")).toBeInTheDocument();

    await act(async () => {
      first.resolve({ data: overviewResponse({ kpis: { ...overviewResponse().kpis, events: 18 } }) });
      await first.promise;
    });

    expect(screen.getByText("99")).toBeInTheDocument();
  });

  it("dispatches top-list drilldowns", async () => {
    const onDrilldown = vi.fn();

    render(<OverviewDashboard client={client({})} environmentId="env_1" onDrilldown={onDrilldown} projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /dashboard_created/ }));
    await userEvent.click(screen.getByRole("button", { name: /critical/ }));
    await userEvent.click(screen.getByRole("button", { name: /gpt-5/ }));

    expect(onDrilldown).toHaveBeenCalledWith({ tab: "events", filters: { eventName: "dashboard_created" } });
    expect(onDrilldown).toHaveBeenCalledWith({ tab: "errors", filters: { severity: "critical" } });
    expect(onDrilldown).toHaveBeenCalledWith({ tab: "llm", filters: { model: "gpt-5" } });
  });

  it("dispatches tenant top-list rows to entity investigation", async () => {
    const onDrilldown = vi.fn();

    render(<OverviewDashboard client={client({})} environmentId="env_1" onDrilldown={onDrilldown} projectId="prj_1" />);

    const tenantUsage = (await screen.findByText("Tenant usage")).closest("article");
    expect(tenantUsage).not.toBeNull();

    await userEvent.click(within(tenantUsage!).getByRole("button", { name: /tenant_1/ }));

    expect(onDrilldown).toHaveBeenCalledWith({ tab: "entities", filters: { tenantId: "tenant_1" } });
  });

  it("does not drill into the unspecified prompt sentinel", async () => {
    const onDrilldown = vi.fn();
    const api = client({
      getOverview: vi.fn().mockResolvedValue({
        data: overviewResponse({
          top: {
            ...overviewResponse().top,
            llmPrompts: [{ promptName: "Unspecified", total: 3, totalCostUsd: "0.750000" }]
          }
        })
      })
    });

    render(<OverviewDashboard client={api} environmentId="env_1" onDrilldown={onDrilldown} projectId="prj_1" />);

    const unspecified = await screen.findByRole("button", { name: /Unspecified/ });
    expect(unspecified).toBeDisabled();
    await userEvent.click(unspecified);

    expect(onDrilldown).not.toHaveBeenCalled();
  });

  it("handles empty and zero trend data without invalid SVG points", async () => {
    const emptyOverview = overviewResponse({
      trends: {
        usage: [],
        errors: [{ bucketStart: "2026-05-05T12:00:00.000Z", errors: 0, openErrors: 0, severeErrors: 0 }],
        latency: [{ bucketStart: "2026-05-05T12:00:00.000Z", averageTraceDurationMs: 0, p95TraceDurationMs: null }],
        aiCost: [{ bucketStart: "2026-05-05T12:00:00.000Z", llmCostUsd: "0", llmCalls: 0 }]
      }
    });
    const api = client({ getOverview: vi.fn().mockResolvedValue({ data: emptyOverview }) });

    render(<OverviewDashboard client={api} environmentId="env_1" onDrilldown={vi.fn()} projectId="prj_1" />);

    expect(await screen.findByText("Usage trend")).toBeInTheDocument();
    for (const line of document.querySelectorAll("polyline")) {
      expect(line.getAttribute("points")).not.toMatch(/NaN|Infinity/);
    }
  });
});
