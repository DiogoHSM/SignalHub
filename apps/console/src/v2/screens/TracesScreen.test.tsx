// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../api/types";
import { TracesScreen } from "./TracesScreen";
import type { ScreenCtx } from "./registry";
import * as useTracesModule from "./useTraces";
import * as useTraceSpansModule from "./useTraceSpans";
import type { TraceListItemVM } from "./useTraces";
import type { TraceDetailVM } from "./useTraceSpans";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project = { id: "p", name: "Demo" } as Project;
const environment = { id: "e", name: "production" } as Environment;

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: {} as never,
    project, environment, environments: [environment],
    onCreateEnvironment: vi.fn(), onArchiveProject: vi.fn(), onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(), onUpdateProject: vi.fn(), navigate: vi.fn(), back: vi.fn(),
    drill: vi.fn(), pushToast: vi.fn(), ...over,
  } as ScreenCtx;
}

const traces: TraceListItemVM[] = [
  { id: "t1", traceId: "trace_a", name: "POST /api/dashboards", status: "error", hasError: true,
    durationMs: 2380, startedAt: "2026-06-23T12:42:08.412Z", tenantId: "tenant_acme", userId: "user_8420" },
  { id: "t2", traceId: "trace_b", name: "GET /api/health", status: "success", hasError: false,
    durationMs: 12, startedAt: "2026-06-23T12:30:00.000Z", tenantId: null, userId: null },
];

const detail: TraceDetailVM = {
  summary: { totalMs: 2380, spanCount: 3, llmCostUsd: 0.024, llmTimeMs: 1716, dbTimeMs: 430, errorCount: 1 },
  spans: [
    { id: "root", name: "POST /api/dashboards", service: "api", kind: "http", status: "success",
      errored: false, level: 0, hasChildren: true, offsetMs: 0, durMs: 2380, costUsd: null, error: null, metadata: null },
    { id: "child", name: "postgres.query", service: "postgres", kind: "db", status: "success",
      errored: false, level: 1, hasChildren: false, offsetMs: 1145, durMs: 412, costUsd: null, error: null, metadata: null },
    { id: "err", name: "llm.gpt-5 explain", service: "openai", kind: "llm", status: "error",
      errored: true, level: 1, hasChildren: false, offsetMs: 1562, durMs: 642, costUsd: "0.0162",
      error: { message: "AbortError: signal timeout" }, metadata: { foo: "bar" } },
  ],
};

function mockList(data: TraceListItemVM[] | null, status: "loading" | "ok" | "error" = "ok") {
  vi.spyOn(useTracesModule, "useTraces").mockReturnValue({ data, status, reload: vi.fn() });
}
function mockSpans(data: TraceDetailVM | null, status: "loading" | "ok" | "error" = "ok") {
  vi.spyOn(useTraceSpansModule, "useTraceSpans").mockReturnValue({ data, status, reload: vi.fn() });
}

describe("TracesScreen — index", () => {
  it("guards missing project/env", () => {
    mockList(null, "loading");
    render(<TracesScreen ctx={makeCtx({ project: undefined, environment: undefined })} />);
    expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    mockList(null, "loading");
    const { rerender } = render(<TracesScreen ctx={makeCtx()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    mockList(null, "error");
    rerender(<TracesScreen ctx={makeCtx()} />);
    expect(screen.getByText(/could not load traces/i)).toBeInTheDocument();
  });

  it("renders the recent-traces list with title and rows", () => {
    mockList(traces);
    render(<TracesScreen ctx={makeCtx()} />);
    expect(screen.getByText("Traces")).toBeInTheDocument();
    expect(screen.getByText("POST /api/dashboards")).toBeInTheDocument();
    expect(screen.getByText("GET /api/health")).toBeInTheDocument();
  });

  it("History and Filters are stub toasts", async () => {
    mockList(traces);
    const ctx = makeCtx();
    render(<TracesScreen ctx={ctx} />);
    await userEvent.click(screen.getByText("History"));
    await userEvent.click(screen.getByText("Filters"));
    expect(ctx.pushToast).toHaveBeenCalledWith("Trace history is not yet available");
    expect(ctx.pushToast).toHaveBeenCalledWith("Trace filters are not yet available");
  });

  it("empty list shows a hint", () => {
    mockList([]);
    render(<TracesScreen ctx={makeCtx()} />);
    expect(screen.getByText(/no traces/i)).toBeInTheDocument();
  });
});

describe("TracesScreen — detail", () => {
  it("opens a trace into the waterfall view and renders header + summary", async () => {
    mockList(traces);
    mockSpans(detail);
    render(<TracesScreen ctx={makeCtx()} />);
    await userEvent.click(screen.getByText("POST /api/dashboards"));
    // header
    expect(screen.getByText(/has error/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-06-23 12:42:08.412 UTC/)).toBeInTheDocument();
    // summary strip
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByText("Spans")).toBeInTheDocument();
    expect(screen.getByText("Errors")).toBeInTheDocument();
    // waterfall section
    expect(screen.getByText("Waterfall")).toBeInTheDocument();
    expect(screen.getByText("Expand all")).toBeInTheDocument();
  });

  it("selecting a span shows its detail; error span shows error block; cost shown for llm", async () => {
    mockList(traces);
    mockSpans(detail);
    render(<TracesScreen ctx={makeCtx()} />);
    await userEvent.click(screen.getByText("POST /api/dashboards"));
    // default-selected span is the first errored one → error block visible
    expect(screen.getByText("Span detail")).toBeInTheDocument();
    expect(screen.getByText(/AbortError/)).toBeInTheDocument();
    expect(screen.getByText("$ 0.02")).toBeInTheDocument(); // cost of the llm span
  });

  it("Open incident is a stub toast; Copy ID toasts", async () => {
    mockList(traces);
    mockSpans(detail);
    const ctx = makeCtx();
    render(<TracesScreen ctx={ctx} />);
    await userEvent.click(screen.getByText("POST /api/dashboards"));
    await userEvent.click(screen.getByText("Open incident"));
    expect(ctx.pushToast).toHaveBeenCalledWith("Linking spans to incidents is not yet available");
    await userEvent.click(screen.getByText("Copy ID"));
    expect(ctx.pushToast).toHaveBeenCalledWith("Trace ID copied");
  });

  it("Errors filter narrows the waterfall to errored spans", async () => {
    mockList(traces);
    mockSpans(detail);
    render(<TracesScreen ctx={makeCtx()} />);
    await userEvent.click(screen.getByText("POST /api/dashboards"));
    const waterfall = screen.getByText("Waterfall").closest(".sh-card") as HTMLElement;
    await userEvent.click(within(waterfall).getByText("Errors"));
    // only the errored span name remains in the waterfall list
    expect(within(waterfall).queryByText("postgres.query")).not.toBeInTheDocument();
    expect(within(waterfall).getByText("llm.gpt-5 explain")).toBeInTheDocument();
  });

  it("back returns to the index", async () => {
    mockList(traces);
    mockSpans(detail);
    render(<TracesScreen ctx={makeCtx()} />);
    await userEvent.click(screen.getByText("POST /api/dashboards"));
    await userEvent.click(screen.getByText(/recent traces/i));
    expect(screen.getByText("Traces")).toBeInTheDocument();
    expect(screen.getByText("GET /api/health")).toBeInTheDocument();
  });
});
