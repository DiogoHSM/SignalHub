import { createSignalMonitorClient } from "./client.js";
import {
  installBrowserErrorCapture as installBrowserErrorCaptureBase,
  type BrowserErrorCaptureOptions as BaseBrowserErrorCaptureOptions
} from "./browser-errors.js";
import type {
  ErrorInput,
  ErrorSeverity,
  EventInput,
  FlushResult,
  SignalContext,
  SignalMetadata,
  SignalMonitorClient,
  SignalMonitorClientOptions
} from "./types.js";

export type NextRequestLike = {
  method?: string;
  url?: string;
  headers?: Headers | Record<string, string | string[] | undefined>;
};

export type NextContextInput = SignalContext & {
  request?: NextRequestLike;
  routeName?: string;
  module?: string;
  correlationHeader?: string;
};

export type SignalMonitorNextClient = SignalMonitorClient & {
  captureRequestError: (error: unknown, input?: NextRequestErrorInput) => void;
};

export type NextRequestErrorInput = NextContextInput &
  EventInput & {
    severity?: ErrorSeverity;
    fingerprint?: string;
    context?: SignalMetadata;
  };

type MaybePromise<T> = T | Promise<T>;

export type SignalMonitorRouteOptions<
  TRequest extends NextRequestLike = NextRequestLike,
  TArgs extends unknown[] = unknown[]
> = NextContextInput & {
  client: SignalMonitorNextClient;
  flushOnError?: boolean;
  getContext?: (request: TRequest, ...args: TArgs) => MaybePromise<SignalContext | undefined>;
};

export type SignalMonitorActionOptions<TArgs extends unknown[] = unknown[]> = NextContextInput & {
  client: SignalMonitorNextClient;
  flushOnError?: boolean;
  name?: string;
  getContext?: (...args: TArgs) => MaybePromise<SignalContext | undefined>;
};

const DEFAULT_CORRELATION_HEADER = "x-request-id";
const FALLBACK_CORRELATION_HEADER = "x-correlation-id";

export type BrowserErrorCaptureOptions = Omit<BaseBrowserErrorCaptureOptions, "context"> & {
  context?: NextRequestErrorInput;
};

export function buildNextContext(input?: NextContextInput): SignalContext {
  const {
    request: _request,
    routeName,
    module: _module,
    correlationHeader: _correlationHeader,
    ...signalContext
  } = input ?? {};
  const requestMetadata = buildRequestMetadata(input);
  const traceId =
    input?.traceId ??
    getHeader(input?.request?.headers, input?.correlationHeader ?? DEFAULT_CORRELATION_HEADER) ??
    getHeader(input?.request?.headers, FALLBACK_CORRELATION_HEADER);
  const metadata = {
    ...(input?.metadata ?? {}),
    ...requestMetadata
  };

  return {
    ...signalContext,
    traceId,
    source: input?.source ?? routeName,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  };
}

export function createSignalMonitorNextClient(options: SignalMonitorClientOptions): SignalMonitorNextClient {
  const client = createSignalMonitorClient(options);

  return {
    ...client,
    captureRequestError(error: unknown, input?: NextRequestErrorInput): void {
      captureRequestError(client, error, input);
    }
  };
}

export function withSignalMonitorRoute<
  TRequest extends NextRequestLike,
  TArgs extends unknown[],
  TResult
>(
  handler: (request: TRequest, ...args: TArgs) => TResult | Promise<TResult>,
  options: SignalMonitorRouteOptions<TRequest, TArgs>
): (request: TRequest, ...args: TArgs) => Promise<Awaited<TResult>> {
  return async (request: TRequest, ...args: TArgs): Promise<Awaited<TResult>> => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      const { client, flushOnError, getContext, ...nextContext } = options;

      await handleWrapperError(error, {
        baseContext: { ...nextContext, request },
        client,
        flushOnError,
        getContext: () => getContext?.(request, ...args)
      });
      throw error;
    }
  };
}

export function withSignalMonitorAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => TResult | Promise<TResult>,
  options: SignalMonitorActionOptions<TArgs>
): (...args: TArgs) => Promise<Awaited<TResult>> {
  return async (...args: TArgs): Promise<Awaited<TResult>> => {
    try {
      return await action(...args);
    } catch (error) {
      const { client, flushOnError, getContext, name, ...nextContext } = options;

      await handleWrapperError(error, {
        baseContext: {
          ...nextContext,
          routeName: options.routeName ?? name
        },
        client,
        flushOnError,
        getContext: () => getContext?.(...args)
      });
      throw error;
    }
  };
}

export function installBrowserErrorCapture(
  client: SignalMonitorClient,
  options: BrowserErrorCaptureOptions = {}
): () => void {
  const bridgeClient: SignalMonitorClient = {
    ...client,
    captureError(error: unknown, input?: ErrorInput): void {
      const nextInput = input as NextRequestErrorInput | undefined;
      const normalizedInput =
        nextInput?.source === "browser" && nextInput.routeName
          ? { ...nextInput, source: undefined }
          : nextInput;

      captureRequestError(client, error, normalizedInput);
    }
  };

  return installBrowserErrorCaptureBase(bridgeClient, options as BaseBrowserErrorCaptureOptions);
}

async function handleWrapperError(
  error: unknown,
  input: {
    baseContext: NextContextInput;
    client: SignalMonitorNextClient;
    flushOnError?: boolean;
    getContext: () => MaybePromise<SignalContext | undefined>;
  }
): Promise<void> {
  let providedContext: SignalContext | undefined;

  try {
    providedContext = await input.getContext();
  } catch {
    providedContext = undefined;
  }

  try {
    await captureAndFlush(error, {
      baseContext: input.baseContext,
      client: input.client,
      flushOnError: input.flushOnError,
      providedContext
    });
  } catch {
    // Capture/flush is best effort from wrappers; callers must receive the original error.
  }
}

async function captureAndFlush(
  error: unknown,
  input: {
    baseContext: NextContextInput;
    client: SignalMonitorNextClient;
    flushOnError?: boolean;
    providedContext?: SignalContext;
  }
): Promise<FlushResult | undefined> {
  input.client.captureRequestError(error, mergeNextContext(input.baseContext, input.providedContext));

  if (input.flushOnError === false) {
    return undefined;
  }

  return input.client.flush();
}

function captureRequestError(
  client: SignalMonitorClient,
  error: unknown,
  input?: NextRequestErrorInput
): void {
  const context = buildNextContext(input);

  client.captureError(error, {
    ...input,
    ...context,
    context: {
      ...(context.metadata ?? {}),
      ...(input?.context ?? {})
    }
  } satisfies ErrorInput);
}

function mergeNextContext(base: NextContextInput, context?: SignalContext): NextContextInput {
  return {
    ...base,
    ...context,
    request: base.request,
    routeName: base.routeName,
    module: base.module,
    correlationHeader: base.correlationHeader,
    metadata: {
      ...(base.metadata ?? {}),
      ...(context?.metadata ?? {})
    }
  };
}

function buildRequestMetadata(input?: NextContextInput): SignalMetadata {
  const metadata: SignalMetadata = {};
  const correlationId =
    input?.traceId ??
    getHeader(input?.request?.headers, input?.correlationHeader ?? DEFAULT_CORRELATION_HEADER) ??
    getHeader(input?.request?.headers, FALLBACK_CORRELATION_HEADER);
  const requestPath = getRequestPath(input?.request?.url);

  assignMetadata(metadata, "correlation_id", correlationId);
  assignMetadata(metadata, "module", input?.module);
  assignMetadata(metadata, "request_method", input?.request?.method);
  assignMetadata(metadata, "request_path", requestPath);
  assignMetadata(metadata, "route_name", input?.routeName);

  return metadata;
}

function assignMetadata(metadata: SignalMetadata, key: string, value: string | undefined): void {
  if (value !== undefined && value.length > 0) {
    metadata[key] = value;
  }
}

function getRequestPath(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).pathname;
  } catch {
    const [path] = url.split("?");
    return path || undefined;
  }
}

function getHeader(
  headers: NextRequestLike["headers"] | undefined,
  name: string
): string | undefined {
  if (!headers) {
    return undefined;
  }

  if (isHeaders(headers)) {
    return normalizeHeaderValue(headers.get(name) ?? undefined);
  }

  const normalizedName = name.toLowerCase();

  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerName.toLowerCase() === normalizedName) {
      return normalizeHeaderValue(headerValue);
    }
  }

  return undefined;
}

function normalizeHeaderValue(value: string | string[] | undefined | null): string | undefined {
  if (Array.isArray(value)) {
    return value.find((item) => item.length > 0);
  }

  return value ?? undefined;
}

function isHeaders(value: NextRequestLike["headers"]): value is Headers {
  return typeof Headers !== "undefined" && value instanceof Headers;
}
