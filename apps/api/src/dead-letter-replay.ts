import type { DeadLetterJob } from "@sigmon/db/repositories/dead-letter.js";
import type { TelemetryJobPayload } from "@sigmon/queues";
import {
  breadcrumbPayloadSchema,
  eventPayloadSchema,
  errorPayloadSchema,
  llmCallPayloadSchema,
  spanPayloadSchema,
  tracePayloadSchema
} from "@sigmon/telemetry/ingestion-schemas";
import { z } from "zod";

const deadLetterTelemetryPayloadSchema = z.object({
  kind: z.enum(["event", "error", "llm", "trace", "span", "breadcrumb"]),
  id: z.string().min(1),
  projectId: z.string().min(1),
  environmentId: z.string().min(1),
  payload: z.record(z.string(), z.unknown())
});

export type DeadLetterReplayResult = "replayed" | "not_found" | "invalid_payload" | "unsupported_queue";

export type DeadLetterReplayDependencies = {
  getDeadLetterJob: (id: string) => Promise<DeadLetterJob | null | undefined>;
  enqueueReplay: (payload: TelemetryJobPayload, replayId: string) => Promise<unknown>;
  deleteDeadLetterJob: (id: string) => Promise<boolean>;
  createReplayAttemptId: () => string;
};

export async function replayDeadLetterTelemetryJob(
  dependencies: DeadLetterReplayDependencies,
  id: string
): Promise<DeadLetterReplayResult> {
  const deadLetterJob = await dependencies.getDeadLetterJob(id);
  if (!deadLetterJob) return "not_found";
  if (deadLetterJob.queueName !== "telemetry") return "unsupported_queue";

  const payload = parseDeadLetterTelemetryPayload(deadLetterJob.payload);
  if (!payload) return "invalid_payload";

  await dependencies.enqueueReplay(payload, `${id}|${dependencies.createReplayAttemptId()}`);
  const deleted = await dependencies.deleteDeadLetterJob(id);
  return deleted ? "replayed" : "not_found";
}

function parseDeadLetterTelemetryPayload(payload: unknown): TelemetryJobPayload | null {
  const envelope = deadLetterTelemetryPayloadSchema.safeParse(payload);
  if (!envelope.success) return null;

  const parsedPayload = parseTelemetryPayloadByKind(envelope.data.kind, envelope.data.payload);
  if (!parsedPayload) return null;

  return {
    kind: envelope.data.kind,
    id: envelope.data.id,
    projectId: envelope.data.projectId,
    environmentId: envelope.data.environmentId,
    payload: parsedPayload
  };
}

function parseTelemetryPayloadByKind(kind: TelemetryJobPayload["kind"], payload: Record<string, unknown>) {
  switch (kind) {
    case "event":
      return parsePayload(eventPayloadSchema, payload);
    case "error":
      return parsePayload(errorPayloadSchema, payload);
    case "llm":
      return parsePayload(llmCallPayloadSchema, payload);
    case "trace":
      return parsePayload(tracePayloadSchema, payload);
    case "span":
      return parsePayload(spanPayloadSchema, payload);
    case "breadcrumb":
      return parsePayload(breadcrumbPayloadSchema, payload);
  }
}

function parsePayload(schema: z.ZodType<Record<string, unknown>>, payload: Record<string, unknown>) {
  const parsed = schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
