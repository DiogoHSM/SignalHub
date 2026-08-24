import { describe, expect, it, vi } from "vitest";
import type { SigmonClient } from "../client.js";
import { handleSlowEndpoints, slowEndpointsTool } from "./slow_endpoints.js";

function endpointRow(index: number) {
  return {
    name: `/api/endpoint-${index}`,
    requests: 100 + index,
    errors: index,
    errorRatePercent: index,
    p50DurationMs: 10,
    p95DurationMs: 100,
    p99DurationMs: 200,
    averageDurationMs: 50,
    apdex: 0.9,
    lastSeenAt: "2026-08-20T00:00:00.000Z"
  };
}

function edgeRow(index: number) {
  return {
    source: `service-${index}`,
    target: "database",
    dependencyType: "db",
    spans: index,
    traces: index,
    errors: 0,
    errorRatePercent: 0,
    averageDurationMs: 5,
    p95DurationMs: 10,
    lastSeenAt: "2026-08-20T00:00:00.000Z"
  };
}

function makeFakeClient(overrides: Partial<SigmonClient> = {}): SigmonClient {
  return {
    getApmEndpoints: vi.fn(async () => ({
      window: "24h",
      generatedAt: "2026-08-20T00:00:00.000Z",
      scope: { projectId: "p1", environmentId: "e1" },
      range: { from: "2026-08-19T00:00:00.000Z", to: "2026-08-20T00:00:00.000Z" },
      totals: { endpoints: 1, requests: 100, errors: 1, errorRatePercent: 1, p95DurationMs: 100, apdex: 0.9 },
      endpoints: [endpointRow(1)]
    })),
    getApmServiceMap: vi.fn(async () => ({
      window: "24h",
      generatedAt: "2026-08-20T00:00:00.000Z",
      scope: { projectId: "p1", environmentId: "e1" },
      range: { from: "2026-08-19T00:00:00.000Z", to: "2026-08-20T00:00:00.000Z" },
      totals: { services: 1, edges: 1, spans: 1, errors: 0, errorRatePercent: 0 },
      edges: [edgeRow(1)]
    })),
    ...overrides
  } as unknown as SigmonClient;
}

describe("slowEndpointsTool schema", () => {
  it("declares the expected name and metric window enum", () => {
    expect(slowEndpointsTool.name).toBe("slow_endpoints");
    expect(slowEndpointsTool.inputSchema.type).toBe("object");
    expect((slowEndpointsTool.inputSchema.properties.window as { enum: string[] }).enum).toEqual(["24h", "7d", "30d"]);
  });
});

describe("handleSlowEndpoints", () => {
  it("composes getApmEndpoints and getApmServiceMap with the given window/limit", async () => {
    const client = makeFakeClient();

    const result = await handleSlowEndpoints(client, { window: "7d", limit: 5 });

    expect(client.getApmEndpoints).toHaveBeenCalledWith({ window: "7d", limit: 5 });
    expect(client.getApmServiceMap).toHaveBeenCalledWith({ window: "7d", limit: 5 });
    expect(result.endpoints).toHaveLength(1);
    expect((result.serviceMap as { edges: unknown[] }).edges).toHaveLength(1);
    expect(result.truncated).toBeUndefined();
  });

  it("skips the service map call when includeServiceMap is false", async () => {
    const client = makeFakeClient();

    const result = await handleSlowEndpoints(client, { includeServiceMap: false });

    expect(client.getApmServiceMap).not.toHaveBeenCalled();
    expect(result.serviceMap).toBeUndefined();
  });

  it("marks truncated when the endpoints section exceeds the response budget cap", async () => {
    const oversized = Array.from({ length: 25 }, (_, i) => endpointRow(i));
    const client = makeFakeClient({
      getApmEndpoints: vi.fn(async () => ({
        window: "24h",
        generatedAt: "2026-08-20T00:00:00.000Z",
        scope: { projectId: "p1", environmentId: "e1" },
        range: { from: "2026-08-19T00:00:00.000Z", to: "2026-08-20T00:00:00.000Z" },
        totals: { endpoints: 25, requests: 1000, errors: 10, errorRatePercent: 1, p95DurationMs: 100, apdex: 0.9 },
        endpoints: oversized
      }))
    });

    const result = await handleSlowEndpoints(client);

    expect(result.endpoints).toHaveLength(20);
    expect(result.truncated).toEqual([
      expect.objectContaining({ section: "endpoints", returned: 20, total: 25 })
    ]);
  });
});
