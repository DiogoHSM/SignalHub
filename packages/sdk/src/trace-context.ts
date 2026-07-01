import { customAlphabet } from "nanoid";

export type TraceContext = {
  traceId: string;
  spanId: string;
  traceparent: string;
};

const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const randomTraceId = customAlphabet("0123456789abcdef", 32);
const randomSpanId = customAlphabet("0123456789abcdef", 16);

export function createTraceContext(traceId?: string, spanId?: string): TraceContext {
  const resolvedTraceId = isW3cTraceId(traceId) ? traceId : randomTraceId();
  const resolvedSpanId = isW3cSpanId(spanId) ? spanId : randomSpanId();
  const traceparent = `00-${resolvedTraceId}-${resolvedSpanId}-01`;

  return {
    traceId: resolvedTraceId,
    spanId: resolvedSpanId,
    traceparent
  };
}

export function parseTraceparent(value: string | undefined | null): TraceContext | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.trim().toLowerCase().match(TRACEPARENT_REGEX);
  if (!match) {
    return undefined;
  }

  const [, traceId, spanId] = match;
  if (!isW3cTraceId(traceId) || !isW3cSpanId(spanId)) {
    return undefined;
  }

  return {
    traceId,
    spanId,
    traceparent: `00-${traceId}-${spanId}-01`
  };
}

export function traceContextHeaders(context: TraceContext): Record<string, string> {
  return { traceparent: context.traceparent };
}

function isW3cTraceId(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value) && value !== "0".repeat(32);
}

function isW3cSpanId(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{16}$/.test(value) && value !== "0".repeat(16);
}
