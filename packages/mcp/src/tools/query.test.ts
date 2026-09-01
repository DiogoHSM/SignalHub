import { describe, expect, it, vi } from "vitest";
import type { SigmonClient } from "../client.js";
import { handleQuery, QueryToolInputError, queryTool } from "./query.js";

function trendSeries(index: number) {
  return { key: `series-${index}`, label: `Series ${index}`, values: [1, 2, 3], payload: { apiToken: "secret", pageUrl: "/trends?token=secret" } };
}

function makeFakeClient(overrides: Partial<SigmonClient> = {}): SigmonClient {
  return {
    getEventAggregates: vi.fn(async () => ({ total: 42, byName: { page_view: 42 } })),
    getErrorAggregates: vi.fn(async () => ({ total: 3, open: 1 })),
    getTraceAggregates: vi.fn(async () => ({ total: 5, averageDurationMs: 120 })),
    getLlmAggregates: vi.fn(async () => ({ totalCalls: 9, totalInputTokens: 100, totalOutputTokens: 200, totalCostUsd: "1.23" })),
    getAnalyticsTrend: vi.fn(async () => ({ buckets: ["2026-08-19", "2026-08-20"], series: [trendSeries(1)] })),
    ...overrides
  } as unknown as SigmonClient;
}

describe("queryTool schema", () => {
  it("declares the metric enum confirmed against client.ts's aggregate/trend methods", () => {
    expect(queryTool.name).toBe("query");
    expect((queryTool.inputSchema.properties.metric as { enum: string[] }).enum).toEqual([
      "events",
      "errors",
      "llm",
      "traces",
      "trends"
    ]);
    expect(queryTool.inputSchema.required).toEqual(["metric"]);
  });
});

describe("handleQuery", () => {
  it("dispatches metric 'events' to getEventAggregates with the matching params", async () => {
    const client = makeFakeClient();

    const result = await handleQuery(client, { metric: "events", tenantId: "tenant-1", eventName: "page_view", from: "2026-08-01", to: "2026-08-20" });

    expect(client.getEventAggregates).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: undefined,
      sessionId: undefined,
      traceId: undefined,
      from: "2026-08-01",
      to: "2026-08-20",
      eventName: "page_view",
      eventId: undefined,
      segmentId: undefined
    });
    expect(client.getErrorAggregates).not.toHaveBeenCalled();
    expect(result).toEqual({ metric: "events", result: { total: 42, byName: { page_view: 42 } } });
  });

  it("dispatches metric 'llm' to getLlmAggregates with the matching params", async () => {
    const client = makeFakeClient();

    const result = await handleQuery(client, { metric: "llm", provider: "openai", model: "gpt-5", status: "error" });

    expect(client.getLlmAggregates).toHaveBeenCalledWith({
      tenantId: undefined,
      userId: undefined,
      sessionId: undefined,
      traceId: undefined,
      from: undefined,
      to: undefined,
      provider: "openai",
      model: "gpt-5",
      promptName: undefined,
      status: "error"
    });
    expect(result).toEqual({
      metric: "llm",
      result: { totalCalls: 9, totalInputTokens: 100, totalOutputTokens: 200, totalCostUsd: "1.23" }
    });
  });

  it("dispatches metric 'errors' to getErrorAggregates", async () => {
    const client = makeFakeClient();

    const result = await handleQuery(client, { metric: "errors", sessionId: "session-1" });

    expect(client.getErrorAggregates).toHaveBeenCalledWith({
      tenantId: undefined,
      userId: undefined,
      sessionId: "session-1",
      traceId: undefined,
      from: undefined,
      to: undefined
    });
    expect(result).toEqual({ metric: "errors", result: { total: 3, open: 1 } });
  });

  it("dispatches metric 'traces' to getTraceAggregates", async () => {
    const client = makeFakeClient();

    const result = await handleQuery(client, { metric: "traces", traceId: "trace-1" });

    expect(client.getTraceAggregates).toHaveBeenCalledWith({
      tenantId: undefined,
      userId: undefined,
      sessionId: undefined,
      traceId: "trace-1",
      from: undefined,
      to: undefined
    });
    expect(result).toEqual({ metric: "traces", result: { total: 5, averageDurationMs: 120 } });
  });

  it("dispatches metric 'trends' with an insightId to getAnalyticsTrend", async () => {
    const client = makeFakeClient();

    const result = await handleQuery(client, { metric: "trends", from: "2026-08-01", to: "2026-08-20", insightId: "insight-1" });

    expect(client.getAnalyticsTrend).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-20", insightId: "insight-1" });
    expect(result).toEqual({
      metric: "trends",
      result: { buckets: ["2026-08-19", "2026-08-20"], series: [{ key: "series-1", label: "Series 1", values: [1, 2, 3] }] }
    });
  });

  it("dispatches metric 'trends' with an inline definition to getAnalyticsTrend", async () => {
    const client = makeFakeClient();

    await handleQuery(client, {
      metric: "trends",
      from: "2026-08-01",
      to: "2026-08-20",
      bucket: "day",
      trendMetric: "count",
      eventName: "page_view",
      breakdownProperty: "plan"
    });

    expect(client.getAnalyticsTrend).toHaveBeenCalledWith({
      from: "2026-08-01",
      to: "2026-08-20",
      bucket: "day",
      metric: "count",
      eventName: "page_view",
      breakdownProperty: "plan",
      filters: undefined
    });
  });

  it("rejects metric 'trends' missing from/to with a QueryToolInputError, without calling the client", async () => {
    const client = makeFakeClient();

    await expect(handleQuery(client, { metric: "trends", insightId: "insight-1" } as never)).rejects.toBeInstanceOf(QueryToolInputError);
    expect(client.getAnalyticsTrend).not.toHaveBeenCalled();
  });

  it("rejects metric 'trends' missing both insightId and bucket/trendMetric", async () => {
    const client = makeFakeClient();

    await expect(handleQuery(client, { metric: "trends", from: "2026-08-01", to: "2026-08-20" })).rejects.toBeInstanceOf(
      QueryToolInputError
    );
    expect(client.getAnalyticsTrend).not.toHaveBeenCalled();
  });

  it("marks truncated when the trends series section exceeds the response budget cap", async () => {
    const oversized = Array.from({ length: 25 }, (_, i) => trendSeries(i));
    const client = makeFakeClient({ getAnalyticsTrend: vi.fn(async () => ({ buckets: ["b"], series: oversized })) });

    const result = await handleQuery(client, { metric: "trends", from: "2026-08-01", to: "2026-08-20", insightId: "insight-1" });

    const payload = result.result as { series: unknown[] };
    expect(payload.series).toHaveLength(20);
    expect(result.truncated).toEqual([expect.objectContaining({ section: "trends.series", returned: 20, total: 25 })]);
  });

  it("requires both gates to return sanitized trend raw detail", async () => {
    const client = makeFakeClient();
    const input = { metric: "trends" as const, from: "2026-08-01", to: "2026-08-20", insightId: "insight-1", includeRawDetail: true };

    const defaultResult = await handleQuery(client, { ...input, includeRawDetail: undefined });
    expect(((defaultResult.result as { series: Array<Record<string, unknown>> }).series[0])).not.toHaveProperty("payload");

    const perCallOnly = await handleQuery(client, input);
    expect(((perCallOnly.result as { series: Array<Record<string, unknown>> }).series[0])).not.toHaveProperty("payload");

    const authorized = await handleQuery(client, input, { allowRawDetail: true });
    expect(((authorized.result as { series: Array<Record<string, unknown>> }).series[0])).toMatchObject({
      payload: { apiToken: "[REDACTED]", pageUrl: "/trends?token=%5BREDACTED%5D" }
    });
    expect(authorized).toMatchObject({ rawDetailIncluded: true });
  });
});
