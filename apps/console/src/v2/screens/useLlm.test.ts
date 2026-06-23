// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLlm } from "./useLlm";
import type {
  AggregateResponse,
  LlmCostByModel,
  LlmPromptRow,
  LlmSummary,
  LlmTenantRow,
} from "../../api/types";

afterEach(() => vi.restoreAllMocks());

const summary: LlmSummary = {
  calls: 1000,
  failedCalls: 25,
  costUsd: "48.20",
  avgTokens: 1200,
  avgLatencyMs: 842,
  p95LatencyMs: 2400,
};

const tenants: LlmTenantRow[] = [
  { tenantId: "tenant_acme", calls: 600, failedCalls: 10, costUsd: "30.00",
    avgTokens: 900, avgLatencyMs: 700, p95LatencyMs: 2000 },
  { tenantId: "tenant_globex", calls: 400, failedCalls: 5, costUsd: "18.20",
    avgTokens: 800, avgLatencyMs: 600, p95LatencyMs: 1800 },
];

const prompts: LlmPromptRow[] = [
  { promptName: "dashboard_summary", model: "gpt-5", calls: 500, failedCalls: 5,
    costUsd: "40.00", avgTokens: 1200, avgLatencyMs: 1800, p95LatencyMs: 3200 },
  { promptName: "Unspecified", model: "haiku-4", calls: 500, failedCalls: 0,
    costUsd: "8.20", avgTokens: null, avgLatencyMs: 98, p95LatencyMs: 240 },
];

const costByModel: LlmCostByModel = {
  buckets: ["2026-06-22T00:00:00.000Z", "2026-06-22T01:00:00.000Z"],
  series: [
    { model: "gpt-5", costs: ["10.000000", "12.000000"] },
    { model: "haiku-4", costs: ["0", "2.000000"] },
  ],
};

function makeClient(over: Record<string, unknown> = {}) {
  return {
    getLlmSummary: vi.fn(async (): Promise<AggregateResponse<LlmSummary>> => ({ data: summary })),
    getLlmByTenant: vi.fn(async (): Promise<AggregateResponse<LlmTenantRow[]>> => ({ data: tenants })),
    getLlmByPrompt: vi.fn(async (): Promise<AggregateResponse<LlmPromptRow[]>> => ({ data: prompts })),
    getLlmCostByModel: vi.fn(async (): Promise<AggregateResponse<LlmCostByModel>> => ({ data: costByModel })),
    ...over,
  } as never;
}

describe("useLlm", () => {
  it("assembles the VM: parses costs, derives error rate, run-rate, shares, colors", async () => {
    const { result } = renderHook(() =>
      useLlm({ client: makeClient(), projectId: "p", environmentId: "e", window: "24h" }));

    await waitFor(() => expect(result.current.status).toBe("ok"));
    const vm = result.current.data!;
    expect(vm.kpis.calls).toBe(1000);
    expect(vm.kpis.costUsd).toBeCloseTo(48.2);
    expect(vm.kpis.errorRate).toBeCloseTo(0.025);
    // 24h run-rate = cost * 30
    expect(vm.kpis.runRateUsd).toBeCloseTo(48.2 * 30);
    expect(vm.kpis.avgLatencyMs).toBe(842);

    // tenants: share = cost / summary cost; first color from palette
    expect(vm.tenants[0].costUsd).toBeCloseTo(30);
    expect(vm.tenants[0].share).toBeCloseTo(30 / 48.2);

    // prompts: numeric costs + per-row error rate; null tokens preserved
    expect(vm.prompts[0].costUsd).toBeCloseTo(40);
    expect(vm.prompts[0].errorRate).toBeCloseTo(5 / 500);
    expect(vm.prompts[1].avgTokens).toBeNull();
    expect(vm.prompts[1].errorRate).toBe(0);

    // cost-by-model: strings parsed to numbers incl. zero-fill "0"; colors assigned
    expect(vm.costByModel.series[0].costs).toEqual([10, 12]);
    expect(vm.costByModel.series[1].costs).toEqual([0, 2]);
    expect(vm.costByModel.series[0].color).toBeTruthy();
    expect(vm.costByModel.series[1].color).not.toBe(vm.costByModel.series[0].color);
  });

  it("7d run-rate normalizes to 30 days", async () => {
    const { result } = renderHook(() =>
      useLlm({ client: makeClient(), projectId: "p", environmentId: "e", window: "7d" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.kpis.runRateUsd).toBeCloseTo((48.2 / 7) * 30);
  });

  it("error rate is 0 when there are no calls", async () => {
    const client = makeClient({
      getLlmSummary: vi.fn(async () => ({ data: { ...summary, calls: 0, failedCalls: 0, costUsd: "0" } })),
    });
    const { result } = renderHook(() =>
      useLlm({ client, projectId: "p", environmentId: "e", window: "24h" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.kpis.errorRate).toBe(0);
    // share guarded against divide-by-zero summary cost
    expect(result.current.data!.tenants[0].share).toBe(0);
  });

  it("degrades secondary failures to empty but keeps status ok when summary succeeds", async () => {
    const client = makeClient({
      getLlmByTenant: vi.fn(async () => { throw new Error("boom"); }),
      getLlmCostByModel: vi.fn(async () => { throw new Error("boom"); }),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useLlm({ client, projectId: "p", environmentId: "e", window: "24h" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.tenants).toEqual([]);
    expect(result.current.data!.costByModel.series).toEqual([]);
    expect(result.current.data!.prompts.length).toBe(2);
    errSpy.mockRestore();
  });

  it("sets error status when the summary fetch fails", async () => {
    const client = makeClient({
      getLlmSummary: vi.fn(async () => { throw new Error("boom"); }),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useLlm({ client, projectId: "p", environmentId: "e", window: "24h" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
    errSpy.mockRestore();
  });

  it("sets error status when getLlmSummary is unavailable on the client", async () => {
    const client = makeClient({ getLlmSummary: undefined });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useLlm({ client, projectId: "p", environmentId: "e", window: "24h" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    errSpy.mockRestore();
  });

  it("does nothing without project/environment scope", () => {
    const client = makeClient();
    renderHook(() => useLlm({ client, projectId: undefined, environmentId: undefined, window: "24h" }));
    expect((client as never as { getLlmSummary: { mock: { calls: unknown[] } } }).getLlmSummary.mock.calls.length).toBe(0);
  });
});
