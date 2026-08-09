// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../api/types";
import { TracesScreen } from "./TracesScreen";
import type { ScreenCtx } from "./registry";
import * as useTracesModule from "./useTraces";
import * as useTraceSpansModule from "./useTraceSpans";
import type { ApmEndpointVM, ServiceMapEdgeVM, TraceListItemVM, UseTracesResult, WebVitalMetricVM } from "./useTraces";
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
    onSelectEnvironment: vi.fn(), onUpdateProject: vi.fn(), navigate: vi.fn(),
    pendingFilters: null, clearPendingFilters: vi.fn(), back: vi.fn(),
    drill: vi.fn(), pushToast: vi.fn(), ...over,
  } as ScreenCtx;
}

const traces: TraceListItemVM[] = [
  { id: "t1", traceId: "trace_a", name: "POST /api/dashboards", status: "error", hasError: true,
    durationMs: 2380, startedAt: "2026-06-23T12:42:08.412Z", tenantId: "tenant_acme", userId: "user_8420" },
  { id: "t2", traceId: "trace_b", name: "GET /api/health", status: "success", hasError: false,
    durationMs: 12, startedAt: "2026-06-23T12:30:00.000Z", tenantId: null, userId: null },
];

const endpoints: ApmEndpointVM[] = [
  {
    name: "POST /api/dashboards",
    requests: 42,
    errors: 3,
    errorRatePercent: 7.1,
    p50DurationMs: 180,
    p95DurationMs: 2380,
    p99DurationMs: 3100,
    averageDurationMs: 430,
    apdex: 0.82,
    lastSeenAt: "2026-06-23T12:42:08.412Z",
  },
  {
    name: "GET /api/health",
    requests: 100,
    errors: 0,
    errorRatePercent: 0,
    p50DurationMs: 8,
    p95DurationMs: 12,
    p99DurationMs: 18,
    averageDurationMs: 9,
    apdex: 1,
    lastSeenAt: "2026-06-23T12:30:00.000Z",
  },
];

const serviceMapEdges: ServiceMapEdgeVM[] = [
  {
    source: "api",
    target: "postgres",
    dependencyType: "database",
    spans: 12,
    traces: 4,
    errors: 1,
    errorRatePercent: 8.3,
    averageDurationMs: 180,
    p95DurationMs: 430,
    lastSeenAt: "2026-06-23T12:42:08.412Z",
  },
];

const webVitalMetrics: WebVitalMetricVM[] = [
  {
    name: "LCP",
    route: "/dashboard",
    samples: 2,
    good: 1,
    needsImprovement: 1,
    poor: 0,
    averageValue: 2650,
    p75Value: 2925,
    latestRelease: "1.0.1",
    latestReleaseP75Value: 3200,
    previousRelease: "1.0.0",
    previousReleaseP75Value: 2100,
    regressionPercent: 52,
    lastSeenAt: "2026-06-23T12:42:08.412Z",
  },
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
  const result: UseTracesResult = {
    data,
    endpoints,
    serviceMap: {
      edges: serviceMapEdges,
      totals: { services: 2, edges: 1, spans: 12, errors: 1, errorRatePercent: 8.3 },
    },
    webVitals: {
      metrics: webVitalMetrics,
      totals: { samples: 3, routes: 1, releases: 2, poorSamples: 1, p75LcpMs: 2925, p75InpMs: 180, p75Cls: 0.08 },
    },
    runtimeProfiles: {
      profiles: [],
      hotFunctions: [],
      totals: null,
    },
    totals: { endpoints: 2, requests: 142, errors: 3, errorRatePercent: 2.1, p95DurationMs: 2380, apdex: 0.91 },
    status,
    reload: vi.fn()
  };
  vi.spyOn(useTracesModule, "useTraces").mockReturnValue(result);
}
function mockSpans(data: TraceDetailVM | null, status: "loading" | "ok" | "error" = "ok") {
  return vi.spyOn(useTraceSpansModule, "useTraceSpans").mockReturnValue({ data, status, reload: vi.fn() });
}

async function openDashboardTrace() {
  await userEvent.click(screen.getAllByText("POST /api/dashboards")[1]);
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
    expect(screen.getByText("APM endpoints")).toBeInTheDocument();
    expect(screen.getByText("Web vitals")).toBeInTheDocument();
    expect(screen.getByText("LCP")).toBeInTheDocument();
    expect(screen.getByText("/dashboard")).toBeInTheDocument();
    expect(screen.getByText("Service map")).toBeInTheDocument();
    expect(screen.getByText("postgres")).toBeInTheDocument();
    expect(screen.getByText("Endpoints")).toBeInTheDocument();
    expect(screen.getAllByText("POST /api/dashboards").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("GET /api/health").length).toBeGreaterThanOrEqual(2);
  });

  it("selects an endpoint and can clear the endpoint filter", async () => {
    const useTracesSpy = vi.spyOn(useTracesModule, "useTraces");
    useTracesSpy.mockReturnValue({
      data: traces,
      endpoints,
      serviceMap: {
        edges: serviceMapEdges,
        totals: { services: 2, edges: 1, spans: 12, errors: 1, errorRatePercent: 8.3 },
      },
      webVitals: {
        metrics: webVitalMetrics,
        totals: { samples: 3, routes: 1, releases: 2, poorSamples: 1, p75LcpMs: 2925, p75InpMs: 180, p75Cls: 0.08 },
      },
      runtimeProfiles: {
        profiles: [],
        hotFunctions: [],
        totals: null,
      },
      totals: { endpoints: 2, requests: 142, errors: 3, errorRatePercent: 2.1, p95DurationMs: 2380, apdex: 0.91 },
      status: "ok",
      reload: vi.fn()
    });
    render(<TracesScreen ctx={makeCtx()} />);
    await userEvent.click(screen.getAllByText("POST /api/dashboards")[0]);
    expect(useTracesSpy).toHaveBeenLastCalledWith(expect.objectContaining({ endpointName: "POST /api/dashboards" }));
    expect(screen.getByText(/clear endpoint/i)).toBeInTheDocument();
    await userEvent.click(screen.getByText(/clear endpoint/i));
    expect(useTracesSpy).toHaveBeenLastCalledWith(expect.objectContaining({ endpointName: null }));
  });

  it("empty list shows a hint", () => {
    mockList([]);
    render(<TracesScreen ctx={makeCtx()} />);
    expect(screen.getByText(/no traces/i)).toBeInTheDocument();
  });

  it("seeds tenant/user/trace filters from ctx.pendingFilters, forwards them, clears the payload, and auto-opens the matching trace", async () => {
    const spy = vi.spyOn(useTracesModule, "useTraces");
    spy.mockReturnValue({
      data: [traces[0]],
      endpoints, serviceMap: { edges: [], totals: null }, webVitals: { metrics: [], totals: null },
      runtimeProfiles: { profiles: [], hotFunctions: [], totals: null },
      totals: null, status: "ok", reload: vi.fn(),
    });
    mockSpans(detail);
    const ctx = makeCtx({
      pendingFilters: { section: "traces", filters: { tenantId: "tenant_acme", userId: "user_8420", traceId: "trace_a" } },
    });
    render(<TracesScreen ctx={ctx} />);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant_acme", userId: "user_8420", traceId: "trace_a" }));
    expect(ctx.clearPendingFilters).toHaveBeenCalled();

    // The single filtered result auto-opens into the waterfall view.
    await waitFor(() => expect(screen.getByText("Waterfall")).toBeInTheDocument());
  });
});

describe("TracesScreen — detail", () => {
  it("opens a trace into the waterfall view and renders header + summary", async () => {
    mockList(traces);
    mockSpans(detail);
    render(<TracesScreen ctx={makeCtx()} />);
    await openDashboardTrace();
    // header
    expect(screen.getByText(/has error/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-06-23 12:42:08.412 UTC/)).toBeInTheDocument();
    // summary strip — "Duration" also appears in the span-detail Kv, and
    // "Errors" also appears in the waterfall Segmented control.
    expect(screen.getAllByText("Duration").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Spans")).toBeInTheDocument();
    expect(screen.getAllByText("Errors").length).toBeGreaterThanOrEqual(1);
    // waterfall section
    expect(screen.getByText("Waterfall")).toBeInTheDocument();
    expect(screen.getByText("Expand all")).toBeInTheDocument();
  });

  it("queries spans by the W3C trace id, not the traces row id", async () => {
    mockList(traces);
    const spy = mockSpans(detail);
    render(<TracesScreen ctx={makeCtx()} />);
    await openDashboardTrace();
    // spans.trace_id stores the W3C id the caller sent, so querying by the
    // traces row id ("t1") returns an empty waterfall for every trace.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ traceId: "trace_a" }));
  });

  it("selecting a span shows its detail; error span shows error block; cost shown for llm", async () => {
    mockList(traces);
    mockSpans(detail);
    render(<TracesScreen ctx={makeCtx()} />);
    await openDashboardTrace();
    // default-selected span is the first errored one → error block visible
    expect(screen.getByText("Span detail")).toBeInTheDocument();
    expect(screen.getByText(/AbortError/)).toBeInTheDocument();
    // "$ 0.02" is the llm span cost (also the summary-strip LLM cost — both formatUsd).
    expect(screen.getAllByText("$ 0.02").length).toBeGreaterThanOrEqual(1); // cost of the llm span
  });

  it("Open incident is a stub toast; Copy ID toasts", async () => {
    mockList(traces);
    mockSpans(detail);
    const ctx = makeCtx();
    render(<TracesScreen ctx={ctx} />);
    await openDashboardTrace();
    await userEvent.click(screen.getByText("Open incident"));
    expect(ctx.pushToast).toHaveBeenCalledWith("Linking spans to incidents is not yet available");
    await userEvent.click(screen.getByText("Copy ID"));
    expect(ctx.pushToast).toHaveBeenCalledWith("Trace ID copied");
  });

  it("Errors filter narrows the waterfall to errored spans", async () => {
    mockList(traces);
    mockSpans(detail);
    render(<TracesScreen ctx={makeCtx()} />);
    await openDashboardTrace();
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
    await openDashboardTrace();
    await userEvent.click(screen.getByText(/recent traces/i));
    expect(screen.getByText("Traces")).toBeInTheDocument();
    expect(screen.getAllByText("GET /api/health").length).toBeGreaterThanOrEqual(2);
  });
});
