import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api/client";
import { App } from "./App";
// Compile the same module used by the production operations split point before
// the test begins, so Vitest transform time is not charged to DOM query waits.
import "./v2/screens/screen-groups/operations";

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
    fetchFleet: vi.fn().mockRejectedValue(new Error("fleet unavailable"))
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
    getOverview: vi.fn().mockResolvedValue({ data: { window: "24h", generatedAt: "", scope: {}, range: {}, kpis: { events: 0, activeUsers: 0, activeTenants: 0, errors: 0, openErrors: 0, traces: 0, failedTraces: 0, llmCalls: 0, failedLlmCalls: 0, llmInputTokens: 0, llmOutputTokens: 0, llmCostUsd: "0" }, trends: { usage: [], errors: [], latency: [], aiCost: [] }, top: { events: [], tenantsByUsage: [], tenantsByErrors: [], tenantsByLlmCalls: [], tenantsByLlmCost: [], llmProviders: [], llmModels: [], llmPrompts: [], errorSeverity: [], errorStatus: [] }, recent: { errors: [], failedTraces: [], failedLlmCalls: [] } } }),
    getOperations: vi.fn().mockResolvedValue({ data: { window: "24h", generatedAt: "", scope: {}, range: {}, status: "ok", summary: { monitors: { total: 0, http: { total: 0, up: 0, degraded: 0, down: 0, paused: 0, unknown: 0 }, heartbeat: { total: 0, up: 0, degraded: 0, down: 0, paused: 0, unknown: 0 } }, alerts: { rules: { total: 0, enabled: 0 }, events: { total: 0, critical: 0, warning: 0, deliveryFailed: 0, deliveryPending: 0 } }, telemetry: { events: 0, errors: 0, traces: 0, failedTraces: 0, errorRatePercent: 0, p95TraceDurationMs: 0, lastEventAt: null, lastErrorAt: null, lastTraceAt: null }, incidents: { open: 0, investigating: 0, urgent: 0, high: 0, regressed: 0 } }, recent: { monitors: [], alerts: [], incidents: [] }, topLatency: [], anomalies: [], setupGaps: [] } }),
    getSystemHealth: vi.fn(),
    getSystemHealthHistory: vi.fn(),
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
    fetchFleet: vi.fn().mockRejectedValue(new Error("fleet unavailable"))
  } satisfies ApiClient;
  const createApiClient = vi.fn((apiBasePath?: string) => (apiBasePath === "/api" ? operationalClient : bootstrapClient));

  return { bootstrapClient, operationalClient, createApiClient };
});

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

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.clearAllMocks();
});

describe("App", () => {
  it("renders the authenticated console workspace", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Operations" })).toBeInTheDocument();
    expect((await screen.findAllByRole("button", { name: /Acme App/ }))[0]).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Production" })).toBeInTheDocument();
    expect(createApiClient).toHaveBeenNthCalledWith(1);
    expect(createApiClient).toHaveBeenNthCalledWith(2, "/api");
    expect(operationalClient.getMe).toHaveBeenCalled();

    await userEvent.click(screen.getByText("Search events, errors, tenants, traces…"));
    const commandPalette = screen.getByRole("dialog", { name: "Command palette" });
    await userEvent.type(within(commandPalette).getByRole("textbox", { name: "Search commands" }), "settings");
    await userEvent.click(within(commandPalette).getByRole("button", { name: "Open Settings" }));
    expect(await screen.findByRole("heading", { name: "Setup" })).toBeInTheDocument();
    await waitFor(() => expect(document.body).toHaveTextContent('endpoint: "https://sigmon.example.com"'));
  });

  describe("v2-only shell", () => {
    it("renders ConsoleShellV2 even when the removed v2 flag is disabled", async () => {
      window.history.replaceState({}, "", "/?v2=0");
      render(<App />);
      await waitFor(() => expect(document.querySelector(".sh-v2")).toBeInTheDocument());
      expect(document.querySelector(".sh-v2")).toBeInTheDocument();
    });

    it("wires AuthGate sign-out into the v2 account menu", async () => {
      operationalClient.logout.mockResolvedValue({ ok: true });
      render(<App />);

      await userEvent.click(await screen.findByRole("button", { name: "Open account menu" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

      await waitFor(() => expect(operationalClient.logout).toHaveBeenCalledTimes(1));
    });

    it.each(["/console/status", "/console/status/"])("keeps %s behind authentication and renders mobile status", async (path) => {
      window.history.replaceState({}, "", path);
      render(<App />);

      expect(await screen.findByLabelText("Fleet status")).toBeInTheDocument();
      expect(operationalClient.getMe).toHaveBeenCalledTimes(1);
      expect(document.querySelector(".ms-root")).toBeInTheDocument();
      expect(document.querySelector(".app")).not.toBeInTheDocument();
    });
  });
});
