import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { TenantDetailResponse, TenantSummary, TenantTimelineRow, TenantTopUser } from "../api/types";
import { EntitiesInvestigationPanel } from "./EntitiesInvestigationPanel";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function tenant(overrides: Partial<TenantSummary> = {}): TenantSummary {
  return {
    tenantId: "tenant_a",
    label: "Tenant A",
    isUnassigned: false,
    impactScore: 10,
    lastSeenAt: "2026-05-05T10:00:00.000Z",
    events: 5,
    errors: 1,
    openErrors: 1,
    severeErrors: 0,
    traces: 3,
    failedTraces: 1,
    llmCalls: 2,
    failedLlmCalls: 0,
    llmCostUsd: "1.25",
    activeUsers: 2,
    activeSessions: 3,
    ...overrides
  };
}

function topUser(overrides: Partial<TenantTopUser> = {}): TenantTopUser {
  return {
    userId: "user_1",
    events: 7,
    errors: 2,
    traces: 3,
    llmCalls: 4,
    llmCostUsd: "2.50",
    lastSeenAt: "2026-05-05T11:00:00.000Z",
    ...overrides
  };
}

function timelineRow(overrides: Partial<Extract<TenantTimelineRow, { type: "event" }>> = {}): TenantTimelineRow {
  return {
    type: "event",
    id: "evt_1",
    timestamp: "2026-05-05T12:00:00.000Z",
    label: "Checkout started",
    userId: "user_1",
    sessionId: "sess_1",
    traceId: "trace_1",
    eventName: "checkout.started",
    ...overrides
  };
}

function errorTimelineRow(overrides: Partial<Extract<TenantTimelineRow, { type: "error" }>> = {}): TenantTimelineRow {
  return {
    type: "error",
    id: "err_1",
    timestamp: "2026-05-05T12:01:00.000Z",
    label: "Checkout failed",
    userId: "user_1",
    sessionId: "sess_1",
    traceId: "trace_1",
    severity: "error",
    status: "open",
    message: "Checkout failed",
    ...overrides
  };
}

function traceTimelineRow(overrides: Partial<Extract<TenantTimelineRow, { type: "trace" }>> = {}): TenantTimelineRow {
  return {
    type: "trace",
    id: "trc_1",
    timestamp: "2026-05-05T12:02:00.000Z",
    label: "Checkout trace",
    userId: "user_1",
    sessionId: "sess_1",
    traceId: "trace_1",
    status: "error",
    durationMs: 320,
    name: "checkout",
    ...overrides
  };
}

function llmTimelineRow(overrides: Partial<Extract<TenantTimelineRow, { type: "llm" }>> = {}): TenantTimelineRow {
  return {
    type: "llm",
    id: "llm_1",
    timestamp: "2026-05-05T12:03:00.000Z",
    label: "Summarize cart",
    userId: "user_1",
    sessionId: "sess_1",
    traceId: "trace_1",
    provider: "openai",
    model: "gpt-5",
    promptName: "Unspecified",
    status: "error",
    costUsd: "0.250000",
    ...overrides
  };
}

function detail(overrides: Partial<TenantDetailResponse> = {}): TenantDetailResponse {
  const summary = tenant({ tenantId: "tenant_a", label: "Tenant A" });
  return {
    window: "7d",
    generatedAt: "2026-05-05T12:30:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-04-28T12:30:00.000Z", to: "2026-05-05T12:30:00.000Z" },
    tenant: summary,
    topUsers: [topUser()],
    timeline: [timelineRow()],
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
    getOverview: vi.fn(),
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

afterEach(() => {
  cleanup();
});

describe("EntitiesInvestigationPanel", () => {
  it("renders impact-ranked rows and disables Unassigned", async () => {
    const api = client({
      listEntityTenants: vi.fn().mockResolvedValue({
        data: {
          tenants: [
            tenant({ tenantId: "tenant_low", label: "Tenant Low", impactScore: 1 }),
            tenant({ tenantId: null, label: "Unassigned", isUnassigned: true, impactScore: 100 }),
            tenant({ tenantId: "tenant_high", label: "Tenant High", impactScore: 20 })
          ]
        }
      })
    });

    render(<EntitiesInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    const rows = await screen.findAllByRole("button", { name: /Tenant|Unassigned/ });
    expect(rows.map((row) => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Tenant High")]));
    expect(rows[0]).toHaveTextContent("Unassigned");
    expect(rows[1]).toHaveTextContent("Tenant High");
    expect(screen.getByRole("button", { name: /Unassigned/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Tenant High/ })).toHaveTextContent("Failed traces 1");
    expect(screen.getByRole("button", { name: /Tenant High/ })).toHaveTextContent("LLM calls 2");
    expect(screen.getByRole("button", { name: /Tenant High/ })).toHaveTextContent("Active users 2");

    await userEvent.click(screen.getByRole("button", { name: /Unassigned/ }));

    expect(api.getEntityTenantDetail).not.toHaveBeenCalled();
  });

  it("keeps impact tie-breaks by recent activity, usage, then label", async () => {
    const api = client({
      listEntityTenants: vi.fn().mockResolvedValue({
        data: {
          tenants: [
            tenant({ tenantId: "tenant_z", label: "Tenant Z", impactScore: 20, lastSeenAt: "2026-05-05T10:00:00.000Z", events: 10 }),
            tenant({ tenantId: "tenant_b", label: "Tenant B", impactScore: 20, lastSeenAt: "2026-05-05T12:00:00.000Z", events: 1 }),
            tenant({ tenantId: "tenant_a", label: "Tenant A", impactScore: 20, lastSeenAt: "2026-05-05T10:00:00.000Z", events: 10 })
          ]
        }
      })
    });

    render(<EntitiesInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    const rows = await screen.findAllByRole("button", { name: /Tenant [ABZ]/ });
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Tenant B"),
      expect.stringContaining("Tenant A"),
      expect.stringContaining("Tenant Z")
    ]);
  });

  it("selecting tenant loads summary top users and timeline", async () => {
    const getEntityTenantDetail = vi.fn().mockResolvedValue({ data: detail() });
    const api = client({
      listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [tenant()] } }),
      getEntityTenantDetail
    });

    render(<EntitiesInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /Tenant A/ }));

    expect(await screen.findByText("Active users")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "User" })).toBeInTheDocument();
    expect(screen.getByText("user_1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Checkout started/ })).toBeInTheDocument();
    expect(getEntityTenantDetail).toHaveBeenCalledWith("tenant_a", {
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      limit: 50
    });
  });

  it("loads more timeline rows with the returned cursor", async () => {
    const getEntityTenantDetail = vi
      .fn()
      .mockResolvedValueOnce({
        data: detail({
          timeline: [timelineRow({ id: "evt_1", label: "First row" })],
          cursor: "cursor_1"
        })
      })
      .mockResolvedValueOnce({
        data: detail({
          timeline: [timelineRow({ id: "evt_2", label: "Second row" })]
        })
      });
    const api = client({
      listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [tenant()] } }),
      getEntityTenantDetail
    });

    render(<EntitiesInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" initialTenantId="tenant_a" />);

    expect(await screen.findByRole("button", { name: /First row/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("button", { name: /Second row/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /First row/ })).toBeInTheDocument();
    expect(getEntityTenantDetail).toHaveBeenLastCalledWith("tenant_a", {
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      limit: 50,
      cursor: "cursor_1"
    });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("drills timeline rows into raw investigation tabs with tenant filters", async () => {
    const onDrilldown = vi.fn();
    const rows = [
      errorTimelineRow(),
      traceTimelineRow(),
      timelineRow({ label: "Checkout started", eventName: "checkout.started", traceId: "trace_1" }),
      llmTimelineRow({ promptName: "Unspecified" })
    ];
    const api = client({
      listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [tenant({ tenantId: "tenant_alpha", label: "Tenant Alpha" })] } }),
      getEntityTenantDetail: vi.fn().mockResolvedValue({
        data: detail({
          tenant: tenant({ tenantId: "tenant_alpha", label: "Tenant Alpha" }),
          timeline: rows
        })
      })
    });

    render(
      <EntitiesInvestigationPanel client={api} environmentId="env_1" onDrilldown={onDrilldown} projectId="prj_1" initialTenantId="tenant_alpha" />
    );

    await userEvent.click(await screen.findByRole("button", { name: /Checkout failed/ }));
    await userEvent.click(screen.getByRole("button", { name: /Checkout trace/ }));
    await userEvent.click(screen.getByRole("button", { name: /Checkout started/ }));
    await userEvent.click(screen.getByRole("button", { name: /Summarize cart/ }));

    expect(onDrilldown).toHaveBeenCalledWith({
      tab: "errors",
      filters: { tenantId: "tenant_alpha", severity: "error", status: "open", traceId: "trace_1" }
    });
    expect(onDrilldown).toHaveBeenCalledWith({
      tab: "traces",
      filters: { tenantId: "tenant_alpha", traceId: "trace_1" }
    });
    expect(onDrilldown).toHaveBeenCalledWith({
      tab: "events",
      filters: { tenantId: "tenant_alpha", eventName: "checkout.started", traceId: "trace_1" }
    });
    expect(onDrilldown).toHaveBeenCalledWith({
      tab: "llm",
      filters: { tenantId: "tenant_alpha", provider: "openai", model: "gpt-5", status: "error", traceId: "trace_1" }
    });
  });

  it("applies user filter only after Apply", async () => {
    const getEntityTenantDetail = vi.fn().mockResolvedValue({ data: detail() });
    const api = client({
      listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [tenant()] } }),
      getEntityTenantDetail
    });

    render(<EntitiesInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" initialTenantId="tenant_a" />);

    await screen.findByText("Checkout started");
    expect(getEntityTenantDetail).toHaveBeenCalledTimes(1);

    await userEvent.type(screen.getByLabelText("User"), "user_2");

    expect(getEntityTenantDetail).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(getEntityTenantDetail).toHaveBeenCalledTimes(2));
    expect(getEntityTenantDetail).toHaveBeenLastCalledWith("tenant_a", {
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      userId: "user_2",
      limit: 50
    });
  });

  it("updates detail when signal type changes", async () => {
    const getEntityTenantDetail = vi.fn().mockResolvedValue({ data: detail() });
    const api = client({
      listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [tenant()] } }),
      getEntityTenantDetail
    });

    render(<EntitiesInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" initialTenantId="tenant_a" />);

    await screen.findByText("Checkout started");
    await userEvent.selectOptions(screen.getByLabelText("Signal"), "error");

    await waitFor(() => expect(getEntityTenantDetail).toHaveBeenCalledTimes(2));
    expect(getEntityTenantDetail).toHaveBeenLastCalledWith("tenant_a", {
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      signalType: "error",
      limit: 50
    });
  });

  it("resets selected tenant detail when scope changes without a new initial tenant", async () => {
    const listEntityTenants = vi.fn().mockResolvedValue({ data: { tenants: [tenant()] } });
    const getEntityTenantDetail = vi.fn().mockResolvedValue({ data: detail() });
    const api = client({ listEntityTenants, getEntityTenantDetail });
    const { rerender } = render(
      <EntitiesInvestigationPanel client={api} environmentId="env_1" initialTenantId="tenant_a" projectId="prj_1" />
    );

    expect(await screen.findByText("Checkout started")).toBeInTheDocument();
    expect(getEntityTenantDetail).toHaveBeenCalledTimes(1);

    rerender(<EntitiesInvestigationPanel client={api} environmentId="env_2" initialTenantId="tenant_a" projectId="prj_1" />);

    expect(await screen.findByText("Select a tenant to inspect recent activity.")).toBeInTheDocument();
    await waitFor(() =>
      expect(listEntityTenants).toHaveBeenLastCalledWith({ projectId: "prj_1", environmentId: "env_2", window: "7d", limit: 50 })
    );
    expect(getEntityTenantDetail).toHaveBeenCalledTimes(1);
    expect(getEntityTenantDetail).not.toHaveBeenCalledWith(
      "tenant_a",
      expect.objectContaining({ projectId: "prj_1", environmentId: "env_2" })
    );
  });

  it("retries list and detail failures", async () => {
    const listEntityTenants = vi
      .fn()
      .mockRejectedValueOnce(new Error("list failed"))
      .mockResolvedValueOnce({ data: { tenants: [tenant()] } });
    const getEntityTenantDetail = vi
      .fn()
      .mockRejectedValueOnce(new Error("detail failed"))
      .mockResolvedValueOnce({ data: detail() });
    const api = client({ listEntityTenants, getEntityTenantDetail });

    render(<EntitiesInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" initialTenantId="tenant_a" />);

    expect(await screen.findByText("Tenant activity is unavailable.")).toBeInTheDocument();
    expect(await screen.findByText("Tenant detail is unavailable.")).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);

    expect(await screen.findByRole("button", { name: /Tenant A/ })).toBeInTheDocument();

    await userEvent.click(screen.getByText("Tenant detail is unavailable.").closest(".status-box")!.querySelector("button")!);

    expect(await screen.findByText("Checkout started")).toBeInTheDocument();
    expect(listEntityTenants).toHaveBeenCalledTimes(2);
    expect(getEntityTenantDetail).toHaveBeenCalledTimes(2);
  });

  it("ignores stale list and detail responses", async () => {
    const staleList = deferred<{ data: { tenants: TenantSummary[] } }>();
    const freshList = deferred<{ data: { tenants: TenantSummary[] } }>();
    const staleDetail = deferred<{ data: TenantDetailResponse }>();
    const freshDetail = deferred<{ data: TenantDetailResponse }>();
    const listEntityTenants = vi.fn().mockReturnValueOnce(staleList.promise).mockReturnValueOnce(freshList.promise);
    const getEntityTenantDetail = vi.fn().mockReturnValueOnce(staleDetail.promise).mockReturnValueOnce(freshDetail.promise);
    const api = client({ listEntityTenants, getEntityTenantDetail });

    render(<EntitiesInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" initialTenantId="tenant_a" />);

    await userEvent.click(screen.getByRole("button", { name: "24h" }));
    freshList.resolve({ data: { tenants: [tenant({ label: "Fresh Tenant" })] } });
    freshDetail.resolve({ data: detail({ tenant: tenant({ label: "Fresh Tenant" }), timeline: [timelineRow({ label: "Fresh row" })] }) });
    staleList.resolve({ data: { tenants: [tenant({ label: "Stale Tenant" })] } });
    staleDetail.resolve({ data: detail({ tenant: tenant({ label: "Stale Tenant" }), timeline: [timelineRow({ label: "Stale row" })] }) });

    await waitFor(() => expect(screen.getAllByText("Fresh Tenant").length).toBeGreaterThan(0));
    expect(await screen.findByText("Fresh row")).toBeInTheDocument();
    expect(screen.queryByText("Stale Tenant")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale row")).not.toBeInTheDocument();
  });
});
