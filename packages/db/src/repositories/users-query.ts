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
  }>`
    with scoped_events as (
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
        )
    ),
    all_rows as (
      select * from scoped_events
      union all select * from scoped_errors
      union all select * from scoped_traces
      union all select * from scoped_llm_calls
    )
    select user_id, max(timestamp) as last_seen_at, sum(events) as events, sum(errors) as errors,
      sum(open_errors) as open_errors, sum(severe_errors) as severe_errors, sum(traces) as traces,
      sum(failed_traces) as failed_traces, sum(llm_calls) as llm_calls, sum(failed_llm_calls) as failed_llm_calls,
      coalesce(sum(llm_cost_usd), 0)::text as llm_cost_usd,
      count(distinct tenant_id) filter (where tenant_id is not null) as active_tenants,
      count(distinct session_id) filter (where session_id is not null) as active_sessions
    from all_rows
    group by user_id
  `.execute(db);

  const users = rows.rows.map((row): UserSummary => {
    const errors = toNumber(row.errors);
    const openErrors = toNumber(row.open_errors);
    const severeErrors = toNumber(row.severe_errors);
    const failedTraces = toNumber(row.failed_traces);
    const failedLlmCalls = toNumber(row.failed_llm_calls);
    const llmCostUsd = row.llm_cost_usd;
    return {
      userId: row.user_id,
      label: userLabel(row.user_id),
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
