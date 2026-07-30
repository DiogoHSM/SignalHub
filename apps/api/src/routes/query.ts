import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { setCurrentUser, type AuthenticatedUser } from "../plugins/request-context.js";
import type { SourceMapResolutionResponse } from "../source-maps/resolver.js";
import type { AuthDependencies } from "./auth.js";
import type { FleetData, FleetProjectEnvsResult } from "@sigmon/db/repositories/fleet-query.js";
import type { AddTriageNoteResult, AssignIncidentResult, MttrResult, TriageNoteRecord } from "@sigmon/db/repositories/incident-triage.js";
import type { AnalyticsDashboardRecord, AnalyticsDashboardWidget } from "@sigmon/db/repositories/analytics-dashboards.js";
import type { CodeIntegrationProvider, IncidentExternalLinkRecord, IssueDraft } from "@sigmon/db/repositories/code-integrations.js";
import { FunnelScopeTooLargeError } from "@sigmon/db/repositories/telemetry-query.js";

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
  provider?: string;
  model?: string;
  promptName?: string;
  severity?: string;
  status?: string;
  fingerprint?: string;
  errorGroupId?: string;
  segmentId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
};

export type OverviewWindow = "24h" | "7d" | "30d";

export type OverviewFilters = {
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
  release?: string;
};

export type RecentActivityFilters = OverviewFilters & {
  limit: number;
};

export type ReleaseFilters = {
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
  limit: number;
};

export type LlmAggregateFilters = {
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
};

export type OperationsWindow = "24h" | "7d" | "30d";

export type OperationsFilters = {
  projectId: string;
  environmentId: string;
  window: OperationsWindow;
};

export type ApmWindow = "24h" | "7d" | "30d";

export type ApmFilters = {
  projectId: string;
  environmentId: string;
  window: ApmWindow;
  limit: number;
};

export type ExperimentResultFilters = ApmFilters & {
  experimentId: string;
};

export type SurveyResultFilters = ApmFilters & {
  surveyId: string;
};

export type MessageCampaignResultFilters = ApmFilters & {
  campaignId: string;
};

export type NpsResultFilters = SurveyResultFilters & {
  questionId?: string;
  tenantId?: string;
  release?: string;
  plan?: string;
};

export type FeedbackListFilters = {
  projectId: string;
  environmentId: string;
  limit?: number;
  status?: "open" | "reviewed" | "archived";
  tenantId?: string;
  userId?: string;
};

export type EventRetentionPeriod = "daily" | "weekly" | "monthly";
export type EventPathActorType = "auto" | "user" | "tenant" | "session" | "trace";

export type EventClickMapFilters = ApmFilters & {
  route: string;
  selector?: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  gridSize?: number;
};

export type EntityWindow = "24h" | "7d" | "30d";

export type EntitySignalType = "event" | "error" | "trace" | "llm";

export type SessionTimelineType = "breadcrumb" | "event" | "error" | "trace" | "llm";

export type EntityCursor = {
  timestamp: string;
  type: EntitySignalType;
  id: string;
};

export type ActivitySort = "impact" | "usage" | "errors" | "llm_cost" | "recent";

export type EntityTenantListCursor = {
  sort: ActivitySort;
  value: number;
  actorId: string;
};

export type EntityTenantListFilters = {
  projectId: string;
  environmentId: string;
  window: EntityWindow;
  search?: string;
  limit: number;
  sort?: ActivitySort;
  cursor?: EntityTenantListCursor;
};

export type EntityTenantDetailFilters = {
  projectId: string;
  environmentId: string;
  window: EntityWindow;
  userId?: string;
  signalType?: EntitySignalType;
  limit: number;
  cursor?: EntityCursor;
};

export type UserWindow = "24h" | "7d" | "30d";

export type UserSignalType = "event" | "error" | "trace" | "llm";

export type UserCursor = {
  timestamp: string;
  type: UserSignalType;
  id: string;
};

export type UserListCursor = {
  sort: ActivitySort;
  value: number;
  actorId: string;
};

export type UserListFilters = {
  projectId: string;
  environmentId: string;
  window: UserWindow;
  search?: string;
  tenantId?: string;
  limit: number;
  sort?: ActivitySort;
  cursor?: UserListCursor;
};

export type UserDetailFilters = {
  projectId: string;
  environmentId: string;
  window: UserWindow;
  tenantId?: string;
  signalType?: UserSignalType;
  limit: number;
  cursor?: UserCursor;
};

export type ErrorGroupStatus = "open" | "investigating" | "resolved" | "ignored";
export type ErrorGroupPriority = "urgent" | "high" | "normal" | "low";

export type ErrorGroupFilters = {
  projectId: string;
  environmentId: string;
  status?: ErrorGroupStatus;
  severity?: string;
  fingerprint?: string;
  tenantId?: string;
  userId?: string;
  release?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
};

export type ErrorGroupScope = {
  projectId: string;
  environmentId: string;
};

export type SessionTimelineFilters = {
  projectId: string;
  environmentId: string;
  sessionId: string;
  tenantId?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  center?: Date;
  beforeMs?: number;
  afterMs?: number;
  types?: SessionTimelineType[];
  limit: number;
};

export type QueryListResult<T = unknown> =
  | T[]
  | {
      data: T[];
      cursor?: string;
    };

export type QueryDependencies = {
  listEvents?: (filters: QueryFilters) => Promise<QueryListResult>;
  listErrors?: (filters: QueryFilters) => Promise<QueryListResult>;
  listLlmCalls?: (filters: QueryFilters) => Promise<QueryListResult>;
  listTraces?: (filters: QueryFilters) => Promise<QueryListResult>;
  listTraceSpans?: (traceId: string, filters: QueryFilters) => Promise<QueryListResult>;
  getEventAggregates?: (filters: QueryFilters) => Promise<unknown>;
  getAnalyticsInsight?: (input: {
    id: string;
    projectId: string;
    environmentId: string;
  }) => Promise<AnalyticsInsightQueryRecord | null | undefined>;
  queryEventTrend?: (input: AnalyticsTrendInput) => Promise<unknown>;
  getErrorAggregates?: (filters: QueryFilters) => Promise<unknown>;
  getLlmAggregates?: (filters: QueryFilters) => Promise<unknown>;
  getTraceAggregates?: (filters: QueryFilters) => Promise<unknown>;
  getOverview?: (filters: OverviewFilters) => Promise<unknown>;
  getRecentActivity?: (filters: RecentActivityFilters) => Promise<unknown>;
  listReleases?: (filters: ReleaseFilters) => Promise<unknown>;
  getOperations?: (filters: OperationsFilters) => Promise<unknown>;
  getEventPropertyCatalog?: (filters: ApmFilters) => Promise<unknown>;
  getEventClickMap?: (filters: EventClickMapFilters) => Promise<unknown>;
  getEventFunnel?: (
    filters: ApmFilters & {
      steps: string[];
      conversionWindowSeconds?: number;
      breakdownProperty?: string;
      tenantId?: string;
      segmentId?: string;
    }
  ) => Promise<unknown>;
  getExperimentResults?: (filters: ExperimentResultFilters) => Promise<unknown | null>;
  getSurveyResults?: (filters: SurveyResultFilters) => Promise<unknown | null>;
  getMessageCampaignResults?: (filters: MessageCampaignResultFilters) => Promise<unknown | null>;
  getNpsResults?: (filters: NpsResultFilters) => Promise<unknown | null>;
  listFeedbackItems?: (filters: FeedbackListFilters) => Promise<unknown>;
  updateFeedbackStatus?: (input: FeedbackListFilters & { id: string; status: "open" | "reviewed" | "archived" }) => Promise<unknown | null>;
  getEventRetention?: (
    filters: ApmFilters & {
      entryEvent?: string;
      returnEvent?: string;
      period: EventRetentionPeriod;
      intervals: number;
      rangeDays?: number;
    }
  ) => Promise<unknown>;
  getEventPaths?: (
    filters: ApmFilters & {
      startEvent?: string;
      endEvent?: string;
      tenantId?: string;
      userId?: string;
      sessionId?: string;
      traceId?: string;
      segmentId?: string;
      actorType?: EventPathActorType;
      from?: Date;
      to?: Date;
      pathLength?: number;
    }
  ) => Promise<unknown>;
  getApmEndpoints?: (filters: ApmFilters) => Promise<unknown>;
  getServiceMap?: (filters: ApmFilters) => Promise<unknown>;
  getWebVitals?: (filters: ApmFilters) => Promise<unknown>;
  getRuntimeProfiles?: (filters: ApmFilters) => Promise<unknown>;
  listEntityTenants?: (filters: EntityTenantListFilters) => Promise<unknown>;
  getEntityTenantDetail?: (tenantId: string, filters: EntityTenantDetailFilters) => Promise<unknown>;
  listUsersActivity?: (filters: UserListFilters) => Promise<unknown>;
  getUserDetail?: (userId: string, filters: UserDetailFilters) => Promise<unknown>;
  getSessionTimeline?: (filters: SessionTimelineFilters) => Promise<unknown>;
  getSessionReplayDetail?: (filters: { projectId: string; environmentId: string; replayId: string }) => Promise<unknown | null>;
  listSessionReplays?: (filters: QueryFilters) => Promise<QueryListResult>;
  listErrorGroups?: (filters: ErrorGroupFilters) => Promise<QueryListResult>;
  getErrorGroup?: (id: string, filters: ErrorGroupScope) => Promise<unknown | null>;
  getErrorGroupIncident?: (
    id: string,
    filters: ErrorGroupScope & { errorId?: string }
  ) => Promise<unknown | null>;
  listIncidentExternalIssues?: (input: { projectId: string; environmentId: string; errorGroupId: string }) => Promise<IncidentExternalLinkRecord[]>;
  linkIncidentExternalIssue?: (input: {
    projectId: string;
    environmentId: string;
    errorGroupId: string;
    integrationId?: string | null;
    provider: CodeIntegrationProvider;
    externalKey: string;
    title: string;
    url: string;
    state?: string;
  }) => Promise<IncidentExternalLinkRecord>;
  buildIncidentIssueDraft?: (input: {
    projectId: string;
    environmentId: string;
    errorGroupId: string;
    integrationId: string;
    incidentUrl?: string;
  }) => Promise<IssueDraft | null>;
  updateErrorGroupTriage?: (
    id: string,
    input: ErrorGroupScope & { status?: ErrorGroupStatus; priority?: ErrorGroupPriority | null }
  ) => Promise<unknown | null>;
  updateErrorGroupStatus?: (
    id: string,
    input: ErrorGroupScope & { status: ErrorGroupStatus }
  ) => Promise<unknown | null>;
  resolveErrorStack?: (input: {
    errorId: string;
    projectId: string;
    environmentId: string;
  }) => Promise<SourceMapResolutionResponse | null>;
  getFleet?: (window: "24h" | "7d" | "30d") => Promise<FleetData>;
  getProjectFleetEnvironments?: (projectId: string, window: "24h" | "7d" | "30d") => Promise<FleetProjectEnvsResult | undefined>;
  assignIncident?: (input: { errorGroupId: string; assignedToUserId: string | null; projectId: string; environmentId: string }) => Promise<AssignIncidentResult>;
  addTriageNote?: (input: {
    errorGroupId: string;
    authorUserId: string | null;
    authorEmail: string;
    body: string;
    projectId: string;
    environmentId: string;
  }) => Promise<AddTriageNoteResult>;
  silenceIncident?: (input: { errorGroupId: string; until: Date | null; projectId: string; environmentId: string }) => Promise<unknown | null>;
  getIncidentMttr?: (input: { projectId: string; environmentId: string; windowDays: number }) => Promise<MttrResult>;
  getLlmSummary?: (filters: LlmAggregateFilters) => Promise<unknown>;
  getLlmByTenant?: (filters: LlmAggregateFilters) => Promise<unknown>;
  getLlmByPrompt?: (filters: LlmAggregateFilters) => Promise<unknown>;
  getLlmCostByModel?: (filters: LlmAggregateFilters) => Promise<unknown>;
  getAnalyticsDashboard?: (input: { id: string; projectId: string; environmentId: string }) => Promise<AnalyticsDashboardRecord | null | undefined>;
};

export type AnalyticsTrendInput = {
  projectId: string;
  environmentId: string;
  from: Date;
  to: Date;
  bucket: "hour" | "day";
  metric: "count" | "unique_actors";
  eventName?: string;
  breakdownProperty?: string;
  filters?: EventTrendFilter[];
};

type EventTrendFilter = {
  property: string;
  operator: "eq" | "neq" | "exists" | "not_exists";
  value?: string;
};

type AnalyticsInsightQueryRecord = {
  definition: Omit<AnalyticsTrendInput, "projectId" | "environmentId" | "from" | "to">;
};

export type QueryRouteOptions = {
  auth?: AuthDependencies;
  query?: QueryDependencies;
};

const activitySortSchema = z.enum(["impact", "usage", "errors", "llm_cost", "recent"]);
const traceParamsSchema = z.object({ id: z.string().trim().min(1) });
const sessionParamsSchema = z.object({ sessionId: z.string().trim().min(1) });
const replayParamsSchema = z.object({ replayId: z.string().trim().min(1) });
const entityTenantParamsSchema = z.object({ tenantKey: z.string().trim().min(1) });
const userParamsSchema = z.object({ userKey: z.string().trim().min(1) });
const errorParamsSchema = z.object({ id: z.string().trim().min(1) });
const errorGroupParamsSchema = z.object({ id: z.string().trim().min(1) });
const dashboardParamsSchema = z.object({ id: z.string().trim().min(1) });
const experimentParamsSchema = z.object({ id: z.string().trim().min(1) });
const errorGroupStatusSchema = z.enum(["open", "investigating", "resolved", "ignored"]);
const errorGroupPrioritySchema = z.enum(["urgent", "high", "normal", "low"]);
const errorGroupIncidentScopeSchema = z.object({
  project_id: z.string().trim().min(1),
  environment_id: z.string().trim().min(1),
  error_id: z.string().trim().min(1).optional()
});
const errorGroupTriageBodySchema = z
  .object({
    status: errorGroupStatusSchema.optional(),
    priority: errorGroupPrioritySchema.nullable().optional(),
    assignedToUserId: z.string().nullable().optional()
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      "priority" in value ||
      "assignedToUserId" in value
  );

const triageNoteBodySchema = z.object({
  body: z.string().trim().min(1).max(5000)
});

const silenceBodySchema = z.object({
  minutes: z.number().int().nonnegative().nullable()
});

const externalIssueLinkBodySchema = z.object({
  integrationId: z.string().trim().min(1).nullable().optional(),
  provider: z.enum(["github", "gitlab"]),
  externalKey: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(512),
  url: z.string().trim().url().max(2048),
  state: z.string().trim().min(1).max(64).optional()
});

const externalIssueDraftBodySchema = z.object({
  integrationId: z.string().trim().min(1),
  incidentUrl: z.string().trim().url().max(2048).optional()
});

type RawQuery = Record<string, unknown>;

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
}

function optionalNonEmpty(raw: RawQuery, key: string): string | undefined {
  const value = firstString(raw[key])?.trim();
  return value && value.length > 0 ? value : undefined;
}

function stringValues(raw: RawQuery, key: string): string[] {
  const value = raw[key];
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return [];
}

function parseRequiredId(raw: RawQuery, key: string): string | undefined {
  return optionalNonEmpty(raw, key);
}

function parseLimit(raw: RawQuery): number {
  const value = optionalNonEmpty(raw, "limit");
  if (!value) {
    return 50;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 50;
  }

  const integer = Math.floor(parsed);
  if (integer < 1) {
    return 1;
  }

  return Math.min(integer, 500);
}

function parseDate(raw: RawQuery, key: string): Date | undefined | null {
  const value = optionalNonEmpty(raw, key);
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function parseFilters(
  query: unknown,
  options: { includeEventName?: boolean; includeErrorFilters?: boolean; includeLlmFilters?: boolean; includeTraceFilters?: boolean } = {}
): QueryFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) {
    return undefined;
  }

  const from = parseDate(raw, "from");
  const to = parseDate(raw, "to");
  if (from === null || to === null) {
    return undefined;
  }

  const filters: QueryFilters = {
    projectId,
    environmentId,
    limit: parseLimit(raw)
  };

  const tenantId = optionalNonEmpty(raw, "tenant_id");
  const userId = optionalNonEmpty(raw, "user_id");
  const sessionId = optionalNonEmpty(raw, "session_id");
  const traceId = optionalNonEmpty(raw, "trace_id");
  const traceName = optionalNonEmpty(raw, "trace_name");
  const eventId = optionalNonEmpty(raw, "event_id");
  const eventName = optionalNonEmpty(raw, "event_name");
  const segmentId = optionalNonEmpty(raw, "segment_id");
  const cursor = optionalNonEmpty(raw, "cursor");

  if (tenantId) {
    filters.tenantId = tenantId;
  }
  if (userId) {
    filters.userId = userId;
  }
  if (sessionId) {
    filters.sessionId = sessionId;
  }
  if (traceId) {
    filters.traceId = traceId;
  }
  if (options.includeTraceFilters) {
    const status = optionalNonEmpty(raw, "status");
    if (traceName) {
      filters.traceName = traceName;
      filters.eventName = traceName;
    }
    if (status) {
      filters.status = status;
    }
  }
  if (options.includeEventName && eventName) {
    filters.eventName = eventName;
  }
  if (options.includeEventName && eventId) {
    filters.eventId = eventId;
  }
  if (options.includeEventName && segmentId) {
    filters.segmentId = segmentId;
  }
  if (options.includeErrorFilters) {
    const severity = optionalNonEmpty(raw, "severity");
    const status = optionalNonEmpty(raw, "status");
    const fingerprint = optionalNonEmpty(raw, "fingerprint");
    const errorGroupId = optionalNonEmpty(raw, "error_group_id");

    if (severity) {
      filters.severity = severity;
    }
    if (status) {
      filters.status = status;
    }
    if (fingerprint) {
      filters.fingerprint = fingerprint;
    }
    if (errorGroupId) {
      filters.errorGroupId = errorGroupId;
    }
  }
  if (options.includeLlmFilters) {
    const provider = optionalNonEmpty(raw, "provider");
    const model = optionalNonEmpty(raw, "model");
    const promptName = optionalNonEmpty(raw, "prompt_name");
    const status = optionalNonEmpty(raw, "status");

    if (provider) {
      filters.provider = provider;
    }
    if (model) {
      filters.model = model;
    }
    if (promptName) {
      filters.promptName = promptName;
    }
    if (status) {
      filters.status = status;
    }
  }
  if (from) {
    filters.from = from;
  }
  if (to) {
    filters.to = to;
  }
  if (cursor) {
    filters.cursor = cursor;
  }

  return filters;
}

type AnalyticsTrendRequest = {
  projectId: string;
  environmentId: string;
  from: Date;
  to: Date;
  insightId?: string;
  definition?: Omit<AnalyticsTrendInput, "projectId" | "environmentId" | "from" | "to">;
};

function parseAnalyticsTrendRequest(query: unknown): AnalyticsTrendRequest | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  const from = parseDate(raw, "from");
  const to = parseDate(raw, "to");
  if (!projectId || !environmentId || !from || !to || from >= to) return undefined;

  const insightId = optionalNonEmpty(raw, "insight_id");
  const bucket = optionalNonEmpty(raw, "bucket");
  const metric = optionalNonEmpty(raw, "metric");
  if (insightId) {
    if (bucket || metric || optionalNonEmpty(raw, "event_name") || optionalNonEmpty(raw, "breakdown_property") || raw.filters) {
      return undefined;
    }
    return { projectId, environmentId, from, to, insightId };
  }
  if ((bucket !== "hour" && bucket !== "day") || (metric !== "count" && metric !== "unique_actors")) {
    return undefined;
  }

  let filters: EventTrendFilter[] | undefined;
  const rawFilters = optionalNonEmpty(raw, "filters");
  if (rawFilters) {
    try {
      const parsed = JSON.parse(rawFilters) as unknown;
      if (!Array.isArray(parsed) || parsed.length > 12) return undefined;
      filters = [];
      for (const value of parsed) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
        const candidate = value as Record<string, unknown>;
        const property = typeof candidate.property === "string" ? candidate.property.trim() : "";
        const operator = candidate.operator;
        if (
          !/^[A-Za-z0-9_.:-]{1,64}$/.test(property) ||
          (operator !== "eq" && operator !== "neq" && operator !== "exists" && operator !== "not_exists")
        ) {
          return undefined;
        }
        if (operator === "eq" || operator === "neq") {
          if (typeof candidate.value !== "string" || candidate.value.length > 512) return undefined;
          filters.push({ property, operator, value: candidate.value });
        } else {
          filters.push({ property, operator });
        }
      }
    } catch {
      return undefined;
    }
  }

  const definition: AnalyticsTrendRequest["definition"] = { bucket, metric };
  const eventName = optionalNonEmpty(raw, "event_name");
  const breakdownProperty = optionalNonEmpty(raw, "breakdown_property");
  if (eventName) definition.eventName = eventName;
  if (breakdownProperty) {
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(breakdownProperty)) return undefined;
    definition.breakdownProperty = breakdownProperty;
  }
  if (filters && filters.length > 0) definition.filters = filters;
  return { projectId, environmentId, from, to, definition };
}

function parseErrorGroupFilters(query: unknown): ErrorGroupFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) {
    return undefined;
  }

  const from = parseDate(raw, "from");
  const to = parseDate(raw, "to");
  if (from === null || to === null) {
    return undefined;
  }

  const status = optionalNonEmpty(raw, "status");
  if (status && !errorGroupStatusSchema.safeParse(status).success) {
    return undefined;
  }

  const filters: ErrorGroupFilters = {
    projectId,
    environmentId,
    limit: parseLimit(raw)
  };

  const severity = optionalNonEmpty(raw, "severity");
  const fingerprint = optionalNonEmpty(raw, "fingerprint");
  const tenantId = optionalNonEmpty(raw, "tenant_id");
  const userId = optionalNonEmpty(raw, "user_id");
  const release = optionalNonEmpty(raw, "release");
  const cursor = optionalNonEmpty(raw, "cursor");

  if (status) {
    filters.status = status as ErrorGroupStatus;
  }
  if (severity) {
    filters.severity = severity;
  }
  if (fingerprint) {
    filters.fingerprint = fingerprint;
  }
  if (tenantId) {
    filters.tenantId = tenantId;
  }
  if (userId) {
    filters.userId = userId;
  }
  if (release) {
    filters.release = release;
  }
  if (from) {
    filters.from = from;
  }
  if (to) {
    filters.to = to;
  }
  if (cursor) {
    filters.cursor = cursor;
  }

  return filters;
}

function parseErrorGroupScope(query: unknown): ErrorGroupScope | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) {
    return undefined;
  }

  return { projectId, environmentId };
}

function parseErrorGroupIncidentScope(query: unknown): (ErrorGroupScope & { errorId?: string }) | undefined {
  const parsed = errorGroupIncidentScopeSchema.safeParse(query);
  if (!parsed.success) {
    return undefined;
  }

  return {
    projectId: parsed.data.project_id,
    environmentId: parsed.data.environment_id,
    errorId: parsed.data.error_id
  };
}

function parseNonnegativeSeconds(raw: RawQuery, key: string): number | undefined | null {
  const values = stringValues(raw, key).map((value) => value.trim());
  if (values.length === 0) {
    return undefined;
  }
  if (values.length !== 1) {
    return null;
  }

  const [value] = values;
  if (value.length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.trunc(parsed * 1000);
}

function isSessionTimelineType(value: unknown): value is SessionTimelineType {
  return value === "breadcrumb" || value === "event" || value === "error" || value === "trace" || value === "llm";
}

function parseSessionTimelineTypes(raw: RawQuery): SessionTimelineType[] | undefined | null {
  const values = stringValues(raw, "types");
  if (values.length === 0 || values.every((value) => value.trim().length === 0)) {
    return undefined;
  }

  const types = values.flatMap((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
  const parsedTypes: SessionTimelineType[] = [];
  for (const type of types) {
    if (!isSessionTimelineType(type)) {
      return null;
    }
    parsedTypes.push(type);
  }
  if (parsedTypes.length === 0) {
    return null;
  }

  return parsedTypes;
}

function parseSessionTimelineFilters(query: unknown, sessionId: string): SessionTimelineFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) {
    return undefined;
  }

  const from = parseDate(raw, "from");
  const to = parseDate(raw, "to");
  const center = parseDate(raw, "center");
  const beforeMs = parseNonnegativeSeconds(raw, "before");
  const afterMs = parseNonnegativeSeconds(raw, "after");
  const types = parseSessionTimelineTypes(raw);
  if (from === null || to === null || center === null || beforeMs === null || afterMs === null || types === null) {
    return undefined;
  }

  const filters: SessionTimelineFilters = {
    projectId,
    environmentId,
    sessionId,
    limit: parseLimit(raw)
  };
  const tenantId = optionalNonEmpty(raw, "tenant_id");
  const userId = optionalNonEmpty(raw, "user_id");

  if (tenantId) {
    filters.tenantId = tenantId;
  }
  if (userId) {
    filters.userId = userId;
  }
  if (from) {
    filters.from = from;
  }
  if (to) {
    filters.to = to;
  }
  if (center) {
    filters.center = center;
  }
  if (beforeMs !== undefined) {
    filters.beforeMs = beforeMs;
  }
  if (afterMs !== undefined) {
    filters.afterMs = afterMs;
  }
  if (types) {
    filters.types = types;
  }

  return filters;
}

function parseOverviewFilters(query: unknown): OverviewFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) {
    return undefined;
  }

  const rawWindow = optionalNonEmpty(raw, "window") ?? "24h";
  if (rawWindow !== "24h" && rawWindow !== "7d" && rawWindow !== "30d") {
    return undefined;
  }

  const filters: OverviewFilters = {
    projectId,
    environmentId,
    window: rawWindow
  };

  const release = optionalNonEmpty(raw, "release");
  if (release) {
    filters.release = release;
  }

  return filters;
}

function parseRecentActivityFilters(query: unknown): RecentActivityFilters | undefined {
  const filters = parseOverviewFilters(query);
  if (!filters) {
    return undefined;
  }

  return {
    ...filters,
    limit: parseLimit((query ?? {}) as RawQuery)
  };
}

function parseReleaseFilters(query: unknown): ReleaseFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) {
    return undefined;
  }

  const rawWindow = optionalNonEmpty(raw, "window") ?? "24h";
  if (rawWindow !== "24h" && rawWindow !== "7d" && rawWindow !== "30d") {
    return undefined;
  }

  return {
    projectId,
    environmentId,
    window: rawWindow,
    limit: parseLimit(raw)
  };
}

function parseLlmAggregateFilters(query: unknown): LlmAggregateFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) {
    return undefined;
  }

  const rawWindow = optionalNonEmpty(raw, "window") ?? "24h";
  if (rawWindow !== "24h" && rawWindow !== "7d" && rawWindow !== "30d") {
    return undefined;
  }

  return {
    projectId,
    environmentId,
    window: rawWindow
  };
}

function parseOperationsFilters(query: unknown): OperationsFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) {
    return undefined;
  }

  const rawWindow = optionalNonEmpty(raw, "window") ?? "24h";
  if (rawWindow !== "24h" && rawWindow !== "7d" && rawWindow !== "30d") {
    return undefined;
  }

  return {
    projectId,
    environmentId,
    window: rawWindow
  };
}

function parseDashboardReportFilters(query: unknown): (Omit<OverviewFilters, "window"> & { window?: OverviewWindow }) | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) {
    return undefined;
  }

  const rawWindow = optionalNonEmpty(raw, "window");
  if (rawWindow && rawWindow !== "24h" && rawWindow !== "7d" && rawWindow !== "30d") {
    return undefined;
  }

  return {
    projectId,
    environmentId,
    ...(rawWindow ? { window: rawWindow as OverviewWindow } : {})
  };
}

function parseApmFilters(query: unknown): ApmFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) {
    return undefined;
  }

  const rawWindow = optionalNonEmpty(raw, "window") ?? "24h";
  if (rawWindow !== "24h" && rawWindow !== "7d" && rawWindow !== "30d") {
    return undefined;
  }

  return {
    projectId,
    environmentId,
    window: rawWindow,
    limit: parseLimit(raw)
  };
}

function parseExperimentResultFilters(params: unknown, query: unknown): ExperimentResultFilters | undefined {
  const parsedParams = experimentParamsSchema.safeParse(params);
  const base = parseApmFilters(query);
  if (!parsedParams.success || !base) {
    return undefined;
  }

  return {
    ...base,
    experimentId: parsedParams.data.id
  };
}

function parseSurveyResultFilters(params: unknown, query: unknown): SurveyResultFilters | undefined {
  const parsedParams = experimentParamsSchema.safeParse(params);
  const base = parseApmFilters(query);
  if (!parsedParams.success || !base) {
    return undefined;
  }

  return {
    ...base,
    surveyId: parsedParams.data.id
  };
}

function parseMessageCampaignResultFilters(params: unknown, query: unknown): MessageCampaignResultFilters | undefined {
  const parsedParams = experimentParamsSchema.safeParse(params);
  const base = parseApmFilters(query);
  if (!parsedParams.success || !base) {
    return undefined;
  }

  return {
    ...base,
    campaignId: parsedParams.data.id
  };
}

function parseNpsResultFilters(params: unknown, query: unknown): NpsResultFilters | undefined {
  const base = parseSurveyResultFilters(params, query);
  if (!base) return undefined;
  const raw = (query ?? {}) as RawQuery;
  const questionId = optionalNonEmpty(raw, "question_id");
  const tenantId = optionalNonEmpty(raw, "tenant_id");
  const release = optionalNonEmpty(raw, "release");
  const plan = optionalNonEmpty(raw, "plan");
  return {
    ...base,
    ...(questionId ? { questionId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(release ? { release } : {}),
    ...(plan ? { plan } : {})
  };
}

function parseFeedbackListFilters(query: unknown): FeedbackListFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!projectId || !environmentId) {
    return undefined;
  }

  const status = optionalNonEmpty(raw, "status");
  if (status !== undefined && status !== "open" && status !== "reviewed" && status !== "archived") {
    return undefined;
  }
  const tenantId = optionalNonEmpty(raw, "tenant_id");
  const userId = optionalNonEmpty(raw, "user_id");

  return {
    projectId,
    environmentId,
    limit: parseLimit(raw),
    ...(status ? { status } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(userId ? { userId } : {})
  };
}

function parseEventClickMapFilters(query: unknown): EventClickMapFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const base = parseApmFilters(query);
  const route = optionalNonEmpty(raw, "route");
  if (!base || !route) {
    return undefined;
  }

  const gridRaw = optionalNonEmpty(raw, "grid_size");
  const gridSize = gridRaw === undefined ? undefined : Number(gridRaw);
  if (gridSize !== undefined && (!Number.isFinite(gridSize) || gridSize < 10 || gridSize > 100)) {
    return undefined;
  }

  const filters: EventClickMapFilters = {
    ...base,
    route
  };
  const selector = optionalNonEmpty(raw, "selector");
  const tenantId = optionalNonEmpty(raw, "tenant_id");
  const userId = optionalNonEmpty(raw, "user_id");
  const sessionId = optionalNonEmpty(raw, "session_id");
  if (selector) filters.selector = selector;
  if (tenantId) filters.tenantId = tenantId;
  if (userId) filters.userId = userId;
  if (sessionId) filters.sessionId = sessionId;
  if (gridSize !== undefined) filters.gridSize = Math.trunc(gridSize);

  return filters;
}

function parseEventPathFilters(
  query: unknown
): | (ApmFilters & {
      startEvent?: string;
      endEvent?: string;
      tenantId?: string;
      userId?: string;
      sessionId?: string;
      traceId?: string;
      segmentId?: string;
      actorType?: EventPathActorType;
      from?: Date;
      to?: Date;
      pathLength?: number;
    })
  | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  const rawWindow = optionalNonEmpty(raw, "window") ?? "7d";
  const startEvent = optionalNonEmpty(raw, "start_event");
  const endEvent = optionalNonEmpty(raw, "end_event");
  const actorType = optionalNonEmpty(raw, "actor") ?? "auto";
  const rawPathLength = optionalNonEmpty(raw, "max_depth");
  const from = parseDate(raw, "from");
  const to = parseDate(raw, "to");

  if (!projectId || !environmentId || (rawWindow !== "24h" && rawWindow !== "7d" && rawWindow !== "30d")) {
    return undefined;
  }
  if (!startEvent && !endEvent) {
    return undefined;
  }
  if (actorType !== "auto" && actorType !== "user" && actorType !== "tenant" && actorType !== "session" && actorType !== "trace") {
    return undefined;
  }
  if (from === null || to === null || (from && to && from >= to)) {
    return undefined;
  }

  const parsedPathLength = rawPathLength ? Number(rawPathLength) : 5;
  if (!Number.isFinite(parsedPathLength)) {
    return undefined;
  }
  const pathLength = Math.trunc(parsedPathLength);
  if (pathLength < 2 || pathLength > 8) {
    return undefined;
  }

  return {
    projectId,
    environmentId,
    window: rawWindow,
    limit: parseLimit(raw),
    ...(startEvent ? { startEvent } : {}),
    ...(endEvent ? { endEvent } : {}),
    tenantId: optionalNonEmpty(raw, "tenant_id"),
    userId: optionalNonEmpty(raw, "user_id"),
    sessionId: optionalNonEmpty(raw, "session_id"),
    traceId: optionalNonEmpty(raw, "trace_id"),
    segmentId: optionalNonEmpty(raw, "segment_id"),
    actorType,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    pathLength
  };
}

const APM_WINDOW_SECONDS: Record<ApmWindow, number> = {
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60
};

const CONVERSION_WINDOW_PATTERN = /^(\d{1,6})(s|m|h|d)$/;
const CONVERSION_WINDOW_UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 };
const BREAKDOWN_PROPERTY_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

// Returns undefined when the query param is absent, a parsed integer-seconds value when valid, or
// null to signal a 400 (unparsable format or exceeds the containing window).
function parseConversionWindowSeconds(raw: RawQuery, windowSeconds: number): number | null | undefined {
  const value = optionalNonEmpty(raw, "conversion_window");
  if (value === undefined) {
    return undefined;
  }

  const match = CONVERSION_WINDOW_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unitSeconds = CONVERSION_WINDOW_UNIT_SECONDS[match[2]!];
  if (!Number.isFinite(amount) || !unitSeconds) {
    return null;
  }

  const seconds = amount * unitSeconds;
  if (seconds <= 0 || seconds > windowSeconds) {
    return null;
  }

  return seconds;
}

function parseEventFunnelFilters(
  query: unknown
):
  | (ApmFilters & {
      steps: string[];
      conversionWindowSeconds?: number;
      breakdownProperty?: string;
      tenantId?: string;
      segmentId?: string;
    })
  | undefined {
  const filters = parseApmFilters(query);
  if (!filters) {
    return undefined;
  }

  const raw = (query ?? {}) as RawQuery;
  const steps = (optionalNonEmpty(raw, "steps") ?? "")
    .split(",")
    .map((step) => step.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (steps.length < 2) {
    return undefined;
  }

  const conversionWindowSeconds = parseConversionWindowSeconds(raw, APM_WINDOW_SECONDS[filters.window]);
  if (conversionWindowSeconds === null) {
    return undefined;
  }

  const breakdownProperty = optionalNonEmpty(raw, "breakdown_property");
  if (breakdownProperty !== undefined && !BREAKDOWN_PROPERTY_PATTERN.test(breakdownProperty)) {
    return undefined;
  }

  const tenantId = optionalNonEmpty(raw, "tenant_id");
  const segmentId = optionalNonEmpty(raw, "segment_id");

  return {
    ...filters,
    steps,
    ...(conversionWindowSeconds !== undefined ? { conversionWindowSeconds } : {}),
    ...(breakdownProperty !== undefined ? { breakdownProperty } : {}),
    ...(tenantId !== undefined ? { tenantId } : {}),
    ...(segmentId !== undefined ? { segmentId } : {})
  };
}

function parseEventRetentionFilters(
  query: unknown
): (ApmFilters & {
    entryEvent?: string;
    returnEvent?: string;
    period: EventRetentionPeriod;
    intervals: number;
    rangeDays?: number;
  })
  | undefined {
  const filters = parseApmFilters(query);
  if (!filters) {
    return undefined;
  }

  const raw = (query ?? {}) as RawQuery;
  // entry_event and return_event are both optional: absent entry_event means the cohort has no
  // eligibility filter, and absent return_event means "any event" counts as retained (unbounded).
  const entryEvent = optionalNonEmpty(raw, "entry_event");
  const returnEvent = optionalNonEmpty(raw, "return_event");
  const rawPeriod = optionalNonEmpty(raw, "period") ?? "weekly";
  const rawIntervals = optionalNonEmpty(raw, "intervals");
  const rawRangeDays = optionalNonEmpty(raw, "range_days");

  if (rawPeriod !== "daily" && rawPeriod !== "weekly" && rawPeriod !== "monthly") {
    return undefined;
  }

  const parsedIntervals = rawIntervals ? Number(rawIntervals) : 6;
  if (!Number.isFinite(parsedIntervals)) {
    return undefined;
  }
  const intervals = Math.trunc(parsedIntervals);
  if (intervals < 2 || intervals > 12) {
    return undefined;
  }

  let rangeDays: number | undefined;
  if (rawRangeDays !== undefined) {
    const parsedRangeDays = Number(rawRangeDays);
    if (!Number.isFinite(parsedRangeDays)) {
      return undefined;
    }
    rangeDays = Math.trunc(parsedRangeDays);
    if (rangeDays < 1 || rangeDays > 730) {
      return undefined;
    }
  }

  return {
    ...filters,
    ...(entryEvent ? { entryEvent } : {}),
    ...(returnEvent ? { returnEvent } : {}),
    period: rawPeriod,
    intervals,
    ...(rangeDays !== undefined ? { rangeDays } : {})
  };
}

function parseEntityWindow(raw: RawQuery): EntityWindow | undefined {
  const rawWindow = optionalNonEmpty(raw, "window") ?? "7d";
  if (rawWindow !== "24h" && rawWindow !== "7d" && rawWindow !== "30d") {
    return undefined;
  }

  return rawWindow;
}

function parseEntityLimit(raw: RawQuery): number {
  const value = optionalNonEmpty(raw, "limit");
  if (!value) {
    return 50;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 50;
  }

  const integer = Math.floor(parsed);
  if (integer < 1) {
    return 1;
  }

  return Math.min(integer, 100);
}

function isEntitySignalType(value: unknown): value is EntitySignalType {
  return value === "event" || value === "error" || value === "trace" || value === "llm";
}

function parseEntitySignalType(raw: RawQuery): EntitySignalType | undefined | null {
  const value = optionalNonEmpty(raw, "signal_type");
  if (!value) {
    return undefined;
  }

  return isEntitySignalType(value) ? value : null;
}

function parseEntityCursor(raw: RawQuery): EntityCursor | undefined | null {
  const value = optionalNonEmpty(raw, "cursor");
  if (!value) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object") {
      return null;
    }

    const cursor = decoded as Record<string, unknown>;
    const timestamp = typeof cursor.timestamp === "string" ? cursor.timestamp.trim() : "";
    const id = typeof cursor.id === "string" ? cursor.id.trim() : "";
    if (!timestamp || Number.isNaN(new Date(timestamp).getTime()) || !isEntitySignalType(cursor.type) || !id) {
      return null;
    }

    return {
      timestamp,
      type: cursor.type,
      id
    };
  } catch {
    return null;
  }
}

function parseActivitySort(raw: RawQuery): ActivitySort | undefined | null {
  const value = optionalNonEmpty(raw, "sort");
  if (!value) {
    return undefined;
  }

  const parsed = activitySortSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Decodes the keyset cursor for list routes. `effectiveSort` guards against a cursor minted for a different sort. */
function parseActivityListCursor(
  raw: RawQuery,
  effectiveSort: ActivitySort
): { sort: ActivitySort; value: number; actorId: string } | undefined | null {
  const value = optionalNonEmpty(raw, "cursor");
  if (!value) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object") {
      return null;
    }

    const cursor = decoded as Record<string, unknown>;
    const sortResult = activitySortSchema.safeParse(cursor.sort);
    const cursorValue = typeof cursor.value === "number" && Number.isFinite(cursor.value) ? cursor.value : null;
    const actorId = typeof cursor.actorId === "string" ? cursor.actorId : null;
    if (!sortResult.success || cursorValue === null || actorId === null || sortResult.data !== effectiveSort) {
      return null;
    }

    return { sort: sortResult.data, value: cursorValue, actorId };
  } catch {
    return null;
  }
}

function parseEntityTenantListFilters(query: unknown): EntityTenantListFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  const window = parseEntityWindow(raw);
  const sort = parseActivitySort(raw);
  if (!projectId || !environmentId || !window || sort === null) {
    return undefined;
  }

  const cursor = parseActivityListCursor(raw, sort ?? "impact");
  if (cursor === null) {
    return undefined;
  }

  const filters: EntityTenantListFilters = {
    projectId,
    environmentId,
    window,
    limit: parseEntityLimit(raw)
  };

  const search = optionalNonEmpty(raw, "search");
  if (search) {
    filters.search = search;
  }
  if (sort) {
    filters.sort = sort;
  }
  if (cursor) {
    filters.cursor = cursor;
  }

  return filters;
}

function parseEntityTenantDetailFilters(query: unknown): EntityTenantDetailFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  const window = parseEntityWindow(raw);
  const signalType = parseEntitySignalType(raw);
  const cursor = parseEntityCursor(raw);
  if (!projectId || !environmentId || !window || signalType === null || cursor === null) {
    return undefined;
  }

  const filters: EntityTenantDetailFilters = {
    projectId,
    environmentId,
    window,
    limit: parseEntityLimit(raw)
  };

  const userId = optionalNonEmpty(raw, "user_id");
  if (userId) {
    filters.userId = userId;
  }
  if (signalType) {
    filters.signalType = signalType;
  }
  if (cursor) {
    filters.cursor = cursor;
  }

  return filters;
}

function parseUserWindow(raw: RawQuery): UserWindow | undefined {
  const rawWindow = optionalNonEmpty(raw, "window") ?? "7d";
  if (rawWindow !== "24h" && rawWindow !== "7d" && rawWindow !== "30d") {
    return undefined;
  }

  return rawWindow;
}

function parseUserLimit(raw: RawQuery): number {
  const value = optionalNonEmpty(raw, "limit");
  if (!value) {
    return 50;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 50;
  }

  const integer = Math.floor(parsed);
  if (integer < 1) {
    return 1;
  }

  return Math.min(integer, 100);
}

function isUserSignalType(value: unknown): value is UserSignalType {
  return value === "event" || value === "error" || value === "trace" || value === "llm";
}

function parseUserSignalType(raw: RawQuery): UserSignalType | undefined | null {
  const value = optionalNonEmpty(raw, "signal_type");
  if (!value) {
    return undefined;
  }

  return isUserSignalType(value) ? value : null;
}

function parseUserCursor(raw: RawQuery): UserCursor | undefined | null {
  const value = optionalNonEmpty(raw, "cursor");
  if (!value) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object") {
      return null;
    }

    const cursor = decoded as Record<string, unknown>;
    const timestamp = typeof cursor.timestamp === "string" ? cursor.timestamp.trim() : "";
    const id = typeof cursor.id === "string" ? cursor.id.trim() : "";
    if (!timestamp || Number.isNaN(new Date(timestamp).getTime()) || !isUserSignalType(cursor.type) || !id) {
      return null;
    }

    return {
      timestamp,
      type: cursor.type,
      id
    };
  } catch {
    return null;
  }
}

function parseUserListFilters(query: unknown): UserListFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  const window = parseUserWindow(raw);
  const sort = parseActivitySort(raw);
  if (!projectId || !environmentId || !window || sort === null) {
    return undefined;
  }

  const cursor = parseActivityListCursor(raw, sort ?? "impact");
  if (cursor === null) {
    return undefined;
  }

  const filters: UserListFilters = {
    projectId,
    environmentId,
    window,
    limit: parseUserLimit(raw)
  };

  const search = optionalNonEmpty(raw, "search");
  const tenantId = optionalNonEmpty(raw, "tenant_id");
  if (search) {
    filters.search = search;
  }
  if (tenantId) {
    filters.tenantId = tenantId;
  }
  if (sort) {
    filters.sort = sort;
  }
  if (cursor) {
    filters.cursor = cursor;
  }

  return filters;
}

function parseUserDetailFilters(query: unknown): UserDetailFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  const window = parseUserWindow(raw);
  const signalType = parseUserSignalType(raw);
  const cursor = parseUserCursor(raw);
  if (!projectId || !environmentId || !window || signalType === null || cursor === null) {
    return undefined;
  }

  const filters: UserDetailFilters = {
    projectId,
    environmentId,
    window,
    limit: parseUserLimit(raw)
  };

  const tenantId = optionalNonEmpty(raw, "tenant_id");
  if (tenantId) {
    filters.tenantId = tenantId;
  }
  if (signalType) {
    filters.signalType = signalType;
  }
  if (cursor) {
    filters.cursor = cursor;
  }

  return filters;
}

async function requireHumanUser(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthDependencies | undefined
): Promise<AuthenticatedUser | undefined> {
  const user = await auth?.findSessionUser(request as Parameters<AuthDependencies["findSessionUser"]>[0]);
  if (!user) {
    setCurrentUser(request, null);
    reply.status(401).send({ error: "unauthenticated" });
    return undefined;
  }

  setCurrentUser(request, user);
  return user;
}

function sendListResult(reply: FastifyReply, result: QueryListResult) {
  if (Array.isArray(result)) {
    return reply.send({ data: result });
  }

  if (result.cursor !== undefined) {
    return reply.send({ data: result.data, cursor: result.cursor });
  }

  return reply.send({ data: result.data });
}

type ListRunner = (filters: QueryFilters) => Promise<QueryListResult>;
type AggregateRunner = (filters: QueryFilters) => Promise<unknown>;

function isInvalidCursorError(error: unknown): boolean {
  return error instanceof Error && (error.message === "invalid_cursor" || error.message === "invalid_cursor_scope");
}

async function handleListRoute(
  request: FastifyRequest,
  reply: FastifyReply,
  options: QueryRouteOptions,
  hasMethod: () => boolean,
  run: ListRunner,
  filterOptions?: { includeEventName?: boolean; includeErrorFilters?: boolean; includeLlmFilters?: boolean; includeTraceFilters?: boolean }
) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!hasMethod()) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseFilters(request.query, filterOptions);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return sendListResult(reply, await run(filters));
  } catch (error) {
    if (isInvalidCursorError(error)) {
      return reply.status(400).send({ error: "invalid_cursor" });
    }
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleTraceSpansRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.listTraceSpans) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = traceParamsSchema.safeParse(request.params);
  const filters = parseFilters(request.query);
  if (!params.success || !filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }
  if (filters.traceId && filters.traceId !== params.data.id) {
    return reply.status(400).send({ error: "invalid_query" });
  }
  filters.traceId = params.data.id;

  try {
    return sendListResult(reply, await options.query.listTraceSpans(params.data.id, filters));
  } catch (error) {
    if (isInvalidCursorError(error)) {
      return reply.status(400).send({ error: "invalid_cursor" });
    }
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleAggregateRoute(
  request: FastifyRequest,
  reply: FastifyReply,
  options: QueryRouteOptions,
  hasMethod: () => boolean,
  run: AggregateRunner,
  filterOptions?: { includeEventName?: boolean; includeErrorFilters?: boolean; includeLlmFilters?: boolean }
) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!hasMethod()) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseFilters(request.query, filterOptions);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await run(filters) });
  } catch (error) {
    if (isInvalidCursorError(error)) {
      return reply.status(400).send({ error: "invalid_cursor" });
    }
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleOverviewRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getOverview) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseOverviewFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getOverview(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleRecentActivityRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getRecentActivity) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseRecentActivityFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getRecentActivity(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleReleaseListRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.listReleases) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseReleaseFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.listReleases(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

function dashboardWidgetData(widget: AnalyticsDashboardWidget, overview: unknown): unknown {
  const data = overview as {
    kpis: { events: number; errors: number; openErrors: number };
    trends: {
      usage: Array<{ bucketStart: string; events: number }>;
      errors: Array<{ bucketStart: string; errors: number; openErrors: number }>;
    };
    top: { events: Array<{ name: string; total: number }> };
  };
  if (widget.type === "metric.events") {
    return { value: data.kpis.events, label: "Events" };
  }
  if (widget.type === "metric.errors") {
    return { value: data.kpis.errors, open: data.kpis.openErrors, label: "Errors" };
  }
  if (widget.type === "top.events") {
    return { rows: data.top.events };
  }
  if (widget.type === "trend.events") {
    return {
      buckets: data.trends.usage.map((row) => row.bucketStart),
      series: [{ label: "Events", values: data.trends.usage.map((row) => row.events) }]
    };
  }
  if (widget.type === "trend.errors") {
    return {
      buckets: data.trends.errors.map((row) => row.bucketStart),
      series: [
        { label: "Errors", values: data.trends.errors.map((row) => row.errors) },
        { label: "Open", values: data.trends.errors.map((row) => row.openErrors) }
      ]
    };
  }
  return null;
}

function dashboardTrendRange(window: OverviewWindow): { from: Date; to: Date; bucket: "hour" | "day" } {
  const to = new Date();
  const hours = window === "24h" ? 24 : window === "7d" ? 24 * 7 : 24 * 30;
  return {
    from: new Date(to.getTime() - hours * 60 * 60 * 1000),
    to,
    bucket: window === "24h" ? "hour" : "day"
  };
}

async function handleDashboardReportRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getAnalyticsDashboard) {
    return reply.status(501).send({ error: "dashboard_reports_unavailable" });
  }

  const params = dashboardParamsSchema.safeParse(request.params);
  const filters = parseDashboardReportFilters(request.query);
  if (!params.success || !filters) {
    return reply.status(400).send({ error: "invalid_dashboard_report_request" });
  }

  try {
    const dashboard = await options.query.getAnalyticsDashboard({
      id: params.data.id,
      projectId: filters.projectId,
      environmentId: filters.environmentId
    });
    if (!dashboard) {
      return reply.status(404).send({ error: "dashboard_not_found" });
    }

    const unsupportedFilters = ["tenantId", "userId", "segmentId"].filter(
      (key) => Boolean(dashboard.filters[key as keyof typeof dashboard.filters])
    );
    if (unsupportedFilters.length > 0) {
      return reply.status(422).send({ error: "unsupported_dashboard_filters", filters: unsupportedFilters });
    }

    const window = filters.window ?? dashboard.filters.window ?? "7d";
    const legacyWidgets = dashboard.widgets.filter((widget) => widget.type !== "insight");
    let overview: unknown;
    let overviewError: string | undefined;
    if (legacyWidgets.length > 0) {
      if (!options.query.getOverview) {
        overviewError = "overview_query_unavailable";
      } else {
        try {
          overview = await options.query.getOverview({ projectId: filters.projectId, environmentId: filters.environmentId, window });
        } catch {
          overviewError = "overview_query_failed";
        }
      }
    }

    const widgets = await Promise.all(dashboard.widgets.map(async (widget) => {
      const base = { widgetId: widget.id, type: widget.type, title: widget.title, width: widget.width };
      if (widget.type !== "insight") {
        return overviewError
          ? { ...base, status: "error", data: null, error: overviewError }
          : { ...base, status: "ok", data: dashboardWidgetData(widget, overview) };
      }

      const insightId = typeof widget.options.insightId === "string" ? widget.options.insightId.trim() : "";
      if (!insightId || !options.query?.getAnalyticsInsight || !options.query.queryEventTrend) {
        return { ...base, status: "error", data: null, error: insightId ? "analytics_insights_unavailable" : "insight_id_missing" };
      }
      try {
        const insight = await options.query.getAnalyticsInsight({
          id: insightId,
          projectId: filters.projectId,
          environmentId: filters.environmentId
        });
        if (!insight) return { ...base, status: "error", data: null, error: "analytics_insight_not_found" };
        const definition = analyticsInsightDefinition(insight);
        if (!definition) return { ...base, status: "error", data: null, error: "analytics_insight_invalid" };
        const range = dashboardTrendRange(window);
        const data = await options.query.queryEventTrend({
          projectId: filters.projectId,
          environmentId: filters.environmentId,
          from: range.from,
          to: range.to,
          ...definition
        });
        return { ...base, status: "ok", data };
      } catch {
        return { ...base, status: "error", data: null, error: "analytics_insight_query_failed" };
      }
    }));

    return reply.send({
      data: {
        dashboard,
        generatedAt: new Date().toISOString(),
        scope: {
          projectId: filters.projectId,
          environmentId: filters.environmentId
        },
        window,
        widgets
      }
    });
  } catch {
    return reply.status(503).send({ error: "dashboard_report_unavailable" });
  }
}

async function handleLlmAggregateRoute(
  request: FastifyRequest,
  reply: FastifyReply,
  options: QueryRouteOptions,
  hasMethod: () => boolean,
  run: (filters: LlmAggregateFilters) => Promise<unknown>
) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!hasMethod()) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseLlmAggregateFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await run(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleOperationsRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getOperations) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseOperationsFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getOperations(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleApmEndpointsRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getApmEndpoints) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseApmFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getApmEndpoints(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleEventPropertyCatalogRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getEventPropertyCatalog) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseApmFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getEventPropertyCatalog(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleEventClickMapRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getEventClickMap) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseEventClickMapFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getEventClickMap(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleEventFunnelRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getEventFunnel) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseEventFunnelFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getEventFunnel(filters) });
  } catch (error) {
    if (error instanceof FunnelScopeTooLargeError) {
      return reply.status(400).send({ error: error.code });
    }
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleExperimentResultsRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getExperimentResults) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseExperimentResultFilters(request.params, request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    const result = await options.query.getExperimentResults(filters);
    if (!result) {
      return reply.status(404).send({ error: "experiment_not_found" });
    }
    return reply.send({ data: result });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

function analyticsInsightDefinition(insight: AnalyticsInsightQueryRecord): AnalyticsTrendRequest["definition"] | undefined {
  return insight.definition;
}

async function handleAnalyticsTrendRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) return reply;
  if (!options.query?.queryEventTrend) {
    return reply.status(501).send({ error: "analytics_insights_repository_unavailable" });
  }

  const parsed = parseAnalyticsTrendRequest(request.query);
  if (!parsed) {
    return reply.status(400).send({ error: "invalid_analytics_trend_request" });
  }

  let definition = parsed.definition;
  if (parsed.insightId) {
    if (!options.query.getAnalyticsInsight) {
      return reply.status(501).send({ error: "analytics_insights_repository_unavailable" });
    }
    const insight = await options.query.getAnalyticsInsight({
      id: parsed.insightId,
      projectId: parsed.projectId,
      environmentId: parsed.environmentId
    });
    if (!insight) {
      return reply.status(404).send({ error: "analytics_insight_not_found" });
    }
    definition = analyticsInsightDefinition(insight);
    if (!definition) {
      return reply.status(503).send({ error: "analytics_insights_unavailable" });
    }
  }

  try {
    const data = await options.query.queryEventTrend({
      projectId: parsed.projectId,
      environmentId: parsed.environmentId,
      from: parsed.from,
      to: parsed.to,
      ...definition!
    });
    return reply.send({ data });
  } catch (error) {
    if (error instanceof Error && error.name === "EventPropertyNotPromotedError") {
      return reply.status(400).send({ error: "breakdown_property_not_promoted" });
    }
    if (error instanceof Error && error.name === "InvalidEventPropertyError") {
      return reply.status(400).send({ error: "invalid_event_property" });
    }
    if (error instanceof RangeError) {
      return reply.status(400).send({ error: "invalid_analytics_trend_request" });
    }
    return reply.status(503).send({ error: "analytics_insights_unavailable" });
  }
}

async function handleSurveyResultsRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getSurveyResults) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseSurveyResultFilters(request.params, request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    const result = await options.query.getSurveyResults(filters);
    if (!result) {
      return reply.status(404).send({ error: "survey_not_found" });
    }
    return reply.send({ data: result });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleMessageCampaignResultsRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getMessageCampaignResults) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseMessageCampaignResultFilters(request.params, request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    const result = await options.query.getMessageCampaignResults(filters);
    if (!result) {
      return reply.status(404).send({ error: "message_campaign_not_found" });
    }
    return reply.send({ data: result });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleNpsResultsRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getNpsResults) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseNpsResultFilters(request.params, request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    const result = await options.query.getNpsResults(filters);
    if (!result) {
      return reply.status(404).send({ error: "survey_not_found" });
    }
    return reply.send({ data: result });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

const feedbackStatusBodySchema = z.object({
  status: z.enum(["open", "reviewed", "archived"])
});

async function handleFeedbackListRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.listFeedbackItems) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseFeedbackListFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ feedback: await options.query.listFeedbackItems(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleFeedbackStatusRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.updateFeedbackStatus) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = experimentParamsSchema.safeParse(request.params);
  const filters = parseFeedbackListFilters(request.query);
  const body = feedbackStatusBodySchema.safeParse(request.body);
  if (!params.success || !filters || !body.success) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    const feedback = await options.query.updateFeedbackStatus({
      projectId: filters.projectId,
      environmentId: filters.environmentId,
      ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      id: params.data.id,
      status: body.data.status
    });
    if (!feedback) {
      return reply.status(404).send({ error: "feedback_not_found" });
    }
    return reply.send({ feedback });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleEventPathsRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getEventPaths) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseEventPathFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getEventPaths(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleEventRetentionRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getEventRetention) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseEventRetentionFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getEventRetention(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleServiceMapRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getServiceMap) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseApmFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getServiceMap(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleWebVitalsRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getWebVitals) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseApmFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getWebVitals(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleRuntimeProfilesRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getRuntimeProfiles) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseApmFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getRuntimeProfiles(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleSessionTimelineRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getSessionTimeline) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = sessionParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  const filters = parseSessionTimelineFilters(request.query, params.data.sessionId);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getSessionTimeline(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleSessionReplayRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getSessionReplayDetail) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = replayParamsSchema.safeParse(request.params);
  const raw = (request.query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  if (!params.success || !projectId || !environmentId) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    const replay = await options.query.getSessionReplayDetail({
      projectId,
      environmentId,
      replayId: params.data.replayId
    });
    return replay ? reply.send({ data: replay }) : reply.status(404).send({ error: "replay_not_found" });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleSessionReplayListRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.listSessionReplays) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseFilters(request.query, { includeEventName: true });
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send(await options.query.listSessionReplays(filters));
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleEntityTenantListRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.listEntityTenants) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseEntityTenantListFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.listEntityTenants(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleEntityTenantDetailRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getEntityTenantDetail) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = entityTenantParamsSchema.safeParse(request.params);
  const filters = parseEntityTenantDetailFilters(request.query);
  if (!params.success || params.data.tenantKey === "_unassigned" || !filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getEntityTenantDetail(params.data.tenantKey, filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleUserListRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.listUsersActivity) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseUserListFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.listUsersActivity(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleUserDetailRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getUserDetail) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = userParamsSchema.safeParse(request.params);
  const filters = parseUserDetailFilters(request.query);
  if (!params.success || params.data.userKey === "_anonymous" || !filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getUserDetail(params.data.userKey, filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleErrorGroupListRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.listErrorGroups) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseErrorGroupFilters(request.query);
  if (!filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return sendListResult(reply, await options.query.listErrorGroups(filters));
  } catch (error) {
    if (isInvalidCursorError(error)) {
      return reply.status(400).send({ error: "invalid_cursor" });
    }
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleErrorGroupDetailRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getErrorGroup) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = errorGroupParamsSchema.safeParse(request.params);
  const scope = parseErrorGroupScope(request.query);
  if (!params.success || !scope) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    const group = await options.query.getErrorGroup(params.data.id, scope);
    return group ? reply.send({ data: group }) : reply.status(404).send({ error: "error_group_not_found" });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleErrorGroupIncidentRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getErrorGroupIncident) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = errorGroupParamsSchema.safeParse(request.params);
  const scope = parseErrorGroupIncidentScope(request.query);
  if (!params.success || !scope) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    const incident = await options.query.getErrorGroupIncident(params.data.id, scope);
    if (!incident) return reply.status(404).send({ error: "incident_not_found" });
    const externalIssues = options.query.listIncidentExternalIssues
      ? await options.query.listIncidentExternalIssues({
          projectId: scope.projectId,
          environmentId: scope.environmentId,
          errorGroupId: params.data.id
        })
      : [];
    return reply.send({ data: { ...(incident as Record<string, unknown>), externalIssues } });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleIncidentExternalIssueLinkRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) return reply;
  if (!options.query?.linkIncidentExternalIssue) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = errorGroupParamsSchema.safeParse(request.params);
  const scope = parseErrorGroupIncidentScope(request.query);
  const body = externalIssueLinkBodySchema.safeParse(request.body);
  if (!params.success || !scope || !body.success) {
    return reply.status(400).send({ error: "invalid_external_issue_request" });
  }

  try {
    const link = await options.query.linkIncidentExternalIssue({
      projectId: scope.projectId,
      environmentId: scope.environmentId,
      errorGroupId: params.data.id,
      ...body.data
    });
    return reply.status(201).send({ link });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleIncidentExternalIssueDraftRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) return reply;
  if (!options.query?.buildIncidentIssueDraft) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = errorGroupParamsSchema.safeParse(request.params);
  const scope = parseErrorGroupIncidentScope(request.query);
  const body = externalIssueDraftBodySchema.safeParse(request.body);
  if (!params.success || !scope || !body.success) {
    return reply.status(400).send({ error: "invalid_external_issue_request" });
  }

  try {
    const draft = await options.query.buildIncidentIssueDraft({
      projectId: scope.projectId,
      environmentId: scope.environmentId,
      errorGroupId: params.data.id,
      ...body.data
    });
    return draft ? reply.status(201).send({ draft }) : reply.status(404).send({ error: "code_integration_not_found" });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleErrorGroupOccurrencesRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.listErrors) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = errorGroupParamsSchema.safeParse(request.params);
  const filters = parseFilters(request.query, { includeErrorFilters: true });
  if (!params.success || !filters) {
    return reply.status(400).send({ error: "invalid_query" });
  }
  if (filters.errorGroupId && filters.errorGroupId !== params.data.id) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return sendListResult(reply, await options.query.listErrors({ ...filters, errorGroupId: params.data.id }));
  } catch (error) {
    if (isInvalidCursorError(error)) {
      return reply.status(400).send({ error: "invalid_cursor" });
    }
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleErrorSourceMapResolutionRoute(
  request: FastifyRequest,
  reply: FastifyReply,
  options: QueryRouteOptions
) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.resolveErrorStack) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = errorParamsSchema.safeParse(request.params);
  const scope = parseErrorGroupScope(request.query);
  if (!params.success || !scope) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    const resolution = await options.query.resolveErrorStack({
      errorId: params.data.id,
      projectId: scope.projectId,
      environmentId: scope.environmentId
    });
    return resolution ? reply.send({ data: resolution }) : reply.status(404).send({ error: "error_not_found" });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleErrorGroupStatusRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  const params = errorGroupParamsSchema.safeParse(request.params);
  const scope = parseErrorGroupScope(request.query);
  const body = errorGroupTriageBodySchema.safeParse(request.body);
  if (!params.success || !scope || !body.success) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  const hasAssignment = "assignedToUserId" in body.data;
  const hasTriageFields = body.data.status !== undefined || "priority" in body.data;

  // Apply status/priority first if present
  if (hasTriageFields) {
    if (!options.query?.updateErrorGroupTriage && (!options.query?.updateErrorGroupStatus || !body.data.status)) {
      return reply.status(501).send({ error: "query_method_unavailable" });
    }

    try {
      const group = options.query.updateErrorGroupTriage
        ? await options.query.updateErrorGroupTriage(params.data.id, { ...scope, ...body.data })
        : await options.query.updateErrorGroupStatus!(params.data.id, {
            ...scope,
            status: body.data.status!
          });
      if (!group) {
        return reply.status(404).send({ error: "error_group_not_found" });
      }
      // If no assignment, return now
      if (!hasAssignment) {
        return reply.send({ data: group });
      }
    } catch {
      return reply.status(503).send({ error: "query_unavailable" });
    }
  }

  // Handle assignment (either standalone or after status/priority)
  if (hasAssignment) {
    if (!options.query?.assignIncident) {
      return reply.status(501).send({ error: "query_method_unavailable" });
    }

    try {
      const result = await options.query.assignIncident({
        errorGroupId: params.data.id,
        assignedToUserId: body.data.assignedToUserId ?? null,
        projectId: scope.projectId,
        environmentId: scope.environmentId
      });

      if (result.ok) {
        return reply.send({ data: result.group });
      }
      if (result.error.kind === "group_not_found") {
        return reply.status(404).send({ error: "error_group_not_found" });
      }
      if (result.error.kind === "user_not_found") {
        return reply.status(400).send({ error: "user_not_found", message: "The specified user does not exist." });
      }
      if (result.error.kind === "user_archived") {
        return reply.status(400).send({ error: "user_archived", message: "The specified user is archived and cannot be assigned." });
      }
      return reply.status(503).send({ error: "query_unavailable" });
    } catch {
      return reply.status(503).send({ error: "query_unavailable" });
    }
  }

  // Neither field present (shouldn't reach here given Zod refine, but guard anyway)
  return reply.status(400).send({ error: "invalid_query" });
}

async function handleTriageNoteRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.addTriageNote) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = errorGroupParamsSchema.safeParse(request.params);
  const scope = parseErrorGroupScope(request.query);
  const body = triageNoteBodySchema.safeParse(request.body);
  if (!params.success || !scope || !body.success) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    const result = await options.query.addTriageNote({
      errorGroupId: params.data.id,
      authorUserId: user.id,
      authorEmail: user.email,
      body: body.data.body,
      projectId: scope.projectId,
      environmentId: scope.environmentId
    });
    if (!result.ok) {
      return reply.status(404).send({ error: "error_group_not_found" });
    }
    return reply.send({ data: result.note });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleSilenceIncidentRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.silenceIncident) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = errorGroupParamsSchema.safeParse(request.params);
  const scope = parseErrorGroupScope(request.query);
  const body = silenceBodySchema.safeParse(request.body);
  if (!params.success || !scope || !body.success) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  const minutes = body.data.minutes;
  const until = minutes !== null && minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;

  try {
    const group = await options.query.silenceIncident({
      errorGroupId: params.data.id,
      until,
      projectId: scope.projectId,
      environmentId: scope.environmentId
    });
    return group ? reply.send({ data: group }) : reply.status(404).send({ error: "error_group_not_found" });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

function parseMttrWindow(raw: RawQuery): number | null {
  const value = optionalNonEmpty(raw, "window") ?? "7d";
  if (value === "7d") return 7;
  if (value === "30d") return 30;
  return null;
}

async function handleIncidentMttrRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getIncidentMttr) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const raw = (request.query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  const windowDays = parseMttrWindow(raw);
  if (!projectId || !environmentId || windowDays === null) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    const result = await options.query.getIncidentMttr({ projectId, environmentId, windowDays });
    return reply.send({ data: { ...result, windowDays } });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

// ---------------------------------------------------------------------------
// Fleet TTL cache (10 s in-process, keyed by window)
// ---------------------------------------------------------------------------

type FleetCacheEntry = { data: FleetData; expiresAt: number };
const fleetCache = new Map<string, FleetCacheEntry>();
const FLEET_TTL_MS = 10_000;

/** Clears the in-process fleet cache. Exposed for test isolation only. */
export function clearFleetCache(): void {
  fleetCache.clear();
}

async function getCachedFleet(
  window: "24h" | "7d" | "30d",
  getFleet: (window: "24h" | "7d" | "30d") => Promise<FleetData>
): Promise<FleetData> {
  const cached = fleetCache.get(window);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }
  const data = await getFleet(window);
  fleetCache.set(window, { data, expiresAt: Date.now() + FLEET_TTL_MS });
  return data;
}

// ---------------------------------------------------------------------------
// Fleet route handlers
// ---------------------------------------------------------------------------

function parseFleetWindow(query: unknown): "24h" | "7d" | "30d" | null {
  const raw = (query ?? {}) as Record<string, unknown>;
  const value = typeof raw.window === "string" ? raw.window.trim() : undefined;
  const resolved = value && value.length > 0 ? value : "24h";
  if (resolved !== "24h" && resolved !== "7d" && resolved !== "30d") {
    return null;
  }
  return resolved;
}

const fleetProjectParamsSchema = z.object({ id: z.string().trim().min(1) });

async function handleFleetRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getFleet) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const window = parseFleetWindow(request.query);
  if (window === null) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    const data = await getCachedFleet(window, options.query.getFleet);
    return reply.send({ data });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleFleetProjectEnvironmentsRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getProjectFleetEnvironments) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = fleetProjectParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  const window = parseFleetWindow(request.query);
  if (window === null) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    const result = await options.query.getProjectFleetEnvironments(params.data.id, window);
    if (result === undefined) {
      return reply.status(404).send({ error: "project_not_found" });
    }
    return reply.send({ data: result });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

export function registerQueryRoutes(app: FastifyInstance, options: QueryRouteOptions): void {
  app.get("/query/fleet", (request, reply) => handleFleetRoute(request, reply, options));
  app.get("/query/fleet/projects/:id/environments", (request, reply) =>
    handleFleetProjectEnvironmentsRoute(request, reply, options)
  );
  app.get("/query/overview", (request, reply) => handleOverviewRoute(request, reply, options));
  app.get("/query/recent-activity", (request, reply) => handleRecentActivityRoute(request, reply, options));
  app.get("/query/releases", (request, reply) => handleReleaseListRoute(request, reply, options));
  app.get("/query/llm/summary", (request, reply) =>
    handleLlmAggregateRoute(request, reply, options,
      () => !!options.query?.getLlmSummary,
      (filters) => options.query!.getLlmSummary!(filters)));
  app.get("/query/llm/by-tenant", (request, reply) =>
    handleLlmAggregateRoute(request, reply, options,
      () => !!options.query?.getLlmByTenant,
      (filters) => options.query!.getLlmByTenant!(filters)));
  app.get("/query/llm/by-prompt", (request, reply) =>
    handleLlmAggregateRoute(request, reply, options,
      () => !!options.query?.getLlmByPrompt,
      (filters) => options.query!.getLlmByPrompt!(filters)));
  app.get("/query/llm/cost-by-model", (request, reply) =>
    handleLlmAggregateRoute(request, reply, options,
      () => !!options.query?.getLlmCostByModel,
      (filters) => options.query!.getLlmCostByModel!(filters)));
  app.get("/query/operations", (request, reply) => handleOperationsRoute(request, reply, options));
  app.get("/query/apm/endpoints", (request, reply) => handleApmEndpointsRoute(request, reply, options));
  app.get("/query/apm/service-map", (request, reply) => handleServiceMapRoute(request, reply, options));
  app.get("/query/apm/web-vitals", (request, reply) => handleWebVitalsRoute(request, reply, options));
  app.get("/query/apm/profiles", (request, reply) => handleRuntimeProfilesRoute(request, reply, options));
  app.get("/query/events/properties", (request, reply) => handleEventPropertyCatalogRoute(request, reply, options));
  app.get("/query/events/click-map", (request, reply) => handleEventClickMapRoute(request, reply, options));
  app.get("/query/events/paths", (request, reply) => handleEventPathsRoute(request, reply, options));
  app.get("/query/events/funnel", (request, reply) => handleEventFunnelRoute(request, reply, options));
  app.get("/query/experiments/:id/results", (request, reply) => handleExperimentResultsRoute(request, reply, options));
  app.get("/query/surveys/:id/results", (request, reply) => handleSurveyResultsRoute(request, reply, options));
  app.get("/query/surveys/:id/nps", (request, reply) => handleNpsResultsRoute(request, reply, options));
  app.get("/query/message-campaigns/:id/results", (request, reply) =>
    handleMessageCampaignResultsRoute(request, reply, options));
  app.get("/query/feedback", (request, reply) => handleFeedbackListRoute(request, reply, options));
  app.patch("/query/feedback/:id", (request, reply) => handleFeedbackStatusRoute(request, reply, options));
  app.get("/query/events/retention", (request, reply) => handleEventRetentionRoute(request, reply, options));
  app.get("/query/analytics/trends", (request, reply) => handleAnalyticsTrendRoute(request, reply, options));
  app.get("/query/reports/dashboards/:id", (request, reply) => handleDashboardReportRoute(request, reply, options));
  app.get("/query/sessions/:sessionId/timeline", (request, reply) => handleSessionTimelineRoute(request, reply, options));
  app.get("/query/replays", (request, reply) => handleSessionReplayListRoute(request, reply, options));
  app.get("/query/replays/:replayId", (request, reply) => handleSessionReplayRoute(request, reply, options));
  app.get("/query/entities/tenants", (request, reply) => handleEntityTenantListRoute(request, reply, options));
  app.get("/query/entities/tenants/:tenantKey", (request, reply) => handleEntityTenantDetailRoute(request, reply, options));
  app.get("/query/users", (request, reply) => handleUserListRoute(request, reply, options));
  app.get("/query/users/:userKey", (request, reply) => handleUserDetailRoute(request, reply, options));
  app.get("/query/error-groups", (request, reply) => handleErrorGroupListRoute(request, reply, options));
  app.get("/query/incidents/error-groups/:id", (request, reply) =>
    handleErrorGroupIncidentRoute(request, reply, options)
  );
  app.post("/query/incidents/error-groups/:id/notes", (request, reply) =>
    handleTriageNoteRoute(request, reply, options)
  );
  app.post("/query/incidents/error-groups/:id/external-issues", (request, reply) =>
    handleIncidentExternalIssueLinkRoute(request, reply, options)
  );
  app.post("/query/incidents/error-groups/:id/external-issues/draft", (request, reply) =>
    handleIncidentExternalIssueDraftRoute(request, reply, options)
  );
  app.post("/query/incidents/error-groups/:id/silence", (request, reply) =>
    handleSilenceIncidentRoute(request, reply, options)
  );
  app.get("/query/incidents/mttr", (request, reply) =>
    handleIncidentMttrRoute(request, reply, options)
  );
  app.get("/query/error-groups/:id/errors", (request, reply) =>
    handleErrorGroupOccurrencesRoute(request, reply, options)
  );
  app.get("/query/error-groups/:id", (request, reply) => handleErrorGroupDetailRoute(request, reply, options));
  app.patch("/query/error-groups/:id", (request, reply) => handleErrorGroupStatusRoute(request, reply, options));
  app.get("/query/errors/:id/source-map-resolution", (request, reply) =>
    handleErrorSourceMapResolutionRoute(request, reply, options)
  );

  app.get("/query/events", (request, reply) =>
    handleListRoute(
      request,
      reply,
      options,
      () => !!options.query?.listEvents,
      (filters) => options.query!.listEvents!(filters),
      { includeEventName: true }
    )
  );
  app.get("/query/errors", (request, reply) =>
    handleListRoute(
      request,
      reply,
      options,
      () => !!options.query?.listErrors,
      (filters) => options.query!.listErrors!(filters),
      { includeErrorFilters: true }
    )
  );
  app.get("/query/llm-calls", (request, reply) =>
    handleListRoute(
      request,
      reply,
      options,
      () => !!options.query?.listLlmCalls,
      (filters) => options.query!.listLlmCalls!(filters),
      { includeLlmFilters: true }
    )
  );
  app.get("/query/traces", (request, reply) =>
    handleListRoute(
      request,
      reply,
      options,
      () => !!options.query?.listTraces,
      (filters) => options.query!.listTraces!(filters),
      { includeTraceFilters: true }
    )
  );
  app.get("/query/traces/:id/spans", (request, reply) => handleTraceSpansRoute(request, reply, options));

  app.get("/query/aggregates/events", (request, reply) =>
    handleAggregateRoute(
      request,
      reply,
      options,
      () => !!options.query?.getEventAggregates,
      (filters) => options.query!.getEventAggregates!(filters),
      { includeEventName: true }
    )
  );
  app.get("/query/aggregates/errors", (request, reply) =>
    handleAggregateRoute(request, reply, options, () => !!options.query?.getErrorAggregates, (filters) =>
      options.query!.getErrorAggregates!(filters)
    )
  );
  app.get("/query/aggregates/llm", (request, reply) =>
    handleAggregateRoute(
      request,
      reply,
      options,
      () => !!options.query?.getLlmAggregates,
      (filters) => options.query!.getLlmAggregates!(filters),
      { includeLlmFilters: true }
    )
  );
  app.get("/query/aggregates/traces", (request, reply) =>
    handleAggregateRoute(request, reply, options, () => !!options.query?.getTraceAggregates, (filters) =>
      options.query!.getTraceAggregates!(filters)
    )
  );
}
