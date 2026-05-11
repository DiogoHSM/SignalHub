import { nanoid } from "nanoid";
import {
  createBreadcrumbSignal,
  createErrorSignal,
  createEventSignal,
  createLlmSignal,
  createSpanSignal,
  createTraceSignal
} from "./mapping.js";
import { createSignalQueue } from "./queue.js";
import { sendSignal } from "./retry.js";
import { enforcePayloadSize, sanitizePayload } from "./sanitize.js";
import type {
  ActiveTrace,
  BreadcrumbInput,
  EndTraceInput,
  ErrorInput,
  FlushOptions,
  FlushResult,
  LlmInput,
  QueuedSignal,
  SignalContext,
  SignalHubClient,
  SignalHubClientOptions,
  SignalHubError,
  SignalMetadata,
  SpanInput,
  StartTraceInput,
  TraceInput
} from "./types.js";
import {
  DEFAULT_MAX_QUEUE_SIZE,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_SERIALIZED_PAYLOAD_BYTES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RETRY_BASE_DELAY_MS
} from "./types.js";

export function createSignalHubClient(options: SignalHubClientOptions): SignalHubClient {
  if (!options.endpoint) {
    throw new Error("endpoint is required");
  }

  if (!options.apiKey) {
    throw new Error("apiKey is required");
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("fetch is required");
  }

  const endpoint = options.endpoint.replace(/\/+$/, "");
  const apiKey = options.apiKey;
  const maxSerializedPayloadBytes =
    options.maxSerializedPayloadBytes ?? DEFAULT_MAX_SERIALIZED_PAYLOAD_BYTES;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const queue = createSignalQueue(options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE);

  let defaultContext = cloneContext(options.defaultContext);
  let localDropped = 0;
  let inFlightFlush: Promise<FlushResult> | undefined;
  let pendingFlushAfterActive: Promise<FlushResult> | undefined;
  let queuedDuringActiveFlush = false;
  let interval: ReturnType<typeof setInterval> | undefined;

  const reportError = (error: SignalHubError): void => {
    try {
      options.onError?.(error);
    } catch {
      // User-provided error observers must not break SDK delivery bookkeeping.
    }
  };

  const enqueue = (signal: QueuedSignal): void => {
    const payload = sanitizePayload(signal.payload);
    const size = enforcePayloadSize(payload, maxSerializedPayloadBytes);

    if (!size.ok) {
      localDropped += 1;
      reportError({
        code: "payload_too_large",
        message: "Signal payload exceeds the configured size limit"
      });
      return;
    }

    const result = queue.enqueue({ ...signal, payload });

    if (inFlightFlush && queue.size() > 0) {
      queuedDuringActiveFlush = true;
    }

    if (result.dropped) {
      reportError({
        code: "queue_overflow",
        message: "Signal queue capacity exceeded"
      });
    }
  };

  const flush = (flushOptions?: FlushOptions): Promise<FlushResult> => {
    if (inFlightFlush) {
      if (queuedDuringActiveFlush) {
        return flushAfterActiveFlush(flushOptions);
      }

      return inFlightFlush;
    }

    return startFlush(flushOptions);
  };

  const startFlush = (flushOptions?: FlushOptions): Promise<FlushResult> => {
    queuedDuringActiveFlush = false;

    const activeFlush = flushQueue(flushOptions).finally(() => {
      if (inFlightFlush === activeFlush) {
        inFlightFlush = undefined;
      }
    });

    inFlightFlush = activeFlush;
    return activeFlush;
  };

  const flushAfterActiveFlush = (flushOptions?: FlushOptions): Promise<FlushResult> => {
    if (pendingFlushAfterActive) {
      return pendingFlushAfterActive;
    }

    const activeFlush = inFlightFlush;

    if (!activeFlush) {
      return startFlush(flushOptions);
    }

    const followUpFlush = activeFlush
      .then(async (activeResult) => {
        pendingFlushAfterActive = undefined;

        if (queue.size() === 0) {
          return activeResult;
        }

        const pendingResult = await startFlush(flushOptions);
        return combineFlushResults(activeResult, pendingResult);
      })
      .finally(() => {
        if (pendingFlushAfterActive === followUpFlush) {
          pendingFlushAfterActive = undefined;
        }
      });

    pendingFlushAfterActive = followUpFlush;
    return followUpFlush;
  };

  const flushQueue = async (flushOptions?: FlushOptions): Promise<FlushResult> => {
    const items = queue.drain();
    const retainedItems: QueuedSignal[] = [];
    let sent = 0;
    let failed = 0;

    for (const signal of items) {
      const result = await sendSignal({
        endpoint,
        apiKey,
        fetchImpl,
        requestTimeoutMs,
        maxRetries,
        retryBaseDelayMs,
        signal
      });

      if (result.ok) {
        sent += 1;
        continue;
      }

      failed += 1;

      if (result.retryable) {
        reportError({
          code: "transient_failure",
          message: "Signal delivery failed with a retryable error",
          status: result.status,
          endpoint: signalEndpoint(endpoint, signal)
        });

        if (!flushOptions?.discardOnFailure) {
          retainedItems.push(signal);
        }

        continue;
      }

      reportError({
        code: "permanent_failure",
        message: "Signal delivery failed with a permanent error",
        status: result.status,
        endpoint: signalEndpoint(endpoint, signal)
      });
    }

    if (retainedItems.length > 0) {
      queue.requeueFront(retainedItems);
    }

    return {
      sent,
      failed,
      retained: retainedItems.length,
      dropped: consumeDropped()
    };
  };

  const consumeDropped = (): number => {
    const dropped = localDropped + queue.consumeDropped();
    localDropped = 0;
    return dropped;
  };

  if (options.flushIntervalMs !== undefined) {
    interval = setInterval(() => {
      void flush().catch(() => undefined);
    }, options.flushIntervalMs);
  }

  return {
    track(name: string, properties?: SignalMetadata, context?: SignalContext): void {
      enqueue(createEventSignal(name, properties, context, defaultContext));
    },

    captureError(error: unknown, input?: ErrorInput): void {
      enqueue(createErrorSignal(error, input, defaultContext));
    },

    breadcrumb(input: BreadcrumbInput, context?: SignalContext): void {
      enqueue(createBreadcrumbSignal(input, context, defaultContext));
    },

    llm(input: LlmInput, context?: SignalContext): void {
      enqueue(createLlmSignal(input, context, defaultContext));
    },

    trace(input: TraceInput, context?: SignalContext): void {
      enqueue(createTraceSignal(input, context, defaultContext));
    },

    startTrace(name: string, input?: StartTraceInput & SignalContext): ActiveTrace {
      const traceId = input?.traceId ?? `trc_${nanoid()}`;
      const startedAt = toDate(input?.startedAt);

      return {
        traceId,
        startedAt,
        end(endInput?: EndTraceInput, context?: SignalContext): void {
          const endedAt = endInput?.endedAt ?? input?.endedAt ?? new Date();

          enqueue(
            createTraceSignal(
              {
                name,
                status: endInput?.status ?? input?.status ?? "success",
                startedAt,
                endedAt,
                durationMs: endInput?.durationMs ?? input?.durationMs,
                timestamp: endInput?.timestamp ?? input?.timestamp
              },
              {
                ...input,
                ...context,
                traceId,
                metadata: {
                  ...(input?.metadata ?? {}),
                  ...(context?.metadata ?? {})
                }
              },
              defaultContext
            )
          );
        }
      };
    },

    span(input: SpanInput, context?: SignalContext): void {
      enqueue(createSpanSignal(input, context, defaultContext));
    },

    identify(context: SignalContext): void {
      defaultContext = {
        ...defaultContext,
        ...context,
        metadata: {
          ...(defaultContext?.metadata ?? {}),
          ...(context.metadata ?? {})
        }
      };
    },

    flush,

    async shutdown(shutdownOptions?: FlushOptions): Promise<FlushResult> {
      if (interval !== undefined) {
        clearInterval(interval);
        interval = undefined;
      }

      const firstResult = await flush(shutdownOptions);

      if (queue.size() === 0) {
        return firstResult;
      }

      const pendingResult = await flush(shutdownOptions);

      return combineFlushResults(firstResult, pendingResult);
    }
  };
}

function cloneContext(context: SignalContext | undefined): SignalContext | undefined {
  if (!context) {
    return undefined;
  }

  return {
    ...context,
    metadata: context.metadata ? { ...context.metadata } : undefined
  };
}

function toDate(value: Date | string | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  return value === undefined ? new Date() : new Date(value);
}

function signalEndpoint(endpoint: string, signal: QueuedSignal): string {
  return `${endpoint}${signal.endpointPath}`;
}

function combineFlushResults(first: FlushResult, second: FlushResult): FlushResult {
  return {
    sent: first.sent + second.sent,
    failed: first.failed + second.failed,
    retained: first.retained + second.retained,
    dropped: first.dropped + second.dropped
  };
}
