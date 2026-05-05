import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { setCurrentUser, type AuthenticatedUser } from "../plugins/request-context.js";
import type { AuthDependencies } from "./auth.js";

export type QueryFilters = {
  projectId: string;
  environmentId: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  eventName?: string;
  provider?: string;
  model?: string;
  promptName?: string;
  severity?: string;
  status?: string;
  fingerprint?: string;
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
};

export type EntityWindow = "24h" | "7d" | "30d";

export type EntitySignalType = "event" | "error" | "trace" | "llm";

export type EntityCursor = {
  timestamp: string;
  type: EntitySignalType;
  id: string;
};

export type EntityTenantListFilters = {
  projectId: string;
  environmentId: string;
  window: EntityWindow;
  search?: string;
  limit: number;
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
  getErrorAggregates?: (filters: QueryFilters) => Promise<unknown>;
  getLlmAggregates?: (filters: QueryFilters) => Promise<unknown>;
  getTraceAggregates?: (filters: QueryFilters) => Promise<unknown>;
  getOverview?: (filters: OverviewFilters) => Promise<unknown>;
  listEntityTenants?: (filters: EntityTenantListFilters) => Promise<unknown>;
  getEntityTenantDetail?: (tenantId: string, filters: EntityTenantDetailFilters) => Promise<unknown>;
};

export type QueryRouteOptions = {
  auth?: AuthDependencies;
  query?: QueryDependencies;
};

const traceParamsSchema = z.object({ id: z.string().trim().min(1) });
const entityTenantParamsSchema = z.object({ tenantKey: z.string().trim().min(1) });

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
  options: { includeEventName?: boolean; includeErrorFilters?: boolean; includeLlmFilters?: boolean } = {}
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
  const eventName = optionalNonEmpty(raw, "event_name");
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
  if (options.includeEventName && eventName) {
    filters.eventName = eventName;
  }
  if (options.includeErrorFilters) {
    const severity = optionalNonEmpty(raw, "severity");
    const status = optionalNonEmpty(raw, "status");
    const fingerprint = optionalNonEmpty(raw, "fingerprint");

    if (severity) {
      filters.severity = severity;
    }
    if (status) {
      filters.status = status;
    }
    if (fingerprint) {
      filters.fingerprint = fingerprint;
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

  return {
    projectId,
    environmentId,
    window: rawWindow
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

function parseEntityTenantListFilters(query: unknown): EntityTenantListFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  const window = parseEntityWindow(raw);
  if (!projectId || !environmentId || !window) {
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

async function handleListRoute(
  request: FastifyRequest,
  reply: FastifyReply,
  options: QueryRouteOptions,
  hasMethod: () => boolean,
  run: ListRunner,
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
    return sendListResult(reply, await run(filters));
  } catch {
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
  } catch {
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
  } catch {
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

export function registerQueryRoutes(app: FastifyInstance, options: QueryRouteOptions): void {
  app.get("/query/overview", (request, reply) => handleOverviewRoute(request, reply, options));
  app.get("/query/entities/tenants", (request, reply) => handleEntityTenantListRoute(request, reply, options));
  app.get("/query/entities/tenants/:tenantKey", (request, reply) => handleEntityTenantDetailRoute(request, reply, options));

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
    handleListRoute(request, reply, options, () => !!options.query?.listTraces, (filters) => options.query!.listTraces!(filters))
  );
  app.get("/query/traces/:id/spans", (request, reply) => handleTraceSpansRoute(request, reply, options));

  app.get("/query/aggregates/events", (request, reply) =>
    handleAggregateRoute(request, reply, options, () => !!options.query?.getEventAggregates, (filters) =>
      options.query!.getEventAggregates!(filters)
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
