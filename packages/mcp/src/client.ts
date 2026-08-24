/**
 * Typed HTTP client over the SignalMonitor `/query/*` read surface, authenticated with a
 * project/environment-scoped read token (`shread_...`).
 *
 * Scope note: `/query/*` routes require `project_id`/`environment_id` as query parameters, but
 * for a read-token principal the API *overwrites* them with the token's own scope rather than
 * validating them (see `applyPrincipalScope` in `apps/api/src/routes/query.ts`). Since this
 * package only ever authenticates as a read token, the values sent for those two parameters are
 * never actually used by the API — so this client sends a fixed placeholder for both instead of
 * asking every tool to plumb through a project/environment it doesn't have. If a future version
 * of this package needs to support session-cookie auth (it doesn't today), this shortcut would
 * need to go away.
 */

const SCOPE_PLACEHOLDER = "read-token-scoped";

export type Window = "24h" | "7d" | "30d";
export type MttrWindow = "7d" | "30d";
export type EntitySort = "impact" | "usage" | "errors" | "llm_cost" | "recent";

export type SigmonClientErrorCode =
  | "unauthenticated"
  | "read_token_is_read_only"
  | "read_token_scope_insufficient"
  | "query_failed";

/**
 * Named error thrown for every non-2xx response. Tools should not need to inspect HTTP status
 * codes or raw API error bodies themselves — this class is the single place that maps the API's
 * error responses to the readable, no-stack-trace messages an agent should see.
 */
export class SigmonClientError extends Error {
  readonly code: SigmonClientErrorCode;
  readonly status: number;

  constructor(code: SigmonClientErrorCode, message: string, status: number) {
    super(message);
    this.name = "SigmonClientError";
    this.code = code;
    this.status = status;
  }
}

export interface SigmonClientOptions {
  /** Base URL of the SignalMonitor instance, e.g. "https://my.sigmon.app". */
  baseUrl: string;
  /** The `shread_...` read-token secret. */
  readToken: string;
  /** Injectable for testing; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

interface CursorList<T> {
  data: T[];
  cursor?: string | null;
}

type QueryValue = string | number | boolean | undefined;
type QueryParams = Record<string, QueryValue>;

// ---------------------------------------------------------------------------
// Route response/param shapes
//
// Where the OpenAPI entry documents an explicit response schema, the type here mirrors it.
// Several routes (`/query/events`, `/query/errors`, `/query/traces`, `/query/releases`,
// `/query/events/properties`, `/query/apm/endpoints`, `/query/apm/service-map`,
// `/query/apm/web-vitals`, `/query/overview`) only carry a terse `queryReadRoute(...)`
// description in openapi.ts with no structured `responses.200.content` schema, and their
// `QueryRouteOptions` method signatures in apps/api/src/routes/query.ts type the return value as
// `Promise<unknown>`. Rather than invent a shape those two sources don't actually commit to,
// this client types those payloads loosely (`Record<string, unknown>` rows / `unknown` blobs).
// ---------------------------------------------------------------------------

export interface EventGroupParams {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  eventName?: string;
  eventId?: string;
  segmentId?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface ErrorListParams {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  severity?: string;
  status?: string;
  fingerprint?: string;
  errorGroupId?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface TraceListParams {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  traceName?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface TraceSpanParams {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface AggregateBaseParams {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  from?: string;
  to?: string;
}

export interface EventAggregateParams extends AggregateBaseParams {
  eventName?: string;
  eventId?: string;
  segmentId?: string;
}

export interface LlmAggregateBaseParams extends AggregateBaseParams {
  provider?: string;
  model?: string;
  promptName?: string;
  status?: string;
}

export interface EventAggregateResult {
  total: number;
  byName: Record<string, number>;
}

export interface ErrorAggregateResult {
  total: number;
  open: number;
}

export interface TraceAggregateResult {
  total: number;
  averageDurationMs: number;
}

export interface LlmAggregateResult {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string;
}

export interface AnalyticsTrendInsightParams {
  from: string;
  to: string;
  insightId: string;
}

export interface AnalyticsTrendDefinitionParams {
  from: string;
  to: string;
  bucket: "hour" | "day";
  metric: "count" | "unique_actors";
  eventName?: string;
  breakdownProperty?: string;
  filters?: unknown[];
}

export type AnalyticsTrendParams = AnalyticsTrendInsightParams | AnalyticsTrendDefinitionParams;

export interface ReleaseListParams {
  window?: Window;
  limit?: number;
}

export interface WindowLimitParams {
  window?: Window;
  limit?: number;
}

export interface OverviewParams {
  window?: Window;
  release?: string;
}

export interface OperationsResult {
  window: Window;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string; to: string };
  status: "healthy" | "degraded" | "unhealthy" | "not_configured";
  summary: Record<string, unknown>;
  recent: Record<string, unknown>;
  anomalies?: unknown[];
  [key: string]: unknown;
}

export interface ErrorGroupListParams {
  status?: "open" | "investigating" | "resolved" | "ignored";
  severity?: string;
  fingerprint?: string;
  tenantId?: string;
  userId?: string;
  release?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface ErrorGroupRecord {
  id: string;
  projectId: string;
  environmentId: string;
  groupingFingerprint: string;
  message: string;
  type: string | null;
  topStackFrame: string | null;
  severity: string;
  status: "open" | "investigating" | "resolved" | "ignored";
  priority: "urgent" | "high" | "normal" | "low" | null;
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
  silencedUntil: string | null;
  incidentNumber: string | null;
  trend?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface ErrorGroupOccurrencesParams {
  limit?: number;
  cursor?: string;
}

export interface SourceMapFrame {
  frameIndex: number;
  minifiedFile: string;
  minifiedLine: number;
  minifiedColumn: number;
  originalSource: string;
  originalLine: number;
  originalColumn: number;
  originalName: string | null;
  sourceMapArtifactId: string;
}

export interface SourceMapResolutionResult {
  errorId: string;
  release: string | null;
  status: "resolved" | "partially_resolved" | "unresolved" | "unavailable";
  frames: SourceMapFrame[];
  unresolvedFrameCount: number;
}

export interface TriageNoteRecord {
  id: string;
  authorEmail: string;
  body: string;
  createdAt: string;
}

export interface ExternalIssueLink {
  id: string;
  projectId: string;
  environmentId: string;
  errorGroupId: string;
  integrationId: string | null;
  provider: "github" | "gitlab";
  externalKey: string;
  title: string;
  url: string;
  state: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ErrorGroupIncidentParams {
  errorId?: string;
}

export interface ErrorGroupIncidentResult {
  group: ErrorGroupRecord;
  primaryOccurrence: Record<string, unknown>;
  priority: "urgent" | "high" | "normal" | "low" | null;
  suggestedPriority: "urgent" | "high" | "normal" | "low";
  sourceMapResolution: { status: "cached" | "none"; frameCount?: number };
  stronglyRelated: { items: Record<string, unknown>[]; truncated: boolean };
  nearbyContext: { items: Record<string, unknown>[]; truncated: boolean };
  replay: Record<string, unknown> | null;
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
  notes: TriageNoteRecord[];
  codeContext: Record<string, unknown>;
  externalIssues: ExternalIssueLink[];
}

export interface MttrParams {
  window?: MttrWindow;
}

export interface MttrResult {
  mttrMs: number | null;
  resolvedCount: number;
  windowDays: 7 | 30;
}

export interface ReplayListParams {
  tenantId?: string;
  userId?: string;
  segmentId?: string;
  eventName?: string;
  limit?: number;
}

export interface EntityTenantListParams {
  window?: Window;
  search?: string;
  limit?: number;
  sort?: EntitySort;
  cursor?: string;
}

export interface EntityTenantSummary {
  tenantId: string | null;
  label: string;
  traits: Record<string, unknown>;
  keyTraits: Record<string, string>;
  isUnassigned: boolean;
  impactScore: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  profileUpdatedAt: string | null;
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
}

export interface EntityTenantListResult {
  window: Window;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string; to: string };
  tenants: EntityTenantSummary[];
  cursor?: string;
}

export interface UserListParams {
  window?: Window;
  search?: string;
  tenantId?: string;
  limit?: number;
  sort?: EntitySort;
  cursor?: string;
}

export interface EntityUserSummary {
  userId: string | null;
  label: string;
  traits: Record<string, unknown>;
  keyTraits: Record<string, string>;
  isAnonymous: boolean;
  impactScore: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  profileUpdatedAt: string | null;
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
}

export interface UserListResult {
  window: Window;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string; to: string };
  users: EntityUserSummary[];
  cursor?: string;
}

export interface SessionTimelineParams {
  tenantId?: string;
  userId?: string;
  from?: string;
  to?: string;
  center?: string;
  before?: number;
  after?: number;
  types?: Array<"breadcrumb" | "event" | "error" | "trace" | "llm">;
  limit?: number;
}

export interface SessionTimelineItem {
  id: string;
  type: "breadcrumb" | "event" | "error" | "trace" | "llm";
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
  data?: unknown;
}

export interface SessionTimelineResult {
  sessionId: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string | null; to: string | null };
  items: SessionTimelineItem[];
  page: { nextCursor: string | null; previousCursor: string | null };
}

export interface LlmWindowRollup {
  calls: number;
  failedCalls: number;
  costUsd: string;
  avgTokens: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface LlmByTenantRow extends LlmWindowRollup {
  tenantId: string;
}

export interface LlmByPromptRow extends LlmWindowRollup {
  promptName: string;
  model: string;
}

export interface LlmCostByModelResult {
  buckets: string[];
  series: Array<{ model: string; costs: string[] }>;
}

/** Fetch a JSON body defensively; returns undefined for empty/non-JSON bodies. */
async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function mapError(status: number, body: unknown): SigmonClientError {
  const code = typeof body === "object" && body !== null && "error" in body ? String((body as { error: unknown }).error) : undefined;

  if (status === 401) {
    return new SigmonClientError(
      "unauthenticated",
      "token inválido ou revogado; gere outro em Project Settings → Read tokens",
      status
    );
  }

  if (status === 403 && code === "read_token_scope_insufficient") {
    return new SigmonClientError(
      "read_token_scope_insufficient",
      "this read token's scope does not cover the requested resource",
      status
    );
  }

  if (status === 403) {
    // Covers both the documented `read_token_is_read_only` code and any other 403 on the
    // write path — a read token is, by definition, never allowed to mutate.
    return new SigmonClientError("read_token_is_read_only", "este token é somente leitura", status);
  }

  return new SigmonClientError("query_failed", `sigmon query failed with status ${status}`, status);
}

export class SigmonClient {
  private readonly baseUrl: string;
  private readonly readToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SigmonClientOptions) {
    if (!options.baseUrl) {
      throw new Error("baseUrl is required");
    }
    if (!options.readToken) {
      throw new Error("readToken is required");
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error("fetch is required");
    }

    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.readToken = options.readToken;
    this.fetchImpl = fetchImpl;
  }

  private async request<T>(path: string, params: QueryParams = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }

    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.readToken}` }
    });

    if (!response.ok) {
      throw mapError(response.status, await safeJson(response));
    }

    return (await response.json()) as T;
  }

  private scoped(params: QueryParams = {}): QueryParams {
    return { project_id: SCOPE_PLACEHOLDER, environment_id: SCOPE_PLACEHOLDER, ...params };
  }

  // -- events -----------------------------------------------------------

  async listEvents(params: EventGroupParams = {}): Promise<CursorList<Record<string, unknown>>> {
    return this.request("/query/events", this.scoped(eventGroupQuery(params)));
  }

  async getEventPropertyCatalog(params: WindowLimitParams = {}): Promise<unknown> {
    const data = await this.request<{ data: unknown }>(
      "/query/events/properties",
      this.scoped({ window: params.window, limit: params.limit })
    );
    return data.data;
  }

  // -- errors -------------------------------------------------------------

  async listErrors(params: ErrorListParams = {}): Promise<CursorList<Record<string, unknown>>> {
    return this.request("/query/errors", this.scoped(errorListQuery(params)));
  }

  async listErrorGroups(params: ErrorGroupListParams = {}): Promise<CursorList<ErrorGroupRecord>> {
    return this.request("/query/error-groups", this.scoped(errorGroupListQuery(params)));
  }

  async getErrorGroupOccurrences(
    errorGroupId: string,
    params: ErrorGroupOccurrencesParams = {}
  ): Promise<CursorList<Record<string, unknown>>> {
    return this.request(
      `/query/error-groups/${encodeURIComponent(errorGroupId)}/errors`,
      this.scoped({ limit: params.limit, cursor: params.cursor })
    );
  }

  async getErrorGroupIncident(errorGroupId: string, params: ErrorGroupIncidentParams = {}): Promise<ErrorGroupIncidentResult> {
    const result = await this.request<{ data: ErrorGroupIncidentResult }>(
      `/query/incidents/error-groups/${encodeURIComponent(errorGroupId)}`,
      this.scoped({ error_id: params.errorId })
    );
    return result.data;
  }

  async getErrorSourceMapResolution(errorId: string): Promise<SourceMapResolutionResult> {
    const result = await this.request<{ data: SourceMapResolutionResult }>(
      `/query/errors/${encodeURIComponent(errorId)}/source-map-resolution`,
      this.scoped()
    );
    return result.data;
  }

  async getIncidentMttr(params: MttrParams = {}): Promise<MttrResult> {
    const result = await this.request<{ data: MttrResult }>("/query/incidents/mttr", this.scoped({ window: params.window }));
    return result.data;
  }

  // -- traces ---------------------------------------------------------------

  async listTraces(params: TraceListParams = {}): Promise<CursorList<Record<string, unknown>>> {
    return this.request("/query/traces", this.scoped(traceListQuery(params)));
  }

  async listTraceSpans(traceId: string, params: TraceSpanParams = {}): Promise<CursorList<Record<string, unknown>>> {
    return this.request(`/query/traces/${encodeURIComponent(traceId)}/spans`, this.scoped(traceSpanQuery(params)));
  }

  // -- apm --------------------------------------------------------------

  async getApmEndpoints(params: WindowLimitParams = {}): Promise<unknown> {
    const result = await this.request<{ data: unknown }>("/query/apm/endpoints", this.scoped(windowLimitQuery(params)));
    return result.data;
  }

  async getApmServiceMap(params: WindowLimitParams = {}): Promise<unknown> {
    const result = await this.request<{ data: unknown }>("/query/apm/service-map", this.scoped(windowLimitQuery(params)));
    return result.data;
  }

  async getApmWebVitals(params: WindowLimitParams = {}): Promise<unknown> {
    const result = await this.request<{ data: unknown }>("/query/apm/web-vitals", this.scoped(windowLimitQuery(params)));
    return result.data;
  }

  // -- overview / operations / releases --------------------------------

  async getOverview(params: OverviewParams = {}): Promise<unknown> {
    const result = await this.request<{ data: unknown }>(
      "/query/overview",
      this.scoped({ window: params.window, release: params.release })
    );
    return result.data;
  }

  async getOperations(params: { window?: Window } = {}): Promise<OperationsResult> {
    const result = await this.request<{ data: OperationsResult }>("/query/operations", this.scoped({ window: params.window }));
    return result.data;
  }

  async listReleases(params: ReleaseListParams = {}): Promise<unknown> {
    const result = await this.request<{ data: unknown }>("/query/releases", this.scoped(windowLimitQuery(params)));
    return result.data;
  }

  // -- sessions / replays / entities ------------------------------------

  async getSessionTimeline(sessionId: string, params: SessionTimelineParams = {}): Promise<SessionTimelineResult> {
    const result = await this.request<{ data: SessionTimelineResult }>(
      `/query/sessions/${encodeURIComponent(sessionId)}/timeline`,
      this.scoped(sessionTimelineQuery(params))
    );
    return result.data;
  }

  async listReplays(params: ReplayListParams = {}): Promise<{ data: Record<string, unknown>[] }> {
    return this.request(
      "/query/replays",
      this.scoped({
        tenant_id: params.tenantId,
        user_id: params.userId,
        segment_id: params.segmentId,
        event_name: params.eventName,
        limit: params.limit
      })
    );
  }

  async listEntityTenants(params: EntityTenantListParams = {}): Promise<EntityTenantListResult> {
    const result = await this.request<{ data: EntityTenantListResult }>(
      "/query/entities/tenants",
      this.scoped({
        window: params.window,
        search: params.search,
        limit: params.limit,
        sort: params.sort,
        cursor: params.cursor
      })
    );
    return result.data;
  }

  async listUsers(params: UserListParams = {}): Promise<UserListResult> {
    const result = await this.request<{ data: UserListResult }>(
      "/query/users",
      this.scoped({
        window: params.window,
        search: params.search,
        tenant_id: params.tenantId,
        limit: params.limit,
        sort: params.sort,
        cursor: params.cursor
      })
    );
    return result.data;
  }

  // -- llm ----------------------------------------------------------------

  async getLlmSummary(params: { window?: Window } = {}): Promise<LlmWindowRollup> {
    const result = await this.request<{ data: LlmWindowRollup }>("/query/llm/summary", this.scoped({ window: params.window }));
    return result.data;
  }

  async getLlmByTenant(params: { window?: Window } = {}): Promise<LlmByTenantRow[]> {
    const result = await this.request<{ data: LlmByTenantRow[] }>("/query/llm/by-tenant", this.scoped({ window: params.window }));
    return result.data;
  }

  async getLlmByPrompt(params: { window?: Window } = {}): Promise<LlmByPromptRow[]> {
    const result = await this.request<{ data: LlmByPromptRow[] }>("/query/llm/by-prompt", this.scoped({ window: params.window }));
    return result.data;
  }

  async getLlmCostByModel(params: { window?: Window } = {}): Promise<LlmCostByModelResult> {
    const result = await this.request<{ data: LlmCostByModelResult }>(
      "/query/llm/cost-by-model",
      this.scoped({ window: params.window })
    );
    return result.data;
  }

  // -- aggregates / trends (the `query` escape hatch) ----------------------

  async getEventAggregates(params: EventAggregateParams = {}): Promise<EventAggregateResult> {
    const result = await this.request<{ data: EventAggregateResult }>(
      "/query/aggregates/events",
      this.scoped(eventAggregateQuery(params))
    );
    return result.data;
  }

  async getErrorAggregates(params: AggregateBaseParams = {}): Promise<ErrorAggregateResult> {
    const result = await this.request<{ data: ErrorAggregateResult }>(
      "/query/aggregates/errors",
      this.scoped(aggregateBaseQuery(params))
    );
    return result.data;
  }

  async getLlmAggregates(params: LlmAggregateBaseParams = {}): Promise<LlmAggregateResult> {
    const result = await this.request<{ data: LlmAggregateResult }>(
      "/query/aggregates/llm",
      this.scoped(llmAggregateQuery(params))
    );
    return result.data;
  }

  async getTraceAggregates(params: AggregateBaseParams = {}): Promise<TraceAggregateResult> {
    const result = await this.request<{ data: TraceAggregateResult }>(
      "/query/aggregates/traces",
      this.scoped(aggregateBaseQuery(params))
    );
    return result.data;
  }

  async getAnalyticsTrend(params: AnalyticsTrendParams): Promise<unknown> {
    const result = await this.request<{ data: unknown }>("/query/analytics/trends", this.scoped(analyticsTrendQuery(params)));
    return result.data;
  }
}

// ---------------------------------------------------------------------------
// Query-string builders (camelCase params -> snake_case query keys)
// ---------------------------------------------------------------------------

function eventGroupQuery(params: EventGroupParams): QueryParams {
  return {
    tenant_id: params.tenantId,
    user_id: params.userId,
    session_id: params.sessionId,
    trace_id: params.traceId,
    event_name: params.eventName,
    event_id: params.eventId,
    segment_id: params.segmentId,
    from: params.from,
    to: params.to,
    limit: params.limit,
    cursor: params.cursor
  };
}

function errorListQuery(params: ErrorListParams): QueryParams {
  return {
    tenant_id: params.tenantId,
    user_id: params.userId,
    session_id: params.sessionId,
    trace_id: params.traceId,
    severity: params.severity,
    status: params.status,
    fingerprint: params.fingerprint,
    error_group_id: params.errorGroupId,
    from: params.from,
    to: params.to,
    limit: params.limit,
    cursor: params.cursor
  };
}

function errorGroupListQuery(params: ErrorGroupListParams): QueryParams {
  return {
    status: params.status,
    severity: params.severity,
    fingerprint: params.fingerprint,
    tenant_id: params.tenantId,
    user_id: params.userId,
    release: params.release,
    from: params.from,
    to: params.to,
    limit: params.limit,
    cursor: params.cursor
  };
}

function traceListQuery(params: TraceListParams): QueryParams {
  return {
    tenant_id: params.tenantId,
    user_id: params.userId,
    session_id: params.sessionId,
    trace_id: params.traceId,
    trace_name: params.traceName,
    status: params.status,
    from: params.from,
    to: params.to,
    limit: params.limit,
    cursor: params.cursor
  };
}

function traceSpanQuery(params: TraceSpanParams): QueryParams {
  return {
    tenant_id: params.tenantId,
    user_id: params.userId,
    session_id: params.sessionId,
    from: params.from,
    to: params.to,
    limit: params.limit,
    cursor: params.cursor
  };
}

function windowLimitQuery(params: WindowLimitParams): QueryParams {
  return { window: params.window, limit: params.limit };
}

function sessionTimelineQuery(params: SessionTimelineParams): QueryParams {
  return {
    tenant_id: params.tenantId,
    user_id: params.userId,
    from: params.from,
    to: params.to,
    center: params.center,
    before: params.before,
    after: params.after,
    types: params.types?.join(","),
    limit: params.limit
  };
}

function aggregateBaseQuery(params: AggregateBaseParams): QueryParams {
  return {
    tenant_id: params.tenantId,
    user_id: params.userId,
    session_id: params.sessionId,
    trace_id: params.traceId,
    from: params.from,
    to: params.to
  };
}

function eventAggregateQuery(params: EventAggregateParams): QueryParams {
  return {
    ...aggregateBaseQuery(params),
    event_name: params.eventName,
    event_id: params.eventId,
    segment_id: params.segmentId
  };
}

function llmAggregateQuery(params: LlmAggregateBaseParams): QueryParams {
  return {
    ...aggregateBaseQuery(params),
    provider: params.provider,
    model: params.model,
    prompt_name: params.promptName,
    status: params.status
  };
}

function analyticsTrendQuery(params: AnalyticsTrendParams): QueryParams {
  if ("insightId" in params) {
    return { from: params.from, to: params.to, insight_id: params.insightId };
  }

  return {
    from: params.from,
    to: params.to,
    bucket: params.bucket,
    metric: params.metric,
    event_name: params.eventName,
    breakdown_property: params.breakdownProperty,
    filters: params.filters ? JSON.stringify(params.filters) : undefined
  };
}
