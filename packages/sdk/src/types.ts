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
  replayId?: string;
};

export type IdentifyUserInput = EventInput & {
  tenantId?: string;
};

export type IdentifyTenantInput = EventInput;

export type ErrorInput = SignalContext &
  EventInput & {
  severity?: ErrorSeverity;
  fingerprint?: string;
  replayId?: string;
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

export type SurveyResponseActorType = "user" | "tenant" | "session" | "anonymous";

export type SurveyResponseInput = EventInput & {
  surveyId: string;
  actorType?: SurveyResponseActorType;
  actorId?: string;
  answers: SignalMetadata;
};

export type ExperimentVariantInput = {
  key: string;
  weight: number;
};

export type ExperimentAssignmentInput = {
  experimentKey: string;
  subjectId: string;
  variants: ExperimentVariantInput[];
  exposureEvent?: string;
  properties?: SignalMetadata;
  trackExposure?: boolean;
};

export type ExperimentAssignment = {
  experimentKey: string;
  subjectId: string;
  variant: string;
};

export type FeatureFlagValue = string | number | boolean | null;

export type FeatureFlagVariantInput = {
  key: string;
  value: FeatureFlagValue;
};

export type FeatureFlagRuleMatch = {
  userId?: string;
  tenantId?: string;
  sessionId?: string;
  traits?: Record<string, FeatureFlagValue>;
};

export type FeatureFlagRollout = {
  percentage: number;
  stickiness: "user" | "tenant" | "session";
  salt?: string;
};

export type FeatureFlagRuleInput = {
  id?: string;
  description?: string;
  variant: string;
  match?: FeatureFlagRuleMatch;
  rollout?: FeatureFlagRollout;
};

export type FeatureFlagEvaluationInput = {
  key: string;
  fallbackVariant: string;
  variants: FeatureFlagVariantInput[];
  rules?: FeatureFlagRuleInput[];
  subject?: FeatureFlagRuleMatch;
  trackExposure?: boolean;
};

export type FeatureFlagEvaluation = {
  key: string;
  variant: string;
  value: FeatureFlagValue;
  matched: boolean;
  reason: "rule_match" | "default";
};

export type ReplayEventType = "navigation" | "click" | "input" | "console" | "network" | "error" | "custom";

export type SessionReplayEventInput = {
  offsetMs: number;
  type: ReplayEventType;
  route?: string;
  selector?: string;
  message?: string;
  x?: number;
  y?: number;
  data?: SignalMetadata;
};

export type SessionReplayInput = EventInput & {
  replayId: string;
  startedAt?: Date | string;
  endedAt?: Date | string;
  durationMs?: number;
  route?: string;
  errorId?: string;
  masked?: boolean;
  events?: SessionReplayEventInput[];
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
  assignExperiment: (input: ExperimentAssignmentInput, context?: SignalContext & EventInput) => ExperimentAssignment;
  evaluateFlag: (input: FeatureFlagEvaluationInput, context?: SignalContext & EventInput) => FeatureFlagEvaluation;
  captureError: (error: unknown, input?: ErrorInput) => void;
  breadcrumb: (input: BreadcrumbInput, context?: SignalContext) => void;
  llm: (input: LlmInput, context?: SignalContext) => void;
  trace: (input: TraceInput, context?: SignalContext) => void;
  startTrace: (name: string, input?: StartTraceInput & SignalContext) => ActiveTrace;
  span: (input: SpanInput, context?: SignalContext) => void;
  webVital: (input: WebVitalInput, context?: SignalContext) => void;
  click: (input: ClickInput, context?: SignalContext) => void;
  replay: (input: SessionReplayInput, context?: SignalContext) => void;
  profile: (input: RuntimeProfileInput, context?: SignalContext) => void;
  submitSurvey: (input: SurveyResponseInput, context?: SignalContext) => void;
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
  | "replay"
  | "profile"
  | "survey_response"
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
