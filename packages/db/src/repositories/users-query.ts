import { sql } from "kysely";
import type { Db } from "../client.js";

export type UserWindow = "24h" | "7d" | "30d";
export type UserSignalType = "event" | "error" | "trace" | "llm";

export type UserCursor = {
  timestamp: string;
  type: UserSignalType;
  id: string;
};

export type UserRange = {
  from: string;
  to: string;
};

export type UserListFilters = {
  projectId: string;
  environmentId: string;
  window: UserWindow;
  search?: string;
  tenantId?: string;
  limit?: number;
  now?: Date;
};

export type UserDetailFilters = {
  projectId: string;
  environmentId: string;
  window: UserWindow;
  tenantId?: string;
  signalType?: UserSignalType;
  limit?: number;
  cursor?: UserCursor;
  now?: Date;
};

export type UserSummary = {
  userId: string | null;
  label: string;
  traits: Record<string, unknown>;
  keyTraits: Record<string, string>;
  isAnonymous: boolean;
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
  activeTenants: number;
  activeSessions: number;
};

export type UserListResponse = {
  window: UserWindow;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: UserRange;
  users: UserSummary[];
};

export type UserRecentSession = {
  sessionId: string;
  tenantId: string | null;
  events: number;
  errors: number;
  traces: number;
  llmCalls: number;
  llmCostUsd: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type UserTimelineRow =
  | {
      type: "event";
      id: string;
      timestamp: string;
      label: string;
      tenantId: string | null;
      sessionId: string | null;
      traceId: string | null;
      eventName: string;
    }
  | {
      type: "error";
      id: string;
      timestamp: string;
      label: string;
      tenantId: string | null;
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
      tenantId: string | null;
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
      tenantId: string | null;
      sessionId: string | null;
      traceId: string | null;
      provider: string;
      model: string;
      promptName: string | null;
      status: string;
      costUsd: string;
    };

export type UserDetailResponse = {
  window: UserWindow;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: UserRange;
  user: UserSummary;
  recentSessions: UserRecentSession[];
  timeline: UserTimelineRow[];
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

function resolveUserRange(window: UserWindow, now = new Date()): { from: Date; to: Date; range: UserRange } {
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

function userLabel(userId: string | null): string {
  return userId ?? "Anonymous / Unassigned";
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

function encodeUserCursor(cursor: UserCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export async function listUsersActivity(db: Db, filters: UserListFilters): Promise<UserListResponse> {
  const { from, to, range } = resolveUserRange(filters.window, filters.now);
  const pattern = searchPattern(filters.search);
  const limit = resolveLimit(filters.limit);
  const rows = await sql<{
    user_id: string | null;
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
    active_tenants: unknown;
    active_sessions: unknown;
    profile_traits: unknown;
  }>`
    with profile_matches as (
      select user_id
      from user_profiles
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and ${pattern ?? null}::text is not null
        and (
          traits ->> 'name' ilike ${pattern ?? ""}
          or traits ->> 'display_name' ilike ${pattern ?? ""}
          or traits ->> 'email' ilike ${pattern ?? ""}
          or traits ->> 'plan' ilike ${pattern ?? ""}
          or traits ->> 'role' ilike ${pattern ?? ""}
          or traits ->> 'operation_mode' ilike ${pattern ?? ""}
          or traits ->> 'status' ilike ${pattern ?? ""}
        )
    ),
    scoped_events as (
      select user_id, tenant_id, session_id, timestamp, 1::bigint as events, 0::bigint as errors,
        0::bigint as open_errors, 0::bigint as severe_errors, 0::bigint as traces, 0::bigint as failed_traces,
        0::bigint as llm_calls, 0::bigint as failed_llm_calls, 0::numeric as llm_cost_usd
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and (
          ${pattern ?? null}::text is null
          or user_id ilike ${pattern ?? ""}
          or tenant_id ilike ${pattern ?? ""}
          or session_id ilike ${pattern ?? ""}
          or user_id in (select user_id from profile_matches)
        )
    ),
    scoped_errors as (
      select user_id, tenant_id, session_id, timestamp, 0::bigint as events, 1::bigint as errors,
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
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and (
          ${pattern ?? null}::text is null
          or user_id ilike ${pattern ?? ""}
          or tenant_id ilike ${pattern ?? ""}
          or session_id ilike ${pattern ?? ""}
          or user_id in (select user_id from profile_matches)
        )
    ),
    scoped_traces as (
      select user_id, tenant_id, session_id, timestamp, 0::bigint as events, 0::bigint as errors,
        0::bigint as open_errors, 0::bigint as severe_errors, 1::bigint as traces,
        case when status <> 'success' then 1 else 0 end::bigint as failed_traces,
        0::bigint as llm_calls, 0::bigint as failed_llm_calls, 0::numeric as llm_cost_usd
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and (
          ${pattern ?? null}::text is null
          or user_id ilike ${pattern ?? ""}
          or tenant_id ilike ${pattern ?? ""}
          or session_id ilike ${pattern ?? ""}
          or user_id in (select user_id from profile_matches)
        )
    ),
    scoped_llm_calls as (
      select user_id, tenant_id, session_id, timestamp, 0::bigint as events, 0::bigint as errors,
        0::bigint as open_errors, 0::bigint as severe_errors, 0::bigint as traces, 0::bigint as failed_traces,
        1::bigint as llm_calls, case when status <> 'success' then 1 else 0 end::bigint as failed_llm_calls,
        cost_usd as llm_cost_usd
      from llm_calls
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and (
          ${pattern ?? null}::text is null
          or user_id ilike ${pattern ?? ""}
          or tenant_id ilike ${pattern ?? ""}
          or session_id ilike ${pattern ?? ""}
          or user_id in (select user_id from profile_matches)
        )
    ),
    all_rows as (
      select * from scoped_events
      union all select * from scoped_errors
      union all select * from scoped_traces
      union all select * from scoped_llm_calls
    ),
    aggregated as (
      select user_id, max(timestamp) as last_seen_at, sum(events) as events, sum(errors) as errors,
        sum(open_errors) as open_errors, sum(severe_errors) as severe_errors, sum(traces) as traces,
        sum(failed_traces) as failed_traces, sum(llm_calls) as llm_calls, sum(failed_llm_calls) as failed_llm_calls,
        coalesce(sum(llm_cost_usd), 0)::text as llm_cost_usd,
        count(distinct tenant_id) filter (where tenant_id is not null) as active_tenants,
        count(distinct session_id) filter (where session_id is not null) as active_sessions
      from all_rows
      group by user_id
    )
    select aggregated.user_id, aggregated.last_seen_at, aggregated.events, aggregated.errors,
      aggregated.open_errors, aggregated.severe_errors, aggregated.traces, aggregated.failed_traces,
      aggregated.llm_calls, aggregated.failed_llm_calls, aggregated.llm_cost_usd, aggregated.active_tenants,
      aggregated.active_sessions, coalesce(user_profiles.traits, '{}'::jsonb) as profile_traits
    from aggregated
    left join user_profiles
      on user_profiles.project_id = ${filters.projectId}
      and user_profiles.environment_id = ${filters.environmentId}
      and user_profiles.user_id = aggregated.user_id
  `.execute(db);

  const users = rows.rows.map((row): UserSummary => {
    const traits = objectTraits(row.profile_traits);
    const errors = toNumber(row.errors);
    const openErrors = toNumber(row.open_errors);
    const severeErrors = toNumber(row.severe_errors);
    const failedTraces = toNumber(row.failed_traces);
    const failedLlmCalls = toNumber(row.failed_llm_calls);
    const llmCostUsd = row.llm_cost_usd;
    return {
      userId: row.user_id,
      label: profileLabel(row.user_id, traits, userLabel(row.user_id)),
      traits,
      keyTraits: keyTraits(traits, ["plan", "role", "operation_mode", "status"]),
      isAnonymous: row.user_id === null,
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
      activeTenants: toNumber(row.active_tenants),
      activeSessions: toNumber(row.active_sessions)
    };
  });

  users.sort((left, right) => {
    if (right.impactScore !== left.impactScore) return right.impactScore - left.impactScore;
    const rightSeen = right.lastSeenAt ? new Date(right.lastSeenAt).getTime() : 0;
    const leftSeen = left.lastSeenAt ? new Date(left.lastSeenAt).getTime() : 0;
    if (rightSeen !== leftSeen) return rightSeen - leftSeen;
    if (right.events !== left.events) return right.events - left.events;
    return left.label.localeCompare(right.label);
  });

  return {
    window: filters.window,
    generatedAt: (filters.now ?? new Date()).toISOString(),
    scope: { projectId: filters.projectId, environmentId: filters.environmentId },
    range,
    users: users.slice(0, limit)
  };
}

export async function getUserDetail(db: Db, userId: string, filters: UserDetailFilters): Promise<UserDetailResponse> {
  const { from, to, range } = resolveUserRange(filters.window, filters.now);
  const limit = resolveLimit(filters.limit);
  const user = await getUserSummary(db, userId, filters, from, to);
  const recentSessions = await queryUserRecentSessions(db, userId, filters, from, to);
  const timelineRows = await queryUserTimeline(db, userId, filters, from, to, limit + 1);
  const timeline = timelineRows.slice(0, limit);
  const response: UserDetailResponse = {
    window: filters.window,
    generatedAt: (filters.now ?? new Date()).toISOString(),
    scope: { projectId: filters.projectId, environmentId: filters.environmentId },
    range,
    user,
    recentSessions,
    timeline
  };

  if (timelineRows.length > limit && timeline.length > 0) {
    const lastRow = timeline[timeline.length - 1];
    response.cursor = encodeUserCursor({ timestamp: lastRow.timestamp, type: lastRow.type, id: lastRow.id });
  }

  return response;
}

async function getUserSummary(db: Db, userId: string, filters: UserDetailFilters, from: Date, to: Date): Promise<UserSummary> {
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
    active_tenants: unknown;
    active_sessions: unknown;
    total_signals: unknown;
    profile_traits: unknown;
  }>`
    with scoped_events as (
      select tenant_id, session_id, timestamp, 1::bigint as events, 0::bigint as errors,
        0::bigint as open_errors, 0::bigint as severe_errors, 0::bigint as traces, 0::bigint as failed_traces,
        0::bigint as llm_calls, 0::bigint as failed_llm_calls, 0::numeric as llm_cost_usd
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and user_id = ${userId}
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    scoped_errors as (
      select tenant_id, session_id, timestamp, 0::bigint as events, 1::bigint as errors,
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
        and user_id = ${userId}
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    scoped_traces as (
      select tenant_id, session_id, timestamp, 0::bigint as events, 0::bigint as errors,
        0::bigint as open_errors, 0::bigint as severe_errors, 1::bigint as traces,
        case when status <> 'success' then 1 else 0 end::bigint as failed_traces,
        0::bigint as llm_calls, 0::bigint as failed_llm_calls, 0::numeric as llm_cost_usd
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and user_id = ${userId}
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    scoped_llm_calls as (
      select tenant_id, session_id, timestamp, 0::bigint as events, 0::bigint as errors,
        0::bigint as open_errors, 0::bigint as severe_errors, 0::bigint as traces, 0::bigint as failed_traces,
        1::bigint as llm_calls, case when status <> 'success' then 1 else 0 end::bigint as failed_llm_calls,
        cost_usd as llm_cost_usd
      from llm_calls
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and user_id = ${userId}
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
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
      count(distinct tenant_id) filter (where tenant_id is not null) as active_tenants,
      count(distinct session_id) filter (where session_id is not null) as active_sessions,
      count(*) as total_signals,
      coalesce((
        select traits
        from user_profiles
        where project_id = ${filters.projectId}
          and environment_id = ${filters.environmentId}
          and user_id = ${userId}
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
    userId,
    label: profileLabel(userId, traits, userId),
    traits,
    keyTraits: keyTraits(traits, ["plan", "role", "operation_mode", "status"]),
    isAnonymous: false,
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
    activeTenants: toNumber(row?.active_tenants),
    activeSessions: toNumber(row?.active_sessions)
  };
}

async function queryUserRecentSessions(
  db: Db,
  userId: string,
  filters: UserDetailFilters,
  from: Date,
  to: Date
): Promise<UserRecentSession[]> {
  const rows = await sql<{
    session_id: string;
    tenant_id: string | null;
    events: unknown;
    errors: unknown;
    traces: unknown;
    llm_calls: unknown;
    llm_cost_usd: string;
    first_seen_at: Date | string;
    last_seen_at: Date | string;
  }>`
    with scoped_rows as (
      select session_id, tenant_id, timestamp, 1::bigint as events, 0::bigint as errors, 0::bigint as traces,
        0::bigint as llm_calls, 0::numeric as llm_cost_usd
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and user_id = ${userId}
        and session_id is not null
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select session_id, tenant_id, timestamp, 0::bigint as events, 1::bigint as errors, 0::bigint as traces,
        0::bigint as llm_calls, 0::numeric as llm_cost_usd
      from errors
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and user_id = ${userId}
        and session_id is not null
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select session_id, tenant_id, timestamp, 0::bigint as events, 0::bigint as errors, 1::bigint as traces,
        0::bigint as llm_calls, 0::numeric as llm_cost_usd
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and user_id = ${userId}
        and session_id is not null
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select session_id, tenant_id, timestamp, 0::bigint as events, 0::bigint as errors, 0::bigint as traces,
        1::bigint as llm_calls, cost_usd as llm_cost_usd
      from llm_calls
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and user_id = ${userId}
        and session_id is not null
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    aggregated as (
      select session_id, max(tenant_id) as tenant_id, sum(events) as events, sum(errors) as errors,
        sum(traces) as traces, sum(llm_calls) as llm_calls, coalesce(sum(llm_cost_usd), 0)::text as llm_cost_usd,
        min(timestamp) as first_seen_at, max(timestamp) as last_seen_at,
        sum(events + errors + traces + llm_calls) as total_signals
      from scoped_rows
      group by session_id
    )
    select session_id, tenant_id, events, errors, traces, llm_calls, llm_cost_usd, first_seen_at, last_seen_at
    from aggregated
    order by last_seen_at desc, total_signals desc, session_id asc
    limit 10
  `.execute(db);

  return rows.rows.map((row) => ({
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    events: toNumber(row.events),
    errors: toNumber(row.errors),
    traces: toNumber(row.traces),
    llmCalls: toNumber(row.llm_calls),
    llmCostUsd: row.llm_cost_usd,
    firstSeenAt: toIso(row.first_seen_at),
    lastSeenAt: toIso(row.last_seen_at)
  }));
}

async function queryUserTimeline(
  db: Db,
  userId: string,
  filters: UserDetailFilters,
  from: Date,
  to: Date,
  limit: number
): Promise<UserTimelineRow[]> {
  const cursor = filters.cursor;
  const rows = await sql<{
    type: UserSignalType;
    id: string;
    timestamp: Date | string;
    label: string;
    tenant_id: string | null;
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
      select 'event'::text as type, id, timestamp, name as label, tenant_id, session_id, trace_id,
        name as event_name, null::text as severity, null::text as status, null::text as message,
        null::integer as duration_ms, null::text as trace_name, null::text as provider, null::text as model,
        null::text as prompt_name, null::text as cost_usd
      from events
      where (${filters.signalType ?? null}::text is null or ${filters.signalType ?? ""} = 'event')
        and project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and user_id = ${userId}
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select 'error'::text as type, id, timestamp, message as label, tenant_id, session_id, trace_id,
        null::text as event_name, severity, status, message, null::integer as duration_ms, null::text as trace_name,
        null::text as provider, null::text as model, null::text as prompt_name, null::text as cost_usd
      from errors
      where (${filters.signalType ?? null}::text is null or ${filters.signalType ?? ""} = 'error')
        and project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and user_id = ${userId}
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select 'trace'::text as type, id, timestamp, name as label, tenant_id, session_id, trace_id,
        null::text as event_name, null::text as severity, status, null::text as message, duration_ms, name as trace_name,
        null::text as provider, null::text as model, null::text as prompt_name, null::text as cost_usd
      from traces
      where (${filters.signalType ?? null}::text is null or ${filters.signalType ?? ""} = 'trace')
        and project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and user_id = ${userId}
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select 'llm'::text as type, id, timestamp, provider || ' / ' || model as label, tenant_id, session_id, trace_id,
        null::text as event_name, null::text as severity, status, null::text as message, null::integer as duration_ms,
        null::text as trace_name, provider, model, prompt_name, cost_usd::text as cost_usd
      from llm_calls
      where (${filters.signalType ?? null}::text is null or ${filters.signalType ?? ""} = 'llm')
        and project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and user_id = ${userId}
        and (${filters.tenantId ?? null}::text is null or tenant_id = ${filters.tenantId ?? ""})
        and timestamp >= ${from}
        and timestamp <= ${to}
    )
    select type, id, timestamp, label, tenant_id, session_id, trace_id, event_name, severity, status, message,
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

  return rows.rows.map((row): UserTimelineRow => {
    const base = {
      id: row.id,
      timestamp: toIso(row.timestamp),
      label: row.label,
      tenantId: row.tenant_id,
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
