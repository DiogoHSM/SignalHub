/**
 * `investigate_error` — the deep-dive on one error group: the incident summary (priority,
 * strongly-related/nearby occurrences, code context, external issue links), recent occurrences,
 * source-map resolution for the representative error, triage notes, MTTR context, and any
 * matching session replays.
 */

import { z } from "zod";
import type { SigmonClient } from "../client.js";
import { pruneSection, type TruncatedInfo } from "../budget.js";

const inputSchema = {
  errorGroupId: z.string().describe("The error group id to investigate (from whats_broken or search_events)."),
  errorId: z
    .string()
    .optional()
    .describe("A specific error occurrence id to center the incident view and source-map resolution on. Defaults to the group's latest occurrence."),
  occurrencesLimit: z.number().int().positive().max(100).optional().describe("Max recent occurrences requested before this tool's own budget cap."),
  occurrencesCursor: z.string().optional().describe("Cursor to page through occurrences."),
  mttrWindow: z.enum(["7d", "30d"]).optional().describe("Window for the mean-time-to-resolution figure."),
  replayLimit: z.number().int().positive().max(50).optional().describe("Max matching session replays requested before this tool's own budget cap."),
  includeRawDetail: z
    .boolean()
    .optional()
    .describe("Include full stack traces and raw event payloads on occurrences instead of the pruned default.")
};

const inputObject = z.object(inputSchema);
export type InvestigateErrorInput = z.infer<typeof inputObject>;

export interface InvestigateErrorResult {
  group: Awaited<ReturnType<SigmonClient["getErrorGroupIncident"]>>["group"];
  priority: Awaited<ReturnType<SigmonClient["getErrorGroupIncident"]>>["priority"];
  suggestedPriority: Awaited<ReturnType<SigmonClient["getErrorGroupIncident"]>>["suggestedPriority"];
  related: Awaited<ReturnType<SigmonClient["getErrorGroupIncident"]>>["related"];
  incidentNumber: string | null;
  assignedTo: { id: string; email: string } | null;
  silencedUntil: string | null;
  codeContext: Record<string, unknown>;
  primaryOccurrence: Record<string, unknown>;
  notes: Record<string, unknown>[];
  externalIssues: Record<string, unknown>[];
  stronglyRelated: Record<string, unknown>[];
  nearbyContext: Record<string, unknown>[];
  primaryReplay: Record<string, unknown> | null;
  replays: Record<string, unknown>[];
  sourceMapResolution: Record<string, unknown> | null;
  occurrences: { items: Record<string, unknown>[]; cursor?: string | null };
  mttr: Awaited<ReturnType<SigmonClient["getIncidentMttr"]>>;
  truncated?: TruncatedInfo[];
}

export async function investigateErrorHandler(
  client: SigmonClient,
  input: InvestigateErrorInput
): Promise<InvestigateErrorResult> {
  const incident = await client.getErrorGroupIncident(input.errorGroupId, { errorId: input.errorId });

  const resolvedErrorId = input.errorId ?? incident.group.latestErrorId ?? undefined;

  const [occurrences, sourceMapResolution, mttr, replays] = await Promise.all([
    client.getErrorGroupOccurrences(input.errorGroupId, { limit: input.occurrencesLimit, cursor: input.occurrencesCursor }),
    resolvedErrorId ? client.getErrorSourceMapResolution(resolvedErrorId) : Promise.resolve(null),
    client.getIncidentMttr({ window: input.mttrWindow }),
    client.listReplays({
      tenantId: incident.related.tenantId ?? undefined,
      userId: incident.related.userId ?? undefined,
      limit: input.replayLimit
    })
  ]);

  const fieldOptions = { includeRawDetail: input.includeRawDetail };

  const prunedOccurrences = pruneSection(
    occurrences.data as unknown as Record<string, unknown>[],
    "investigate_error.occurrences",
    fieldOptions
  );
  // `body` is a triage note's actual (human-written) content, not a raw telemetry payload — exempt
  // it from budget.ts's default sensitive-field list, which otherwise drops any `body` field.
  const prunedNotes = pruneSection(incident.notes as unknown as Record<string, unknown>[], "investigate_error.notes", {
    sensitiveFields: []
  });
  const prunedExternalIssues = pruneSection(
    incident.externalIssues as unknown as Record<string, unknown>[],
    "investigate_error.externalIssues"
  );
  const prunedStronglyRelated = pruneSection(incident.stronglyRelated.items, "investigate_error.stronglyRelated", fieldOptions);
  const prunedNearbyContext = pruneSection(incident.nearbyContext.items, "investigate_error.nearbyContext", fieldOptions);
  const prunedReplays = pruneSection(replays.data, "investigate_error.replays");

  let sourceMapOut: Record<string, unknown> | null = null;
  let sourceMapTruncated: TruncatedInfo | undefined;
  if (sourceMapResolution) {
    const prunedFrames = pruneSection(
      sourceMapResolution.frames as unknown as Record<string, unknown>[],
      "investigate_error.sourceMapResolution.frames"
    );
    sourceMapOut = { ...sourceMapResolution, frames: prunedFrames.items };
    sourceMapTruncated = prunedFrames.truncated;
  }

  const truncated = [
    prunedOccurrences.truncated,
    prunedNotes.truncated,
    prunedExternalIssues.truncated,
    prunedStronglyRelated.truncated,
    prunedNearbyContext.truncated,
    prunedReplays.truncated,
    sourceMapTruncated
  ].filter((entry): entry is TruncatedInfo => Boolean(entry));

  return {
    group: incident.group,
    priority: incident.priority,
    suggestedPriority: incident.suggestedPriority,
    related: incident.related,
    incidentNumber: incident.incidentNumber,
    assignedTo: incident.assignedTo,
    silencedUntil: incident.silencedUntil,
    codeContext: incident.codeContext,
    primaryOccurrence: incident.primaryOccurrence,
    notes: prunedNotes.items,
    externalIssues: prunedExternalIssues.items,
    stronglyRelated: prunedStronglyRelated.items,
    nearbyContext: prunedNearbyContext.items,
    primaryReplay: incident.replay,
    replays: prunedReplays.items,
    sourceMapResolution: sourceMapOut,
    occurrences: { items: prunedOccurrences.items, cursor: occurrences.cursor },
    mttr,
    ...(truncated.length > 0 ? { truncated } : {})
  };
}

export const investigateErrorTool = {
  name: "investigate_error",
  description:
    "Deep-dive on one error group: incident summary (priority, strongly-related and nearby occurrences, code context, external issue links), recent occurrences, source-map resolution, triage notes, MTTR, and matching session replays.",
  inputSchema,
  handler: investigateErrorHandler
};
