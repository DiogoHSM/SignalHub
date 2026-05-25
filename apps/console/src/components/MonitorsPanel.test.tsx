import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { MonitorResponse } from "../api/types";
import { MonitorsPanel } from "./MonitorsPanel";

afterEach(() => {
  cleanup();
});

function monitor(overrides: Partial<MonitorResponse> = {}): MonitorResponse {
  return {
    id: "mon_1",
    projectId: "prj_1",
    environmentId: "env_1",
    notificationChannelId: null,
    kind: "http",
    name: "API health",
    enabled: true,
    status: "up",
    url: "https://api.example.com/health",
    method: "GET",
    expectedStatus: "2xx",
    bodyContains: null,
    timeoutMs: 5000,
    intervalMinutes: 5,
    failureThreshold: 2,
    recoveryThreshold: 2,
    consecutiveFailures: 0,
    consecutiveSuccesses: 1,
    expectedIntervalMinutes: null,
    graceMinutes: null,
    lastCheckedAt: "2026-05-06T12:00:00.000Z",
    lastCheckStatus: "success",
    lastCheckLatencyMs: 42,
    lastCheckResponseStatus: 200,
    lastCheckErrorMessage: null,
    lastHeartbeatAt: null,
    createdAt: "2026-05-06T11:00:00.000Z",
    updatedAt: "2026-05-06T12:00:00.000Z",
    archivedAt: null,
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
    listUsersActivity: vi.fn(),
    getUserDetail: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    listAlertRules: vi.fn(),
    listNotificationChannels: vi.fn().mockResolvedValue({ channels: [] }),
    listAlertEvents: vi.fn(),
    getAlertEvent: vi.fn(),
    listErrorGroups: vi.fn(),
    getErrorGroup: vi.fn(),
    getErrorGroupIncident: vi.fn(),
    updateErrorGroupStatus: vi.fn(),
    updateErrorGroupTriage: vi.fn(),
    getSessionTimeline: vi.fn(),
    createAlertRule: vi.fn(),
    updateAlertRule: vi.fn(),
    archiveAlertRule: vi.fn(),
    createNotificationChannel: vi.fn(),
    updateNotificationChannel: vi.fn(),
    archiveNotificationChannel: vi.fn(),
    listMonitors: vi.fn().mockResolvedValue({ monitors: [monitor()] }),
    listMonitorChecks: vi.fn().mockResolvedValue({
      checks: [
        {
          id: "mchk_1",
          monitorId: "mon_1",
          checkedAt: "2026-05-06T12:00:00.000Z",
          status: "success",
          latencyMs: 42,
          responseStatus: 200,
          errorMessage: null,
          createdAt: "2026-05-06T12:00:00.000Z"
        }
      ]
    }),
    createHttpMonitor: vi.fn().mockResolvedValue({ monitor: monitor({ id: "mon_2", name: "New API" }) }),
    createHeartbeatMonitor: vi.fn().mockResolvedValue({
      monitor: monitor({
        id: "mon_hb",
        kind: "heartbeat",
        name: "Queue heartbeat",
        url: null,
        method: null,
        expectedStatus: null,
        timeoutMs: null,
        intervalMinutes: null,
        expectedIntervalMinutes: 5,
        graceMinutes: 2
      }),
      secret: "shhb_secret"
    }),
    ...overrides
  } satisfies ApiClient;
}

describe("MonitorsPanel", () => {
  it("renders monitors and recent checks", async () => {
    const api = client();

    render(<MonitorsPanel apiEndpoint="https://my.sigmon.app" client={api} projectId="prj_1" environmentId="env_1" />);

    expect(await screen.findByRole("heading", { name: "Monitors" })).toBeInTheDocument();
    expect(await screen.findByText("API health")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "Recent monitor checks" })).getByText("success")).toBeInTheDocument()
    );
    expect(api.listMonitors).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });
    expect(api.listMonitorChecks).toHaveBeenCalledWith("mon_1", 20);
  });

  it("creates a heartbeat monitor and displays the one-time secret", async () => {
    const api = client();

    render(<MonitorsPanel apiEndpoint="https://my.sigmon.app" client={api} projectId="prj_1" environmentId="env_1" />);

    const heartbeatForm = await screen.findByRole("region", { name: "Create heartbeat monitor" });
    await userEvent.type(within(heartbeatForm).getByLabelText("Name", { selector: "input" }), "Queue heartbeat");
    await userEvent.click(screen.getByRole("button", { name: "Create heartbeat monitor" }));

    await waitFor(() =>
      expect(api.createHeartbeatMonitor).toHaveBeenCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        notificationChannelId: null,
        name: "Queue heartbeat",
        expectedIntervalMinutes: 5,
        graceMinutes: 2,
        enabled: true
      })
    );
    const secretRegion = await screen.findByRole("region", { name: "New heartbeat secret" });
    expect(within(secretRegion).getByDisplayValue("https://my.sigmon.app/v1/heartbeats/mon_hb")).toBeInTheDocument();
    expect(within(secretRegion).getByDisplayValue("shhb_secret")).toBeInTheDocument();
  });
});
