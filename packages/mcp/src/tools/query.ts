/**
 * `query` — the escape hatch. Dispatches to whichever `/query/aggregates/*` or
 * `/query/analytics/trends` route matches the requested `metric`, for the investigation shapes
 * the other eight tools don't cover.
 *
 * `metric` enum confirmed against the actual client methods (not guessed): `client.ts` has one
 * aggregate method per row in `/query/aggregates/*` — `getEventAggregates` ("events"),
 * `getErrorAggregates` ("errors"), `getLlmAggregates` ("llm"), `getTraceAggregates` ("traces") —
 * plus `getAnalyticsTrend` for `/query/analytics/trends` ("trends"). That is exactly the design
 * doc's suggested set (`events | errors | llm | traces | trends`).
 *
 * `/query/analytics/trends` accepts two mutually exclusive shapes (`AnalyticsTrendInsightParams`
 * with just an `insightId`, or `AnalyticsTrendDefinitionParams` with `bucket`/`metric`/...) per
 * `parseAnalyticsTrendRequest` in `apps/api/src/routes/query.ts` — both require `from`/`to`. This
 * tool validates that shape itself before calling the client, since a malformed trend request is a
 * tool-input error, not a client/API error.
 */

import type { AnalyticsTrendParams, LlmAggregateBaseParams, SigmonClient } from "../client.js";
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

export type QueryMetric = "events" | "errors" | "llm" | "traces" | "trends";

export interface QueryToolInput {
  metric: QueryMetric;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  from?: string;
  to?: string;
  // metric: "events"
  eventName?: string;
  eventId?: string;
  segmentId?: string;
  // metric: "llm"
  provider?: string;
  model?: string;
  promptName?: string;
  status?: string;
  // metric: "trends"
  insightId?: string;
  bucket?: "hour" | "day";
  trendMetric?: "count" | "unique_actors";
  breakdownProperty?: string;
  filters?: unknown[];
  includeRawDetail?: boolean;
}

/** Thrown for malformed tool input (as opposed to `SigmonClientError`, thrown by the API itself). */
export class QueryToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryToolInputError";
  }
}

export const queryTool: McpToolSchema = {
  name: "query",
  description:
    "Escape hatch: run a raw aggregate or trend query when none of the other tools fit. `metric` selects the " +
    "route: events/errors/llm/traces call the matching /query/aggregates/* route, trends calls " +
    "/query/analytics/trends.",
  inputSchema: {
    type: "object",
    properties: {
      metric: { type: "string", enum: ["events", "errors", "llm", "traces", "trends"] },
      tenantId: { type: "string" },
      userId: { type: "string" },
      sessionId: { type: "string" },
      traceId: { type: "string" },
      from: { type: "string", description: "ISO timestamp lower bound. Required for metric \"trends\"." },
      to: { type: "string", description: "ISO timestamp upper bound. Required for metric \"trends\"." },
      eventName: { type: "string", description: "metric \"events\": filter; metric \"trends\": trend definition's event." },
      eventId: { type: "string", description: "metric \"events\" only." },
      segmentId: { type: "string", description: "metric \"events\" only." },
      provider: { type: "string", description: "metric \"llm\" only." },
      model: { type: "string", description: "metric \"llm\" only." },
      promptName: { type: "string", description: "metric \"llm\" only." },
      status: { type: "string", description: "metric \"llm\" only." },
      insightId: { type: "string", description: "metric \"trends\" only: run a saved insight instead of an inline definition." },
      bucket: { type: "string", enum: ["hour", "day"], description: "metric \"trends\" only, when not using insightId." },
      trendMetric: {
        type: "string",
        enum: ["count", "unique_actors"],
        description: "metric \"trends\" only, when not using insightId."
      },
      breakdownProperty: { type: "string", description: "metric \"trends\" only, when not using insightId." },
      filters: { type: "array", items: {}, description: "metric \"trends\" only, when not using insightId." },
      includeRawDetail: {
        type: "boolean",
        description: "Keep fields the response budget would otherwise prune. Defaults to false."
      }
    },
    required: ["metric"],
    additionalProperties: false
  }
};

function baseAggregateParams(input: QueryToolInput) {
  return {
    tenantId: input.tenantId,
    userId: input.userId,
    sessionId: input.sessionId,
    traceId: input.traceId,
    from: input.from,
    to: input.to
  };
}

export async function handleQuery(client: SigmonClient, input: QueryToolInput): Promise<Record<string, unknown>> {
  switch (input.metric) {
    case "events": {
      const result = await client.getEventAggregates({
        ...baseAggregateParams(input),
        eventName: input.eventName,
        eventId: input.eventId,
        segmentId: input.segmentId
      });
      return { metric: "events", result };
    }

    case "errors": {
      const result = await client.getErrorAggregates(baseAggregateParams(input));
      return { metric: "errors", result };
    }

    case "traces": {
      const result = await client.getTraceAggregates(baseAggregateParams(input));
      return { metric: "traces", result };
    }

    case "llm": {
      const params: LlmAggregateBaseParams = {
        ...baseAggregateParams(input),
        provider: input.provider,
        model: input.model,
        promptName: input.promptName,
        status: input.status
      };
      const result = await client.getLlmAggregates(params);
      return { metric: "llm", result };
    }

    case "trends": {
      if (!input.from || !input.to) {
        throw new QueryToolInputError('metric "trends" requires both `from` and `to`');
      }

      let trendParams: AnalyticsTrendParams;
      if (input.insightId) {
        trendParams = { from: input.from, to: input.to, insightId: input.insightId };
      } else {
        if (!input.bucket || !input.trendMetric) {
          throw new QueryToolInputError('metric "trends" requires either `insightId`, or both `bucket` and `trendMetric`');
        }
        trendParams = {
          from: input.from,
          to: input.to,
          bucket: input.bucket,
          metric: input.trendMetric,
          eventName: input.eventName,
          breakdownProperty: input.breakdownProperty,
          filters: input.filters
        };
      }

      const data = (await client.getAnalyticsTrend(trendParams)) as { buckets: string[]; series: Record<string, unknown>[] };
      const seriesSection = pruneSection(data.series ?? [], "trends.series", { includeRawDetail: input.includeRawDetail });

      const truncated: TruncatedInfo[] = [];
      if (seriesSection.truncated) truncated.push(seriesSection.truncated);

      const result: Record<string, unknown> = { metric: "trends", result: { buckets: data.buckets, series: seriesSection.items } };
      if (truncated.length > 0) result.truncated = truncated;
      return result;
    }

    default: {
      const exhaustive: never = input.metric;
      throw new QueryToolInputError(`unsupported metric: ${String(exhaustive)}`);
    }
  }
}
