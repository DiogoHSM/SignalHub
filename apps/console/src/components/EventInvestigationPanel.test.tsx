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

    expect(await screen.findByRole("button", { name: /checkout.started/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /checkout.started/ })).toHaveTextContent("trace_1");
    expect(api.listEvents).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });

  it("summarizes event analytics and highlights top event names from the current result set", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({
        data: [
          event({
            id: "evt_1",
            name: "checkout.started",
            tenantId: "tenant_a",
            userId: "user_1",
            source: "browser",
            properties: { plan: "team", amount: 1200 }
          }),
          event({
            id: "evt_2",
            name: "checkout.started",
            tenantId: "tenant_a",
            userId: "user_2",
            source: "server",
            properties: { plan: "team" }
          }),
          event({
            id: "evt_3",
            name: "invoice.paid",
            tenantId: "tenant_b",
            userId: null,
            source: null,
            properties: { channel: "pix" }
          })
        ]
      })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByRole("region", { name: "Event analytics summary" })).toBeInTheDocument();
    expect(screen.getByLabelText("Total events")).toHaveTextContent("3");
    expect(screen.getByLabelText("Unique event names")).toHaveTextContent("2");
    expect(screen.getByLabelText("Tenants observed")).toHaveTextContent("2");
    expect(screen.getByLabelText("Known users")).toHaveTextContent("2");
    expect(screen.getByRole("region", { name: "Top event names" })).toHaveTextContent("checkout.started");
    expect(screen.getByRole("region", { name: "Top event names" })).toHaveTextContent("2 events");
    const checkoutRows = screen.getAllByRole("button", { name: /checkout.started/ });
    expect(checkoutRows[0]).toHaveTextContent("browser");
    expect(checkoutRows[0]).toHaveTextContent("plan: team");
    expect(screen.getByRole("button", { name: /invoice.paid/ })).toHaveTextContent("anonymous");
    expect(screen.getByRole("button", { name: /invoice.paid/ })).toHaveTextContent("channel: pix");
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

    expect(await screen.findByRole("button", { name: /new.scope/ })).toBeInTheDocument();

    await act(async () => {
      first.resolve({ data: [event({ id: "evt_1", name: "old.scope" })] });
      await first.promise;
    });

    expect(screen.queryByText("old.scope")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new.scope/ })).toBeInTheDocument();
  });
});
