import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { TenantDetailResponse, TenantSummary, TenantTimelineRow } from "../api/types";
import { InvestigationWorkspace } from "./InvestigationWorkspace";

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
    listEvents: vi.fn().mockResolvedValue({ data: [] }),
    listErrors: vi.fn(),
    listTraces: vi.fn().mockResolvedValue({ data: [] }),
    listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
    listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
    getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } }),
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

function tenant(overrides: Partial<TenantSummary> = {}): TenantSummary {
  return {
    tenantId: "tenant_alpha",
    label: "Tenant Alpha",
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

function detail(overrides: Partial<TenantDetailResponse> = {}): TenantDetailResponse {
  return {
    window: "7d",
    generatedAt: "2026-05-05T12:30:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-04-28T12:30:00.000Z", to: "2026-05-05T12:30:00.000Z" },
    tenant: tenant(),
    topUsers: [],
    timeline: [traceTimelineRow()],
    ...overrides
  };
}

afterEach(() => {
  cleanup();
});

describe("InvestigationWorkspace", () => {
  it("requires a project and environment", () => {
    render(<InvestigationWorkspace client={client({})} />);

    expect(screen.getByText("Select a project and environment in Setup to investigate telemetry.")).toBeInTheDocument();
  });

  it("renders the events investigation view when scope exists", async () => {
    render(<InvestigationWorkspace client={client({})} environmentId="env_1" projectId="prj_1" />);

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Errors" })).toHaveAttribute("aria-pressed", "false");
    expect(await screen.findByText("No events found")).toBeInTheDocument();
  });

  it("switches between events errors traces and llm investigation views", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [] }),
      listErrors: vi.fn().mockResolvedValue({ data: [] }),
      listTraces: vi.fn().mockResolvedValue({ data: [] }),
      listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
      listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
      getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } })
    });

    render(<InvestigationWorkspace client={api} environmentId="env_1" projectId="prj_1" />);

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Errors" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Traces" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "LLM" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Entities" })).toHaveAttribute("aria-pressed", "false");
    expect(await screen.findByText("No events found")).toBeInTheDocument();
    expect(api.listLlmCalls).not.toHaveBeenCalled();
    expect(api.getLlmAggregates).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "LLM" }));

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "LLM" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("No LLM calls found")).toBeInTheDocument();
    expect(api.listLlmCalls).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
    expect(api.getLlmAggregates).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });

  it("shows the entities tab and loads it lazily", async () => {
    const listEntityTenants = vi.fn().mockResolvedValue({ data: { tenants: [] } });
    const api = client({ listEntityTenants });

    render(<InvestigationWorkspace client={api} environmentId="env_1" projectId="prj_1" />);

    expect(screen.getByRole("button", { name: "Entities" })).toHaveAttribute("aria-pressed", "false");
    expect(listEntityTenants).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Entities" }));

    expect(await screen.findByText("No tenant activity in this window.")).toBeInTheDocument();
    expect(listEntityTenants).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", window: "7d", limit: 50 });
  });

  it("opens the requested investigation tab with initial filters", async () => {
    const listErrors = vi.fn().mockResolvedValue({ data: [] });
    const api = client({
      listErrors
    });

    render(
      <InvestigationWorkspace
        client={api}
        environmentId="env_1"
        initialFilters={{ errors: { severity: "critical" } }}
        initialTab="errors"
        projectId="prj_1"
      />
    );

    expect(screen.getByRole("button", { name: "Errors" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("No errors found")).toBeInTheDocument();
    expect(screen.getByLabelText("Severity")).toHaveValue("critical");
    expect(listErrors).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      severity: "critical",
      limit: 50
    });
  });

  it("routes entity timeline drilldowns into raw trace filters", async () => {
    const listTraces = vi.fn().mockResolvedValue({ data: [] });
    const api = client({
      listTraces,
      listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [tenant()] } }),
      getEntityTenantDetail: vi.fn().mockResolvedValue({ data: detail() })
    });

    render(
      <InvestigationWorkspace
        client={api}
        environmentId="env_1"
        initialFilters={{ entities: { tenantId: "tenant_alpha" } }}
        initialTab="entities"
        projectId="prj_1"
      />
    );

    await userEvent.click(await screen.findByRole("button", { name: /Checkout trace/ }));

    expect(screen.getByRole("button", { name: "Traces" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Tenant")).toHaveValue("tenant_alpha");
    expect(screen.getByLabelText("Trace")).toHaveValue("trace_1");
    expect(listTraces).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      tenantId: "tenant_alpha",
      traceId: "trace_1",
      limit: 50
    });
  });
});
