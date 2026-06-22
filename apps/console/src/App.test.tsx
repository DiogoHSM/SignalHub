import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api/client";
import { App } from "./App";
import { resolveV2ShellFlag } from "./v2/flag";

const { bootstrapClient, operationalClient, createApiClient } = vi.hoisted(() => {
  const bootstrapClient = {
    getConsoleConfig: vi.fn().mockResolvedValue({
      apiBasePath: "/api",
      apiEndpoint: "https://sigmon.example.com",
      googleOAuthEnabled: false
    }),
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
    listTraces: vi.fn().mockResolvedValue({ data: [] }),
    listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
    listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
    getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } }),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn(),
    getSystemHealth: vi.fn(),
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
    listAlertEvents: vi.fn().mockResolvedValue({ data: [] }),
    getAlertEvent: vi.fn(),
    listErrorGroups: vi.fn().mockResolvedValue({ data: [] }),
    getErrorGroup: vi.fn(),
    getErrorGroupIncident: vi.fn(),
    updateErrorGroupStatus: vi.fn(),
    updateErrorGroupTriage: vi.fn(),
    getSessionTimeline: vi.fn().mockResolvedValue({ data: { sessionId: "sess_1", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: null, to: null }, items: [], page: { nextCursor: null, previousCursor: null } } })
  } satisfies ApiClient;
  const operationalClient = {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn().mockResolvedValue({ user: { id: "usr_1", email: "admin@example.com", isAdmin: true } }),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn().mockResolvedValue({
      projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
    }),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn().mockResolvedValue({
      environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
    }),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn().mockResolvedValue({ apiKeys: [] }),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ data: [] }),
    listErrors: vi.fn().mockResolvedValue({ data: [] }),
    listTraces: vi.fn().mockResolvedValue({ data: [] }),
    listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
    listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
    getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } }),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn(),
    getSystemHealth: vi.fn(),
    listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [] } }),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [] } }),
    getUserDetail: vi.fn().mockResolvedValue({ data: { window: "7d", generatedAt: "2026-05-05T12:00:00.000Z", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" }, user: { userId: "user_1", label: "user_1", isAnonymous: false, impactScore: 0, lastSeenAt: null, events: 0, errors: 0, openErrors: 0, severeErrors: 0, traces: 0, failedTraces: 0, llmCalls: 0, failedLlmCalls: 0, llmCostUsd: "0", activeTenants: 0, activeSessions: 0 }, recentSessions: [], timeline: [] } }),
    listUsers: vi.fn().mockResolvedValue({ users: [] }),
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
    listErrorGroups: vi.fn().mockResolvedValue({ data: [] }),
    getErrorGroup: vi.fn(),
    getErrorGroupIncident: vi.fn(),
    updateErrorGroupStatus: vi.fn(),
    updateErrorGroupTriage: vi.fn(),
    getSessionTimeline: vi.fn().mockResolvedValue({ data: { sessionId: "sess_1", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: null, to: null }, items: [], page: { nextCursor: null, previousCursor: null } } })
  } satisfies ApiClient;
  const createApiClient = vi.fn((apiBasePath?: string) => (apiBasePath === "/api" ? operationalClient : bootstrapClient));

  return { bootstrapClient, operationalClient, createApiClient };
});

vi.mock("./v2/flag", () => ({
  resolveV2ShellFlag: vi.fn(() => false)
}));

vi.mock("./api/client", () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string) {
      super(code);
      this.status = status;
      this.code = code;
    }
  },
  createApiClient
}));

describe("App", () => {
  it("renders the authenticated console workspace", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Executive risk dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Current project" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Operations" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Current project" })).toHaveValue("prj_1"));
    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();
    expect(createApiClient).toHaveBeenNthCalledWith(1);
    expect(createApiClient).toHaveBeenNthCalledWith(2, "/api");
    expect(operationalClient.getMe).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Open command palette" }));
    const commandPalette = screen.getByRole("dialog", { name: "Command palette" });
    await userEvent.type(within(commandPalette).getByRole("textbox", { name: "Search commands" }), "onboarding");
    await userEvent.click(within(commandPalette).getByRole("button", { name: "Open Onboarding" }));
    expect(screen.getAllByText(/https:\/\/sigmon.example.com/)).toHaveLength(4);
  });

  describe("v2 shell flag", () => {
    const mockResolveV2ShellFlag = vi.mocked(resolveV2ShellFlag);

    afterEach(() => {
      mockResolveV2ShellFlag.mockReturnValue(false);
      cleanup();
    });

    it("renders ConsoleShellV2 when flag is on", async () => {
      mockResolveV2ShellFlag.mockReturnValue(true);
      render(<App />);
      await waitFor(() => expect(document.querySelector(".sh-v2")).toBeInTheDocument());
      expect(document.querySelector(".sh-v2")).toBeInTheDocument();
    });

    it("renders legacy ConsoleShell when flag is off", async () => {
      mockResolveV2ShellFlag.mockReturnValue(false);
      render(<App />);
      expect(await screen.findByRole("heading", { name: "Executive risk dashboard" })).toBeInTheDocument();
      expect(document.querySelector(".sh-v2")).not.toBeInTheDocument();
    });
  });
});
