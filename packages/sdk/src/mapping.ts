import type {
  BreadcrumbInput,
  ClickInput,
  ErrorInput,
  EventInput,
  IdentifyTenantInput,
  IdentifyUserInput,
  LlmInput,
  QueuedSignal,
  RuntimeProfileInput,
  SignalContext,
  SignalMetadata,
  SessionReplayInput,
  SpanInput,
  TraceInput,
  WebVitalInput
} from "./types.js";

const UNSERIALIZABLE_THROWN_VALUE_MESSAGE = "[Unserializable thrown value]";

export type EnvelopePayload = {
  timestamp?: string;
  tenant_id?: string;
  user_id?: string;
  session_id?: string;
  trace_id?: string;
  source?: string;
  release?: string;
  metadata: SignalMetadata;
};

export function serializeDate(value: Date | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}

export function mergeContext(
  defaultContext?: SignalContext,
  context?: SignalContext & EventInput
): EnvelopePayload {
  const merged: EnvelopePayload = {
    metadata: {
      ...(defaultContext?.metadata ?? {}),
      ...(context?.metadata ?? {})
    }
  };

  assignDefined(merged, "timestamp", serializeDate(context?.timestamp));
  assignDefined(merged, "tenant_id", context?.tenantId ?? defaultContext?.tenantId);
  assignDefined(merged, "user_id", context?.userId ?? defaultContext?.userId);
  assignDefined(merged, "session_id", context?.sessionId ?? defaultContext?.sessionId);
  assignDefined(merged, "trace_id", context?.traceId ?? defaultContext?.traceId);
  assignDefined(merged, "source", context?.source ?? defaultContext?.source);
  assignDefined(merged, "release", context?.release ?? defaultContext?.release);

  return merged;
}

export function createEventSignal(
  name: string,
  properties: SignalMetadata = {},
  context?: SignalContext & EventInput,
  defaultContext?: SignalContext
): QueuedSignal {
  const payload = {
    ...mergeContext(defaultContext, context),
    name,
    properties
  };
  assignDefined(payload, "replay_id", context?.replayId);

  return {
    kind: "event",
    endpointPath: "/v1/events",
    payload
  };
}

export function createErrorSignal(
  error: unknown,
  input?: ErrorInput,
  defaultContext?: SignalContext
): QueuedSignal {
  const extracted = extractError(error);
  const payload = {
    ...mergeContext(defaultContext, input),
    message: extracted.message,
    severity: input?.severity ?? "error",
    context: input?.context ?? {}
  };

  assignDefined(payload, "type", extracted.type);
  assignDefined(payload, "stack", extracted.stack);
  assignDefined(payload, "fingerprint", input?.fingerprint);
  assignDefined(payload, "replay_id", input?.replayId);

  return {
    kind: "error",
    endpointPath: "/v1/errors",
    payload
  };
}

export function createIdentifyUserSignal(
  userId: string,
  traits: SignalMetadata = {},
  context?: IdentifyUserInput
): QueuedSignal {
  const payload = {
    metadata: {},
    user_id: userId,
    traits
  };

  assignDefined(payload, "timestamp", serializeDate(context?.timestamp));
  assignDefined(payload, "tenant_id", context?.tenantId);

  return {
    kind: "identify_user",
    endpointPath: "/v1/identify/user",
    payload
  };
}

export function createIdentifyTenantSignal(
  tenantId: string,
  traits: SignalMetadata = {},
  context?: IdentifyTenantInput
): QueuedSignal {
  const payload = {
    metadata: {},
    tenant_id: tenantId,
    traits
  };

  assignDefined(payload, "timestamp", serializeDate(context?.timestamp));

  return {
    kind: "identify_tenant",
    endpointPath: "/v1/identify/tenant",
    payload
  };
}

export function createBreadcrumbSignal(
  input: BreadcrumbInput,
  context?: SignalContext,
  defaultContext?: SignalContext
): QueuedSignal {
  const payload = {
    ...mergeContext(defaultContext, { ...context, timestamp: input.timestamp }),
    type: input.type,
    message: input.message,
    data: input.data ?? {}
  };

  assignDefined(payload, "category", input.category);
  assignDefined(payload, "level", input.level);

  return {
    kind: "breadcrumb",
    endpointPath: "/v1/breadcrumbs",
    payload
  };
}

export function createLlmSignal(
  input: LlmInput,
  context?: SignalContext,
  defaultContext?: SignalContext
): QueuedSignal {
  const payload = {
    ...mergeContext(defaultContext, { ...context, timestamp: input.timestamp }),
    provider: input.provider,
    model: input.model
  };

  assignDefined(payload, "prompt_name", input.promptName);
  assignDefined(payload, "input_tokens", input.inputTokens);
  assignDefined(payload, "output_tokens", input.outputTokens);
  assignDefined(payload, "cost_usd", input.costUsd);
  assignDefined(payload, "latency_ms", input.latencyMs);
  assignDefined(payload, "status", input.status);
  assignDefined(payload, "error", input.error);
  assignDefined(payload, "input_preview", input.inputPreview);
  assignDefined(payload, "output_preview", input.outputPreview);

  return {
    kind: "llm",
    endpointPath: "/v1/llm",
    payload
  };
}

export function createTraceSignal(
  input: TraceInput,
  context?: SignalContext,
  defaultContext?: SignalContext
): QueuedSignal {
  const startedAt = input.startedAt ?? new Date();
  const payload = {
    ...mergeContext(defaultContext, { ...context, timestamp: input.timestamp }),
    name: input.name,
    status: input.status ?? "pending",
    started_at: serializeDate(startedAt)
  };

  assignDefined(payload, "ended_at", serializeDate(input.endedAt));
  assignDefined(payload, "duration_ms", input.durationMs ?? computeDurationMs(startedAt, input.endedAt));

  return {
    kind: "trace",
    endpointPath: "/v1/traces",
    payload
  };
}

export function createSpanSignal(
  input: SpanInput,
  context?: SignalContext,
  defaultContext?: SignalContext
): QueuedSignal {
  const startedAt = input.startedAt ?? new Date();
  const payload = {
    ...mergeContext(defaultContext, { ...context, timestamp: input.timestamp }),
    trace_id: input.traceId,
    name: input.name,
    status: input.status ?? "pending",
    started_at: serializeDate(startedAt)
  };

  assignDefined(payload, "parent_span_id", input.parentSpanId);
  assignDefined(payload, "ended_at", serializeDate(input.endedAt));
  assignDefined(payload, "duration_ms", input.durationMs ?? computeDurationMs(startedAt, input.endedAt));
  assignDefined(payload, "input", input.input);
  assignDefined(payload, "output", input.output);
  assignDefined(payload, "error", input.error);
  assignDefined(payload, "cost_usd", input.costUsd);

  return {
    kind: "span",
    endpointPath: "/v1/spans",
    payload
  };
}

export function createWebVitalSignal(
  input: WebVitalInput,
  context?: SignalContext,
  defaultContext?: SignalContext
): QueuedSignal {
  const mergedContext = {
    ...context,
    timestamp: input.timestamp,
    metadata: {
      ...(context?.metadata ?? {}),
      ...(input.metadata ?? {})
    }
  };
  const payload = {
    ...mergeContext(defaultContext, mergedContext),
    name: input.name,
    value: input.value
  };

  assignDefined(payload, "rating", input.rating);
  assignDefined(payload, "route", input.route);
  assignDefined(payload, "navigation_type", input.navigationType);

  return {
    kind: "web_vital",
    endpointPath: "/v1/web-vitals",
    payload
  };
}

export function createClickSignal(
  input: ClickInput,
  context?: SignalContext,
  defaultContext?: SignalContext
): QueuedSignal {
  const payload = {
    ...mergeContext(defaultContext, { ...context, timestamp: input.timestamp }),
    route: input.route,
    selector: input.selector,
    x: input.x,
    y: input.y,
    viewport_width: input.viewportWidth,
    viewport_height: input.viewportHeight,
    masked: input.masked ?? true
  };

  assignDefined(payload, "element_tag", input.elementTag);
  assignDefined(payload, "element_role", input.elementRole);
  assignDefined(payload, "scroll_x", input.scrollX);
  assignDefined(payload, "scroll_y", input.scrollY);

  return {
    kind: "click",
    endpointPath: "/v1/clicks",
    payload
  };
}

export function createSessionReplaySignal(
  input: SessionReplayInput,
  context?: SignalContext,
  defaultContext?: SignalContext
): QueuedSignal {
  const startedAt = input.startedAt ?? new Date();
  const endedAt = input.endedAt;
  const payload = {
    ...mergeContext(defaultContext, { ...context, timestamp: input.timestamp }),
    replay_id: input.replayId,
    started_at: serializeDate(startedAt),
    events: (input.events ?? []).map((event) => ({
      offset_ms: event.offsetMs,
      type: event.type,
      route: event.route,
      selector: event.selector,
      message: event.message,
      x: event.x,
      y: event.y,
      data: event.data ?? {}
    })),
    masked: input.masked ?? true
  };

  assignDefined(payload, "ended_at", serializeDate(endedAt));
  assignDefined(payload, "duration_ms", input.durationMs ?? computeDurationMs(startedAt, endedAt));
  assignDefined(payload, "route", input.route);
  assignDefined(payload, "error_id", input.errorId);

  return {
    kind: "replay",
    endpointPath: "/v1/replays",
    payload
  };
}

export function createRuntimeProfileSignal(
  input: RuntimeProfileInput,
  context?: SignalContext,
  defaultContext?: SignalContext
): QueuedSignal {
  const startedAt = input.startedAt ?? new Date();
  const endedAt = input.endedAt;
  const mergedContext = {
    ...context,
    timestamp: input.timestamp,
    metadata: {
      ...(context?.metadata ?? {}),
      ...(input.metadata ?? {})
    }
  };
  const payload = {
    ...mergeContext(defaultContext, mergedContext),
    name: input.name,
    kind: input.kind,
    runtime: input.runtime ?? "node",
    started_at: serializeDate(startedAt),
    sample_count: input.sampleCount ?? 0,
    top_functions: (input.topFunctions ?? []).map((frame) => ({
      function_name: frame.functionName,
      url: frame.url,
      line_number: frame.lineNumber,
      column_number: frame.columnNumber,
      self_time_ms: frame.selfTimeMs ?? 0,
      total_time_ms: frame.totalTimeMs,
      sample_count: frame.sampleCount ?? 0
    })),
    summary: input.summary ?? {}
  };

  assignDefined(payload, "service", input.service);
  assignDefined(payload, "route", input.route);
  assignDefined(payload, "ended_at", serializeDate(endedAt));
  assignDefined(payload, "duration_ms", input.durationMs ?? computeDurationMs(startedAt, endedAt));
  assignDefined(payload, "sampling_interval_ms", input.samplingIntervalMs);
  assignDefined(payload, "cpu_usage_percent", input.cpuUsagePercent);
  assignDefined(payload, "cpu_user_ms", input.cpuUserMs);
  assignDefined(payload, "cpu_system_ms", input.cpuSystemMs);
  assignDefined(payload, "rss_bytes", input.rssBytes);
  assignDefined(payload, "heap_used_bytes", input.heapUsedBytes);
  assignDefined(payload, "heap_total_bytes", input.heapTotalBytes);
  assignDefined(payload, "external_bytes", input.externalBytes);
  assignDefined(payload, "array_buffers_bytes", input.arrayBuffersBytes);

  return {
    kind: "profile",
    endpointPath: "/v1/profiles",
    payload
  };
}

function assignDefined(
  payload: Record<string, unknown>,
  key: string,
  value: unknown | undefined
): void {
  if (value !== undefined) {
    payload[key] = value;
  }
}

function computeDurationMs(
  startedAt: Date | string | undefined,
  endedAt: Date | string | undefined
): number | undefined {
  if (startedAt === undefined || endedAt === undefined) {
    return undefined;
  }

  const startedAtMs = toEpochMs(startedAt);
  const endedAtMs = toEpochMs(endedAt);

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return undefined;
  }

  return Math.max(0, Math.round(endedAtMs - startedAtMs));
}

function toEpochMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function extractError(error: unknown): { message: string; type?: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      type: error.name,
      stack: error.stack
    };
  }

  if (typeof error === "string") {
    return { message: error };
  }

  return { message: stringifyUnknown(error) };
}

function stringifyUnknown(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);

    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // Fall through to String(value) for circular or otherwise unserializable values.
  }

  try {
    return String(value);
  } catch {
    return UNSERIALIZABLE_THROWN_VALUE_MESSAGE;
  }
}
