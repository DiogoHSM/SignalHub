import type {
  AddTriageNoteInput,
  AggregateResponse,
  ApiKey,
  BrowserOrigin,
  AlertEventListQuery,
  AlertEventResponse,
  AlertRuleListQuery,
  AlertRuleResponse,
  ConsoleConfig,
  CreateAlertRuleInput,
  CreateHeartbeatMonitorInput,
  CreateHttpMonitorInput,
  CreatedApiKey,
  CreatedSourceMapUploadToken,
  CreateNotificationChannelInput,
  Environment,
  ErrorGroupIncident,
  ErrorGroupIncidentQuery,
  ErrorGroupQuery,
  ErrorGroupRecord,
  IncidentMttrQuery,
  IncidentMttrResult,
  ErrorRecord,
  EventRecord,
  LlmAggregates,
  LlmCallRecord,
  MonitorCheckResponse,
  MonitorListQuery,
  MonitorResponse,
  NotificationChannelResponse,
  OverviewQuery,
  OverviewResponse,
  OperationsQuery,
  OperationsResponse,
  Project,
  QueryFilters,
  QueryListResponse,
  SessionTimelineQuery,
  SessionTimelineResponse,
  SilenceIncidentInput,
  SourceMapArtifact,
  SourceMapArtifactQuery,
  SourceMapResolution,
  SourceMapUploadToken,
  SpanRecord,
  SystemHealthResponse,
  SystemHealthSampleResponse,
  TenantDetailQuery,
  TenantDetailResponse,
  TenantListQuery,
  TenantListResponse,
  TraceRecord,
  TriageNoteRecord,
  User,
  UserDetailQuery,
  UserDetailResponse,
  UserListQuery,
  UserListResponse,
  UpdateAlertRuleInput,
  UpdateErrorGroupStatusInput,
  UpdateErrorGroupTriageInput,
  UpdateNotificationChannelInput,
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
};

export type MonitorApiClient = {
  listMonitors: (query: MonitorListQuery) => Promise<{ monitors: MonitorResponse[] }>;
  createHttpMonitor: (input: CreateHttpMonitorInput) => Promise<{ monitor: MonitorResponse }>;
  createHeartbeatMonitor: (input: CreateHeartbeatMonitorInput) => Promise<{ monitor: MonitorResponse; secret: string }>;
  updateMonitor: (id: string, input: Partial<CreateHttpMonitorInput & CreateHeartbeatMonitorInput>) => Promise<{ monitor: MonitorResponse }>;
  archiveMonitor: (id: string) => Promise<void>;
  listMonitorChecks: (id: string, limit?: number) => Promise<{ checks: MonitorCheckResponse[] }>;
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
  listApiKeys: (projectId: string) => Promise<{ apiKeys: ApiKey[] }>;
  createApiKey: (projectId: string, input: { environmentId: string; name: string }) => Promise<{ apiKey: CreatedApiKey }>;
  updateApiKey?: (id: string, input: { name?: string }) => Promise<{ apiKey: ApiKey }>;
  revokeApiKey: (id: string) => Promise<void>;
  listBrowserOrigins?: (projectId: string) => Promise<{ origins: BrowserOrigin[] }>;
  createBrowserOrigin?: (projectId: string, input: { origin: string }) => Promise<{ origin: BrowserOrigin }>;
  archiveBrowserOrigin?: (id: string) => Promise<void>;
  listEvents: (filters: QueryFilters) => Promise<QueryListResponse<EventRecord>>;
  listErrors: (filters: QueryFilters) => Promise<QueryListResponse<ErrorRecord>>;
  listTraces: (filters: QueryFilters) => Promise<QueryListResponse<TraceRecord>>;
  listTraceSpans: (traceId: string, filters: QueryFilters) => Promise<QueryListResponse<SpanRecord>>;
  listLlmCalls: (filters: QueryFilters) => Promise<QueryListResponse<LlmCallRecord>>;
  getLlmAggregates: (filters: QueryFilters) => Promise<AggregateResponse<LlmAggregates>>;
  getEventAggregates: (filters: QueryFilters) => Promise<AggregateResponse<unknown>>;
  getErrorAggregates: (filters: QueryFilters) => Promise<AggregateResponse<unknown>>;
  getOverview: (query: OverviewQuery) => Promise<AggregateResponse<OverviewResponse>>;
  getOperations?: (query: OperationsQuery) => Promise<AggregateResponse<OperationsResponse>>;
  getIncidentMttr?: (query: IncidentMttrQuery) => Promise<AggregateResponse<IncidentMttrResult>>;
  getLlmSummary?: (query: LlmAggregateQuery) => Promise<AggregateResponse<LlmSummary>>;
  getLlmByTenant?: (query: LlmAggregateQuery) => Promise<AggregateResponse<LlmTenantRow[]>>;
  getLlmByPrompt?: (query: LlmAggregateQuery) => Promise<AggregateResponse<LlmPromptRow[]>>;
  getLlmCostByModel?: (query: LlmAggregateQuery) => Promise<AggregateResponse<LlmCostByModel>>;
  getSystemHealth: () => Promise<AggregateResponse<SystemHealthResponse>>;
  getSystemHealthHistory?: (params?: { limit?: number }) => Promise<AggregateResponse<SystemHealthSampleResponse[]>>;
  listEntityTenants: (query: TenantListQuery) => Promise<AggregateResponse<TenantListResponse>>;
  getEntityTenantDetail: (tenantId: string, query: TenantDetailQuery) => Promise<AggregateResponse<TenantDetailResponse>>;
  listUsersActivity: (query: UserListQuery) => Promise<AggregateResponse<UserListResponse>>;
  getUserDetail: (userId: string, query: UserDetailQuery) => Promise<AggregateResponse<UserDetailResponse>>;
  listUsers: () => Promise<{ users: User[] }>;
  createUser: (input: { email: string; password: string; isAdmin: boolean }) => Promise<{ user: User }>;
  updateUser: (id: string, input: { email?: string; password?: string; isAdmin?: boolean }) => Promise<{ user: User }>;
  archiveUser: (id: string) => Promise<void>;
  fetchFleet: () => Promise<FleetResponse>;
} & AlertApiClient &
  ErrorGroupApiClient &
  SessionTimelineApiClient &
  Partial<MonitorApiClient> &
  Partial<SourceMapApiClient>;

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
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
  options: { includeEventName?: boolean; includeErrorFilters?: boolean; includeLlmFilters?: boolean; includeLimit?: boolean } = {}
): string {
  const params = new URLSearchParams();
  params.set("project_id", filters.projectId);
  params.set("environment_id", filters.environmentId);

  if (filters.tenantId) params.set("tenant_id", filters.tenantId);
  if (filters.userId) params.set("user_id", filters.userId);
  if (filters.sessionId) params.set("session_id", filters.sessionId);
  if (filters.traceId) params.set("trace_id", filters.traceId);
  if (options.includeEventName && filters.eventName) params.set("event_name", filters.eventName);
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

function sourceMapScopeParams(query: Pick<SourceMapArtifactQuery, "projectId" | "environmentId">): URLSearchParams {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);

  return params;
}

function sourceMapArtifactsPath(query: SourceMapArtifactQuery): string {
  const params = sourceMapScopeParams(query);
  if (query.release) params.set("release", query.release);

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

  return `/query/overview?${params.toString()}`;
}

function operationsPath(query: OperationsQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);

  return `/query/operations?${params.toString()}`;
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

function monitorListPath(query: MonitorListQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  if (query.kind) params.set("kind", query.kind);

  return `/admin/monitors?${params.toString()}`;
}

function monitorChecksPath(id: string, limit?: number): string {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", String(limit));
  const queryString = params.toString();

  return queryString
    ? `/admin/monitors/${encodePathSegment(id)}/checks?${queryString}`
    : `/admin/monitors/${encodePathSegment(id)}/checks`;
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
    listTraces: (filters) => request<QueryListResponse<TraceRecord>>(path(apiBasePath, queryPath("/query/traces", filters))),
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
    getOverview: (query) => request<AggregateResponse<OverviewResponse>>(path(apiBasePath, overviewPath(query))),
    getOperations: (query) => request<AggregateResponse<OperationsResponse>>(path(apiBasePath, operationsPath(query))),
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
    listMonitorChecks: (id, limit) =>
      request<{ checks: MonitorCheckResponse[] }>(path(apiBasePath, monitorChecksPath(id, limit))),
    listAlertEvents: (query) =>
      request<QueryListResponse<AlertEventResponse>>(path(apiBasePath, alertEventListPath(query))),
    getAlertEvent: (id) =>
      request<AggregateResponse<AlertEventResponse>>(path(apiBasePath, `/alerts/events/${encodePathSegment(id)}`)),
    fetchFleet: () => request<FleetResponse>(path(apiBasePath, "/query/fleet"))
  };
}
