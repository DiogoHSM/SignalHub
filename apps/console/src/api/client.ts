import type {
  AggregateResponse,
  ApiKey,
  ConsoleConfig,
  CreatedApiKey,
  Environment,
  ErrorRecord,
  EventRecord,
  Project,
  QueryFilters,
  QueryListResponse,
  User
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
  getEventAggregates: (filters: QueryFilters) => Promise<AggregateResponse<unknown>>;
  getErrorAggregates: (filters: QueryFilters) => Promise<AggregateResponse<unknown>>;
  listUsers: () => Promise<{ users: User[] }>;
  createUser: (input: { email: string; password: string; isAdmin: boolean }) => Promise<{ user: User }>;
  updateUser: (id: string, input: { email?: string; password?: string; isAdmin?: boolean }) => Promise<{ user: User }>;
  archiveUser: (id: string) => Promise<void>;
};

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

function queryPath(route: string, filters: QueryFilters, options: { includeErrorFilters?: boolean } = {}): string {
  const params = new URLSearchParams();
  params.set("project_id", filters.projectId);
  params.set("environment_id", filters.environmentId);

  if (filters.tenantId) params.set("tenant_id", filters.tenantId);
  if (filters.userId) params.set("user_id", filters.userId);
  if (filters.sessionId) params.set("session_id", filters.sessionId);
  if (filters.traceId) params.set("trace_id", filters.traceId);
  if (filters.eventName) params.set("event_name", filters.eventName);
  if (options.includeErrorFilters) {
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.status) params.set("status", filters.status);
    if (filters.fingerprint) params.set("fingerprint", filters.fingerprint);
  }
  if (filters.from) params.set("from", filters.from instanceof Date ? filters.from.toISOString() : filters.from);
  if (filters.to) params.set("to", filters.to instanceof Date ? filters.to.toISOString() : filters.to);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.cursor) params.set("cursor", filters.cursor);

  return `${route}?${params.toString()}`;
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
    listEvents: (filters) => request<QueryListResponse<EventRecord>>(path(apiBasePath, queryPath("/query/events", filters))),
    listErrors: (filters) =>
      request<QueryListResponse<ErrorRecord>>(path(apiBasePath, queryPath("/query/errors", filters, { includeErrorFilters: true }))),
    getEventAggregates: (filters) =>
      request<AggregateResponse<unknown>>(path(apiBasePath, queryPath("/query/aggregates/events", filters))),
    getErrorAggregates: (filters) =>
      request<AggregateResponse<unknown>>(path(apiBasePath, queryPath("/query/aggregates/errors", filters))),
    listUsers: () => request<{ users: User[] }>(path(apiBasePath, "/admin/users")),
    createUser: (input) => request<{ user: User }>(path(apiBasePath, "/admin/users"), { method: "POST", body: input }),
    updateUser: (id, input) =>
      request<{ user: User }>(path(apiBasePath, `/admin/users/${encodePathSegment(id)}`), { method: "PATCH", body: input }),
    archiveUser: (id) => request<void>(path(apiBasePath, `/admin/users/${encodePathSegment(id)}`), { method: "DELETE" })
  };
}
