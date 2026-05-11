import type { TelemetryJobPayload } from "@signal-hub/queues";
import {
  eventPayloadSchema,
  errorPayloadSchema,
  llmCallPayloadSchema,
  spanPayloadSchema,
  tracePayloadSchema
} from "@signal-hub/telemetry/ingestion-schemas";
import { sanitizePreviewText, sanitizeValue } from "@signal-hub/telemetry/sanitization";
import type { InsertDeadLetterJobInput } from "@signal-hub/db/repositories/dead-letter.js";
import type {
  InsertErrorInput,
  InsertEventInput,
  InsertLlmCallInput,
  InsertSpanInput,
  InsertTraceInput
} from "@signal-hub/db/repositories/telemetry-writes.js";

export type TelemetryWriter = {
  insertEvent(input: InsertEventInput): Promise<void>;
  insertError(input: InsertErrorInput): Promise<void>;
  insertLlmCall(input: InsertLlmCallInput): Promise<void>;
  insertTrace(input: InsertTraceInput): Promise<void>;
  insertSpan(input: InsertSpanInput): Promise<void>;
};

export type BackfillErrorGroups = (
  input: { batchSize: number }
) => Promise<{ processed: number; selected: number; batchSize: number }>;

export async function backfillErrorGroupsUntilDrained(
  backfill: BackfillErrorGroups,
  batchSize: number
): Promise<{ processed: number; selected: number; batches: number }> {
  let processed = 0;
  let selected = 0;
  let batches = 0;

  while (true) {
    const result = await backfill({ batchSize });
    processed += result.processed;
    selected += result.selected;
    batches += 1;

    if (result.selected < result.batchSize) {
      return { processed, selected, batches };
    }
  }
}

export function buildDeadLetterJobInput(input: {
  queueName: string;
  jobName: string;
  payload: unknown;
  error: unknown;
}): InsertDeadLetterJobInput {
  const errorMessage = input.error instanceof Error ? input.error.message : String(input.error);

  return {
    queueName: input.queueName,
    jobName: input.jobName,
    payload: sanitizeValue(input.payload),
    errorMessage: sanitizePreviewText(errorMessage) ?? "unknown_error"
  };
}

type ParsedEnvelope = {
  timestamp?: string;
  tenant_id?: string;
  user_id?: string;
  session_id?: string;
  trace_id?: string;
  source?: string;
  release?: string;
  metadata: Record<string, unknown>;
};

function baseInput(job: TelemetryJobPayload, payload: ParsedEnvelope, receivedAt: Date, timestampFallback?: string) {
  const timestamp = payload.timestamp ?? timestampFallback;

  return {
    id: job.id,
    projectId: job.projectId,
    environmentId: job.environmentId,
    tenantId: payload.tenant_id,
    userId: payload.user_id,
    sessionId: payload.session_id,
    traceId: payload.trace_id,
    timestamp: timestamp ? new Date(timestamp) : receivedAt,
    receivedAt,
    source: payload.source,
    release: payload.release,
    metadata: sanitizeValue(payload.metadata)
  };
}

export async function processTelemetryJob(job: TelemetryJobPayload, writer: TelemetryWriter): Promise<void> {
  const receivedAt = new Date();

  switch (job.kind) {
    case "event": {
      const payload = eventPayloadSchema.parse(job.payload);
      await writer.insertEvent({
        ...baseInput(job, payload, receivedAt),
        name: payload.name,
        properties: sanitizeValue(payload.properties)
      });
      return;
    }

    case "error": {
      const payload = errorPayloadSchema.parse(job.payload);
      await writer.insertError({
        ...baseInput(job, payload, receivedAt),
        message: payload.message,
        type: payload.type,
        severity: payload.severity,
        stack: payload.stack,
        fingerprint: payload.fingerprint,
        context: sanitizeValue(payload.context)
      });
      return;
    }

    case "llm": {
      const payload = llmCallPayloadSchema.parse(job.payload);
      await writer.insertLlmCall({
        ...baseInput(job, payload, receivedAt),
        provider: payload.provider,
        model: payload.model,
        promptName: payload.prompt_name,
        inputTokens: payload.input_tokens,
        outputTokens: payload.output_tokens,
        costUsd: String(payload.cost_usd),
        latencyMs: payload.latency_ms,
        status: payload.status,
        error: sanitizePreviewText(payload.error),
        inputPreview: sanitizePreviewText(payload.input_preview),
        outputPreview: sanitizePreviewText(payload.output_preview)
      });
      return;
    }

    case "trace": {
      const payload = tracePayloadSchema.parse(job.payload);
      await writer.insertTrace({
        ...baseInput(job, payload, receivedAt, payload.started_at),
        name: payload.name,
        status: payload.status,
        startedAt: new Date(payload.started_at),
        endedAt: payload.ended_at ? new Date(payload.ended_at) : undefined,
        durationMs: payload.duration_ms
      });
      return;
    }

    case "span": {
      const payload = spanPayloadSchema.parse(job.payload);
      await writer.insertSpan({
        ...baseInput(job, payload, receivedAt, payload.started_at),
        traceId: payload.trace_id,
        parentSpanId: payload.parent_span_id,
        name: payload.name,
        status: payload.status,
        startedAt: new Date(payload.started_at),
        endedAt: payload.ended_at ? new Date(payload.ended_at) : undefined,
        durationMs: payload.duration_ms,
        input: sanitizeValue(payload.input),
        output: sanitizeValue(payload.output),
        error: sanitizeValue(payload.error),
        costUsd: payload.cost_usd === undefined ? undefined : String(payload.cost_usd)
      });
      return;
    }

    default:
      throw new Error(`Unknown telemetry job kind: ${(job as { kind: string }).kind}`);
  }
}
