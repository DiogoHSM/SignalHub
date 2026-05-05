import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { EventRecord } from "../api/types";
import { EventInvestigationPanel } from "./EventInvestigationPanel";

function event(overrides: Partial<EventRecord>): EventRecord {
  return {
    id: "evt_1",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: "tenant_1",
    userId: "user_1",
    sessionId: "session_1",
    traceId: "trace_1",
    timestamp: "2026-05-04T12:00:00.000Z",
    receivedAt: "2026-05-04T12:00:01.000Z",
    source: "web",
    release: "1.0.0",
    metadata: {},
    name: "checkout.started",
    properties: {},
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
    listEvents: vi.fn().mockResolvedValue({ data: [] }),
    listErrors: vi.fn(),
    listTraces: vi.fn().mockResolvedValue({ data: [] }),
    listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
    listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
    getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } }),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
});

describe("EventInvestigationPanel", () => {
  it("loads latest events for the active project and environment", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [event({ id: "evt_1", name: "checkout.started" })] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("checkout.started")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /checkout.started/ })).toHaveTextContent("trace_1");
    expect(api.listEvents).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });

  it("applies initial filters and updates them when they change", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [] })
    });

    const { rerender } = render(
      <EventInvestigationPanel client={api} environmentId="env_1" initialFilters={{ eventName: "dashboard_created" }} projectId="prj_1" />
    );

    expect(await screen.findByText("No events found")).toBeInTheDocument();
    expect(screen.getByLabelText("Event name")).toHaveValue("dashboard_created");
    expect(api.listEvents).toHaveBeenLastCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      eventName: "dashboard_created",
      limit: 50
    });

    rerender(<EventInvestigationPanel client={api} environmentId="env_1" initialFilters={{ tenantId: "tenant_1" }} projectId="prj_1" />);

    await waitFor(() =>
      expect(api.listEvents).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        tenantId: "tenant_1",
        limit: 50
      })
    );
    expect(screen.getByLabelText("Event name")).toHaveValue("");
    expect(screen.getByLabelText("Tenant")).toHaveValue("tenant_1");
  });

  it("applies event name filters only after Apply", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No events found");
    await userEvent.type(screen.getByLabelText("Event name"), "checkout.started");

    expect(api.listEvents).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(api.listEvents).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        eventName: "checkout.started",
        limit: 50
      })
    );
  });

  it("resets optional filters and reloads latest events", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No events found");
    await userEvent.type(screen.getByLabelText("Event name"), "checkout.started");
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.getByLabelText("Event name")).toHaveValue("");
    await waitFor(() =>
      expect(api.listEvents).toHaveBeenLastCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 })
    );
  });

  it("opens the detail drawer when an event is selected", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [event({ id: "evt_1", name: "checkout.started" })] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /checkout.started/ }));

    expect(screen.getByRole("heading", { name: "checkout.started" })).toBeInTheDocument();
    expect(screen.getAllByText("trace_1")).toHaveLength(2);
  });

  it("shows unavailable state and retries after query failure", async () => {
    const api = client({
      listEvents: vi.fn().mockRejectedValueOnce(new Error("query failed")).mockResolvedValueOnce({ data: [] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("Events unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No events found")).toBeInTheDocument();
  });

  it("ignores stale event responses after scope changes", async () => {
    const first = deferred<{ data: EventRecord[] }>();
    const api = client({
      listEvents: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ data: [event({ id: "evt_2", environmentId: "env_2", name: "new.scope" })] })
    });

    const { rerender } = render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    rerender(<EventInvestigationPanel client={api} environmentId="env_2" projectId="prj_1" />);

    expect(await screen.findByText("new.scope")).toBeInTheDocument();

    await act(async () => {
      first.resolve({ data: [event({ id: "evt_1", name: "old.scope" })] });
      await first.promise;
    });

    expect(screen.queryByText("old.scope")).not.toBeInTheDocument();
    expect(screen.getByText("new.scope")).toBeInTheDocument();
  });
});
