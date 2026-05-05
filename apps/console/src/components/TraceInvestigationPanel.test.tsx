import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
    listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [] } }),
    getEntityTenantDetail: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
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

  it("applies filters only after Apply and clears selected trace", async () => {
    const api = client({
      listTraces: vi.fn().mockResolvedValue({ data: [trace({ traceId: "trace_1" })] }),
      listTraceSpans: vi.fn().mockResolvedValue({ data: [span({})] })
    });

    render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /checkout flow/ }));
    expect(await screen.findByText("load cart")).toBeInTheDocument();

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

    expect(await screen.findByText("load cart")).toBeInTheDocument();
    expect(api.listTraceSpans).toHaveBeenCalledWith("trace_1", { projectId: "prj_1", environmentId: "env_1" });
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
    expect(await screen.findByText("new span")).toBeInTheDocument();

    await act(async () => {
      firstSpans.resolve({ data: [span({ name: "old span" })] });
      await firstSpans.promise;
    });

    expect(screen.queryByText("old span")).not.toBeInTheDocument();
    expect(screen.getByText("new span")).toBeInTheDocument();
  });
});
