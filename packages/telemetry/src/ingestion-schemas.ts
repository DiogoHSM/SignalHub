import { z } from "zod";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
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
  tenant_id: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
  trace_id: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  release: z.string().min(1).optional(),
  metadata: jsonObjectSchema
});

export const eventPayloadSchema = sharedEnvelopeSchema.extend({
  name: z.string().min(1),
  properties: jsonObjectSchema
});

export const errorPayloadSchema = sharedEnvelopeSchema.extend({
  message: z.string().min(1),
  type: z.string().min(1).optional(),
  severity: z.enum(["debug", "info", "warning", "error", "critical"]).default("error"),
  stack: z.string().optional(),
  fingerprint: z.string().min(1).optional(),
  context: jsonObjectSchema
});

export const llmCallPayloadSchema = sharedEnvelopeSchema.extend({
  provider: z.string().min(1),
  model: z.string().min(1),
  prompt_name: z.string().min(1).optional(),
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  cost_usd: z.number().nonnegative().default(0),
  latency_ms: z.number().int().nonnegative().optional(),
  status: z.enum(["success", "error", "pending"]).default("success"),
  error: z.string().optional(),
  input_preview: z.string().optional(),
  output_preview: z.string().optional()
});

export const tracePayloadSchema = sharedEnvelopeSchema.extend({
  name: z.string().min(1),
  status: z.enum(["success", "error", "pending"]).default("pending"),
  started_at: timestampSchema,
  ended_at: timestampSchema.optional(),
  duration_ms: z.number().int().nonnegative().optional()
});

export const spanPayloadSchema = sharedEnvelopeSchema.extend({
  trace_id: z.string().min(1),
  parent_span_id: z.string().min(1).optional(),
  name: z.string().min(1),
  status: z.enum(["success", "error", "pending"]).default("pending"),
  started_at: timestampSchema,
  ended_at: timestampSchema.optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  input: jsonValueSchema.optional(),
  output: jsonValueSchema.optional(),
  error: jsonValueSchema.optional(),
  cost_usd: z.number().nonnegative().optional()
});

export type EventPayload = z.infer<typeof eventPayloadSchema>;
export type ErrorPayload = z.infer<typeof errorPayloadSchema>;
export type LlmCallPayload = z.infer<typeof llmCallPayloadSchema>;
export type TracePayload = z.infer<typeof tracePayloadSchema>;
export type SpanPayload = z.infer<typeof spanPayloadSchema>;
