import { sql } from "kysely";

import type { Db } from "../client.js";
import { refreshErrorGroupStats, upsertErrorGroupForOccurrence } from "./error-groups.js";
import { touchTenantProfileLastSeen, touchUserProfileLastSeen } from "./identity-profiles.js";

interface TelemetryBaseInput {
  id: string;
  projectId: string;
  environmentId: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  timestamp: Date;
  receivedAt: Date;
  source?: string;
  release?: string;
  metadata?: unknown;
}

export interface InsertEventInput extends TelemetryBaseInput {
  name: string;
  properties?: unknown;
}

export interface InsertErrorInput extends TelemetryBaseInput {
  message: string;
  type?: string;
  severity: string;
  stack?: string;
  status?: string;
  fingerprint?: string;
  context?: unknown;
}

export interface InsertLlmCallInput extends TelemetryBaseInput {
  provider: string;
  model: string;
  promptName?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: string;
  latencyMs?: number;
  status: string;
  error?: string;
  inputPreview?: string;
  outputPreview?: string;
}

export interface InsertTraceInput extends TelemetryBaseInput {
  name: string;
  status: string;
  startedAt: Date;
  endedAt?: Date;
  durationMs?: number;
}

export interface InsertSpanInput extends TelemetryBaseInput {
  traceId: string;
  parentSpanId?: string;
  name: string;
  status: string;
  startedAt: Date;
  endedAt?: Date;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  costUsd?: string;
}

export interface InsertWebVitalInput extends TelemetryBaseInput {
  name: "CLS" | "FCP" | "FID" | "INP" | "LCP" | "TTFB";
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  route?: string;
  navigationType?: string;
}

export interface InsertProfileFunctionInput {
  functionName: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  selfTimeMs?: number;
  totalTimeMs?: number;
  sampleCount?: number;
}

export interface InsertProfileInput extends TelemetryBaseInput {
  name: string;
  kind: "cpu" | "memory";
  runtime: string;
  service?: string;
  route?: string;
  startedAt: Date;
  endedAt?: Date;
  durationMs?: number;
  sampleCount?: number;
  samplingIntervalMs?: number;
  cpuUsagePercent?: string;
  cpuUserMs?: number;
  cpuSystemMs?: number;
  rssBytes?: string;
  heapUsedBytes?: string;
  heapTotalBytes?: string;
  externalBytes?: string;
  arrayBuffersBytes?: string;
  topFunctions?: InsertProfileFunctionInput[];
  summary?: unknown;
}

export interface InsertBreadcrumbInput extends TelemetryBaseInput {
  type: "navigation" | "click" | "console" | "network" | "custom";
  category?: string;
  message: string;
  level: "debug" | "info" | "warning" | "error" | "fatal";
  data?: unknown;
}

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function baseColumns(input: TelemetryBaseInput) {
  return {
    id: input.id,
    project_id: input.projectId,
    environment_id: input.environmentId,
    tenant_id: nullable(input.tenantId),
    user_id: nullable(input.userId),
    session_id: nullable(input.sessionId),
    trace_id: nullable(input.traceId),
    timestamp: input.timestamp,
    received_at: input.receivedAt,
    source: nullable(input.source),
    release: nullable(input.release),
    metadata: input.metadata ?? {}
  };
}

function inserted(result: { id: string }[]): boolean {
  return result.length > 0;
}

function jsonb(value: unknown) {
  return sql<unknown>`${JSON.stringify(value)}::jsonb`;
}

async function assertActiveTelemetryScope(db: Db, input: TelemetryBaseInput): Promise<void> {
  const activeScope = await db
    .selectFrom("environments")
    .innerJoin("projects", "projects.id", "environments.project_id")
    .select("environments.id")
    .where("environments.project_id", "=", input.projectId)
    .where("environments.id", "=", input.environmentId)
    .where("environments.archived_at", "is", null)
    .where("projects.archived_at", "is", null)
    .executeTakeFirst();

  if (!activeScope) {
    throw new Error("active_telemetry_scope_not_found");
  }
}

async function touchProfiles(db: Db, input: TelemetryBaseInput): Promise<void> {
  if (input.userId) {
    await touchUserProfileLastSeen(db, {
      projectId: input.projectId,
      environmentId: input.environmentId,
      userId: input.userId,
      tenantId: input.tenantId,
      timestamp: input.timestamp
    });
  }
  if (input.tenantId) {
    await touchTenantProfileLastSeen(db, {
      projectId: input.projectId,
      environmentId: input.environmentId,
      tenantId: input.tenantId,
      timestamp: input.timestamp
    });
  }
}

export async function insertEvent(db: Db, input: InsertEventInput): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom("events").select("id").where("id", "=", input.id).executeTakeFirst();
    if (existing) return;

    await assertActiveTelemetryScope(trx, input);

    const result = await trx
      .insertInto("events")
      .values({
        ...baseColumns(input),
        name: input.name,
        properties: input.properties ?? {}
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .returning("id")
      .execute();

    if (inserted(result)) {
      await touchProfiles(trx, input);
    }
  });
}

export async function insertError(db: Db, input: InsertErrorInput): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom("errors").select("id").where("id", "=", input.id).executeTakeFirst();
    if (existing) return;

    await assertActiveTelemetryScope(trx, input);

    const grouping = await upsertErrorGroupForOccurrence(trx, {
      projectId: input.projectId,
      environmentId: input.environmentId,
      message: input.message,
      type: input.type,
      severity: input.severity,
      stack: input.stack,
      fingerprint: input.fingerprint,
      timestamp: input.timestamp,
      userId: input.userId,
      tenantId: input.tenantId,
      release: input.release,
      errorId: input.id
    });

    const result = await trx
      .insertInto("errors")
      .values({
        ...baseColumns(input),
        message: input.message,
        type: nullable(input.type),
        severity: input.severity,
        stack: nullable(input.stack),
        status: input.status ?? "open",
        fingerprint: nullable(input.fingerprint),
        context: input.context ?? {},
        error_group_id: grouping.groupId,
        grouping_fingerprint: grouping.fingerprint
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .returning("id")
      .execute();

    if (inserted(result)) {
      await touchProfiles(trx, input);
    }
    await refreshErrorGroupStats(trx, grouping.groupId);
  });
}

export async function insertLlmCall(db: Db, input: InsertLlmCallInput): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom("llm_calls").select("id").where("id", "=", input.id).executeTakeFirst();
    if (existing) return;

    await assertActiveTelemetryScope(trx, input);

    const result = await trx
      .insertInto("llm_calls")
      .values({
        ...baseColumns(input),
        provider: input.provider,
        model: input.model,
        prompt_name: nullable(input.promptName),
        input_tokens: input.inputTokens ?? 0,
        output_tokens: input.outputTokens ?? 0,
        cost_usd: input.costUsd ?? "0",
        latency_ms: nullable(input.latencyMs),
        status: input.status,
        error: nullable(input.error),
        input_preview: nullable(input.inputPreview),
        output_preview: nullable(input.outputPreview)
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .returning("id")
      .execute();

    if (inserted(result)) {
      await touchProfiles(trx, input);
    }
  });
}

export async function insertTrace(db: Db, input: InsertTraceInput): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom("traces").select("id").where("id", "=", input.id).executeTakeFirst();
    if (existing) return;

    await assertActiveTelemetryScope(trx, input);

    const result = await trx
      .insertInto("traces")
      .values({
        ...baseColumns(input),
        name: input.name,
        status: input.status,
        started_at: input.startedAt,
        ended_at: nullable(input.endedAt),
        duration_ms: nullable(input.durationMs)
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .returning("id")
      .execute();

    if (inserted(result)) {
      await touchProfiles(trx, input);
    }
  });
}

export async function insertSpan(db: Db, input: InsertSpanInput): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom("spans").select("id").where("id", "=", input.id).executeTakeFirst();
    if (existing) return;

    await assertActiveTelemetryScope(trx, input);

    const result = await trx
      .insertInto("spans")
      .values({
        ...baseColumns(input),
        trace_id: input.traceId,
        parent_span_id: nullable(input.parentSpanId),
        name: input.name,
        status: input.status,
        started_at: input.startedAt,
        ended_at: nullable(input.endedAt),
        duration_ms: nullable(input.durationMs),
        input: nullable(input.input),
        output: nullable(input.output),
        error: nullable(input.error),
        cost_usd: nullable(input.costUsd)
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .returning("id")
      .execute();

    if (inserted(result)) {
      await touchProfiles(trx, input);
    }
  });
}

export async function insertWebVital(db: Db, input: InsertWebVitalInput): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom("web_vitals").select("id").where("id", "=", input.id).executeTakeFirst();
    if (existing) return;

    await assertActiveTelemetryScope(trx, input);

    const result = await trx
      .insertInto("web_vitals")
      .values({
        ...baseColumns(input),
        name: input.name,
        value: input.value,
        rating: input.rating,
        route: nullable(input.route),
        navigation_type: nullable(input.navigationType)
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .returning("id")
      .execute();

    if (inserted(result)) {
      await touchProfiles(trx, input);
    }
  });
}

export async function insertProfile(db: Db, input: InsertProfileInput): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom("profiles").select("id").where("id", "=", input.id).executeTakeFirst();
    if (existing) return;

    await assertActiveTelemetryScope(trx, input);

    const result = await trx
      .insertInto("profiles")
      .values({
        ...baseColumns(input),
        name: input.name,
        kind: input.kind,
        runtime: input.runtime,
        service: nullable(input.service),
        route: nullable(input.route),
        started_at: input.startedAt,
        ended_at: nullable(input.endedAt),
        duration_ms: nullable(input.durationMs),
        sample_count: input.sampleCount ?? 0,
        sampling_interval_ms: nullable(input.samplingIntervalMs),
        cpu_usage_percent: nullable(input.cpuUsagePercent),
        cpu_user_ms: nullable(input.cpuUserMs),
        cpu_system_ms: nullable(input.cpuSystemMs),
        rss_bytes: nullable(input.rssBytes),
        heap_used_bytes: nullable(input.heapUsedBytes),
        heap_total_bytes: nullable(input.heapTotalBytes),
        external_bytes: nullable(input.externalBytes),
        array_buffers_bytes: nullable(input.arrayBuffersBytes),
        top_functions: jsonb(input.topFunctions ?? []),
        summary: jsonb(input.summary ?? {})
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .returning("id")
      .execute();

    if (inserted(result)) {
      await touchProfiles(trx, input);
    }
  });
}

export async function insertBreadcrumb(db: Db, input: InsertBreadcrumbInput): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom("breadcrumbs").select("id").where("id", "=", input.id).executeTakeFirst();
    if (existing) return;

    await assertActiveTelemetryScope(trx, input);

    const result = await trx
      .insertInto("breadcrumbs")
      .values({
        ...baseColumns(input),
        type: input.type,
        category: nullable(input.category),
        message: input.message,
        level: input.level,
        data: input.data ?? {}
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .returning("id")
      .execute();

    if (inserted(result)) {
      await touchProfiles(trx, input);
    }
  });
}
