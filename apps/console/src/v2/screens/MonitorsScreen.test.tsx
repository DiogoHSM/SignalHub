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
    createHttpMonitor: vi.fn().mockResolvedValue({ monitor: httpMonitor({ id: "mon_new", name: "Checkout" }) }),
    createHeartbeatMonitor: vi.fn().mockResolvedValue({ monitor: httpMonitor({ id: "mon_hb_new", kind: "heartbeat", name: "Beat" }), secret: null }),
    updateMonitor: vi.fn().mockResolvedValue({ monitor: httpMonitor() }),
    archiveMonitor: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as ApiClient;
}

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: makeClient(),
    project, environment, environments: [environment],
    onCreateEnvironment: vi.fn(), onArchiveProject: vi.fn(), onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(), onUpdateProject: vi.fn(),
    navigate: vi.fn() as (s: NavSection) => void, pendingFilters: null, clearPendingFilters: vi.fn(),
    back: vi.fn(), drill: vi.fn(), pushToast: vi.fn(),
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
    await waitFor(() =>
      expect(ctx.client.listMonitorChecks).toHaveBeenCalledWith("mon_http", {
        projectId: "prj_1",
        environmentId: "env_1",
        limit: 20,
      })
    );
    expect(await screen.findByText(/200 · 120ms/)).toBeInTheDocument();
  });

  it("shows an API-unavailable hint when monitor methods are absent", async () => {
    render(<MonitorsScreen ctx={makeCtx({ client: {} as unknown as ApiClient })} />);
    expect(await screen.findByText("Monitors API unavailable")).toBeInTheDocument();
  });

  it("recovers a failed monitor request locally with the same project and environment", async () => {
    const listMonitors = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ monitors: [httpMonitor()] });
    const ctx = makeCtx({ client: makeClient({ listMonitors }) });
    render(<MonitorsScreen ctx={ctx} />);
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(await screen.findByRole("button", { name: "Retry monitors" }));
    expect(await screen.findByText("API health")).toBeInTheDocument();
    expect(listMonitors).toHaveBeenCalledTimes(2);
    expect(listMonitors.mock.calls[1]).toEqual(listMonitors.mock.calls[0]);
    expect(listMonitors.mock.calls[1][0]).toEqual(expect.objectContaining({ projectId: "prj_1", environmentId: "env_1" }));
  });

  it("shows an empty hint when there are no monitors", async () => {
    render(<MonitorsScreen ctx={makeCtx({ client: makeClient({ listMonitors: vi.fn().mockResolvedValue({ monitors: [] }) }) })} />);
    expect(await screen.findByText("No monitors yet")).toBeInTheDocument();
  });
});

describe("MonitorsScreen — mutations", () => {
  it("creates an HTTP monitor from the create panel", async () => {
    const ctx = makeCtx();
    const { fireEvent } = await import("@testing-library/react");
    render(<MonitorsScreen ctx={ctx} />);
    await screen.findByText("API health");
    fireEvent.click(screen.getByRole("button", { name: /New monitor/ }));
    fireEvent.change(screen.getByLabelText("Monitor name"), { target: { value: "Checkout" } });
    fireEvent.change(screen.getByLabelText("Monitor URL"), { target: { value: "https://api.example.com/checkout" } });
    fireEvent.click(screen.getByRole("button", { name: "Create monitor" }));
    await waitFor(() =>
      expect(ctx.client.createHttpMonitor).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Checkout", url: "https://api.example.com/checkout", projectId: "prj_1", environmentId: "env_1" }),
      ),
    );
  });

  it("creates a heartbeat monitor and reveals the one-time secret", async () => {
    const client = makeClient({
      createHeartbeatMonitor: vi.fn().mockResolvedValue({ monitor: { id: "mon_new", name: "Beat" }, secret: "hb_secret_value" }),
    });
    const ctx = makeCtx({ client });
    const { fireEvent } = await import("@testing-library/react");
    render(<MonitorsScreen ctx={ctx} />);
    await screen.findByText("API health");
    fireEvent.click(screen.getByRole("button", { name: /New monitor/ }));
    // Two "Heartbeat" buttons exist (page filter + create panel kind toggle); pick the panel's one
    const heartbeatBtns = screen.getAllByRole("button", { name: "Heartbeat" });
    fireEvent.click(heartbeatBtns[heartbeatBtns.length - 1]);
    fireEvent.change(screen.getByLabelText("Monitor name"), { target: { value: "Beat" } });
    fireEvent.click(screen.getByRole("button", { name: "Create monitor" }));
    await waitFor(() => expect(client.createHeartbeatMonitor).toHaveBeenCalled());
    expect(await screen.findByText(/Heartbeat created/)).toBeInTheDocument();
  });

  it("edits a monitor inline", async () => {
    const ctx = makeCtx();
    const { fireEvent } = await import("@testing-library/react");
    render(<MonitorsScreen ctx={ctx} />);
    await screen.findByText("API health");
    fireEvent.click(screen.getByRole("button", { name: "Edit API health" }));
    fireEvent.change(screen.getByLabelText("Monitor name"), { target: { value: "API health v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save monitor" }));
    await waitFor(() =>
      expect(ctx.client.updateMonitor).toHaveBeenCalledWith(
        "mon_http",
        // the existing channel + cadence must be preserved, not reset, when only the name changes
        expect.objectContaining({ name: "API health v2", notificationChannelId: "ch_1", intervalMinutes: 5, timeoutMs: 5000 }),
      ),
    );
  });

  it("archives a monitor with a 2-click confirm", async () => {
    const ctx = makeCtx();
    const { fireEvent } = await import("@testing-library/react");
    render(<MonitorsScreen ctx={ctx} />);
    await screen.findByText("API health");
    const archive = screen.getByRole("button", { name: "Archive API health" });
    fireEvent.click(archive); // arm
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ })); // confirm
    await waitFor(() => expect(ctx.client.archiveMonitor).toHaveBeenCalledWith("mon_http"));
  });

  it("pushes a toast and does not throw when archiving a monitor fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = makeClient({ archiveMonitor: vi.fn().mockRejectedValue(new Error("network error")) });
    const ctx = makeCtx({ client });
    const { fireEvent } = await import("@testing-library/react");
    render(<MonitorsScreen ctx={ctx} />);
    await screen.findByText("API health");
    fireEvent.click(screen.getByRole("button", { name: "Archive API health" })); // arm
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ })); // confirm
    await waitFor(() => expect(ctx.pushToast).toHaveBeenCalledWith("Could not archive monitor"));
  });
});


it("distinguishes an empty kind filter from no configured monitors and clears it", async () => {
  render(<MonitorsScreen ctx={makeCtx({ client: makeClient({ listMonitors: vi.fn().mockResolvedValue({ monitors: [httpMonitor()] }) }) })} />);
  await screen.findByText("API health");
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.click(screen.getByRole("button", { name: "Heartbeat" }));
  expect(screen.getByText("No heartbeat monitors")).toBeInTheDocument();
  expect(screen.queryByText("No monitors yet")).not.toBeInTheDocument();
  expect(screen.queryByText(/No monitor coverage/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show all monitors" }));
  expect(screen.getByText("API health")).toBeInTheDocument();
  expect(screen.queryByText("No heartbeat monitors")).not.toBeInTheDocument();
});
