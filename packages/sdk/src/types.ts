export type SignalStatus = "success" | "error" | "pending";
export type ErrorSeverity = "debug" | "info" | "warning" | "error" | "critical" | "fatal";
export type BreadcrumbType = "navigation" | "click" | "console" | "network" | "custom";
export type BreadcrumbLevel = "debug" | "info" | "warning" | "error" | "fatal";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SignalMetadata = Record<string, JsonValue>;

export type SignalContext = {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  source?: string;
  release?: string;
  metadata?: SignalMetadata;
};

export type SignalHubClientOptions = {
  endpoint: string;
  apiKey: string;
  defaultContext?: SignalContext;
  fetch?: typeof fetch;
  maxQueueSize?: number;
  flushIntervalMs?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  maxSerializedPayloadBytes?: number;
  onError?: (error: SignalHubError) => void;
};

export type EventInput = {
  timestamp?: Date | string;
};

export type ErrorInput = SignalContext &
  EventInput & {
  severity?: ErrorSeverity;
  fingerprint?: string;
  context?: SignalMetadata;
};

export type BreadcrumbInput = {
  type: BreadcrumbType;
  category?: string;
  message: string;
  level?: BreadcrumbLevel;
  data?: SignalMetadata;
  timestamp?: Date | string;
};

export type LlmInput = {
  provider: string;
  model: string;
  promptName?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  status?: SignalStatus;
  error?: string;
  inputPreview?: string;
  outputPreview?: string;
  timestamp?: Date | string;
};

export type TraceInput = {
  name: string;
  status?: SignalStatus;
  startedAt?: Date | string;
  endedAt?: Date | string;
  durationMs?: number;
  timestamp?: Date | string;
};

export type SpanInput = {
  traceId: string;
  parentSpanId?: string;
  name: string;
  status?: SignalStatus;
  startedAt?: Date | string;
  endedAt?: Date | string;
  durationMs?: number;
  input?: JsonValue;
  output?: JsonValue;
  error?: JsonValue;
  costUsd?: number;
  timestamp?: Date | string;
};

export type StartTraceInput = Omit<TraceInput, "name" | "startedAt"> & {
  startedAt?: Date | string;
};

export type EndTraceInput = Partial<Omit<TraceInput, "name" | "startedAt">>;

export type ActiveTrace = {
  traceId: string;
  startedAt: Date;
  end: (input?: EndTraceInput, context?: SignalContext) => void;
};

export type FlushOptions = {
  discardOnFailure?: boolean;
};

export type FlushResult = {
  sent: number;
  failed: number;
  retained: number;
  dropped: number;
};

export type SignalHubErrorCode =
  | "queue_overflow"
  | "payload_too_large"
  | "permanent_failure"
  | "transient_failure"
  | "invalid_payload";

export type SignalHubError = {
  code: SignalHubErrorCode;
  message: string;
  status?: number;
  endpoint?: string;
};

export type SignalHubClient = {
  track: (name: string, properties?: SignalMetadata, context?: SignalContext & EventInput) => void;
  captureError: (error: unknown, input?: ErrorInput) => void;
  breadcrumb: (input: BreadcrumbInput, context?: SignalContext) => void;
  llm: (input: LlmInput, context?: SignalContext) => void;
  trace: (input: TraceInput, context?: SignalContext) => void;
  startTrace: (name: string, input?: StartTraceInput & SignalContext) => ActiveTrace;
  span: (input: SpanInput, context?: SignalContext) => void;
  identify: (context: SignalContext) => void;
  flush: (options?: FlushOptions) => Promise<FlushResult>;
  shutdown: (options?: FlushOptions) => Promise<FlushResult>;
};

export type SignalKind = "event" | "error" | "llm" | "trace" | "span" | "breadcrumb";

export type QueuedSignal = {
  kind: SignalKind;
  endpointPath: string;
  payload: Record<string, unknown>;
};

export const DEFAULT_MAX_QUEUE_SIZE = 1000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_BASE_DELAY_MS = 250;
export const DEFAULT_MAX_SERIALIZED_PAYLOAD_BYTES = 64_000;
