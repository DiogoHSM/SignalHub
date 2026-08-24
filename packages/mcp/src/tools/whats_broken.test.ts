import { describe, expect, it, vi } from "vitest";
import type { SigmonClient } from "../client.js";
import { whatsBrokenHandler } from "./whats_broken.js";

function fakeClient(overrides: Partial<Record<keyof SigmonClient, unknown>> = {}) {
  return {
    getOverview: vi.fn(async () => ({
      kpis: { events: 100, errors: 5, openErrors: 2 },
      trends: { usage: [{ bucketStart: "2026-08-23T00:00:00.000Z", events: 10 }], errors: [] },
      top: { events: [{ name: "page_view", total: 40 }] }
    })),
    getOperations: vi.fn(async () => ({
      window: "24h",
      generatedAt: "2026-08-24T00:00:00.000Z",
      scope: { projectId: "proj_1", environmentId: "env_1" },
      range: { from: "2026-08-23T00:00:00.000Z", to: "2026-08-24T00:00:00.000Z" },
      status: "healthy",
      summary: {},
      recent: {},
      anomalies: []
    })),
    listErrorGroups: vi.fn(async () => ({ data: [{ id: "grp_1", status: "open" }], cursor: null })),
    getApmWebVitals: vi.fn(async () => ({
      window: "24h",
      generatedAt: "2026-08-24T00:00:00.000Z",
      scope: { projectId: "proj_1", environmentId: "env_1" },
      range: { from: "2026-08-23T00:00:00.000Z", to: "2026-08-24T00:00:00.000Z" },
      totals: { samples: 1, routes: 1, releases: 1, poorSamples: 0, p75LcpMs: 1000, p75InpMs: 100, p75Cls: 0.1 },
      metrics: [{ route: "/home", p75LcpMs: 1000 }]
    })),
    ...overrides
  } as unknown as SigmonClient;
}

describe("whatsBrokenHandler", () => {
  it("composes overview, operations, error-groups (status=open by default), and web-vitals with the right params", async () => {
    const client = fakeClient();

    const result = await whatsBrokenHandler(client, { window: "7d" });

    expect(client.getOverview).toHaveBeenCalledWith({ window: "7d", release: undefined });
    expect(client.getOperations).toHaveBeenCalledWith({ window: "7d" });
    expect(client.listErrorGroups).toHaveBeenCalledWith({ status: "open", limit: undefined });
    expect(client.getApmWebVitals).toHaveBeenCalledWith({ window: "7d" });

    expect(result.errorGroups.items).toEqual([{ id: "grp_1", status: "open" }]);
    expect(result.webVitals.metrics).toEqual([{ route: "/home", p75LcpMs: 1000 }]);
    expect(result.truncated).toBeUndefined();
  });

  it("respects an explicit errorStatus override", async () => {
    const client = fakeClient();

    await whatsBrokenHandler(client, { errorStatus: "investigating" });

    expect(client.listErrorGroups).toHaveBeenCalledWith({ status: "investigating", limit: undefined });
  });

  it("marks the error-groups section as truncated when the list is oversized", async () => {
    const bigGroups = Array.from({ length: 24 }, (_, index) => ({ id: `grp_${index}`, status: "open" }));
    const client = fakeClient({
      listErrorGroups: vi.fn(async () => ({ data: bigGroups, cursor: "next" }))
    });

    const result = await whatsBrokenHandler(client, {});

    expect(result.errorGroups.items).toHaveLength(20);
    expect(result.errorGroups.cursor).toBe("next");
    expect(result.truncated).toBeDefined();
    expect(result.truncated!.some((entry) => entry.section === "whats_broken.errorGroups")).toBe(true);
  });
});
