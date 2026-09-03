/**
 * `search_events` — search raw ingested events by name/actor/session/trace, optionally alongside
 * the event property catalog so an agent can discover real event and property names instead of
 * guessing them (a guessed name just comes back as an empty list).
 *
 * Composes `/query/events` and `/query/events/properties` (design doc: "As nove tools"). Neither
 * route carries a structured response schema in `openapi.ts` beyond a terse `queryReadRoute(...)`
 * description, so `client.ts` types both loosely (`unknown`/`Record<string, unknown>`). The event
 * row shape below mirrors `EventRecord` and the catalog shape mirrors `EventPropertyCatalogResponse`,
 * both read directly from `packages/db/src/repositories/telemetry-query.ts`.
 *
 * `EventRecord.properties` and `.metadata` are the raw ingested payload — exactly what the design
 * doc's response-budget section means by "raw event payloads". Neither is in
 * `DEFAULT_SENSITIVE_FIELDS` (which only knows generic names like `payload`/`rawPayload`), so this
 * tool adds them explicitly to the pruned field list for the `events` section.
 */

import type { EventGroupParams, SigmonClient, WindowLimitParams } from "../client.js";
import { DEFAULT_SENSITIVE_FIELDS, isRawDetailEnabled, pruneSection, type RawDetailOptions, type TruncatedInfo } from "../budget.js";

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

export interface SearchEventsInput {
  eventName?: string;
  eventId?: string;
  segmentId?: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
  /** Also fetch the event/property catalog, to discover real event and property names. */
  includeCatalog?: boolean;
  catalogWindow?: WindowLimitParams["window"];
  catalogLimit?: number;
  /** Opt-in to keep the raw event `properties`/`metadata` payload instead of pruning it. */
  includeRawDetail?: boolean;
}

interface EventPropertyCatalogPayload {
  window: string;
  generatedAt: string;
  scope: unknown;
  range: unknown;
  totals: Record<string, unknown>;
  properties: Record<string, unknown>[];
  similarNameGroups: Record<string, unknown>[];
}

export const searchEventsTool: McpToolSchema = {
  name: "search_events",
  description:
    "Search raw ingested events by name, actor (tenant/user/session/trace), or time range, optionally alongside " +
    "the event property catalog to discover real event and property names. Composes /query/events and " +
    "/query/events/properties.",
  inputSchema: {
    type: "object",
    properties: {
      eventName: { type: "string" },
      eventId: { type: "string" },
      segmentId: { type: "string" },
      tenantId: { type: "string" },
      userId: { type: "string" },
      sessionId: { type: "string" },
      traceId: { type: "string" },
      from: { type: "string", description: "ISO timestamp lower bound." },
      to: { type: "string", description: "ISO timestamp upper bound." },
      limit: { type: "integer", minimum: 1 },
      cursor: { type: "string" },
      includeCatalog: {
        type: "boolean",
        description: "Also fetch the event/property catalog. Defaults to false."
      },
      catalogWindow: { type: "string", enum: ["24h", "7d", "30d"] },
      catalogLimit: { type: "integer", minimum: 1 },
      includeRawDetail: {
        type: "boolean",
        description: "Requires MCP_ALLOW_RAW_DETAIL=true; keep the raw event properties/metadata payload instead of pruning it. Defaults to false."
      }
    },
    additionalProperties: false
  }
};

export async function handleSearchEvents(
  client: SigmonClient,
  input: SearchEventsInput = {},
  rawDetailOptions: RawDetailOptions = {}
): Promise<Record<string, unknown>> {
  const fieldOptions = { includeRawDetail: input.includeRawDetail, allowRawDetail: rawDetailOptions.allowRawDetail };
  const sensitiveFields = [...DEFAULT_SENSITIVE_FIELDS, "properties", "metadata"];

  const listParams: EventGroupParams = {
    eventName: input.eventName,
    eventId: input.eventId,
    segmentId: input.segmentId,
    tenantId: input.tenantId,
    userId: input.userId,
    sessionId: input.sessionId,
    traceId: input.traceId,
    from: input.from,
    to: input.to,
    limit: input.limit,
    cursor: input.cursor
  };

  const events = await client.listEvents(listParams);
  const eventsSection = pruneSection(events.data, "events", { ...fieldOptions, sensitiveFields });

  const truncated: TruncatedInfo[] = [];
  if (eventsSection.truncated) truncated.push(eventsSection.truncated);

  const result: Record<string, unknown> = {
    events: eventsSection.items,
    cursor: events.cursor
  };

  if (input.includeCatalog) {
    const catalog = (await client.getEventPropertyCatalog({
      window: input.catalogWindow,
      limit: input.catalogLimit
    })) as EventPropertyCatalogPayload;

    const propertiesSection = pruneSection(catalog.properties ?? [], "catalog.properties", fieldOptions);
    const similarSection = pruneSection(catalog.similarNameGroups ?? [], "catalog.similarNameGroups", fieldOptions);
    if (propertiesSection.truncated) truncated.push(propertiesSection.truncated);
    if (similarSection.truncated) truncated.push(similarSection.truncated);

    result.catalog = {
      window: catalog.window,
      generatedAt: catalog.generatedAt,
      range: catalog.range,
      totals: catalog.totals,
      properties: propertiesSection.items,
      similarNameGroups: similarSection.items
    };
  }

  if (truncated.length > 0) {
    result.truncated = truncated;
  }
  if (isRawDetailEnabled(fieldOptions)) {
    result.rawDetailIncluded = true;
  }

  return result;
}
