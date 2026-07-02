import type { TelemetryJobPayload } from "@sigmon/queues";
import {
  breadcrumbPayloadSchema,
  clickEventPayloadSchema,
  eventPayloadSchema,
  errorPayloadSchema,
  llmCallPayloadSchema,
  profilePayloadSchema,
  spanPayloadSchema,
  tracePayloadSchema,
  webVitalPayloadSchema
} from "@sigmon/telemetry/ingestion-schemas";
import { sanitizePreviewText, sanitizeValue } from "@sigmon/telemetry/sanitization";
import type { InsertDeadLetterJobInput } from "@sigmon/db/repositories/dead-letter.js";
import type {
  InsertBreadcrumbInput,
  InsertClickEventInput,
  InsertErrorInput,
  InsertEventInput,
  InsertLlmCallInput,
  InsertProfileInput,
  InsertSpanInput,
  InsertTraceInput,
  InsertWebVitalInput
} from "@sigmon/db/repositories/telemetry-writes.js";

export type TelemetryWriter = {
  insertEvent(input: InsertEventInput): Promise<void>;
  insertError(input: InsertErrorInput): Promise<void>;
  insertLlmCall(input: InsertLlmCallInput): Promise<void>;
  insertTrace(input: InsertTraceInput): Promise<void>;
  insertSpan(input: InsertSpanInput): Promise<void>;
  insertWebVital(input: InsertWebVitalInput): Promise<void>;
  insertClickEvent(input: InsertClickEventInput): Promise<void>;
  insertProfile(input: InsertProfileInput): Promise<void>;
  insertBreadcrumb?(input: InsertBreadcrumbInput): Promise<void>;
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
  const projectId =
    typeof input.payload === "object" &&
    input.payload !== null &&
    typeof (input.payload as { projectId?: unknown }).projectId === "string" &&
    (input.payload as { projectId: string }).projectId.length > 0
      ? (input.payload as { projectId: string }).projectId
      : null;
  const environmentId =
    typeof input.payload === "object" &&
    input.payload !== null &&
    typeof (input.payload as { environmentId?: unknown }).environmentId === "string" &&
    (input.payload as { environmentId: string }).environmentId.length > 0
      ? (input.payload as { environmentId: string }).environmentId
      : null;
  const scope =
    projectId !== null && environmentId !== null
      ? { projectId, environmentId }
      : { projectId: null, environmentId: null };

  return {
    ...scope,
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

    case "web_vital": {
      const payload = webVitalPayloadSchema.parse(job.payload);
      await writer.insertWebVital({
        ...baseInput(job, payload, receivedAt),
        name: payload.name,
        value: payload.value,
        rating: payload.rating,
        route: payload.route,
        navigationType: payload.navigation_type
      });
      return;
    }

    case "click": {
      const payload = clickEventPayloadSchema.parse(job.payload);
      await writer.insertClickEvent({
        ...baseInput(job, payload, receivedAt),
        route: payload.route,
        selector: payload.selector,
        elementTag: payload.element_tag,
        elementRole: payload.element_role,
        x: payload.x,
        y: payload.y,
        viewportWidth: payload.viewport_width,
        viewportHeight: payload.viewport_height,
        scrollX: payload.scroll_x,
        scrollY: payload.scroll_y,
        masked: payload.masked
      });
      return;
    }

    case "profile": {
      const payload = profilePayloadSchema.parse(job.payload);
      await writer.insertProfile({
        ...baseInput(job, payload, receivedAt, payload.started_at),
        name: payload.name,
        kind: payload.kind,
        runtime: payload.runtime,
        service: payload.service,
        route: payload.route,
        startedAt: new Date(payload.started_at),
        endedAt: payload.ended_at ? new Date(payload.ended_at) : undefined,
        durationMs: payload.duration_ms,
        sampleCount: payload.sample_count,
        samplingIntervalMs: payload.sampling_interval_ms,
        cpuUsagePercent: payload.cpu_usage_percent === undefined ? undefined : String(payload.cpu_usage_percent),
        cpuUserMs: payload.cpu_user_ms,
        cpuSystemMs: payload.cpu_system_ms,
        rssBytes: payload.rss_bytes === undefined ? undefined : String(payload.rss_bytes),
        heapUsedBytes: payload.heap_used_bytes === undefined ? undefined : String(payload.heap_used_bytes),
        heapTotalBytes: payload.heap_total_bytes === undefined ? undefined : String(payload.heap_total_bytes),
        externalBytes: payload.external_bytes === undefined ? undefined : String(payload.external_bytes),
        arrayBuffersBytes: payload.array_buffers_bytes === undefined ? undefined : String(payload.array_buffers_bytes),
        topFunctions: payload.top_functions.map((frame) => ({
          functionName: frame.function_name,
          url: frame.url,
          lineNumber: frame.line_number,
          columnNumber: frame.column_number,
          selfTimeMs: frame.self_time_ms,
          totalTimeMs: frame.total_time_ms,
          sampleCount: frame.sample_count
        })),
        summary: sanitizeValue(payload.summary)
      });
      return;
    }

    case "breadcrumb": {
      if (!writer.insertBreadcrumb) {
        throw new Error("Breadcrumb writer unavailable");
      }

      const payload = breadcrumbPayloadSchema.parse(job.payload);
      await writer.insertBreadcrumb({
        ...baseInput(job, payload, receivedAt),
        type: payload.type,
        category: payload.category,
        message: sanitizePreviewText(payload.message) ?? "breadcrumb",
        level: payload.level,
        data: sanitizeValue(payload.data)
      });
      return;
    }

    default:
      throw new Error(`Unknown telemetry job kind: ${(job as { kind: string }).kind}`);
  }
}
