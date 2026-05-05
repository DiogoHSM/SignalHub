import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { ErrorRecord } from "../api/types";
import { ErrorInvestigationPanel } from "./ErrorInvestigationPanel";

function error(overrides: Partial<ErrorRecord>): ErrorRecord {
  return {
    id: "err_1",
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
    message: "Checkout fetch failed",
    type: "TypeError",
    severity: "critical",
    stack: "TypeError: Checkout fetch failed\n    at checkout.ts:12:3",
    status: "open",
    fingerprint: "fp_checkout_fetch",
    context: {},
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
    listErrors: vi.fn().mockResolvedValue({ data: [] }),
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

describe("ErrorInvestigationPanel", () => {
  it("shows loading state while latest errors are unresolved", () => {
    const pending = deferred<{ data: ErrorRecord[] }>();
    const api = client({
      listErrors: vi.fn().mockReturnValue(pending.promise)
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(screen.getByText("Loading errors")).toBeInTheDocument();
    expect(api.listErrors).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });

  it("loads latest errors for the active project and environment", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [error({ id: "err_1", message: "Checkout fetch failed" })] })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("Checkout fetch failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Checkout fetch failed/ })).toHaveTextContent("trace_1");
    expect(api.listErrors).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });

  it("applies exact filters only after Apply", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [] })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No errors found");
    await userEvent.type(screen.getByLabelText("Severity"), "critical");
    await userEvent.type(screen.getByLabelText("Status"), "open");
    await userEvent.type(screen.getByLabelText("Fingerprint"), "fp_checkout_fetch");

    expect(api.listErrors).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(api.listErrors).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        severity: "critical",
        status: "open",
        fingerprint: "fp_checkout_fetch",
        limit: 50
      })
    );
  });

  it("resets optional filters and reloads latest errors", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [] })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No errors found");
    await userEvent.type(screen.getByLabelText("Severity"), "critical");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.getByLabelText("Severity")).toHaveValue("");
    await waitFor(() =>
      expect(api.listErrors).toHaveBeenLastCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 })
    );
  });

  it("defaults empty limits to 50", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [] })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No errors found");

    await userEvent.clear(screen.getByLabelText("Limit"));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(api.listErrors).toHaveBeenLastCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 })
    );
  });

  it("opens the detail drawer when an error is selected", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [error({ id: "err_1", message: "Checkout fetch failed" })] })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /Checkout fetch failed/ }));

    expect(screen.getByRole("heading", { name: "Checkout fetch failed" })).toBeInTheDocument();
    expect(screen.getAllByText("trace_1")).toHaveLength(2);
    expect(screen.getByText(/at checkout\.ts:12:3/)).toBeInTheDocument();
  });

  it("shows unavailable state and retries after query failure", async () => {
    const api = client({
      listErrors: vi.fn().mockRejectedValueOnce(new Error("query failed")).mockResolvedValueOnce({ data: [] })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("Errors unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No errors found")).toBeInTheDocument();
  });

  it("ignores stale error responses after scope changes", async () => {
    const first = deferred<{ data: ErrorRecord[] }>();
    const api = client({
      listErrors: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ data: [error({ id: "err_2", environmentId: "env_2", message: "New scope failed" })] })
    });

    const { rerender } = render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    rerender(<ErrorInvestigationPanel client={api} environmentId="env_2" projectId="prj_1" />);

    expect(await screen.findByText("New scope failed")).toBeInTheDocument();

    await act(async () => {
      first.resolve({ data: [error({ id: "err_1", message: "Old scope failed" })] });
      await first.promise;
    });

    expect(screen.queryByText("Old scope failed")).not.toBeInTheDocument();
    expect(screen.getByText("New scope failed")).toBeInTheDocument();
  });
});
