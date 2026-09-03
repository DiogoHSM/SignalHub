import { z } from "zod";
import { generalTelemetryJsonBounds, inspectJsonBounds } from "./json-bounds.js";

const SHORT_TEXT_MAX = 256;
const MEDIUM_TEXT_MAX = 2_000;
const LONG_TEXT_MAX = 20_000;
const PROFILE_TOP_FUNCTIONS_MAX = 100;
const REPLAY_EVENTS_MAX = 300;
const REPLAY_PAYLOAD_MAX_BYTES = 64 * 1024;
const REPLAY_EVENT_DATA_MAX_DEPTH = 5;
const REPLAY_EVENT_DATA_MAX_KEYS = 64;
const REPLAY_FORBIDDEN_EVENT_KEYS = new Set(["value", "text", "innertext", "innerhtml", "html", "password"]);
const UTF8_ENCODER = new TextEncoder();

const shortTextSchema = z.string().min(1).max(SHORT_TEXT_MAX);
const mediumTextSchema = z.string().min(1).max(MEDIUM_TEXT_MAX);
const optionalMediumTextSchema = z.string().max(MEDIUM_TEXT_MAX).optional();
const jsonStringSchema = z.string().max(LONG_TEXT_MAX);

function addGeneralJsonBoundsIssue(value: unknown, context: z.RefinementCtx): void {
  const result = inspectJsonBounds(value, generalTelemetryJsonBounds);
  if (result.ok) return;

  const messageByViolation = {
    depth: `Telemetry JSON values must not exceed ${generalTelemetryJsonBounds.maxDepth} container levels`,
    nodes: `Telemetry JSON values must not exceed ${generalTelemetryJsonBounds.maxNodes} nodes`,
    keys: `Telemetry JSON values must not exceed ${generalTelemetryJsonBounds.maxKeys} object keys`,
    array_length: `Telemetry JSON arrays must not exceed ${generalTelemetryJsonBounds.maxArrayLength} items`,
    cycle: "Telemetry JSON values must not contain cyclic references"
  } as const;

  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: result.path,
    message: messageByViolation[result.violation]
  });
}

function generalJsonPreflightSchema() {
  return z.unknown().superRefine(addGeneralJsonBoundsIssue);
}

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  generalJsonPreflightSchema().pipe(
    z.union([
      jsonStringSchema,
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(z.string(), jsonValueSchema)
    ])
  )
);

const jsonObjectSchema = generalJsonPreflightSchema().pipe(z.record(z.string(), jsonValueSchema)).default({});

type JsonObjectBounds = {
  maxDepth: number;
  maxKeys: number;
};

function serializedUtf8ByteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : UTF8_ENCODER.encode(serialized).byteLength;
  } catch {
    return null;
  }
}

type ReplayDataInspection = {
  depthExceeded: boolean;
  keyCount: number;
  forbiddenPath: Array<string | number> | null;
  cyclePath: Array<string | number> | null;
};

function inspectReplayData(value: unknown, bounds: JsonObjectBounds): ReplayDataInspection {
  const pending: Array<{
    value: unknown;
    depth: number;
    path: Array<string | number>;
    phase: "enter" | "exit";
  }> = [
    { value, depth: 1, path: [], phase: "enter" }
  ];
  const active = new WeakSet<object>();
  const completed = new WeakSet<object>();
  let depthExceeded = false;
  let keyCount = 0;
  let forbiddenPath: Array<string | number> | null = null;
  let cyclePath: Array<string | number> | null = null;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || current.value === null || typeof current.value !== "object") continue;
    const objectValue = current.value as object;
    if (current.phase === "exit") {
      active.delete(objectValue);
      completed.add(objectValue);
      continue;
    }
    if (active.has(objectValue)) {
      cyclePath ??= current.path;
      continue;
    }
    if (completed.has(objectValue)) continue;
    if (current.depth > bounds.maxDepth) {
      depthExceeded = true;
      continue;
    }

    active.add(objectValue);
    pending.push({ ...current, phase: "exit" });
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          depth: current.depth + 1,
          path: [...current.path, index],
          phase: "enter"
        });
      }
      continue;
    }

    const entries = Object.entries(current.value);
    keyCount += entries.length;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, nested] = entries[index]!;
      const path = [...current.path, key];
      if (!forbiddenPath && REPLAY_FORBIDDEN_EVENT_KEYS.has(key.toLowerCase())) forbiddenPath = path;
      if (nested !== null && typeof nested === "object") {
        pending.push({ value: nested, depth: current.depth + 1, path, phase: "enter" });
      }
    }
  }

  return { depthExceeded, keyCount, forbiddenPath, cyclePath };
}

function preflightReplayPayload(value: unknown, context: z.RefinementCtx): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return true;
  const events = (value as Record<string, unknown>).events;
  if (!Array.isArray(events)) return true;

  let safeForRecursiveParsing = true;
  events.forEach((event, index) => {
    if (event === null || typeof event !== "object" || Array.isArray(event)) return;
    const eventRecord = event as Record<string, unknown>;
    for (const key of Object.keys(eventRecord)) {
      if (REPLAY_FORBIDDEN_EVENT_KEYS.has(key.toLowerCase())) {
        safeForRecursiveParsing = false;
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", index, key],
          message: "Replay events must not include raw text, HTML, input values, or passwords"
        });
      }
    }

    const data = eventRecord.data;
    if (data === null || typeof data !== "object" || Array.isArray(data)) return;
    const inspection = inspectReplayData(data, {
      maxDepth: REPLAY_EVENT_DATA_MAX_DEPTH,
      maxKeys: REPLAY_EVENT_DATA_MAX_KEYS
    });
    if (inspection.depthExceeded) {
      safeForRecursiveParsing = false;
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", index, "data"],
        message: "Replay event data must not exceed 5 container levels"
      });
    }
    if (inspection.keyCount > REPLAY_EVENT_DATA_MAX_KEYS) {
      safeForRecursiveParsing = false;
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", index, "data"],
        message: "Replay event data must not exceed 64 object keys"
      });
    }
    if (inspection.forbiddenPath) {
      safeForRecursiveParsing = false;
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", index, "data", ...inspection.forbiddenPath],
        message: "Replay events must not include raw text, HTML, input values, or passwords"
      });
    }
    if (inspection.cyclePath) {
      safeForRecursiveParsing = false;
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", index, "data", ...inspection.cyclePath],
        message: "Replay event data must not contain cyclic references"
      });
    }
  });

  return safeForRecursiveParsing;
}

const timestampSchema = z.string().datetime();

export const sharedEnvelopeSchema = z.object({
  timestamp: timestampSchema.optional(),
  tenant_id: shortTextSchema.optional(),
  user_id: shortTextSchema.optional(),
  session_id: shortTextSchema.optional(),
  trace_id: shortTextSchema.optional(),
  source: shortTextSchema.optional(),
  release: shortTextSchema.optional(),
  metadata: jsonObjectSchema
});

export const eventPayloadSchema = sharedEnvelopeSchema.extend({
  name: shortTextSchema,
  replay_id: shortTextSchema.optional(),
  properties: jsonObjectSchema
});

export const errorPayloadSchema = sharedEnvelopeSchema.extend({
  message: mediumTextSchema,
  type: mediumTextSchema.optional(),
  severity: z.enum(["debug", "info", "warning", "error", "critical", "fatal"]).default("error"),
  stack: z.string().max(LONG_TEXT_MAX).optional(),
  fingerprint: mediumTextSchema.optional(),
  replay_id: shortTextSchema.optional(),
  context: jsonObjectSchema
});

export const llmCallPayloadSchema = sharedEnvelopeSchema.extend({
  provider: shortTextSchema,
  model: shortTextSchema,
  prompt_name: shortTextSchema.optional(),
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  cost_usd: z.number().nonnegative().default(0),
  latency_ms: z.number().int().nonnegative().optional(),
  status: z.enum(["success", "error", "pending"]).default("success"),
  error: optionalMediumTextSchema,
  input_preview: optionalMediumTextSchema,
  output_preview: optionalMediumTextSchema
});

export const tracePayloadSchema = sharedEnvelopeSchema.extend({
  name: shortTextSchema,
  status: z.enum(["success", "error", "pending"]).default("pending"),
  started_at: timestampSchema,
  ended_at: timestampSchema.optional(),
  duration_ms: z.number().int().nonnegative().optional()
});

export const spanPayloadSchema = sharedEnvelopeSchema.extend({
  trace_id: shortTextSchema,
  parent_span_id: shortTextSchema.optional(),
  name: shortTextSchema,
  status: z.enum(["success", "error", "pending"]).default("pending"),
  started_at: timestampSchema,
  ended_at: timestampSchema.optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  input: jsonValueSchema.optional(),
  output: jsonValueSchema.optional(),
  error: jsonValueSchema.optional(),
  cost_usd: z.number().nonnegative().optional()
});

export const webVitalPayloadSchema = sharedEnvelopeSchema.extend({
  name: z.enum(["CLS", "FCP", "FID", "INP", "LCP", "TTFB"]),
  value: z.number().nonnegative(),
  rating: z.enum(["good", "needs-improvement", "poor"]).default("good"),
  route: shortTextSchema.optional(),
  navigation_type: shortTextSchema.optional()
});

export const clickEventPayloadSchema = sharedEnvelopeSchema.extend({
  route: shortTextSchema,
  selector: shortTextSchema,
  element_tag: shortTextSchema.optional(),
  element_role: shortTextSchema.optional(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  viewport_width: z.number().int().positive().max(20_000),
  viewport_height: z.number().int().positive().max(20_000),
  scroll_x: z.number().int().nonnegative().max(1_000_000).optional(),
  scroll_y: z.number().int().nonnegative().max(1_000_000).optional(),
  masked: z.boolean().default(true)
});

const replayEventDataSchema = jsonObjectSchema;
const replayMessageSchema = z.string().max(MEDIUM_TEXT_MAX).transform(() => "[REDACTED]").optional();

const replayEventSchema = z
  .object({
    offset_ms: z.number().int().nonnegative().max(24 * 60 * 60 * 1000),
    type: z.enum(["navigation", "click", "input", "console", "network", "error", "custom"]),
    route: shortTextSchema.optional(),
    selector: shortTextSchema.optional(),
    message: replayMessageSchema,
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
    data: replayEventDataSchema
  })
  .strict();

const sessionReplayPayloadShapeSchema = sharedEnvelopeSchema.extend({
  replay_id: shortTextSchema,
  started_at: timestampSchema,
  ended_at: timestampSchema.optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  route: shortTextSchema.optional(),
  error_id: shortTextSchema.optional(),
  masked: z.boolean().default(true),
  events: z.array(replayEventSchema).max(REPLAY_EVENTS_MAX).default([])
});

export const sessionReplayPayloadSchema = z
  .unknown()
  .superRefine(addGeneralJsonBoundsIssue)
  .superRefine((value, context) => {
    if (!preflightReplayPayload(value, context)) return;
    const byteLength = serializedUtf8ByteLength(value);
    if (byteLength !== null && byteLength > REPLAY_PAYLOAD_MAX_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Session replay payload must not exceed 64 KiB"
      });
    }
  })
  .pipe(sessionReplayPayloadShapeSchema);

const profileFunctionSchema = z.object({
  function_name: shortTextSchema,
  url: z.string().max(MEDIUM_TEXT_MAX).optional(),
  line_number: z.number().int().nonnegative().optional(),
  column_number: z.number().int().nonnegative().optional(),
  self_time_ms: z.number().nonnegative().default(0),
  total_time_ms: z.number().nonnegative().optional(),
  sample_count: z.number().int().nonnegative().default(0)
});

export const profilePayloadSchema = sharedEnvelopeSchema
  .extend({
    name: shortTextSchema,
    kind: z.enum(["cpu", "memory"]),
    runtime: shortTextSchema.default("node"),
    service: shortTextSchema.optional(),
    route: shortTextSchema.optional(),
    started_at: timestampSchema,
    ended_at: timestampSchema.optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    sample_count: z.number().int().nonnegative().default(0),
    sampling_interval_ms: z.number().int().positive().optional(),
    cpu_usage_percent: z.number().min(0).max(100).optional(),
    cpu_user_ms: z.number().int().nonnegative().optional(),
    cpu_system_ms: z.number().int().nonnegative().optional(),
    rss_bytes: z.number().int().nonnegative().optional(),
    heap_used_bytes: z.number().int().nonnegative().optional(),
    heap_total_bytes: z.number().int().nonnegative().optional(),
    external_bytes: z.number().int().nonnegative().optional(),
    array_buffers_bytes: z.number().int().nonnegative().optional(),
    top_functions: z.array(profileFunctionSchema).max(PROFILE_TOP_FUNCTIONS_MAX).default([]),
    summary: jsonObjectSchema
  })
  .superRefine((value, context) => {
    if (
      value.kind === "cpu" &&
      value.cpu_usage_percent === undefined &&
      value.cpu_user_ms === undefined &&
      value.cpu_system_ms === undefined &&
      value.sample_count === 0 &&
      value.top_functions.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kind"],
        message: "CPU profiles require at least one CPU measurement or top function"
      });
    }

    if (
      value.kind === "memory" &&
      value.rss_bytes === undefined &&
      value.heap_used_bytes === undefined &&
      value.heap_total_bytes === undefined &&
      value.external_bytes === undefined &&
      value.array_buffers_bytes === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kind"],
        message: "Memory profiles require at least one memory measurement"
      });
    }
  });

export const surveyResponsePayloadSchema = sharedEnvelopeSchema.extend({
  survey_id: shortTextSchema,
  actor_type: z.enum(["user", "tenant", "session", "anonymous"]).default("user"),
  actor_id: shortTextSchema.optional(),
  answers: jsonObjectSchema
});

export const feedbackPayloadSchema = sharedEnvelopeSchema.extend({
  message: mediumTextSchema,
  category: shortTextSchema.optional(),
  page_url: z.string().url().max(MEDIUM_TEXT_MAX).optional(),
  path: z.string().max(MEDIUM_TEXT_MAX).optional(),
  user_agent: z.string().max(MEDIUM_TEXT_MAX).optional()
});

export const breadcrumbPayloadSchema = sharedEnvelopeSchema.extend({
  type: z.enum(["navigation", "click", "console", "network", "custom"]),
  category: shortTextSchema.optional(),
  message: mediumTextSchema,
  level: z.enum(["debug", "info", "warning", "error", "fatal"]).default("info"),
  data: jsonObjectSchema
});

export const userIdentifyPayloadSchema = sharedEnvelopeSchema
  .pick({ timestamp: true, tenant_id: true, metadata: true })
  .extend({
    user_id: shortTextSchema,
    traits: jsonObjectSchema
  });

export const tenantIdentifyPayloadSchema = sharedEnvelopeSchema.pick({ timestamp: true, metadata: true }).extend({
  tenant_id: shortTextSchema,
  traits: jsonObjectSchema
});

export type EventPayload = z.infer<typeof eventPayloadSchema>;
export type ErrorPayload = z.infer<typeof errorPayloadSchema>;
export type LlmCallPayload = z.infer<typeof llmCallPayloadSchema>;
export type TracePayload = z.infer<typeof tracePayloadSchema>;
export type SpanPayload = z.infer<typeof spanPayloadSchema>;
export type WebVitalPayload = z.infer<typeof webVitalPayloadSchema>;
export type ClickEventPayload = z.infer<typeof clickEventPayloadSchema>;
export type SessionReplayPayload = z.infer<typeof sessionReplayPayloadSchema>;
export type ProfilePayload = z.infer<typeof profilePayloadSchema>;
export type SurveyResponsePayload = z.infer<typeof surveyResponsePayloadSchema>;
export type FeedbackPayload = z.infer<typeof feedbackPayloadSchema>;
export type BreadcrumbPayload = z.infer<typeof breadcrumbPayloadSchema>;
export type UserIdentifyPayload = z.infer<typeof userIdentifyPayloadSchema>;
export type TenantIdentifyPayload = z.infer<typeof tenantIdentifyPayloadSchema>;
