/**
 * `describe_scope` — identify the read token's own project/environment, and surface the event
 * name catalog and recent releases, so an agent knows what event names and release identifiers
 * actually exist before it guesses at them in other tools (a wrong guess silently returns an
 * empty list rather than an error, which is the whole reason this tool exists).
 */

import { z } from "zod";
import type { SigmonClient } from "../client.js";
import { pruneSection, type TruncatedInfo } from "../budget.js";

const inputSchema = {
  window: z
    .enum(["24h", "7d", "30d"])
    .optional()
    .describe("Time window for the event property catalog and recent releases. Defaults to the API's own default."),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe("Max rows requested from the API for the property catalog and release list, before this tool's own budget cap is applied.")
};

const inputObject = z.object(inputSchema);
export type DescribeScopeInput = z.infer<typeof inputObject>;

export interface DescribeScopeResult {
  scope: Awaited<ReturnType<SigmonClient["getPrincipalScope"]>>;
  eventProperties: Record<string, unknown>;
  releases: Record<string, unknown>;
  truncated?: TruncatedInfo[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export async function describeScopeHandler(client: SigmonClient, input: DescribeScopeInput = {}): Promise<DescribeScopeResult> {
  const [scope, catalog, releases] = await Promise.all([
    client.getPrincipalScope(),
    client.getEventPropertyCatalog({ window: input.window, limit: input.limit }),
    client.listReleases({ window: input.window, limit: input.limit })
  ]);

  const catalogRecord = asRecord(catalog);
  const releasesRecord = asRecord(releases);

  const prunedProperties = pruneSection(asRecordArray(catalogRecord.properties), "describe_scope.eventProperties.properties");
  const prunedSimilarGroups = pruneSection(
    asRecordArray(catalogRecord.similarNameGroups),
    "describe_scope.eventProperties.similarNameGroups"
  );
  const prunedReleases = pruneSection(asRecordArray(releasesRecord.releases), "describe_scope.releases");

  const truncated = [prunedProperties.truncated, prunedSimilarGroups.truncated, prunedReleases.truncated].filter(
    (entry): entry is TruncatedInfo => Boolean(entry)
  );

  return {
    scope,
    eventProperties: { ...catalogRecord, properties: prunedProperties.items, similarNameGroups: prunedSimilarGroups.items },
    releases: { ...releasesRecord, releases: prunedReleases.items },
    ...(truncated.length > 0 ? { truncated } : {})
  };
}

export const describeScopeTool = {
  name: "describe_scope",
  description:
    "Identify the read token's own project/environment scope, plus the event name catalog and recent releases. Call this first: it's how an agent learns which event names and release identifiers actually exist before querying for them elsewhere.",
  inputSchema,
  handler: describeScopeHandler
};
