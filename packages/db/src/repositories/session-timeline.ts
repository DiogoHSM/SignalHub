import { sql } from "kysely";
import type { Db } from "../client.js";

export type SessionTimelineItemType = "breadcrumb" | "event" | "error" | "trace" | "llm";

export type SessionTimelineFilters = {
  projectId: string;
  environmentId: string;
  sessionId: string;
  tenantId?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  center?: Date;
  beforeMs?: number;
  afterMs?: number;
  types?: SessionTimelineItemType[];
  limit?: number;
};

export type SessionTimelineItem = {
  id: string;
  type: SessionTimelineItemType;
  timestamp: Date;
  receivedAt: Date;
  tenantId: string | null;
  userId: string | null;
  sessionId: string;
  traceId: string | null;
  source: string | null;
  release: string | null;
  title: string;
  level: string | null;
  data: unknown;
};

export type SessionTimelineResponse = {
  sessionId: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string | null; to: string | null };
  items: SessionTimelineItem[];
  page: { nextCursor: string | null; previousCursor: string | null };
};

type SessionTimelineRow = Omit<SessionTimelineItem, "type"> & {
  type: string;
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const DEFAULT_BEFORE_MS = 10 * 60 * 1000;
const DEFAULT_AFTER_MS = 2 * 60 * 1000;
const DEFAULT_TYPES: SessionTimelineItemType[] = ["breadcrumb", "event", "error", "trace", "llm"];

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function resolveRange(filters: SessionTimelineFilters): { from?: Date; to?: Date } {
  if (!filters.center) return { from: filters.from, to: filters.to };

  return {
    from: new Date(filters.center.getTime() - (filters.beforeMs ?? DEFAULT_BEFORE_MS)),
    to: new Date(filters.center.getTime() + (filters.afterMs ?? DEFAULT_AFTER_MS))
  };
}

function resolveTypes(types: SessionTimelineItemType[] | undefined): SessionTimelineItemType[] {
  return types?.length ? types : DEFAULT_TYPES;
}

export async function getSessionTimeline(db: Db, filters: SessionTimelineFilters): Promise<SessionTimelineResponse> {
  const range = resolveRange(filters);
  const selectedTypes = resolveTypes(filters.types);
  const from = range.from ?? null;
  const to = range.to ?? null;
  const tenantId = filters.tenantId ?? null;
  const userId = filters.userId ?? null;

  const rows = await sql<SessionTimelineRow>`
    with timeline as (
      select
        id,
        'breadcrumb'::text as type,
        timestamp,
        received_at,
        tenant_id,
        user_id,
        session_id,
        trace_id,
        source,
        release,
        message as title,
        level,
        jsonb_build_object('breadcrumbType', type, 'category', category, 'data', data) as data
      from breadcrumbs
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and session_id = ${filters.sessionId}

      union all

      select
        id,
        'event'::text as type,
        timestamp,
        received_at,
        tenant_id,
        user_id,
        session_id,
        trace_id,
        source,
        release,
        name as title,
        null::text as level,
        jsonb_build_object('properties', properties) as data
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and session_id = ${filters.sessionId}

      union all

      select
        id,
        'error'::text as type,
        timestamp,
        received_at,
        tenant_id,
        user_id,
        session_id,
        trace_id,
        source,
        release,
        message as title,
        severity as level,
        jsonb_build_object('status', status, 'errorGroupId', error_group_id) as data
      from errors
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and session_id = ${filters.sessionId}

      union all

      select
        id,
        'trace'::text as type,
        timestamp,
        received_at,
        tenant_id,
        user_id,
        session_id,
        trace_id,
        source,
        release,
        name as title,
        status as level,
        jsonb_build_object('durationMs', duration_ms) as data
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and session_id = ${filters.sessionId}

      union all

      select
        id,
        'llm'::text as type,
        timestamp,
        received_at,
        tenant_id,
        user_id,
        session_id,
        trace_id,
        source,
        release,
        coalesce(prompt_name, provider || ' ' || model) as title,
        status as level,
        jsonb_build_object(
          'provider',
          provider,
          'model',
          model,
          'costUsd',
          cost_usd,
          'latencyMs',
          latency_ms
        ) as data
      from llm_calls
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and session_id = ${filters.sessionId}
    )
    select
      id,
      type,
      timestamp,
      received_at as "receivedAt",
      tenant_id as "tenantId",
      user_id as "userId",
      session_id as "sessionId",
      trace_id as "traceId",
      source,
      release,
      title,
      level,
      data
    from timeline
    where type in (${sql.join(selectedTypes)})
      and (${from}::timestamptz is null or timestamp >= ${from})
      and (${to}::timestamptz is null or timestamp <= ${to})
      and (${tenantId}::text is null or tenant_id = ${tenantId})
      and (${userId}::text is null or user_id = ${userId})
    order by timestamp asc, id asc
    limit ${resolveLimit(filters.limit)}
  `.execute(db);

  return {
    sessionId: filters.sessionId,
    scope: { projectId: filters.projectId, environmentId: filters.environmentId },
    range: { from: range.from?.toISOString() ?? null, to: range.to?.toISOString() ?? null },
    items: rows.rows.map((row) => ({ ...row, type: row.type as SessionTimelineItemType })),
    page: { nextCursor: null, previousCursor: null }
  };
}
