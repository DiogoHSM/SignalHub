export type User = {
  id: string;
  email: string;
  isAdmin: boolean;
};

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type Environment = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type ApiKey = {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
};

export type CreatedApiKey = ApiKey & {
  secret: string;
};

export type EventRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  timestamp: string;
  receivedAt: string;
  source: string | null;
  release: string | null;
  metadata: unknown;
  name: string;
  properties: unknown;
};

export type ErrorRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  timestamp: string;
  receivedAt: string;
  source: string | null;
  release: string | null;
  metadata: unknown;
  message: string;
  type: string | null;
  severity: string;
  stack: string | null;
  status: string;
  fingerprint: string | null;
  errorGroupId: string | null;
  groupingFingerprint: string | null;
  context: unknown;
};

export type ErrorGroupStatus = "open" | "investigating" | "resolved" | "ignored";

export type ErrorGroupPriority = "urgent" | "high" | "normal" | "low";

export type ErrorGroupRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  groupingFingerprint: string;
  message: string;
  type: string | null;
  topStackFrame: string | null;
  severity: string;
  status: ErrorGroupStatus;
  priority: ErrorGroupPriority | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastRegressedAt: string | null;
  occurrenceCount: number;
  affectedUsersCount: number;
  affectedTenantsCount: number;
  latestErrorId: string | null;
  latestRelease: string | null;
  resolvedAt: string | null;
  ignoredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ErrorGroupQuery = {
  projectId: string;
  environmentId: string;
  status?: ErrorGroupStatus;
  severity?: string;
  fingerprint?: string;
  tenantId?: string;
  userId?: string;
  release?: string;
  from?: Date | string;
  to?: Date | string;
  limit?: number;
};

export type IncidentTimelineKind = "breadcrumb" | "event" | "error" | "trace" | "span" | "llm";

export type IncidentTimelineConfidence = "strong" | "nearby";

export type IncidentTimelineItem = {
  id: string;
  kind: IncidentTimelineKind;
  confidence: IncidentTimelineConfidence;
  timestamp: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  release: string | null;
  title: string;
  level: string | null;
  data: unknown;
};

export type ErrorGroupIncident = {
  group: ErrorGroupRecord;
  primaryOccurrence: ErrorRecord;
  priority: ErrorGroupPriority | null;
  suggestedPriority: ErrorGroupPriority;
  sourceMapResolution: { status: "cached"; frameCount: number } | { status: "none" };
  stronglyRelated: { items: IncidentTimelineItem[]; truncated: boolean };
  nearbyContext: { items: IncidentTimelineItem[]; truncated: boolean };
  related: {
    traceId: string | null;
    sessionId: string | null;
    userId: string | null;
    tenantId: string | null;
    release: string | null;
  };
};

export type ErrorGroupIncidentQuery = {
  projectId: string;
  environmentId: string;
  errorId?: string;
};

export type UpdateErrorGroupStatusInput = {
  projectId: string;
  environmentId: string;
  status: ErrorGroupStatus;
};

export type UpdateErrorGroupTriageInput = {
  projectId: string;
  environmentId: string;
  status?: ErrorGroupStatus;
  priority?: ErrorGroupPriority | null;
};

export type SourceMapArtifact = {
  id: string;
  projectId: string;
  environmentId: string;
  release: string;
  minifiedFile: string;
  originalFilename: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
  uploadedByUserId: string;
};

export type SourceMapUploadToken = {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type CreatedSourceMapUploadToken = SourceMapUploadToken & {
  secret: string;
};

export type SourceMapArtifactQuery = {
  projectId: string;
  environmentId: string;
  release?: string;
};

export type SourceMapResolutionFrame = {
  frameIndex: number;
  minifiedFile: string;
  minifiedLine: number;
  minifiedColumn: number;
  originalSource: string;
  originalLine: number;
  originalColumn: number;
  originalName: string | null;
  sourceMapArtifactId: string;
};

export type SourceMapResolution = {
  errorId: string;
  release: string | null;
  status: "resolved" | "partially_resolved" | "unresolved" | "unavailable";
  frames: SourceMapResolutionFrame[];
  unresolvedFrameCount: number;
};

export type TraceRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  timestamp: string;
  receivedAt: string;
  source: string | null;
  release: string | null;
  metadata: unknown;
  name: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
};

export type SpanRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string;
  timestamp: string;
  receivedAt: string;
  source: string | null;
  release: string | null;
  metadata: unknown;
  parentSpanId: string | null;
  name: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  input: unknown | null;
  output: unknown | null;
  error: unknown | null;
  costUsd: string | null;
};

export type LlmCallRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  timestamp: string;
  receivedAt: string;
  source: string | null;
  release: string | null;
  metadata: unknown;
  provider: string;
  model: string;
  promptName: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  latencyMs: number | null;
  status: string;
  error: string | null;
  inputPreview: string | null;
  outputPreview: string | null;
};

export type LlmAggregates = {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string;
};

export type OverviewWindow = "24h" | "7d" | "30d";

export type OverviewTrendBucket = "hour" | "day";

export type OverviewErrorSeverity = "debug" | "info" | "warning" | "error" | "critical" | "fatal" | (string & {});

export type OverviewQuery = {
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
};

export type OverviewRecentError = {
  id: string;
  timestamp: string;
  message: string;
  type: string | null;
  severity: OverviewErrorSeverity;
  status: string;
  tenantId: string | null;
  userId: string | null;
  traceId: string | null;
};

export type OverviewRecentTrace = {
  id: string;
  timestamp: string;
  name: string;
  status: string;
  durationMs: number | null;
  tenantId: string | null;
  userId: string | null;
};

export type OverviewRecentLlmCall = {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  promptName: string | null;
  status: string;
  costUsd: string;
  tenantId: string | null;
  userId: string | null;
  traceId: string | null;
};

export type OverviewResponse = {
  window: OverviewWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
    bucket: OverviewTrendBucket;
  };
  kpis: {
    events: number;
    activeUsers: number;
    activeTenants: number;
    errors: number;
    openErrors: number;
    traces: number;
    failedTraces: number;
    averageTraceDurationMs: number;
    p95TraceDurationMs: number | null;
    llmCalls: number;
    failedLlmCalls: number;
    llmInputTokens: number;
    llmOutputTokens: number;
    llmCostUsd: string;
  };
  trends: {
    usage: Array<{ bucketStart: string; events: number; traces: number; llmCalls: number }>;
    errors: Array<{ bucketStart: string; errors: number; openErrors: number; severeErrors: number }>;
    latency: Array<{ bucketStart: string; averageTraceDurationMs: number; p95TraceDurationMs: number | null }>;
    aiCost: Array<{ bucketStart: string; llmCostUsd: string; llmCalls: number }>;
  };
  top: {
    events: Array<{ name: string; total: number }>;
    tenantsByUsage: Array<{ tenantId: string; total: number }>;
    tenantsByErrors: Array<{ tenantId: string; total: number }>;
    tenantsByLlmCalls: Array<{ tenantId: string; total: number }>;
    tenantsByLlmCost: Array<{ tenantId: string; totalCostUsd: string }>;
    llmProviders: Array<{ provider: string; total: number; totalCostUsd: string }>;
    llmModels: Array<{ model: string; total: number; totalCostUsd: string }>;
    llmPrompts: Array<{ promptName: string; total: number; totalCostUsd: string }>;
    errorSeverity: Array<{ severity: OverviewErrorSeverity; total: number }>;
    errorStatus: Array<{ status: string; total: number }>;
  };
  recent: {
    errors: OverviewRecentError[];
    failedTraces: OverviewRecentTrace[];
    failedLlmCalls: OverviewRecentLlmCall[];
  };
};

export type EntityWindow = "24h" | "7d" | "30d";

export type EntitySignalType = "event" | "error" | "trace" | "llm";

export type TenantSummary = {
  tenantId: string | null;
  label: string;
  isUnassigned: boolean;
  impactScore: number;
  lastSeenAt: string | null;
  events: number;
  errors: number;
  openErrors: number;
  severeErrors: number;
  traces: number;
  failedTraces: number;
  llmCalls: number;
  failedLlmCalls: number;
  llmCostUsd: string;
  activeUsers: number;
  activeSessions: number;
};

export type TenantListQuery = {
  projectId: string;
  environmentId: string;
  window: EntityWindow;
  search?: string;
  limit?: number;
};

export type TenantDetailQuery = {
  projectId: string;
  environmentId: string;
  window: EntityWindow;
  userId?: string;
  signalType?: EntitySignalType;
  limit?: number;
  cursor?: string;
};

export type TenantTopUser = {
  userId: string;
  events: number;
  errors: number;
  traces: number;
  llmCalls: number;
  llmCostUsd: string;
  lastSeenAt: string;
};

export type TenantTimelineRow =
  | {
      type: "event";
      id: string;
      timestamp: string;
      label: string;
      userId: string | null;
      sessionId: string | null;
      traceId: string | null;
      eventName: string;
    }
  | {
      type: "error";
      id: string;
      timestamp: string;
      label: string;
      userId: string | null;
      sessionId: string | null;
      traceId: string | null;
      severity: string;
      status: string;
      message: string;
    }
  | {
      type: "trace";
      id: string;
      timestamp: string;
      label: string;
      userId: string | null;
      sessionId: string | null;
      traceId: string | null;
      status: string;
      durationMs: number | null;
      name: string;
    }
  | {
      type: "llm";
      id: string;
      timestamp: string;
      label: string;
      userId: string | null;
      sessionId: string | null;
      traceId: string | null;
      provider: string;
      model: string;
      promptName: string | null;
      status: string;
      costUsd: string;
    };

export type TenantListResponse = {
  window: EntityWindow;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string; to: string };
  tenants: TenantSummary[];
};

export type TenantDetailResponse = {
  window: EntityWindow;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string; to: string };
  tenant: TenantSummary;
  topUsers: TenantTopUser[];
  timeline: TenantTimelineRow[];
  cursor?: string;
};

export type UserWindow = "24h" | "7d" | "30d";

export type UserSignalType = "event" | "error" | "trace" | "llm";

export type UserSummary = {
  userId: string | null;
  label: string;
  isAnonymous: boolean;
  impactScore: number;
  lastSeenAt: string | null;
  events: number;
  errors: number;
  openErrors: number;
  severeErrors: number;
  traces: number;
  failedTraces: number;
  llmCalls: number;
  failedLlmCalls: number;
  llmCostUsd: string;
  activeTenants: number;
  activeSessions: number;
};

export type UserListQuery = {
  projectId: string;
  environmentId: string;
  window: UserWindow;
  search?: string;
  tenantId?: string;
  limit?: number;
};

export type UserDetailQuery = {
  projectId: string;
  environmentId: string;
  window: UserWindow;
  tenantId?: string;
  signalType?: UserSignalType;
  limit?: number;
  cursor?: string;
};

export type UserRecentSession = {
  sessionId: string;
  tenantId: string | null;
  events: number;
  errors: number;
  traces: number;
  llmCalls: number;
  llmCostUsd: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type UserTimelineRow =
  | {
      type: "event";
      id: string;
      timestamp: string;
      label: string;
      tenantId: string | null;
      sessionId: string | null;
      traceId: string | null;
      eventName: string;
    }
  | {
      type: "error";
      id: string;
      timestamp: string;
      label: string;
      tenantId: string | null;
      sessionId: string | null;
      traceId: string | null;
      severity: string;
      status: string;
      message: string;
    }
  | {
      type: "trace";
      id: string;
      timestamp: string;
      label: string;
      tenantId: string | null;
      sessionId: string | null;
      traceId: string | null;
      status: string;
      durationMs: number | null;
      name: string;
    }
  | {
      type: "llm";
      id: string;
      timestamp: string;
      label: string;
      tenantId: string | null;
      sessionId: string | null;
      traceId: string | null;
      provider: string;
      model: string;
      promptName: string | null;
      status: string;
      costUsd: string;
    };

export type UserListResponse = {
  window: UserWindow;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string; to: string };
  users: UserSummary[];
};

export type UserDetailResponse = {
  window: UserWindow;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string; to: string };
  user: UserSummary;
  recentSessions: UserRecentSession[];
  timeline: UserTimelineRow[];
  cursor?: string;
};

export type SystemStatus = "healthy" | "degraded" | "unhealthy";

export type BackupHealthRun = {
  id: string;
  status: "success" | "failed";
  trigger: "scheduled" | "manual";
  startedAt: string;
  finishedAt: string | null;
  filename: string;
  sizeBytes: number | null;
  s3Bucket: string | null;
  s3Key: string | null;
  errorMessage: string | null;
};

export type SystemHealthResponse = {
  generatedAt: string;
  status: SystemStatus;
  services: {
    api: { status: "healthy"; uptimeSeconds: number };
    postgres: { status: "healthy" | "degraded" | "unhealthy"; latencyMs: number | null };
    redis: { status: "healthy" | "unhealthy"; latencyMs: number | null };
    worker: { status: SystemStatus; lastHeartbeatAt: string | null };
  };
  queues: {
    telemetry: {
      status: SystemStatus;
      errorMessage: string | null;
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    };
  };
  ingestion: {
    lastEventAt: string | null;
    lastErrorAt: string | null;
    lastTraceAt: string | null;
    lastSpanAt: string | null;
    lastLlmCallAt: string | null;
  };
  retention: {
    enabled: boolean;
    intervalMinutes: number;
    lastRun: {
      id: string;
      status: "success" | "failed";
      startedAt: string;
      finishedAt: string | null;
      deleted: {
        events: number;
        errors: number;
        traces: number;
        spans: number;
        llmCalls: number;
        breadcrumbs: number;
        sourceMapArtifacts: number;
        sourceMapFiles: number;
      };
      errorMessage: string | null;
    } | null;
    policy: {
      eventsDays: number;
      errorsDays: number;
      tracesDays: number;
      spansDays: number;
      llmCallsDays: number;
      breadcrumbsDays: number;
      sourceMapsEnabled: boolean;
      sourceMapsDays: number;
      sourceMapsBatchSize: number;
    };
  };
  backups: {
    enabled: boolean;
    intervalHours: number;
    retentionDays: number;
    s3Enabled: boolean;
    stale: boolean | null;
    latestSuccess: BackupHealthRun | null;
    latestFailure: BackupHealthRun | null;
  };
};

export type NotificationChannelResponse = {
  id: string;
  name: string;
  type: "webhook";
  url: string;
  secretHeaderName: string | null;
  hasSecret: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CreateNotificationChannelInput = {
  name: string;
  type: "webhook";
  url: string;
  secretHeaderName?: string | null;
  secretHeaderValue?: string | null;
  enabled?: boolean;
};

export type UpdateNotificationChannelInput = Partial<CreateNotificationChannelInput>;

export type AlertRuleType = "critical_errors" | "error_count" | "trace_p95_latency" | "llm_cost";

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertRuleResponse = {
  id: string;
  projectId: string;
  environmentId: string;
  notificationChannelId: string | null;
  name: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  windowMinutes: number;
  threshold: string;
  cooldownMinutes: number;
  enabled: boolean;
  lastEvaluatedAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CreateAlertRuleInput = {
  projectId: string;
  environmentId: string;
  notificationChannelId?: string | null;
  name: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  windowMinutes: number;
  threshold: string;
  cooldownMinutes: number;
  enabled?: boolean;
};

export type UpdateAlertRuleInput = Partial<CreateAlertRuleInput>;

export type AlertRuleListQuery = {
  projectId?: string;
  environmentId?: string;
};

export type AlertEventResponse = {
  id: string;
  ruleId: string;
  projectId: string;
  environmentId: string;
  status: "triggered";
  severity: AlertSeverity;
  triggeredAt: string;
  windowStart: string;
  windowEnd: string;
  observedValue: string;
  threshold: string;
  message: string;
  metadata: unknown;
  createdAt: string;
  latestDeliveryStatus: "success" | "failed" | null;
};

export type AlertEventListQuery = {
  projectId: string;
  environmentId: string;
  limit?: number;
};

export type SessionTimelineItemType = "breadcrumb" | "event" | "error" | "trace" | "llm";

export type SessionTimelineItem = {
  id: string;
  type: SessionTimelineItemType;
  timestamp: string;
  receivedAt: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string;
  traceId: string | null;
  source: string | null;
  release: string | null;
  title: string;
  level: string | null;
  data: unknown;
};

export type SessionTimelineQuery = {
  projectId: string;
  environmentId: string;
  tenantId?: string;
  userId?: string;
  from?: Date | string;
  to?: Date | string;
  center?: Date | string;
  beforeSeconds?: number;
  afterSeconds?: number;
  types?: SessionTimelineItemType[];
  limit?: number;
};

export type SessionTimelineResponse = {
  sessionId: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string | null; to: string | null };
  items: SessionTimelineItem[];
  page: { nextCursor: string | null; previousCursor: string | null };
};

export type ConsoleConfig = {
  apiBasePath: string;
  apiEndpoint: string;
  googleOAuthEnabled: boolean;
};

export type QueryListResponse<T> = {
  data: T[];
  cursor?: string;
};

export type AggregateResponse<T> = {
  data: T;
};

export type QueryFilters = {
  projectId: string;
  environmentId: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  eventName?: string;
  severity?: string;
  status?: string;
  fingerprint?: string;
  errorGroupId?: string;
  provider?: string;
  model?: string;
  promptName?: string;
  from?: Date | string;
  to?: Date | string;
  limit?: number;
  cursor?: string;
};
