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
  eventName?: string;
  provider?: string;
  model?: string;
  promptName?: string;
  severity?: string;
  status?: string;
  fingerprint?: string;
  errorGroupId?: string;
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

export type OverviewWindow = "24h" | "7d" | "30d";
export type OverviewTrendBucket = "hour" | "day";

export interface OverviewFilters {
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
  now?: Date;
}

export type OverviewRecentError = {
  id: string;
  timestamp: string;
  message: string;
  type: string | null;
  severity: string;
  status: string;
  tenantId: string | null;
  userId: string | null;
  traceId: string | null;
};

export type OverviewRecentTrace = {
  id: string;
  timestamp: string;
  name: string;
  status: string;
  durationMs: number | null;
  tenantId: string | null;
  userId: string | null;
};

export type OverviewRecentLlmCall = {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  promptName: string | null;
  status: string;
  costUsd: string;
  tenantId: string | null;
  userId: string | null;
  traceId: string | null;
};

export type OverviewResponse = {
  window: OverviewWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
    bucket: OverviewTrendBucket;
  };
  kpis: {
    events: number;
    activeUsers: number;
    activeTenants: number;
    errors: number;
    openErrors: number;
    traces: number;
    failedTraces: number;
    averageTraceDurationMs: number;
    p95TraceDurationMs: number | null;
    llmCalls: number;
    failedLlmCalls: number;
    llmInputTokens: number;
    llmOutputTokens: number;
    llmCostUsd: string;
  };
  trends: {
    usage: Array<{ bucketStart: string; events: number; traces: number; llmCalls: number }>;
    errors: Array<{ bucketStart: string; errors: number; openErrors: number; severeErrors: number }>;
    latency: Array<{ bucketStart: string; averageTraceDurationMs: number; p95TraceDurationMs: number | null }>;
    aiCost: Array<{ bucketStart: string; llmCostUsd: string; llmCalls: number }>;
  };
  top: {
    events: Array<{ name: string; total: number }>;
    tenantsByUsage: Array<{ tenantId: string; total: number }>;
    tenantsByErrors: Array<{ tenantId: string; total: number }>;
    tenantsByLlmCalls: Array<{ tenantId: string; total: number }>;
    tenantsByLlmCost: Array<{ tenantId: string; totalCostUsd: string }>;
    llmProviders: Array<{ provider: string; total: number; totalCostUsd: string }>;
    llmModels: Array<{ model: string; total: number; totalCostUsd: string }>;
    llmPrompts: Array<{ promptName: string; total: number; totalCostUsd: string }>;
    errorSeverity: Array<{ severity: string; total: number }>;
    errorStatus: Array<{ status: string; total: number }>;
  };
  recent: {
    errors: OverviewRecentError[];
    failedTraces: OverviewRecentTrace[];
    failedLlmCalls: OverviewRecentLlmCall[];
  };
};

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
  errorGroupId: string | null;
  groupingFingerprint: string | null;
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
    errorGroupId: row.error_group_id,
    groupingFingerprint: row.grouping_fingerprint,
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

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toIso(value: Date | string): string {
  return toDate(value).toISOString();
}

function resolveOverviewRange(window: OverviewWindow, now = new Date()) {
  const to = now;
  const from = new Date(to);
  if (window === "24h") {
    from.setHours(from.getHours() - 24);
    return { from, to, bucket: "hour" as const };
  }
  if (window === "7d") {
    from.setDate(from.getDate() - 7);
    return { from, to, bucket: "day" as const };
  }
  from.setDate(from.getDate() - 30);
  return { from, to, bucket: "day" as const };
}

function bucketStep(bucket: OverviewTrendBucket): number {
  return bucket === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

function startOfBucket(date: Date, bucket: OverviewTrendBucket): Date {
  const next = new Date(date);
  next.setUTCMinutes(0, 0, 0);
  if (bucket === "day") {
    next.setUTCHours(0, 0, 0, 0);
  }
  return next;
}

function makeBucketStarts(from: Date, to: Date, bucket: OverviewTrendBucket): string[] {
  const starts: string[] = [];
  const step = bucketStep(bucket);
  let current = startOfBucket(from, bucket);
  while (current <= to) {
    starts.push(current.toISOString());
    current = new Date(current.getTime() + step);
  }
  return starts;
}

function bucketExpression(bucket: OverviewTrendBucket, column = "timestamp") {
  return bucket === "hour"
    ? sql<string>`to_char(date_trunc('hour', ${sql.ref(column)} at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
    : sql<string>`to_char(date_trunc('day', ${sql.ref(column)} at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
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
  if (filters.eventName) query = query.where("name", "=", filters.eventName);
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
  if (filters.severity) query = query.where("severity", "=", filters.severity);
  if (filters.status) query = query.where("status", "=", filters.status);
  if (filters.fingerprint) query = query.where("fingerprint", "=", filters.fingerprint);
  if (filters.errorGroupId) query = query.where("error_group_id", "=", filters.errorGroupId);
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
  if (filters.provider) query = query.where("provider", "=", filters.provider);
  if (filters.model) query = query.where("model", "=", filters.model);
  if (filters.promptName) query = query.where("prompt_name", "=", filters.promptName);
  if (filters.status) query = query.where("status", "=", filters.status);
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
  if (filters.provider) query = query.where("provider", "=", filters.provider);
  if (filters.model) query = query.where("model", "=", filters.model);
  if (filters.promptName) query = query.where("prompt_name", "=", filters.promptName);
  if (filters.status) query = query.where("status", "=", filters.status);
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

export async function getOverview(db: Db, filters: OverviewFilters): Promise<OverviewResponse> {
  const { from, to, bucket } = resolveOverviewRange(filters.window, filters.now);
  const bucketExpr = bucketExpression(bucket);
  const bucketStarts = makeBucketStarts(from, to, bucket);

  const kpiRows = await sql<{
    events: unknown;
    active_users: unknown;
    active_tenants: unknown;
    errors: unknown;
    open_errors: unknown;
    traces: unknown;
    failed_traces: unknown;
    average_trace_duration_ms: unknown;
    p95_trace_duration_ms: unknown;
    llm_calls: unknown;
    failed_llm_calls: unknown;
    llm_input_tokens: unknown;
    llm_output_tokens: unknown;
    llm_cost_usd: string;
  }>`
    with scoped_events as (
      select user_id, tenant_id
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    scoped_errors as (
      select user_id, tenant_id, status
      from errors
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    scoped_traces as (
      select user_id, tenant_id, status, duration_ms
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    scoped_llm_calls as (
      select user_id, tenant_id, status, input_tokens, output_tokens, cost_usd
      from llm_calls
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    ),
    identities as (
      select user_id, tenant_id from scoped_events
      union all select user_id, tenant_id from scoped_errors
      union all select user_id, tenant_id from scoped_traces
      union all select user_id, tenant_id from scoped_llm_calls
    )
    select
      (select count(*) from scoped_events) as events,
      (select count(distinct user_id) from identities where user_id is not null) as active_users,
      (select count(distinct tenant_id) from identities where tenant_id is not null) as active_tenants,
      (select count(*) from scoped_errors) as errors,
      (select count(*) from scoped_errors where status = 'open') as open_errors,
      (select count(*) from scoped_traces) as traces,
      (select count(*) from scoped_traces where status <> 'success') as failed_traces,
      (select coalesce(avg(duration_ms), 0) from scoped_traces) as average_trace_duration_ms,
      (select percentile_cont(0.95) within group (order by duration_ms) from scoped_traces where duration_ms is not null) as p95_trace_duration_ms,
      (select count(*) from scoped_llm_calls) as llm_calls,
      (select count(*) from scoped_llm_calls where status <> 'success') as failed_llm_calls,
      (select coalesce(sum(input_tokens), 0) from scoped_llm_calls) as llm_input_tokens,
      (select coalesce(sum(output_tokens), 0) from scoped_llm_calls) as llm_output_tokens,
      (select coalesce(sum(cost_usd), 0)::text from scoped_llm_calls) as llm_cost_usd
  `.execute(db);
  const kpiRow = kpiRows.rows[0];

  const usageTrendRows = await sql<{
    bucket_start: Date | string;
    events: unknown;
    traces: unknown;
    llm_calls: unknown;
  }>`
    with usage_rows as (
      select ${bucketExpr} as bucket_start, count(*) as events, 0::bigint as traces, 0::bigint as llm_calls
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
      group by bucket_start
      union all
      select ${bucketExpr} as bucket_start, 0::bigint as events, count(*) as traces, 0::bigint as llm_calls
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
      group by bucket_start
      union all
      select ${bucketExpr} as bucket_start, 0::bigint as events, 0::bigint as traces, count(*) as llm_calls
      from llm_calls
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
      group by bucket_start
    )
    select bucket_start, sum(events) as events, sum(traces) as traces, sum(llm_calls) as llm_calls
    from usage_rows
    group by bucket_start
  `.execute(db);

  const errorTrendRows = await sql<{
    bucket_start: Date | string;
    errors: unknown;
    open_errors: unknown;
    severe_errors: unknown;
  }>`
    select
      ${bucketExpr} as bucket_start,
      count(*) as errors,
      count(*) filter (where status = 'open') as open_errors,
      count(*) filter (where severity in ('fatal', 'critical', 'error')) as severe_errors
    from errors
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
    group by bucket_start
  `.execute(db);

  const latencyTrendRows = await sql<{
    bucket_start: Date | string;
    average_trace_duration_ms: unknown;
    p95_trace_duration_ms: unknown;
  }>`
    select
      ${bucketExpr} as bucket_start,
      coalesce(avg(duration_ms), 0) as average_trace_duration_ms,
      percentile_cont(0.95) within group (order by duration_ms) as p95_trace_duration_ms
    from traces
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
    group by bucket_start
  `.execute(db);

  const aiCostTrendRows = await sql<{
    bucket_start: Date | string;
    llm_cost_usd: string;
    llm_calls: unknown;
  }>`
    select
      ${bucketExpr} as bucket_start,
      coalesce(sum(cost_usd), 0)::text as llm_cost_usd,
      count(*) as llm_calls
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
    group by bucket_start
  `.execute(db);

  const usageByBucket = new Map(usageTrendRows.rows.map((row) => [toIso(row.bucket_start), row]));
  const errorsByBucket = new Map(errorTrendRows.rows.map((row) => [toIso(row.bucket_start), row]));
  const latencyByBucket = new Map(latencyTrendRows.rows.map((row) => [toIso(row.bucket_start), row]));
  const aiCostByBucket = new Map(aiCostTrendRows.rows.map((row) => [toIso(row.bucket_start), row]));

  const topEventsRows = await sql<{ name: string; total: unknown }>`
    select name, count(*) as total
    from events
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
    group by name
    order by total desc, name asc
    limit 5
  `.execute(db);

  const tenantsByUsageRows = await sql<{ tenant_id: string; total: unknown }>`
    with usage_rows as (
      select tenant_id from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select tenant_id from errors
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select tenant_id from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
      union all
      select tenant_id from llm_calls
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
    )
    select tenant_id, count(*) as total
    from usage_rows
    where tenant_id is not null
    group by tenant_id
    order by total desc, tenant_id asc
    limit 5
  `.execute(db);

  const tenantsByErrorsRows = await sql<{ tenant_id: string; total: unknown }>`
    select tenant_id, count(*) as total
    from errors
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
      and tenant_id is not null
    group by tenant_id
    order by total desc, tenant_id asc
    limit 5
  `.execute(db);

  const tenantsByLlmCallsRows = await sql<{ tenant_id: string; total: unknown }>`
    select tenant_id, count(*) as total
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
      and tenant_id is not null
    group by tenant_id
    order by total desc, tenant_id asc
    limit 5
  `.execute(db);

  const tenantsByLlmCostRows = await sql<{ tenant_id: string; total_cost_usd: string }>`
    select tenant_id, coalesce(sum(cost_usd), 0)::text as total_cost_usd
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
      and tenant_id is not null
    group by tenant_id
    order by sum(cost_usd) desc, tenant_id asc
    limit 5
  `.execute(db);

  const llmProvidersRows = await sql<{ provider: string; total: unknown; total_cost_usd: string }>`
    select provider, count(*) as total, coalesce(sum(cost_usd), 0)::text as total_cost_usd
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
    group by provider
    order by total desc, sum(cost_usd) desc, provider asc
    limit 5
  `.execute(db);

  const llmModelsRows = await sql<{ model: string; total: unknown; total_cost_usd: string }>`
    select model, count(*) as total, coalesce(sum(cost_usd), 0)::text as total_cost_usd
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
    group by model
    order by total desc, sum(cost_usd) desc, model asc
    limit 5
  `.execute(db);

  const llmPromptsRows = await sql<{ prompt_name: string; total: unknown; total_cost_usd: string }>`
    select coalesce(prompt_name, 'Unspecified') as prompt_name, count(*) as total, coalesce(sum(cost_usd), 0)::text as total_cost_usd
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
    group by coalesce(prompt_name, 'Unspecified')
    order by total desc, prompt_name asc
    limit 5
  `.execute(db);

  const errorSeverityRows = await sql<{ severity: string; total: unknown }>`
    select severity, count(*) as total
    from errors
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
    group by severity
    order by total desc, severity asc
    limit 5
  `.execute(db);

  const errorStatusRows = await sql<{ status: string; total: unknown }>`
    select status, count(*) as total
    from errors
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
    group by status
    order by total desc, status asc
    limit 5
  `.execute(db);

  const recentErrorRows = await sql<{
    id: string;
    timestamp: Date | string;
    message: string;
    type: string | null;
    severity: string;
    status: string;
    tenant_id: string | null;
    user_id: string | null;
    trace_id: string | null;
  }>`
    select id, timestamp, message, type, severity, status, tenant_id, user_id, trace_id
    from errors
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
    order by timestamp desc, id asc
    limit 5
  `.execute(db);

  const recentFailedTraceRows = await sql<{
    id: string;
    timestamp: Date | string;
    name: string;
    status: string;
    duration_ms: number | null;
    tenant_id: string | null;
    user_id: string | null;
  }>`
    select id, timestamp, name, status, duration_ms, tenant_id, user_id
    from traces
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
      and status <> 'success'
    order by timestamp desc, id asc
    limit 5
  `.execute(db);

  const recentFailedLlmCallRows = await sql<{
    id: string;
    timestamp: Date | string;
    provider: string;
    model: string;
    prompt_name: string;
    status: string;
    cost_usd: string;
    tenant_id: string | null;
    user_id: string | null;
    trace_id: string | null;
  }>`
    select id, timestamp, provider, model, coalesce(prompt_name, 'Unspecified') as prompt_name, status, cost_usd::text as cost_usd, tenant_id, user_id, trace_id
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
      and status <> 'success'
    order by timestamp desc, id asc
    limit 5
  `.execute(db);

  const trends: OverviewResponse["trends"] = {
    usage: bucketStarts.map((bucketStart) => {
      const row = usageByBucket.get(bucketStart);
      return {
        bucketStart,
        events: toNumber(row?.events),
        traces: toNumber(row?.traces),
        llmCalls: toNumber(row?.llm_calls)
      };
    }),
    errors: bucketStarts.map((bucketStart) => {
      const row = errorsByBucket.get(bucketStart);
      return {
        bucketStart,
        errors: toNumber(row?.errors),
        openErrors: toNumber(row?.open_errors),
        severeErrors: toNumber(row?.severe_errors)
      };
    }),
    latency: bucketStarts.map((bucketStart) => {
      const row = latencyByBucket.get(bucketStart);
      return {
        bucketStart,
        averageTraceDurationMs: toNumber(row?.average_trace_duration_ms),
        p95TraceDurationMs: row?.p95_trace_duration_ms == null ? null : toNumber(row.p95_trace_duration_ms)
      };
    }),
    aiCost: bucketStarts.map((bucketStart) => {
      const row = aiCostByBucket.get(bucketStart);
      return {
        bucketStart,
        llmCostUsd: row?.llm_cost_usd ?? "0",
        llmCalls: toNumber(row?.llm_calls)
      };
    })
  };

  return {
    window: filters.window,
    generatedAt: to.toISOString(),
    scope: {
      projectId: filters.projectId,
      environmentId: filters.environmentId
    },
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      bucket
    },
    kpis: {
      events: toNumber(kpiRow.events),
      activeUsers: toNumber(kpiRow.active_users),
      activeTenants: toNumber(kpiRow.active_tenants),
      errors: toNumber(kpiRow.errors),
      openErrors: toNumber(kpiRow.open_errors),
      traces: toNumber(kpiRow.traces),
      failedTraces: toNumber(kpiRow.failed_traces),
      averageTraceDurationMs: toNumber(kpiRow.average_trace_duration_ms),
      p95TraceDurationMs: kpiRow.p95_trace_duration_ms == null ? null : toNumber(kpiRow.p95_trace_duration_ms),
      llmCalls: toNumber(kpiRow.llm_calls),
      failedLlmCalls: toNumber(kpiRow.failed_llm_calls),
      llmInputTokens: toNumber(kpiRow.llm_input_tokens),
      llmOutputTokens: toNumber(kpiRow.llm_output_tokens),
      llmCostUsd: kpiRow.llm_cost_usd
    },
    trends,
    top: {
      events: topEventsRows.rows.map((row) => ({ name: row.name, total: toNumber(row.total) })),
      tenantsByUsage: tenantsByUsageRows.rows.map((row) => ({ tenantId: row.tenant_id, total: toNumber(row.total) })),
      tenantsByErrors: tenantsByErrorsRows.rows.map((row) => ({ tenantId: row.tenant_id, total: toNumber(row.total) })),
      tenantsByLlmCalls: tenantsByLlmCallsRows.rows.map((row) => ({ tenantId: row.tenant_id, total: toNumber(row.total) })),
      tenantsByLlmCost: tenantsByLlmCostRows.rows.map((row) => ({
        tenantId: row.tenant_id,
        totalCostUsd: row.total_cost_usd
      })),
      llmProviders: llmProvidersRows.rows.map((row) => ({
        provider: row.provider,
        total: toNumber(row.total),
        totalCostUsd: row.total_cost_usd
      })),
      llmModels: llmModelsRows.rows.map((row) => ({
        model: row.model,
        total: toNumber(row.total),
        totalCostUsd: row.total_cost_usd
      })),
      llmPrompts: llmPromptsRows.rows.map((row) => ({
        promptName: row.prompt_name,
        total: toNumber(row.total),
        totalCostUsd: row.total_cost_usd
      })),
      errorSeverity: errorSeverityRows.rows.map((row) => ({ severity: row.severity, total: toNumber(row.total) })),
      errorStatus: errorStatusRows.rows.map((row) => ({ status: row.status, total: toNumber(row.total) }))
    },
    recent: {
      errors: recentErrorRows.rows.map((row) => ({
        id: row.id,
        timestamp: toIso(row.timestamp),
        message: row.message,
        type: row.type,
        severity: row.severity,
        status: row.status,
        tenantId: row.tenant_id,
        userId: row.user_id,
        traceId: row.trace_id
      })),
      failedTraces: recentFailedTraceRows.rows.map((row) => ({
        id: row.id,
        timestamp: toIso(row.timestamp),
        name: row.name,
        status: row.status,
        durationMs: row.duration_ms,
        tenantId: row.tenant_id,
        userId: row.user_id
      })),
      failedLlmCalls: recentFailedLlmCallRows.rows.map((row) => ({
        id: row.id,
        timestamp: toIso(row.timestamp),
        provider: row.provider,
        model: row.model,
        promptName: row.prompt_name,
        status: row.status,
        costUsd: row.cost_usd,
        tenantId: row.tenant_id,
        userId: row.user_id,
        traceId: row.trace_id
      }))
    }
  };
}
