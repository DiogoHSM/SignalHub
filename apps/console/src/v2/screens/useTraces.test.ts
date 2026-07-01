// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTraces, isErrorStatus } from "./useTraces";
import type { AggregateResponse, ApmEndpointsResponse, QueryListResponse, TraceRecord } from "../../api/types";

afterEach(() => vi.restoreAllMocks());

function trace(over: Partial<TraceRecord> = {}): TraceRecord {
  return {
    id: "t1", projectId: "p", environmentId: "e", tenantId: "tenant_a", userId: "user_a",
    sessionId: null, traceId: "trace_a", timestamp: "2026-06-23T00:00:00.000Z",
    receivedAt: "2026-06-23T00:00:00.000Z", source: null, release: null, metadata: null,
    name: "POST /api/x", status: "success", startedAt: "2026-06-23T00:00:00.000Z",
    endedAt: "2026-06-23T00:00:02.000Z", durationMs: 2000, ...over,
  };
}

function makeClient(rows: TraceRecord[], over: Record<string, unknown> = {}) {
  return {
    listTraces: vi.fn(async (): Promise<QueryListResponse<TraceRecord>> => ({ data: rows })),
    getApmEndpoints: vi.fn(async (): Promise<AggregateResponse<ApmEndpointsResponse>> => ({
      data: {
        window: "24h",
        generatedAt: "2026-06-23T00:00:00.000Z",
        scope: { projectId: "p", environmentId: "e" },
        range: { from: "2026-06-22T00:00:00.000Z", to: "2026-06-23T00:00:00.000Z" },
        totals: { endpoints: 1, requests: 2, errors: 1, errorRatePercent: 50, p95DurationMs: 2000, apdex: 0.75 },
        endpoints: [{
          name: "POST /api/x",
          requests: 2,
          errors: 1,
          errorRatePercent: 50,
          p50DurationMs: 1000,
          p95DurationMs: 2000,
          p99DurationMs: 2200,
          averageDurationMs: 1500,
          apdex: 0.75,
          lastSeenAt: "2026-06-23T00:00:00.000Z"
        }]
      }
    })),
    ...over,
  } as never;
}

describe("isErrorStatus", () => {
  it("matches error-like statuses case-insensitively", () => {
    expect(isErrorStatus("error")).toBe(true);
    expect(isErrorStatus("FAILED")).toBe(true);
    expect(isErrorStatus("success")).toBe(false);
    expect(isErrorStatus("ok")).toBe(false);
  });
});

describe("useTraces", () => {
  it("maps traces to list items and derives traceId fallback + hasError", async () => {
    const client = makeClient([
      trace({ id: "t1", traceId: null, status: "error" }),
      trace({ id: "t2", traceId: "trace_b", status: "success", durationMs: null }),
    ]);
    const { result } = renderHook(() =>
      useTraces({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    const data = result.current.data!;
    expect(data[0].traceId).toBe("t1"); // null traceId falls back to id
    expect(data[0].hasError).toBe(true);
    expect(data[1].traceId).toBe("trace_b");
    expect(data[1].hasError).toBe(false);
    expect(data[1].durationMs).toBeNull();
    expect((client as never as { listTraces: { mock: { calls: unknown[][] } } }).listTraces.mock.calls[0][0])
      .toMatchObject({ projectId: "p", environmentId: "e", limit: 25 });
    expect(result.current.totals).toMatchObject({ endpoints: 1, requests: 2, errors: 1 });
    expect(result.current.endpoints[0]).toMatchObject({ name: "POST /api/x", p95DurationMs: 2000, apdex: 0.75 });
    expect((client as never as { getApmEndpoints: { mock: { calls: unknown[][] } } }).getApmEndpoints.mock.calls[0][0])
      .toMatchObject({ projectId: "p", environmentId: "e", window: "24h", limit: 50 });
  });

  it("filters recent traces by selected endpoint name", async () => {
    const client = makeClient([trace()]);
    const { result } = renderHook(() =>
      useTraces({ client, projectId: "p", environmentId: "e", endpointName: "GET /api/orders" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect((client as never as { listTraces: { mock: { calls: unknown[][] } } }).listTraces.mock.calls[0][0])
      .toMatchObject({ traceName: "GET /api/orders" });
  });

  it("sets error status when the fetch fails", async () => {
    const client = makeClient([], { listTraces: vi.fn(async () => { throw new Error("boom"); }) });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useTraces({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
    expect(result.current.endpoints).toEqual([]);
    expect(result.current.totals).toBeNull();
    errSpy.mockRestore();
  });

  it("does nothing without project/environment scope", () => {
    const client = makeClient([]);
    renderHook(() => useTraces({ client, projectId: undefined, environmentId: undefined }));
    expect((client as never as { listTraces: { mock: { calls: unknown[] } } }).listTraces.mock.calls.length).toBe(0);
  });
});
