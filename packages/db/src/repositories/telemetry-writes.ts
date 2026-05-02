import type { Db } from "../client.js";

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
  promptName?: string;
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

export async function insertEvent(db: Db, input: InsertEventInput): Promise<void> {
  await db
    .insertInto("events")
    .values({
      ...baseColumns(input),
      name: input.name,
      properties: input.properties ?? {}
    })
    .execute();
}

export async function insertError(db: Db, input: InsertErrorInput): Promise<void> {
  await db
    .insertInto("errors")
    .values({
      ...baseColumns(input),
      message: input.message,
      type: nullable(input.type),
      severity: input.severity,
      stack: nullable(input.stack),
      status: input.status ?? "open",
      fingerprint: nullable(input.fingerprint),
      context: input.context ?? {}
    })
    .execute();
}

export async function insertLlmCall(db: Db, input: InsertLlmCallInput): Promise<void> {
  await db
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
    .execute();
}

export async function insertTrace(db: Db, input: InsertTraceInput): Promise<void> {
  await db
    .insertInto("traces")
    .values({
      ...baseColumns(input),
      name: input.name,
      status: input.status,
      started_at: input.startedAt,
      ended_at: nullable(input.endedAt),
      duration_ms: nullable(input.durationMs)
    })
    .execute();
}

export async function insertSpan(db: Db, input: InsertSpanInput): Promise<void> {
  await db
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
    .execute();
}
