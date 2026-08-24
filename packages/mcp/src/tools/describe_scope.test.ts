import { describe, expect, it, vi } from "vitest";
import type { SigmonClient } from "../client.js";
import { describeScopeHandler } from "./describe_scope.js";

function fakeClient(overrides: Partial<Record<keyof SigmonClient, unknown>> = {}) {
  return {
    getPrincipalScope: vi.fn(async () => ({ kind: "read-token", projectId: "proj_1", environmentId: "env_1" })),
    getEventPropertyCatalog: vi.fn(async () => ({
      window: "7d",
      generatedAt: "2026-08-24T00:00:00.000Z",
      scope: { projectId: "proj_1", environmentId: "env_1" },
      range: { from: "2026-08-17T00:00:00.000Z", to: "2026-08-24T00:00:00.000Z" },
      totals: { events: 10, properties: 2, conflictProperties: 0, similarNameGroups: 0 },
      properties: [{ name: "userId" }, { name: "plan" }],
      similarNameGroups: []
    })),
    listReleases: vi.fn(async () => ({
      window: "7d",
      generatedAt: "2026-08-24T00:00:00.000Z",
      scope: { projectId: "proj_1", environmentId: "env_1" },
      range: { from: "2026-08-17T00:00:00.000Z", to: "2026-08-24T00:00:00.000Z" },
      releases: [{ release: "v1.2.3" }]
    })),
    ...overrides
  } as unknown as SigmonClient;
}

describe("describeScopeHandler", () => {
  it("composes getPrincipalScope, getEventPropertyCatalog, and listReleases with the right params", async () => {
    const client = fakeClient();

    const result = await describeScopeHandler(client, { window: "30d", limit: 50 });

    expect(client.getPrincipalScope).toHaveBeenCalledWith();
    expect(client.getEventPropertyCatalog).toHaveBeenCalledWith({ window: "30d", limit: 50 });
    expect(client.listReleases).toHaveBeenCalledWith({ window: "30d", limit: 50 });

    expect(result.scope).toEqual({ kind: "read-token", projectId: "proj_1", environmentId: "env_1" });
    expect(result.eventProperties.properties).toEqual([{ name: "userId" }, { name: "plan" }]);
    expect(result.releases.releases).toEqual([{ release: "v1.2.3" }]);
    expect(result.truncated).toBeUndefined();
  });

  it("marks properties and releases as truncated when the catalog/release lists are oversized", async () => {
    const bigProperties = Array.from({ length: 25 }, (_, index) => ({ name: `prop_${index}` }));
    const bigReleases = Array.from({ length: 30 }, (_, index) => ({ release: `v0.0.${index}` }));

    const client = fakeClient({
      getEventPropertyCatalog: vi.fn(async () => ({ properties: bigProperties, similarNameGroups: [] })),
      listReleases: vi.fn(async () => ({ releases: bigReleases }))
    });

    const result = await describeScopeHandler(client, {});

    expect(result.eventProperties.properties).toHaveLength(20);
    expect(result.releases.releases).toHaveLength(20);
    expect(result.truncated).toBeDefined();
    const sections = result.truncated!.map((entry) => entry.section);
    expect(sections).toContain("describe_scope.eventProperties.properties");
    expect(sections).toContain("describe_scope.releases");
  });
});
