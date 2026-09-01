import { describe, expect, it, vi } from "vitest";
import type { SigmonClient } from "../client.js";
import { handleLlmCosts, llmCostsTool } from "./llm_costs.js";

function tenantRollup(index: number) {
  return {
    tenantId: `tenant-${index}`,
    calls: index,
    failedCalls: 0,
    costUsd: "1.00",
    avgTokens: 100,
    avgLatencyMs: 200,
    p95LatencyMs: 400,
    payload: { apiToken: "secret", pageUrl: "/costs?token=secret" }
  };
}

function promptRollup(index: number) {
  return {
    promptName: `prompt-${index}`,
    model: "gpt-5",
    calls: index,
    failedCalls: 0,
    costUsd: "1.00",
    avgTokens: 100,
    avgLatencyMs: 200,
    p95LatencyMs: 400
  };
}

function makeFakeClient(overrides: Partial<SigmonClient> = {}): SigmonClient {
  return {
    getLlmSummary: vi.fn(async () => ({ calls: 10, failedCalls: 1, costUsd: "2.50", avgTokens: 120, avgLatencyMs: 250, p95LatencyMs: 500 })),
    getLlmByTenant: vi.fn(async () => [tenantRollup(1)]),
    getLlmByPrompt: vi.fn(async () => [promptRollup(1)]),
    getLlmCostByModel: vi.fn(async () => ({ buckets: ["2026-08-19", "2026-08-20"], series: [{ model: "gpt-5", costs: ["1.00", "1.50"] }] })),
    ...overrides
  } as unknown as SigmonClient;
}

describe("llmCostsTool schema", () => {
  it("declares the expected name and window enum", () => {
    expect(llmCostsTool.name).toBe("llm_costs");
    expect((llmCostsTool.inputSchema.properties.window as { enum: string[] }).enum).toEqual(["24h", "7d", "30d"]);
  });
});

describe("handleLlmCosts", () => {
  it("composes all four llm routes with the given window", async () => {
    const client = makeFakeClient();

    const result = await handleLlmCosts(client, { window: "30d" });

    expect(client.getLlmSummary).toHaveBeenCalledWith({ window: "30d" });
    expect(client.getLlmByTenant).toHaveBeenCalledWith({ window: "30d" });
    expect(client.getLlmByPrompt).toHaveBeenCalledWith({ window: "30d" });
    expect(client.getLlmCostByModel).toHaveBeenCalledWith({ window: "30d" });

    expect(result.summary).toEqual({ calls: 10, failedCalls: 1, costUsd: "2.50", avgTokens: 120, avgLatencyMs: 250, p95LatencyMs: 500 });
    expect(result.byTenant).toHaveLength(1);
    expect(result.byPrompt).toHaveLength(1);
    expect((result.costByModel as { series: unknown[] }).series).toHaveLength(1);
    expect(result.truncated).toBeUndefined();
  });

  it("marks truncated when the byTenant section exceeds the response budget cap", async () => {
    const oversized = Array.from({ length: 21 }, (_, i) => tenantRollup(i));
    const client = makeFakeClient({ getLlmByTenant: vi.fn(async () => oversized) });

    const result = await handleLlmCosts(client);

    expect(result.byTenant).toHaveLength(20);
    expect(result.truncated).toEqual([expect.objectContaining({ section: "byTenant", returned: 20, total: 21 })]);
  });

  it("requires both gates to return sanitized tenant raw detail", async () => {
    const client = makeFakeClient();

    const defaultResult = await handleLlmCosts(client);
    expect((defaultResult.byTenant as Array<Record<string, unknown>>)[0]).not.toHaveProperty("payload");

    const perCallOnly = await handleLlmCosts(client, { includeRawDetail: true });
    expect((perCallOnly.byTenant as Array<Record<string, unknown>>)[0]).not.toHaveProperty("payload");

    const authorized = await handleLlmCosts(client, { includeRawDetail: true }, { allowRawDetail: true });
    expect((authorized.byTenant as Array<Record<string, unknown>>)[0]).toMatchObject({
      payload: { apiToken: "[REDACTED]", pageUrl: "/costs?token=%5BREDACTED%5D" }
    });
    expect(authorized).toMatchObject({ rawDetailIncluded: true });
  });
});
