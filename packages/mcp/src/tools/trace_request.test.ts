import { describe, expect, it, vi } from "vitest";
import type { SigmonClient } from "../client.js";
import { traceRequestHandler } from "./trace_request.js";

function fakeClient(overrides: Partial<Record<keyof SigmonClient, unknown>> = {}) {
  return {
    listTraces: vi.fn(async () => ({ data: [{ id: "trace_1", traceName: "checkout" }], cursor: null })),
    listTraceSpans: vi.fn(async () => ({ data: [{ id: "span_1", body: "big span body" }], cursor: null })),
    ...overrides
  } as unknown as SigmonClient;
}

describe("traceRequestHandler", () => {
  it("fetches spans for a given traceId via listTraces(limit:1) + listTraceSpans", async () => {
    const client = fakeClient();

    const result = await traceRequestHandler(client, { traceId: "trace_1", spanLimit: 50, spanCursor: "cur_1" });

    expect(client.listTraces).toHaveBeenCalledWith({ traceId: "trace_1", limit: 1 });
    expect(client.listTraceSpans).toHaveBeenCalledWith("trace_1", { limit: 50, cursor: "cur_1" });

    expect(result.trace).toEqual({ id: "trace_1", traceName: "checkout" });
    expect(result.spans!.items[0]).not.toHaveProperty("body");
    expect(result.traces).toBeUndefined();
    expect(result.truncated).toBeUndefined();
  });

  it("keeps the span body when includeRawDetail opts in", async () => {
    const client = fakeClient();

    const result = await traceRequestHandler(client, { traceId: "trace_1", includeRawDetail: true });

    expect(result.spans!.items[0]).toMatchObject({ body: "big span body" });
  });

  it("searches for traces by filters when no traceId is given", async () => {
    const client = fakeClient();

    const result = await traceRequestHandler(client, {
      tenantId: "tenant_1",
      status: "error",
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-24T00:00:00.000Z",
      limit: 10
    });

    expect(client.listTraces).toHaveBeenCalledWith({
      tenantId: "tenant_1",
      userId: undefined,
      sessionId: undefined,
      traceName: undefined,
      status: "error",
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-24T00:00:00.000Z",
      limit: 10,
      cursor: undefined
    });
    expect(client.listTraceSpans).not.toHaveBeenCalled();
    expect(result.traces!.items).toEqual([{ id: "trace_1", traceName: "checkout" }]);
    expect(result.trace).toBeUndefined();
  });

  it("marks the spans section as truncated when the list is oversized", async () => {
    const bigSpans = Array.from({ length: 22 }, (_, index) => ({ id: `span_${index}` }));
    const client = fakeClient({
      listTraceSpans: vi.fn(async () => ({ data: bigSpans, cursor: "next" }))
    });

    const result = await traceRequestHandler(client, { traceId: "trace_1" });

    expect(result.spans!.items).toHaveLength(20);
    expect(result.spans!.cursor).toBe("next");
    expect(result.truncated).toBeDefined();
    expect(result.truncated!.some((entry) => entry.section === "trace_request.spans")).toBe(true);
  });

  it("marks the traces search section as truncated when the list is oversized", async () => {
    const bigTraces = Array.from({ length: 21 }, (_, index) => ({ id: `trace_${index}` }));
    const client = fakeClient({
      listTraces: vi.fn(async () => ({ data: bigTraces, cursor: null }))
    });

    const result = await traceRequestHandler(client, { tenantId: "tenant_1" });

    expect(result.traces!.items).toHaveLength(20);
    expect(result.truncated).toBeDefined();
    expect(result.truncated!.some((entry) => entry.section === "trace_request.traces")).toBe(true);
  });
});
