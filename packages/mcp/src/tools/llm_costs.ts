/**
 * `llm_costs` — LLM call volume, failure rate, latency, and cost, broken down by tenant, prompt,
 * and model.
 *
 * Composes `/query/llm/summary`, `/query/llm/cost-by-model`, `/query/llm/by-prompt`, and
 * `/query/llm/by-tenant` (design doc: "As nove tools"). All four routes have fully structured
 * response types in `client.ts` (`LlmWindowRollup`, `LlmCostByModelResult`, `LlmByPromptRow[]`,
 * `LlmByTenantRow[]`), so no shape guessing is needed here. None of these rows carry a
 * stack/payload/body-shaped field, so `includeRawDetail` is a no-op today but is still threaded
 * through for consistency with the shared response-budget contract.
 */

import type { SigmonClient, Window } from "../client.js";
import { pruneSection, type TruncatedInfo } from "../budget.js";

export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
}

export interface LlmCostsInput {
  window?: Window;
  /** Opt-in to keep fields the response budget would otherwise prune. */
  includeRawDetail?: boolean;
}

export const llmCostsTool: McpToolSchema = {
  name: "llm_costs",
  description:
    "LLM call volume, failure rate, latency, and cost for a time window, broken down by tenant, prompt, and " +
    "model. Composes /query/llm/summary, /query/llm/cost-by-model, /query/llm/by-prompt, /query/llm/by-tenant.",
  inputSchema: {
    type: "object",
    properties: {
      window: { type: "string", enum: ["24h", "7d", "30d"], description: "Lookback window. Defaults to 24h." },
      includeRawDetail: {
        type: "boolean",
        description: "Keep fields the response budget would otherwise prune. Defaults to false."
      }
    },
    additionalProperties: false
  }
};

export async function handleLlmCosts(client: SigmonClient, input: LlmCostsInput = {}): Promise<Record<string, unknown>> {
  const fieldOptions = { includeRawDetail: input.includeRawDetail };
  const window = { window: input.window };

  const [summary, byTenant, byPrompt, costByModel] = await Promise.all([
    client.getLlmSummary(window),
    client.getLlmByTenant(window),
    client.getLlmByPrompt(window),
    client.getLlmCostByModel(window)
  ]);

  const byTenantSection = pruneSection(byTenant as unknown as Record<string, unknown>[], "byTenant", fieldOptions);
  const byPromptSection = pruneSection(byPrompt as unknown as Record<string, unknown>[], "byPrompt", fieldOptions);
  const seriesSection = pruneSection(costByModel.series, "costByModel.series", fieldOptions);

  const truncated: TruncatedInfo[] = [];
  if (byTenantSection.truncated) truncated.push(byTenantSection.truncated);
  if (byPromptSection.truncated) truncated.push(byPromptSection.truncated);
  if (seriesSection.truncated) truncated.push(seriesSection.truncated);

  const result: Record<string, unknown> = {
    summary,
    byTenant: byTenantSection.items,
    byPrompt: byPromptSection.items,
    costByModel: {
      buckets: costByModel.buckets,
      series: seriesSection.items
    }
  };

  if (truncated.length > 0) {
    result.truncated = truncated;
  }

  return result;
}
