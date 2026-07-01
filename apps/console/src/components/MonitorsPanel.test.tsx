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
    getSystemHealthHistory: vi.fn(),
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
    addTriageNote: vi.fn(),
    silenceIncident: vi.fn(),
    getSessionTimeline: vi.fn(),
    createAlertRule: vi.fn(),
    updateAlertRule: vi.fn(),
    archiveAlertRule: vi.fn(),
    updateAlertEventTriage: vi.fn(),
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
    updateMonitor: vi.fn().mockResolvedValue({
      monitor: monitor({
        name: "API v2",
        url: "https://api.example.com/ready",
        intervalMinutes: 10,
        timeoutMs: 3000
      })
    }),
    archiveMonitor: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } satisfies ApiClient;
}

describe("MonitorsPanel", () => {
  it("renders monitors and recent checks", async () => {
    const api = client();

    render(<MonitorsPanel apiEndpoint="https://my.sigmon.app" client={api} projectId="prj_1" environmentId="env_1" />);

    expect(await screen.findByRole("heading", { name: "Monitors" })).toBeInTheDocument();
    expect(await screen.findByText("API health")).toBeInTheDocument();
    const monitorList = screen.getByRole("region", { name: "Monitor list" });
    expect(within(monitorList).getByText("Monitor", { selector: ".monitors-list-header span" })).toBeInTheDocument();
    expect(within(monitorList).getByText("Target", { selector: ".monitors-list-header span" })).toBeInTheDocument();
    expect(within(monitorList).getByText("Schedule", { selector: ".monitors-list-header span" })).toBeInTheDocument();
    expect(within(monitorList).getByText("Last check", { selector: ".monitors-list-header span" })).toBeInTheDocument();
    expect(within(monitorList).getByText("Status", { selector: ".monitors-list-header span" })).toBeInTheDocument();
    const httpForm = screen.getByRole("region", { name: "Create HTTP monitor" });
    expect(within(httpForm).getByLabelText("Check interval (minutes)")).toBeInTheDocument();
    expect(within(httpForm).getByLabelText("Timeout (milliseconds)")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "Recent monitor checks" })).getByText("success")).toBeInTheDocument()
    );
    expect(api.listMonitors).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });
    expect(api.listMonitorChecks).toHaveBeenCalledWith("mon_1", { projectId: "prj_1", environmentId: "env_1", limit: 20 });
  });

  it("summarizes monitor posture and notification coverage", async () => {
    const api = client({
      listMonitors: vi.fn().mockResolvedValue({
        monitors: [
          monitor({ id: "mon_1", name: "API health", status: "up", notificationChannelId: "chn_1" }),
          monitor({ id: "mon_2", name: "Worker heartbeat", kind: "heartbeat", status: "down", notificationChannelId: null }),
          monitor({ id: "mon_3", name: "Partner API", status: "degraded", notificationChannelId: null })
        ]
      })
    });

    render(<MonitorsPanel apiEndpoint="https://my.sigmon.app" client={api} projectId="prj_1" environmentId="env_1" />);

    const posture = await screen.findByRole("region", { name: "Monitor posture" });
    expect(within(posture).getByText("Total monitors")).toBeInTheDocument();
    await waitFor(() => expect(within(posture).getByText("3")).toBeInTheDocument());
    expect(within(posture).getByText("Down")).toBeInTheDocument();
    expect(within(posture).getByText("Degraded")).toBeInTheDocument();
    expect(within(posture).getByText("Without channel")).toBeInTheDocument();
    expect(screen.getByText("2 monitors have no notification channel.")).toBeInTheDocument();
  });

  it("creates a heartbeat monitor and displays the one-time secret", async () => {
    const api = client();

    render(<MonitorsPanel apiEndpoint="https://my.sigmon.app" client={api} projectId="prj_1" environmentId="env_1" />);

    const heartbeatForm = await screen.findByRole("region", { name: "Create heartbeat monitor" });
    expect(
      within(heartbeatForm).getByText("A heartbeat is down when no check-in arrives inside the expected interval plus grace period.")
    ).toBeInTheDocument();
    expect(within(heartbeatForm).getByLabelText("Expected heartbeat interval (minutes)")).toBeInTheDocument();
    expect(within(heartbeatForm).getByLabelText("Grace period (minutes)")).toBeInTheDocument();
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

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    await userEvent.click(within(secretRegion).getByRole("button", { name: "Copy URL" }));
    expect(writeText).toHaveBeenCalledWith("https://my.sigmon.app/v1/heartbeats/mon_hb");
    expect(within(secretRegion).getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("edits the selected HTTP monitor", async () => {
    const api = client();

    render(<MonitorsPanel apiEndpoint="https://my.sigmon.app" client={api} projectId="prj_1" environmentId="env_1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit API health" }));
    const editForm = screen.getByRole("region", { name: "Edit monitor" });
    await userEvent.clear(within(editForm).getByLabelText("Name", { selector: "input" }));
    await userEvent.type(within(editForm).getByLabelText("Name", { selector: "input" }), "API v2");
    await userEvent.clear(within(editForm).getByLabelText("URL", { selector: "input" }));
    await userEvent.type(within(editForm).getByLabelText("URL", { selector: "input" }), "https://api.example.com/ready");
    await userEvent.clear(within(editForm).getByLabelText("Check interval (minutes)", { selector: "input" }));
    await userEvent.type(within(editForm).getByLabelText("Check interval (minutes)", { selector: "input" }), "10");
    await userEvent.clear(within(editForm).getByLabelText("Timeout (milliseconds)", { selector: "input" }));
    await userEvent.type(within(editForm).getByLabelText("Timeout (milliseconds)", { selector: "input" }), "3000");
    await userEvent.click(within(editForm).getByRole("button", { name: "Save monitor" }));

    await waitFor(() =>
      expect(api.updateMonitor).toHaveBeenCalledWith("mon_1", {
        notificationChannelId: null,
        name: "API v2",
        enabled: true,
        url: "https://api.example.com/ready",
        intervalMinutes: 10,
        timeoutMs: 3000
      })
    );
    expect(await screen.findByText("API v2")).toBeInTheDocument();
  });

  it("uses explicit heartbeat timing labels when editing heartbeat monitors", async () => {
    const api = client({
      listMonitors: vi.fn().mockResolvedValue({
        monitors: [
          monitor({
            id: "mon_hb",
            name: "Worker heartbeat",
            kind: "heartbeat",
            status: "up",
            url: null,
            method: null,
            expectedStatus: null,
            timeoutMs: null,
            intervalMinutes: null,
            expectedIntervalMinutes: 5,
            graceMinutes: 2
          })
        ]
      }),
      updateMonitor: vi.fn().mockResolvedValue({
        monitor: monitor({
          id: "mon_hb",
          name: "Worker heartbeat",
          kind: "heartbeat",
          url: null,
          method: null,
          expectedStatus: null,
          timeoutMs: null,
          intervalMinutes: null,
          expectedIntervalMinutes: 10,
          graceMinutes: 3
        })
      })
    });

    render(<MonitorsPanel apiEndpoint="https://my.sigmon.app" client={api} projectId="prj_1" environmentId="env_1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit Worker heartbeat" }));
    const editForm = screen.getByRole("region", { name: "Edit monitor" });
    await userEvent.clear(within(editForm).getByLabelText("Expected heartbeat interval (minutes)", { selector: "input" }));
    await userEvent.type(within(editForm).getByLabelText("Expected heartbeat interval (minutes)", { selector: "input" }), "10");
    await userEvent.clear(within(editForm).getByLabelText("Grace period (minutes)", { selector: "input" }));
    await userEvent.type(within(editForm).getByLabelText("Grace period (minutes)", { selector: "input" }), "3");
    await userEvent.click(within(editForm).getByRole("button", { name: "Save monitor" }));

    await waitFor(() =>
      expect(api.updateMonitor).toHaveBeenCalledWith("mon_hb", {
        notificationChannelId: null,
        name: "Worker heartbeat",
        enabled: true,
        expectedIntervalMinutes: 10,
        graceMinutes: 3
      })
    );
  });

  it("archives a monitor from the list", async () => {
    const api = client({
      listMonitors: vi.fn().mockResolvedValue({
        monitors: [
          monitor({ id: "mon_1", name: "API health" }),
          monitor({ id: "mon_2", name: "Worker heartbeat", kind: "heartbeat", url: null, expectedIntervalMinutes: 5, graceMinutes: 2 })
        ]
      })
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<MonitorsPanel apiEndpoint="https://my.sigmon.app" client={api} projectId="prj_1" environmentId="env_1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Archive API health" }));

    await waitFor(() => expect(api.archiveMonitor).toHaveBeenCalledWith("mon_1"));
    expect(confirmSpy).toHaveBeenCalledWith('Archive monitor "API health"? Historical checks will be kept.');
    expect(screen.queryByText("API health")).not.toBeInTheDocument();
    expect(await screen.findByText("Worker heartbeat")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});
