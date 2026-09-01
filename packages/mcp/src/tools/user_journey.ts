/**
 * `user_journey` — look up a user or tenant summary, and optionally walk one of their sessions
 * chronologically, to understand what someone actually did around an incident.
 *
 * Composes `/query/users` or `/query/entities/tenants` (subject lookup) plus
 * `/query/sessions/:sessionId/timeline` (design doc: "As nove tools"). All three routes have
 * fully structured response types already in `client.ts` (`UserListResult`,
 * `EntityTenantListResult`, `SessionTimelineResult`), so no shape guessing is needed here.
 *
 * `SessionTimelineItem.data` is excluded from `DEFAULT_SENSITIVE_FIELDS`, but it is exactly where
 * a breadcrumb/event/error/trace/llm item's own raw detail lives (see the route's OpenAPI/handler
 * in `apps/api/src/routes/query.ts`) — this tool adds it to the pruned field list explicitly so
 * `includeRawDetail` governs it the same way it governs `stack`/`payload`/`body` elsewhere.
 */

import type { EntitySort, SessionTimelineParams, SigmonClient, Window } from "../client.js";
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

export type UserJourneySubjectType = "user" | "tenant";

export interface UserJourneyInput {
  /** Whether to look the subject up in `/query/users` or `/query/entities/tenants`. Defaults to "user". */
  subjectType?: UserJourneySubjectType;
  /** Free-text search against the subject list (id, email, or trait, per the route's own matching). */
  search?: string;
  /** Scopes the user list to one tenant. Ignored when `subjectType` is "tenant". */
  tenantId?: string;
  window?: Window;
  limit?: number;
  sort?: EntitySort;
  cursor?: string;
  /** When set, also fetches this session's chronological timeline. */
  sessionId?: string;
  sessionTenantId?: string;
  sessionUserId?: string;
  sessionFrom?: string;
  sessionTo?: string;
  sessionCenter?: string;
  sessionBefore?: number;
  sessionAfter?: number;
  sessionTypes?: SessionTimelineParams["types"];
  sessionLimit?: number;
  /** Opt-in to keep raw detail fields (including timeline item `data`) that are pruned by default. */
  includeRawDetail?: boolean;
}

export const userJourneyTool: McpToolSchema = {
  name: "user_journey",
  description:
    "Look up a user or tenant's activity summary and, optionally, walk one of their sessions chronologically. " +
    "Composes /query/users or /query/entities/tenants with /query/sessions/:sessionId/timeline.",
  inputSchema: {
    type: "object",
    properties: {
      subjectType: { type: "string", enum: ["user", "tenant"], description: "Look up a user or a tenant. Defaults to user." },
      search: { type: "string", description: "Free-text search against the subject list." },
      tenantId: { type: "string", description: "Scope the user list to one tenant (ignored for subjectType tenant)." },
      window: { type: "string", enum: ["24h", "7d", "30d"] },
      limit: { type: "integer", minimum: 1 },
      sort: { type: "string", enum: ["impact", "usage", "errors", "llm_cost", "recent"] },
      cursor: { type: "string" },
      sessionId: { type: "string", description: "Fetch this session's chronological timeline." },
      sessionTenantId: { type: "string" },
      sessionUserId: { type: "string" },
      sessionFrom: { type: "string", description: "ISO timestamp lower bound for the timeline." },
      sessionTo: { type: "string", description: "ISO timestamp upper bound for the timeline." },
      sessionCenter: { type: "string", description: "ISO timestamp to center the timeline window on." },
      sessionBefore: { type: "integer", minimum: 0 },
      sessionAfter: { type: "integer", minimum: 0 },
      sessionTypes: {
        type: "array",
        items: { type: "string", enum: ["breadcrumb", "event", "error", "trace", "llm"] }
      },
      sessionLimit: { type: "integer", minimum: 1 },
      includeRawDetail: {
        type: "boolean",
        description: "Requires MCP_ALLOW_RAW_DETAIL=true; keep fields the response budget would otherwise prune. Defaults to false."
      }
    },
    additionalProperties: false
  }
};

export async function handleUserJourney(
  client: SigmonClient,
  input: UserJourneyInput = {},
  rawDetailOptions: RawDetailOptions = {}
): Promise<Record<string, unknown>> {
  const subjectType = input.subjectType ?? "user";
  const fieldOptions = { includeRawDetail: input.includeRawDetail, allowRawDetail: rawDetailOptions.allowRawDetail };
  const truncated: TruncatedInfo[] = [];

  const result: Record<string, unknown> = { subjectType };

  if (subjectType === "tenant") {
    const tenants = await client.listEntityTenants({
      window: input.window,
      search: input.search,
      limit: input.limit,
      sort: input.sort,
      cursor: input.cursor
    });
    const section = pruneSection(tenants.tenants as unknown as Record<string, unknown>[], "tenants", fieldOptions);
    if (section.truncated) truncated.push(section.truncated);
    result.tenants = section.items;
    result.cursor = tenants.cursor;
  } else {
    const users = await client.listUsers({
      window: input.window,
      search: input.search,
      tenantId: input.tenantId,
      limit: input.limit,
      sort: input.sort,
      cursor: input.cursor
    });
    const section = pruneSection(users.users as unknown as Record<string, unknown>[], "users", fieldOptions);
    if (section.truncated) truncated.push(section.truncated);
    result.users = section.items;
    result.cursor = users.cursor;
  }

  if (input.sessionId) {
    const timeline = await client.getSessionTimeline(input.sessionId, {
      tenantId: input.sessionTenantId,
      userId: input.sessionUserId,
      from: input.sessionFrom,
      to: input.sessionTo,
      center: input.sessionCenter,
      before: input.sessionBefore,
      after: input.sessionAfter,
      types: input.sessionTypes,
      limit: input.sessionLimit
    });

    const itemsSection = pruneSection(timeline.items as unknown as Record<string, unknown>[], "timeline.items", {
      ...fieldOptions,
      sensitiveFields: [...DEFAULT_SENSITIVE_FIELDS, "data"]
    });
    if (itemsSection.truncated) truncated.push(itemsSection.truncated);

    result.timeline = {
      sessionId: timeline.sessionId,
      scope: timeline.scope,
      range: timeline.range,
      items: itemsSection.items,
      page: timeline.page
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
