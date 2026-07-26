import type {
  AddTriageNoteInput,
  AggregateResponse,
  AnalyticsDashboard,
  AnalyticsSegment,
  AnalyticsSegmentPreview,
  ApmEndpointsResponse,
  ApmQuery,
  ApiKey,
  AddBetaProgramParticipantInput,
  BetaProgram,
  BetaProgramAdoption,
  BetaProgramParticipant,
  BrowserOrigin,
  CodeIntegration,
  CodeIntegrationProvider,
  AlertEventListQuery,
  AlertEventResponse,
  AlertRuleListQuery,
  AlertRuleResponse,
  AlertSuggestionResponse,
  ConsoleConfig,
  CreateAlertRuleInput,
  CreateAnalyticsDashboardInput,
  CreateAnalyticsSegmentInput,
  CreateBetaProgramInput,
  CreateExperimentInput,
  CreateFeatureFlagInput,
  CreateMessageCampaignInput,
  CreateSurveyInput,
  CreateHeartbeatMonitorInput,
  CreateHttpMonitorInput,
  CreateWarehouseDestinationInput,
  CreatedApiKey,
  CreatedSourceMapUploadToken,
  CreateNotificationChannelInput,
  DashboardReportResponse,
  DataGovernancePolicy,
  DeadLetterJobActionResponse,
  DeadLetterJobListQuery,
  DeadLetterJobResponse,
  DeadLetterReplayResult,
  Environment,
  Experiment,
  ExperimentResultsQuery,
  ExperimentResultsResponse,
  FeatureFlag,
  FeatureFlagAudit,
  FeatureFlagEvaluation,
  FeedbackItem,
  FeedbackListQuery,
  FeedbackStatus,
  FeedbackWidgetSettings,
  ErrorGroupIncident,
  ErrorGroupIncidentQuery,
  ErrorGroupQuery,
  ErrorGroupRecord,
  IncidentMttrQuery,
  IncidentMttrResult,
  IncidentExternalLink,
  IncidentIssueDraft,
  IncidentReplay,
  ErrorRecord,
  EventClickMapQuery,
  EventClickMapResponse,
  EventFunnelQuery,
  EventFunnelResponse,
  EventPathsQuery,
  EventPathsResponse,
  EventPropertyCatalogResponse,
  EventRecord,
  EventRetentionQuery,
  EventRetentionResponse,
  LlmAggregates,
  LlmCallRecord,
  MessageCampaign,
  MessageCampaignResultsQuery,
  MessageCampaignResultsResponse,
  MonitorCheckResponse,
  MonitorListQuery,
  MonitorResponse,
  NpsResultsQuery,
  NpsResultsResponse,
  NotificationChannelResponse,
  OverviewQuery,
  OverviewResponse,
  OperationsQuery,
  OperationsResponse,
  Project,
  QueryFilters,
  QueryListResponse,
  RecentActivityQuery,
  RecentActivityResponse,
  ReleaseListQuery,
  ReleaseListResponse,
  RuntimeProfilesResponse,
  SessionTimelineQuery,
  SessionTimelineResponse,
  SessionReplaySample,
  SessionReplaySampleQuery,
  SilenceIncidentInput,
  ServiceMapResponse,
  SourceMapArtifact,
  SourceMapArtifactQuery,
  SourceMapResolution,
  SourceMapUploadToken,
  SpanRecord,
  Survey,
  SurveyResultsQuery,
  SurveyResultsResponse,
  SystemActionResponse,
  SystemHealthResponse,
  SystemHealthSampleResponse,
  TenantDetailQuery,
  TenantDetailResponse,
  TenantListQuery,
  TenantListResponse,
  TraceRecord,
  TriageNoteRecord,
  UpdateAlertEventTriageInput,
  User,
  UserDetailQuery,
  UserDetailResponse,
  UserListQuery,
  UserListResponse,
  UpdateAlertRuleInput,
  UpdateAnalyticsDashboardInput,
  UpdateAnalyticsSegmentInput,
  UpdateBetaProgramInput,
  UpdateExperimentInput,
  UpdateFeatureFlagInput,
  UpdateFeedbackWidgetSettingsInput,
  UpdateMessageCampaignInput,
  UpdateSurveyInput,
  UpdateErrorGroupStatusInput,
  UpdateErrorGroupTriageInput,
  UpdateNotificationChannelInput,
  UpdateWarehouseDestinationInput,
  WarehouseDestination,
  WarehouseExportRun,
  WebVitalsResponse,
  LlmAggregateQuery,
  LlmSummary,
  LlmTenantRow,
  LlmPromptRow,
  LlmCostByModel
} from "./types";

// Fleet types — matching B1 spec §2 verbatim
export type FleetProject = {
  id: string;
  name: string;
  status: "ok" | "warning" | "critical" | "idle";
  incidents: number;
  alerts: number;
  errorRatePercent: number | null;
  errorRateDelta: number | null;
  errorTrend: number[];
  events: number;
  activeUsers: number;
  activeTenants: number;
  llmCostUsd: string;
  llmCostDeltaUsd: string | null;
  p95TraceDurationMs: number | null;
  p95DeltaMs: number | null;
  infra: {
    api: "ok" | "warning" | "critical";
    db: "ok" | "warning" | "critical";
    redis: "ok" | "warning" | "critical";
    queue: "ok" | "warning" | "critical";
  };
  topIncident: {
    message: string;
    traceOrRouteName: string | null;
    occurrenceCount: number;
    affectedUsers: number;
    severity: "critical" | "warning";
  } | null;
};

export type FleetRollup = {
  counts: { ok: number; warning: number; critical: number };
  incidents: number;
  alerts: number;
  llmCostUsd: string;
  overall: "ok" | "warning" | "critical";
  total: number;
};

export type FleetData = {
  window: "24h" | "7d" | "30d";
  generatedAt: string;
  projects: FleetProject[];
  rollup: FleetRollup;
};

export type FleetResponse = {
  data: FleetData;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export type AlertApiClient = {
  listNotificationChannels: () => Promise<{ channels: NotificationChannelResponse[] }>;
  createNotificationChannel: (input: CreateNotificationChannelInput) => Promise<{ channel: NotificationChannelResponse }>;
  updateNotificationChannel: (id: string, input: UpdateNotificationChannelInput) => Promise<{ channel: NotificationChannelResponse }>;
  archiveNotificationChannel: (id: string) => Promise<void>;
  listAlertRules: (query?: AlertRuleListQuery) => Promise<{ rules: AlertRuleResponse[] }>;
  createAlertRule: (input: CreateAlertRuleInput) => Promise<{ rule: AlertRuleResponse }>;
  updateAlertRule: (id: string, input: UpdateAlertRuleInput) => Promise<{ rule: AlertRuleResponse }>;
  archiveAlertRule: (id: string) => Promise<void>;
  listAlertEvents: (query: AlertEventListQuery) => Promise<QueryListResponse<AlertEventResponse>>;
  getAlertEvent: (id: string) => Promise<AggregateResponse<AlertEventResponse>>;
  updateAlertEventTriage: (id: string, input: UpdateAlertEventTriageInput) => Promise<AggregateResponse<AlertEventResponse>>;
};

export type AlertSuggestionApiClient = {
  listAlertSuggestions: (query: { projectId: string; environmentId: string }) => Promise<{ suggestions: AlertSuggestionResponse[] }>;
};

export type MonitorApiClient = {
  listMonitors: (query: MonitorListQuery) => Promise<{ monitors: MonitorResponse[] }>;
  createHttpMonitor: (input: CreateHttpMonitorInput) => Promise<{ monitor: MonitorResponse }>;
  createHeartbeatMonitor: (input: CreateHeartbeatMonitorInput) => Promise<{ monitor: MonitorResponse; secret: string }>;
  updateMonitor: (id: string, input: Partial<CreateHttpMonitorInput & CreateHeartbeatMonitorInput>) => Promise<{ monitor: MonitorResponse }>;
  archiveMonitor: (id: string) => Promise<void>;
  listMonitorChecks: (
    id: string,
    options: { projectId: string; environmentId: string; limit?: number; cursor?: string }
  ) => Promise<{ checks: MonitorCheckResponse[]; cursor?: string }>;
};

export type DeadLetterApiClient = {
  listDeadLetterJobs: (query?: DeadLetterJobListQuery) => Promise<{ deadLetterJobs: DeadLetterJobResponse[]; cursor?: string }>;
  getDeadLetterJob: (id: string) => Promise<{ deadLetterJob: DeadLetterJobResponse }>;
  listDeadLetterJobActions: (id: string) => Promise<{ actions: DeadLetterJobActionResponse[] }>;
  replayDeadLetterJob: (id: string) => Promise<DeadLetterReplayResult>;
  deleteDeadLetterJob: (id: string) => Promise<void>;
};

export type ErrorGroupApiClient = {
  listErrorGroups: (query: ErrorGroupQuery) => Promise<QueryListResponse<ErrorGroupRecord>>;
  getErrorGroup: (
    id: string,
    query: Pick<ErrorGroupQuery, "projectId" | "environmentId">
  ) => Promise<AggregateResponse<ErrorGroupRecord>>;
  getErrorGroupIncident: (
    id: string,
    query: ErrorGroupIncidentQuery
  ) => Promise<AggregateResponse<ErrorGroupIncident>>;
  updateErrorGroupStatus: (id: string, input: UpdateErrorGroupStatusInput) => Promise<AggregateResponse<ErrorGroupRecord>>;
  updateErrorGroupTriage: (id: string, input: UpdateErrorGroupTriageInput) => Promise<AggregateResponse<ErrorGroupRecord>>;
  addTriageNote: (id: string, input: AddTriageNoteInput) => Promise<AggregateResponse<TriageNoteRecord>>;
  silenceIncident: (id: string, input: SilenceIncidentInput) => Promise<AggregateResponse<ErrorGroupRecord>>;
  linkIncidentExternalIssue?: (
    id: string,
    query: Pick<ErrorGroupIncidentQuery, "projectId" | "environmentId">,
    input: {
      integrationId?: string | null;
      provider: CodeIntegrationProvider;
      externalKey: string;
      title: string;
      url: string;
      state?: string;
    }
  ) => Promise<{ link: IncidentExternalLink }>;
  createIncidentIssueDraft?: (
    id: string,
    query: Pick<ErrorGroupIncidentQuery, "projectId" | "environmentId">,
    input: { integrationId: string; incidentUrl?: string }
  ) => Promise<{ draft: IncidentIssueDraft }>;
};

export type SourceMapUploadInput = Pick<SourceMapArtifactQuery, "projectId" | "environmentId"> & {
  release: string;
  minifiedFile?: string;
  file: Blob;
};

export type SourceMapBundleUploadInput = Pick<SourceMapArtifactQuery, "projectId" | "environmentId"> & {
  release: string;
  bundle: Blob;
};

export type SourceMapApiClient = {
  listSourceMapArtifacts: (query: SourceMapArtifactQuery) => Promise<SourceMapArtifact[]>;
  uploadSourceMap: (input: SourceMapUploadInput) => Promise<SourceMapArtifact[]>;
  uploadSourceMapBundle: (input: SourceMapBundleUploadInput) => Promise<SourceMapArtifact[]>;
  deleteSourceMapArtifact: (id: string, query: Pick<SourceMapArtifactQuery, "projectId" | "environmentId">) => Promise<void>;
  listSourceMapUploadTokens: (
    query: Pick<SourceMapArtifactQuery, "projectId" | "environmentId">
  ) => Promise<{ tokens: SourceMapUploadToken[] }>;
  createSourceMapUploadToken: (input: {
    projectId: string;
    environmentId: string;
    name: string;
  }) => Promise<{ token: CreatedSourceMapUploadToken }>;
  updateSourceMapUploadToken: (
    id: string,
    query: Pick<SourceMapArtifactQuery, "projectId" | "environmentId">,
    input: { name?: string }
  ) => Promise<{ token: SourceMapUploadToken }>;
  revokeSourceMapUploadToken: (
    id: string,
    query: Pick<SourceMapArtifactQuery, "projectId" | "environmentId">
  ) => Promise<void>;
  getErrorSourceMapResolution: (
    id: string,
    query: Pick<SourceMapArtifactQuery, "projectId" | "environmentId">
  ) => Promise<SourceMapResolution>;
};

export type SessionTimelineApiClient = {
  getSessionTimeline: (sessionId: string, query: SessionTimelineQuery) => Promise<AggregateResponse<SessionTimelineResponse>>;
  getSessionReplayDetail?: (
    replayId: string,
    query: Pick<SessionTimelineQuery, "projectId" | "environmentId">
  ) => Promise<AggregateResponse<IncidentReplay>>;
  listSessionReplays?: (query: SessionReplaySampleQuery) => Promise<QueryListResponse<SessionReplaySample>>;
};

export type ApiClient = {
  getConsoleConfig: () => Promise<ConsoleConfig>;
  getMe: () => Promise<{ user: User }>;
  login: (email: string, password: string) => Promise<{ user: User }>;
  logout: () => Promise<{ ok: true }>;
  listProjects: () => Promise<{ projects: Project[] }>;
  createProject: (input: { name: string }) => Promise<{ project: Project }>;
  updateProject: (id: string, input: { name?: string }) => Promise<{ project: Project }>;
  archiveProject: (id: string) => Promise<void>;
  listEnvironments: (projectId: string) => Promise<{ environments: Environment[] }>;
  createEnvironment: (projectId: string, input: { name: string }) => Promise<{ environment: Environment }>;
  updateEnvironment: (id: string, input: { name?: string }) => Promise<{ environment: Environment }>;
  archiveEnvironment: (id: string) => Promise<void>;
  listAnalyticsSegments?: (query: Pick<CreateAnalyticsSegmentInput, "projectId" | "environmentId">) => Promise<{ segments: AnalyticsSegment[] }>;
  createAnalyticsSegment?: (input: CreateAnalyticsSegmentInput) => Promise<{ segment: AnalyticsSegment }>;
  updateAnalyticsSegment?: (id: string, input: UpdateAnalyticsSegmentInput) => Promise<{ segment: AnalyticsSegment }>;
  archiveAnalyticsSegment?: (id: string) => Promise<void>;
  previewAnalyticsSegment?: (
    id: string,
    query: Pick<CreateAnalyticsSegmentInput, "projectId" | "environmentId"> & { limit?: number }
  ) => Promise<{ preview: AnalyticsSegmentPreview }>;
  listAnalyticsDashboards?: (query: Pick<CreateAnalyticsDashboardInput, "projectId" | "environmentId">) => Promise<{ dashboards: AnalyticsDashboard[] }>;
  createAnalyticsDashboard?: (input: CreateAnalyticsDashboardInput) => Promise<{ dashboard: AnalyticsDashboard }>;
  updateAnalyticsDashboard?: (
    id: string,
    query: Pick<CreateAnalyticsDashboardInput, "projectId" | "environmentId">,
    input: UpdateAnalyticsDashboardInput
  ) => Promise<{ dashboard: AnalyticsDashboard }>;
  archiveAnalyticsDashboard?: (id: string, query: Pick<CreateAnalyticsDashboardInput, "projectId" | "environmentId">) => Promise<void>;
  getDashboardReport?: (
    id: string,
    query: Pick<CreateAnalyticsDashboardInput, "projectId" | "environmentId"> & { window?: "24h" | "7d" | "30d" }
  ) => Promise<AggregateResponse<DashboardReportResponse>>;
  listExperiments?: (query: Pick<CreateExperimentInput, "projectId" | "environmentId">) => Promise<{ experiments: Experiment[] }>;
  createExperiment?: (input: CreateExperimentInput) => Promise<{ experiment: Experiment }>;
  updateExperiment?: (
    id: string,
    query: Pick<CreateExperimentInput, "projectId" | "environmentId">,
    input: UpdateExperimentInput
  ) => Promise<{ experiment: Experiment }>;
  archiveExperiment?: (id: string, query: Pick<CreateExperimentInput, "projectId" | "environmentId">) => Promise<void>;
  getExperimentResults?: (query: ExperimentResultsQuery) => Promise<AggregateResponse<ExperimentResultsResponse>>;
  listSurveys?: (query: Pick<CreateSurveyInput, "projectId" | "environmentId">) => Promise<{ surveys: Survey[] }>;
  createSurvey?: (input: CreateSurveyInput) => Promise<{ survey: Survey }>;
  updateSurvey?: (
    id: string,
    query: Pick<CreateSurveyInput, "projectId" | "environmentId">,
    input: UpdateSurveyInput
  ) => Promise<{ survey: Survey }>;
  archiveSurvey?: (id: string, query: Pick<CreateSurveyInput, "projectId" | "environmentId">) => Promise<void>;
  getSurveyResults?: (query: SurveyResultsQuery) => Promise<AggregateResponse<SurveyResultsResponse>>;
  getNpsResults?: (query: NpsResultsQuery) => Promise<AggregateResponse<NpsResultsResponse>>;
  listMessageCampaigns?: (query: Pick<CreateMessageCampaignInput, "projectId" | "environmentId">) => Promise<{ campaigns: MessageCampaign[] }>;
  createMessageCampaign?: (input: CreateMessageCampaignInput) => Promise<{ campaign: MessageCampaign }>;
  updateMessageCampaign?: (
    id: string,
    query: Pick<CreateMessageCampaignInput, "projectId" | "environmentId">,
    input: UpdateMessageCampaignInput
  ) => Promise<{ campaign: MessageCampaign }>;
  archiveMessageCampaign?: (id: string, query: Pick<CreateMessageCampaignInput, "projectId" | "environmentId">) => Promise<void>;
  getMessageCampaignResults?: (query: MessageCampaignResultsQuery) => Promise<AggregateResponse<MessageCampaignResultsResponse>>;
  getFeedbackWidgetSettings?: (query: Pick<UpdateFeedbackWidgetSettingsInput, "projectId" | "environmentId">) => Promise<{ settings: FeedbackWidgetSettings }>;
  updateFeedbackWidgetSettings?: (input: UpdateFeedbackWidgetSettingsInput) => Promise<{ settings: FeedbackWidgetSettings }>;
  listFeedbackItems?: (query: FeedbackListQuery) => Promise<{ feedback: FeedbackItem[] }>;
  updateFeedbackStatus?: (
    id: string,
    query: Pick<FeedbackListQuery, "projectId" | "environmentId">,
    status: FeedbackStatus
  ) => Promise<{ feedback: FeedbackItem }>;
  listFeatureFlags?: (query: Pick<CreateFeatureFlagInput, "projectId" | "environmentId">) => Promise<{ flags: FeatureFlag[] }>;
  createFeatureFlag?: (input: CreateFeatureFlagInput) => Promise<{ flag: FeatureFlag }>;
  updateFeatureFlag?: (
    id: string,
    query: Pick<CreateFeatureFlagInput, "projectId" | "environmentId">,
    input: UpdateFeatureFlagInput
  ) => Promise<{ flag: FeatureFlag }>;
  archiveFeatureFlag?: (id: string, query: Pick<CreateFeatureFlagInput, "projectId" | "environmentId">) => Promise<void>;
  listFeatureFlagAudit?: (id: string, query: Pick<CreateFeatureFlagInput, "projectId" | "environmentId">) => Promise<{ audit: FeatureFlagAudit[] }>;
  evaluateFeatureFlag?: (
    id: string,
    query: Pick<CreateFeatureFlagInput, "projectId" | "environmentId">,
    input: { fallbackVariant?: string; subject?: { userId?: string; tenantId?: string; sessionId?: string; traits?: Record<string, string | number | boolean | null> } }
  ) => Promise<{ evaluation: FeatureFlagEvaluation }>;
  listBetaPrograms?: (query: Pick<CreateBetaProgramInput, "projectId" | "environmentId">) => Promise<{ programs: BetaProgram[] }>;
  createBetaProgram?: (input: CreateBetaProgramInput) => Promise<{ program: BetaProgram }>;
  updateBetaProgram?: (
    id: string,
    query: Pick<CreateBetaProgramInput, "projectId" | "environmentId">,
    input: UpdateBetaProgramInput
  ) => Promise<{ program: BetaProgram }>;
  archiveBetaProgram?: (id: string, query: Pick<CreateBetaProgramInput, "projectId" | "environmentId">) => Promise<void>;
  listBetaProgramParticipants?: (
    id: string,
    query: Pick<CreateBetaProgramInput, "projectId" | "environmentId">
  ) => Promise<{ participants: BetaProgramParticipant[] }>;
  addBetaProgramParticipant?: (id: string, input: AddBetaProgramParticipantInput) => Promise<{ participant: BetaProgramParticipant }>;
  removeBetaProgramParticipant?: (
    id: string,
    participantId: string,
    query: Pick<CreateBetaProgramInput, "projectId" | "environmentId">
  ) => Promise<void>;
  getBetaProgramAdoption?: (
    id: string,
    query: Pick<CreateBetaProgramInput, "projectId" | "environmentId"> & { window?: "24h" | "7d" | "30d" }
  ) => Promise<{ adoption: BetaProgramAdoption }>;
  listApiKeys: (projectId: string) => Promise<{ apiKeys: ApiKey[] }>;
  createApiKey: (projectId: string, input: { environmentId: string; name: string }) => Promise<{ apiKey: CreatedApiKey }>;
  updateApiKey?: (id: string, input: { name?: string }) => Promise<{ apiKey: ApiKey }>;
  revokeApiKey: (id: string) => Promise<void>;
  listBrowserOrigins?: (projectId: string) => Promise<{ origins: BrowserOrigin[] }>;
  createBrowserOrigin?: (projectId: string, input: { origin: string }) => Promise<{ origin: BrowserOrigin }>;
  archiveBrowserOrigin?: (id: string) => Promise<void>;
  listCodeIntegrations?: (projectId: string) => Promise<{ integrations: CodeIntegration[] }>;
  createCodeIntegration?: (
    projectId: string,
    input: { provider: CodeIntegrationProvider; name: string; owner: string; repo: string }
  ) => Promise<{ integration: CodeIntegration }>;
  revokeCodeIntegration?: (projectId: string, id: string) => Promise<void>;
  upsertReleaseMetadata?: (
    projectId: string,
    input: {
      environmentId: string;
      release: string;
      integrationId?: string | null;
      commitSha?: string | null;
      commitUrl?: string | null;
      pullRequestNumber?: number | null;
      pullRequestUrl?: string | null;
      deployedBy?: string | null;
    }
  ) => Promise<{ metadata: unknown }>;
  listEvents: (filters: QueryFilters) => Promise<QueryListResponse<EventRecord>>;
  listErrors: (filters: QueryFilters) => Promise<QueryListResponse<ErrorRecord>>;
  listTraces: (filters: QueryFilters) => Promise<QueryListResponse<TraceRecord>>;
  listTraceSpans: (traceId: string, filters: QueryFilters) => Promise<QueryListResponse<SpanRecord>>;
  listLlmCalls: (filters: QueryFilters) => Promise<QueryListResponse<LlmCallRecord>>;
  getLlmAggregates: (filters: QueryFilters) => Promise<AggregateResponse<LlmAggregates>>;
  getEventAggregates: (filters: QueryFilters) => Promise<AggregateResponse<unknown>>;
  getErrorAggregates: (filters: QueryFilters) => Promise<AggregateResponse<unknown>>;
  getSessionReplayDetail?: (
    replayId: string,
    query: Pick<SessionTimelineQuery, "projectId" | "environmentId">
  ) => Promise<AggregateResponse<IncidentReplay>>;
  listSessionReplays?: (query: SessionReplaySampleQuery) => Promise<QueryListResponse<SessionReplaySample>>;
  getOverview: (query: OverviewQuery) => Promise<AggregateResponse<OverviewResponse>>;
  getRecentActivity?: (query: RecentActivityQuery) => Promise<AggregateResponse<RecentActivityResponse>>;
  listReleases?: (query: ReleaseListQuery) => Promise<AggregateResponse<ReleaseListResponse>>;
  getOperations?: (query: OperationsQuery) => Promise<AggregateResponse<OperationsResponse>>;
  getEventPropertyCatalog?: (query: ApmQuery) => Promise<AggregateResponse<EventPropertyCatalogResponse>>;
  getEventClickMap?: (query: EventClickMapQuery) => Promise<AggregateResponse<EventClickMapResponse>>;
  getEventFunnel?: (query: EventFunnelQuery) => Promise<AggregateResponse<EventFunnelResponse>>;
  getEventPaths?: (query: EventPathsQuery) => Promise<AggregateResponse<EventPathsResponse>>;
  getEventRetention?: (query: EventRetentionQuery) => Promise<AggregateResponse<EventRetentionResponse>>;
  getApmEndpoints?: (query: ApmQuery) => Promise<AggregateResponse<ApmEndpointsResponse>>;
  getServiceMap?: (query: ApmQuery) => Promise<AggregateResponse<ServiceMapResponse>>;
  getWebVitals?: (query: ApmQuery) => Promise<AggregateResponse<WebVitalsResponse>>;
  getRuntimeProfiles?: (query: ApmQuery) => Promise<AggregateResponse<RuntimeProfilesResponse>>;
  getIncidentMttr?: (query: IncidentMttrQuery) => Promise<AggregateResponse<IncidentMttrResult>>;
  getLlmSummary?: (query: LlmAggregateQuery) => Promise<AggregateResponse<LlmSummary>>;
  getLlmByTenant?: (query: LlmAggregateQuery) => Promise<AggregateResponse<LlmTenantRow[]>>;
  getLlmByPrompt?: (query: LlmAggregateQuery) => Promise<AggregateResponse<LlmPromptRow[]>>;
  getLlmCostByModel?: (query: LlmAggregateQuery) => Promise<AggregateResponse<LlmCostByModel>>;
  getSystemHealth: () => Promise<AggregateResponse<SystemHealthResponse>>;
  getSystemHealthHistory: (params?: { limit?: number }) => Promise<AggregateResponse<SystemHealthSampleResponse[]>>;
  runSystemDoctor?: () => Promise<SystemActionResponse>;
  runSystemBackup?: () => Promise<SystemActionResponse>;
  runSystemRetention?: () => Promise<SystemActionResponse>;
  listEntityTenants: (query: TenantListQuery) => Promise<AggregateResponse<TenantListResponse>>;
  getEntityTenantDetail: (tenantId: string, query: TenantDetailQuery) => Promise<AggregateResponse<TenantDetailResponse>>;
  listUsersActivity: (query: UserListQuery) => Promise<AggregateResponse<UserListResponse>>;
  getUserDetail: (userId: string, query: UserDetailQuery) => Promise<AggregateResponse<UserDetailResponse>>;
  listUsers: () => Promise<{ users: User[] }>;
  createUser: (input: { email: string; password: string; isAdmin: boolean }) => Promise<{ user: User }>;
  updateUser: (id: string, input: { email?: string; password?: string; isAdmin?: boolean }) => Promise<{ user: User }>;
  archiveUser: (id: string) => Promise<void>;
  fetchFleet: () => Promise<FleetResponse>;
  getDataGovernancePolicy?: (query: { projectId: string; environmentId: string }) => Promise<{ policy: DataGovernancePolicy }>;
  updateDataGovernancePolicy?: (input: {
    projectId: string;
    environmentId: string;
    retentionPolicy: DataGovernancePolicy["retentionPolicy"];
    propertyRules: DataGovernancePolicy["propertyRules"];
  }) => Promise<{ policy: DataGovernancePolicy }>;
  listWarehouseDestinations?: (query: { projectId: string; environmentId: string }) => Promise<{ destinations: WarehouseDestination[] }>;
  createWarehouseDestination?: (input: CreateWarehouseDestinationInput) => Promise<{ destination: WarehouseDestination }>;
  updateWarehouseDestination?: (id: string, input: UpdateWarehouseDestinationInput) => Promise<{ destination: WarehouseDestination }>;
  archiveWarehouseDestination?: (id: string, query: { projectId: string; environmentId: string }) => Promise<void>;
  listWarehouseExportRuns?: (
    id: string,
    query: { projectId: string; environmentId: string; limit?: number }
  ) => Promise<{ runs: WarehouseExportRun[] }>;
  runWarehouseExport?: (
    id: string,
    input: { projectId: string; environmentId: string }
  ) => Promise<{ result: { ran: boolean; skipped: boolean; exported: number; failed: number } }>;
} & AlertApiClient &
  ErrorGroupApiClient &
  SessionTimelineApiClient &
  Partial<MonitorApiClient> &
  Partial<SourceMapApiClient> &
  Partial<AlertSuggestionApiClient> &
  Partial<DeadLetterApiClient>;

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
};

const defaultApiBasePath = "";

function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === "/") {
    return "";
  }

  return basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
}

function path(basePath: string, route: string): string {
  return `${normalizeBasePath(basePath)}${route}`;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  return JSON.parse(text);
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    credentials: "include",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (!response.ok) {
    let code = "request_failed";
    try {
      const body = (await parseJson(response)) as { error?: unknown } | undefined;
      if (typeof body?.error === "string") {
        code = body.error;
      }
    } catch {
      code = "request_failed";
    }

    throw new ApiError(response.status, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await parseJson(response)) as T;
}

async function multipartRequest<T>(url: string, options: { method: "POST"; body: FormData }): Promise<T> {
  const response = await fetch(url, {
    method: options.method,
    credentials: "include",
    headers: {
      Accept: "application/json"
    },
    body: options.body
  });

  if (!response.ok) {
    let code = "request_failed";
    try {
      const body = (await parseJson(response)) as { error?: unknown } | undefined;
      if (typeof body?.error === "string") {
        code = body.error;
      }
    } catch {
      code = "request_failed";
    }

    throw new ApiError(response.status, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await parseJson(response)) as T;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function queryPath(
  route: string,
  filters: QueryFilters,
  options: {
    includeEventName?: boolean;
    includeErrorFilters?: boolean;
    includeLlmFilters?: boolean;
    includeTraceFilters?: boolean;
    includeLimit?: boolean;
  } = {}
): string {
  const params = new URLSearchParams();
  params.set("project_id", filters.projectId);
  params.set("environment_id", filters.environmentId);

  if (filters.tenantId) params.set("tenant_id", filters.tenantId);
  if (filters.userId) params.set("user_id", filters.userId);
  if (filters.sessionId) params.set("session_id", filters.sessionId);
  if (filters.traceId) params.set("trace_id", filters.traceId);
  if (options.includeTraceFilters) {
    if (filters.traceName) params.set("trace_name", filters.traceName);
    if (filters.status) params.set("status", filters.status);
  }
  if (options.includeEventName && filters.eventName) params.set("event_name", filters.eventName);
  if (options.includeEventName && filters.eventId) params.set("event_id", filters.eventId);
  if (options.includeEventName && filters.segmentId) params.set("segment_id", filters.segmentId);
  if (options.includeErrorFilters) {
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.status) params.set("status", filters.status);
    if (filters.fingerprint) params.set("fingerprint", filters.fingerprint);
    if (filters.errorGroupId) params.set("error_group_id", filters.errorGroupId);
  }
  if (options.includeLlmFilters) {
    if (filters.provider) params.set("provider", filters.provider);
    if (filters.model) params.set("model", filters.model);
    if (filters.promptName) params.set("prompt_name", filters.promptName);
    if (filters.status) params.set("status", filters.status);
  }
  if (filters.from) params.set("from", filters.from instanceof Date ? filters.from.toISOString() : filters.from);
  if (filters.to) params.set("to", filters.to instanceof Date ? filters.to.toISOString() : filters.to);
  if (filters.limit !== undefined && options.includeLimit !== false) params.set("limit", String(filters.limit));
  if (filters.cursor) params.set("cursor", filters.cursor);

  return `${route}?${params.toString()}`;
}

function errorGroupScopeParams(query: Pick<ErrorGroupQuery, "projectId" | "environmentId">): URLSearchParams {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return params;
}

function errorGroupQueryPath(query: ErrorGroupQuery): string {
  const params = errorGroupScopeParams(query);
  if (query.tenantId) params.set("tenant_id", query.tenantId);
  if (query.userId) params.set("user_id", query.userId);
  if (query.status) params.set("status", query.status);
  if (query.severity) params.set("severity", query.severity);
  if (query.fingerprint) params.set("fingerprint", query.fingerprint);
  if (query.release) params.set("release", query.release);
  if (query.from) params.set("from", query.from instanceof Date ? query.from.toISOString() : query.from);
  if (query.to) params.set("to", query.to instanceof Date ? query.to.toISOString() : query.to);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);

  return `/query/error-groups?${params.toString()}`;
}

function errorGroupPath(id: string, query: Pick<ErrorGroupQuery, "projectId" | "environmentId">): string {
  return `/query/error-groups/${encodePathSegment(id)}?${errorGroupScopeParams(query).toString()}`;
}

function errorGroupIncidentPath(id: string, query: ErrorGroupIncidentQuery): string {
  const params = errorGroupScopeParams(query);
  if (query.errorId) params.set("error_id", query.errorId);

  return `/query/incidents/error-groups/${encodePathSegment(id)}?${params.toString()}`;
}

function triageNotePath(id: string, scope: Pick<ErrorGroupQuery, "projectId" | "environmentId">): string {
  return `/query/incidents/error-groups/${encodePathSegment(id)}/notes?${errorGroupScopeParams(scope).toString()}`;
}

function silenceIncidentPath(id: string, scope: Pick<ErrorGroupQuery, "projectId" | "environmentId">): string {
  return `/query/incidents/error-groups/${encodePathSegment(id)}/silence?${errorGroupScopeParams(scope).toString()}`;
}

function incidentExternalIssuesPath(id: string, scope: Pick<ErrorGroupQuery, "projectId" | "environmentId">): string {
  return `/query/incidents/error-groups/${encodePathSegment(id)}/external-issues?${errorGroupScopeParams(scope).toString()}`;
}

function incidentExternalIssueDraftPath(id: string, scope: Pick<ErrorGroupQuery, "projectId" | "environmentId">): string {
  return `/query/incidents/error-groups/${encodePathSegment(id)}/external-issues/draft?${errorGroupScopeParams(scope).toString()}`;
}

function sourceMapScopeParams(query: Pick<SourceMapArtifactQuery, "projectId" | "environmentId">): URLSearchParams {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return params;
}

function sourceMapArtifactsPath(query: SourceMapArtifactQuery): string {
  const params = sourceMapScopeParams(query);
  if (query.release) params.set("release", query.release);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);

  return `/admin/source-maps?${params.toString()}`;
}

function sourceMapArtifactPath(id: string, query: Pick<SourceMapArtifactQuery, "projectId" | "environmentId">): string {
  return `/admin/source-maps/${encodePathSegment(id)}?${sourceMapScopeParams(query).toString()}`;
}

function sourceMapUploadTokensPath(query: Pick<SourceMapArtifactQuery, "projectId" | "environmentId">): string {
  return `/admin/source-map-upload-tokens?${sourceMapScopeParams(query).toString()}`;
}

function sourceMapUploadTokenPath(id: string, query: Pick<SourceMapArtifactQuery, "projectId" | "environmentId">): string {
  return `/admin/source-map-upload-tokens/${encodePathSegment(id)}?${sourceMapScopeParams(query).toString()}`;
}

function errorSourceMapResolutionPath(id: string, query: Pick<SourceMapArtifactQuery, "projectId" | "environmentId">): string {
  return `/query/errors/${encodePathSegment(id)}/source-map-resolution?${sourceMapScopeParams(query).toString()}`;
}

function sourceMapUploadFormData(input: SourceMapUploadInput): FormData {
  const form = new FormData();
  form.set("project_id", input.projectId);
  form.set("environment_id", input.environmentId);
  form.set("release", input.release);
  if (input.minifiedFile) form.set("minified_file", input.minifiedFile);
  form.set("file", input.file);

  return form;
}

function sourceMapBundleUploadFormData(input: SourceMapBundleUploadInput): FormData {
  const form = new FormData();
  form.set("project_id", input.projectId);
  form.set("environment_id", input.environmentId);
  form.set("release", input.release);
  form.set("bundle", input.bundle);

  return form;
}

function overviewPath(query: OverviewQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.release) params.set("release", query.release);

  return `/query/overview?${params.toString()}`;
}

function recentActivityPath(query: RecentActivityQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.release) params.set("release", query.release);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/recent-activity?${params.toString()}`;
}

function releaseListPath(query: ReleaseListQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/releases?${params.toString()}`;
}

function operationsPath(query: OperationsQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);

  return `/query/operations?${params.toString()}`;
}

function apmEndpointsPath(query: ApmQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/apm/endpoints?${params.toString()}`;
}

function eventPropertyCatalogPath(query: ApmQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/events/properties?${params.toString()}`;
}

function eventClickMapPath(query: EventClickMapQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  params.set("route", query.route);
  if (query.selector) params.set("selector", query.selector);
  if (query.tenantId) params.set("tenant_id", query.tenantId);
  if (query.userId) params.set("user_id", query.userId);
  if (query.sessionId) params.set("session_id", query.sessionId);
  if (query.gridSize !== undefined) params.set("grid_size", String(query.gridSize));
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/events/click-map?${params.toString()}`;
}

function eventFunnelPath(query: EventFunnelQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  params.set("steps", query.steps.join(","));
  if (query.conversionWindow) params.set("conversion_window", query.conversionWindow);
  if (query.breakdownProperty) params.set("breakdown_property", query.breakdownProperty);
  if (query.tenantId) params.set("tenant_id", query.tenantId);
  if (query.segmentId) params.set("segment_id", query.segmentId);

  return `/query/events/funnel?${params.toString()}`;
}

function eventPathsPath(query: EventPathsQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.startEvent) params.set("start_event", query.startEvent);
  if (query.endEvent) params.set("end_event", query.endEvent);
  if (query.tenantId) params.set("tenant_id", query.tenantId);
  if (query.userId) params.set("user_id", query.userId);
  if (query.sessionId) params.set("session_id", query.sessionId);
  if (query.traceId) params.set("trace_id", query.traceId);
  if (query.segmentId) params.set("segment_id", query.segmentId);
  if (query.actorType) params.set("actor", query.actorType);
  if (query.from) params.set("from", query.from instanceof Date ? query.from.toISOString() : query.from);
  if (query.to) params.set("to", query.to instanceof Date ? query.to.toISOString() : query.to);
  if (query.pathLength !== undefined) params.set("max_depth", String(query.pathLength));

  return `/query/events/paths?${params.toString()}`;
}

function eventRetentionPath(query: EventRetentionQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.entryEvent) params.set("entry_event", query.entryEvent);
  if (query.returnEvent) params.set("return_event", query.returnEvent);
  if (query.period !== undefined) params.set("period", query.period);
  if (query.intervals !== undefined) params.set("intervals", String(query.intervals));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.rangeDays !== undefined) params.set("range_days", String(query.rangeDays));

  return `/query/events/retention?${params.toString()}`;
}

function analyticsSegmentsPath(query: Pick<CreateAnalyticsSegmentInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/analytics-segments?${params.toString()}`;
}

function analyticsSegmentPreviewPath(
  id: string,
  query: Pick<CreateAnalyticsSegmentInput, "projectId" | "environmentId"> & { limit?: number }
): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/admin/analytics-segments/${encodePathSegment(id)}/preview?${params.toString()}`;
}

function analyticsDashboardsPath(query: Pick<CreateAnalyticsDashboardInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/analytics-dashboards?${params.toString()}`;
}

function analyticsDashboardScopedPath(id: string, query: Pick<CreateAnalyticsDashboardInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/analytics-dashboards/${encodePathSegment(id)}?${params.toString()}`;
}

function dashboardReportPath(
  id: string,
  query: Pick<CreateAnalyticsDashboardInput, "projectId" | "environmentId"> & { window?: "24h" | "7d" | "30d" }
): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  if (query.window) params.set("window", query.window);

  return `/query/reports/dashboards/${encodePathSegment(id)}?${params.toString()}`;
}

function experimentsPath(query: Pick<CreateExperimentInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/experiments?${params.toString()}`;
}

function experimentScopedPath(id: string, query: Pick<CreateExperimentInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/experiments/${encodePathSegment(id)}?${params.toString()}`;
}

function experimentResultsPath(query: ExperimentResultsQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/experiments/${encodePathSegment(query.experimentId)}/results?${params.toString()}`;
}

function surveysPath(query: Pick<CreateSurveyInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/surveys?${params.toString()}`;
}

function surveyScopedPath(id: string, query: Pick<CreateSurveyInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/surveys/${encodePathSegment(id)}?${params.toString()}`;
}

function surveyResultsPath(query: SurveyResultsQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/surveys/${encodePathSegment(query.surveyId)}/results?${params.toString()}`;
}

function messageCampaignsPath(query: Pick<CreateMessageCampaignInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/message-campaigns?${params.toString()}`;
}

function messageCampaignScopedPath(id: string, query: Pick<CreateMessageCampaignInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/message-campaigns/${encodePathSegment(id)}?${params.toString()}`;
}

function messageCampaignResultsPath(query: MessageCampaignResultsQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/message-campaigns/${encodePathSegment(query.campaignId)}/results?${params.toString()}`;
}

function npsResultsPath(query: NpsResultsQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.questionId) params.set("question_id", query.questionId);
  if (query.tenantId) params.set("tenant_id", query.tenantId);
  if (query.release) params.set("release", query.release);
  if (query.plan) params.set("plan", query.plan);

  return `/query/surveys/${encodePathSegment(query.surveyId)}/nps?${params.toString()}`;
}

function feedbackWidgetPath(query: Pick<UpdateFeedbackWidgetSettingsInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/feedback-widget?${params.toString()}`;
}

function feedbackItemsPath(query: FeedbackListQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  if (query.status) params.set("status", query.status);
  if (query.tenantId) params.set("tenant_id", query.tenantId);
  if (query.userId) params.set("user_id", query.userId);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/feedback?${params.toString()}`;
}

function feedbackItemPath(id: string, query: Pick<FeedbackListQuery, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/query/feedback/${encodePathSegment(id)}?${params.toString()}`;
}

function featureFlagsPath(query: Pick<CreateFeatureFlagInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/feature-flags?${params.toString()}`;
}

function featureFlagScopedPath(id: string, query: Pick<CreateFeatureFlagInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/feature-flags/${encodePathSegment(id)}?${params.toString()}`;
}

function featureFlagAuditPath(id: string, query: Pick<CreateFeatureFlagInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/feature-flags/${encodePathSegment(id)}/audit?${params.toString()}`;
}

function featureFlagEvaluatePath(id: string, query: Pick<CreateFeatureFlagInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/feature-flags/${encodePathSegment(id)}/evaluate?${params.toString()}`;
}

function betaProgramsPath(query: Pick<CreateBetaProgramInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/beta-programs?${params.toString()}`;
}

function betaProgramScopedPath(id: string, query: Pick<CreateBetaProgramInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/beta-programs/${encodePathSegment(id)}?${params.toString()}`;
}

function betaProgramParticipantsPath(id: string, query: Pick<CreateBetaProgramInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/beta-programs/${encodePathSegment(id)}/participants?${params.toString()}`;
}

function betaProgramParticipantPath(id: string, participantId: string, query: Pick<CreateBetaProgramInput, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/admin/beta-programs/${encodePathSegment(id)}/participants/${encodePathSegment(participantId)}?${params.toString()}`;
}

function betaProgramAdoptionPath(
  id: string,
  query: Pick<CreateBetaProgramInput, "projectId" | "environmentId"> & { window?: "24h" | "7d" | "30d" }
): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  if (query.window) params.set("window", query.window);

  return `/admin/beta-programs/${encodePathSegment(id)}/adoption?${params.toString()}`;
}

function serviceMapPath(query: ApmQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/apm/service-map?${params.toString()}`;
}

function webVitalsPath(query: ApmQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/apm/web-vitals?${params.toString()}`;
}

function runtimeProfilesPath(query: ApmQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/apm/profiles?${params.toString()}`;
}

function incidentMttrPath(query: IncidentMttrQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  if (query.window) params.set("window", query.window);

  return `/query/incidents/mttr?${params.toString()}`;
}

function llmAggregatePath(suffix: string, query: LlmAggregateQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);

  return `/query/llm/${suffix}?${params.toString()}`;
}

function entityTenantListPath(query: TenantListQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.search) params.set("search", query.search);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/entities/tenants?${params.toString()}`;
}

function entityTenantDetailPath(tenantId: string, query: TenantDetailQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.userId) params.set("user_id", query.userId);
  if (query.signalType) params.set("signal_type", query.signalType);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);

  return `/query/entities/tenants/${encodePathSegment(tenantId)}?${params.toString()}`;
}

function userListPath(query: UserListQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.search) params.set("search", query.search);
  if (query.tenantId) params.set("tenant_id", query.tenantId);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/users?${params.toString()}`;
}

function userDetailPath(userId: string, query: UserDetailQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  if (query.tenantId) params.set("tenant_id", query.tenantId);
  if (query.signalType) params.set("signal_type", query.signalType);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);

  return `/query/users/${encodePathSegment(userId)}?${params.toString()}`;
}

function sessionTimelinePath(sessionId: string, query: SessionTimelineQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  if (query.tenantId) params.set("tenant_id", query.tenantId);
  if (query.userId) params.set("user_id", query.userId);
  if (query.from) params.set("from", query.from instanceof Date ? query.from.toISOString() : query.from);
  if (query.to) params.set("to", query.to instanceof Date ? query.to.toISOString() : query.to);
  if (query.center) params.set("center", query.center instanceof Date ? query.center.toISOString() : query.center);
  if (query.beforeSeconds !== undefined) params.set("before", String(query.beforeSeconds));
  if (query.afterSeconds !== undefined) params.set("after", String(query.afterSeconds));
  if (query.types?.length) params.set("types", query.types.join(","));
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/query/sessions/${encodePathSegment(sessionId)}/timeline?${params.toString()}`;
}

function sessionReplayPath(replayId: string, query: Pick<SessionTimelineQuery, "projectId" | "environmentId">): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return `/query/replays/${encodePathSegment(replayId)}?${params.toString()}`;
}

function alertRuleListPath(query: AlertRuleListQuery = {}): string {
  const params = new URLSearchParams();
  if (query.projectId) params.set("project_id", query.projectId);
  if (query.environmentId) params.set("environment_id", query.environmentId);
  const queryString = params.toString();

  return queryString ? `/admin/alert-rules?${queryString}` : "/admin/alert-rules";
}

function alertEventListPath(query: AlertEventListQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  return `/alerts/events?${params.toString()}`;
}

function alertSuggestionsPath(query: { projectId: string; environmentId: string }): string {
  return `/alerts/suggestions?project_id=${encodeURIComponent(query.projectId)}&environment_id=${encodeURIComponent(query.environmentId)}`;
}

function monitorListPath(query: MonitorListQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  if (query.kind) params.set("kind", query.kind);

  return `/admin/monitors?${params.toString()}`;
}

function monitorChecksPath(
  id: string,
  options: { projectId: string; environmentId: string; limit?: number; cursor?: string }
): string {
  const params = new URLSearchParams();
  params.set("project_id", options.projectId);
  params.set("environment_id", options.environmentId);
  const limit = options.limit;
  const cursor = options.cursor;
  if (limit !== undefined) params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);

  return `/admin/monitors/${encodePathSegment(id)}/checks?${params.toString()}`;
}

function deadLetterJobsPath(query?: DeadLetterJobListQuery): string {
  const params = new URLSearchParams();
  if (query?.limit !== undefined) params.set("limit", String(query.limit));
  if (query?.cursor) params.set("cursor", query.cursor);
  if (query?.queueName) params.set("queue_name", query.queueName);
  if (query?.jobName) params.set("job_name", query.jobName);
  if (query?.error) params.set("error", query.error);
  if (query?.createdFrom) params.set("created_from", query.createdFrom);
  if (query?.createdTo) params.set("created_to", query.createdTo);
  if (query?.status) params.set("status", query.status);
  const search = params.toString();

  return `/admin/dead-letter-jobs${search ? `?${search}` : ""}`;
}

export function createApiClient(
  apiBasePath = defaultApiBasePath
): ApiClient & SessionTimelineApiClient & SourceMapApiClient {
  return {
    getConsoleConfig: () => request<ConsoleConfig>("/console/config"),
    getMe: () => request<{ user: User }>(path(apiBasePath, "/auth/me")),
    login: (email, password) => request<{ user: User }>(path(apiBasePath, "/auth/login"), { method: "POST", body: { email, password } }),
    logout: () => request<{ ok: true }>(path(apiBasePath, "/auth/logout"), { method: "POST" }),
    listProjects: () => request<{ projects: Project[] }>(path(apiBasePath, "/admin/projects")),
    createProject: (input) => request<{ project: Project }>(path(apiBasePath, "/admin/projects"), { method: "POST", body: input }),
    updateProject: (id, input) =>
      request<{ project: Project }>(path(apiBasePath, `/admin/projects/${encodePathSegment(id)}`), {
        method: "PATCH",
        body: input
      }),
    archiveProject: (id) =>
      request<void>(path(apiBasePath, `/admin/projects/${encodePathSegment(id)}`), { method: "DELETE" }),
    listEnvironments: (projectId) =>
      request<{ environments: Environment[] }>(path(apiBasePath, `/admin/projects/${encodePathSegment(projectId)}/environments`)),
    createEnvironment: (projectId, input) =>
      request<{ environment: Environment }>(path(apiBasePath, `/admin/projects/${encodePathSegment(projectId)}/environments`), {
        method: "POST",
        body: input
      }),
    updateEnvironment: (id, input) =>
      request<{ environment: Environment }>(path(apiBasePath, `/admin/environments/${encodePathSegment(id)}`), {
        method: "PATCH",
        body: input
      }),
    archiveEnvironment: (id) =>
      request<void>(path(apiBasePath, `/admin/environments/${encodePathSegment(id)}`), { method: "DELETE" }),
    listAnalyticsSegments: (query) =>
      request<{ segments: AnalyticsSegment[] }>(path(apiBasePath, analyticsSegmentsPath(query))),
    createAnalyticsSegment: (input) =>
      request<{ segment: AnalyticsSegment }>(path(apiBasePath, "/admin/analytics-segments"), { method: "POST", body: input }),
    updateAnalyticsSegment: (id, input) =>
      request<{ segment: AnalyticsSegment }>(path(apiBasePath, `/admin/analytics-segments/${encodePathSegment(id)}`), {
        method: "PATCH",
        body: input
      }),
    archiveAnalyticsSegment: (id) =>
      request<void>(path(apiBasePath, `/admin/analytics-segments/${encodePathSegment(id)}`), { method: "DELETE" }),
    previewAnalyticsSegment: (id, query) =>
      request<{ preview: AnalyticsSegmentPreview }>(path(apiBasePath, analyticsSegmentPreviewPath(id, query))),
    listAnalyticsDashboards: (query) =>
      request<{ dashboards: AnalyticsDashboard[] }>(path(apiBasePath, analyticsDashboardsPath(query))),
    createAnalyticsDashboard: (input) =>
      request<{ dashboard: AnalyticsDashboard }>(path(apiBasePath, "/admin/analytics-dashboards"), { method: "POST", body: input }),
    updateAnalyticsDashboard: (id, query, input) =>
      request<{ dashboard: AnalyticsDashboard }>(path(apiBasePath, analyticsDashboardScopedPath(id, query)), {
        method: "PATCH",
        body: input
      }),
    archiveAnalyticsDashboard: (id, query) =>
      request<void>(path(apiBasePath, analyticsDashboardScopedPath(id, query)), { method: "DELETE" }),
    getDashboardReport: (id, query) =>
      request<AggregateResponse<DashboardReportResponse>>(path(apiBasePath, dashboardReportPath(id, query))),
    listExperiments: (query) =>
      request<{ experiments: Experiment[] }>(path(apiBasePath, experimentsPath(query))),
    createExperiment: (input) =>
      request<{ experiment: Experiment }>(path(apiBasePath, "/admin/experiments"), { method: "POST", body: input }),
    updateExperiment: (id, query, input) =>
      request<{ experiment: Experiment }>(path(apiBasePath, experimentScopedPath(id, query)), {
        method: "PATCH",
        body: input
      }),
    archiveExperiment: (id, query) =>
      request<void>(path(apiBasePath, experimentScopedPath(id, query)), { method: "DELETE" }),
    getExperimentResults: (query) =>
      request<AggregateResponse<ExperimentResultsResponse>>(path(apiBasePath, experimentResultsPath(query))),
    listSurveys: (query) =>
      request<{ surveys: Survey[] }>(path(apiBasePath, surveysPath(query))),
    createSurvey: (input) =>
      request<{ survey: Survey }>(path(apiBasePath, "/admin/surveys"), { method: "POST", body: input }),
    updateSurvey: (id, query, input) =>
      request<{ survey: Survey }>(path(apiBasePath, surveyScopedPath(id, query)), {
        method: "PATCH",
        body: input
      }),
    archiveSurvey: (id, query) =>
      request<void>(path(apiBasePath, surveyScopedPath(id, query)), { method: "DELETE" }),
    getSurveyResults: (query) =>
      request<AggregateResponse<SurveyResultsResponse>>(path(apiBasePath, surveyResultsPath(query))),
    getNpsResults: (query) =>
      request<AggregateResponse<NpsResultsResponse>>(path(apiBasePath, npsResultsPath(query))),
    listMessageCampaigns: (query) =>
      request<{ campaigns: MessageCampaign[] }>(path(apiBasePath, messageCampaignsPath(query))),
    createMessageCampaign: (input) =>
      request<{ campaign: MessageCampaign }>(path(apiBasePath, "/admin/message-campaigns"), { method: "POST", body: input }),
    updateMessageCampaign: (id, query, input) =>
      request<{ campaign: MessageCampaign }>(path(apiBasePath, messageCampaignScopedPath(id, query)), {
        method: "PATCH",
        body: input
      }),
    archiveMessageCampaign: (id, query) =>
      request<void>(path(apiBasePath, messageCampaignScopedPath(id, query)), { method: "DELETE" }),
    getMessageCampaignResults: (query) =>
      request<AggregateResponse<MessageCampaignResultsResponse>>(path(apiBasePath, messageCampaignResultsPath(query))),
    getFeedbackWidgetSettings: (query) =>
      request<{ settings: FeedbackWidgetSettings }>(path(apiBasePath, feedbackWidgetPath(query))),
    updateFeedbackWidgetSettings: (input) =>
      request<{ settings: FeedbackWidgetSettings }>(path(apiBasePath, "/admin/feedback-widget"), { method: "PUT", body: input }),
    listFeedbackItems: (query) =>
      request<{ feedback: FeedbackItem[] }>(path(apiBasePath, feedbackItemsPath(query))),
    updateFeedbackStatus: (id, query, status) =>
      request<{ feedback: FeedbackItem }>(path(apiBasePath, feedbackItemPath(id, query)), {
        method: "PATCH",
        body: { status }
      }),
    listFeatureFlags: (query) =>
      request<{ flags: FeatureFlag[] }>(path(apiBasePath, featureFlagsPath(query))),
    createFeatureFlag: (input) =>
      request<{ flag: FeatureFlag }>(path(apiBasePath, "/admin/feature-flags"), { method: "POST", body: input }),
    updateFeatureFlag: (id, query, input) =>
      request<{ flag: FeatureFlag }>(path(apiBasePath, featureFlagScopedPath(id, query)), {
        method: "PATCH",
        body: input
      }),
    archiveFeatureFlag: (id, query) =>
      request<void>(path(apiBasePath, featureFlagScopedPath(id, query)), { method: "DELETE" }),
    listFeatureFlagAudit: (id, query) =>
      request<{ audit: FeatureFlagAudit[] }>(path(apiBasePath, featureFlagAuditPath(id, query))),
    evaluateFeatureFlag: (id, query, input) =>
      request<{ evaluation: FeatureFlagEvaluation }>(path(apiBasePath, featureFlagEvaluatePath(id, query)), {
        method: "POST",
        body: input
      }),
    listBetaPrograms: (query) =>
      request<{ programs: BetaProgram[] }>(path(apiBasePath, betaProgramsPath(query))),
    createBetaProgram: (input) =>
      request<{ program: BetaProgram }>(path(apiBasePath, "/admin/beta-programs"), { method: "POST", body: input }),
    updateBetaProgram: (id, query, input) =>
      request<{ program: BetaProgram }>(path(apiBasePath, betaProgramScopedPath(id, query)), {
        method: "PATCH",
        body: input
      }),
    archiveBetaProgram: (id, query) =>
      request<void>(path(apiBasePath, betaProgramScopedPath(id, query)), { method: "DELETE" }),
    listBetaProgramParticipants: (id, query) =>
      request<{ participants: BetaProgramParticipant[] }>(path(apiBasePath, betaProgramParticipantsPath(id, query))),
    addBetaProgramParticipant: (id, input) =>
      request<{ participant: BetaProgramParticipant }>(path(apiBasePath, `/admin/beta-programs/${encodePathSegment(id)}/participants`), {
        method: "POST",
        body: input
      }),
    removeBetaProgramParticipant: (id, participantId, query) =>
      request<void>(path(apiBasePath, betaProgramParticipantPath(id, participantId, query)), { method: "DELETE" }),
    getBetaProgramAdoption: (id, query) =>
      request<{ adoption: BetaProgramAdoption }>(path(apiBasePath, betaProgramAdoptionPath(id, query))),
    listApiKeys: (projectId) =>
      request<{ apiKeys: ApiKey[] }>(path(apiBasePath, `/admin/projects/${encodePathSegment(projectId)}/api-keys`)),
    createApiKey: (projectId, input) =>
      request<{ apiKey: CreatedApiKey }>(path(apiBasePath, `/admin/projects/${encodePathSegment(projectId)}/api-keys`), {
        method: "POST",
        body: input
      }),
    updateApiKey: (id, input) =>
      request<{ apiKey: ApiKey }>(path(apiBasePath, `/admin/api-keys/${encodePathSegment(id)}`), {
        method: "PATCH",
        body: input
      }),
    revokeApiKey: (id) => request<void>(path(apiBasePath, `/admin/api-keys/${encodePathSegment(id)}`), { method: "DELETE" }),
    listBrowserOrigins: (projectId) =>
      request<{ origins: BrowserOrigin[] }>(path(apiBasePath, `/admin/projects/${encodePathSegment(projectId)}/browser-origins`)),
    createBrowserOrigin: (projectId, input) =>
      request<{ origin: BrowserOrigin }>(path(apiBasePath, `/admin/projects/${encodePathSegment(projectId)}/browser-origins`), {
        method: "POST",
        body: input
      }),
    archiveBrowserOrigin: (id) =>
      request<void>(path(apiBasePath, `/admin/browser-origins/${encodePathSegment(id)}`), { method: "DELETE" }),
    listCodeIntegrations: (projectId) =>
      request<{ integrations: CodeIntegration[] }>(
        path(apiBasePath, `/admin/projects/${encodePathSegment(projectId)}/code-integrations`)
      ),
    createCodeIntegration: (projectId, input) =>
      request<{ integration: CodeIntegration }>(
        path(apiBasePath, `/admin/projects/${encodePathSegment(projectId)}/code-integrations`),
        { method: "POST", body: input }
      ),
    revokeCodeIntegration: (projectId, id) =>
      request<void>(
        path(apiBasePath, `/admin/projects/${encodePathSegment(projectId)}/code-integrations/${encodePathSegment(id)}`),
        { method: "DELETE" }
      ),
    upsertReleaseMetadata: (projectId, input) =>
      request<{ metadata: unknown }>(
        path(apiBasePath, `/admin/projects/${encodePathSegment(projectId)}/release-metadata`),
        { method: "POST", body: input }
      ),
    listEvents: (filters) =>
      request<QueryListResponse<EventRecord>>(path(apiBasePath, queryPath("/query/events", filters, { includeEventName: true }))),
    listErrors: (filters) =>
      request<QueryListResponse<ErrorRecord>>(path(apiBasePath, queryPath("/query/errors", filters, { includeErrorFilters: true }))),
    listErrorGroups: (query) => request<QueryListResponse<ErrorGroupRecord>>(path(apiBasePath, errorGroupQueryPath(query))),
    getErrorGroup: (id, query) =>
      request<AggregateResponse<ErrorGroupRecord>>(path(apiBasePath, errorGroupPath(id, query))),
    getErrorGroupIncident: (id, query) =>
      request<AggregateResponse<ErrorGroupIncident>>(path(apiBasePath, errorGroupIncidentPath(id, query))),
    updateErrorGroupStatus: (id, input) =>
      request<AggregateResponse<ErrorGroupRecord>>(path(apiBasePath, errorGroupPath(id, input)), {
        method: "PATCH",
        body: { status: input.status }
      }),
    updateErrorGroupTriage: (id, input) =>
      request<AggregateResponse<ErrorGroupRecord>>(path(apiBasePath, errorGroupPath(id, input)), {
        method: "PATCH",
        body: {
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...("priority" in input ? { priority: input.priority ?? null } : {}),
          ...(input.assignedToUserId !== undefined ? { assignedToUserId: input.assignedToUserId } : {})
        }
      }),
    addTriageNote: (id, input) =>
      request<AggregateResponse<TriageNoteRecord>>(path(apiBasePath, triageNotePath(id, input)), {
        method: "POST",
        body: { body: input.body }
      }),
    silenceIncident: (id, input) =>
      request<AggregateResponse<ErrorGroupRecord>>(path(apiBasePath, silenceIncidentPath(id, input)), {
        method: "POST",
        body: { minutes: input.minutes }
      }),
    linkIncidentExternalIssue: (id, query, input) =>
      request<{ link: IncidentExternalLink }>(path(apiBasePath, incidentExternalIssuesPath(id, query)), {
        method: "POST",
        body: input
      }),
    createIncidentIssueDraft: (id, query, input) =>
      request<{ draft: IncidentIssueDraft }>(path(apiBasePath, incidentExternalIssueDraftPath(id, query)), {
        method: "POST",
        body: input
      }),
    listSourceMapArtifacts: async (query) => {
      const response = await request<{ artifacts: SourceMapArtifact[] }>(path(apiBasePath, sourceMapArtifactsPath(query)));
      return response.artifacts;
    },
    uploadSourceMap: async (input) => {
      const response = await multipartRequest<{ artifacts: SourceMapArtifact[] }>(path(apiBasePath, "/admin/source-maps"), {
        method: "POST",
        body: sourceMapUploadFormData(input)
      });
      return response.artifacts;
    },
    uploadSourceMapBundle: async (input) => {
      const response = await multipartRequest<{ artifacts: SourceMapArtifact[] }>(path(apiBasePath, "/admin/source-maps"), {
        method: "POST",
        body: sourceMapBundleUploadFormData(input)
      });
      return response.artifacts;
    },
    deleteSourceMapArtifact: (id, query) =>
      request<void>(path(apiBasePath, sourceMapArtifactPath(id, query)), { method: "DELETE" }),
    listSourceMapUploadTokens: (query) =>
      request<{ tokens: SourceMapUploadToken[] }>(path(apiBasePath, sourceMapUploadTokensPath(query))),
    createSourceMapUploadToken: (input) =>
      request<{ token: CreatedSourceMapUploadToken }>(path(apiBasePath, "/admin/source-map-upload-tokens"), {
        method: "POST",
        body: input
      }),
    updateSourceMapUploadToken: (id, query, input) =>
      request<{ token: SourceMapUploadToken }>(path(apiBasePath, sourceMapUploadTokenPath(id, query)), {
        method: "PATCH",
        body: input
      }),
    revokeSourceMapUploadToken: (id, query) =>
      request<void>(path(apiBasePath, sourceMapUploadTokenPath(id, query)), { method: "DELETE" }),
    getErrorSourceMapResolution: async (id, query) => {
      const response = await request<AggregateResponse<SourceMapResolution>>(
        path(apiBasePath, errorSourceMapResolutionPath(id, query))
      );
      return response.data;
    },
    listTraces: (filters) =>
      request<QueryListResponse<TraceRecord>>(path(apiBasePath, queryPath("/query/traces", filters, { includeTraceFilters: true }))),
    listTraceSpans: (traceId, filters) =>
      request<QueryListResponse<SpanRecord>>(
        path(apiBasePath, queryPath(`/query/traces/${encodePathSegment(traceId)}/spans`, filters))
      ),
    listLlmCalls: (filters) =>
      request<QueryListResponse<LlmCallRecord>>(path(apiBasePath, queryPath("/query/llm-calls", filters, { includeLlmFilters: true }))),
    getLlmAggregates: (filters) =>
      request<AggregateResponse<LlmAggregates>>(
        path(apiBasePath, queryPath("/query/aggregates/llm", filters, { includeLlmFilters: true, includeLimit: false }))
      ),
    getEventAggregates: (filters) =>
      request<AggregateResponse<unknown>>(path(apiBasePath, queryPath("/query/aggregates/events", filters))),
    getErrorAggregates: (filters) =>
      request<AggregateResponse<unknown>>(path(apiBasePath, queryPath("/query/aggregates/errors", filters))),
    getSessionTimeline: (sessionId, query) =>
      request<AggregateResponse<SessionTimelineResponse>>(path(apiBasePath, sessionTimelinePath(sessionId, query))),
    getSessionReplayDetail: (replayId, query) =>
      request<AggregateResponse<IncidentReplay>>(path(apiBasePath, sessionReplayPath(replayId, query))),
    listSessionReplays: (query) =>
      request<QueryListResponse<SessionReplaySample>>(path(apiBasePath, queryPath("/query/replays", query, { includeEventName: true }))),
    getOverview: (query) => request<AggregateResponse<OverviewResponse>>(path(apiBasePath, overviewPath(query))),
    getRecentActivity: (query) => request<AggregateResponse<RecentActivityResponse>>(path(apiBasePath, recentActivityPath(query))),
    listReleases: (query) => request<AggregateResponse<ReleaseListResponse>>(path(apiBasePath, releaseListPath(query))),
    getOperations: (query) => request<AggregateResponse<OperationsResponse>>(path(apiBasePath, operationsPath(query))),
    getEventPropertyCatalog: (query) =>
      request<AggregateResponse<EventPropertyCatalogResponse>>(path(apiBasePath, eventPropertyCatalogPath(query))),
    getEventClickMap: (query) =>
      request<AggregateResponse<EventClickMapResponse>>(path(apiBasePath, eventClickMapPath(query))),
    getEventFunnel: (query) => request<AggregateResponse<EventFunnelResponse>>(path(apiBasePath, eventFunnelPath(query))),
    getEventPaths: (query) => request<AggregateResponse<EventPathsResponse>>(path(apiBasePath, eventPathsPath(query))),
    getEventRetention: (query) => request<AggregateResponse<EventRetentionResponse>>(path(apiBasePath, eventRetentionPath(query))),
    getApmEndpoints: (query) => request<AggregateResponse<ApmEndpointsResponse>>(path(apiBasePath, apmEndpointsPath(query))),
    getServiceMap: (query) => request<AggregateResponse<ServiceMapResponse>>(path(apiBasePath, serviceMapPath(query))),
    getWebVitals: (query) => request<AggregateResponse<WebVitalsResponse>>(path(apiBasePath, webVitalsPath(query))),
    getRuntimeProfiles: (query) =>
      request<AggregateResponse<RuntimeProfilesResponse>>(path(apiBasePath, runtimeProfilesPath(query))),
    getIncidentMttr: (query) => request<AggregateResponse<IncidentMttrResult>>(path(apiBasePath, incidentMttrPath(query))),
    getLlmSummary: (query) =>
      request<AggregateResponse<LlmSummary>>(path(apiBasePath, llmAggregatePath("summary", query))),
    getLlmByTenant: (query) =>
      request<AggregateResponse<LlmTenantRow[]>>(path(apiBasePath, llmAggregatePath("by-tenant", query))),
    getLlmByPrompt: (query) =>
      request<AggregateResponse<LlmPromptRow[]>>(path(apiBasePath, llmAggregatePath("by-prompt", query))),
    getLlmCostByModel: (query) =>
      request<AggregateResponse<LlmCostByModel>>(path(apiBasePath, llmAggregatePath("cost-by-model", query))),
    getSystemHealth: () => request<AggregateResponse<SystemHealthResponse>>(path(apiBasePath, "/system/health")),
    getSystemHealthHistory: (params) => {
      const search = new URLSearchParams();
      if (params?.limit !== undefined) {
        search.set("limit", String(params.limit));
      }
      const query = search.toString();
      return request<AggregateResponse<SystemHealthSampleResponse[]>>(
        path(apiBasePath, `/system/health/history${query ? `?${query}` : ""}`)
      );
    },
    runSystemDoctor: () =>
      request<SystemActionResponse>(path(apiBasePath, "/system/actions/doctor"), { method: "POST" }),
    runSystemBackup: () =>
      request<SystemActionResponse>(path(apiBasePath, "/system/actions/backup"), { method: "POST" }),
    runSystemRetention: () =>
      request<SystemActionResponse>(path(apiBasePath, "/system/actions/retention"), { method: "POST" }),
    listEntityTenants: (query) =>
      request<AggregateResponse<TenantListResponse>>(path(apiBasePath, entityTenantListPath(query))),
    getEntityTenantDetail: (tenantId, query) =>
      request<AggregateResponse<TenantDetailResponse>>(path(apiBasePath, entityTenantDetailPath(tenantId, query))),
    listUsersActivity: (query) => request<AggregateResponse<UserListResponse>>(path(apiBasePath, userListPath(query))),
    getUserDetail: (userId, query) =>
      request<AggregateResponse<UserDetailResponse>>(path(apiBasePath, userDetailPath(userId, query))),
    listUsers: () => request<{ users: User[] }>(path(apiBasePath, "/admin/users")),
    createUser: (input) => request<{ user: User }>(path(apiBasePath, "/admin/users"), { method: "POST", body: input }),
    updateUser: (id, input) =>
      request<{ user: User }>(path(apiBasePath, `/admin/users/${encodePathSegment(id)}`), { method: "PATCH", body: input }),
    archiveUser: (id) => request<void>(path(apiBasePath, `/admin/users/${encodePathSegment(id)}`), { method: "DELETE" }),
    getDataGovernancePolicy: (query) => {
      const search = new URLSearchParams({ project_id: query.projectId, environment_id: query.environmentId });
      return request<{ policy: DataGovernancePolicy }>(path(apiBasePath, `/admin/data-governance?${search.toString()}`));
    },
    updateDataGovernancePolicy: (input) =>
      request<{ policy: DataGovernancePolicy }>(path(apiBasePath, "/admin/data-governance"), {
        method: "PUT",
        body: input
      }),
    listWarehouseDestinations: (query) => {
      const search = new URLSearchParams({ project_id: query.projectId, environment_id: query.environmentId });
      return request<{ destinations: WarehouseDestination[] }>(
        path(apiBasePath, `/admin/warehouse-destinations?${search.toString()}`)
      );
    },
    createWarehouseDestination: (input) =>
      request<{ destination: WarehouseDestination }>(path(apiBasePath, "/admin/warehouse-destinations"), {
        method: "POST",
        body: input
      }),
    updateWarehouseDestination: (id, input) =>
      request<{ destination: WarehouseDestination }>(
        path(apiBasePath, `/admin/warehouse-destinations/${encodePathSegment(id)}`),
        { method: "PATCH", body: input }
      ),
    archiveWarehouseDestination: (id, query) => {
      const search = new URLSearchParams({ project_id: query.projectId, environment_id: query.environmentId });
      return request<void>(
        path(apiBasePath, `/admin/warehouse-destinations/${encodePathSegment(id)}?${search.toString()}`),
        { method: "DELETE" }
      );
    },
    listWarehouseExportRuns: (id, query) => {
      const search = new URLSearchParams({ project_id: query.projectId, environment_id: query.environmentId });
      if (query.limit !== undefined) search.set("limit", String(query.limit));
      return request<{ runs: WarehouseExportRun[] }>(
        path(apiBasePath, `/admin/warehouse-destinations/${encodePathSegment(id)}/runs?${search.toString()}`)
      );
    },
    runWarehouseExport: (id, input) =>
      request<{ result: { ran: boolean; skipped: boolean; exported: number; failed: number } }>(
        path(apiBasePath, `/admin/warehouse-destinations/${encodePathSegment(id)}/runs`),
        { method: "POST", body: input }
      ),
    listNotificationChannels: () =>
      request<{ channels: NotificationChannelResponse[] }>(path(apiBasePath, "/admin/notification-channels")),
    createNotificationChannel: (input) =>
      request<{ channel: NotificationChannelResponse }>(path(apiBasePath, "/admin/notification-channels"), {
        method: "POST",
        body: input
      }),
    updateNotificationChannel: (id, input) =>
      request<{ channel: NotificationChannelResponse }>(
        path(apiBasePath, `/admin/notification-channels/${encodePathSegment(id)}`),
        { method: "PATCH", body: input }
      ),
    archiveNotificationChannel: (id) =>
      request<void>(path(apiBasePath, `/admin/notification-channels/${encodePathSegment(id)}`), { method: "DELETE" }),
    listAlertRules: (query) => request<{ rules: AlertRuleResponse[] }>(path(apiBasePath, alertRuleListPath(query))),
    createAlertRule: (input) =>
      request<{ rule: AlertRuleResponse }>(path(apiBasePath, "/admin/alert-rules"), { method: "POST", body: input }),
    updateAlertRule: (id, input) =>
      request<{ rule: AlertRuleResponse }>(path(apiBasePath, `/admin/alert-rules/${encodePathSegment(id)}`), {
        method: "PATCH",
        body: input
      }),
    archiveAlertRule: (id) =>
      request<void>(path(apiBasePath, `/admin/alert-rules/${encodePathSegment(id)}`), { method: "DELETE" }),
    listMonitors: (query) => request<{ monitors: MonitorResponse[] }>(path(apiBasePath, monitorListPath(query))),
    createHttpMonitor: (input) =>
      request<{ monitor: MonitorResponse }>(path(apiBasePath, "/admin/monitors/http"), { method: "POST", body: input }),
    createHeartbeatMonitor: (input) =>
      request<{ monitor: MonitorResponse; secret: string }>(path(apiBasePath, "/admin/monitors/heartbeat"), {
        method: "POST",
        body: input
      }),
    updateMonitor: (id, input) =>
      request<{ monitor: MonitorResponse }>(path(apiBasePath, `/admin/monitors/${encodePathSegment(id)}`), {
        method: "PATCH",
        body: input
      }),
    archiveMonitor: (id) =>
      request<void>(path(apiBasePath, `/admin/monitors/${encodePathSegment(id)}`), { method: "DELETE" }),
    listMonitorChecks: (id, options) =>
      request<{ checks: MonitorCheckResponse[]; cursor?: string }>(path(apiBasePath, monitorChecksPath(id, options))),
    listDeadLetterJobs: (query) =>
      request<{ deadLetterJobs: DeadLetterJobResponse[]; cursor?: string }>(path(apiBasePath, deadLetterJobsPath(query))),
    getDeadLetterJob: (id) =>
      request<{ deadLetterJob: DeadLetterJobResponse }>(path(apiBasePath, `/admin/dead-letter-jobs/${encodePathSegment(id)}`)),
    listDeadLetterJobActions: (id) =>
      request<{ actions: DeadLetterJobActionResponse[] }>(path(apiBasePath, `/admin/dead-letter-jobs/${encodePathSegment(id)}/actions`)),
    replayDeadLetterJob: (id) =>
      request<DeadLetterReplayResult>(path(apiBasePath, `/admin/dead-letter-jobs/${encodePathSegment(id)}/replay`), {
        method: "POST"
      }),
    deleteDeadLetterJob: (id) =>
      request<void>(path(apiBasePath, `/admin/dead-letter-jobs/${encodePathSegment(id)}`), { method: "DELETE" }),
    listAlertEvents: (query) =>
      request<QueryListResponse<AlertEventResponse>>(path(apiBasePath, alertEventListPath(query))),
    getAlertEvent: (id) =>
      request<AggregateResponse<AlertEventResponse>>(path(apiBasePath, `/alerts/events/${encodePathSegment(id)}`)),
    updateAlertEventTriage: (id, input) =>
      request<AggregateResponse<AlertEventResponse>>(
        path(apiBasePath, `/alerts/events/${encodePathSegment(id)}/triage`),
        { method: "PATCH", body: input }
      ),
    listAlertSuggestions: (query) =>
      request<{ suggestions: AlertSuggestionResponse[] }>(path(apiBasePath, alertSuggestionsPath(query))),
    fetchFleet: () => request<FleetResponse>(path(apiBasePath, "/query/fleet"))
  };
}
