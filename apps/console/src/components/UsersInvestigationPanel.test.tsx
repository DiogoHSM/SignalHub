import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { UserDetailResponse, UserRecentSession, UserSummary, UserTimelineRow } from "../api/types";
import { UsersInvestigationPanel } from "./UsersInvestigationPanel";

function user(overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    userId: "user_1",
    label: "user_1",
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

function session(overrides: Partial<UserRecentSession> = {}): UserRecentSession {
  return {
    sessionId: "session_1",
    tenantId: "tenant_alpha",
    events: 2,
    errors: 1,
    traces: 1,
    llmCalls: 1,
    llmCostUsd: "0.250000",
    firstSeenAt: "2026-05-05T09:30:00.000Z",
    lastSeenAt: "2026-05-05T10:00:00.000Z",
    ...overrides
  };
}

function eventRow(overrides: Partial<Extract<UserTimelineRow, { type: "event" }>> = {}): UserTimelineRow {
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

function errorRow(overrides: Partial<Extract<UserTimelineRow, { type: "error" }>> = {}): UserTimelineRow {
  return {
    type: "error",
    id: "err_1",
    timestamp: "2026-05-05T10:01:00.000Z",
    label: "Checkout failed",
    tenantId: "tenant_alpha",
    sessionId: "session_1",
    traceId: "trace_1",
    severity: "error",
    status: "open",
    message: "Checkout failed",
    ...overrides
  };
}

function traceRow(overrides: Partial<Extract<UserTimelineRow, { type: "trace" }>> = {}): UserTimelineRow {
  return {
    type: "trace",
    id: "trc_1",
    timestamp: "2026-05-05T10:02:00.000Z",
    label: "Checkout trace",
    tenantId: "tenant_alpha",
    sessionId: "session_1",
    traceId: "trace_1",
    status: "error",
    durationMs: 320,
    name: "checkout",
    ...overrides
  };
}

function llmRow(overrides: Partial<Extract<UserTimelineRow, { type: "llm" }>> = {}): UserTimelineRow {
  return {
    type: "llm",
    id: "llm_1",
    timestamp: "2026-05-05T10:03:00.000Z",
    label: "Summarize cart",
    tenantId: "tenant_alpha",
    sessionId: "session_1",
    traceId: "trace_1",
    provider: "openai",
    model: "gpt-5",
    promptName: "Unspecified",
    status: "error",
    costUsd: "0.250000",
    ...overrides
  };
}

function detail(overrides: Partial<UserDetailResponse> = {}): UserDetailResponse {
  return {
    window: "7d",
    generatedAt: "2026-05-05T12:30:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-04-28T12:30:00.000Z", to: "2026-05-05T12:30:00.000Z" },
    user: user(),
    recentSessions: [session()],
    timeline: [eventRow()],
    ...overrides
  };
}

function client(overrides: Partial<ApiClient> = {}): ApiClient {
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
    getSystemHealth: vi.fn(),
    listEntityTenants: vi.fn(),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [] } }),
    getUserDetail: vi.fn().mockResolvedValue({ data: detail() }),
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
    listAlertEvents: vi.fn().mockResolvedValue({ data: [] }),
    getAlertEvent: vi.fn(),
    ...overrides
  };
}

afterEach(() => {
  cleanup();
});

describe("UsersInvestigationPanel", () => {
  it("renders impact-ranked users and disables Anonymous", async () => {
    const api = client({
      listUsersActivity: vi.fn().mockResolvedValue({
        data: {
          users: [
            user({ userId: "user_low", label: "user_low", impactScore: 1 }),
            user({ userId: null, label: "Anonymous / Unassigned", isAnonymous: true, impactScore: 100 }),
            user({ userId: "user_high", label: "user_high", impactScore: 20 })
          ]
        }
      })
    });

    render(<UsersInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    const rows = await screen.findAllByRole("button", { name: /user_|Anonymous/ });
    expect(rows[0]).toHaveTextContent("Anonymous / Unassigned");
    expect(rows[1]).toHaveTextContent("user_high");
    expect(screen.getByRole("button", { name: /Anonymous/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /user_high/ })).toHaveTextContent("Failed traces 1");
    expect(screen.getByRole("button", { name: /user_high/ })).toHaveTextContent("LLM calls 2");
    expect(screen.getByRole("button", { name: /user_high/ })).toHaveTextContent("Active tenants 2");

    await userEvent.click(screen.getByRole("button", { name: /Anonymous/ }));
    expect(api.getUserDetail).not.toHaveBeenCalled();
  });

  it("selecting user loads summary recent sessions and timeline", async () => {
    const getUserDetail = vi.fn().mockResolvedValue({ data: detail() });
    const api = client({
      listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [user()] } }),
      getUserDetail
    });

    render(<UsersInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /user_1/ }));

    expect(await screen.findByText("Active tenants")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Session" })).toBeInTheDocument();
    expect(screen.getByText("session_1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Checkout started/ })).toBeInTheDocument();
    expect(getUserDetail).toHaveBeenCalledWith("user_1", {
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      limit: 50
    });
  });

  it("applies search and tenant list filters only after Apply", async () => {
    const listUsersActivity = vi.fn().mockResolvedValue({ data: { users: [] } });
    const api = client({ listUsersActivity });

    render(<UsersInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No user activity in this window.");
    await userEvent.type(screen.getByLabelText("Search"), "user_2");
    await userEvent.type(screen.getByLabelText("Tenant"), "tenant_2");
    expect(listUsersActivity).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => expect(listUsersActivity).toHaveBeenCalledTimes(2));
    expect(listUsersActivity).toHaveBeenLastCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      search: "user_2",
      tenantId: "tenant_2",
      limit: 50
    });
  });

  it("loads more timeline rows with the returned cursor", async () => {
    const getUserDetail = vi
      .fn()
      .mockResolvedValueOnce({ data: detail({ timeline: [eventRow({ id: "evt_1", label: "First row" })], cursor: "cursor_1" }) })
      .mockResolvedValueOnce({ data: detail({ timeline: [eventRow({ id: "evt_2", label: "Second row" })] }) });
    const api = client({
      listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [user()] } }),
      getUserDetail
    });

    render(<UsersInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" initialUserId="user_1" />);

    expect(await screen.findByRole("button", { name: /First row/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("button", { name: /Second row/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /First row/ })).toBeInTheDocument();
    expect(getUserDetail).toHaveBeenLastCalledWith("user_1", {
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      limit: 50,
      cursor: "cursor_1"
    });
  });

  it("drills timeline rows into raw investigation tabs with user filters", async () => {
    const onDrilldown = vi.fn();
    const rows = [
      errorRow(),
      traceRow(),
      eventRow({ label: "Checkout started", eventName: "checkout.started", traceId: "trace_1" }),
      llmRow({ promptName: "cart.summary" })
    ];
    const api = client({
      listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [user({ userId: "user_alpha", label: "user_alpha" })] } }),
      getUserDetail: vi.fn().mockResolvedValue({
        data: detail({
          user: user({ userId: "user_alpha", label: "user_alpha" }),
          timeline: rows
        })
      })
    });

    render(
      <UsersInvestigationPanel client={api} environmentId="env_1" onDrilldown={onDrilldown} projectId="prj_1" initialUserId="user_alpha" />
    );

    await userEvent.click(await screen.findByRole("button", { name: /Checkout failed/ }));
    await userEvent.click(screen.getByRole("button", { name: /Checkout trace/ }));
    await userEvent.click(screen.getByRole("button", { name: /Checkout started/ }));
    await userEvent.click(screen.getByRole("button", { name: /Summarize cart/ }));

    expect(onDrilldown).toHaveBeenCalledWith({
      tab: "errors",
      filters: { userId: "user_alpha", tenantId: "tenant_alpha", sessionId: "session_1", severity: "error", status: "open", traceId: "trace_1" }
    });
    expect(onDrilldown).toHaveBeenCalledWith({
      tab: "traces",
      filters: { userId: "user_alpha", tenantId: "tenant_alpha", sessionId: "session_1", traceId: "trace_1" }
    });
    expect(onDrilldown).toHaveBeenCalledWith({
      tab: "events",
      filters: { userId: "user_alpha", tenantId: "tenant_alpha", sessionId: "session_1", eventName: "checkout.started", traceId: "trace_1" }
    });
    expect(onDrilldown).toHaveBeenCalledWith({
      tab: "llm",
      filters: {
        userId: "user_alpha",
        tenantId: "tenant_alpha",
        sessionId: "session_1",
        provider: "openai",
        model: "gpt-5",
        status: "error",
        promptName: "cart.summary",
        traceId: "trace_1"
      }
    });
  });
});
