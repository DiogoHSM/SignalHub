import { sql } from "kysely";
import type { Db } from "../client.js";

export type EntityWindow = "24h" | "7d" | "30d";
export type EntitySignalType = "event" | "error" | "trace" | "llm";

export type EntityCursor = {
  timestamp: string;
  type: EntitySignalType;
  id: string;
};

export type EntityRange = {
  from: string;
  to: string;
};

export type EntityTenantFilters = {
  projectId: string;
  environmentId: string;
  window: EntityWindow;
  search?: string;
  limit?: number;
  now?: Date;
};

export type EntityTenantDetailFilters = {
  projectId: string;
  environmentId: string;
  window: EntityWindow;
  userId?: string;
  signalType?: EntitySignalType;
  limit?: number;
  cursor?: EntityCursor;
  now?: Date;
};

export type TenantSummary = {
  tenantId: string | null;
  label: string;
  traits: Record<string, unknown>;
  keyTraits: Record<string, string>;
  isUnassigned: boolean;
  impactScore: number;
  lastSeenAt: string | null;
  events: number;
  errors: number;
  openErrors: number;
  severeErrors: number;
  traces: number;
  failedTraces: number;
  llmCalls: number;
  failedLlmCalls: number;
  llmCostUsd: string;
  activeUsers: number;
  activeSessions: number;
};

export type TenantListResponse = {
  window: EntityWindow;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: EntityRange;
  tenants: TenantSummary[];
};

export type TenantTopUser = {
  userId: string;
  events: number;
  errors: number;
  traces: number;
  llmCalls: number;
  llmCostUsd: string;
  lastSeenAt: string;
};

export type TenantTimelineRow =
  | {
      type: "event";
      id: string;
      timestamp: string;
      label: string;
      userId: string | null;
      sessionId: string | null;
      traceId: string | null;
      eventName: string;
    }
  | {
      type: "error";
      id: string;
      timestamp: string;
      label: string;
      userId: string | null;
      sessionId: string | null;
      traceId: string | null;
      severity: string;
      status: string;
      message: string;
    }
  | {
      type: "trace";
      id: string;
      timestamp: string;
      label: string;
      userId: string | null;
      sessionId: string | null;
      traceId: string | null;
      status: string;
      durationMs: number | null;
      name: string;
    }
  | {
      type: "llm";
      id: string;
      timestamp: string;
      label: string;
      userId: string | null;
      sessionId: string | null;
      traceId: string | null;
      provider: string;
      model: string;
      promptName: string | null;
      status: string;
      costUsd: string;
    };

export type TenantDetailResponse = {
  window: EntityWindow;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: EntityRange;
  tenant: TenantSummary;
  topUsers: TenantTopUser[];
  timeline: TenantTimelineRow[];
  cursor?: string;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const severeErrorSeverities = ["error", "critical", "fatal"] as const;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function resolveEntityRange(window: EntityWindow, now = new Date()): { from: Date; to: Date; range: EntityRange } {
  const to = now;
  const from = new Date(to);
  if (window === "24h") {
    from.setUTCHours(from.getUTCHours() - 24);
  } else if (window === "7d") {
    from.setUTCDate(from.getUTCDate() - 7);
  } else {
    from.setUTCDate(from.getUTCDate() - 30);
  }
  return { from, to, range: { from: from.toISOString(), to: to.toISOString() } };
}

function tenantLabel(tenantId: string | null): string {
  return tenantId ?? "Unassigned";
}

function objectTraits(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function profileLabel(rawId: string | null, traits: Record<string, unknown>, fallback: string): string {
  for (const key of ["name", "display_name", "email"]) {
    const value = traits[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return rawId ?? fallback;
}

function keyTraits(traits: Record<string, unknown>, keys: string[]): Record<string, string> {
  const entries = keys.flatMap((key) => {
    const value = traits[key];
    if (typeof value === "string" && value.trim() !== "") return [[key, value] as const];
    if (typeof value === "number" || typeof value === "boolean") return [[key, String(value)] as const];
    return [];
  });
  return Object.fromEntries(entries);
}

function computeImpactScore(input: {
  severeErrors: number;
  openErrors: number;
  errors: number;
  failedTraces: number;
  failedLlmCalls: number;
  llmCostUsd: number;
}): number {
  return (
    input.severeErrors * 15 +
    input.openErrors * 8 +
    input.errors * 5 +
    input.failedTraces * 4 +
    input.failedLlmCalls * 4 +
    Math.min(input.llmCostUsd, 100) * 0.25
  );
}

function searchPattern(search: string | undefined): string | undefined {
  const trimmed = search?.trim();
  return trimmed ? `%${trimmed}%` : undefined;
}

function encodeEntityCursor(cursor: EntityCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export async function listEntityTenants(db: Db, filters: EntityTenantFilters): Promise<TenantListResponse> {
  const { from, to, range } = resolveEntityRange(filters.window, filters.now);
  const pattern = searchPattern(filters.search);
  const limit = resolveLimit(filters.limit);
  const rows = await sql<{
    tenant_id: string | null;
    last_seen_at: Date | string | null;
    events: unknown;
    errors: unknown;
    open_errors: unknown;
    severe_errors: unknown;
    traces: unknown;
    failed_traces: unknown;
    llm_calls: unknown;
    failed_llm_calls: unknown;
    llm_cost_usd: string;
    active_users: unknown;
    active_sessions: unknown;
    profile_traits: unknown;
  }>`
    with scoped_events as (
      select tenant_id, user_id, session_id, timestamp, 1::bigint as events, 0::bigint as errors,
        0::bigint as open_errors, 0::bigint as severe_errors, 0::bigint as traces, 0::bigint as failed_traces,
        0::bigint as llm_calls, 0::bigint as failed_llm_calls, 0::numeric as llm_cost_usd
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    scoped_errors as (
      select tenant_id, user_id, session_id, timestamp, 0::bigint as events, 1::bigint as errors,
        case when status = 'open' then 1 else 0 end::bigint as open_errors,
        case
          when severity in (${severeErrorSeverities[0]}, ${severeErrorSeverities[1]}, ${severeErrorSeverities[2]})
          then 1
          else 0
        end::bigint as severe_errors,
        0::bigint as traces, 0::bigint as failed_traces, 0::bigint as llm_calls, 0::bigint as failed_llm_calls,
        0::numeric as llm_cost_usd
      from errors
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    scoped_traces as (
      select tenant_id, user_id, session_id, timestamp, 0::bigint as events, 0::bigint as errors,
        0::bigint as open_errors, 0::bigint as severe_errors, 1::bigint as traces,
        case when status <> 'success' then 1 else 0 end::bigint as failed_traces,
        0::bigint as llm_calls, 0::bigint as failed_llm_calls, 0::numeric as llm_cost_usd
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    scoped_llm_calls as (
      select tenant_id, user_id, session_id, timestamp, 0::bigint as events, 0::bigint as errors,
        0::bigint as open_errors, 0::bigint as severe_errors, 0::bigint as traces, 0::bigint as failed_traces,
        1::bigint as llm_calls, case when status <> 'success' then 1 else 0 end::bigint as failed_llm_calls,
        cost_usd as llm_cost_usd
      from llm_calls
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    all_rows as (
      select * from scoped_events
      union all select * from scoped_errors
      union all select * from scoped_traces
      union all select * from scoped_llm_calls
    ),
    aggregated as (
      select tenant_id, max(timestamp) as last_seen_at, sum(events) as events, sum(errors) as errors,
        sum(open_errors) as open_errors, sum(severe_errors) as severe_errors, sum(traces) as traces,
        sum(failed_traces) as failed_traces, sum(llm_calls) as llm_calls, sum(failed_llm_calls) as failed_llm_calls,
        coalesce(sum(llm_cost_usd), 0)::text as llm_cost_usd,
        count(distinct user_id) filter (where user_id is not null) as active_users,
        count(distinct session_id) filter (where session_id is not null) as active_sessions
      from all_rows
      group by tenant_id
    )
    select aggregated.tenant_id, aggregated.last_seen_at, aggregated.events, aggregated.errors,
      aggregated.open_errors, aggregated.severe_errors, aggregated.traces, aggregated.failed_traces,
      aggregated.llm_calls, aggregated.failed_llm_calls, aggregated.llm_cost_usd, aggregated.active_users,
      aggregated.active_sessions, coalesce(tenant_profiles.traits, '{}'::jsonb) as profile_traits
    from aggregated
    left join tenant_profiles
      on tenant_profiles.project_id = ${filters.projectId}
      and tenant_profiles.environment_id = ${filters.environmentId}
      and tenant_profiles.tenant_id = aggregated.tenant_id
    where (
      ${pattern ?? null}::text is null
      or aggregated.tenant_id ilike ${pattern ?? ""}
      or tenant_profiles.traits ->> 'name' ilike ${pattern ?? ""}
      or tenant_profiles.traits ->> 'display_name' ilike ${pattern ?? ""}
      or tenant_profiles.traits ->> 'email' ilike ${pattern ?? ""}
      or exists (
        select 1
        from all_rows search_rows
        where search_rows.tenant_id is not distinct from aggregated.tenant_id
          and (
            search_rows.user_id ilike ${pattern ?? ""}
            or search_rows.session_id ilike ${pattern ?? ""}
          )
      )
    )
  `.execute(db);

  const tenants = rows.rows.map((row): TenantSummary => {
    const traits = objectTraits(row.profile_traits);
    const errors = toNumber(row.errors);
    const openErrors = toNumber(row.open_errors);
    const severeErrors = toNumber(row.severe_errors);
    const failedTraces = toNumber(row.failed_traces);
    const failedLlmCalls = toNumber(row.failed_llm_calls);
    const llmCostUsd = row.llm_cost_usd;
    return {
      tenantId: row.tenant_id,
      label: profileLabel(row.tenant_id, traits, tenantLabel(row.tenant_id)),
      traits,
      keyTraits: keyTraits(traits, ["plan", "role", "operation_mode", "status"]),
      isUnassigned: row.tenant_id === null,
      impactScore: computeImpactScore({
        severeErrors,
        openErrors,
        errors,
        failedTraces,
        failedLlmCalls,
        llmCostUsd: Number(llmCostUsd)
      }),
      lastSeenAt: row.last_seen_at ? toIso(row.last_seen_at) : null,
      events: toNumber(row.events),
      errors,
      openErrors,
      severeErrors,
      traces: toNumber(row.traces),
      failedTraces,
      llmCalls: toNumber(row.llm_calls),
      failedLlmCalls,
      llmCostUsd,
      activeUsers: toNumber(row.active_users),
      activeSessions: toNumber(row.active_sessions)
    };
  });

  tenants.sort((left, right) => {
    if (right.impactScore !== left.impactScore) return right.impactScore - left.impactScore;
    if ((right.lastSeenAt ?? "") !== (left.lastSeenAt ?? "")) {
      return (right.lastSeenAt ?? "").localeCompare(left.lastSeenAt ?? "");
    }
    if (right.events !== left.events) return right.events - left.events;
    return left.label.localeCompare(right.label);
  });

  return {
    window: filters.window,
    generatedAt: (filters.now ?? new Date()).toISOString(),
    scope: { projectId: filters.projectId, environmentId: filters.environmentId },
    range,
    tenants: tenants.slice(0, limit)
  };
}

export async function getEntityTenantDetail(
  db: Db,
  tenantId: string,
  filters: EntityTenantDetailFilters
): Promise<TenantDetailResponse> {
  const { from, to, range } = resolveEntityRange(filters.window, filters.now);
  const limit = resolveLimit(filters.limit);
  const tenant = await getEntityTenantSummary(db, tenantId, filters, from, to);

  const topUsers = await queryEntityTopUsers(db, tenantId, filters, from, to);
  const timelineRows = await queryEntityTimeline(db, tenantId, filters, from, to, limit + 1);
  const timeline = timelineRows.slice(0, limit);
  const response: TenantDetailResponse = {
    window: filters.window,
    generatedAt: (filters.now ?? new Date()).toISOString(),
    scope: { projectId: filters.projectId, environmentId: filters.environmentId },
    range,
    tenant,
    topUsers,
    timeline
  };

  if (timelineRows.length > limit && timeline.length > 0) {
    const lastRow = timeline[timeline.length - 1];
    response.cursor = encodeEntityCursor({ timestamp: lastRow.timestamp, type: lastRow.type, id: lastRow.id });
  }

  return response;
}

async function getEntityTenantSummary(
  db: Db,
  tenantId: string,
  filters: EntityTenantDetailFilters,
  from: Date,
  to: Date
): Promise<TenantSummary> {
  const rows = await sql<{
    last_seen_at: Date | string | null;
    events: unknown;
    errors: unknown;
    open_errors: unknown;
    severe_errors: unknown;
    traces: unknown;
    failed_traces: unknown;
    llm_calls: unknown;
    failed_llm_calls: unknown;
    llm_cost_usd: string;
    active_users: unknown;
    active_sessions: unknown;
    total_signals: unknown;
    profile_traits: unknown;
  }>`
    with scoped_events as (
      select user_id, session_id, timestamp, 1::bigint as events, 0::bigint as errors,
        0::bigint as open_errors, 0::bigint as severe_errors, 0::bigint as traces, 0::bigint as failed_traces,
        0::bigint as llm_calls, 0::bigint as failed_llm_calls, 0::numeric as llm_cost_usd
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and tenant_id = ${tenantId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    scoped_errors as (
      select user_id, session_id, timestamp, 0::bigint as events, 1::bigint as errors,
        case when status = 'open' then 1 else 0 end::bigint as open_errors,
        case
          when severity in (${severeErrorSeverities[0]}, ${severeErrorSeverities[1]}, ${severeErrorSeverities[2]})
          then 1
          else 0
        end::bigint as severe_errors,
        0::bigint as traces, 0::bigint as failed_traces, 0::bigint as llm_calls, 0::bigint as failed_llm_calls,
        0::numeric as llm_cost_usd
      from errors
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and tenant_id = ${tenantId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    scoped_traces as (
      select user_id, session_id, timestamp, 0::bigint as events, 0::bigint as errors,
        0::bigint as open_errors, 0::bigint as severe_errors, 1::bigint as traces,
        case when status <> 'success' then 1 else 0 end::bigint as failed_traces,
        0::bigint as llm_calls, 0::bigint as failed_llm_calls, 0::numeric as llm_cost_usd
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and tenant_id = ${tenantId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    scoped_llm_calls as (
      select user_id, session_id, timestamp, 0::bigint as events, 0::bigint as errors,
        0::bigint as open_errors, 0::bigint as severe_errors, 0::bigint as traces, 0::bigint as failed_traces,
        1::bigint as llm_calls, case when status <> 'success' then 1 else 0 end::bigint as failed_llm_calls,
        cost_usd as llm_cost_usd
      from llm_calls
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and tenant_id = ${tenantId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    all_rows as (
      select * from scoped_events
      union all select * from scoped_errors
      union all select * from scoped_traces
      union all select * from scoped_llm_calls
    )
    select max(timestamp) as last_seen_at, coalesce(sum(events), 0) as events, coalesce(sum(errors), 0) as errors,
      coalesce(sum(open_errors), 0) as open_errors, coalesce(sum(severe_errors), 0) as severe_errors,
      coalesce(sum(traces), 0) as traces, coalesce(sum(failed_traces), 0) as failed_traces,
      coalesce(sum(llm_calls), 0) as llm_calls, coalesce(sum(failed_llm_calls), 0) as failed_llm_calls,
      coalesce(sum(llm_cost_usd), 0)::text as llm_cost_usd,
      count(distinct user_id) filter (where user_id is not null) as active_users,
      count(distinct session_id) filter (where session_id is not null) as active_sessions,
      count(*) as total_signals,
      coalesce((
        select traits
        from tenant_profiles
        where project_id = ${filters.projectId}
          and environment_id = ${filters.environmentId}
          and tenant_id = ${tenantId}
      ), '{}'::jsonb) as profile_traits
    from all_rows
  `.execute(db);
  const row = rows.rows[0];
  const traits = objectTraits(row?.profile_traits);
  const errors = toNumber(row?.errors);
  const openErrors = toNumber(row?.open_errors);
  const severeErrors = toNumber(row?.severe_errors);
  const failedTraces = toNumber(row?.failed_traces);
  const failedLlmCalls = toNumber(row?.failed_llm_calls);
  const llmCostUsd = row?.llm_cost_usd ?? "0";

  return {
    tenantId,
    label: profileLabel(tenantId, traits, tenantId),
    traits,
    keyTraits: keyTraits(traits, ["plan", "role", "operation_mode", "status"]),
    isUnassigned: false,
    impactScore:
      toNumber(row?.total_signals) === 0
        ? 0
        : computeImpactScore({
            severeErrors,
            openErrors,
            errors,
            failedTraces,
            failedLlmCalls,
            llmCostUsd: Number(llmCostUsd)
          }),
    lastSeenAt: row?.last_seen_at ? toIso(row.last_seen_at) : null,
    events: toNumber(row?.events),
    errors,
    openErrors,
    severeErrors,
    traces: toNumber(row?.traces),
    failedTraces,
    llmCalls: toNumber(row?.llm_calls),
    failedLlmCalls,
    llmCostUsd,
    activeUsers: toNumber(row?.active_users),
    activeSessions: toNumber(row?.active_sessions)
  };
}

async function queryEntityTopUsers(
  db: Db,
  tenantId: string,
  filters: EntityTenantDetailFilters,
  from: Date,
  to: Date
): Promise<TenantTopUser[]> {
  const rows = await sql<{
    user_id: string;
    events: unknown;
    errors: unknown;
    traces: unknown;
    llm_calls: unknown;
    llm_cost_usd: string;
    last_seen_at: Date | string;
  }>`
    with scoped_rows as (
      select user_id, timestamp, 1::bigint as events, 0::bigint as errors, 0::bigint as traces,
        0::bigint as llm_calls, 0::numeric as llm_cost_usd
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and tenant_id = ${tenantId}
        and user_id is not null
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select user_id, timestamp, 0::bigint as events, 1::bigint as errors, 0::bigint as traces,
        0::bigint as llm_calls, 0::numeric as llm_cost_usd
      from errors
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and tenant_id = ${tenantId}
        and user_id is not null
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select user_id, timestamp, 0::bigint as events, 0::bigint as errors, 1::bigint as traces,
        0::bigint as llm_calls, 0::numeric as llm_cost_usd
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and tenant_id = ${tenantId}
        and user_id is not null
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select user_id, timestamp, 0::bigint as events, 0::bigint as errors, 0::bigint as traces,
        1::bigint as llm_calls, cost_usd as llm_cost_usd
      from llm_calls
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and tenant_id = ${tenantId}
        and user_id is not null
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    aggregated as (
      select user_id, sum(events) as events, sum(errors) as errors, sum(traces) as traces,
        sum(llm_calls) as llm_calls, coalesce(sum(llm_cost_usd), 0)::text as llm_cost_usd,
        max(timestamp) as last_seen_at, sum(events + errors + traces + llm_calls) as total_signals
      from scoped_rows
      group by user_id
    )
    select user_id, events, errors, traces, llm_calls, llm_cost_usd, last_seen_at
    from aggregated
    order by last_seen_at desc, total_signals desc, user_id asc
    limit 10
  `.execute(db);

  return rows.rows.map((row) => ({
    userId: row.user_id,
    events: toNumber(row.events),
    errors: toNumber(row.errors),
    traces: toNumber(row.traces),
    llmCalls: toNumber(row.llm_calls),
    llmCostUsd: row.llm_cost_usd,
    lastSeenAt: toIso(row.last_seen_at)
  }));
}

async function queryEntityTimeline(
  db: Db,
  tenantId: string,
  filters: EntityTenantDetailFilters,
  from: Date,
  to: Date,
  limit: number
): Promise<TenantTimelineRow[]> {
  const cursor = filters.cursor;
  const rows = await sql<{
    type: EntitySignalType;
    id: string;
    timestamp: Date | string;
    label: string;
    user_id: string | null;
    session_id: string | null;
    trace_id: string | null;
    event_name: string | null;
    severity: string | null;
    status: string | null;
    message: string | null;
    duration_ms: unknown | null;
    name: string | null;
    provider: string | null;
    model: string | null;
    prompt_name: string | null;
    cost_usd: string | null;
  }>`
    with timeline_rows as (
      select 'event'::text as type, id, timestamp, name as label, user_id, session_id, trace_id,
        name as event_name, null::text as severity, null::text as status, null::text as message,
        null::integer as duration_ms, null::text as trace_name, null::text as provider, null::text as model,
        null::text as prompt_name, null::text as cost_usd
      from events
      where (${filters.signalType ?? null}::text is null or ${filters.signalType ?? ""} = 'event')
        and project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and tenant_id = ${tenantId}
        and (${filters.userId ?? null}::text is null or user_id = ${filters.userId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select 'error'::text as type, id, timestamp, message as label, user_id, session_id, trace_id,
        null::text as event_name, severity, status, message, null::integer as duration_ms, null::text as trace_name,
        null::text as provider, null::text as model, null::text as prompt_name, null::text as cost_usd
      from errors
      where (${filters.signalType ?? null}::text is null or ${filters.signalType ?? ""} = 'error')
        and project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and tenant_id = ${tenantId}
        and (${filters.userId ?? null}::text is null or user_id = ${filters.userId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select 'trace'::text as type, id, timestamp, name as label, user_id, session_id, trace_id,
        null::text as event_name, null::text as severity, status, null::text as message, duration_ms, name as trace_name,
        null::text as provider, null::text as model, null::text as prompt_name, null::text as cost_usd
      from traces
      where (${filters.signalType ?? null}::text is null or ${filters.signalType ?? ""} = 'trace')
        and project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and tenant_id = ${tenantId}
        and (${filters.userId ?? null}::text is null or user_id = ${filters.userId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select 'llm'::text as type, id, timestamp, provider || ' / ' || model as label, user_id, session_id, trace_id,
        null::text as event_name, null::text as severity, status, null::text as message, null::integer as duration_ms,
        null::text as trace_name, provider, model, prompt_name, cost_usd::text as cost_usd
      from llm_calls
      where (${filters.signalType ?? null}::text is null or ${filters.signalType ?? ""} = 'llm')
        and project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and tenant_id = ${tenantId}
        and (${filters.userId ?? null}::text is null or user_id = ${filters.userId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
    )
    select type, id, timestamp, label, user_id, session_id, trace_id, event_name, severity, status, message,
      duration_ms, trace_name as name, provider, model, prompt_name, cost_usd
    from timeline_rows
    where (
      ${cursor?.timestamp ?? null}::timestamptz is null
      or timestamp < ${cursor?.timestamp ?? null}::timestamptz
      or (timestamp = ${cursor?.timestamp ?? null}::timestamptz and type > ${cursor?.type ?? ""})
      or (timestamp = ${cursor?.timestamp ?? null}::timestamptz and type = ${cursor?.type ?? ""} and id > ${cursor?.id ?? ""})
    )
    order by timestamp desc, type asc, id asc
    limit ${limit}
  `.execute(db);

  return rows.rows.map((row): TenantTimelineRow => {
    const base = {
      id: row.id,
      timestamp: toIso(row.timestamp),
      label: row.label,
      userId: row.user_id,
      sessionId: row.session_id,
      traceId: row.trace_id
    };
    if (row.type === "event") {
      return { ...base, type: "event", eventName: row.event_name ?? row.label };
    }
    if (row.type === "error") {
      return {
        ...base,
        type: "error",
        severity: row.severity ?? "",
        status: row.status ?? "",
        message: row.message ?? row.label
      };
    }
    if (row.type === "trace") {
      return {
        ...base,
        type: "trace",
        status: row.status ?? "",
        durationMs: row.duration_ms === null ? null : toNumber(row.duration_ms),
        name: row.name ?? row.label
      };
    }
    return {
      ...base,
      type: "llm",
      provider: row.provider ?? "",
      model: row.model ?? "",
      promptName: row.prompt_name,
      status: row.status ?? "",
      costUsd: row.cost_usd ?? "0"
    };
  });
}
