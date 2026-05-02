import type { Selectable } from "kysely";
import { sql } from "kysely";
import type { Db } from "../client.js";
import type { ErrorsTable, EventsTable, LlmCallsTable, SpansTable, TracesTable } from "../schema.js";

type EventRow = Selectable<EventsTable>;
type ErrorRow = Selectable<ErrorsTable>;
type LlmCallRow = Selectable<LlmCallsTable>;
type TraceRow = Selectable<TracesTable>;
type SpanRow = Selectable<SpansTable>;

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

export interface CountAggregate {
  total: number;
}

export interface ErrorAggregates extends CountAggregate {
  open: number;
}

export interface TraceAggregates extends CountAggregate {
  averageDurationMs: number;
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

export interface ErrorRecord {
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
  message: string;
  type: string | null;
  severity: string;
  stack: string | null;
  status: string;
  fingerprint: string | null;
  context: unknown;
}

function toError(row: ErrorRow): ErrorRecord {
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
    message: row.message,
    type: row.type,
    severity: row.severity,
    stack: row.stack,
    status: row.status,
    fingerprint: row.fingerprint,
    context: row.context
  };
}

export interface LlmCallRecord {
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
  provider: string;
  model: string;
  promptName: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  latencyMs: number | null;
  status: string;
  error: string | null;
  inputPreview: string | null;
  outputPreview: string | null;
}

function toLlmCall(row: LlmCallRow): LlmCallRecord {
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
    provider: row.provider,
    model: row.model,
    promptName: row.prompt_name,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    latencyMs: row.latency_ms,
    status: row.status,
    error: row.error,
    inputPreview: row.input_preview,
    outputPreview: row.output_preview
  };
}

export interface TraceRecord {
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
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
}

function toTrace(row: TraceRow): TraceRecord {
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
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms
  };
}

export interface SpanRecord {
  id: string;
  projectId: string;
  environmentId: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string;
  timestamp: Date;
  receivedAt: Date;
  source: string | null;
  release: string | null;
  metadata: unknown;
  parentSpanId: string | null;
  name: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
  input: unknown | null;
  output: unknown | null;
  error: unknown | null;
  costUsd: string | null;
}

function toSpan(row: SpanRow): SpanRecord {
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
    parentSpanId: row.parent_span_id,
    name: row.name,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    input: row.input,
    output: row.output,
    error: row.error,
    costUsd: row.cost_usd
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

export async function listErrors(db: Db, filters: TelemetryFilters): Promise<ErrorRecord[]> {
  let query = db
    .selectFrom("errors")
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
  return rows.map(toError);
}

export async function listLlmCalls(db: Db, filters: TelemetryFilters): Promise<LlmCallRecord[]> {
  let query = db
    .selectFrom("llm_calls")
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
  return rows.map(toLlmCall);
}

export async function listTraces(db: Db, filters: TelemetryFilters): Promise<TraceRecord[]> {
  let query = db
    .selectFrom("traces")
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
  return rows.map(toTrace);
}

export async function listTraceSpans(db: Db, filters: TelemetryFilters): Promise<SpanRecord[]> {
  let query = db
    .selectFrom("spans")
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
  return rows.map(toSpan);
}

export async function getEventAggregates(db: Db, filters: TelemetryFilters): Promise<CountAggregate & { byName: Record<string, number> }> {
  let totalQuery = db
    .selectFrom("events")
    .select(sql<unknown>`count(*)`.as("total"))
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId);

  let byNameQuery = db
    .selectFrom("events")
    .select(["name", sql<unknown>`count(*)`.as("total")])
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId)
    .groupBy("name");

  if (filters.tenantId) {
    totalQuery = totalQuery.where("tenant_id", "=", filters.tenantId);
    byNameQuery = byNameQuery.where("tenant_id", "=", filters.tenantId);
  }
  if (filters.userId) {
    totalQuery = totalQuery.where("user_id", "=", filters.userId);
    byNameQuery = byNameQuery.where("user_id", "=", filters.userId);
  }
  if (filters.sessionId) {
    totalQuery = totalQuery.where("session_id", "=", filters.sessionId);
    byNameQuery = byNameQuery.where("session_id", "=", filters.sessionId);
  }
  if (filters.traceId) {
    totalQuery = totalQuery.where("trace_id", "=", filters.traceId);
    byNameQuery = byNameQuery.where("trace_id", "=", filters.traceId);
  }
  if (filters.from) {
    totalQuery = totalQuery.where("timestamp", ">=", filters.from);
    byNameQuery = byNameQuery.where("timestamp", ">=", filters.from);
  }
  if (filters.to) {
    totalQuery = totalQuery.where("timestamp", "<", filters.to);
    byNameQuery = byNameQuery.where("timestamp", "<", filters.to);
  }

  const totalRow = await totalQuery.executeTakeFirstOrThrow();
  const byNameRows = await byNameQuery.execute();

  return {
    total: toNumber(totalRow.total),
    byName: Object.fromEntries(byNameRows.map((row) => [row.name, toNumber(row.total)]))
  };
}

export async function getErrorAggregates(db: Db, filters: TelemetryFilters): Promise<ErrorAggregates> {
  let query = db
    .selectFrom("errors")
    .select([
      sql<unknown>`count(*)`.as("total"),
      sql<unknown>`count(*) filter (where status = 'open')`.as("open")
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
  return { total: toNumber(row.total), open: toNumber(row.open) };
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

export async function getTraceAggregates(db: Db, filters: TelemetryFilters): Promise<TraceAggregates> {
  let query = db
    .selectFrom("traces")
    .select([
      sql<unknown>`count(*)`.as("total"),
      sql<unknown>`coalesce(avg(duration_ms), 0)`.as("average_duration_ms")
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
    total: toNumber(row.total),
    averageDurationMs: toNumber(row.average_duration_ms)
  };
}
