import type { Selectable } from "kysely";
import { sql } from "kysely";
import { Buffer } from "node:buffer";
import type { Db } from "../client.js";
import type { ErrorsTable, EventsTable, LlmCallsTable, SpansTable, TracesTable } from "../schema.js";
import { getAnalyticsSegment, getAnalyticsSegmentActorIds } from "./analytics-segments.js";

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
  traceName?: string;
  eventName?: string;
  provider?: string;
  model?: string;
  promptName?: string;
  severity?: string;
  status?: string;
  fingerprint?: string;
  errorGroupId?: string;
  segmentId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
}

export type TelemetryListResult<T> = {
  data: T[];
  cursor?: string;
};

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

export interface EventPropertyCatalogItem {
  eventName: string;
  propertyName: string;
  totalOccurrences: number;
  eventCount: number;
  coveragePercent: number;
  dominantType: string;
  typeCounts: Record<string, number>;
  hasTypeConflict: boolean;
  sampleValues: string[];
  similarPropertyNames: string[];
  lastSeenAt: string | null;
}

export interface EventPropertySimilarNameGroup {
  normalizedName: string;
  propertyNames: string[];
  eventNames: string[];
}

export interface EventPropertyCatalogResponse {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  totals: {
    events: number;
    properties: number;
    conflictProperties: number;
    similarNameGroups: number;
  };
  properties: EventPropertyCatalogItem[];
  similarNameGroups: EventPropertySimilarNameGroup[];
}

export interface EventFunnelFilters extends ApmFilters {
  steps: string[];
}

export interface EventFunnelStep {
  index: number;
  name: string;
  actors: number;
  conversionPercent: number;
  dropOffFromPreviousPercent: number;
}

export interface EventFunnelActor {
  actorId: string;
  actorType: "user" | "tenant" | "session" | "trace";
  reachedStepIndex: number;
  reachedStepName: string;
  lastSeenAt: string;
}

export interface EventFunnelResponse {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  totals: {
    entrants: number;
    completed: number;
    conversionPercent: number;
  };
  steps: EventFunnelStep[];
  sampleActors: EventFunnelActor[];
}

export type EventRetentionPeriod = "daily" | "weekly" | "monthly";

export interface EventRetentionFilters extends ApmFilters {
  entryEvent: string;
  returnEvent: string;
  period?: EventRetentionPeriod;
  intervals?: number;
}

export interface EventRetentionInterval {
  index: number;
  label: string;
  retainedActors: number;
  retentionPercent: number;
}

export interface EventRetentionCohort {
  cohortStart: string;
  cohortLabel: string;
  entrants: number;
  intervals: EventRetentionInterval[];
}

export interface EventRetentionResponse {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  entryEvent: string;
  returnEvent: string;
  period: EventRetentionPeriod;
  intervals: number;
  totals: {
    cohorts: number;
    entrants: number;
  };
  cohorts: EventRetentionCohort[];
}

export interface LlmAggregates {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string;
}

export interface LlmAggregateFilters {
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
}

export interface LlmSummary {
  calls: number;
  failedCalls: number;
  costUsd: string;
  avgTokens: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface LlmTenantRow {
  tenantId: string;
  calls: number;
  failedCalls: number;
  costUsd: string;
  avgTokens: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface LlmPromptRow {
  promptName: string;
  model: string;
  calls: number;
  failedCalls: number;
  costUsd: string;
  avgTokens: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
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

export type ApmWindow = OverviewWindow;

export interface ApmFilters {
  projectId: string;
  environmentId: string;
  window: ApmWindow;
  now?: Date;
  limit?: number;
}

export interface ApmEndpointRow {
  name: string;
  requests: number;
  errors: number;
  errorRatePercent: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  p99DurationMs: number | null;
  averageDurationMs: number | null;
  apdex: number | null;
  lastSeenAt: string | null;
}

export interface ApmEndpointsResponse {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  totals: {
    endpoints: number;
    requests: number;
    errors: number;
    errorRatePercent: number | null;
    p95DurationMs: number | null;
    apdex: number | null;
  };
  endpoints: ApmEndpointRow[];
}

export interface ServiceMapEdge {
  source: string;
  target: string;
  dependencyType: string;
  spans: number;
  traces: number;
  errors: number;
  errorRatePercent: number | null;
  averageDurationMs: number | null;
  p95DurationMs: number | null;
  lastSeenAt: string | null;
}

export interface ServiceMapResponse {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  totals: {
    services: number;
    edges: number;
    spans: number;
    errors: number;
    errorRatePercent: number | null;
  };
  edges: ServiceMapEdge[];
}

export interface WebVitalMetricRow {
  name: "CLS" | "FCP" | "FID" | "INP" | "LCP" | "TTFB";
  route: string;
  samples: number;
  good: number;
  needsImprovement: number;
  poor: number;
  averageValue: number | null;
  p75Value: number | null;
  latestRelease: string | null;
  latestReleaseP75Value: number | null;
  previousRelease: string | null;
  previousReleaseP75Value: number | null;
  regressionPercent: number | null;
  lastSeenAt: string | null;
}

export interface WebVitalsResponse {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  totals: {
    samples: number;
    routes: number;
    releases: number;
    poorSamples: number;
    p75LcpMs: number | null;
    p75InpMs: number | null;
    p75Cls: number | null;
  };
  metrics: WebVitalMetricRow[];
}

export interface RuntimeProfileRow {
  id: string;
  name: string;
  kind: "cpu" | "memory";
  runtime: string;
  service: string | null;
  route: string | null;
  traceId: string | null;
  source: string | null;
  release: string | null;
  startedAt: string;
  durationMs: number | null;
  sampleCount: number;
  cpuUsagePercent: number | null;
  heapUsedBytes: number | null;
  rssBytes: number | null;
  topFunction: string | null;
  topFunctionSelfTimeMs: number | null;
}

export interface RuntimeProfileHotFunctionRow {
  functionName: string;
  url: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  selfTimeMs: number;
  totalTimeMs: number | null;
  sampleCount: number;
  profileCount: number;
  lastSeenAt: string | null;
}

export interface RuntimeProfilesResponse {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  totals: {
    profiles: number;
    cpuProfiles: number;
    memoryProfiles: number;
    samples: number;
    avgCpuUsagePercent: number | null;
    maxHeapUsedBytes: number | null;
    p95DurationMs: number | null;
  };
  profiles: RuntimeProfileRow[];
  hotFunctions: RuntimeProfileHotFunctionRow[];
}

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

export type ErrorForSourceMapResolution = {
  id: string;
  projectId: string;
  environmentId: string;
  release: string | null;
  stack: string | null;
};

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

export async function getErrorForSourceMapResolution(
  db: Db,
  input: { id: string; projectId: string; environmentId: string }
): Promise<ErrorForSourceMapResolution | null> {
  const row = await db
    .selectFrom("errors")
    .innerJoin("projects", "projects.id", "errors.project_id")
    .innerJoin("environments", (join) =>
      join.onRef("environments.project_id", "=", "errors.project_id").onRef("environments.id", "=", "errors.environment_id")
    )
    .select(["errors.id", "errors.project_id", "errors.environment_id", "errors.release", "errors.stack"])
    .where("errors.id", "=", input.id)
    .where("errors.project_id", "=", input.projectId)
    .where("errors.environment_id", "=", input.environmentId)
    .where("projects.archived_at", "is", null)
    .where("environments.archived_at", "is", null)
    .executeTakeFirst();

  return row
    ? {
        id: row.id,
        projectId: row.project_id,
        environmentId: row.environment_id,
        release: row.release,
        stack: row.stack
      }
    : null;
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

function toFiniteSafeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      return null;
    }
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER ? parsed : null;
}

function toNumber(value: unknown): number {
  return toFiniteSafeNumber(value) ?? 0;
}

function toRoundedOrNull(value: unknown): number | null {
  const n = toFiniteSafeNumber(value);
  return n === null ? null : Math.round(n);
}

function toNullableNumber(value: unknown): number | null {
  return toFiniteSafeNumber(value);
}

export function buildBucketAxis(from: Date, to: Date, bucket: OverviewTrendBucket): string[] {
  const stepHours = bucket === "hour" ? 1 : 24;
  const start = new Date(from);
  start.setUTCMinutes(0, 0, 0);
  if (bucket === "day") {
    start.setUTCHours(0, 0, 0, 0);
  }
  const axis: string[] = [];
  const cursor = new Date(start);
  while (cursor <= to) {
    const yyyy = cursor.getUTCFullYear().toString().padStart(4, "0");
    const mm = (cursor.getUTCMonth() + 1).toString().padStart(2, "0");
    const dd = cursor.getUTCDate().toString().padStart(2, "0");
    const hh = bucket === "hour" ? cursor.getUTCHours().toString().padStart(2, "0") : "00";
    axis.push(`${yyyy}-${mm}-${dd}T${hh}:00:00.000Z`);
    cursor.setUTCHours(cursor.getUTCHours() + stepHours);
  }
  return axis;
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

type TimestampCursor = {
  projectId: string;
  environmentId: string;
  filterKey: string;
  timestamp: Date;
  id: string;
};

function telemetryCursorFilterKey(filters: TelemetryFilters): string {
  return JSON.stringify({
    tenantId: filters.tenantId ?? null,
    userId: filters.userId ?? null,
    sessionId: filters.sessionId ?? null,
    traceId: filters.traceId ?? null,
    eventName: filters.eventName ?? null,
    provider: filters.provider ?? null,
    model: filters.model ?? null,
    promptName: filters.promptName ?? null,
    severity: filters.severity ?? null,
    status: filters.status ?? null,
    fingerprint: filters.fingerprint ?? null,
    errorGroupId: filters.errorGroupId ?? null,
    from: filters.from?.toISOString() ?? null,
    to: filters.to?.toISOString() ?? null
  });
}

function encodeTimestampCursor(filters: TelemetryFilters, row: { id: string; timestamp: Date | string }): string {
  return Buffer.from(
    JSON.stringify({
      projectId: filters.projectId,
      environmentId: filters.environmentId,
      filterKey: telemetryCursorFilterKey(filters),
      timestamp: toIso(row.timestamp),
      id: row.id
    })
  ).toString("base64url");
}

function decodeTimestampCursor(filters: TelemetryFilters): TimestampCursor | undefined {
  if (!filters.cursor) {
    return undefined;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(filters.cursor, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid_cursor");
  }

  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("invalid_cursor");
  }

  const cursor = decoded as Record<string, unknown>;
  const projectId = typeof cursor.projectId === "string" ? cursor.projectId : "";
  const environmentId = typeof cursor.environmentId === "string" ? cursor.environmentId : "";
  const filterKey = typeof cursor.filterKey === "string" ? cursor.filterKey : "";
  const timestamp = typeof cursor.timestamp === "string" ? new Date(cursor.timestamp) : null;
  const id = typeof cursor.id === "string" ? cursor.id : "";

  if (!projectId || !environmentId || !filterKey || !timestamp || Number.isNaN(timestamp.getTime()) || !id) {
    throw new Error("invalid_cursor");
  }
  if (
    projectId !== filters.projectId ||
    environmentId !== filters.environmentId ||
    filterKey !== telemetryCursorFilterKey(filters)
  ) {
    throw new Error("invalid_cursor_scope");
  }

  return { projectId, environmentId, filterKey, timestamp, id };
}

function listResult<Row extends { id: string; timestamp: Date | string }, T>(
  filters: TelemetryFilters,
  rows: Row[],
  map: (row: Row) => T
): TelemetryListResult<T> {
  const limit = resolveLimit(filters.limit);
  const dataRows = rows.slice(0, limit);
  const lastRow = dataRows[dataRows.length - 1];
  return {
    data: dataRows.map(map),
    ...(rows.length > limit && lastRow ? { cursor: encodeTimestampCursor(filters, lastRow) } : {})
  };
}

export async function listEvents(db: Db, filters: TelemetryFilters): Promise<TelemetryListResult<EventRecord>> {
  const cursor = decodeTimestampCursor(filters);
  const limit = resolveLimit(filters.limit);
  let query = db
    .selectFrom("events")
    .selectAll()
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId);

  if (filters.tenantId) query = query.where("tenant_id", "=", filters.tenantId);
  if (filters.userId) query = query.where("user_id", "=", filters.userId);
  if (filters.sessionId) query = query.where("session_id", "=", filters.sessionId);
  if (filters.traceId) query = query.where("trace_id", "=", filters.traceId);
  const traceName = filters.traceName ?? filters.eventName;
  if (traceName) query = query.where("name", "=", traceName);
  if (filters.from) query = query.where("timestamp", ">=", filters.from);
  if (filters.to) query = query.where("timestamp", "<", filters.to);
  if (filters.segmentId) {
    const segment = await getAnalyticsSegment(db, {
      id: filters.segmentId,
      projectId: filters.projectId,
      environmentId: filters.environmentId
    });
    if (!segment) {
      return { data: [] };
    }
    const actorIds = await getAnalyticsSegmentActorIds(db, segment, filters.to);
    if (actorIds.length === 0) {
      return { data: [] };
    }
    query = segment.actorType === "tenant" ? query.where("tenant_id", "in", actorIds) : query.where("user_id", "in", actorIds);
  }
  if (cursor) {
    query = query.where(({ and, eb, or }) =>
      or([eb("timestamp", "<", cursor.timestamp), and([eb("timestamp", "=", cursor.timestamp), eb("id", "<", cursor.id)])])
    );
  }

  const rows = await query.orderBy("timestamp", "desc").orderBy("id", "desc").limit(limit + 1).execute();
  return listResult(filters, rows, toEvent);
}

function normalizePropertyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toTypeCounts(value: unknown): Record<string, number> {
  if (!value) {
    return {};
  }
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, count]) => [key, toNumber(count)])
  );
}

function dominantType(typeCounts: Record<string, number>): string {
  const [first] = Object.entries(typeCounts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return first?.[0] ?? "unknown";
}

export async function getEventPropertyCatalog(db: Db, filters: ApmFilters): Promise<EventPropertyCatalogResponse> {
  const { from, to } = resolveOverviewRange(filters.window, filters.now);
  const limit = resolveLimit(filters.limit);

  const propertiesResult = await sql<{
    event_name: string;
    property_name: string;
    total_occurrences: unknown;
    event_count: unknown;
    type_counts: unknown;
    sample_values: string[] | null;
    last_seen_at: Date | string | null;
  }>`
    with scoped_events as (
      select id, name, timestamp, properties
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp < ${to}
    ),
    event_totals as (
      select name as event_name, count(*) as event_count
      from scoped_events
      group by name
    ),
    exploded as (
      select
        e.id,
        e.name as event_name,
        e.timestamp,
        property.key as property_name,
        coalesce(jsonb_typeof(property.value), 'unknown') as value_type,
        left(
          case
            when jsonb_typeof(property.value) = 'string' then property.value #>> '{}'
            else property.value::text
          end,
          160
        ) as sample_value
      from scoped_events e
      cross join lateral jsonb_each(
        case
          when jsonb_typeof(e.properties) = 'object' then e.properties
          else '{}'::jsonb
        end
      ) as property(key, value)
    ),
    property_counts as (
      select
        event_name,
        property_name,
        count(*) as total_occurrences,
        max(timestamp) as last_seen_at
      from exploded
      group by event_name, property_name
    ),
    type_counts as (
      select
        event_name,
        property_name,
        jsonb_object_agg(value_type, total order by value_type) as type_counts
      from (
        select event_name, property_name, value_type, count(*) as total
        from exploded
        group by event_name, property_name, value_type
      ) grouped_types
      group by event_name, property_name
    ),
    samples as (
      select
        event_name,
        property_name,
        array_agg(sample_value order by sample_value) as sample_values
      from (
        select distinct event_name, property_name, sample_value
        from exploded
        where sample_value is not null and sample_value <> ''
      ) distinct_samples
      group by event_name, property_name
    )
    select
      pc.event_name,
      pc.property_name,
      pc.total_occurrences,
      et.event_count,
      tc.type_counts,
      coalesce(samples.sample_values, '{}') as sample_values,
      pc.last_seen_at
    from property_counts pc
    join event_totals et on et.event_name = pc.event_name
    join type_counts tc on tc.event_name = pc.event_name and tc.property_name = pc.property_name
    left join samples on samples.event_name = pc.event_name and samples.property_name = pc.property_name
    order by pc.total_occurrences desc, pc.event_name asc, pc.property_name asc
    limit ${limit}
  `.execute(db);

  const totalsResult = await sql<{ events: unknown }>`
    select count(*) as events
    from events
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp < ${to}
  `.execute(db);

  const rows = propertiesResult.rows.map((row) => {
    const typeCounts = toTypeCounts(row.type_counts);
    const eventCount = toNumber(row.event_count);
    const totalOccurrences = toNumber(row.total_occurrences);
    return {
      eventName: row.event_name,
      propertyName: row.property_name,
      totalOccurrences,
      eventCount,
      coveragePercent: eventCount === 0 ? 0 : Math.round((totalOccurrences / eventCount) * 100),
      dominantType: dominantType(typeCounts),
      typeCounts,
      hasTypeConflict: Object.keys(typeCounts).length > 1,
      sampleValues: (row.sample_values ?? []).slice(0, 5),
      similarPropertyNames: [],
      lastSeenAt: row.last_seen_at ? toIso(row.last_seen_at) : null
    };
  });

  const similarGroups = new Map<string, EventPropertyCatalogItem[]>();
  for (const row of rows) {
    const normalizedName = normalizePropertyName(row.propertyName);
    if (!normalizedName) continue;
    const current = similarGroups.get(normalizedName) ?? [];
    current.push(row);
    similarGroups.set(normalizedName, current);
  }

  const similarNameGroups = Array.from(similarGroups, ([normalizedName, groupRows]) => {
    const propertyNames = Array.from(new Set(groupRows.map((row) => row.propertyName))).sort();
    if (propertyNames.length < 2) {
      return null;
    }
    const eventNames = Array.from(new Set(groupRows.map((row) => row.eventName))).sort((left, right) => left.localeCompare(right));
    for (const row of groupRows) {
      row.similarPropertyNames = propertyNames.filter((name) => name !== row.propertyName);
    }
    return { normalizedName, propertyNames, eventNames };
  }).filter((group): group is EventPropertySimilarNameGroup => Boolean(group));

  return {
    window: filters.window,
    generatedAt: toIso(filters.now ?? new Date()),
    scope: {
      projectId: filters.projectId,
      environmentId: filters.environmentId
    },
    range: {
      from: toIso(from),
      to: toIso(to)
    },
    totals: {
      events: toNumber(totalsResult.rows[0]?.events),
      properties: rows.length,
      conflictProperties: rows.filter((row) => row.hasTypeConflict).length,
      similarNameGroups: similarNameGroups.length
    },
    properties: rows,
    similarNameGroups
  };
}

function percentage(part: number, whole: number): number {
  if (whole <= 0) {
    return 0;
  }
  return Math.round((part / whole) * 100);
}

export async function getEventFunnel(db: Db, filters: EventFunnelFilters): Promise<EventFunnelResponse> {
  const { from, to } = resolveOverviewRange(filters.window, filters.now);
  const limit = resolveLimit(filters.limit);
  const steps = filters.steps.map((step) => step.trim()).filter(Boolean);

  if (steps.length < 2) {
    throw new Error("event_funnel_requires_two_steps");
  }

  const rows = await db
    .selectFrom("events")
    .select([
      "name",
      "timestamp",
      sql<string>`coalesce(user_id, tenant_id, session_id, trace_id)`.as("actor_id"),
      sql<"user" | "tenant" | "session" | "trace">`
        case
          when user_id is not null then 'user'
          when tenant_id is not null then 'tenant'
          when session_id is not null then 'session'
          else 'trace'
        end
      `.as("actor_type")
    ])
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId)
    .where("timestamp", ">=", from)
    .where("timestamp", "<", to)
    .where("name", "in", steps)
    .where(sql<boolean>`coalesce(user_id, tenant_id, session_id, trace_id) is not null`)
    .orderBy("actor_id", "asc")
    .orderBy("timestamp", "asc")
    .execute();

  const actors = new Map<
    string,
    {
      actorId: string;
      actorType: "user" | "tenant" | "session" | "trace";
      nextStepIndex: number;
      reachedStepIndex: number;
      reachedStepName: string;
      lastSeenAt: Date | string;
    }
  >();

  for (const row of rows) {
    const actorId = row.actor_id;
    if (!actorId) continue;
    const actor = actors.get(actorId) ?? {
      actorId,
      actorType: row.actor_type,
      nextStepIndex: 0,
      reachedStepIndex: -1,
      reachedStepName: "",
      lastSeenAt: row.timestamp
    };

    if (row.name === steps[actor.nextStepIndex]) {
      actor.reachedStepIndex = actor.nextStepIndex;
      actor.reachedStepName = row.name;
      actor.nextStepIndex += 1;
      actor.lastSeenAt = row.timestamp;
    }

    actors.set(actorId, actor);
  }

  const reachedActors = Array.from(actors.values()).filter((actor) => actor.reachedStepIndex >= 0);
  const entrantCount = reachedActors.length;
  const funnelSteps = steps.map((name, index) => {
    const actorsAtStep = reachedActors.filter((actor) => actor.reachedStepIndex >= index).length;
    const previousActors = index === 0 ? actorsAtStep : reachedActors.filter((actor) => actor.reachedStepIndex >= index - 1).length;
    return {
      index,
      name,
      actors: actorsAtStep,
      conversionPercent: percentage(actorsAtStep, entrantCount),
      dropOffFromPreviousPercent: index === 0 ? 0 : percentage(previousActors - actorsAtStep, previousActors)
    };
  });
  const completed = funnelSteps[funnelSteps.length - 1]?.actors ?? 0;

  return {
    window: filters.window,
    generatedAt: toIso(filters.now ?? new Date()),
    scope: {
      projectId: filters.projectId,
      environmentId: filters.environmentId
    },
    range: {
      from: toIso(from),
      to: toIso(to)
    },
    totals: {
      entrants: entrantCount,
      completed,
      conversionPercent: percentage(completed, entrantCount)
    },
    steps: funnelSteps,
    sampleActors: reachedActors
      .sort((left, right) => left.actorId.localeCompare(right.actorId))
      .slice(0, limit)
      .map((actor) => ({
        actorId: actor.actorId,
        actorType: actor.actorType,
        reachedStepIndex: actor.reachedStepIndex,
        reachedStepName: actor.reachedStepName,
        lastSeenAt: toIso(actor.lastSeenAt)
      }))
  };
}

function dateValue(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function startOfUtcWeek(value: Date): Date {
  const day = startOfUtcDay(value);
  const dayOfWeek = day.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  day.setUTCDate(day.getUTCDate() + mondayOffset);
  return day;
}

function startOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function startOfRetentionPeriod(value: Date, period: EventRetentionPeriod): Date {
  if (period === "weekly") return startOfUtcWeek(value);
  if (period === "monthly") return startOfUtcMonth(value);
  return startOfUtcDay(value);
}

function retentionPeriodIndex(cohortStart: Date, value: Date, period: EventRetentionPeriod): number {
  if (period === "monthly") {
    return (value.getUTCFullYear() - cohortStart.getUTCFullYear()) * 12 + value.getUTCMonth() - cohortStart.getUTCMonth();
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const elapsedDays = Math.floor((startOfUtcDay(value).getTime() - startOfUtcDay(cohortStart).getTime()) / msPerDay);
  return period === "weekly" ? Math.floor(elapsedDays / 7) : elapsedDays;
}

function retentionPeriodLabel(index: number, period: EventRetentionPeriod): string {
  if (index === 0) return period === "daily" ? "D0" : period === "weekly" ? "W0" : "M0";
  if (period === "weekly") return `W${index}`;
  if (period === "monthly") return `M${index}`;
  return `D${index}`;
}

function cohortLabel(value: Date, period: EventRetentionPeriod): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  if (period === "monthly") return `${year}-${month}`;
  return `${year}-${month}-${day}`;
}

export async function getEventRetention(db: Db, filters: EventRetentionFilters): Promise<EventRetentionResponse> {
  const { from, to } = resolveOverviewRange(filters.window, filters.now);
  const period = filters.period ?? "weekly";
  const intervals = Math.min(12, Math.max(2, Math.trunc(filters.intervals ?? 6)));
  const entryEvent = filters.entryEvent.trim();
  const returnEvent = filters.returnEvent.trim();

  if (!entryEvent || !returnEvent) {
    throw new Error("event_retention_requires_events");
  }

  const rows = await db
    .selectFrom("events")
    .select([
      "name",
      "timestamp",
      sql<string>`coalesce(user_id, tenant_id, session_id, trace_id)`.as("actor_id")
    ])
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId)
    .where("timestamp", ">=", from)
    .where("timestamp", "<", to)
    .where("name", "in", [entryEvent, returnEvent])
    .where(sql<boolean>`coalesce(user_id, tenant_id, session_id, trace_id) is not null`)
    .orderBy("actor_id", "asc")
    .orderBy("timestamp", "asc")
    .execute();

  const actors = new Map<
    string,
    {
      entryAt?: Date;
      returnAts: Date[];
    }
  >();

  for (const row of rows) {
    const actorId = row.actor_id;
    if (!actorId) continue;
    const timestamp = dateValue(row.timestamp);
    const actor = actors.get(actorId) ?? { returnAts: [] };
    if (row.name === entryEvent && (!actor.entryAt || timestamp < actor.entryAt)) {
      actor.entryAt = timestamp;
    }
    if (row.name === returnEvent) {
      actor.returnAts.push(timestamp);
    }
    actors.set(actorId, actor);
  }

  const cohorts = new Map<
    string,
    {
      cohortStart: Date;
      entrants: Set<string>;
      retained: Array<Set<string>>;
    }
  >();

  for (const [actorId, actor] of actors) {
    if (!actor.entryAt) continue;
    const start = startOfRetentionPeriod(actor.entryAt, period);
    const key = toIso(start);
    const cohort = cohorts.get(key) ?? {
      cohortStart: start,
      entrants: new Set<string>(),
      retained: Array.from({ length: intervals }, () => new Set<string>())
    };
    cohort.entrants.add(actorId);

    for (const returnAt of actor.returnAts) {
      if (returnAt < actor.entryAt) continue;
      const interval = retentionPeriodIndex(start, returnAt, period);
      if (interval >= 0 && interval < intervals) {
        cohort.retained[interval]?.add(actorId);
      }
    }

    cohorts.set(key, cohort);
  }

  const cohortRows = Array.from(cohorts.values())
    .sort((left, right) => left.cohortStart.getTime() - right.cohortStart.getTime())
    .map((cohort) => {
      const entrants = cohort.entrants.size;
      return {
        cohortStart: toIso(cohort.cohortStart),
        cohortLabel: cohortLabel(cohort.cohortStart, period),
        entrants,
        intervals: cohort.retained.map((retained, index) => ({
          index,
          label: retentionPeriodLabel(index, period),
          retainedActors: retained.size,
          retentionPercent: percentage(retained.size, entrants)
        }))
      };
    });

  return {
    window: filters.window,
    generatedAt: toIso(filters.now ?? new Date()),
    scope: {
      projectId: filters.projectId,
      environmentId: filters.environmentId
    },
    range: {
      from: toIso(from),
      to: toIso(to)
    },
    entryEvent,
    returnEvent,
    period,
    intervals,
    totals: {
      cohorts: cohortRows.length,
      entrants: cohortRows.reduce((sum, cohort) => sum + cohort.entrants, 0)
    },
    cohorts: cohortRows
  };
}

export async function listErrors(db: Db, filters: TelemetryFilters): Promise<TelemetryListResult<ErrorRecord>> {
  const cursor = decodeTimestampCursor(filters);
  const limit = resolveLimit(filters.limit);
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
  if (cursor) {
    query = query.where(({ and, eb, or }) =>
      or([eb("timestamp", "<", cursor.timestamp), and([eb("timestamp", "=", cursor.timestamp), eb("id", "<", cursor.id)])])
    );
  }

  const rows = await query.orderBy("timestamp", "desc").orderBy("id", "desc").limit(limit + 1).execute();
  return listResult(filters, rows, toError);
}

export async function listLlmCalls(db: Db, filters: TelemetryFilters): Promise<TelemetryListResult<LlmCallRecord>> {
  const cursor = decodeTimestampCursor(filters);
  const limit = resolveLimit(filters.limit);
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
  if (cursor) {
    query = query.where(({ and, eb, or }) =>
      or([eb("timestamp", "<", cursor.timestamp), and([eb("timestamp", "=", cursor.timestamp), eb("id", "<", cursor.id)])])
    );
  }

  const rows = await query.orderBy("timestamp", "desc").orderBy("id", "desc").limit(limit + 1).execute();
  return listResult(filters, rows, toLlmCall);
}

export async function listTraces(db: Db, filters: TelemetryFilters): Promise<TelemetryListResult<TraceRecord>> {
  const cursor = decodeTimestampCursor(filters);
  const limit = resolveLimit(filters.limit);
  let query = db
    .selectFrom("traces")
    .selectAll()
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId);

  if (filters.tenantId) query = query.where("tenant_id", "=", filters.tenantId);
  if (filters.userId) query = query.where("user_id", "=", filters.userId);
  if (filters.sessionId) query = query.where("session_id", "=", filters.sessionId);
  if (filters.traceId) query = query.where("trace_id", "=", filters.traceId);
  if (filters.eventName) query = query.where("name", "=", filters.eventName);
  if (filters.status) query = query.where("status", "=", filters.status);
  if (filters.from) query = query.where("timestamp", ">=", filters.from);
  if (filters.to) query = query.where("timestamp", "<", filters.to);
  if (cursor) {
    query = query.where(({ and, eb, or }) =>
      or([eb("timestamp", "<", cursor.timestamp), and([eb("timestamp", "=", cursor.timestamp), eb("id", "<", cursor.id)])])
    );
  }

  const rows = await query.orderBy("timestamp", "desc").orderBy("id", "desc").limit(limit + 1).execute();
  return listResult(filters, rows, toTrace);
}

export async function getApmEndpoints(db: Db, filters: ApmFilters): Promise<ApmEndpointsResponse> {
  const { from, to } = resolveOverviewRange(filters.window, filters.now);
  const limit = resolveLimit(filters.limit);

  const endpointsResult = await sql<{
    name: string;
    requests: unknown;
    errors: unknown;
    error_rate_percent: unknown;
    p50_duration_ms: unknown;
    p95_duration_ms: unknown;
    p99_duration_ms: unknown;
    average_duration_ms: unknown;
    apdex: unknown;
    last_seen_at: Date | string | null;
  }>`
    with scoped as (
      select
        coalesce(nullif(name, ''), '(unnamed trace)') as name,
        status,
        duration_ms,
        timestamp
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp < ${to}
    ),
    grouped as (
      select
        name,
        count(*) as requests,
        count(*) filter (where status <> 'success') as errors,
        case
          when count(*) = 0 then null
          else ((count(*) filter (where status <> 'success'))::numeric / count(*)::numeric) * 100
        end as error_rate_percent,
        percentile_cont(0.50) within group (order by duration_ms) filter (where duration_ms is not null) as p50_duration_ms,
        percentile_cont(0.95) within group (order by duration_ms) filter (where duration_ms is not null) as p95_duration_ms,
        percentile_cont(0.99) within group (order by duration_ms) filter (where duration_ms is not null) as p99_duration_ms,
        avg(duration_ms) filter (where duration_ms is not null) as average_duration_ms,
        case
          when count(*) filter (where duration_ms is not null) = 0 then null
          else (
            (
              (count(*) filter (where duration_ms <= 500))::numeric +
              ((count(*) filter (where duration_ms > 500 and duration_ms <= 2000))::numeric / 2)
            ) / (count(*) filter (where duration_ms is not null))::numeric
          )
        end as apdex,
        max(timestamp) as last_seen_at
      from scoped
      group by name
    )
    select *
    from grouped
    order by p95_duration_ms desc nulls last, requests desc, name asc
    limit ${limit}
  `.execute(db);

  const totalsResult = await sql<{
    endpoints: unknown;
    requests: unknown;
    errors: unknown;
    error_rate_percent: unknown;
    p95_duration_ms: unknown;
    apdex: unknown;
  }>`
    with scoped as (
      select
        coalesce(nullif(name, ''), '(unnamed trace)') as name,
        status,
        duration_ms
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp < ${to}
    )
    select
      count(distinct name) as endpoints,
      count(*) as requests,
      count(*) filter (where status <> 'success') as errors,
      case
        when count(*) = 0 then null
        else ((count(*) filter (where status <> 'success'))::numeric / count(*)::numeric) * 100
      end as error_rate_percent,
      percentile_cont(0.95) within group (order by duration_ms) filter (where duration_ms is not null) as p95_duration_ms,
      case
        when count(*) filter (where duration_ms is not null) = 0 then null
        else (
          (
            (count(*) filter (where duration_ms <= 500))::numeric +
            ((count(*) filter (where duration_ms > 500 and duration_ms <= 2000))::numeric / 2)
          ) / (count(*) filter (where duration_ms is not null))::numeric
        )
      end as apdex
    from scoped
  `.execute(db);

  const totals = totalsResult.rows[0];
  return {
    window: filters.window,
    generatedAt: to.toISOString(),
    scope: {
      projectId: filters.projectId,
      environmentId: filters.environmentId
    },
    range: {
      from: from.toISOString(),
      to: to.toISOString()
    },
    totals: {
      endpoints: toNumber(totals?.endpoints),
      requests: toNumber(totals?.requests),
      errors: toNumber(totals?.errors),
      errorRatePercent: toRoundedOrNull(totals?.error_rate_percent),
      p95DurationMs: toRoundedOrNull(totals?.p95_duration_ms),
      apdex: toNullableNumber(totals?.apdex)
    },
    endpoints: endpointsResult.rows.map((row) => ({
      name: row.name,
      requests: toNumber(row.requests),
      errors: toNumber(row.errors),
      errorRatePercent: toRoundedOrNull(row.error_rate_percent),
      p50DurationMs: toRoundedOrNull(row.p50_duration_ms),
      p95DurationMs: toRoundedOrNull(row.p95_duration_ms),
      p99DurationMs: toRoundedOrNull(row.p99_duration_ms),
      averageDurationMs: toRoundedOrNull(row.average_duration_ms),
      apdex: toNullableNumber(row.apdex),
      lastSeenAt: row.last_seen_at === null ? null : toIso(row.last_seen_at)
    }))
  };
}

export async function getWebVitals(db: Db, filters: ApmFilters): Promise<WebVitalsResponse> {
  const { from, to } = resolveOverviewRange(filters.window, filters.now);
  const limit = resolveLimit(filters.limit);

  const metricsResult = await sql<{
    name: WebVitalMetricRow["name"];
    route: string | null;
    samples: unknown;
    good: unknown;
    needs_improvement: unknown;
    poor: unknown;
    average_value: unknown;
    p75_value: unknown;
    latest_release: string | null;
    latest_release_p75_value: unknown;
    previous_release: string | null;
    previous_release_p75_value: unknown;
    regression_percent: unknown;
    last_seen_at: Date | string | null;
  }>`
    with scoped as (
      select
        name,
        coalesce(nullif(route, ''), '(unknown route)') as route,
        value,
        rating,
        release,
        timestamp
      from web_vitals
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp < ${to}
    ),
    grouped as (
      select
        name,
        route,
        count(*) as samples,
        count(*) filter (where rating = 'good') as good,
        count(*) filter (where rating = 'needs-improvement') as needs_improvement,
        count(*) filter (where rating = 'poor') as poor,
        avg(value) as average_value,
        percentile_cont(0.75) within group (order by value) as p75_value,
        max(timestamp) as last_seen_at
      from scoped
      group by name, route
    ),
    release_ranked as (
      select
        name,
        route,
        release,
        percentile_cont(0.75) within group (order by value) as p75_value,
        max(timestamp) as last_seen_at,
        row_number() over (partition by name, route order by max(timestamp) desc) as release_rank
      from scoped
      where release is not null
      group by name, route, release
    )
    select
      grouped.*,
      latest.release as latest_release,
      latest.p75_value as latest_release_p75_value,
      previous.release as previous_release,
      previous.p75_value as previous_release_p75_value,
      case
        when previous.p75_value is null or previous.p75_value = 0 or latest.p75_value is null then null
        else ((latest.p75_value - previous.p75_value) / previous.p75_value) * 100
      end as regression_percent
    from grouped
    left join release_ranked latest
      on latest.name = grouped.name
      and latest.route = grouped.route
      and latest.release_rank = 1
    left join release_ranked previous
      on previous.name = grouped.name
      and previous.route = grouped.route
      and previous.release_rank = 2
    order by poor desc, p75_value desc nulls last, samples desc, name asc, route asc
    limit ${limit}
  `.execute(db);

  const totalsResult = await sql<{
    samples: unknown;
    routes: unknown;
    releases: unknown;
    poor_samples: unknown;
    p75_lcp_ms: unknown;
    p75_inp_ms: unknown;
    p75_cls: unknown;
  }>`
    with scoped as (
      select name, route, release, rating, value
      from web_vitals
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp < ${to}
    )
    select
      count(*) as samples,
      count(distinct coalesce(nullif(route, ''), '(unknown route)')) as routes,
      count(distinct release) filter (where release is not null) as releases,
      count(*) filter (where rating = 'poor') as poor_samples,
      percentile_cont(0.75) within group (order by value) filter (where name = 'LCP') as p75_lcp_ms,
      percentile_cont(0.75) within group (order by value) filter (where name = 'INP') as p75_inp_ms,
      percentile_cont(0.75) within group (order by value) filter (where name = 'CLS') as p75_cls
    from scoped
  `.execute(db);

  const totals = totalsResult.rows[0];
  return {
    window: filters.window,
    generatedAt: to.toISOString(),
    scope: {
      projectId: filters.projectId,
      environmentId: filters.environmentId
    },
    range: {
      from: from.toISOString(),
      to: to.toISOString()
    },
    totals: {
      samples: toNumber(totals?.samples),
      routes: toNumber(totals?.routes),
      releases: toNumber(totals?.releases),
      poorSamples: toNumber(totals?.poor_samples),
      p75LcpMs: toRoundedOrNull(totals?.p75_lcp_ms),
      p75InpMs: toRoundedOrNull(totals?.p75_inp_ms),
      p75Cls: toRoundedOrNull(totals?.p75_cls)
    },
    metrics: metricsResult.rows.map((row) => ({
      name: row.name,
      route: row.route ?? "(unknown route)",
      samples: toNumber(row.samples),
      good: toNumber(row.good),
      needsImprovement: toNumber(row.needs_improvement),
      poor: toNumber(row.poor),
      averageValue: toRoundedOrNull(row.average_value),
      p75Value: toRoundedOrNull(row.p75_value),
      latestRelease: row.latest_release,
      latestReleaseP75Value: toRoundedOrNull(row.latest_release_p75_value),
      previousRelease: row.previous_release,
      previousReleaseP75Value: toRoundedOrNull(row.previous_release_p75_value),
      regressionPercent: toRoundedOrNull(row.regression_percent),
      lastSeenAt: row.last_seen_at === null ? null : toIso(row.last_seen_at)
    }))
  };
}

export async function getRuntimeProfiles(db: Db, filters: ApmFilters): Promise<RuntimeProfilesResponse> {
  const { from, to } = resolveOverviewRange(filters.window, filters.now);
  const limit = resolveLimit(filters.limit);

  const profilesResult = await sql<{
    id: string;
    name: string;
    kind: "cpu" | "memory";
    runtime: string;
    service: string | null;
    route: string | null;
    trace_id: string | null;
    source: string | null;
    release: string | null;
    started_at: Date | string;
    duration_ms: number | null;
    sample_count: unknown;
    cpu_usage_percent: unknown;
    heap_used_bytes: unknown;
    rss_bytes: unknown;
    top_function: string | null;
    top_function_self_time_ms: unknown;
  }>`
    select
      id,
      name,
      kind,
      runtime,
      service,
      route,
      trace_id,
      source,
      release,
      started_at,
      duration_ms,
      sample_count,
      cpu_usage_percent,
      heap_used_bytes,
      rss_bytes,
      (
        select frame ->> 'functionName'
        from jsonb_array_elements(top_functions) frame
        order by coalesce((frame ->> 'selfTimeMs')::numeric, 0) desc, coalesce((frame ->> 'sampleCount')::integer, 0) desc
        limit 1
      ) as top_function,
      (
        select coalesce((frame ->> 'selfTimeMs')::numeric, 0)
        from jsonb_array_elements(top_functions) frame
        order by coalesce((frame ->> 'selfTimeMs')::numeric, 0) desc, coalesce((frame ->> 'sampleCount')::integer, 0) desc
        limit 1
      ) as top_function_self_time_ms
    from profiles
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp < ${to}
    order by timestamp desc, id desc
    limit ${limit}
  `.execute(db);

  const hotFunctionsResult = await sql<{
    function_name: string | null;
    url: string | null;
    line_number: unknown;
    column_number: unknown;
    self_time_ms: unknown;
    total_time_ms: unknown;
    sample_count: unknown;
    profile_count: unknown;
    last_seen_at: Date | string | null;
  }>`
    with scoped as (
      select timestamp, top_functions
      from profiles
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp < ${to}
        and kind = 'cpu'
    ),
    frames as (
      select
        frame ->> 'functionName' as function_name,
        nullif(frame ->> 'url', '') as url,
        nullif(frame ->> 'lineNumber', '')::integer as line_number,
        nullif(frame ->> 'columnNumber', '')::integer as column_number,
        coalesce((frame ->> 'selfTimeMs')::numeric, 0) as self_time_ms,
        nullif(frame ->> 'totalTimeMs', '')::numeric as total_time_ms,
        coalesce((frame ->> 'sampleCount')::integer, 0) as sample_count,
        timestamp
      from scoped
      cross join lateral jsonb_array_elements(top_functions) frame
      where frame ->> 'functionName' is not null
    )
    select
      function_name,
      url,
      line_number,
      column_number,
      sum(self_time_ms) as self_time_ms,
      sum(total_time_ms) as total_time_ms,
      sum(sample_count) as sample_count,
      count(*) as profile_count,
      max(timestamp) as last_seen_at
    from frames
    group by function_name, url, line_number, column_number
    order by self_time_ms desc, sample_count desc, profile_count desc
    limit ${limit}
  `.execute(db);

  const totalsResult = await sql<{
    profiles: unknown;
    cpu_profiles: unknown;
    memory_profiles: unknown;
    samples: unknown;
    avg_cpu_usage_percent: unknown;
    max_heap_used_bytes: unknown;
    p95_duration_ms: unknown;
  }>`
    select
      count(*) as profiles,
      count(*) filter (where kind = 'cpu') as cpu_profiles,
      count(*) filter (where kind = 'memory') as memory_profiles,
      coalesce(sum(sample_count), 0) as samples,
      avg(cpu_usage_percent) filter (where cpu_usage_percent is not null) as avg_cpu_usage_percent,
      max(heap_used_bytes) as max_heap_used_bytes,
      percentile_cont(0.95) within group (order by duration_ms) filter (where duration_ms is not null) as p95_duration_ms
    from profiles
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp < ${to}
  `.execute(db);

  const totals = totalsResult.rows[0];
  return {
    window: filters.window,
    generatedAt: to.toISOString(),
    scope: {
      projectId: filters.projectId,
      environmentId: filters.environmentId
    },
    range: {
      from: from.toISOString(),
      to: to.toISOString()
    },
    totals: {
      profiles: toNumber(totals?.profiles),
      cpuProfiles: toNumber(totals?.cpu_profiles),
      memoryProfiles: toNumber(totals?.memory_profiles),
      samples: toNumber(totals?.samples),
      avgCpuUsagePercent: toRoundedOrNull(totals?.avg_cpu_usage_percent),
      maxHeapUsedBytes: toNullableNumber(totals?.max_heap_used_bytes),
      p95DurationMs: toRoundedOrNull(totals?.p95_duration_ms)
    },
    profiles: profilesResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      runtime: row.runtime,
      service: row.service,
      route: row.route,
      traceId: row.trace_id,
      source: row.source,
      release: row.release,
      startedAt: toIso(row.started_at),
      durationMs: row.duration_ms,
      sampleCount: toNumber(row.sample_count),
      cpuUsagePercent: toNullableNumber(row.cpu_usage_percent),
      heapUsedBytes: toNullableNumber(row.heap_used_bytes),
      rssBytes: toNullableNumber(row.rss_bytes),
      topFunction: row.top_function,
      topFunctionSelfTimeMs: toNullableNumber(row.top_function_self_time_ms)
    })),
    hotFunctions: hotFunctionsResult.rows.map((row) => ({
      functionName: row.function_name ?? "(anonymous)",
      url: row.url,
      lineNumber: toFiniteSafeNumber(row.line_number),
      columnNumber: toFiniteSafeNumber(row.column_number),
      selfTimeMs: toNumber(row.self_time_ms),
      totalTimeMs: toNullableNumber(row.total_time_ms),
      sampleCount: toNumber(row.sample_count),
      profileCount: toNumber(row.profile_count),
      lastSeenAt: row.last_seen_at === null ? null : toIso(row.last_seen_at)
    }))
  };
}

export async function getServiceMap(db: Db, filters: ApmFilters): Promise<ServiceMapResponse> {
  const { from, to } = resolveOverviewRange(filters.window, filters.now);
  const limit = resolveLimit(filters.limit);

  const edgesResult = await sql<{
    source: string;
    target: string;
    dependency_type: string;
    spans: unknown;
    traces: unknown;
    errors: unknown;
    error_rate_percent: unknown;
    average_duration_ms: unknown;
    p95_duration_ms: unknown;
    last_seen_at: Date | string | null;
  }>`
    with scoped as (
      select
        coalesce(nullif(metadata->>'service', ''), nullif(source, ''), '(unknown service)') as source,
        coalesce(
          nullif(metadata->>'target_service', ''),
          nullif(metadata->>'peer_service', ''),
          nullif(metadata->>'peer', ''),
          nullif(metadata->>'db.system', ''),
          case
            when lower(name) like '%postgres%' or lower(name) like '%sql%' or lower(name) like '%db%' then 'database'
            when lower(name) like '%redis%' or lower(name) like '%cache%' then 'cache'
            when lower(name) like 'http %' or lower(name) like '%fetch%' or lower(name) like '%request%' then 'external-http'
            when lower(name) like '%llm%' or lower(name) like '%openai%' or lower(name) like '%anthropic%' then 'llm-provider'
            else '(internal)'
          end
        ) as target,
        case
          when metadata ? 'db.system' or lower(name) like '%postgres%' or lower(name) like '%sql%' or lower(name) like '%db%' then 'database'
          when lower(name) like '%redis%' or lower(name) like '%cache%' then 'cache'
          when lower(name) like '%llm%' or lower(name) like '%openai%' or lower(name) like '%anthropic%' then 'llm'
          when lower(name) like 'http %' or lower(name) like '%fetch%' or lower(name) like '%request%' then 'http'
          else 'internal'
        end as dependency_type,
        trace_id,
        status,
        duration_ms,
        timestamp
      from spans
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp < ${to}
    )
    select
      source,
      target,
      dependency_type,
      count(*) as spans,
      count(distinct trace_id) as traces,
      count(*) filter (where status <> 'success') as errors,
      case
        when count(*) = 0 then null
        else ((count(*) filter (where status <> 'success'))::numeric / count(*)::numeric) * 100
      end as error_rate_percent,
      avg(duration_ms) filter (where duration_ms is not null) as average_duration_ms,
      percentile_cont(0.95) within group (order by duration_ms) filter (where duration_ms is not null) as p95_duration_ms,
      max(timestamp) as last_seen_at
    from scoped
    group by source, target, dependency_type
    order by errors desc, p95_duration_ms desc nulls last, spans desc, source asc, target asc
    limit ${limit}
  `.execute(db);

  const totalsResult = await sql<{
    services: unknown;
    edges: unknown;
    spans: unknown;
    errors: unknown;
    error_rate_percent: unknown;
  }>`
    with scoped as (
      select
        coalesce(nullif(metadata->>'service', ''), nullif(source, ''), '(unknown service)') as source,
        coalesce(
          nullif(metadata->>'target_service', ''),
          nullif(metadata->>'peer_service', ''),
          nullif(metadata->>'peer', ''),
          nullif(metadata->>'db.system', ''),
          case
            when lower(name) like '%postgres%' or lower(name) like '%sql%' or lower(name) like '%db%' then 'database'
            when lower(name) like '%redis%' or lower(name) like '%cache%' then 'cache'
            when lower(name) like 'http %' or lower(name) like '%fetch%' or lower(name) like '%request%' then 'external-http'
            when lower(name) like '%llm%' or lower(name) like '%openai%' or lower(name) like '%anthropic%' then 'llm-provider'
            else '(internal)'
          end
        ) as target,
        case
          when metadata ? 'db.system' or lower(name) like '%postgres%' or lower(name) like '%sql%' or lower(name) like '%db%' then 'database'
          when lower(name) like '%redis%' or lower(name) like '%cache%' then 'cache'
          when lower(name) like '%llm%' or lower(name) like '%openai%' or lower(name) like '%anthropic%' then 'llm'
          when lower(name) like 'http %' or lower(name) like '%fetch%' or lower(name) like '%request%' then 'http'
          else 'internal'
        end as dependency_type,
        status
      from spans
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp < ${to}
    ),
    grouped as (
      select source, target, dependency_type, count(*) as spans, count(*) filter (where status <> 'success') as errors
      from scoped
      group by source, target, dependency_type
    ),
    service_nodes as (
      select source as service from grouped
      union
      select target as service from grouped
    )
    select
      (select count(*) from service_nodes) as services,
      count(*) as edges,
      coalesce(sum(spans), 0) as spans,
      coalesce(sum(errors), 0) as errors,
      case
        when coalesce(sum(spans), 0) = 0 then null
        else (coalesce(sum(errors), 0)::numeric / sum(spans)::numeric) * 100
      end as error_rate_percent
    from grouped
  `.execute(db);

  const totals = totalsResult.rows[0];
  return {
    window: filters.window,
    generatedAt: to.toISOString(),
    scope: {
      projectId: filters.projectId,
      environmentId: filters.environmentId
    },
    range: {
      from: from.toISOString(),
      to: to.toISOString()
    },
    totals: {
      services: toNumber(totals?.services),
      edges: toNumber(totals?.edges),
      spans: toNumber(totals?.spans),
      errors: toNumber(totals?.errors),
      errorRatePercent: toRoundedOrNull(totals?.error_rate_percent)
    },
    edges: edgesResult.rows.map((row) => ({
      source: row.source,
      target: row.target,
      dependencyType: row.dependency_type,
      spans: toNumber(row.spans),
      traces: toNumber(row.traces),
      errors: toNumber(row.errors),
      errorRatePercent: toRoundedOrNull(row.error_rate_percent),
      averageDurationMs: toRoundedOrNull(row.average_duration_ms),
      p95DurationMs: toRoundedOrNull(row.p95_duration_ms),
      lastSeenAt: row.last_seen_at === null ? null : toIso(row.last_seen_at)
    }))
  };
}

export async function listTraceSpans(db: Db, filters: TelemetryFilters): Promise<TelemetryListResult<SpanRecord>> {
  const cursor = decodeTimestampCursor(filters);
  const limit = resolveLimit(filters.limit);
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
  if (cursor) {
    query = query.where(({ and, eb, or }) =>
      or([eb("timestamp", "<", cursor.timestamp), and([eb("timestamp", "=", cursor.timestamp), eb("id", "<", cursor.id)])])
    );
  }

  const rows = await query.orderBy("timestamp", "desc").orderBy("id", "desc").limit(limit + 1).execute();
  return listResult(filters, rows, toSpan);
}

export async function getEventAggregates(db: Db, filters: TelemetryFilters): Promise<CountAggregate & { byName: Record<string, number> }> {
  let totalQuery = db
    .selectFrom("events")
    .select(sql<string>`count(*)`.as("total"))
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId);

  let byNameQuery = db
    .selectFrom("events")
    .select(["name", sql<string>`count(*)`.as("total")])
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

  const [totalRow, byNameRows] = await Promise.all([totalQuery.executeTakeFirstOrThrow(), byNameQuery.execute()]);

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

export async function getLlmSummary(db: Db, filters: LlmAggregateFilters): Promise<LlmSummary> {
  const { from, to } = resolveOverviewRange(filters.window);
  const result = await sql<{
    calls: unknown;
    failed_calls: unknown;
    cost_usd: string;
    avg_tokens: unknown;
    avg_latency_ms: unknown;
    p95_latency_ms: unknown;
  }>`
    select
      count(*) as calls,
      count(*) filter (where status <> 'success') as failed_calls,
      coalesce(sum(cost_usd), 0)::text as cost_usd,
      avg(input_tokens + output_tokens) as avg_tokens,
      avg(latency_ms) filter (where latency_ms is not null) as avg_latency_ms,
      percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
  `.execute(db);

  const r = result.rows[0];
  return {
    calls: toNumber(r?.calls ?? 0),
    failedCalls: toNumber(r?.failed_calls ?? 0),
    costUsd: r?.cost_usd ?? "0",
    avgTokens: toRoundedOrNull(r?.avg_tokens),
    avgLatencyMs: toRoundedOrNull(r?.avg_latency_ms),
    p95LatencyMs: toRoundedOrNull(r?.p95_latency_ms)
  };
}

export async function getLlmByTenant(db: Db, filters: LlmAggregateFilters): Promise<LlmTenantRow[]> {
  const { from, to } = resolveOverviewRange(filters.window);
  const result = await sql<{
    tenant_id: string;
    calls: unknown;
    failed_calls: unknown;
    cost_usd: string;
    avg_tokens: unknown;
    avg_latency_ms: unknown;
    p95_latency_ms: unknown;
  }>`
    select
      tenant_id,
      count(*) as calls,
      count(*) filter (where status <> 'success') as failed_calls,
      coalesce(sum(cost_usd), 0)::text as cost_usd,
      avg(input_tokens + output_tokens) as avg_tokens,
      avg(latency_ms) filter (where latency_ms is not null) as avg_latency_ms,
      percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
      and tenant_id is not null
    group by tenant_id
    order by sum(cost_usd) desc, tenant_id asc
    limit 10
  `.execute(db);

  return result.rows.map((r) => ({
    tenantId: r.tenant_id,
    calls: toNumber(r.calls),
    failedCalls: toNumber(r.failed_calls),
    costUsd: r.cost_usd,
    avgTokens: toRoundedOrNull(r.avg_tokens),
    avgLatencyMs: toRoundedOrNull(r.avg_latency_ms),
    p95LatencyMs: toRoundedOrNull(r.p95_latency_ms)
  }));
}

export async function getLlmByPrompt(db: Db, filters: LlmAggregateFilters): Promise<LlmPromptRow[]> {
  const { from, to } = resolveOverviewRange(filters.window);
  const result = await sql<{
    prompt_name: string;
    model: string;
    calls: unknown;
    failed_calls: unknown;
    cost_usd: string;
    avg_tokens: unknown;
    avg_latency_ms: unknown;
    p95_latency_ms: unknown;
  }>`
    select
      coalesce(prompt_name, 'Unspecified') as prompt_name,
      model,
      count(*) as calls,
      count(*) filter (where status <> 'success') as failed_calls,
      coalesce(sum(cost_usd), 0)::text as cost_usd,
      avg(input_tokens + output_tokens) as avg_tokens,
      avg(latency_ms) filter (where latency_ms is not null) as avg_latency_ms,
      percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
    group by coalesce(prompt_name, 'Unspecified'), model
    order by sum(cost_usd) desc, prompt_name asc, model asc
    limit 20
  `.execute(db);

  return result.rows.map((r) => ({
    promptName: r.prompt_name,
    model: r.model,
    calls: toNumber(r.calls),
    failedCalls: toNumber(r.failed_calls),
    costUsd: r.cost_usd,
    avgTokens: toRoundedOrNull(r.avg_tokens),
    avgLatencyMs: toRoundedOrNull(r.avg_latency_ms),
    p95LatencyMs: toRoundedOrNull(r.p95_latency_ms)
  }));
}

export interface LlmCostByModelSeries {
  model: string;
  costs: string[]; // costs[i] aligns to buckets[i]
}

export interface LlmCostByModel {
  buckets: string[];
  series: LlmCostByModelSeries[];
}

export async function getLlmCostByModel(db: Db, filters: LlmAggregateFilters): Promise<LlmCostByModel> {
  const { from, to, bucket } = resolveOverviewRange(filters.window);
  const buckets = buildBucketAxis(from, to, bucket);

  const topModels = await sql<{ model: string }>`
    select model
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
    group by model
    order by sum(cost_usd) desc, model asc
    limit 5
  `.execute(db);

  const models = topModels.rows.map((r) => r.model);
  if (models.length === 0) {
    return { buckets, series: [] };
  }

  const bucketExpr = bucketExpression(bucket, "timestamp");
  const perBucket = await sql<{ model: string; bucket_start: string; cost_usd: string }>`
    select
      model,
      ${bucketExpr} as bucket_start,
      coalesce(sum(cost_usd), 0)::text as cost_usd
    from llm_calls
    where project_id = ${filters.projectId}
      and environment_id = ${filters.environmentId}
      and timestamp >= ${from}
      and timestamp <= ${to}
      and model in (${sql.join(models)})
    group by model, bucket_start
  `.execute(db);

  // index: model -> (bucket_start -> cost string)
  const byModel = new Map<string, Map<string, string>>();
  for (const row of perBucket.rows) {
    let m = byModel.get(row.model);
    if (!m) {
      m = new Map();
      byModel.set(row.model, m);
    }
    m.set(row.bucket_start, row.cost_usd);
  }

  const series: LlmCostByModelSeries[] = models.map((model) => {
    const m = byModel.get(model);
    return {
      model,
      costs: buckets.map((b) => m?.get(b) ?? "0")
    };
  });

  return { buckets, series };
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

  const kpiRowsPromise = sql<{
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

  const usageTrendRowsPromise = sql<{
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

  const errorTrendRowsPromise = sql<{
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

  const latencyTrendRowsPromise = sql<{
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

  const aiCostTrendRowsPromise = sql<{
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

  const topEventsRowsPromise = sql<{ name: string; total: unknown }>`
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

  const tenantsByUsageRowsPromise = sql<{ tenant_id: string; total: unknown }>`
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

  const tenantsByErrorsRowsPromise = sql<{ tenant_id: string; total: unknown }>`
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

  const tenantsByLlmCallsRowsPromise = sql<{ tenant_id: string; total: unknown }>`
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

  const tenantsByLlmCostRowsPromise = sql<{ tenant_id: string; total_cost_usd: string }>`
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

  const llmProvidersRowsPromise = sql<{ provider: string; total: unknown; total_cost_usd: string }>`
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

  const llmModelsRowsPromise = sql<{ model: string; total: unknown; total_cost_usd: string }>`
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

  const llmPromptsRowsPromise = sql<{ prompt_name: string; total: unknown; total_cost_usd: string }>`
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

  const errorSeverityRowsPromise = sql<{ severity: string; total: unknown }>`
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

  const errorStatusRowsPromise = sql<{ status: string; total: unknown }>`
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

  const recentErrorRowsPromise = sql<{
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

  const recentFailedTraceRowsPromise = sql<{
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

  const recentFailedLlmCallRowsPromise = sql<{
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

  const [
    kpiRows,
    usageTrendRows,
    errorTrendRows,
    latencyTrendRows,
    aiCostTrendRows,
    topEventsRows,
    tenantsByUsageRows,
    tenantsByErrorsRows,
    tenantsByLlmCallsRows,
    tenantsByLlmCostRows,
    llmProvidersRows,
    llmModelsRows,
    llmPromptsRows,
    errorSeverityRows,
    errorStatusRows,
    recentErrorRows,
    recentFailedTraceRows,
    recentFailedLlmCallRows
  ] = await Promise.all([
    kpiRowsPromise,
    usageTrendRowsPromise,
    errorTrendRowsPromise,
    latencyTrendRowsPromise,
    aiCostTrendRowsPromise,
    topEventsRowsPromise,
    tenantsByUsageRowsPromise,
    tenantsByErrorsRowsPromise,
    tenantsByLlmCallsRowsPromise,
    tenantsByLlmCostRowsPromise,
    llmProvidersRowsPromise,
    llmModelsRowsPromise,
    llmPromptsRowsPromise,
    errorSeverityRowsPromise,
    errorStatusRowsPromise,
    recentErrorRowsPromise,
    recentFailedTraceRowsPromise,
    recentFailedLlmCallRowsPromise
  ]);
  const kpiRow = kpiRows.rows[0];

  const usageByBucket = new Map(usageTrendRows.rows.map((row) => [toIso(row.bucket_start), row]));
  const errorsByBucket = new Map(errorTrendRows.rows.map((row) => [toIso(row.bucket_start), row]));
  const latencyByBucket = new Map(latencyTrendRows.rows.map((row) => [toIso(row.bucket_start), row]));
  const aiCostByBucket = new Map(aiCostTrendRows.rows.map((row) => [toIso(row.bucket_start), row]));

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

export const __test = {
  toNumber,
  toRoundedOrNull
};
