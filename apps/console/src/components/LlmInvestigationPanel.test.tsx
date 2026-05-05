import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { LlmAggregates, LlmCallRecord } from "../api/types";
import { LlmInvestigationPanel } from "./LlmInvestigationPanel";

function llmCall(overrides: Partial<LlmCallRecord>): LlmCallRecord {
  return {
    id: "llm_1",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: "tenant_1",
    userId: "user_1",
    sessionId: "session_1",
    traceId: "trace_1",
    timestamp: "2026-05-05T12:00:00.000Z",
    receivedAt: "2026-05-05T12:00:01.000Z",
    source: "api",
    release: "1.0.0",
    metadata: {},
    provider: "openai",
    model: "gpt-5",
    promptName: "generate_sql",
    inputTokens: 120,
    outputTokens: 80,
    costUsd: "0.250000",
    latencyMs: 1800,
    status: "success",
    error: null,
    inputPreview: "input",
    outputPreview: "output",
    ...overrides
  };
}

function aggregates(overrides: Partial<LlmAggregates> = {}): LlmAggregates {
  return {
    totalCalls: 3,
    totalInputTokens: 300,
    totalOutputTokens: 200,
    totalCostUsd: "0.750000",
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
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn(),
    getLlmAggregates: vi.fn().mockResolvedValue({ data: aggregates({ totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" }) }),
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

describe("LlmInvestigationPanel", () => {
  it("loads latest LLM calls and aggregate totals", async () => {
    const api = client({
      listLlmCalls: vi.fn().mockResolvedValue({ data: [llmCall({ provider: "openai", model: "gpt-5" })] }),
      getLlmAggregates: vi.fn().mockResolvedValue({ data: aggregates() })
    });

    render(<LlmInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("openai / gpt-5")).toBeInTheDocument();
    const totals = screen.getByLabelText("LLM totals");
    expect(within(totals).getByText("3")).toBeInTheDocument();
    expect(within(totals).getByText("0.750000")).toBeInTheDocument();
    expect(api.listLlmCalls).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
    expect(api.getLlmAggregates).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });

  it("applies initial filters and updates them when they change", async () => {
    const api = client({
      listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
      getLlmAggregates: vi.fn().mockResolvedValue({ data: aggregates() })
    });

    const { rerender } = render(
      <LlmInvestigationPanel
        client={api}
        environmentId="env_1"
        initialFilters={{ provider: "openai", model: "gpt-5" }}
        projectId="prj_1"
      />
    );

    expect(await screen.findByText("No LLM calls found")).toBeInTheDocument();
    expect(screen.getByLabelText("Provider")).toHaveValue("openai");
    expect(screen.getByLabelText("Model")).toHaveValue("gpt-5");
    expect(api.listLlmCalls).toHaveBeenLastCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      provider: "openai",
      model: "gpt-5",
      limit: 50
    });

    rerender(<LlmInvestigationPanel client={api} environmentId="env_1" initialFilters={{ promptName: "summarize_signal" }} projectId="prj_1" />);

    await waitFor(() =>
      expect(api.listLlmCalls).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        promptName: "summarize_signal",
        limit: 50
      })
    );
    expect(api.getLlmAggregates).toHaveBeenLastCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      promptName: "summarize_signal",
      limit: 50
    });
    expect(screen.getByLabelText("Provider")).toHaveValue("");
    expect(screen.getByLabelText("Prompt")).toHaveValue("summarize_signal");
  });

  it("applies filters only after Apply and clears selected call", async () => {
    const api = client({
      listLlmCalls: vi.fn().mockResolvedValue({ data: [llmCall({})] }),
      getLlmAggregates: vi.fn().mockResolvedValue({ data: aggregates() })
    });

    render(<LlmInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /openai \/ gpt-5/ }));
    expect(await screen.findByText("input")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Provider"), "anthropic");
    expect(api.listLlmCalls).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(api.listLlmCalls).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        provider: "anthropic",
        limit: 50
      })
    );
    expect(api.getLlmAggregates).toHaveBeenLastCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      provider: "anthropic",
      limit: 50
    });
    expect(screen.getByText("Select an LLM call to inspect its details.")).toBeInTheDocument();
  });

  it("shows independent unavailable states and retries", async () => {
    const api = client({
      listLlmCalls: vi.fn().mockRejectedValueOnce(new Error("list failed")).mockResolvedValueOnce({ data: [] }),
      getLlmAggregates: vi.fn().mockRejectedValueOnce(new Error("totals failed")).mockResolvedValueOnce({ data: aggregates() })
    });

    render(<LlmInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("LLM calls unavailable")).toBeInTheDocument();
    expect(await screen.findByText("LLM totals unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry calls" }));
    await userEvent.click(screen.getByRole("button", { name: "Retry totals" }));
    expect(await screen.findByText("No LLM calls found")).toBeInTheDocument();
    expect(await screen.findByText("0.750000")).toBeInTheDocument();
  });

  it("ignores stale LLM list and aggregate responses", async () => {
    const firstCalls = deferred<{ data: LlmCallRecord[] }>();
    const firstTotals = deferred<{ data: LlmAggregates }>();
    const api = client({
      listLlmCalls: vi
        .fn()
        .mockReturnValueOnce(firstCalls.promise)
        .mockResolvedValueOnce({ data: [llmCall({ provider: "anthropic", model: "claude", environmentId: "env_2" })] }),
      getLlmAggregates: vi
        .fn()
        .mockReturnValueOnce(firstTotals.promise)
        .mockResolvedValueOnce({ data: aggregates({ totalCalls: 9, totalCostUsd: "9.000000" }) })
    });

    const { rerender } = render(<LlmInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);
    rerender(<LlmInvestigationPanel client={api} environmentId="env_2" projectId="prj_1" />);

    expect(await screen.findByText("anthropic / claude")).toBeInTheDocument();
    expect(await screen.findByText("9.000000")).toBeInTheDocument();

    await act(async () => {
      firstCalls.resolve({ data: [llmCall({ provider: "old", model: "model" })] });
      firstTotals.resolve({ data: aggregates({ totalCalls: 1, totalCostUsd: "1.000000" }) });
      await Promise.all([firstCalls.promise, firstTotals.promise]);
    });

    expect(screen.queryByText("old / model")).not.toBeInTheDocument();
    expect(screen.queryByText("1.000000")).not.toBeInTheDocument();
    expect(screen.getByText("anthropic / claude")).toBeInTheDocument();
    expect(screen.getByText("9.000000")).toBeInTheDocument();
  });
});
