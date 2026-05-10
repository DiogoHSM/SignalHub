import type {
  AggregateResponse,
  ApiKey,
  AlertEventListQuery,
  AlertEventResponse,
  AlertRuleListQuery,
  AlertRuleResponse,
  ConsoleConfig,
  CreateAlertRuleInput,
  CreatedApiKey,
  CreateNotificationChannelInput,
  Environment,
  ErrorRecord,
  EventRecord,
  LlmAggregates,
  LlmCallRecord,
  NotificationChannelResponse,
  OverviewQuery,
  OverviewResponse,
  Project,
  QueryFilters,
  QueryListResponse,
  SpanRecord,
  SystemHealthResponse,
  TenantDetailQuery,
  TenantDetailResponse,
  TenantListQuery,
  TenantListResponse,
  TraceRecord,
  User,
  UserDetailQuery,
  UserDetailResponse,
  UserListQuery,
  UserListResponse,
  UpdateAlertRuleInput,
  UpdateNotificationChannelInput
} from "./types";

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
  revokeApiKey: (id: string) => Promise<void>;
  listEvents: (filters: QueryFilters) => Promise<QueryListResponse<EventRecord>>;
  listErrors: (filters: QueryFilters) => Promise<QueryListResponse<ErrorRecord>>;
  listTraces: (filters: QueryFilters) => Promise<QueryListResponse<TraceRecord>>;
  listTraceSpans: (traceId: string, filters: QueryFilters) => Promise<QueryListResponse<SpanRecord>>;
  listLlmCalls: (filters: QueryFilters) => Promise<QueryListResponse<LlmCallRecord>>;
  getLlmAggregates: (filters: QueryFilters) => Promise<AggregateResponse<LlmAggregates>>;
  getEventAggregates: (filters: QueryFilters) => Promise<AggregateResponse<unknown>>;
  getErrorAggregates: (filters: QueryFilters) => Promise<AggregateResponse<unknown>>;
  getOverview: (query: OverviewQuery) => Promise<AggregateResponse<OverviewResponse>>;
  getSystemHealth: () => Promise<AggregateResponse<SystemHealthResponse>>;
  listEntityTenants: (query: TenantListQuery) => Promise<AggregateResponse<TenantListResponse>>;
  getEntityTenantDetail: (tenantId: string, query: TenantDetailQuery) => Promise<AggregateResponse<TenantDetailResponse>>;
  listUsersActivity: (query: UserListQuery) => Promise<AggregateResponse<UserListResponse>>;
  getUserDetail: (userId: string, query: UserDetailQuery) => Promise<AggregateResponse<UserDetailResponse>>;
  listUsers: () => Promise<{ users: User[] }>;
  createUser: (input: { email: string; password: string; isAdmin: boolean }) => Promise<{ user: User }>;
  updateUser: (id: string, input: { email?: string; password?: string; isAdmin?: boolean }) => Promise<{ user: User }>;
  archiveUser: (id: string) => Promise<void>;
} & AlertApiClient;

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
  const response = await fetch(url, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
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

function overviewPath(query: OverviewQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);

  return `/query/overview?${params.toString()}`;
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

export function createApiClient(apiBasePath = defaultApiBasePath): ApiClient {
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
    revokeApiKey: (id) => request<void>(path(apiBasePath, `/admin/api-keys/${encodePathSegment(id)}`), { method: "DELETE" }),
    listEvents: (filters) =>
      request<QueryListResponse<EventRecord>>(path(apiBasePath, queryPath("/query/events", filters, { includeEventName: true }))),
    listErrors: (filters) =>
      request<QueryListResponse<ErrorRecord>>(path(apiBasePath, queryPath("/query/errors", filters, { includeErrorFilters: true }))),
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
    getOverview: (query) => request<AggregateResponse<OverviewResponse>>(path(apiBasePath, overviewPath(query))),
    getSystemHealth: () => request<AggregateResponse<SystemHealthResponse>>(path(apiBasePath, "/system/health")),
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
    listAlertEvents: (query) =>
      request<QueryListResponse<AlertEventResponse>>(path(apiBasePath, alertEventListPath(query))),
    getAlertEvent: (id) =>
      request<AggregateResponse<AlertEventResponse>>(path(apiBasePath, `/alerts/events/${encodePathSegment(id)}`))
  };
}
