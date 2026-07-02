import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { TenantDetailResponse, TenantSummary, TenantTimelineRow, UserDetailResponse, UserSummary, UserTimelineRow } from "../api/types";
import { InvestigationWorkspace } from "./InvestigationWorkspace";

function client(overrides: Partial<ApiClient>): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    fetchFleet: vi.fn(),
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
    getSystemHealth: vi.fn(),
    getSystemHealthHistory: vi.fn(),
    listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [] } }),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [] } }),
    getUserDetail: vi.fn().mockResolvedValue({ data: { window: "7d", generatedAt: "2026-05-05T12:00:00.000Z", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" }, user: { userId: "user_1", label: "user_1", isAnonymous: false, impactScore: 0, lastSeenAt: null, events: 0, errors: 0, openErrors: 0, severeErrors: 0, traces: 0, failedTraces: 0, llmCalls: 0, failedLlmCalls: 0, llmCostUsd: "0", activeTenants: 0, activeSessions: 0 }, recentSessions: [], timeline: [] } }),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    listNotificationChannels: vi.fn().mockResolvedValue({ channels: [] }),
    createNotificationChannel: vi.fn(),
    updateNotificationChannel: vi.fn(),
    archiveNotificationChannel: vi.fn(),
    listAlertRules: vi.fn().mockResolvedValue({ rules: [] }),
    createAlertRule: vi.fn(),
    updateAlertRule: vi.fn(),
    archiveAlertRule: vi.fn(),
    updateAlertEventTriage: vi.fn(),
    listAlertEvents: vi.fn().mockResolvedValue({ data: [] }),
    getAlertEvent: vi.fn(),
    listErrorGroups: vi.fn().mockResolvedValue({ data: [] }),
    getErrorGroup: vi.fn(),
    getErrorGroupIncident: vi.fn(),
    updateErrorGroupStatus: vi.fn(),
    updateErrorGroupTriage: vi.fn(),
    addTriageNote: vi.fn(),
    silenceIncident: vi.fn(),
    getSessionTimeline: vi.fn().mockResolvedValue({ data: { sessionId: "sess_1", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: null, to: null }, items: [], page: { nextCursor: null, previousCursor: null } } }),
    ...overrides
  };
}

function tenant(overrides: Partial<TenantSummary> = {}): TenantSummary {
  return {
    tenantId: "tenant_alpha",
    label: "Tenant Alpha",
    traits: {},
    keyTraits: {},
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

function user(overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    userId: "user_alpha",
    label: "user_alpha",
    traits: {},
    keyTraits: {},
    isAnonymous: false,
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
    activeTenants: 2,
    activeSessions: 3,
    ...overrides
  };
}

function userEventRow(overrides: Partial<Extract<UserTimelineRow, { type: "event" }>> = {}): UserTimelineRow {
  return {
    type: "event",
    id: "evt_1",
    timestamp: "2026-05-05T10:00:00.000Z",
    label: "Checkout started",
    tenantId: "tenant_alpha",
    sessionId: "session_1",
    traceId: "trace_1",
    eventName: "checkout.started",
    ...overrides
  };
}

function userDetail(overrides: Partial<UserDetailResponse> = {}): UserDetailResponse {
  return {
    window: "7d",
    generatedAt: "2026-05-05T12:30:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-04-28T12:30:00.000Z", to: "2026-05-05T12:30:00.000Z" },
    user: user(),
    recentSessions: [],
    timeline: [userEventRow()],
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

  it("opens Errors as the grouped incident queue", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [] }),
      listErrors: vi.fn().mockResolvedValue({ data: [] }),
      listErrorGroups: vi.fn().mockResolvedValue({
        data: [
          {
            id: "egrp_checkout",
            projectId: "prj_1",
            environmentId: "env_1",
            groupingFingerprint: "fp_checkout_fetch",
            message: "Checkout fetch failed",
            type: "TypeError",
            topStackFrame: "checkout.ts:12:3",
            severity: "critical",
            status: "open",
            priority: "high",
            firstSeenAt: "2026-05-04T11:00:00.000Z",
            lastSeenAt: "2026-05-04T12:00:00.000Z",
            lastRegressedAt: null,
            occurrenceCount: 12,
            affectedUsersCount: 4,
            affectedTenantsCount: 2,
            latestErrorId: "err_1",
            latestRelease: "web@1.0.0",
            resolvedAt: null,
            ignoredAt: null,
            createdAt: "2026-05-04T11:00:00.000Z",
            updatedAt: "2026-05-04T12:00:00.000Z"
          }
        ]
      })
    });

    render(<InvestigationWorkspace client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(screen.getByRole("button", { name: "Errors" }));

    expect(await screen.findByRole("table", { name: "Grouped error incident queue" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Groups" })).toHaveAttribute("aria-selected", "true");
    expect(api.listErrorGroups).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
    expect(api.listErrors).not.toHaveBeenCalled();
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

  it("shows the users tab and loads it lazily", async () => {
    const listUsersActivity = vi.fn().mockResolvedValue({ data: { users: [] } });
    const api = client({ listUsersActivity });

    render(<InvestigationWorkspace client={api} environmentId="env_1" projectId="prj_1" />);

    expect(screen.getByRole("button", { name: "Users" })).toHaveAttribute("aria-pressed", "false");
    expect(listUsersActivity).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Users" }));

    expect(await screen.findByText("No user activity in this window.")).toBeInTheDocument();
    expect(listUsersActivity).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", window: "7d", limit: 50 });
  });

  it("opens the requested investigation tab with initial filters", async () => {
    const listErrorGroups = vi.fn().mockResolvedValue({ data: [] });
    const api = client({
      listErrorGroups
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
    expect(await screen.findByText("No error groups found")).toBeInTheDocument();
    expect(screen.getByLabelText("Severity")).toHaveValue("critical");
    expect(listErrorGroups).toHaveBeenCalledWith({
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

  it("routes user timeline drilldowns into raw event filters", async () => {
    const listEvents = vi.fn().mockResolvedValue({ data: [] });
    const api = client({
      listEvents,
      listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [user()] } }),
      getUserDetail: vi.fn().mockResolvedValue({ data: userDetail() })
    });

    render(
      <InvestigationWorkspace
        client={api}
        environmentId="env_1"
        initialFilters={{ users: { userId: "user_alpha" } }}
        initialTab="users"
        projectId="prj_1"
      />
    );

    await userEvent.click(await screen.findByRole("button", { name: /Checkout started/ }));

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Tenant")).toHaveValue("tenant_alpha");
    expect(screen.getByLabelText("User")).toHaveValue("user_alpha");
    expect(screen.getByLabelText("Session")).toHaveValue("session_1");
    expect(screen.getByLabelText("Trace")).toHaveValue("trace_1");
    expect(screen.getByLabelText("Event name")).toHaveValue("checkout.started");
    expect(listEvents).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      tenantId: "tenant_alpha",
      userId: "user_alpha",
      sessionId: "session_1",
      traceId: "trace_1",
      eventName: "checkout.started",
      limit: 50
    });
  });

  it("creates and renders custom dashboards", async () => {
    const dashboard = {
      id: "dash_1",
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Operations report",
      description: null,
      category: "operational" as const,
      filters: { window: "7d" as const },
      widgets: [
        { id: "wid_1", type: "metric.events" as const, title: "Events", width: "half" as const, options: {} },
        { id: "wid_2", type: "metric.errors" as const, title: "Errors", width: "half" as const, options: {} },
        { id: "wid_3", type: "top.events" as const, title: "Top events", width: "full" as const, options: {} }
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null
    };
    const api = client({
      listAnalyticsDashboards: vi.fn().mockResolvedValue({ dashboards: [] }),
      createAnalyticsDashboard: vi.fn().mockResolvedValue({ dashboard }),
      getDashboardReport: vi.fn().mockResolvedValue({
        data: {
          dashboard,
          generatedAt: "2026-01-01T00:00:00.000Z",
          scope: { projectId: "prj_1", environmentId: "env_1" },
          window: "7d",
          widgets: [
            { widgetId: "wid_1", type: "metric.events", title: "Events", width: "half", status: "ok", data: { value: 42 } },
            { widgetId: "wid_2", type: "metric.errors", title: "Errors", width: "half", status: "ok", data: { value: 2, open: 1 } },
            { widgetId: "wid_3", type: "top.events", title: "Top events", width: "full", status: "ok", data: { rows: [{ name: "checkout.started", total: 8 }] } }
          ]
        }
      })
    });

    render(<InvestigationWorkspace client={api} environmentId="env_1" initialTab="dashboards" projectId="prj_1" />);

    expect(await screen.findByText("No saved dashboards yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create dashboard" }));

    expect(api.createAnalyticsDashboard).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "prj_1",
      environmentId: "env_1",
      widgets: expect.arrayContaining([expect.objectContaining({ type: "metric.events" })])
    }));
    expect(await screen.findByText("checkout.started")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});
