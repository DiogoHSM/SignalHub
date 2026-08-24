/**
 * `slow_endpoints` — find the API endpoints and service dependencies with the highest latency or
 * error rate in a time window, to prioritize what to investigate first.
 *
 * Composes `/query/apm/endpoints` and `/query/apm/service-map` (design doc: "As nove tools").
 * Both routes only carry a terse `queryReadRoute(...)` description in `openapi.ts` with no
 * structured response schema, so `client.ts` deliberately types them as `unknown` rather than
 * commit to a shape neither the OpenAPI entry nor the `QueryRouteOptions` signature promises. The
 * concrete row shapes below mirror `ApmEndpointsResponse`/`ServiceMapResponse` in
 * `packages/db/src/repositories/telemetry-query.ts` (read directly, not guessed) so this tool can
 * route the `endpoints`/`edges` arrays through the response budget.
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

export interface SlowEndpointsInput {
  /** Lookback window; defaults to the API's own default (24h) when omitted. */
  window?: Window;
  /** Caps how many endpoint rows the API itself returns before this tool's own budget applies. */
  limit?: number;
  /** Set to false to skip `/query/apm/service-map` and only return endpoint latency/error rates. */
  includeServiceMap?: boolean;
  /** Opt-in to keep any raw detail fields that would otherwise be pruned by the response budget. */
  includeRawDetail?: boolean;
}

interface ApmEndpointsPayload {
  window: string;
  generatedAt: string;
  scope: unknown;
  range: unknown;
  totals: Record<string, unknown>;
  endpoints: Record<string, unknown>[];
}

interface ServiceMapPayload {
  window: string;
  generatedAt: string;
  scope: unknown;
  range: unknown;
  totals: Record<string, unknown>;
  edges: Record<string, unknown>[];
}

export const slowEndpointsTool: McpToolSchema = {
  name: "slow_endpoints",
  description:
    "Find the API endpoints and service dependencies with the highest latency (p95/apdex) or error rate in a " +
    "time window, to prioritize what to fix. Composes /query/apm/endpoints and /query/apm/service-map.",
  inputSchema: {
    type: "object",
    properties: {
      window: { type: "string", enum: ["24h", "7d", "30d"], description: "Lookback window. Defaults to 24h." },
      limit: { type: "integer", minimum: 1, description: "Max endpoint rows to request from the API." },
      includeServiceMap: {
        type: "boolean",
        description: "Also fetch the service dependency map. Defaults to true."
      },
      includeRawDetail: {
        type: "boolean",
        description: "Keep fields the response budget would otherwise prune. Defaults to false."
      }
    },
    additionalProperties: false
  }
};

export async function handleSlowEndpoints(client: SigmonClient, input: SlowEndpointsInput = {}): Promise<Record<string, unknown>> {
  const includeServiceMap = input.includeServiceMap ?? true;
  const fieldOptions = { includeRawDetail: input.includeRawDetail };

  const endpointsRaw = (await client.getApmEndpoints({ window: input.window, limit: input.limit })) as ApmEndpointsPayload;
  const endpointsSection = pruneSection(endpointsRaw.endpoints ?? [], "endpoints", fieldOptions);

  const truncated: TruncatedInfo[] = [];
  if (endpointsSection.truncated) truncated.push(endpointsSection.truncated);

  const result: Record<string, unknown> = {
    window: endpointsRaw.window,
    generatedAt: endpointsRaw.generatedAt,
    range: endpointsRaw.range,
    totals: endpointsRaw.totals,
    endpoints: endpointsSection.items
  };

  if (includeServiceMap) {
    const serviceMapRaw = (await client.getApmServiceMap({ window: input.window, limit: input.limit })) as ServiceMapPayload;
    const edgesSection = pruneSection(serviceMapRaw.edges ?? [], "serviceMap.edges", fieldOptions);
    if (edgesSection.truncated) truncated.push(edgesSection.truncated);

    result.serviceMap = {
      totals: serviceMapRaw.totals,
      edges: edgesSection.items
    };
  }

  if (truncated.length > 0) {
    result.truncated = truncated;
  }

  return result;
}
