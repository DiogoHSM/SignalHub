// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTraceDetail, classifyKind, isSpanErrored, useTraceSpans } from "./useTraceSpans";
import type { QueryListResponse, SpanRecord } from "../../api/types";

afterEach(() => vi.restoreAllMocks());

function span(over: Partial<SpanRecord> = {}): SpanRecord {
  return {
    id: "s1", projectId: "p", environmentId: "e", tenantId: null, userId: null, sessionId: null,
    traceId: "trace_a", timestamp: "2026-06-23T00:00:00.000Z", receivedAt: "2026-06-23T00:00:00.000Z",
    source: null, release: null, metadata: null, parentSpanId: null, name: "root", status: "success",
    startedAt: "2026-06-23T00:00:00.000Z", endedAt: "2026-06-23T00:00:01.000Z", durationMs: 1000,
    input: null, output: null, error: null, costUsd: null, ...over,
  };
}

describe("classifyKind", () => {
  it("treats priced spans as llm", () => {
    expect(classifyKind(span({ costUsd: "0.01", name: "anything" }))).toBe("llm");
  });
  it("classifies by source/name heuristics", () => {
    expect(classifyKind(span({ name: "postgres.query" }))).toBe("db");
    expect(classifyKind(span({ name: "redis.cache.set" }))).toBe("cache");
    expect(classifyKind(span({ name: "POST /api/x" }))).toBe("http");
    expect(classifyKind(span({ name: "llm.gpt-5 generate" }))).toBe("llm");
    expect(classifyKind(span({ name: "do_work", source: "worker" }))).toBe("internal");
  });
});

describe("isSpanErrored", () => {
  it("is true when error payload present or status is error-like", () => {
    expect(isSpanErrored(span({ error: { message: "x" } }))).toBe(true);
    expect(isSpanErrored(span({ status: "error" }))).toBe(true);
    expect(isSpanErrored(span())).toBe(false);
  });
});

describe("buildTraceDetail", () => {
  it("returns an empty detail for no spans", () => {
    const d = buildTraceDetail([]);
    expect(d.spans).toEqual([]);
    expect(d.summary).toEqual({ totalMs: 0, spanCount: 0, llmCostUsd: 0, llmTimeMs: 0, dbTimeMs: 0, errorCount: 0 });
  });

  it("builds a depth-assigned, start-ordered tree from parentSpanId", () => {
    const spans = [
      span({ id: "root", parentSpanId: null, startedAt: "2026-06-23T00:00:00.000Z", endedAt: "2026-06-23T00:00:02.380Z", durationMs: 2380, name: "POST /api/dashboards" }),
      span({ id: "child_b", parentSpanId: "root", startedAt: "2026-06-23T00:00:00.038Z", durationMs: 240, name: "router.classify" }),
      span({ id: "child_a", parentSpanId: "root", startedAt: "2026-06-23T00:00:00.012Z", durationMs: 18, name: "auth.validate", source: "postgres" }),
      span({ id: "grandchild", parentSpanId: "child_b", startedAt: "2026-06-23T00:00:00.042Z", durationMs: 232, costUsd: "0.016", name: "llm.classify" }),
    ];
    const d = buildTraceDetail(spans);
    // DFS order with siblings sorted by start: root → child_a (12ms) → child_b (38ms) → grandchild
    expect(d.spans.map((s) => s.id)).toEqual(["root", "child_a", "child_b", "grandchild"]);
    expect(d.spans.map((s) => s.level)).toEqual([0, 1, 1, 2]);
    expect(d.spans.find((s) => s.id === "root")!.hasChildren).toBe(true);
    expect(d.spans.find((s) => s.id === "grandchild")!.hasChildren).toBe(false);
    // offsets relative to trace start
    expect(d.spans.find((s) => s.id === "child_a")!.offsetMs).toBe(12);
    // summary
    expect(d.summary.totalMs).toBe(2380);
    expect(d.summary.spanCount).toBe(4);
    expect(d.summary.llmCostUsd).toBeCloseTo(0.016);
    expect(d.summary.llmTimeMs).toBe(232); // grandchild is llm
    expect(d.summary.dbTimeMs).toBe(18);   // child_a classified db via source "postgres"
    expect(d.summary.errorCount).toBe(0);
  });

  it("treats orphan spans (missing parent) as roots and counts errors", () => {
    const spans = [
      span({ id: "a", parentSpanId: "ghost", status: "error", durationMs: 10 }),
      span({ id: "b", parentSpanId: null, error: { message: "boom" }, durationMs: 20 }),
    ];
    const d = buildTraceDetail(spans);
    expect(d.spans.map((s) => s.level)).toEqual([0, 0]);
    expect(d.summary.errorCount).toBe(2);
  });

  it("survives a parentSpanId cycle without infinite recursion", () => {
    const spans = [
      span({ id: "x", parentSpanId: "y" }),
      span({ id: "y", parentSpanId: "x" }),
    ];
    const d = buildTraceDetail(spans);
    expect(d.spans.length).toBe(2);
  });
});

describe("useTraceSpans", () => {
  function makeClient(rows: SpanRecord[], over: Record<string, unknown> = {}) {
    return {
      listTraceSpans: vi.fn(async (): Promise<QueryListResponse<SpanRecord>> => ({ data: rows })),
      ...over,
    } as never;
  }

  it("fetches spans and builds the detail VM", async () => {
    const client = makeClient([span({ id: "root" })]);
    const { result } = renderHook(() =>
      useTraceSpans({ client, projectId: "p", environmentId: "e", traceId: "trace_a" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.spans.length).toBe(1);
    expect((client as never as { listTraceSpans: { mock: { calls: unknown[][] } } }).listTraceSpans.mock.calls[0][0]).toBe("trace_a");
  });

  it("does not fetch without a traceId", () => {
    const client = makeClient([]);
    renderHook(() =>
      useTraceSpans({ client, projectId: "p", environmentId: "e", traceId: undefined }));
    expect((client as never as { listTraceSpans: { mock: { calls: unknown[] } } }).listTraceSpans.mock.calls.length).toBe(0);
  });

  it("sets error status when the fetch fails", async () => {
    const client = makeClient([], { listTraceSpans: vi.fn(async () => { throw new Error("boom"); }) });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useTraceSpans({ client, projectId: "p", environmentId: "e", traceId: "trace_a" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
    errSpy.mockRestore();
  });
});
