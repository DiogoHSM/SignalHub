import type { Selectable } from "kysely";
import { sql } from "kysely";
import type { Db } from "../client.js";
import type { EventsTable } from "../schema.js";

type EventRow = Selectable<EventsTable>;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export interface TelemetryFilters {
  projectId: string;
  environmentId: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface EventRecord {
  id: string;
  projectId: string;
  environmentId: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  timestamp: Date;
  receivedAt: Date;
  source: string | null;
  release: string | null;
  metadata: unknown;
  name: string;
  properties: unknown;
}

export interface LlmAggregates {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string;
}

function toEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    sessionId: row.session_id,
    traceId: row.trace_id,
    timestamp: row.timestamp,
    receivedAt: row.received_at,
    source: row.source,
    release: row.release,
    metadata: row.metadata,
    name: row.name,
    properties: row.properties
  };
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

export async function listEvents(db: Db, filters: TelemetryFilters): Promise<EventRecord[]> {
  let query = db
    .selectFrom("events")
    .selectAll()
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId);

  if (filters.tenantId) query = query.where("tenant_id", "=", filters.tenantId);
  if (filters.userId) query = query.where("user_id", "=", filters.userId);
  if (filters.sessionId) query = query.where("session_id", "=", filters.sessionId);
  if (filters.traceId) query = query.where("trace_id", "=", filters.traceId);
  if (filters.from) query = query.where("timestamp", ">=", filters.from);
  if (filters.to) query = query.where("timestamp", "<", filters.to);

  const rows = await query.orderBy("timestamp", "desc").limit(resolveLimit(filters.limit)).execute();
  return rows.map(toEvent);
}

export async function getLlmAggregates(db: Db, filters: TelemetryFilters): Promise<LlmAggregates> {
  let query = db
    .selectFrom("llm_calls")
    .select([
      sql<unknown>`count(*)`.as("total_calls"),
      sql<unknown>`coalesce(sum(input_tokens), 0)`.as("total_input_tokens"),
      sql<unknown>`coalesce(sum(output_tokens), 0)`.as("total_output_tokens"),
      sql<string>`coalesce(sum(cost_usd), 0)::text`.as("total_cost_usd")
    ])
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId);

  if (filters.tenantId) query = query.where("tenant_id", "=", filters.tenantId);
  if (filters.userId) query = query.where("user_id", "=", filters.userId);
  if (filters.sessionId) query = query.where("session_id", "=", filters.sessionId);
  if (filters.traceId) query = query.where("trace_id", "=", filters.traceId);
  if (filters.from) query = query.where("timestamp", ">=", filters.from);
  if (filters.to) query = query.where("timestamp", "<", filters.to);

  const row = await query.executeTakeFirstOrThrow();

  return {
    totalCalls: toNumber(row.total_calls),
    totalInputTokens: toNumber(row.total_input_tokens),
    totalOutputTokens: toNumber(row.total_output_tokens),
    totalCostUsd: row.total_cost_usd
  };
}
