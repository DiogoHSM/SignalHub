// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import type { Environment, MonitorResponse, Project } from "../../api/types";
import type { NavSection } from "../nav";
import { MonitorsScreen } from "./MonitorsScreen";
import type { ScreenCtx } from "./registry";

afterEach(cleanup);

const project: Project = { id: "prj_1", name: "Acme", createdAt: "x", updatedAt: "x", archivedAt: null };
const environment: Environment = { id: "env_1", projectId: "prj_1", name: "production", createdAt: "x", updatedAt: "x", archivedAt: null };

function httpMonitor(over: Partial<MonitorResponse> = {}): MonitorResponse {
  return {
    id: "mon_http", projectId: "prj_1", environmentId: "env_1", notificationChannelId: "ch_1",
    kind: "http", name: "API health", enabled: true, status: "up",
    url: "https://api.example.com/health", method: "GET", expectedStatus: "2xx", bodyContains: null,
    timeoutMs: 5000, intervalMinutes: 5, failureThreshold: 2, recoveryThreshold: 2,
    consecutiveFailures: 0, consecutiveSuccesses: 3, expectedIntervalMinutes: null, graceMinutes: null,
    lastCheckedAt: "2026-06-24T11:48:00.000Z", lastCheckStatus: "success", lastCheckLatencyMs: 134,
    lastCheckResponseStatus: 200, lastCheckErrorMessage: null, lastHeartbeatAt: null,
    createdAt: "x", updatedAt: "x", archivedAt: null, ...over,
  };
}

function makeClient(over: Partial<ApiClient> = {}): ApiClient {
  return {
    listMonitors: vi.fn().mockResolvedValue({ monitors: [httpMonitor(), httpMonitor({ id: "mon_hb", kind: "heartbeat", name: "Worker beat", status: "down", url: null, expectedIntervalMinutes: 5, graceMinutes: 2, notificationChannelId: null })] }),
    listNotificationChannels: vi.fn().mockResolvedValue({ channels: [{ id: "ch_1", name: "Ops webhook", type: "webhook", url: "https://hook", emailRecipients: [], secretHeaderName: null, hasSecret: false, enabled: true, createdAt: "x", updatedAt: "x", archivedAt: null }] }),
    listMonitorChecks: vi.fn().mockResolvedValue({ checks: [{ id: "c1", monitorId: "mon_http", checkedAt: "2026-06-24T11:59:00.000Z", status: "success", latencyMs: 120, responseStatus: 200, errorMessage: null, createdAt: "x" }] }),
    ...over,
  } as unknown as ApiClient;
}

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: makeClient(),
    project, environment, environments: [environment],
    onCreateEnvironment: vi.fn(), onArchiveProject: vi.fn(), onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(), onUpdateProject: vi.fn(),
    navigate: vi.fn() as (s: NavSection) => void, back: vi.fn(), drill: vi.fn(), pushToast: vi.fn(),
    ...over,
  };
}

describe("MonitorsScreen — display", () => {
  it("renders the page head and a rollup with counts", async () => {
    render(<MonitorsScreen ctx={makeCtx()} />);
    expect(await screen.findByText("Monitors")).toBeInTheDocument();
    expect(screen.getByText("API health")).toBeInTheDocument();
    expect(screen.getByText("Worker beat")).toBeInTheDocument();
  });

  it("filters the list by kind", async () => {
    render(<MonitorsScreen ctx={makeCtx()} />);
    await screen.findByText("API health");
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Heartbeat" }));
    expect(screen.queryByText("API health")).toBeNull();
    expect(screen.getByText("Worker beat")).toBeInTheDocument();
  });

  it("loads and shows check history when a monitor row is selected", async () => {
    const ctx = makeCtx();
    render(<MonitorsScreen ctx={ctx} />);
    const { fireEvent } = await import("@testing-library/react");
    const row = await screen.findByText("API health");
    fireEvent.click(row);
    await waitFor(() => expect(ctx.client.listMonitorChecks).toHaveBeenCalledWith("mon_http", 20));
    expect(await screen.findByText(/200 · 120ms/)).toBeInTheDocument();
  });

  it("shows an API-unavailable hint when monitor methods are absent", async () => {
    render(<MonitorsScreen ctx={makeCtx({ client: {} as unknown as ApiClient })} />);
    expect(await screen.findByText("Monitors API unavailable")).toBeInTheDocument();
  });

  it("shows an empty hint when there are no monitors", async () => {
    render(<MonitorsScreen ctx={makeCtx({ client: makeClient({ listMonitors: vi.fn().mockResolvedValue({ monitors: [] }) }) })} />);
    expect(await screen.findByText("No monitors yet")).toBeInTheDocument();
  });
});
