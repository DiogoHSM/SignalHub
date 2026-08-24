/**
 * `whats_broken` — a health snapshot: overview KPIs/trends, the operations status rollup, the
 * open error-group list, and web-vitals. This is the "start here" investigation tool once
 * `describe_scope` has established what project/environment/events exist.
 */

import { z } from "zod";
import type { SigmonClient } from "../client.js";
import { pruneSection, type TruncatedInfo } from "../budget.js";

const inputSchema = {
  window: z.enum(["24h", "7d", "30d"]).optional().describe("Time window applied to overview, operations, and web-vitals."),
  release: z.string().optional().describe("Restrict the overview to a single release identifier."),
  errorStatus: z
    .enum(["open", "investigating", "resolved", "ignored"])
    .optional()
    .describe("Error-group status filter. Defaults to 'open' — this tool is about what's currently broken."),
  errorLimit: z.number().int().positive().max(100).optional().describe("Max error groups requested before this tool's own budget cap.")
};

const inputObject = z.object(inputSchema);
export type WhatsBrokenInput = z.infer<typeof inputObject>;

export interface WhatsBrokenResult {
  overview: Record<string, unknown>;
  operations: Record<string, unknown>;
  errorGroups: { items: Record<string, unknown>[]; cursor?: string | null };
  webVitals: Record<string, unknown>;
  truncated?: TruncatedInfo[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export async function whatsBrokenHandler(client: SigmonClient, input: WhatsBrokenInput = {}): Promise<WhatsBrokenResult> {
  const [overview, operations, errorGroups, webVitals] = await Promise.all([
    client.getOverview({ window: input.window, release: input.release }),
    client.getOperations({ window: input.window }),
    client.listErrorGroups({ status: input.errorStatus ?? "open", limit: input.errorLimit }),
    client.getApmWebVitals({ window: input.window })
  ]);

  const overviewRecord = asRecord(overview);
  const trends = asRecord(overviewRecord.trends);
  const top = asRecord(overviewRecord.top);
  const webVitalsRecord = asRecord(webVitals);

  const prunedUsageTrend = pruneSection(asRecordArray(trends.usage), "whats_broken.overview.trends.usage");
  const prunedErrorsTrend = pruneSection(asRecordArray(trends.errors), "whats_broken.overview.trends.errors");
  const prunedTopEvents = pruneSection(asRecordArray(top.events), "whats_broken.overview.top.events");
  const prunedAnomalies = pruneSection(asRecordArray(operations.anomalies), "whats_broken.operations.anomalies");
  const prunedErrorGroups = pruneSection(
    errorGroups.data as unknown as Record<string, unknown>[],
    "whats_broken.errorGroups"
  );
  const prunedMetrics = pruneSection(asRecordArray(webVitalsRecord.metrics), "whats_broken.webVitals.metrics");

  const truncated = [
    prunedUsageTrend.truncated,
    prunedErrorsTrend.truncated,
    prunedTopEvents.truncated,
    prunedAnomalies.truncated,
    prunedErrorGroups.truncated,
    prunedMetrics.truncated
  ].filter((entry): entry is TruncatedInfo => Boolean(entry));

  return {
    overview: {
      ...overviewRecord,
      trends: { ...trends, usage: prunedUsageTrend.items, errors: prunedErrorsTrend.items },
      top: { ...top, events: prunedTopEvents.items }
    },
    operations: { ...operations, anomalies: prunedAnomalies.items },
    errorGroups: { items: prunedErrorGroups.items, cursor: errorGroups.cursor },
    webVitals: { ...webVitalsRecord, metrics: prunedMetrics.items },
    ...(truncated.length > 0 ? { truncated } : {})
  };
}

export const whatsBrokenTool = {
  name: "whats_broken",
  description:
    "Health snapshot for the token's project/environment: overview KPIs and trends, the operations status rollup, open error groups, and web-vitals. The default starting point for an investigation.",
  inputSchema,
  handler: whatsBrokenHandler
};
