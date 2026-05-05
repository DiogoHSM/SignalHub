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

    await userEvent.click(screen.getByRole("button", { name: /Unassigned/ }));

    expect(api.getEntityTenantDetail).not.toHaveBeenCalled();
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
