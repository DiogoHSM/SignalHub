import { z } from "zod";

const SHORT_TEXT_MAX = 256;
const MEDIUM_TEXT_MAX = 2_000;
const LONG_TEXT_MAX = 20_000;

const shortTextSchema = z.string().min(1).max(SHORT_TEXT_MAX);
const mediumTextSchema = z.string().min(1).max(MEDIUM_TEXT_MAX);
const optionalMediumTextSchema = z.string().max(MEDIUM_TEXT_MAX).optional();
const jsonStringSchema = z.string().max(LONG_TEXT_MAX);

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    jsonStringSchema,
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
);

const jsonObjectSchema = z.record(z.string(), jsonValueSchema).default({});

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
  properties: jsonObjectSchema
});

export const errorPayloadSchema = sharedEnvelopeSchema.extend({
  message: mediumTextSchema,
  type: mediumTextSchema.optional(),
  severity: z.enum(["debug", "info", "warning", "error", "critical", "fatal"]).default("error"),
  stack: z.string().max(LONG_TEXT_MAX).optional(),
  fingerprint: mediumTextSchema.optional(),
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

export const breadcrumbPayloadSchema = sharedEnvelopeSchema.extend({
  type: z.enum(["navigation", "click", "console", "network", "custom"]),
  category: shortTextSchema.optional(),
  message: mediumTextSchema,
  level: z.enum(["debug", "info", "warning", "error", "fatal"]).default("info"),
  data: jsonObjectSchema
});

export type EventPayload = z.infer<typeof eventPayloadSchema>;
export type ErrorPayload = z.infer<typeof errorPayloadSchema>;
export type LlmCallPayload = z.infer<typeof llmCallPayloadSchema>;
export type TracePayload = z.infer<typeof tracePayloadSchema>;
export type SpanPayload = z.infer<typeof spanPayloadSchema>;
export type BreadcrumbPayload = z.infer<typeof breadcrumbPayloadSchema>;
