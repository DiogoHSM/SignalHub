export type SignalStatus = "success" | "error" | "pending";
export type ErrorSeverity = "debug" | "info" | "warning" | "error" | "critical" | "fatal";
export type BreadcrumbType = "navigation" | "click" | "console" | "network" | "custom";
export type BreadcrumbLevel = "debug" | "info" | "warning" | "error" | "fatal";
export type WebVitalName = "CLS" | "FCP" | "FID" | "INP" | "LCP" | "TTFB";
export type WebVitalRating = "good" | "needs-improvement" | "poor";
export type ProfileKind = "cpu" | "memory";

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

export type SignalMonitorClientOptions = {
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
  onError?: (error: SignalMonitorError) => void;
};

export type EventInput = {
  timestamp?: Date | string;
};

export type IdentifyUserInput = EventInput & {
  tenantId?: string;
};

export type IdentifyTenantInput = EventInput;

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

export type WebVitalInput = EventInput & {
  name: WebVitalName;
  value: number;
  rating?: WebVitalRating;
  route?: string;
  navigationType?: string;
  metadata?: SignalMetadata;
};

export type ClickInput = EventInput & {
  route: string;
  selector: string;
  elementTag?: string;
  elementRole?: string;
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollX?: number;
  scrollY?: number;
  masked?: boolean;
};

export type RuntimeProfileFunction = {
  functionName: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  selfTimeMs?: number;
  totalTimeMs?: number;
  sampleCount?: number;
};

export type RuntimeProfileInput = EventInput & {
  name: string;
  kind: ProfileKind;
  runtime?: string;
  service?: string;
  route?: string;
  startedAt?: Date | string;
  endedAt?: Date | string;
  durationMs?: number;
  sampleCount?: number;
  samplingIntervalMs?: number;
  cpuUsagePercent?: number;
  cpuUserMs?: number;
  cpuSystemMs?: number;
  rssBytes?: number;
  heapUsedBytes?: number;
  heapTotalBytes?: number;
  externalBytes?: number;
  arrayBuffersBytes?: number;
  topFunctions?: RuntimeProfileFunction[];
  summary?: SignalMetadata;
  metadata?: SignalMetadata;
};

export type StartTraceInput = Omit<TraceInput, "name" | "startedAt"> & {
  startedAt?: Date | string;
};

export type EndTraceInput = Partial<Omit<TraceInput, "name" | "startedAt">>;

export type ActiveTrace = {
  traceId: string;
  spanId?: string;
  traceparent?: string;
  headers: () => Record<string, string>;
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

export type SignalMonitorErrorCode =
  | "queue_overflow"
  | "payload_too_large"
  | "permanent_failure"
  | "transient_failure"
  | "invalid_payload";

export type SignalMonitorError = {
  code: SignalMonitorErrorCode;
  message: string;
  status?: number;
  endpoint?: string;
};

export type SignalMonitorClient = {
  track: (name: string, properties?: SignalMetadata, context?: SignalContext & EventInput) => void;
  captureError: (error: unknown, input?: ErrorInput) => void;
  breadcrumb: (input: BreadcrumbInput, context?: SignalContext) => void;
  llm: (input: LlmInput, context?: SignalContext) => void;
  trace: (input: TraceInput, context?: SignalContext) => void;
  startTrace: (name: string, input?: StartTraceInput & SignalContext) => ActiveTrace;
  span: (input: SpanInput, context?: SignalContext) => void;
  webVital: (input: WebVitalInput, context?: SignalContext) => void;
  click: (input: ClickInput, context?: SignalContext) => void;
  profile: (input: RuntimeProfileInput, context?: SignalContext) => void;
  identify: (context: SignalContext) => void;
  identifyUser: (userId: string, traits?: SignalMetadata, context?: IdentifyUserInput) => void;
  identifyTenant: (tenantId: string, traits?: SignalMetadata, context?: IdentifyTenantInput) => void;
  flush: (options?: FlushOptions) => Promise<FlushResult>;
  shutdown: (options?: FlushOptions) => Promise<FlushResult>;
};

export type SignalKind =
  | "event"
  | "error"
  | "llm"
  | "trace"
  | "span"
  | "web_vital"
  | "click"
  | "profile"
  | "breadcrumb"
  | "identify_user"
  | "identify_tenant";

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
