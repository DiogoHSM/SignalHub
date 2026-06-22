import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { SpanRecord, TraceRecord } from "../api/types";
import { TraceInvestigationPanel } from "./TraceInvestigationPanel";

function trace(overrides: Partial<TraceRecord>): TraceRecord {
  return {
    id: "trc_row_1",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: "tenant_1",
    userId: "user_1",
    sessionId: "session_1",
    traceId: "trace_1",
    timestamp: "2026-05-04T12:00:00.000Z",
    receivedAt: "2026-05-04T12:00:01.000Z",
    source: "api",
    release: "1.0.0",
    metadata: {},
    name: "checkout flow",
    status: "success",
    startedAt: "2026-05-04T12:00:00.000Z",
    endedAt: "2026-05-04T12:00:02.000Z",
    durationMs: 2000,
    ...overrides
  };
}

function span(overrides: Partial<SpanRecord>): SpanRecord {
  return {
    id: "spn_1",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: "tenant_1",
    userId: "user_1",
    sessionId: "session_1",
    traceId: "trace_1",
    timestamp: "2026-05-04T12:00:00.000Z",
    receivedAt: "2026-05-04T12:00:01.000Z",
    source: "api",
    release: "1.0.0",
    metadata: {},
    parentSpanId: null,
    name: "load cart",
    status: "success",
    startedAt: "2026-05-04T12:00:00.000Z",
    endedAt: "2026-05-04T12:00:01.000Z",
    durationMs: 1000,
    input: null,
    output: {},
    error: null,
    costUsd: null,
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
    getSessionTimeline: vi.fn().mockResolvedValue({ data: { sessionId: "sess_1", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: null, to: null }, items: [], page: { nextCursor: null, previousCursor: null } } }),
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

afterEach(() => cleanup());

describe("TraceInvestigationPanel", () => {
  it("loads latest traces without loading spans", async () => {
    const api = client({
      listTraces: vi.fn().mockResolvedValue({ data: [trace({ name: "checkout flow" })] })
    });

    render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("checkout flow")).toBeInTheDocument();
    expect(api.listTraces).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
    expect(api.listTraceSpans).not.toHaveBeenCalled();
  });

  it("loads traces with initial filters and displays them", async () => {
    const api = client({
      listTraces: vi.fn().mockResolvedValue({ data: [] })
    });

    render(
      <TraceInvestigationPanel
        client={api}
        environmentId="env_1"
        initialFilters={{ tenantId: "tenant_1", traceId: "trace_1" }}
        projectId="prj_1"
      />
    );

    expect(await screen.findByText("No traces found")).toBeInTheDocument();
    expect(screen.getByLabelText("Tenant")).toHaveValue("tenant_1");
    expect(screen.getByLabelText("Trace")).toHaveValue("trace_1");
    expect(api.listTraces).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      tenantId: "tenant_1",
      traceId: "trace_1",
      limit: 50
    });
  });

  it("applies filters only after Apply and clears selected trace", async () => {
    const api = client({
      listTraces: vi.fn().mockResolvedValue({ data: [trace({ traceId: "trace_1" })] }),
      listTraceSpans: vi.fn().mockResolvedValue({ data: [span({})] })
    });

    render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /checkout flow/ }));
    expect(await screen.findByRole("button", { name: /load cart/ })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Trace"), "trace_2");
    expect(api.listTraces).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(api.listTraces).toHaveBeenLastCalledWith({ projectId: "prj_1", environmentId: "env_1", traceId: "trace_2", limit: 50 })
    );
    expect(screen.getByText("Select a trace to inspect its spans.")).toBeInTheDocument();
  });

  it("loads spans when a trace is selected", async () => {
    const api = client({
      listTraces: vi.fn().mockResolvedValue({ data: [trace({ traceId: "trace_1" })] }),
      listTraceSpans: vi.fn().mockResolvedValue({ data: [span({ name: "load cart" })] })
    });

    render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /checkout flow/ }));

    expect(await screen.findByRole("button", { name: /load cart/ })).toBeInTheDocument();
    expect(api.listTraceSpans).toHaveBeenCalledWith("trace_1", { projectId: "prj_1", environmentId: "env_1" });
  });

  it("renders a trace waterfall and selected span detail panel", async () => {
    const api = client({
      listTraces: vi.fn().mockResolvedValue({ data: [trace({ traceId: "trace_1", status: "error", durationMs: 2000 })] }),
      listTraceSpans: vi.fn().mockResolvedValue({
        data: [
          span({
            id: "spn_root",
            name: "GET /checkout",
            status: "success",
            startedAt: "2026-05-04T12:00:00.000Z",
            durationMs: 2000,
            metadata: { route: "/checkout" }
          }),
          span({
            id: "spn_db",
            parentSpanId: "spn_root",
            name: "db.orders.insert.with.a.very.long.span.name.that.should.not.break.the.panel",
            status: "error",
            startedAt: "2026-05-04T12:00:01.000Z",
            durationMs: 750,
            input: { table: "orders" },
            output: { rows: 0 },
            error: { message: "duplicate key" },
            metadata: { db: "postgres" },
            costUsd: "0.010000"
          })
        ]
      })
    });

    render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /checkout flow/ }));

    const summary = await screen.findByRole("region", { name: "Trace summary" });
    expect(within(summary).getByText("error")).toBeInTheDocument();
    expect(within(summary).getByText("2 spans")).toBeInTheDocument();
    expect(within(summary).getByText("2000 ms")).toBeInTheDocument();
    expect(within(summary).getByText("Tenant tenant_1")).toBeInTheDocument();
    expect(within(summary).getByText("User user_1")).toBeInTheDocument();

    const waterfall = screen.getByRole("region", { name: "Trace waterfall" });
    expect(within(waterfall).getByRole("button", { name: /GET \/checkout/ })).toBeInTheDocument();
    expect(within(waterfall).getByRole("button", { name: /db\.orders\.insert/ })).toBeInTheDocument();

    await userEvent.click(within(waterfall).getByRole("button", { name: /db\.orders\.insert/ }));

    const spanDetail = screen.getByRole("region", { name: "Selected span details" });
    expect(within(spanDetail).getByText("db.orders.insert.with.a.very.long.span.name.that.should.not.break.the.panel")).toBeInTheDocument();
    expect(within(spanDetail).getByText("Parent spn_root")).toBeInTheDocument();
    expect(within(spanDetail).getByText("Cost $0.010000")).toBeInTheDocument();
    expect(within(spanDetail).getByText(/duplicate key/)).toBeInTheDocument();
    expect(within(spanDetail).getByText(/"table": "orders"/)).toBeInTheDocument();
    expect(within(spanDetail).getByText(/"db": "postgres"/)).toBeInTheDocument();
  });

  it("summarizes loaded spans by health and operation before the waterfall", async () => {
    const api = client({
      listTraces: vi.fn().mockResolvedValue({ data: [trace({ traceId: "trace_1", durationMs: 2500 })] }),
      listTraceSpans: vi.fn().mockResolvedValue({
        data: [
          span({ id: "spn_http", name: "GET /api/orders", status: "success", parentSpanId: null, durationMs: 2500 }),
          span({ id: "spn_db", name: "postgres orders query", status: "error", parentSpanId: "spn_http", durationMs: 900 }),
          span({ id: "spn_llm", name: "openai classify intent", status: "success", parentSpanId: "spn_http", durationMs: 1200 })
        ]
      })
    });

    render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /checkout flow/ }));

    const analysis = await screen.findByRole("region", { name: "Span analysis" });
    expect(within(analysis).getByLabelText("Total spans")).toHaveTextContent("3");
    expect(within(analysis).getByLabelText("Error spans")).toHaveTextContent("1");
    expect(within(analysis).getByLabelText("Root spans")).toHaveTextContent("1");
    expect(within(analysis).getByLabelText("Longest span")).toHaveTextContent("2500 ms");
    expect(within(analysis).getByText("http")).toBeInTheDocument();
    expect(within(analysis).getByText("db")).toBeInTheDocument();
    expect(within(analysis).getByText("llm")).toBeInTheDocument();
    expect(within(analysis).getByText("error 1")).toBeInTheDocument();
  });

  it("shows independent unavailable states and retries", async () => {
    const api = client({
      listTraces: vi.fn().mockRejectedValueOnce(new Error("trace failed")).mockResolvedValueOnce({ data: [trace({})] }),
      listTraceSpans: vi.fn().mockRejectedValueOnce(new Error("span failed")).mockResolvedValueOnce({ data: [] })
    });

    render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("Traces unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry traces" }));
    await userEvent.click(await screen.findByRole("button", { name: /checkout flow/ }));
    expect(await screen.findByText("Spans unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry spans" }));
    expect(await screen.findByText("No spans found for this trace.")).toBeInTheDocument();
  });

  it("ignores stale trace responses after environment changes", async () => {
    const firstTraces = deferred<{ data: TraceRecord[] }>();
    const api = client({
      listTraces: vi.fn().mockReturnValueOnce(firstTraces.promise).mockResolvedValueOnce({ data: [trace({ environmentId: "env_2", name: "new trace" })] })
    });

    const { rerender } = render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);
    rerender(<TraceInvestigationPanel client={api} environmentId="env_2" projectId="prj_1" />);

    expect(await screen.findByText("new trace")).toBeInTheDocument();

    await act(async () => {
      firstTraces.resolve({ data: [trace({ name: "old trace" })] });
      await firstTraces.promise;
    });

    expect(screen.queryByText("old trace")).not.toBeInTheDocument();
    expect(screen.getByText("new trace")).toBeInTheDocument();
  });

  it("ignores stale span responses after selecting another trace", async () => {
    const firstSpans = deferred<{ data: SpanRecord[] }>();
    const api = client({
      listTraces: vi.fn().mockResolvedValue({
        data: [
          trace({ id: "trc_row_1", traceId: "trace_1", name: "old trace" }),
          trace({ id: "trc_row_2", traceId: "trace_2", name: "new trace" })
        ]
      }),
      listTraceSpans: vi.fn().mockReturnValueOnce(firstSpans.promise).mockResolvedValueOnce({ data: [span({ traceId: "trace_2", name: "new span" })] })
    });

    render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /old trace/ }));
    await userEvent.click(await screen.findByRole("button", { name: /new trace/ }));
    expect(await screen.findByRole("button", { name: /new span/ })).toBeInTheDocument();

    await act(async () => {
      firstSpans.resolve({ data: [span({ name: "old span" })] });
      await firstSpans.promise;
    });

    expect(screen.queryByText("old span")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new span/ })).toBeInTheDocument();
  });
});
