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

export type BrowserOrigin = {
  id: string;
  projectId: string;
  origin: string;
  createdAt: string;
  archivedAt: string | null;
};

export type DataGovernanceRetentionCategory =
  | "events"
  | "errors"
  | "traces"
  | "spans"
  | "llmCalls"
  | "profiles"
  | "breadcrumbs"
  | "webVitals"
  | "clicks"
  | "replays";

export type DataGovernancePropertyRuleTarget =
  | "metadata"
  | "event.properties"
  | "error.context"
  | "span.input"
  | "span.output"
  | "span.error"
  | "breadcrumb.data"
  | "replay.event.data"
  | "identity.traits";

export type DataGovernancePropertyRule = {
  target: DataGovernancePropertyRuleTarget;
  path: string;
  action: "mask" | "block";
};

export type DataGovernancePolicy = {
  projectId: string;
  environmentId: string;
  retentionPolicy: Partial<Record<DataGovernanceRetentionCategory, number>>;
  propertyRules: DataGovernancePropertyRule[];
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WarehouseDataset = "events" | "errors" | "traces" | "llmCalls";

export type WarehouseCursorValue = {
  timestamp: string;
  id: string;
};

export type WarehouseCursor = Partial<Record<WarehouseDataset, WarehouseCursorValue>>;

export type WarehouseDestination = {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  destinationType: "postgres";
  connectionUrlPreview: string;
  datasets: WarehouseDataset[];
  cursor: WarehouseCursor;
  batchSize: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type WarehouseExportRun = {
  id: string;
  destinationId: string;
  projectId: string;
  environmentId: string;
  trigger: "scheduled" | "manual" | "retry";
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt: string | null;
  cursorBefore: WarehouseCursor;
  cursorAfter: WarehouseCursor;
  exported: Partial<Record<WarehouseDataset, number>>;
  errorMessage: string | null;
  createdAt: string;
};

export type CreateWarehouseDestinationInput = {
  projectId: string;
  environmentId: string;
  name: string;
  destinationType?: "postgres";
  connectionUrl: string;
  datasets: WarehouseDataset[];
  batchSize?: number;
  enabled?: boolean;
};

export type UpdateWarehouseDestinationInput = Partial<
  Pick<CreateWarehouseDestinationInput, "name" | "connectionUrl" | "datasets" | "batchSize" | "enabled">
> & {
  projectId: string;
  environmentId: string;
};

export type AnalyticsSegmentActorType = "user" | "tenant";

export type AnalyticsSegmentDefinition = {
  window?: ApmWindow;
  eventName?: string;
  propertyName?: string;
  propertyValue?: string;
};

export type AnalyticsSegment = {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  description: string | null;
  actorType: AnalyticsSegmentActorType;
  definition: AnalyticsSegmentDefinition;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CreateAnalyticsSegmentInput = {
  projectId: string;
  environmentId: string;
  name: string;
  description?: string | null;
  actorType: AnalyticsSegmentActorType;
  definition: AnalyticsSegmentDefinition;
};

export type UpdateAnalyticsSegmentInput = Partial<Omit<CreateAnalyticsSegmentInput, "projectId" | "environmentId">>;

export type AnalyticsSegmentPreview = {
  segmentId: string;
  actorType: AnalyticsSegmentActorType;
  window: ApmWindow;
  actors: number;
  samples: Array<{
    actorId: string;
    lastSeenAt: string;
  }>;
};

export type AnalyticsDashboardCategory = "executive" | "operational" | "product";
export type AnalyticsDashboardWidgetType = "metric.events" | "metric.errors" | "top.events" | "trend.events" | "trend.errors";

export type AnalyticsDashboardFilters = {
  window?: ApmWindow;
  tenantId?: string;
  userId?: string;
  segmentId?: string;
};

export type AnalyticsDashboardWidget = {
  id?: string;
  type: AnalyticsDashboardWidgetType;
  title: string;
  width: "half" | "full";
  options: Record<string, unknown>;
};

export type AnalyticsDashboard = {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  description: string | null;
  category: AnalyticsDashboardCategory;
  filters: AnalyticsDashboardFilters;
  widgets: Array<AnalyticsDashboardWidget & { id: string }>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CreateAnalyticsDashboardInput = {
  projectId: string;
  environmentId: string;
  name: string;
  description?: string | null;
  category?: AnalyticsDashboardCategory;
  filters?: AnalyticsDashboardFilters;
  widgets: AnalyticsDashboardWidget[];
};

export type UpdateAnalyticsDashboardInput = Partial<Omit<CreateAnalyticsDashboardInput, "projectId" | "environmentId">>;

export type DashboardReportWidget = {
  widgetId: string;
  type: AnalyticsDashboardWidgetType;
  title: string;
  width: "half" | "full";
  status: "ok" | "error";
  data: unknown;
  error?: string;
};

export type DashboardReportResponse = {
  dashboard: AnalyticsDashboard;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  window: ApmWindow;
  widgets: DashboardReportWidget[];
};

export type ExperimentStatus = "draft" | "running" | "paused" | "completed" | "archived";
export type ExperimentActorType = "user" | "tenant" | "session";

export type ExperimentVariant = {
  key: string;
  name: string;
  weight: number;
};

export type ExperimentPrimaryMetric = {
  eventName: string;
  windowHours: number;
};

export type Experiment = {
  id: string;
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description: string | null;
  status: ExperimentStatus;
  actorType: ExperimentActorType;
  exposureEvent: string;
  conversionEvent: string;
  variants: ExperimentVariant[];
  primaryMetric: ExperimentPrimaryMetric;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CreateExperimentInput = {
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description?: string | null;
  status?: ExperimentStatus;
  actorType?: ExperimentActorType;
  exposureEvent?: string;
  conversionEvent: string;
  variants: ExperimentVariant[];
  primaryMetric: ExperimentPrimaryMetric;
};

export type UpdateExperimentInput = Partial<Omit<CreateExperimentInput, "projectId" | "environmentId" | "key">>;

export type ExperimentResultsQuery = ApmQuery & {
  experimentId: string;
};

export type ExperimentVariantResult = ExperimentVariant & {
  exposures: number;
  conversions: number;
  conversionRate: number;
  liftPoints: number | null;
  sampleActors: string[];
};

export type ExperimentResultsResponse = {
  experiment: Experiment;
  window: ApmWindow;
  totals: {
    exposures: number;
    conversions: number;
    variants: number;
  };
  variants: ExperimentVariantResult[];
};

export type SurveyStatus = "draft" | "active" | "paused" | "archived";
export type SurveyActorType = "user" | "tenant" | "session";
export type SurveyQuestionType = "rating" | "choice" | "text";

export type SurveyQuestion = {
  id: string;
  type: SurveyQuestionType;
  label: string;
  required: boolean;
  scale?: { min: number; max: number; minLabel?: string; maxLabel?: string };
  options?: string[];
};

export type SurveyTargeting = {
  segmentId?: string;
  userId?: string;
  tenantId?: string;
  eventName?: string;
  sampleRate?: number;
};

export type Survey = {
  id: string;
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description: string | null;
  status: SurveyStatus;
  actorType: SurveyActorType;
  triggerEvent: string | null;
  questions: SurveyQuestion[];
  targeting: SurveyTargeting;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CreateSurveyInput = {
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description?: string | null;
  status?: SurveyStatus;
  actorType?: SurveyActorType;
  triggerEvent?: string | null;
  questions: SurveyQuestion[];
  targeting?: SurveyTargeting;
};

export type UpdateSurveyInput = Partial<Omit<CreateSurveyInput, "projectId" | "environmentId" | "key">>;

export type SurveyResultsQuery = ApmQuery & {
  surveyId: string;
};

export type SurveyResponse = {
  id: string;
  surveyId: string;
  actorType: "user" | "tenant" | "session" | "anonymous";
  actorId: string | null;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  answers: Record<string, unknown>;
  submittedAt: string;
};

export type SurveyResultsResponse = {
  survey: Survey;
  window: ApmWindow;
  totals: {
    responses: number;
    users: number;
    tenants: number;
    sessions: number;
  };
  questions: Array<{
    id: string;
    label: string;
    type: SurveyQuestionType;
    responses: number;
    average?: number;
    choices?: Array<{ value: string; count: number }>;
  }>;
  recentResponses: SurveyResponse[];
};

export type MessageCampaignStatus = "draft" | "active" | "paused" | "archived";
export type MessageCampaignChannelType = "email" | "webhook" | "in_app";
export type MessageCampaignActorType = "user" | "tenant" | "session" | "anonymous";
export type MessageCampaignEventType = "queued" | "sent" | "delivered" | "opened" | "clicked" | "converted" | "failed" | "opted_out";

export type MessageCampaign = {
  id: string;
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description: string | null;
  status: MessageCampaignStatus;
  channelType: MessageCampaignChannelType;
  notificationChannelId: string | null;
  segmentId: string | null;
  conversionEvent: string | null;
  subject: string | null;
  body: string;
  ctaUrl: string | null;
  consentCategory: string;
  privacyNote: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CreateMessageCampaignInput = {
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description?: string | null;
  status?: MessageCampaignStatus;
  channelType?: MessageCampaignChannelType;
  notificationChannelId?: string | null;
  segmentId?: string | null;
  conversionEvent?: string | null;
  subject?: string | null;
  body: string;
  ctaUrl?: string | null;
  consentCategory?: string;
  privacyNote?: string | null;
};

export type UpdateMessageCampaignInput = Partial<Omit<CreateMessageCampaignInput, "projectId" | "environmentId" | "key">>;

export type MessageCampaignResultsQuery = ApmQuery & {
  campaignId: string;
};

export type MessageCampaignEvent = {
  id: string;
  campaignId: string;
  type: MessageCampaignEventType;
  actorType: MessageCampaignActorType;
  actorId: string | null;
  tenantId: string | null;
  userId: string | null;
  occurredAt: string;
};

export type MessageCampaignResultsResponse = {
  campaign: MessageCampaign;
  window: ApmWindow;
  totals: {
    queued: number;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    converted: number;
    failed: number;
    optedOut: number;
    uniqueActors: number;
  };
  rates: {
    deliveryRate: number;
    openRate: number;
    clickRate: number;
    conversionRate: number;
    optOutRate: number;
  };
  recentEvents: MessageCampaignEvent[];
  optOuts: Array<{
    id: string;
    actorType: MessageCampaignActorType;
    actorId: string;
    category: string;
    reason: string | null;
    createdAt: string;
  }>;
};

export type NpsSegmentSummary = {
  key: string;
  label: string;
  responses: number;
  score: number;
  promoters: number;
  passives: number;
  detractors: number;
};

export type NpsResultsQuery = SurveyResultsQuery & {
  questionId?: string;
  tenantId?: string;
  release?: string;
  plan?: string;
};

export type NpsResultsResponse = {
  survey: Survey;
  window: ApmWindow;
  questionId: string;
  totals: {
    responses: number;
    promoters: number;
    passives: number;
    detractors: number;
    score: number;
    average: number | null;
  };
  trend: Array<{
    bucket: string;
    responses: number;
    score: number;
    promoters: number;
    passives: number;
    detractors: number;
  }>;
  segments: {
    tenants: NpsSegmentSummary[];
    releases: NpsSegmentSummary[];
    plans: NpsSegmentSummary[];
  };
  recentResponses: SurveyResponse[];
};

export type FeedbackStatus = "open" | "reviewed" | "archived";

export type FeedbackWidgetSettings = {
  projectId: string;
  environmentId: string;
  enabled: boolean;
  title: string;
  prompt: string;
  placeholder: string;
  buttonLabel: string;
  accentColor: string;
  allowScreenshot: boolean;
  privacyNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateFeedbackWidgetSettingsInput = {
  projectId: string;
  environmentId: string;
  enabled: boolean;
  title?: string;
  prompt?: string;
  placeholder?: string;
  buttonLabel?: string;
  accentColor?: string;
  allowScreenshot?: boolean;
  privacyNote?: string | null;
};

export type FeedbackItem = {
  id: string;
  projectId: string;
  environmentId: string;
  status: FeedbackStatus;
  message: string;
  category: string | null;
  pageUrl: string | null;
  path: string | null;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  release: string | null;
  source: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  submittedAt: string;
  receivedAt: string;
  updatedAt: string;
};

export type FeedbackListQuery = {
  projectId: string;
  environmentId: string;
  status?: FeedbackStatus;
  tenantId?: string;
  userId?: string;
  limit?: number;
};

export type FeatureFlagStatus = "draft" | "active" | "paused" | "archived";
export type FeatureFlagValue = string | number | boolean | null;

export type FeatureFlagVariant = {
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

export type FeatureFlagRule = {
  id?: string;
  description?: string;
  variant: string;
  match: FeatureFlagRuleMatch;
  rollout?: FeatureFlagRollout;
};

export type FeatureFlag = {
  id: string;
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description: string | null;
  status: FeatureFlagStatus;
  defaultVariant: string;
  variants: FeatureFlagVariant[];
  rules: FeatureFlagRule[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CreateFeatureFlagInput = {
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description?: string | null;
  status?: FeatureFlagStatus;
  defaultVariant: string;
  variants: FeatureFlagVariant[];
  rules?: FeatureFlagRule[];
};

export type UpdateFeatureFlagInput = Partial<Omit<CreateFeatureFlagInput, "projectId" | "environmentId" | "key">>;

export type FeatureFlagAudit = {
  id: string;
  featureFlagId: string;
  projectId: string;
  environmentId: string;
  action: "created" | "updated" | "archived";
  actorId: string | null;
  changes: unknown;
  createdAt: string;
};

export type FeatureFlagEvaluation = {
  key: string;
  variant: string;
  value: FeatureFlagValue;
  matched: boolean;
  reason: "rule_match" | "default" | "missing" | "inactive";
  ruleId?: string;
};

export type BetaProgramStatus = "draft" | "active" | "paused" | "archived";
export type BetaProgramActorType = "user" | "tenant";
export type BetaProgramParticipantStatus = "invited" | "active" | "opted_out" | "removed";

export type BetaProgram = {
  id: string;
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description: string | null;
  status: BetaProgramStatus;
  actorType: BetaProgramActorType;
  featureFlagId: string | null;
  featureFlagVariant: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CreateBetaProgramInput = {
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description?: string | null;
  status?: BetaProgramStatus;
  actorType?: BetaProgramActorType;
  featureFlagId?: string | null;
  featureFlagVariant?: string;
};

export type UpdateBetaProgramInput = Partial<Omit<CreateBetaProgramInput, "projectId" | "environmentId" | "key">>;

export type BetaProgramParticipant = {
  id: string;
  programId: string;
  projectId: string;
  environmentId: string;
  actorType: BetaProgramActorType;
  actorId: string;
  status: BetaProgramParticipantStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  removedAt: string | null;
};

export type AddBetaProgramParticipantInput = {
  projectId: string;
  environmentId: string;
  actorType: BetaProgramActorType;
  actorId: string;
  status?: BetaProgramParticipantStatus;
  notes?: string | null;
};

export type BetaProgramAdoption = {
  programId: string;
  window: ApmWindow;
  participants: number;
  activeParticipants: number;
  activeActorsWithEvents: number;
  events: number;
  adoptionRate: number;
  samples: Array<{ actorId: string; events: number; lastSeenAt: string }>;
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
  replayId: string | null;
  properties: unknown;
};

export type EventPropertyCatalogItem = {
  eventName: string;
  propertyName: string;
  totalOccurrences: number;
  eventCount: number;
  coveragePercent: number;
  dominantType: string;
  typeCounts: Record<string, number>;
  hasTypeConflict: boolean;
  sampleValues: string[];
  similarPropertyNames: string[];
  lastSeenAt: string | null;
};

export type EventPropertySimilarNameGroup = {
  normalizedName: string;
  propertyNames: string[];
  eventNames: string[];
};

export type EventPropertyCatalogResponse = {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  totals: {
    events: number;
    properties: number;
    conflictProperties: number;
    similarNameGroups: number;
  };
  properties: EventPropertyCatalogItem[];
  similarNameGroups: EventPropertySimilarNameGroup[];
};

export type EventClickMapQuery = ApmQuery & {
  route: string;
  selector?: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  gridSize?: number;
};

export type EventClickMapPoint = {
  xBucket: number;
  yBucket: number;
  clicks: number;
  percent: number;
};

export type EventClickMapResponse = {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  filters: {
    route: string;
    selector: string | null;
    tenantId: string | null;
    userId: string | null;
    sessionId: string | null;
    gridSize: number;
  };
  totals: {
    clicks: number;
    routes: number;
    selectors: number;
  };
  routes: Array<{ route: string; clicks: number }>;
  selectors: Array<{ selector: string; elementTag: string | null; elementRole: string | null; clicks: number }>;
  points: EventClickMapPoint[];
};

export type EventFunnelQuery = ApmQuery & {
  steps: string[];
};

export type EventFunnelStep = {
  index: number;
  name: string;
  actors: number;
  conversionPercent: number;
  dropOffFromPreviousPercent: number;
};

export type EventFunnelActor = {
  actorId: string;
  actorType: "user" | "tenant" | "session" | "trace";
  reachedStepIndex: number;
  reachedStepName: string;
  lastSeenAt: string;
};

export type EventFunnelResponse = {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  totals: {
    entrants: number;
    completed: number;
    conversionPercent: number;
  };
  steps: EventFunnelStep[];
  sampleActors: EventFunnelActor[];
};

export type EventRetentionPeriod = "daily" | "weekly" | "monthly";

export type EventRetentionQuery = ApmQuery & {
  entryEvent: string;
  returnEvent: string;
  period?: EventRetentionPeriod;
  intervals?: number;
};

export type EventRetentionInterval = {
  index: number;
  label: string;
  retainedActors: number;
  retentionPercent: number;
};

export type EventRetentionCohort = {
  cohortStart: string;
  cohortLabel: string;
  entrants: number;
  intervals: EventRetentionInterval[];
};

export type EventRetentionResponse = {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  entryEvent: string;
  returnEvent: string;
  period: EventRetentionPeriod;
  intervals: number;
  totals: {
    cohorts: number;
    entrants: number;
  };
  cohorts: EventRetentionCohort[];
};

export type EventPathActorType = "auto" | "user" | "tenant" | "session" | "trace";

export type EventPathsQuery = ApmQuery & {
  startEvent?: string;
  endEvent?: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  segmentId?: string;
  actorType?: EventPathActorType;
  from?: Date | string;
  to?: Date | string;
  pathLength?: number;
};

export type EventPathSampleEvent = {
  id: string;
  name: string;
  timestamp: string;
  actorId: string;
  actorType: "user" | "tenant" | "session" | "trace";
};

export type EventPathRow = {
  path: string[];
  actors: number;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sampleEvents: EventPathSampleEvent[];
};

export type EventPathsResponse = {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  filters: {
    startEvent: string | null;
    endEvent: string | null;
    tenantId: string | null;
    userId: string | null;
    sessionId: string | null;
    traceId: string | null;
    segmentId: string | null;
    actorType: EventPathActorType;
    pathLength: number;
  };
  totals: {
    actors: number;
    paths: number;
    events: number;
  };
  paths: EventPathRow[];
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
  assignedToUserId: string | null;
  assignedTo: { id: string; email: string } | null;
  incidentNumber: string | null;
  silencedUntil: string | null;
  trend?: number[];
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
  cursor?: string;
};

export type IncidentMttrQuery = {
  projectId: string;
  environmentId: string;
  window?: "7d" | "30d";
};

export type IncidentMttrResult = {
  mttrMs: number | null;
  resolvedCount: number;
  windowDays: number;
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

export type IncidentReplayEvent = {
  offsetMs: number;
  type: string;
  route?: string;
  selector?: string;
  message?: string;
  x?: number;
  y?: number;
  data: unknown;
};

export type IncidentReplayProductEvent = {
  id: string;
  name: string;
  timestamp: string;
  offsetMs: number;
};

export type IncidentReplay = {
  id: string;
  replayId: string;
  route: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  eventCount: number;
  masked: boolean;
  events: IncidentReplayEvent[];
  productEvents?: IncidentReplayProductEvent[];
};

export type SessionReplaySample = {
  id: string;
  replayId: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  route: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  eventCount: number;
  masked: boolean;
  linkedEventId: string | null;
  linkedEventName: string | null;
  linkedErrorId: string | null;
  linkedErrorMessage: string | null;
};

export type ErrorGroupIncident = {
  group: ErrorGroupRecord;
  primaryOccurrence: ErrorRecord;
  priority: ErrorGroupPriority | null;
  suggestedPriority: ErrorGroupPriority;
  sourceMapResolution: { status: "cached"; frameCount: number } | { status: "none" };
  stronglyRelated: { items: IncidentTimelineItem[]; truncated: boolean };
  nearbyContext: { items: IncidentTimelineItem[]; truncated: boolean };
  replay: IncidentReplay | null;
  related: {
    traceId: string | null;
    sessionId: string | null;
    userId: string | null;
    tenantId: string | null;
    release: string | null;
  };
  incidentNumber: string | null;
  assignedTo: { id: string; email: string } | null;
  silencedUntil: string | null;
  notes: { id: string; authorEmail: string; body: string; createdAt: string }[];
  externalIssues?: IncidentExternalLink[];
  codeContext: {
    status: "ready" | "limited";
    summary: string;
    repository: {
      provider: "github" | "gitlab";
      name: string;
      owner: string;
      repo: string;
      url: string;
    } | null;
    release: {
      release: string | null;
      commitSha: string | null;
      commitUrl: string | null;
      pullRequestNumber: number | null;
      pullRequestUrl: string | null;
      deployedBy: string | null;
    };
    suspectedFiles: Array<{
      path: string;
      functionName: string | null;
      line: number | null;
      column: number | null;
      confidence: "high" | "medium" | "low";
      evidence: string[];
    }>;
    evidence: Array<{
      type: "stack" | "source_map" | "release" | "repo" | "trace" | "breadcrumb" | "replay";
      label: string;
      value: string | null;
      confidence: "high" | "medium" | "low";
    }>;
    suggestedNextSteps: string[];
    privacy: {
      aiEnabled: boolean;
      outboundCodeSharing: boolean;
      reason: string;
    };
  };
};

export type TriageNoteRecord = {
  id: string;
  errorGroupId: string;
  authorUserId: string | null;
  authorEmail: string;
  body: string;
  createdAt: string;
};

export type AddTriageNoteInput = {
  projectId: string;
  environmentId: string;
  body: string;
};

export type SilenceIncidentInput = {
  projectId: string;
  environmentId: string;
  minutes: number | null;
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

type ErrorGroupTriageScope = {
  projectId: string;
  environmentId: string;
  assignedToUserId?: string | null;
};

type ErrorGroupTriagePatch =
  | { status: ErrorGroupStatus; priority?: ErrorGroupPriority | null }
  | { status?: ErrorGroupStatus; priority: ErrorGroupPriority | null }
  | { status?: undefined; priority?: undefined; assignedToUserId: string | null };

export type UpdateErrorGroupTriageInput = ErrorGroupTriageScope & ErrorGroupTriagePatch;

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
  limit?: number;
  cursor?: string;
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

export type LlmAggregateQuery = {
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
};

export type LlmSummary = {
  calls: number;
  failedCalls: number;
  costUsd: string;
  avgTokens: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
};

export type LlmTenantRow = {
  tenantId: string;
  calls: number;
  failedCalls: number;
  costUsd: string;
  avgTokens: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
};

export type LlmPromptRow = {
  promptName: string;
  model: string;
  calls: number;
  failedCalls: number;
  costUsd: string;
  avgTokens: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
};

export type LlmCostByModelSeries = {
  model: string;
  costs: string[];
};

export type LlmCostByModel = {
  buckets: string[];
  series: LlmCostByModelSeries[];
};

export type OverviewWindow = "24h" | "7d" | "30d";

export type OverviewTrendBucket = "hour" | "day";

export type OverviewErrorSeverity = "debug" | "info" | "warning" | "error" | "critical" | "fatal" | (string & {});

export type OverviewQuery = {
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
  release?: string;
};

export type OverviewRecentError = {
  id: string;
  errorGroupId: string | null;
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

export type RecentActivityItem = {
  id: string;
  type: "event" | "error" | "trace" | "llm";
  timestamp: string;
  title: string;
  status: string;
  severity: string | null;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  durationMs: number | null;
  costUsd: string | null;
};

export type RecentActivityQuery = OverviewQuery & {
  limit?: number;
};

export type RecentActivityResponse = {
  activity: RecentActivityItem[];
};

export type OverviewKpiDelta = {
  current: number;
  previous: number | null;
  absolute: number | null;
  percent: number | null;
  direction: "up" | "down" | "flat" | "none";
};

export type OverviewMoneyDelta = {
  current: string;
  previous: string | null;
  absolute: string | null;
  percent: number | null;
  direction: "up" | "down" | "flat" | "none";
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
  deltas?: {
    events: OverviewKpiDelta;
    activeUsers: OverviewKpiDelta;
    activeTenants: OverviewKpiDelta;
    errors: OverviewKpiDelta;
    openErrors: OverviewKpiDelta;
    traces: OverviewKpiDelta;
    failedTraces: OverviewKpiDelta;
    averageTraceDurationMs: OverviewKpiDelta;
    p95TraceDurationMs: OverviewKpiDelta;
    llmCalls: OverviewKpiDelta;
    failedLlmCalls: OverviewKpiDelta;
    llmInputTokens: OverviewKpiDelta;
    llmOutputTokens: OverviewKpiDelta;
    llmCostUsd: OverviewMoneyDelta;
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
    activity?: RecentActivityItem[];
    errors: OverviewRecentError[];
    failedTraces: OverviewRecentTrace[];
    failedLlmCalls: OverviewRecentLlmCall[];
  };
  releases?: {
    selected: string | null;
    recent: ReleaseSummary[];
  };
};

export type ReleaseSummary = {
  release: string;
  events: number;
  errors: number;
  traces: number;
  failedTraces: number;
  llmCalls: number;
  code: {
    commitSha: string | null;
    commitUrl: string | null;
    pullRequestNumber: number | null;
    pullRequestUrl: string | null;
    deployedBy: string | null;
  } | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type CodeIntegrationProvider = "github" | "gitlab";

export type CodeIntegration = {
  id: string;
  projectId: string;
  provider: CodeIntegrationProvider;
  name: string;
  owner: string;
  repo: string;
  webBaseUrl: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

export type IncidentExternalLink = {
  id: string;
  projectId: string;
  environmentId: string;
  errorGroupId: string;
  integrationId: string | null;
  provider: CodeIntegrationProvider;
  externalKey: string;
  title: string;
  url: string;
  state: string;
  createdAt: string;
  updatedAt: string;
};

export type IncidentIssueDraft = {
  provider: CodeIntegrationProvider;
  integrationId: string;
  title: string;
  body: string;
  url: string;
};

export type ReleaseListQuery = {
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
  limit?: number;
};

export type ReleaseListResponse = {
  window: OverviewWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  releases: ReleaseSummary[];
};

export type OperationsWindow = "24h" | "7d" | "30d";

export type OperationsStatus = "healthy" | "degraded" | "unhealthy" | "not_configured";

export type OperationsQuery = {
  projectId: string;
  environmentId: string;
  window: OperationsWindow;
};

export type ApmWindow = OperationsWindow;

export type ApmQuery = {
  projectId: string;
  environmentId: string;
  window: ApmWindow;
  limit?: number;
};

export type ApmEndpoint = {
  name: string;
  requests: number;
  errors: number;
  errorRatePercent: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  p99DurationMs: number | null;
  averageDurationMs: number | null;
  apdex: number | null;
  lastSeenAt: string | null;
};

export type ApmEndpointsResponse = {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  totals: {
    endpoints: number;
    requests: number;
    errors: number;
    errorRatePercent: number | null;
    p95DurationMs: number | null;
    apdex: number | null;
  };
  endpoints: ApmEndpoint[];
};

export type ServiceMapEdge = {
  source: string;
  target: string;
  dependencyType: string;
  spans: number;
  traces: number;
  errors: number;
  errorRatePercent: number | null;
  averageDurationMs: number | null;
  p95DurationMs: number | null;
  lastSeenAt: string | null;
};

export type ServiceMapResponse = {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  totals: {
    services: number;
    edges: number;
    spans: number;
    errors: number;
    errorRatePercent: number | null;
  };
  edges: ServiceMapEdge[];
};

export type WebVitalMetric = {
  name: "CLS" | "FCP" | "FID" | "INP" | "LCP" | "TTFB";
  route: string;
  samples: number;
  good: number;
  needsImprovement: number;
  poor: number;
  averageValue: number | null;
  p75Value: number | null;
  latestRelease: string | null;
  latestReleaseP75Value: number | null;
  previousRelease: string | null;
  previousReleaseP75Value: number | null;
  regressionPercent: number | null;
  lastSeenAt: string | null;
};

export type WebVitalsResponse = {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  totals: {
    samples: number;
    routes: number;
    releases: number;
    poorSamples: number;
    p75LcpMs: number | null;
    p75InpMs: number | null;
    p75Cls: number | null;
  };
  metrics: WebVitalMetric[];
};

export type RuntimeProfile = {
  id: string;
  name: string;
  kind: "cpu" | "memory";
  runtime: string;
  service: string | null;
  route: string | null;
  traceId: string | null;
  source: string | null;
  release: string | null;
  startedAt: string;
  durationMs: number | null;
  sampleCount: number;
  cpuUsagePercent: number | null;
  heapUsedBytes: number | null;
  rssBytes: number | null;
  topFunction: string | null;
  topFunctionSelfTimeMs: number | null;
};

export type RuntimeProfileHotFunction = {
  functionName: string;
  url: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  selfTimeMs: number;
  totalTimeMs: number | null;
  sampleCount: number;
  profileCount: number;
  lastSeenAt: string | null;
};

export type RuntimeProfilesResponse = {
  window: ApmWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  totals: {
    profiles: number;
    cpuProfiles: number;
    memoryProfiles: number;
    samples: number;
    avgCpuUsagePercent: number | null;
    maxHeapUsedBytes: number | null;
    p95DurationMs: number | null;
  };
  profiles: RuntimeProfile[];
  hotFunctions: RuntimeProfileHotFunction[];
};

export type OperationsMonitorStatus = "unknown" | "up" | "down" | "degraded" | "paused";

export type OperationsStatusCounts = {
  total: number;
  up: number;
  degraded: number;
  down: number;
  paused: number;
  unknown: number;
};

export type OperationsSetupGap = {
  key: "http_monitor" | "heartbeat_monitor" | "alert_rule" | "notification_channel" | "recent_telemetry";
  label: string;
  severity: "info" | "warning";
  action: "monitors" | "alerts" | "setup" | "overview";
};

export type OperationsAnomaly = {
  id: string;
  type: "event_volume" | "error_volume" | "error_rate" | "trace_p95_latency" | "llm_cost";
  label: string;
  severity: "info" | "warning" | "critical";
  observedValue: number;
  baselineValue: number;
  changePercent: number | null;
  sampleSize: number;
  baselineSampleSize: number;
  threshold: string;
  reason: string;
  suggestedAlertRuleType: AlertRuleType | null;
  routePattern: string | null;
  drilldown: "events" | "errors" | "traces" | "llm" | "alerts";
};

export type OperationsPredictionSeverity = "low" | "medium" | "high" | "critical";

export type OperationsPrediction = {
  id: string;
  type: "operational_risk";
  label: string;
  horizon: "next_window";
  severity: OperationsPredictionSeverity;
  score: number;
  confidence: "low" | "medium" | "high";
  probabilityPercent: number;
  validation: {
    baselineWindow: { from: string; to: string };
    currentWindow: { from: string; to: string };
    baselineRiskScore: number;
    delta: number;
    sampleSize: number;
    baselineSampleSize: number;
    method: string;
  };
  factors: Array<{
    key: string;
    label: string;
    impact: "positive" | "negative";
    weight: number;
    observedValue: number;
    baselineValue: number | null;
    reason: string;
  }>;
  suggestedDrilldown: "operations" | "alerts" | "monitors" | "errors" | "traces";
};

export type OperationsResponse = {
  window: OperationsWindow;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string; to: string };
  status: OperationsStatus;
  summary: {
    monitors: {
      total: number;
      http: OperationsStatusCounts;
      heartbeat: OperationsStatusCounts;
    };
    alerts: {
      rules: { total: number; enabled: number };
      events: { total: number; critical: number; warning: number; deliveryFailed: number; deliveryPending: number };
    };
    telemetry: {
      events: number;
      errors: number;
      traces: number;
      failedTraces: number;
      errorRatePercent: number | null;
      p95TraceDurationMs: number | null;
      lastEventAt: string | null;
      lastErrorAt: string | null;
      lastTraceAt: string | null;
    };
    incidents: {
      open: number;
      investigating: number;
      urgent: number;
      high: number;
      regressed: number;
    };
  };
  recent: {
    monitors: Array<{
      id: string;
      kind: "http" | "heartbeat";
      name: string;
      status: OperationsMonitorStatus;
      lastCheckedAt: string | null;
      lastHeartbeatAt: string | null;
      lastCheckLatencyMs: number | null;
      lastCheckErrorMessage: string | null;
    }>;
    alerts: Array<{
      id: string;
      severity: "info" | "warning" | "critical";
      triggeredAt: string;
      message: string;
      latestDeliveryStatus: "success" | "failed" | null;
    }>;
    incidents: Array<{
      id: string;
      message: string;
      severity: string;
      status: ErrorGroupStatus;
      priority: ErrorGroupPriority | null;
      lastSeenAt: string;
      latestErrorId: string | null;
    }>;
  };
  topLatency: Array<{ name: string; p95TraceDurationMs: number; traces: number; failedTraces: number }>;
  anomalies: OperationsAnomaly[];
  predictions?: OperationsPrediction[];
  setupGaps: OperationsSetupGap[];
};

export type EntityWindow = "24h" | "7d" | "30d";

export type EntitySignalType = "event" | "error" | "trace" | "llm";

export type TenantSummary = {
  tenantId: string | null;
  label: string;
  traits: Record<string, unknown>;
  keyTraits: Record<string, string>;
  isUnassigned: boolean;
  impactScore: number;
  firstSeenAt?: string | null;
  lastSeenAt: string | null;
  profileUpdatedAt?: string | null;
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
  traits: Record<string, unknown>;
  keyTraits: Record<string, string>;
  isAnonymous: boolean;
  impactScore: number;
  firstSeenAt?: string | null;
  lastSeenAt: string | null;
  profileUpdatedAt?: string | null;
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
    worker: {
      status: SystemStatus;
      expected: boolean;
      role: "all" | "queue" | "scheduler" | null;
      lastHeartbeatAt: string | null;
    };
    scheduler: {
      status: SystemStatus;
      expected: boolean;
      role: "all" | "queue" | "scheduler" | null;
      lastHeartbeatAt: string | null;
    };
  };
  deployment: {
    api: {
      nodeEnv: string;
      consoleEnabled: boolean;
      publicEndpointConfigured: boolean;
      googleOAuthEnabled: boolean;
      smtpConfigured: boolean;
    };
    background: {
      queueExpected: boolean;
      schedulerExpected: boolean;
      alertsEnabled: boolean;
      alertsIntervalMinutes: number;
      monitorsEnabled: boolean;
      monitorsIntervalMinutes: number;
      retentionEnabled: boolean;
      retentionIntervalMinutes: number;
      backupsEnabled: boolean;
      backupsIntervalHours: number;
    };
    storage: {
      backupS3Enabled: boolean;
      sourceMapRetentionEnabled: boolean;
    };
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
      deadLettered: number;
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
        webVitals: number;
        profiles: number;
        breadcrumbs: number;
        deadLetterJobs: number;
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
      profilesDays: number;
      breadcrumbsDays: number;
      deadLetterJobsDays: number;
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

export type SystemHealthSampleResponse = {
  capturedAt: string;
  postgresLatencyMs: number | null;
  redisLatencyMs: number | null;
  queueWaiting: number;
  queueActive: number;
  queueFailed: number;
};

export type SystemActionResponse = {
  ok: true;
  action: "doctor" | "backup" | "retention";
  status: "success" | "skipped";
  message: string;
  ran?: boolean;
  skipped?: boolean;
  generatedAt: string;
};

export type NotificationChannelResponse =
  | {
      id: string;
      name: string;
      type: "webhook";
      url: string;
      emailRecipients: [];
      secretHeaderName: string | null;
      hasSecret: boolean;
      enabled: boolean;
      createdAt: string;
      updatedAt: string;
      archivedAt: string | null;
    }
  | {
      id: string;
      name: string;
      type: "email";
      url: null;
      emailRecipients: string[];
      secretHeaderName: null;
      hasSecret: false;
      enabled: boolean;
      createdAt: string;
      updatedAt: string;
      archivedAt: string | null;
    };

export type CreateNotificationChannelInput =
  | {
      name: string;
      type: "webhook";
      url: string;
      secretHeaderName?: string | null;
      secretHeaderValue?: string | null;
      enabled?: boolean;
    }
  | {
      name: string;
      type: "email";
      emailRecipients: string[];
      enabled?: boolean;
    };

export type UpdateNotificationChannelInput = Partial<CreateNotificationChannelInput>;

export type AlertRuleType =
  | "critical_errors"
  | "error_count"
  | "error_rate"
  | "trace_p95_latency"
  | "llm_cost"
  | "dead_letter_count";

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertRuleResponse = {
  id: string;
  projectId: string;
  environmentId: string;
  notificationChannelId: string | null;
  escalationChannelId: string | null;
  name: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  windowMinutes: number;
  threshold: string;
  cooldownMinutes: number;
  escalationMinutes: number | null;
  routePattern: string | null;
  minimumSampleSize: number;
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
  escalationChannelId?: string | null;
  name: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  windowMinutes: number;
  threshold: string;
  cooldownMinutes: number;
  escalationMinutes?: number | null;
  routePattern?: string | null;
  minimumSampleSize?: number;
  enabled?: boolean;
};

export type UpdateAlertRuleInput = Partial<CreateAlertRuleInput>;

export type AlertRuleListQuery = {
  projectId?: string;
  environmentId?: string;
};

export type AlertEventResponse = {
  id: string;
  ruleId: string | null;
  monitorId: string | null;
  projectId: string;
  environmentId: string;
  status: "triggered" | "acknowledged" | "snoozed" | "resolved";
  severity: AlertSeverity;
  triggeredAt: string;
  windowStart: string;
  windowEnd: string;
  observedValue: string;
  threshold: string;
  message: string;
  metadata: unknown;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  acknowledgedByEmail: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolvedByEmail: string | null;
  snoozedUntil: string | null;
  triageNote: string | null;
  escalationDueAt: string | null;
  escalatedAt: string | null;
  createdAt: string;
  latestDeliveryStatus: "success" | "failed" | null;
};

export type UpdateAlertEventTriageInput = {
  status: AlertEventResponse["status"];
  snoozedUntil?: Date | string | null;
  note?: string | null;
};

export type AlertSuggestionResponse = {
  key: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  title: string;
  sub: string;
  windowMinutes: number;
  threshold: string;
  routePattern?: string | null;
  minimumSampleSize?: number;
  rationale: string;
  cooldownMinutes: number;
};

export type AlertEventListQuery = {
  projectId: string;
  environmentId: string;
  limit?: number;
};

export type MonitorKind = "http" | "heartbeat";

export type MonitorStatus = "unknown" | "up" | "down" | "degraded" | "paused";

export type MonitorCheckStatus = "success" | "failed";

export type MonitorResponse = {
  id: string;
  projectId: string;
  environmentId: string;
  notificationChannelId: string | null;
  kind: MonitorKind;
  name: string;
  enabled: boolean;
  status: MonitorStatus;
  url: string | null;
  method: "GET" | "HEAD" | null;
  expectedStatus: string | null;
  bodyContains: string | null;
  timeoutMs: number | null;
  intervalMinutes: number | null;
  failureThreshold: number;
  recoveryThreshold: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  expectedIntervalMinutes: number | null;
  graceMinutes: number | null;
  lastCheckedAt: string | null;
  lastCheckStatus: MonitorCheckStatus | null;
  lastCheckLatencyMs: number | null;
  lastCheckResponseStatus: number | null;
  lastCheckErrorMessage: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type MonitorCheckResponse = {
  id: string;
  monitorId: string;
  checkedAt: string;
  status: MonitorCheckStatus;
  latencyMs: number | null;
  responseStatus: number | null;
  errorMessage: string | null;
  createdAt: string;
};

export type MonitorListQuery = {
  projectId: string;
  environmentId: string;
  kind?: MonitorKind;
};

export type CreateHttpMonitorInput = {
  projectId: string;
  environmentId: string;
  notificationChannelId?: string | null;
  name: string;
  url: string;
  method?: "GET" | "HEAD";
  intervalMinutes?: number;
  timeoutMs?: number;
  expectedStatus?: string;
  bodyContains?: string | null;
  failureThreshold?: number;
  recoveryThreshold?: number;
  enabled?: boolean;
};

export type CreateHeartbeatMonitorInput = {
  projectId: string;
  environmentId: string;
  notificationChannelId?: string | null;
  name: string;
  expectedIntervalMinutes: number;
  graceMinutes?: number;
  enabled?: boolean;
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
  browserCorsOrigins: string[];
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
  traceName?: string;
  eventId?: string;
  eventName?: string;
  severity?: string;
  status?: string;
  fingerprint?: string;
  errorGroupId?: string;
  segmentId?: string;
  provider?: string;
  model?: string;
  promptName?: string;
  from?: Date | string;
  to?: Date | string;
  limit?: number;
  cursor?: string;
};

export type SessionReplaySampleQuery = Pick<
  QueryFilters,
  "projectId" | "environmentId" | "tenantId" | "userId" | "eventName" | "segmentId" | "limit"
>;
