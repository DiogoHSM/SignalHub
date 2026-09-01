/**
 * `trace_request` — either fetch one trace's spans (when `traceId` is given), or search for
 * traces matching filters (tenant/user/session/name/status/time window) to find the trace id
 * first.
 */

import { z } from "zod";
import type { SigmonClient } from "../client.js";
import { isRawDetailEnabled, pruneSection, type RawDetailOptions, type TruncatedInfo } from "../budget.js";

const inputSchema = {
  traceId: z.string().optional().describe("Fetch spans for this specific trace. Omit to search for traces instead."),
  tenantId: z.string().optional().describe("Filter by tenant (ignored when traceId is set)."),
  userId: z.string().optional().describe("Filter by user (ignored when traceId is set)."),
  sessionId: z.string().optional().describe("Filter by session (ignored when traceId is set)."),
  traceName: z.string().optional().describe("Filter by trace name (ignored when traceId is set)."),
  status: z.string().optional().describe("Filter by trace status (ignored when traceId is set)."),
  from: z.string().optional().describe("ISO 8601 start of the search window (ignored when traceId is set)."),
  to: z.string().optional().describe("ISO 8601 end of the search window (ignored when traceId is set)."),
  limit: z.number().int().positive().max(200).optional().describe("Max traces requested before this tool's own budget cap."),
  cursor: z.string().optional().describe("Cursor to page through trace search results."),
  spanLimit: z.number().int().positive().max(500).optional().describe("Max spans requested before this tool's own budget cap."),
  spanCursor: z.string().optional().describe("Cursor to page through spans."),
  includeRawDetail: z.boolean().optional().describe("Requires MCP_ALLOW_RAW_DETAIL=true; include full span bodies instead of the pruned default.")
};

const inputObject = z.object(inputSchema);
export type TraceRequestInput = z.infer<typeof inputObject>;

export interface TraceRequestResult {
  trace?: Record<string, unknown> | null;
  spans?: { items: Record<string, unknown>[]; cursor?: string | null };
  traces?: { items: Record<string, unknown>[]; cursor?: string | null };
  truncated?: TruncatedInfo[];
}

export async function traceRequestHandler(
  client: SigmonClient,
  input: TraceRequestInput = {},
  rawDetailOptions: RawDetailOptions = {}
): Promise<TraceRequestResult> {
  if (input.traceId) {
    const [traces, spans] = await Promise.all([
      client.listTraces({ traceId: input.traceId, limit: 1 }),
      client.listTraceSpans(input.traceId, { limit: input.spanLimit, cursor: input.spanCursor })
    ]);

    const prunedTrace = pruneSection(traces.data, "trace_request.trace");
    const fieldOptions = { includeRawDetail: input.includeRawDetail, allowRawDetail: rawDetailOptions.allowRawDetail };
    const prunedSpans = pruneSection(spans.data, "trace_request.spans", fieldOptions);

    const truncated = [prunedTrace.truncated, prunedSpans.truncated].filter((entry): entry is TruncatedInfo => Boolean(entry));

    return {
      trace: prunedTrace.items[0] ?? null,
      spans: { items: prunedSpans.items, cursor: spans.cursor },
      ...(isRawDetailEnabled(fieldOptions) ? { rawDetailIncluded: true as const } : {}),
      ...(truncated.length > 0 ? { truncated } : {})
    };
  }

  const traces = await client.listTraces({
    tenantId: input.tenantId,
    userId: input.userId,
    sessionId: input.sessionId,
    traceName: input.traceName,
    status: input.status,
    from: input.from,
    to: input.to,
    limit: input.limit,
    cursor: input.cursor
  });

  const prunedTraces = pruneSection(traces.data, "trace_request.traces");

  return {
    traces: { items: prunedTraces.items, cursor: traces.cursor },
    ...(isRawDetailEnabled({ includeRawDetail: input.includeRawDetail, allowRawDetail: rawDetailOptions.allowRawDetail })
      ? { rawDetailIncluded: true as const }
      : {}),
    ...(prunedTraces.truncated ? { truncated: [prunedTraces.truncated] } : {})
  };
}

export const traceRequestTool = {
  name: "trace_request",
  description:
    "Fetch one trace's spans by traceId, or search for traces by tenant/user/session/name/status/time window to find the traceId first.",
  inputSchema,
  handler: traceRequestHandler
};
