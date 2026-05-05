# Entities Investigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only `Investigate -> Entities` tenant investigation view with impact-ranked tenant summaries, top users, and a cursor-paginated cross-signal timeline.

**Architecture:** Add two authenticated query endpoints backed by a focused DB repository module, then expose them through the console API client and a new lazy-loaded Entities investigation tab. The DB layer uses existing telemetry tables only, computes UTC fixed windows, keeps `Unassigned` visible in summaries, and excludes spans from the tenant timeline.

**Tech Stack:** TypeScript, Fastify, Zod, Kysely, PostgreSQL, React, Vitest, Testing Library, Playwright CLI for visual verification.

---

## Source Documents

- Design spec: `docs/superpowers/specs/2026-05-05-entities-investigation-design.md`
- API route patterns: `apps/api/src/routes/query.ts`
- API route tests: `apps/api/test/query.test.ts`
- DB query patterns: `packages/db/src/repositories/telemetry-query.ts`
- DB test harness: `packages/db/test/repositories.test.ts`
- Console client patterns: `apps/console/src/api/client.ts`, `apps/console/src/api/types.ts`, `apps/console/src/api/client.test.ts`
- Investigation UI patterns: `apps/console/src/components/InvestigationWorkspace.tsx`, `EventInvestigationPanel.tsx`, `ErrorInvestigationPanel.tsx`, `TraceInvestigationPanel.tsx`, `LlmInvestigationPanel.tsx`
- Overview drilldown patterns: `apps/console/src/components/OverviewDashboard.tsx`, `OverviewTopLists.tsx`, `ConsoleShell.tsx`
- Styles: `apps/console/src/styles.css`

## File Structure

Create:

- `packages/db/src/repositories/entities-query.ts`: entity query types, UTC window calculation, impact scoring, tenant summary aggregation, top-user aggregation, timeline cursor encode/decode helpers, tenant timeline query.
- `apps/console/src/components/EntitiesInvestigationPanel.tsx`: owns Entities tab state, list/detail loading, stale response protection, retry, filters, and drilldown callbacks.
- `apps/console/src/components/EntitiesTenantList.tsx`: tenant list rendering, disabled `Unassigned`, view-level sort controls, empty and unavailable list states.
- `apps/console/src/components/EntitiesTenantDetail.tsx`: selected tenant summary cards, top users, timeline filters, timeline rows, empty and unavailable detail states.
- `apps/console/src/components/EntitiesInvestigationPanel.test.tsx`: UI behavior for the new tab and drilldowns.

Modify:

- `apps/api/src/routes/query.ts`: add entity route types, parsers, dependency methods, handlers, and routes.
- `apps/api/src/main.ts`: wire entity repository functions into query dependencies.
- `apps/api/test/query.test.ts`: route contract tests for entity list/detail endpoints.
- `apps/api/test/e2e.test.ts`: include entity query dependency wiring in API e2e setup if the e2e app exercises the query dependency object.
- `packages/db/test/repositories.test.ts`: repository tests for tenant summaries, detail timeline, cursor behavior, UTC windows, search, and exclusion of spans.
- `apps/console/src/api/types.ts`: shared client-side entity query and response types.
- `apps/console/src/api/client.ts`: add `listEntityTenants` and `getEntityTenantDetail`.
- `apps/console/src/api/client.test.ts`: verify entity query URL encoding.
- `apps/console/src/components/InvestigationWorkspace.tsx`: add the `Entities` tab and initial selected tenant filter support.
- `apps/console/src/components/TraceInvestigationPanel.tsx`: accept initial filters so Entities can drill into Traces by tenant and trace id.
- `apps/console/src/components/TraceInvestigationPanel.test.tsx`: cover initial trace filters.
- `apps/console/src/components/OverviewDashboard.tsx`: add an Entities drilldown union member.
- `apps/console/src/components/OverviewTopLists.tsx`: route tenant top rows to Entities for assigned tenants.
- `apps/console/src/components/OverviewDashboard.test.tsx`: assert overview tenant drilldowns target Entities.
- `apps/console/src/components/ConsoleShell.tsx`: pass Entities drilldowns into `InvestigationWorkspace`.
- `apps/console/src/components/InvestigationWorkspace.test.tsx`: assert tab activation and initial selected tenant forwarding.
- `apps/console/src/styles.css`: add responsive two-column Entities layout, compact tenant rows, timeline rows, and mobile stacking.
- `.claude/docs/ARCHITECTURE.md`: document entity query endpoints and repository boundary.
- `.claude/docs/UI-UX.md`: document Entities investigation screen behavior.
- `.claude/docs/PROJECT-SUMMARY.md`: mention tenant entity investigation.
- `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`: record the implemented phase after verification.

Do not modify:

- Database migrations.
- Telemetry write APIs.
- Authentication or permission model.
- Span query behavior except confirming spans are excluded from Entities.

## Shared Contracts

Use these names consistently across API, DB, and console layers:

```ts
export type EntityWindow = "24h" | "7d" | "30d";
export type EntitySignalType = "event" | "error" | "trace" | "llm";

export type EntityCursor = {
  timestamp: string;
  type: EntitySignalType;
  id: string;
};

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

export type TenantTopUser = {
  userId: string;
  events: number;
  errors: number;
  traces: number;
  llmCalls: number;
  llmCostUsd: string;
  lastSeenAt: string;
};
```

Timeline row labels:

- Event: `eventName`
- Error: `message`
- Trace: `name`
- LLM: `${provider} / ${model}`

Cursor ordering:

```txt
timestamp desc, type asc, id asc
```

Cursor seek predicate for rows strictly after the last returned row:

```sql
timestamp < cursor.timestamp
or (timestamp = cursor.timestamp and type > cursor.type)
or (timestamp = cursor.timestamp and type = cursor.type and id > cursor.id)
```

Impact score formula:

```txt
impactScore =
  severeErrors * 15
  + openErrors * 8
  + errors * 5
  + failedTraces * 4
  + failedLlmCalls * 4
  + min(llmCostUsd, 100) * 0.25
```

Severe error severities:

```ts
const severeErrorSeverities = ["error", "critical", "fatal"] as const;
```

## Task 1: API Route Contract

**Files:**

- Modify: `apps/api/src/routes/query.ts`
- Test: `apps/api/test/query.test.ts`

- [ ] **Step 1: Add failing entity route tests**

Append these tests inside `describe("query routes", ...)` in `apps/api/test/query.test.ts` near the overview route tests:

```ts
it("forwards default entity tenant list filters", async () => {
  const receivedFilters: unknown[] = [];

  app = await buildApp({
    readiness,
    auth: humanAuth,
    query: {
      listEntityTenants: async (filters) => {
        receivedFilters.push(filters);
        return {
          window: "7d",
          generatedAt: "2026-05-05T12:00:00.000Z",
          scope: { projectId: "prj_1", environmentId: "env_1" },
          range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
          tenants: []
        };
      }
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/query/entities/tenants?project_id=prj_1&environment_id=env_1"
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    data: {
      window: "7d",
      generatedAt: "2026-05-05T12:00:00.000Z",
      scope: { projectId: "prj_1", environmentId: "env_1" },
      range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
      tenants: []
    }
  });
  expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", window: "7d", limit: 50 }]);
});

it("forwards explicit entity tenant list filters", async () => {
  const receivedFilters: unknown[] = [];

  app = await buildApp({
    readiness,
    auth: humanAuth,
    query: {
      listEntityTenants: async (filters) => {
        receivedFilters.push(filters);
        return {
          window: "30d",
          generatedAt: "2026-05-05T12:00:00.000Z",
          scope: { projectId: "prj_1", environmentId: "env_1" },
          range: { from: "2026-04-05T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
          tenants: []
        };
      }
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/query/entities/tenants?project_id=prj_1&environment_id=env_1&window=30d&search=%20tenant_1%20&limit=500"
  });

  expect(response.statusCode).toBe(200);
  expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", window: "30d", search: "tenant_1", limit: 100 }]);
});

it("rejects unsupported entity windows", async () => {
  app = await buildApp({
    readiness,
    auth: humanAuth,
    query: {
      listEntityTenants: async () => {
        throw new Error("should not run");
      }
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/query/entities/tenants?project_id=prj_1&environment_id=env_1&window=custom"
  });

  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: "invalid_query" });
});

it("forwards entity tenant detail filters and decoded cursor", async () => {
  const receivedFilters: unknown[] = [];
  const cursor = Buffer.from(JSON.stringify({ timestamp: "2026-05-05T11:00:00.000Z", type: "error", id: "err_1" })).toString("base64url");

  app = await buildApp({
    readiness,
    auth: humanAuth,
    query: {
      getEntityTenantDetail: async (tenantId, filters) => {
        receivedFilters.push({ tenantId, filters });
        return {
          window: "24h",
          generatedAt: "2026-05-05T12:00:00.000Z",
          scope: { projectId: "prj_1", environmentId: "env_1" },
          range: { from: "2026-05-04T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
          tenant: {
            tenantId: "tenant/one",
            label: "tenant/one",
            isUnassigned: false,
            impactScore: 0,
            lastSeenAt: null,
            events: 0,
            errors: 0,
            openErrors: 0,
            severeErrors: 0,
            traces: 0,
            failedTraces: 0,
            llmCalls: 0,
            failedLlmCalls: 0,
            llmCostUsd: "0",
            activeUsers: 0,
            activeSessions: 0
          },
          topUsers: [],
          timeline: []
        };
      }
    }
  });

  const response = await app.inject({
    method: "GET",
    url: `/query/entities/tenants/${encodeURIComponent("tenant/one")}?project_id=prj_1&environment_id=env_1&window=24h&user_id=user_1&signal_type=error&limit=25&cursor=${cursor}`
  });

  expect(response.statusCode).toBe(200);
  expect(receivedFilters).toEqual([
    {
      tenantId: "tenant/one",
      filters: {
        projectId: "prj_1",
        environmentId: "env_1",
        window: "24h",
        userId: "user_1",
        signalType: "error",
        limit: 25,
        cursor: { timestamp: "2026-05-05T11:00:00.000Z", type: "error", id: "err_1" }
      }
    }
  ]);
});

it("rejects unassigned and invalid entity detail cursors", async () => {
  app = await buildApp({
    readiness,
    auth: humanAuth,
    query: {
      getEntityTenantDetail: async () => {
        throw new Error("should not run");
      }
    }
  });

  const unassignedResponse = await app.inject({
    method: "GET",
    url: "/query/entities/tenants/_unassigned?project_id=prj_1&environment_id=env_1"
  });
  expect(unassignedResponse.statusCode).toBe(400);
  expect(unassignedResponse.json()).toEqual({ error: "invalid_query" });

  const invalidCursorResponse = await app.inject({
    method: "GET",
    url: "/query/entities/tenants/tenant_1?project_id=prj_1&environment_id=env_1&cursor=not-json"
  });
  expect(invalidCursorResponse.statusCode).toBe(400);
  expect(invalidCursorResponse.json()).toEqual({ error: "invalid_query" });
});
```

- [ ] **Step 2: Run the API test subset and confirm failure**

Run:

```bash
pnpm --filter @signal-hub/api test -- query.test.ts
```

Expected: fails because `listEntityTenants` and `getEntityTenantDetail` are not part of `QueryDependencies`, and the `/query/entities/tenants` routes do not exist.

- [ ] **Step 3: Add entity route types and parsers**

In `apps/api/src/routes/query.ts`, add these exports below `OverviewFilters`:

```ts
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
```

Extend `QueryDependencies`:

```ts
listEntityTenants?: (filters: EntityTenantListFilters) => Promise<unknown>;
getEntityTenantDetail?: (tenantId: string, filters: EntityTenantDetailFilters) => Promise<unknown>;
```

Add these helpers near `parseOverviewFilters`:

```ts
function parseEntityWindow(raw: RawQuery): EntityWindow | undefined {
  const rawWindow = optionalNonEmpty(raw, "window") ?? "7d";
  if (rawWindow === "24h" || rawWindow === "7d" || rawWindow === "30d") {
    return rawWindow;
  }
  return undefined;
}

function parseEntityLimit(raw: RawQuery): number {
  const value = optionalNonEmpty(raw, "limit");
  if (!value) return 50;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  const integer = Math.floor(parsed);
  if (integer < 1) return 1;
  return Math.min(integer, 100);
}

function parseEntitySignalType(raw: RawQuery): EntitySignalType | undefined | null {
  const value = optionalNonEmpty(raw, "signal_type");
  if (!value) return undefined;
  if (value === "event" || value === "error" || value === "trace" || value === "llm") {
    return value;
  }
  return null;
}

function parseEntityCursor(raw: RawQuery): EntityCursor | undefined | null {
  const value = optionalNonEmpty(raw, "cursor");
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<EntityCursor>;
    if (
      typeof parsed.timestamp === "string" &&
      !Number.isNaN(new Date(parsed.timestamp).getTime()) &&
      typeof parsed.id === "string" &&
      parsed.id.length > 0 &&
      (parsed.type === "event" || parsed.type === "error" || parsed.type === "trace" || parsed.type === "llm")
    ) {
      return { timestamp: parsed.timestamp, type: parsed.type, id: parsed.id };
    }
  } catch {
    return null;
  }

  return null;
}

function parseEntityTenantListFilters(query: unknown): EntityTenantListFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  const window = parseEntityWindow(raw);
  if (!projectId || !environmentId || !window) return undefined;

  const filters: EntityTenantListFilters = {
    projectId,
    environmentId,
    window,
    limit: parseEntityLimit(raw)
  };
  const search = optionalNonEmpty(raw, "search");
  if (search) filters.search = search;
  return filters;
}

function parseEntityTenantDetailFilters(query: unknown): EntityTenantDetailFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  const window = parseEntityWindow(raw);
  const signalType = parseEntitySignalType(raw);
  const cursor = parseEntityCursor(raw);
  if (!projectId || !environmentId || !window || signalType === null || cursor === null) return undefined;

  const filters: EntityTenantDetailFilters = {
    projectId,
    environmentId,
    window,
    limit: parseEntityLimit(raw)
  };
  const userId = optionalNonEmpty(raw, "user_id");
  if (userId) filters.userId = userId;
  if (signalType) filters.signalType = signalType;
  if (cursor) filters.cursor = cursor;
  return filters;
}
```

- [ ] **Step 4: Add entity route handlers and routes**

Add:

```ts
const entityTenantParamsSchema = z.object({ tenantKey: z.string().trim().min(1) });

async function handleEntityTenantListRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) return reply;

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
  if (!user) return reply;

  if (!options.query?.getEntityTenantDetail) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = entityTenantParamsSchema.safeParse(request.params);
  const filters = parseEntityTenantDetailFilters(request.query);
  if (!params.success || !filters || params.data.tenantKey === "_unassigned") {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getEntityTenantDetail(params.data.tenantKey, filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}
```

Register the routes immediately after `/query/overview`:

```ts
app.get("/query/entities/tenants", (request, reply) => handleEntityTenantListRoute(request, reply, options));
app.get("/query/entities/tenants/:tenantKey", (request, reply) => handleEntityTenantDetailRoute(request, reply, options));
```

- [ ] **Step 5: Run API tests**

Run:

```bash
pnpm --filter @signal-hub/api test -- query.test.ts
```

Expected: PASS for `apps/api/test/query.test.ts`.

- [ ] **Step 6: Commit API route contract**

Run:

```bash
git add apps/api/src/routes/query.ts apps/api/test/query.test.ts
git commit -m "feat: add entities query routes"
```

## Task 2: DB Entity Tenant Summaries

**Files:**

- Create: `packages/db/src/repositories/entities-query.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Import new repository functions in DB tests**

In `packages/db/test/repositories.test.ts`, add:

```ts
import {
  getEntityTenantDetail,
  listEntityTenants,
  type EntityCursor
} from "../src/repositories/entities-query.js";
```

- [ ] **Step 2: Add failing summary tests**

Append these tests near the overview repository tests:

```ts
it("lists entity tenants by deterministic impact score", async () => {
  await withDb(async (db) => {
    await migrate(db);
    const project = await createProject(db, { name: "Entities Summary" });
    const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
    const now = new Date("2026-05-05T12:00:00.000Z");

    await insertEvent(db, {
      id: "evt_entity_alpha",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:55:00.000Z"),
      receivedAt: new Date("2026-05-05T11:55:01.000Z"),
      name: "checkout.started",
      tenantId: "tenant_alpha",
      userId: "user_alpha",
      sessionId: "session_alpha",
      traceId: "trace_alpha",
      source: null,
      release: null,
      metadata: {},
      properties: {}
    });
    await insertError(db, {
      id: "err_entity_alpha",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:56:00.000Z"),
      receivedAt: new Date("2026-05-05T11:56:01.000Z"),
      message: "Payment failed",
      type: "PaymentError",
      severity: "critical",
      stack: null,
      status: "open",
      fingerprint: "payment_failed",
      context: {},
      tenantId: "tenant_alpha",
      userId: "user_alpha",
      sessionId: "session_alpha",
      traceId: "trace_alpha",
      source: null,
      release: null,
      metadata: {}
    });
    await insertTrace(db, {
      id: "trc_entity_alpha",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:57:00.000Z"),
      receivedAt: new Date("2026-05-05T11:57:01.000Z"),
      name: "checkout",
      status: "error",
      startedAt: new Date("2026-05-05T11:57:00.000Z"),
      endedAt: new Date("2026-05-05T11:57:02.000Z"),
      durationMs: 2000,
      tenantId: "tenant_alpha",
      userId: "user_alpha",
      sessionId: "session_alpha",
      traceId: "trace_alpha",
      source: null,
      release: null,
      metadata: {}
    });
    await insertLlmCall(db, {
      id: "llm_entity_alpha",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:58:00.000Z"),
      receivedAt: new Date("2026-05-05T11:58:01.000Z"),
      provider: "openai",
      model: "gpt-5",
      promptName: "summarize_checkout",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: "12.500000",
      latencyMs: 800,
      status: "error",
      error: "timeout",
      inputPreview: "hidden",
      outputPreview: "hidden",
      tenantId: "tenant_alpha",
      userId: "user_alpha",
      sessionId: "session_alpha",
      traceId: "trace_alpha",
      source: null,
      release: null,
      metadata: {}
    });
    await insertEvent(db, {
      id: "evt_entity_unassigned",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:59:00.000Z"),
      receivedAt: new Date("2026-05-05T11:59:01.000Z"),
      name: "anonymous.activity",
      tenantId: null,
      userId: "anonymous_user",
      sessionId: "anonymous_session",
      traceId: null,
      source: null,
      release: null,
      metadata: {},
      properties: {}
    });
    await insertEvent(db, {
      id: "evt_entity_old",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-04-01T12:00:00.000Z"),
      receivedAt: new Date("2026-04-01T12:00:01.000Z"),
      name: "outside.window",
      tenantId: "tenant_old",
      userId: "user_old",
      sessionId: "session_old",
      traceId: null,
      source: null,
      release: null,
      metadata: {},
      properties: {}
    });

    const result = await listEntityTenants(db, { projectId: project.id, environmentId: environment.id, window: "7d", limit: 50, now });

    expect(result.window).toBe("7d");
    expect(result.range).toEqual({ from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" });
    expect(result.tenants.map((tenant) => tenant.label)).toEqual(["tenant_alpha", "Unassigned"]);
    expect(result.tenants[0]).toMatchObject({
      tenantId: "tenant_alpha",
      isUnassigned: false,
      events: 1,
      errors: 1,
      openErrors: 1,
      severeErrors: 1,
      traces: 1,
      failedTraces: 1,
      llmCalls: 1,
      failedLlmCalls: 1,
      llmCostUsd: "12.500000",
      activeUsers: 1,
      activeSessions: 1,
      lastSeenAt: "2026-05-05T11:58:00.000Z"
    });
    expect(result.tenants[0].impactScore).toBe(39.125);
    expect(result.tenants[1]).toMatchObject({ tenantId: null, label: "Unassigned", isUnassigned: true, events: 1 });
  });
});

it("searches entity tenants by tenant id or user id", async () => {
  await withDb(async (db) => {
    await migrate(db);
    const project = await createProject(db, { name: "Entities Search" });
    const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
    const now = new Date("2026-05-05T12:00:00.000Z");

    await insertEvent(db, {
      id: "evt_entity_search_tenant",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T10:00:00.000Z"),
      receivedAt: new Date("2026-05-05T10:00:01.000Z"),
      name: "tenant.match",
      tenantId: "tenant_search",
      userId: "user_a",
      sessionId: "session_a",
      traceId: null,
      source: null,
      release: null,
      metadata: {},
      properties: {}
    });
    await insertError(db, {
      id: "err_entity_search_user",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T10:01:00.000Z"),
      receivedAt: new Date("2026-05-05T10:01:01.000Z"),
      message: "User matched",
      type: null,
      severity: "warning",
      stack: null,
      status: "open",
      fingerprint: "user_matched",
      context: {},
      tenantId: "tenant_beta",
      userId: "user_search",
      sessionId: "session_b",
      traceId: null,
      source: null,
      release: null,
      metadata: {}
    });

    const byTenant = await listEntityTenants(db, { projectId: project.id, environmentId: environment.id, window: "7d", search: "tenant_sea", limit: 50, now });
    expect(byTenant.tenants.map((tenant) => tenant.tenantId)).toEqual(["tenant_search"]);

    const byUser = await listEntityTenants(db, { projectId: project.id, environmentId: environment.id, window: "7d", search: "user_sea", limit: 50, now });
    expect(byUser.tenants.map((tenant) => tenant.tenantId)).toEqual(["tenant_beta"]);
  });
});
```

- [ ] **Step 3: Run DB tests and confirm failure**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: fails because `packages/db/src/repositories/entities-query.ts` does not exist.

- [ ] **Step 4: Create entity repository contracts and helpers**

Create `packages/db/src/repositories/entities-query.ts` with these exports and helpers:

```ts
import { sql } from "kysely";
import type { Db } from "../client.js";

export type EntityWindow = "24h" | "7d" | "30d";
export type EntitySignalType = "event" | "error" | "trace" | "llm";

export type EntityCursor = {
  timestamp: string;
  type: EntitySignalType;
  id: string;
};

export type EntityRange = {
  from: string;
  to: string;
};

export type EntityTenantFilters = {
  projectId: string;
  environmentId: string;
  window: EntityWindow;
  search?: string;
  limit?: number;
  now?: Date;
};

export type EntityTenantDetailFilters = {
  projectId: string;
  environmentId: string;
  window: EntityWindow;
  userId?: string;
  signalType?: EntitySignalType;
  limit?: number;
  cursor?: EntityCursor;
  now?: Date;
};

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

export type TenantListResponse = {
  window: EntityWindow;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: EntityRange;
  tenants: TenantSummary[];
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
```

Add helpers:

```ts
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const severeErrorSeverities = ["error", "critical", "fatal"] as const;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function resolveEntityRange(window: EntityWindow, now = new Date()): { from: Date; to: Date; range: EntityRange } {
  const to = now;
  const from = new Date(to);
  if (window === "24h") {
    from.setUTCHours(from.getUTCHours() - 24);
  } else if (window === "7d") {
    from.setUTCDate(from.getUTCDate() - 7);
  } else {
    from.setUTCDate(from.getUTCDate() - 30);
  }
  return { from, to, range: { from: from.toISOString(), to: to.toISOString() } };
}

function tenantLabel(tenantId: string | null): string {
  return tenantId ?? "Unassigned";
}

function computeImpactScore(input: {
  severeErrors: number;
  openErrors: number;
  errors: number;
  failedTraces: number;
  failedLlmCalls: number;
  llmCostUsd: number;
}): number {
  return (
    input.severeErrors * 15 +
    input.openErrors * 8 +
    input.errors * 5 +
    input.failedTraces * 4 +
    input.failedLlmCalls * 4 +
    Math.min(input.llmCostUsd, 100) * 0.25
  );
}

function searchPattern(search: string | undefined): string | undefined {
  const trimmed = search?.trim();
  return trimmed ? `%${trimmed}%` : undefined;
}
```

- [ ] **Step 5: Implement `listEntityTenants`**

Use one SQL query with scoped CTEs from `events`, `errors`, `traces`, and `llm_calls`. Include rows where either `tenant_id ilike pattern` or `user_id ilike pattern` when `search` is present. Return summaries sorted by impact score desc, lastSeenAt desc, event count desc, label asc.

The function signature must be:

```ts
export async function listEntityTenants(db: Db, filters: EntityTenantFilters): Promise<TenantListResponse> {
  const { from, to, range } = resolveEntityRange(filters.window, filters.now);
  const pattern = searchPattern(filters.search);
  const limit = resolveLimit(filters.limit);
  const rows = await sql<{
    tenant_id: string | null;
    last_seen_at: Date | string | null;
    events: unknown;
    errors: unknown;
    open_errors: unknown;
    severe_errors: unknown;
    traces: unknown;
    failed_traces: unknown;
    llm_calls: unknown;
    failed_llm_calls: unknown;
    llm_cost_usd: string;
    active_users: unknown;
    active_sessions: unknown;
  }>`
    with scoped_events as (
      select tenant_id, user_id, session_id, timestamp, 1::bigint as events, 0::bigint as errors, 0::bigint as open_errors,
        0::bigint as severe_errors, 0::bigint as traces, 0::bigint as failed_traces, 0::bigint as llm_calls,
        0::bigint as failed_llm_calls, 0::numeric as llm_cost_usd
      from events
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
        and (${pattern ?? null}::text is null or tenant_id ilike ${pattern ?? ""} or user_id ilike ${pattern ?? ""})
    ),
    scoped_errors as (
      select tenant_id, user_id, session_id, timestamp, 0::bigint as events, 1::bigint as errors,
        case when status = 'open' then 1 else 0 end::bigint as open_errors,
        case when severity = any(${sql.array(severeErrorSeverities, "text")}) then 1 else 0 end::bigint as severe_errors,
        0::bigint as traces, 0::bigint as failed_traces, 0::bigint as llm_calls, 0::bigint as failed_llm_calls,
        0::numeric as llm_cost_usd
      from errors
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
        and (${pattern ?? null}::text is null or tenant_id ilike ${pattern ?? ""} or user_id ilike ${pattern ?? ""})
    ),
    scoped_traces as (
      select tenant_id, user_id, session_id, timestamp, 0::bigint as events, 0::bigint as errors, 0::bigint as open_errors,
        0::bigint as severe_errors, 1::bigint as traces,
        case when status <> 'success' then 1 else 0 end::bigint as failed_traces,
        0::bigint as llm_calls, 0::bigint as failed_llm_calls, 0::numeric as llm_cost_usd
      from traces
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
        and (${pattern ?? null}::text is null or tenant_id ilike ${pattern ?? ""} or user_id ilike ${pattern ?? ""})
    ),
    scoped_llm_calls as (
      select tenant_id, user_id, session_id, timestamp, 0::bigint as events, 0::bigint as errors, 0::bigint as open_errors,
        0::bigint as severe_errors, 0::bigint as traces, 0::bigint as failed_traces, 1::bigint as llm_calls,
        case when status <> 'success' then 1 else 0 end::bigint as failed_llm_calls,
        cost_usd as llm_cost_usd
      from llm_calls
      where project_id = ${filters.projectId}
        and environment_id = ${filters.environmentId}
        and timestamp >= ${from}
        and timestamp <= ${to}
        and (${pattern ?? null}::text is null or tenant_id ilike ${pattern ?? ""} or user_id ilike ${pattern ?? ""})
    ),
    all_rows as (
      select * from scoped_events
      union all select * from scoped_errors
      union all select * from scoped_traces
      union all select * from scoped_llm_calls
    )
    select tenant_id, max(timestamp) as last_seen_at, sum(events) as events, sum(errors) as errors,
      sum(open_errors) as open_errors, sum(severe_errors) as severe_errors, sum(traces) as traces,
      sum(failed_traces) as failed_traces, sum(llm_calls) as llm_calls, sum(failed_llm_calls) as failed_llm_calls,
      coalesce(sum(llm_cost_usd), 0)::text as llm_cost_usd,
      count(distinct user_id) filter (where user_id is not null) as active_users,
      count(distinct session_id) filter (where session_id is not null) as active_sessions
    from all_rows
    group by tenant_id
  `.execute(db);

  const tenants = rows.rows.map((row): TenantSummary => {
    const errors = toNumber(row.errors);
    const openErrors = toNumber(row.open_errors);
    const severeErrors = toNumber(row.severe_errors);
    const failedTraces = toNumber(row.failed_traces);
    const failedLlmCalls = toNumber(row.failed_llm_calls);
    const llmCostUsd = row.llm_cost_usd;
    return {
      tenantId: row.tenant_id,
      label: tenantLabel(row.tenant_id),
      isUnassigned: row.tenant_id === null,
      impactScore: computeImpactScore({ severeErrors, openErrors, errors, failedTraces, failedLlmCalls, llmCostUsd: Number(llmCostUsd) }),
      lastSeenAt: row.last_seen_at ? toIso(row.last_seen_at) : null,
      events: toNumber(row.events),
      errors,
      openErrors,
      severeErrors,
      traces: toNumber(row.traces),
      failedTraces,
      llmCalls: toNumber(row.llm_calls),
      failedLlmCalls,
      llmCostUsd,
      activeUsers: toNumber(row.active_users),
      activeSessions: toNumber(row.active_sessions)
    };
  });

  tenants.sort((left, right) => {
    if (right.impactScore !== left.impactScore) return right.impactScore - left.impactScore;
    if ((right.lastSeenAt ?? "") !== (left.lastSeenAt ?? "")) return (right.lastSeenAt ?? "").localeCompare(left.lastSeenAt ?? "");
    if (right.events !== left.events) return right.events - left.events;
    return left.label.localeCompare(right.label);
  });

  return {
    window: filters.window,
    generatedAt: (filters.now ?? new Date()).toISOString(),
    scope: { projectId: filters.projectId, environmentId: filters.environmentId },
    range,
    tenants: tenants.slice(0, limit)
  };
}
```

- [ ] **Step 6: Run summary DB tests**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: summary tests pass; detail tests do not exist yet.

## Task 3: DB Entity Detail, Timeline, and Cursor

**Files:**

- Modify: `packages/db/src/repositories/entities-query.ts`
- Modify: `packages/db/test/repositories.test.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/test/e2e.test.ts`

- [ ] **Step 1: Add failing detail repository tests**

Append:

```ts
it("gets entity tenant detail with top users and cross-signal timeline", async () => {
  await withDb(async (db) => {
    await migrate(db);
    const project = await createProject(db, { name: "Entities Detail" });
    const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
    const now = new Date("2026-05-05T12:00:00.000Z");

    await insertEvent(db, {
      id: "evt_detail_1",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:55:00.000Z"),
      receivedAt: new Date("2026-05-05T11:55:01.000Z"),
      name: "checkout.started",
      tenantId: "tenant_detail",
      userId: "user_1",
      sessionId: "session_1",
      traceId: "trace_detail",
      source: null,
      release: null,
      metadata: {},
      properties: { secret: "not returned" }
    });
    await insertError(db, {
      id: "err_detail_1",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:56:00.000Z"),
      receivedAt: new Date("2026-05-05T11:56:01.000Z"),
      message: "Checkout failed",
      type: "CheckoutError",
      severity: "error",
      stack: "hidden stack",
      status: "open",
      fingerprint: "checkout_failed",
      context: { secret: "not returned" },
      tenantId: "tenant_detail",
      userId: "user_1",
      sessionId: "session_1",
      traceId: "trace_detail",
      source: null,
      release: null,
      metadata: {}
    });
    await insertTrace(db, {
      id: "trc_detail_1",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:57:00.000Z"),
      receivedAt: new Date("2026-05-05T11:57:01.000Z"),
      name: "checkout trace",
      status: "error",
      startedAt: new Date("2026-05-05T11:57:00.000Z"),
      endedAt: new Date("2026-05-05T11:57:03.000Z"),
      durationMs: 3000,
      tenantId: "tenant_detail",
      userId: "user_2",
      sessionId: "session_2",
      traceId: "trace_detail",
      source: null,
      release: null,
      metadata: {}
    });
    await insertSpan(db, {
      id: "spn_detail_1",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:57:30.000Z"),
      receivedAt: new Date("2026-05-05T11:57:31.000Z"),
      traceId: "trace_detail",
      parentSpanId: null,
      name: "span excluded",
      status: "error",
      startedAt: new Date("2026-05-05T11:57:30.000Z"),
      endedAt: new Date("2026-05-05T11:57:31.000Z"),
      durationMs: 1000,
      input: { hidden: true },
      output: null,
      error: { hidden: true },
      costUsd: null,
      tenantId: "tenant_detail",
      userId: "user_2",
      sessionId: "session_2",
      source: null,
      release: null,
      metadata: {}
    });
    await insertLlmCall(db, {
      id: "llm_detail_1",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:58:00.000Z"),
      receivedAt: new Date("2026-05-05T11:58:01.000Z"),
      provider: "openai",
      model: "gpt-5",
      promptName: "explain_checkout",
      inputTokens: 120,
      outputTokens: 80,
      costUsd: "1.250000",
      latencyMs: 500,
      status: "success",
      error: null,
      inputPreview: "hidden input",
      outputPreview: "hidden output",
      tenantId: "tenant_detail",
      userId: "user_2",
      sessionId: "session_2",
      traceId: "trace_detail",
      source: null,
      release: null,
      metadata: {}
    });

    const detail = await getEntityTenantDetail(db, "tenant_detail", {
      projectId: project.id,
      environmentId: environment.id,
      window: "7d",
      limit: 50,
      now
    });

    expect(detail.tenant.tenantId).toBe("tenant_detail");
    expect(detail.topUsers).toEqual([
      expect.objectContaining({ userId: "user_2", traces: 1, llmCalls: 1, llmCostUsd: "1.250000", lastSeenAt: "2026-05-05T11:58:00.000Z" }),
      expect.objectContaining({ userId: "user_1", events: 1, errors: 1, lastSeenAt: "2026-05-05T11:56:00.000Z" })
    ]);
    expect(detail.timeline.map((row) => row.id)).toEqual(["llm_detail_1", "trc_detail_1", "err_detail_1", "evt_detail_1"]);
    expect(detail.timeline).toEqual([
      expect.objectContaining({ type: "llm", label: "openai / gpt-5", provider: "openai", model: "gpt-5", promptName: "explain_checkout", costUsd: "1.250000" }),
      expect.objectContaining({ type: "trace", label: "checkout trace", name: "checkout trace", durationMs: 3000 }),
      expect.objectContaining({ type: "error", label: "Checkout failed", message: "Checkout failed", severity: "error", status: "open" }),
      expect.objectContaining({ type: "event", label: "checkout.started", eventName: "checkout.started" })
    ]);
    expect(JSON.stringify(detail.timeline)).not.toContain("hidden");
    expect(JSON.stringify(detail.timeline)).not.toContain("spn_detail_1");
  });
});

it("filters entity tenant detail by user and signal type and paginates with a cursor", async () => {
  await withDb(async (db) => {
    await migrate(db);
    const project = await createProject(db, { name: "Entities Cursor" });
    const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
    const now = new Date("2026-05-05T12:00:00.000Z");

    for (const [id, minute, userId] of [
      ["evt_cursor_1", "55", "user_cursor"],
      ["evt_cursor_2", "54", "user_cursor"],
      ["evt_cursor_3", "53", "other_user"]
    ] as const) {
      await insertEvent(db, {
        id,
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date(`2026-05-05T11:${minute}:00.000Z`),
        receivedAt: new Date(`2026-05-05T11:${minute}:01.000Z`),
        name: id,
        tenantId: "tenant_cursor",
        userId,
        sessionId: "session_cursor",
        traceId: null,
        source: null,
        release: null,
        metadata: {},
        properties: {}
      });
    }

    const firstPage = await getEntityTenantDetail(db, "tenant_cursor", {
      projectId: project.id,
      environmentId: environment.id,
      window: "7d",
      userId: "user_cursor",
      signalType: "event",
      limit: 1,
      now
    });

    expect(firstPage.timeline.map((row) => row.id)).toEqual(["evt_cursor_1"]);
    expect(firstPage.cursor).toEqual(expect.any(String));

    const secondPage = await getEntityTenantDetail(db, "tenant_cursor", {
      projectId: project.id,
      environmentId: environment.id,
      window: "7d",
      userId: "user_cursor",
      signalType: "event",
      limit: 10,
      cursor: decodeEntityCursorForTest(firstPage.cursor!),
      now
    });

    expect(secondPage.timeline.map((row) => row.id)).toEqual(["evt_cursor_2"]);
    expect(secondPage.cursor).toBeUndefined();
  });
});
```

Add this test helper above the tests:

```ts
function decodeEntityCursorForTest(cursor: string): EntityCursor {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as EntityCursor;
}
```

- [ ] **Step 2: Run DB tests and confirm failure**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: fails because `getEntityTenantDetail` is missing.

- [ ] **Step 3: Add timeline types and cursor encoder**

In `entities-query.ts`, add:

```ts
export type TenantTimelineRow =
  | { type: "event"; id: string; timestamp: string; label: string; userId: string | null; sessionId: string | null; traceId: string | null; eventName: string }
  | { type: "error"; id: string; timestamp: string; label: string; userId: string | null; sessionId: string | null; traceId: string | null; severity: string; status: string; message: string }
  | { type: "trace"; id: string; timestamp: string; label: string; userId: string | null; sessionId: string | null; traceId: string | null; status: string; durationMs: number | null; name: string }
  | { type: "llm"; id: string; timestamp: string; label: string; userId: string | null; sessionId: string | null; traceId: string | null; provider: string; model: string; promptName: string | null; status: string; costUsd: string };

export type TenantDetailResponse = {
  window: EntityWindow;
  generatedAt: string;
  scope: { projectId: string; environmentId: string };
  range: EntityRange;
  tenant: TenantSummary;
  topUsers: TenantTopUser[];
  timeline: TenantTimelineRow[];
  cursor?: string;
};

function encodeEntityCursor(cursor: EntityCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
```

- [ ] **Step 4: Implement `getEntityTenantDetail`**

Implement `getEntityTenantDetail` using `listEntityTenants` to resolve the selected tenant summary, a top-users CTE across the four signal tables, and a union timeline CTE across events, errors, traces, and LLM calls. Use `limit + 1` rows to compute the next cursor. Do not query `spans`.

Signature:

```ts
export async function getEntityTenantDetail(db: Db, tenantId: string, filters: EntityTenantDetailFilters): Promise<TenantDetailResponse> {
  const { from, to, range } = resolveEntityRange(filters.window, filters.now);
  const limit = resolveLimit(filters.limit);

  const summaryResult = await listEntityTenants(db, { ...filters, search: undefined, limit: 100, now: filters.now });
  const tenant = summaryResult.tenants.find((row) => row.tenantId === tenantId) ?? {
    tenantId,
    label: tenantId,
    isUnassigned: false,
    impactScore: 0,
    lastSeenAt: null,
    events: 0,
    errors: 0,
    openErrors: 0,
    severeErrors: 0,
    traces: 0,
    failedTraces: 0,
    llmCalls: 0,
    failedLlmCalls: 0,
    llmCostUsd: "0",
    activeUsers: 0,
    activeSessions: 0
  };

  const topUsers = await queryEntityTopUsers(db, tenantId, filters, from, to);
  const timeline = await queryEntityTimeline(db, tenantId, filters, from, to, limit + 1);
  const pageRows = timeline.slice(0, limit);
  const nextRow = timeline[limit];

  const response: TenantDetailResponse = {
    window: filters.window,
    generatedAt: (filters.now ?? new Date()).toISOString(),
    scope: { projectId: filters.projectId, environmentId: filters.environmentId },
    range,
    tenant,
    topUsers,
    timeline: pageRows
  };

  if (nextRow) {
    response.cursor = encodeEntityCursor({ timestamp: pageRows[pageRows.length - 1].timestamp, type: pageRows[pageRows.length - 1].type, id: pageRows[pageRows.length - 1].id });
  }

  return response;
}
```

Add `queryEntityTopUsers` and `queryEntityTimeline` as private functions below `getEntityTenantDetail`. The top-users query must aggregate only non-null `user_id` rows for the selected tenant, sort by latest activity desc, then total signal count desc, then `user_id` asc, and return at most 10 users. The timeline query must:

- Scope by `project_id`, `environment_id`, selected `tenant_id`, and UTC range.
- Apply `filters.userId` when present.
- Include a branch only when `filters.signalType` is absent or matches that branch.
- Use selected columns only from each signal table.
- Sort by `timestamp desc`, `type asc`, `id asc`.
- Apply cursor seek predicate when `filters.cursor` exists.
- Return mapped `TenantTimelineRow` objects.

- [ ] **Step 5: Wire repository into the API main app**

In `apps/api/src/main.ts`, import:

```ts
import { getEntityTenantDetail, listEntityTenants } from "@signal-hub/db/repositories/entities-query.js";
```

Add to the `query` dependency object:

```ts
listEntityTenants: (filters) => listEntityTenants(db, filters),
getEntityTenantDetail: (tenantId, filters) => getEntityTenantDetail(db, tenantId, filters),
```

In `apps/api/test/e2e.test.ts`, add the same dependency methods to the `buildApp` query object when it already wires query dependencies for e2e coverage.

- [ ] **Step 6: Run DB and API tests**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
pnpm --filter @signal-hub/api test -- query.test.ts
pnpm --filter @signal-hub/api test -- e2e.test.ts
```

Expected: all three commands pass.

- [ ] **Step 7: Commit DB repository and API wiring**

Run:

```bash
git add packages/db/src/repositories/entities-query.ts packages/db/test/repositories.test.ts apps/api/src/main.ts apps/api/test/e2e.test.ts
git commit -m "feat: add entities query repository"
```

## Task 4: Console Entity API Client

**Files:**

- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Test: `apps/console/src/api/client.test.ts`

- [ ] **Step 1: Add failing client URL tests**

In `apps/console/src/api/client.test.ts`, add:

```ts
it("encodes entity tenant list queries", async () => {
  const api = createApiClient();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: { tenants: [] } }));

  await api.listEntityTenants({
    projectId: "prj_1",
    environmentId: "env_1",
    window: "7d",
    search: "tenant_1",
    limit: 25
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/query/entities/tenants?project_id=prj_1&environment_id=env_1&window=7d&search=tenant_1&limit=25",
    expect.any(Object)
  );
});

it("encodes entity tenant detail queries", async () => {
  const api = createApiClient("/api");
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: { timeline: [] } }));

  await api.getEntityTenantDetail("tenant/one", {
    projectId: "prj_1",
    environmentId: "env_1",
    window: "24h",
    userId: "user_1",
    signalType: "llm",
    limit: 10,
    cursor: "cursor_1"
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/query/entities/tenants/tenant%2Fone?project_id=prj_1&environment_id=env_1&window=24h&user_id=user_1&signal_type=llm&limit=10&cursor=cursor_1",
    expect.any(Object)
  );
});
```

- [ ] **Step 2: Run client tests and confirm failure**

Run:

```bash
pnpm --filter @signal-hub/console test -- client.test.ts
```

Expected: fails because entity client methods and types do not exist.

- [ ] **Step 3: Add entity client types**

In `apps/console/src/api/types.ts`, add the shared contracts from the design spec after `OverviewResponse`. Use string timestamps for console types:

```ts
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
```

Add:

```ts
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
```

- [ ] **Step 4: Add client methods and URL builders**

In `apps/console/src/api/client.ts`, import the new types. Extend `ApiClient`:

```ts
listEntityTenants: (query: TenantListQuery) => Promise<AggregateResponse<TenantListResponse>>;
getEntityTenantDetail: (tenantId: string, query: TenantDetailQuery) => Promise<AggregateResponse<TenantDetailResponse>>;
```

Add builders near `overviewPath`:

```ts
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
```

Add methods in `createApiClient`:

```ts
listEntityTenants: (query) => request<AggregateResponse<TenantListResponse>>(path(apiBasePath, entityTenantListPath(query))),
getEntityTenantDetail: (tenantId, query) =>
  request<AggregateResponse<TenantDetailResponse>>(path(apiBasePath, entityTenantDetailPath(tenantId, query))),
```

- [ ] **Step 5: Run console API tests**

Run:

```bash
pnpm --filter @signal-hub/console test -- client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit client contract**

Run:

```bash
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts
git commit -m "feat: add entities console client"
```

## Task 5: Entities Investigation UI Shell

**Files:**

- Create: `apps/console/src/components/EntitiesInvestigationPanel.tsx`
- Create: `apps/console/src/components/EntitiesTenantList.tsx`
- Create: `apps/console/src/components/EntitiesTenantDetail.tsx`
- Create: `apps/console/src/components/EntitiesInvestigationPanel.test.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.test.tsx`
- Modify: `apps/console/src/styles.css`

- [ ] **Step 1: Add failing workspace and Entities tests**

In `InvestigationWorkspace.test.tsx`, add:

```ts
it("renders the Entities tab only when active", async () => {
  const api = client({
    listEntityTenants: vi.fn().mockResolvedValue({
      data: {
        window: "7d",
        generatedAt: "2026-05-05T12:00:00.000Z",
        scope: { projectId: "prj_1", environmentId: "env_1" },
        range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
        tenants: []
      }
    })
  });

  render(<InvestigationWorkspace client={api} environmentId="env_1" projectId="prj_1" />);
  expect(screen.getByRole("button", { name: "Entities" })).toBeInTheDocument();
  expect(api.listEntityTenants).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Entities" }));
  expect(await screen.findByText("No tenant activity in this window.")).toBeInTheDocument();
  expect(api.listEntityTenants).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", window: "7d", limit: 50 });
});
```

In `EntitiesInvestigationPanel.test.tsx`, add these six tests with the `tenantAlpha` fixture below:

- `renders impact-ranked tenants and disables Unassigned`: mock `listEntityTenants` with `[tenantAlpha, unassignedTenant]`, render the panel, assert `tenant_alpha` appears before `Unassigned`, click `Unassigned`, and assert `getEntityTenantDetail` was not called.
- `loads selected tenant summary top users and timeline`: mock `getEntityTenantDetail` with one top user and one event row, click `tenant_alpha`, assert `Events`, `LLM cost`, `user_1`, and `checkout.started` render.
- `applies user filter only after Apply`: select `tenant_alpha`, type `user_1` into the `User` input, assert no new detail request has `userId`, click `Apply`, then assert the latest detail request includes `userId: "user_1"`.
- `updates detail when signal type changes`: select `tenant_alpha`, change `Signal` to `Errors`, and assert the latest detail request includes `signalType: "error"`.
- `retries list and detail failures`: reject the first list request, assert `Tenant activity is unavailable.`, click `Retry`, resolve the next list request, then reject first detail request after selecting `tenant_alpha`, assert `Tenant detail is unavailable.`, click detail `Retry`, and resolve the next detail request.
- `ignores stale list and detail responses`: hold two list promises, change the window from `7d` to `24h`, resolve the `7d` promise after the `24h` promise, and assert only the `24h` tenant renders; repeat with two detail promises after changing the signal filter and assert only the newer timeline renders.

Use fixture builders in the test file:

```ts
const tenantAlpha = {
  tenantId: "tenant_alpha",
  label: "tenant_alpha",
  isUnassigned: false,
  impactScore: 39.125,
  lastSeenAt: "2026-05-05T11:58:00.000Z",
  events: 1,
  errors: 1,
  openErrors: 1,
  severeErrors: 1,
  traces: 1,
  failedTraces: 1,
  llmCalls: 1,
  failedLlmCalls: 1,
  llmCostUsd: "12.500000",
  activeUsers: 1,
  activeSessions: 1
};
```

- [ ] **Step 2: Run UI tests and confirm failure**

Run:

```bash
pnpm --filter @signal-hub/console test -- InvestigationWorkspace.test.tsx EntitiesInvestigationPanel.test.tsx
```

Expected: fails because the Entities tab and components do not exist.

- [ ] **Step 3: Implement `EntitiesTenantList`**

Props:

```ts
type TenantSort = "impact" | "usage" | "errors" | "llmCost" | "recent";

type Props = {
  tenants: TenantSummary[];
  selectedTenantId?: string;
  sort: TenantSort;
  onSortChange: (sort: TenantSort) => void;
  onSelectTenant: (tenant: TenantSummary) => void;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
};
```

Behavior:

- Show buttons `Impact`, `Usage`, `Errors`, `LLM cost`, `Recent`.
- Sort client-side by the selected sort, with `label` ascending as the final tie-breaker.
- Render `Unassigned` as a disabled button with `aria-disabled="true"` and no selection callback.
- Empty text: `No tenant activity in this window.`
- Error text: `Tenant activity is unavailable.`
- Retry button text: `Retry`.

- [ ] **Step 4: Implement `EntitiesTenantDetail`**

Props:

```ts
type Props = {
  tenant?: TenantSummary;
  detail?: TenantDetailResponse;
  draftUserId: string;
  appliedUserId: string;
  signalType: EntitySignalType | "";
  loading: boolean;
  error: boolean;
  onDraftUserIdChange: (value: string) => void;
  onApplyUserId: () => void;
  onSignalTypeChange: (value: EntitySignalType | "") => void;
  onRetry: () => void;
  onTimelineDrilldown: (row: TenantTimelineRow) => void;
};
```

Behavior:

- No selection text: `Select a tenant to inspect recent activity.`
- Error text: `Tenant detail is unavailable.`
- Empty timeline text: `No timeline rows match the current filters.`
- User filter label: `User`
- Apply button text: `Apply`
- Signal filter label: `Signal`
- Signal options: `All signals`, `Events`, `Errors`, `Traces`, `LLM`
- Summary cards: Events, Errors, Failed traces, LLM calls, LLM cost, Active users, Active sessions, Last seen.
- Top users table columns: User, Events, Errors, Traces, LLM, Cost, Last seen.
- Timeline row buttons call `onTimelineDrilldown(row)`.

- [ ] **Step 5: Implement `EntitiesInvestigationPanel`**

State:

```ts
const [windowValue, setWindowValue] = useState<EntityWindow>("7d");
const [searchDraft, setSearchDraft] = useState("");
const [appliedSearch, setAppliedSearch] = useState("");
const [sort, setSort] = useState<TenantSort>("impact");
const [selectedTenantId, setSelectedTenantId] = useState<string | undefined>(initialTenantId);
const [draftUserId, setDraftUserId] = useState("");
const [appliedUserId, setAppliedUserId] = useState("");
const [signalType, setSignalType] = useState<EntitySignalType | "">("");
```

Required behavior:

- Load tenant list on mount and when project, environment, window, applied search, or retry token changes.
- Default query: `{ projectId, environmentId, window: "7d", limit: 50 }`.
- Load detail only when `selectedTenantId` is set and not `_unassigned`.
- Reset selected detail on project or environment changes.
- Ignore stale list/detail responses with a monotonically increasing request id stored in `useRef`.
- Search applies to list only after `Apply`.
- User applies to detail only after `Apply`.
- Signal type changes detail immediately.
- If `initialTenantId` changes to a truthy value, select that tenant and load detail.
- Render window buttons `24h`, `7d`, `30d`.

- [ ] **Step 6: Add Entities tab to workspace**

In `InvestigationWorkspace.tsx`:

```ts
import { EntitiesInvestigationPanel } from "./EntitiesInvestigationPanel";
```

Change:

```ts
export type InvestigationTab = "events" | "errors" | "traces" | "llm" | "entities";
```

Extend initial filters:

```ts
entities?: { tenantId?: string };
```

Add nav button:

```tsx
<button aria-pressed={activeTab === "entities"} onClick={() => setActiveTab("entities")} type="button">
  Entities
</button>
```

Render:

```tsx
{activeTab === "entities" ? (
  <EntitiesInvestigationPanel
    client={client}
    environmentId={environmentId}
    initialTenantId={initialFilters?.entities?.tenantId}
    projectId={projectId}
  />
) : null}
```

Task 6 adds the `onDrilldown` prop after raw tab filter plumbing exists.

- [ ] **Step 7: Add styles**

In `styles.css`, add:

```css
.entities-layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 1rem;
}

.entity-tenant-list,
.entity-detail {
  min-width: 0;
}

.entity-tenant-row,
.entity-timeline-row {
  width: 100%;
  text-align: left;
}

.entity-tenant-row[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.65;
}

.entity-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.75rem;
}

@media (max-width: 860px) {
  .entities-layout {
    grid-template-columns: 1fr;
  }
}
```

Use existing color, border, panel, button, and muted text tokens from the surrounding CSS. Keep cards at the same radius as existing console cards.

- [ ] **Step 8: Run UI tests**

Run:

```bash
pnpm --filter @signal-hub/console test -- InvestigationWorkspace.test.tsx EntitiesInvestigationPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit UI shell**

Run:

```bash
git add apps/console/src/components/EntitiesInvestigationPanel.tsx apps/console/src/components/EntitiesTenantList.tsx apps/console/src/components/EntitiesTenantDetail.tsx apps/console/src/components/EntitiesInvestigationPanel.test.tsx apps/console/src/components/InvestigationWorkspace.tsx apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/styles.css
git commit -m "feat: add entities investigation view"
```

## Task 6: Drilldowns and Trace Initial Filters

**Files:**

- Modify: `apps/console/src/components/TraceInvestigationPanel.tsx`
- Modify: `apps/console/src/components/TraceInvestigationPanel.test.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.tsx`
- Modify: `apps/console/src/components/OverviewDashboard.tsx`
- Modify: `apps/console/src/components/OverviewTopLists.tsx`
- Modify: `apps/console/src/components/OverviewDashboard.test.tsx`
- Modify: `apps/console/src/components/ConsoleShell.tsx`
- Modify: `apps/console/src/components/EntitiesInvestigationPanel.tsx`

- [ ] **Step 1: Add failing drilldown tests**

In `TraceInvestigationPanel.test.tsx`, add:

```ts
it("applies initial trace filters", async () => {
  const api = apiClientWithTraceFixtures();

  render(
    <TraceInvestigationPanel
      client={api}
      environmentId="env_1"
      initialFilters={{ tenantId: "tenant_1", traceId: "trace_1" }}
      projectId="prj_1"
    />
  );

  await waitFor(() =>
    expect(api.listTraces).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "prj_1", environmentId: "env_1", tenantId: "tenant_1", traceId: "trace_1" })
    )
  );
  expect(screen.getByLabelText("Tenant")).toHaveValue("tenant_1");
  expect(screen.getByLabelText("Trace")).toHaveValue("trace_1");
});
```

In `EntitiesInvestigationPanel.test.tsx`, add:

```ts
it("drills timeline rows into raw investigation tabs with exact filters", async () => {
  const onDrilldown = vi.fn();
  const api = apiClientWithEntityFixtures({
    timeline: [
      { type: "error", id: "err_1", timestamp: "2026-05-05T11:00:00.000Z", label: "Failed", userId: "user_1", sessionId: "session_1", traceId: "trace_1", severity: "error", status: "open", message: "Failed" },
      { type: "trace", id: "trc_1", timestamp: "2026-05-05T10:59:00.000Z", label: "Checkout", userId: "user_1", sessionId: "session_1", traceId: "trace_1", status: "error", durationMs: 1000, name: "Checkout" }
    ]
  });

  render(<EntitiesInvestigationPanel client={api} environmentId="env_1" onDrilldown={onDrilldown} projectId="prj_1" />);
  await userEvent.click(await screen.findByRole("button", { name: /tenant_alpha/i }));
  await userEvent.click(await screen.findByRole("button", { name: /Failed/i }));
  expect(onDrilldown).toHaveBeenCalledWith({ tab: "errors", filters: { tenantId: "tenant_alpha", severity: "error", status: "open", traceId: "trace_1" } });

  await userEvent.click(await screen.findByRole("button", { name: /Checkout/i }));
  expect(onDrilldown).toHaveBeenCalledWith({ tab: "traces", filters: { tenantId: "tenant_alpha", traceId: "trace_1" } });
});
```

In `OverviewDashboard.test.tsx`, update tenant top-list drilldown assertions to expect:

```ts
{ tab: "entities", filters: { tenantId: "tenant_1" } }
```

- [ ] **Step 2: Run console tests and confirm failure**

Run:

```bash
pnpm --filter @signal-hub/console test -- TraceInvestigationPanel.test.tsx EntitiesInvestigationPanel.test.tsx OverviewDashboard.test.tsx
```

Expected: fails because trace initial filters and Entities drilldown plumbing are incomplete.

- [ ] **Step 3: Add trace initial filter support**

In `TraceInvestigationPanel.tsx`, import `TraceFilterValues`, extend props, and initialize state from `initialFilters`:

```ts
type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
  initialFilters?: Partial<TraceFilterValues>;
};
```

Use the same pattern as `EventInvestigationPanel`: apply `initialFilters` when they change and include them in the initial query.

In `InvestigationWorkspace.tsx`, extend `InvestigationInitialFilters`:

```ts
traces?: Partial<TraceFilterValues>;
```

Pass:

```tsx
<TraceInvestigationPanel client={client} environmentId={environmentId} initialFilters={initialFilters?.traces} projectId={projectId} />
```

- [ ] **Step 4: Define investigation drilldown union**

In `InvestigationWorkspace.tsx`, add:

```ts
export type InvestigationDrilldown =
  | { tab: "events"; filters: Partial<EventFilterValues> }
  | { tab: "errors"; filters: Partial<ErrorFilterValues> }
  | { tab: "traces"; filters: Partial<TraceFilterValues> }
  | { tab: "llm"; filters: Partial<LlmFilterValues> };
```

Use this union as the `onDrilldown` prop type for `EntitiesInvestigationPanel`.

Handle drilldowns:

```ts
function handleEntityDrilldown(drilldown: InvestigationDrilldown) {
  setActiveTab(drilldown.tab);
  setLocalInitialFilters((current) => ({ ...current, [drilldown.tab]: drilldown.filters }));
}
```

Merge `initialFilters` from props with `localInitialFilters` before passing filters to child panels.

- [ ] **Step 5: Map timeline rows to raw tab filters**

In `EntitiesInvestigationPanel.tsx`, implement:

```ts
function toInvestigationDrilldown(tenantId: string, row: TenantTimelineRow): InvestigationDrilldown {
  if (row.type === "event") {
    return { tab: "events", filters: { tenantId, eventName: row.eventName, ...(row.traceId ? { traceId: row.traceId } : {}) } };
  }
  if (row.type === "error") {
    return { tab: "errors", filters: { tenantId, severity: row.severity, status: row.status, ...(row.traceId ? { traceId: row.traceId } : {}) } };
  }
  if (row.type === "trace") {
    return { tab: "traces", filters: { tenantId, ...(row.traceId ? { traceId: row.traceId } : {}) } };
  }
  return {
    tab: "llm",
    filters: {
      tenantId,
      provider: row.provider,
      model: row.model,
      status: row.status,
      ...(row.promptName && row.promptName !== "Unspecified" ? { promptName: row.promptName } : {})
    }
  };
}
```

The timeline button callback must no-op when no selected tenant exists.

- [ ] **Step 6: Route overview tenant rows to Entities**

In `OverviewDashboard.tsx`, extend:

```ts
export type OverviewDrilldown =
  | { tab: "events"; filters: { eventName?: string; tenantId?: string } }
  | { tab: "errors"; filters: { severity?: string; status?: string; tenantId?: string } }
  | { tab: "llm"; filters: { provider?: string; model?: string; promptName?: string; tenantId?: string } }
  | { tab: "entities"; filters: { tenantId: string } };
```

In `OverviewTopLists.tsx`, change tenant list rows:

```ts
drilldown: { tab: "entities", filters: { tenantId: row.tenantId } }
```

Apply this to tenants by usage, errors, LLM calls, and LLM cost.

In `ConsoleShell.tsx`, when handling overview drilldowns, send `entities` to `InvestigationWorkspace` with `initialTab: "entities"` and `initialFilters: { entities: { tenantId } }`.

- [ ] **Step 7: Run drilldown tests**

Run:

```bash
pnpm --filter @signal-hub/console test -- TraceInvestigationPanel.test.tsx EntitiesInvestigationPanel.test.tsx OverviewDashboard.test.tsx InvestigationWorkspace.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit drilldowns**

Run:

```bash
git add apps/console/src/components/TraceInvestigationPanel.tsx apps/console/src/components/TraceInvestigationPanel.test.tsx apps/console/src/components/InvestigationWorkspace.tsx apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/OverviewDashboard.tsx apps/console/src/components/OverviewTopLists.tsx apps/console/src/components/OverviewDashboard.test.tsx apps/console/src/components/ConsoleShell.tsx apps/console/src/components/EntitiesInvestigationPanel.tsx apps/console/src/components/EntitiesInvestigationPanel.test.tsx
git commit -m "feat: connect entity investigation drilldowns"
```

## Task 7: Documentation and Final Verification

**Files:**

- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify if structural context changed: `CLAUDE.md`
- Modify: `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`

- [ ] **Step 1: Update architecture docs**

Add to `.claude/docs/ARCHITECTURE.md`:

```md
## Entity Investigation Queries

The console exposes tenant entity investigation through authenticated human-session query routes under `/query/entities/tenants`.

- `GET /query/entities/tenants` returns impact-ranked tenant summaries for a project/environment/window.
- `GET /query/entities/tenants/:tenantKey` returns a selected tenant summary, top users, and a cursor-paginated timeline.
- The repository boundary is `packages/db/src/repositories/entities-query.ts`.
- Entity queries use existing `events`, `errors`, `traces`, and `llm_calls` tables only.
- Spans remain available through trace detail and are excluded from entity timelines.
```

- [ ] **Step 2: Update UI docs**

Add to `.claude/docs/UI-UX.md`:

```md
## Entities Investigation

`Investigate -> Entities` is a tenant-first investigation view. It defaults to a 7-day window, shows impact-ranked tenant rows, keeps `Unassigned` visible but disabled, and loads a right-side tenant detail with summary metrics, top users, and a cross-signal timeline.

Timeline rows drill into the raw Events, Errors, Traces, and LLM investigation tabs with exact filters.
```

- [ ] **Step 3: Update project summary and memory**

Add a concise phase note to `.claude/docs/PROJECT-SUMMARY.md` and the versioned memory file:

```md
- Added tenant-first Entities investigation: impact-ranked tenant summaries, selected tenant top users, and cross-signal timeline drilldowns.
```

Only update `CLAUDE.md` if the repository structure or developer workflow section needs the new entity repository called out.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm test
pnpm build
docker compose config --quiet
```

Expected: all pass.

- [ ] **Step 5: Run visual verification**

Start the console:

```bash
/Users/diogo/.codex/superpowers/skills/brainstorming/scripts/start-server.sh --project-dir /Users/diogo/Developer/Github/SignalHub --start-command "pnpm dev:console" --port 5173
```

Use Playwright CLI to verify:

- Desktop viewport `1440x1000`.
- Mobile viewport `390x900`.
- Navigate to the console, open `Investigate -> Entities`.
- Confirm no horizontal overflow.
- Confirm tenant list and detail columns stack on mobile.
- Confirm text fits inside buttons and rows.
- Confirm `Unassigned` is visibly disabled.

Stop the server after screenshots:

```bash
/Users/diogo/.codex/superpowers/skills/brainstorming/scripts/stop-server.sh --project-dir /Users/diogo/Developer/Github/SignalHub
```

- [ ] **Step 6: Commit docs**

Run:

```bash
git add .claude/docs/ARCHITECTURE.md .claude/docs/UI-UX.md .claude/docs/PROJECT-SUMMARY.md CLAUDE.md
git commit -m "docs: document entities investigation"
```

If `CLAUDE.md` did not change, remove it from the `git add` command before committing.

- [ ] **Step 7: Commit versioned memory in config repo**

Run:

```bash
git -C /Users/diogo/Developer/Github/claude-config add projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
git -C /Users/diogo/Developer/Github/claude-config commit -m "docs: update SignalHub memory"
git -C /Users/diogo/Developer/Github/claude-config push origin main
```

Expected: config repo memory update is pushed.

- [ ] **Step 8: Push SignalHub**

Run:

```bash
git status -sb
git push origin main
```

Expected: `main` is pushed to `origin/main` with all Entities commits.

## Final Acceptance Checklist

- [ ] `GET /query/entities/tenants` returns `7d` by default, caps `limit` at `100`, supports `24h`, `7d`, `30d`, trims search, and returns `{ data: TenantListResponse }`.
- [ ] `GET /query/entities/tenants/:tenantKey` rejects `_unassigned`, rejects invalid cursor payloads, filters by `user_id` and `signal_type`, and returns `{ data: TenantDetailResponse }`.
- [ ] Tenant summaries aggregate events, errors, traces, and LLM calls with deterministic impact ranking.
- [ ] `Unassigned` summary appears for null tenant activity and cannot be selected in the UI.
- [ ] Timeline includes events, errors, traces, and LLM calls only.
- [ ] Timeline rows do not include event properties, error context, LLM previews, span input/output, or span rows.
- [ ] Timeline cursor uses `timestamp`, `type`, and `id` with the required ordering.
- [ ] Entities tab loads only while active and defaults to `7d`.
- [ ] User filter applies only after `Apply`.
- [ ] Signal filter updates selected tenant detail.
- [ ] Stale list and detail responses are ignored.
- [ ] Timeline drilldowns switch to existing raw investigation tabs with exact filters.
- [ ] Overview tenant rows open the Entities tab for assigned tenants.
- [ ] `pnpm test`, `pnpm build`, and `docker compose config --quiet` pass.
- [ ] Desktop and mobile visual checks pass.
