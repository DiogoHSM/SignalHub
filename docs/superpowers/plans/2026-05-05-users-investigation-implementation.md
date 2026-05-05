# Users Investigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only `Investigate -> Users` user investigation view with impact-ranked user summaries, recent sessions, and a cursor-paginated cross-signal timeline.

**Architecture:** Add two authenticated query endpoints backed by a focused DB repository module, then expose them through the console API client and a new lazy-loaded Users investigation tab. The DB layer uses existing telemetry tables only, computes UTC fixed windows, keeps anonymous activity visible in summaries, and excludes spans from the user timeline.

**Tech Stack:** TypeScript, Fastify, Zod, Kysely, PostgreSQL, React, Vitest, Testing Library, Playwright CLI for visual verification.

---

## Source Documents

- Design spec: `docs/superpowers/specs/2026-05-05-users-investigation-design.md`
- Closest implementation pattern: `docs/superpowers/specs/2026-05-05-entities-investigation-design.md`
- API route patterns: `apps/api/src/routes/query.ts`
- API route tests: `apps/api/test/query.test.ts`
- DB entity query pattern: `packages/db/src/repositories/entities-query.ts`
- DB test harness: `packages/db/test/repositories.test.ts`
- Console client patterns: `apps/console/src/api/client.ts`, `apps/console/src/api/types.ts`, `apps/console/src/api/client.test.ts`
- Investigation UI patterns: `apps/console/src/components/EntitiesInvestigationPanel.tsx`, `EntitiesTenantList.tsx`, `EntitiesTenantDetail.tsx`, `InvestigationWorkspace.tsx`
- Existing raw tab filter types: `EventFilters.tsx`, `ErrorFilters.tsx`, `TraceFilters.tsx`, `LlmFilters.tsx`
- Styles: `apps/console/src/styles.css`

## File Structure

Create:

- `packages/db/src/repositories/users-query.ts`: user query types, UTC window calculation, impact scoring, user summary aggregation, recent-session aggregation, timeline cursor encode/decode helpers, user timeline query.
- `apps/console/src/components/UsersInvestigationPanel.tsx`: owns Users tab state, list/detail loading, stale response protection, retry, filters, pagination, and drilldown callbacks.
- `apps/console/src/components/UsersUserList.tsx`: user list rendering, disabled anonymous row, view-level sort controls, empty and unavailable list states.
- `apps/console/src/components/UsersUserDetail.tsx`: selected user summary cards, recent sessions, timeline filters, timeline rows, pagination controls, empty and unavailable detail states.
- `apps/console/src/components/UsersInvestigationPanel.test.tsx`: UI behavior for the new tab and drilldowns.

Modify:

- `apps/api/src/routes/query.ts`: add user route types, parsers, dependency methods, handlers, and routes.
- `apps/api/src/main.ts`: wire user repository functions into query dependencies.
- `apps/api/test/query.test.ts`: route contract tests for user list/detail endpoints.
- `apps/api/test/e2e.test.ts`: keep query dependency wiring aligned with `apps/api/src/main.ts`.
- `packages/db/test/repositories.test.ts`: repository tests for user summaries, recent sessions, detail timeline, cursor behavior, UTC windows, search, tenant filters, and span exclusion.
- `apps/console/src/api/types.ts`: shared client-side user query and response types.
- `apps/console/src/api/client.ts`: add `listUsersActivity` and `getUserDetail`.
- `apps/console/src/api/client.test.ts`: verify user query URL encoding.
- `apps/console/src/components/InvestigationWorkspace.tsx`: add the `Users` tab and user drilldown plumbing.
- Existing console tests that strongly mock `ApiClient`: add inert `listUsersActivity` and `getUserDetail` mocks.
- `apps/console/src/styles.css`: add responsive Users layout styles or reuse generic entity styles through shared class selectors.
- `.claude/docs/ARCHITECTURE.md`: document user query endpoints and repository boundary.
- `.claude/docs/UI-UX.md`: document Users investigation screen behavior.
- `.claude/docs/PROJECT-SUMMARY.md`: mention user investigation.
- `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`: record the implemented phase after verification.

Do not modify:

- Database migrations.
- Telemetry write APIs.
- Authentication or permission model.
- Span query behavior except confirming spans are excluded from Users.

## Shared Contracts

Use these names consistently across API, DB, and console layers:

```ts
export type UserWindow = "24h" | "7d" | "30d";
export type UserSignalType = "event" | "error" | "trace" | "llm";

export type UserCursor = {
  timestamp: string;
  type: UserSignalType;
  id: string;
};

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

- [ ] **Step 1: Add failing user route tests**

Add these tests inside `describe("query routes", ...)` in `apps/api/test/query.test.ts` near the entity route tests:

```ts
it("forwards default user list filters", async () => {
  const receivedFilters: unknown[] = [];

  app = await buildApp({
    readiness,
    auth: humanAuth,
    query: {
      listUsersActivity: async (filters) => {
        receivedFilters.push(filters);
        return {
          window: "7d",
          generatedAt: "2026-05-05T12:00:00.000Z",
          scope: { projectId: "prj_1", environmentId: "env_1" },
          range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
          users: []
        };
      }
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/query/users?project_id=prj_1&environment_id=env_1"
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    data: {
      window: "7d",
      generatedAt: "2026-05-05T12:00:00.000Z",
      scope: { projectId: "prj_1", environmentId: "env_1" },
      range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
      users: []
    }
  });
  expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", window: "7d", limit: 50 }]);
});

it("forwards explicit user list filters", async () => {
  const receivedFilters: unknown[] = [];

  app = await buildApp({
    readiness,
    auth: humanAuth,
    query: {
      listUsersActivity: async (filters) => {
        receivedFilters.push(filters);
        return {
          window: "30d",
          generatedAt: "2026-05-05T12:00:00.000Z",
          scope: { projectId: "prj_1", environmentId: "env_1" },
          range: { from: "2026-04-05T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
          users: []
        };
      }
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/query/users?project_id=prj_1&environment_id=env_1&window=30d&search=%20user_1%20&tenant_id=%20tenant_1%20&limit=500"
  });

  expect(response.statusCode).toBe(200);
  expect(receivedFilters).toEqual([
    { projectId: "prj_1", environmentId: "env_1", window: "30d", search: "user_1", tenantId: "tenant_1", limit: 100 }
  ]);
});

it("rejects unsupported user windows", async () => {
  app = await buildApp({
    readiness,
    auth: humanAuth,
    query: {
      listUsersActivity: async () => {
        throw new Error("should not run");
      }
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/query/users?project_id=prj_1&environment_id=env_1&window=custom"
  });

  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: "invalid_query" });
});

it("forwards user detail filters and decoded cursor", async () => {
  const receivedFilters: unknown[] = [];
  const cursor = Buffer.from(JSON.stringify({ timestamp: "2026-05-05T11:00:00.000Z", type: "error", id: "err_1" })).toString("base64url");

  app = await buildApp({
    readiness,
    auth: humanAuth,
    query: {
      getUserDetail: async (userId, filters) => {
        receivedFilters.push({ userId, filters });
        return {
          window: "24h",
          generatedAt: "2026-05-05T12:00:00.000Z",
          scope: { projectId: "prj_1", environmentId: "env_1" },
          range: { from: "2026-05-04T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
          user: {
            userId: "user/one",
            label: "user/one",
            isAnonymous: false,
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
            activeTenants: 0,
            activeSessions: 0
          },
          recentSessions: [],
          timeline: []
        };
      }
    }
  });

  const response = await app.inject({
    method: "GET",
    url: `/query/users/${encodeURIComponent("user/one")}?project_id=prj_1&environment_id=env_1&window=24h&tenant_id=tenant_1&signal_type=error&limit=25&cursor=${cursor}`
  });

  expect(response.statusCode).toBe(200);
  expect(receivedFilters).toEqual([
    {
      userId: "user/one",
      filters: {
        projectId: "prj_1",
        environmentId: "env_1",
        window: "24h",
        tenantId: "tenant_1",
        signalType: "error",
        limit: 25,
        cursor: { timestamp: "2026-05-05T11:00:00.000Z", type: "error", id: "err_1" }
      }
    }
  ]);
});

it("rejects anonymous and invalid user detail cursors", async () => {
  app = await buildApp({
    readiness,
    auth: humanAuth,
    query: {
      getUserDetail: async () => {
        throw new Error("should not run");
      }
    }
  });

  const anonymousResponse = await app.inject({
    method: "GET",
    url: "/query/users/_anonymous?project_id=prj_1&environment_id=env_1"
  });
  expect(anonymousResponse.statusCode).toBe(400);
  expect(anonymousResponse.json()).toEqual({ error: "invalid_query" });

  const invalidCursorResponse = await app.inject({
    method: "GET",
    url: "/query/users/user_1?project_id=prj_1&environment_id=env_1&cursor=not-json"
  });
  expect(invalidCursorResponse.statusCode).toBe(400);
  expect(invalidCursorResponse.json()).toEqual({ error: "invalid_query" });
});
```

- [ ] **Step 2: Run the API test subset and confirm failure**

Run:

```bash
pnpm exec vitest run apps/api/test/query.test.ts
```

Expected: fails because `listUsersActivity` and `getUserDetail` are not part of `QueryDependencies`, and the `/query/users` routes do not exist.

- [ ] **Step 3: Add user route types and parsers**

In `apps/api/src/routes/query.ts`, add exports next to entity exports:

```ts
export type UserWindow = "24h" | "7d" | "30d";
export type UserSignalType = "event" | "error" | "trace" | "llm";

export type UserCursor = {
  timestamp: string;
  type: UserSignalType;
  id: string;
};

export type UserListFilters = {
  projectId: string;
  environmentId: string;
  window: UserWindow;
  search?: string;
  tenantId?: string;
  limit: number;
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
```

Extend `QueryDependencies`:

```ts
listUsersActivity?: (filters: UserListFilters) => Promise<unknown>;
getUserDetail?: (userId: string, filters: UserDetailFilters) => Promise<unknown>;
```

Add parser helpers mirroring the entity helpers, using `window`, `tenant_id`, `signal_type`, `limit`, and `cursor`:

```ts
function parseUserWindow(raw: RawQuery): UserWindow | undefined {
  const rawWindow = optionalNonEmpty(raw, "window") ?? "7d";
  if (rawWindow === "24h" || rawWindow === "7d" || rawWindow === "30d") return rawWindow;
  return undefined;
}

function parseUserLimit(raw: RawQuery): number {
  const value = optionalNonEmpty(raw, "limit");
  if (!value) return 50;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  const integer = Math.floor(parsed);
  if (integer < 1) return 1;
  return Math.min(integer, 100);
}

function parseUserSignalType(raw: RawQuery): UserSignalType | undefined | null {
  const value = optionalNonEmpty(raw, "signal_type");
  if (!value) return undefined;
  if (value === "event" || value === "error" || value === "trace" || value === "llm") return value;
  return null;
}

function parseUserCursor(raw: RawQuery): UserCursor | undefined | null {
  const value = optionalNonEmpty(raw, "cursor");
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<UserCursor>;
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

function parseUserListFilters(query: unknown): UserListFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  const window = parseUserWindow(raw);
  if (!projectId || !environmentId || !window) return undefined;

  const filters: UserListFilters = { projectId, environmentId, window, limit: parseUserLimit(raw) };
  const search = optionalNonEmpty(raw, "search");
  const tenantId = optionalNonEmpty(raw, "tenant_id");
  if (search) filters.search = search;
  if (tenantId) filters.tenantId = tenantId;
  return filters;
}

function parseUserDetailFilters(query: unknown): UserDetailFilters | undefined {
  const raw = (query ?? {}) as RawQuery;
  const projectId = parseRequiredId(raw, "project_id");
  const environmentId = parseRequiredId(raw, "environment_id");
  const window = parseUserWindow(raw);
  const signalType = parseUserSignalType(raw);
  const cursor = parseUserCursor(raw);
  if (!projectId || !environmentId || !window || signalType === null || cursor === null) return undefined;

  const filters: UserDetailFilters = { projectId, environmentId, window, limit: parseUserLimit(raw) };
  const tenantId = optionalNonEmpty(raw, "tenant_id");
  if (tenantId) filters.tenantId = tenantId;
  if (signalType) filters.signalType = signalType;
  if (cursor) filters.cursor = cursor;
  return filters;
}
```

- [ ] **Step 4: Add user route handlers and routes**

Add:

```ts
const userParamsSchema = z.object({ userKey: z.string().trim().min(1) });

async function handleUserListRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) return reply;

  if (!options.query?.listUsersActivity) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const filters = parseUserListFilters(request.query);
  if (!filters) return reply.status(400).send({ error: "invalid_query" });

  try {
    return reply.send({ data: await options.query.listUsersActivity(filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}

async function handleUserDetailRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) return reply;

  if (!options.query?.getUserDetail) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = userParamsSchema.safeParse(request.params);
  const filters = parseUserDetailFilters(request.query);
  if (!params.success || !filters || params.data.userKey === "_anonymous") {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    return reply.send({ data: await options.query.getUserDetail(params.data.userKey, filters) });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}
```

Register the routes after the entity routes:

```ts
app.get("/query/users", (request, reply) => handleUserListRoute(request, reply, options));
app.get("/query/users/:userKey", (request, reply) => handleUserDetailRoute(request, reply, options));
```

- [ ] **Step 5: Run API tests**

Run:

```bash
pnpm exec vitest run apps/api/test/query.test.ts
```

Expected: PASS for `apps/api/test/query.test.ts`.

- [ ] **Step 6: Commit API route contract**

Run:

```bash
git add apps/api/src/routes/query.ts apps/api/test/query.test.ts
git commit -m "feat: add users query routes"
```

## Task 2: DB User Summaries

**Files:**

- Create: `packages/db/src/repositories/users-query.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Add failing summary tests**

In `packages/db/test/repositories.test.ts`, import the new repository:

```ts
import { listUsersActivity } from "../src/repositories/users-query.js";
```

Add these tests near the entity repository tests:

```ts
it("lists users by deterministic impact score", async () => {
  await withDb(async (db) => {
    await migrate(db);
    const project = await createProject(db, { name: "Users Summary" });
    const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
    const now = new Date("2026-05-05T12:00:00.000Z");

    await insertEvent(db, {
      id: "evt_user_alpha",
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
      id: "err_user_alpha",
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
      id: "trc_user_alpha",
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
      id: "llm_user_alpha",
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
      id: "evt_user_anonymous",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:59:00.000Z"),
      receivedAt: new Date("2026-05-05T11:59:01.000Z"),
      name: "anonymous.activity",
      tenantId: "tenant_alpha",
      userId: null,
      sessionId: "anonymous_session",
      traceId: null,
      source: null,
      release: null,
      metadata: {},
      properties: {}
    });

    const result = await listUsersActivity(db, { projectId: project.id, environmentId: environment.id, window: "7d", limit: 50, now });

    expect(result.window).toBe("7d");
    expect(result.range).toEqual({ from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" });
    expect(result.users.map((user) => user.label)).toEqual(["user_alpha", "Anonymous / Unassigned"]);
    expect(result.users[0]).toMatchObject({
      userId: "user_alpha",
      isAnonymous: false,
      events: 1,
      errors: 1,
      openErrors: 1,
      severeErrors: 1,
      traces: 1,
      failedTraces: 1,
      llmCalls: 1,
      failedLlmCalls: 1,
      llmCostUsd: "12.500000",
      activeTenants: 1,
      activeSessions: 1,
      lastSeenAt: "2026-05-05T11:58:00.000Z"
    });
    expect(result.users[0].impactScore).toBe(39.125);
    expect(result.users[1]).toMatchObject({ userId: null, label: "Anonymous / Unassigned", isAnonymous: true, events: 1 });
  });
});

it("searches users by user id, tenant id, or session id and filters by tenant", async () => {
  await withDb(async (db) => {
    await migrate(db);
    const project = await createProject(db, { name: "Users Search" });
    const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
    const now = new Date("2026-05-05T12:00:00.000Z");

    await insertEvent(db, {
      id: "evt_user_search_one",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T10:00:00.000Z"),
      receivedAt: new Date("2026-05-05T10:00:01.000Z"),
      name: "user.match",
      tenantId: "tenant_match",
      userId: "user_match",
      sessionId: "session_match",
      traceId: null,
      source: null,
      release: null,
      metadata: {},
      properties: {}
    });
    await insertEvent(db, {
      id: "evt_user_search_other",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T10:01:00.000Z"),
      receivedAt: new Date("2026-05-05T10:01:01.000Z"),
      name: "other.user",
      tenantId: "tenant_other",
      userId: "user_other",
      sessionId: "session_other",
      traceId: null,
      source: null,
      release: null,
      metadata: {},
      properties: {}
    });

    const bySession = await listUsersActivity(db, {
      projectId: project.id,
      environmentId: environment.id,
      window: "7d",
      search: "session_match",
      limit: 50,
      now
    });
    expect(bySession.users.map((user) => user.userId)).toEqual(["user_match"]);

    const byTenant = await listUsersActivity(db, {
      projectId: project.id,
      environmentId: environment.id,
      window: "7d",
      tenantId: "tenant_other",
      limit: 50,
      now
    });
    expect(byTenant.users.map((user) => user.userId)).toEqual(["user_other"]);
  });
});
```

- [ ] **Step 2: Run DB tests and confirm failure**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts
```

Expected: fails because `packages/db/src/repositories/users-query.ts` does not exist.

- [ ] **Step 3: Create user query repository types and summary implementation**

Create `packages/db/src/repositories/users-query.ts` with the shared contracts. Implement:

```ts
export async function listUsersActivity(db: Db, filters: UserListFilters): Promise<UserListResponse>
```

Use a `with scoped_events/scoped_errors/scoped_traces/scoped_llm_calls` SQL union, grouped by `user_id`. Use `count(distinct tenant_id) filter (where tenant_id is not null)` for `activeTenants`, `count(distinct session_id) filter (where session_id is not null)` for `activeSessions`, and `coalesce(sum(llm_cost_usd), 0)::text` for `llmCostUsd`.

Sort in JavaScript after mapping:

```ts
users.sort((left, right) => {
  if (right.impactScore !== left.impactScore) return right.impactScore - left.impactScore;
  const rightSeen = right.lastSeenAt ? new Date(right.lastSeenAt).getTime() : 0;
  const leftSeen = left.lastSeenAt ? new Date(left.lastSeenAt).getTime() : 0;
  if (rightSeen !== leftSeen) return rightSeen - leftSeen;
  if (right.events !== left.events) return right.events - left.events;
  return left.label.localeCompare(right.label);
});
```

The anonymous label helper must be:

```ts
function userLabel(userId: string | null): string {
  return userId ?? "Anonymous / Unassigned";
}
```

- [ ] **Step 4: Run DB tests**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts
```

Expected: PASS for repository tests.

- [ ] **Step 5: Commit DB user summaries**

Run:

```bash
git add packages/db/src/repositories/users-query.ts packages/db/test/repositories.test.ts
git commit -m "feat: add user activity summaries"
```

## Task 3: DB User Detail and API Wiring

**Files:**

- Modify: `packages/db/src/repositories/users-query.ts`
- Modify: `packages/db/test/repositories.test.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/test/e2e.test.ts`
- Modify: `vitest.config.ts` if a test alias is needed for repository imports.

- [ ] **Step 1: Add failing detail tests**

In `packages/db/test/repositories.test.ts`, extend the import:

```ts
import { getUserDetail, listUsersActivity, type UserCursor } from "../src/repositories/users-query.js";
```

Add tests covering recent sessions, tenant filter, signal filter, cursor pagination, and span exclusion:

```ts
it("gets user detail with recent sessions and cross-signal timeline", async () => {
  await withDb(async (db) => {
    await migrate(db);
    const project = await createProject(db, { name: "User Detail" });
    const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
    const now = new Date("2026-05-05T12:00:00.000Z");

    await insertEvent(db, {
      id: "evt_user_detail",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:50:00.000Z"),
      receivedAt: new Date("2026-05-05T11:50:01.000Z"),
      name: "checkout.started",
      tenantId: "tenant_alpha",
      userId: "user_detail",
      sessionId: "session_alpha",
      traceId: "trace_alpha",
      source: null,
      release: null,
      metadata: {},
      properties: { hidden: true }
    });
    await insertError(db, {
      id: "err_user_detail",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:51:00.000Z"),
      receivedAt: new Date("2026-05-05T11:51:01.000Z"),
      message: "Checkout failed",
      type: null,
      severity: "error",
      stack: "hidden",
      status: "open",
      fingerprint: "checkout_failed",
      context: { hidden: true },
      tenantId: "tenant_alpha",
      userId: "user_detail",
      sessionId: "session_alpha",
      traceId: "trace_alpha",
      source: null,
      release: null,
      metadata: {}
    });
    await insertTrace(db, {
      id: "trc_user_detail",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:52:00.000Z"),
      receivedAt: new Date("2026-05-05T11:52:01.000Z"),
      name: "checkout",
      status: "success",
      startedAt: new Date("2026-05-05T11:52:00.000Z"),
      endedAt: new Date("2026-05-05T11:52:01.000Z"),
      durationMs: 1000,
      tenantId: "tenant_alpha",
      userId: "user_detail",
      sessionId: "session_alpha",
      traceId: "trace_alpha",
      source: null,
      release: null,
      metadata: {}
    });
    await insertLlmCall(db, {
      id: "llm_user_detail",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-05T11:53:00.000Z"),
      receivedAt: new Date("2026-05-05T11:53:01.000Z"),
      provider: "openai",
      model: "gpt-5",
      promptName: "cart.summary",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: "0.250000",
      latencyMs: 500,
      status: "ok",
      error: null,
      inputPreview: "hidden",
      outputPreview: "hidden",
      tenantId: "tenant_alpha",
      userId: "user_detail",
      sessionId: "session_beta",
      traceId: "trace_beta",
      source: null,
      release: null,
      metadata: {}
    });

    const result = await getUserDetail(db, "user_detail", {
      projectId: project.id,
      environmentId: environment.id,
      window: "7d",
      limit: 50,
      now
    });

    expect(result.user).toMatchObject({ userId: "user_detail", events: 1, errors: 1, traces: 1, llmCalls: 1, activeTenants: 1, activeSessions: 2 });
    expect(result.recentSessions.map((session) => session.sessionId)).toEqual(["session_beta", "session_alpha"]);
    expect(result.timeline.map((row) => `${row.type}:${row.id}`)).toEqual([
      "llm:llm_user_detail",
      "trace:trc_user_detail",
      "error:err_user_detail",
      "event:evt_user_detail"
    ]);
    expect(result.timeline[0]).not.toHaveProperty("inputPreview");
    expect(result.timeline[1]).not.toHaveProperty("metadata");
  });
});

it("filters user detail by tenant and signal type and paginates timeline", async () => {
  await withDb(async (db) => {
    await migrate(db);
    const project = await createProject(db, { name: "User Cursor" });
    const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
    const now = new Date("2026-05-05T12:00:00.000Z");

    for (const [id, timestamp, tenantId] of [
      ["evt_cursor_1", "2026-05-05T11:59:00.000Z", "tenant_cursor"],
      ["evt_cursor_2", "2026-05-05T11:58:00.000Z", "tenant_cursor"],
      ["evt_cursor_other", "2026-05-05T11:57:00.000Z", "tenant_other"]
    ] as const) {
      await insertEvent(db, {
        id,
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date(timestamp),
        receivedAt: new Date(timestamp),
        name: id,
        tenantId,
        userId: "user_cursor",
        sessionId: "session_cursor",
        traceId: null,
        source: null,
        release: null,
        metadata: {},
        properties: {}
      });
    }

    const firstPage = await getUserDetail(db, "user_cursor", {
      projectId: project.id,
      environmentId: environment.id,
      window: "7d",
      tenantId: "tenant_cursor",
      signalType: "event",
      limit: 1,
      now
    });
    expect(firstPage.timeline.map((row) => row.id)).toEqual(["evt_cursor_1"]);
    expect(firstPage.cursor).toEqual(expect.any(String));

    const secondPage = await getUserDetail(db, "user_cursor", {
      projectId: project.id,
      environmentId: environment.id,
      window: "7d",
      tenantId: "tenant_cursor",
      signalType: "event",
      limit: 1,
      cursor: decodeUserCursorForTest(firstPage.cursor!),
      now
    });
    expect(secondPage.timeline.map((row) => row.id)).toEqual(["evt_cursor_2"]);
    expect(secondPage.cursor).toBeUndefined();
  });
});

function decodeUserCursorForTest(cursor: string): UserCursor {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as UserCursor;
}
```

- [ ] **Step 2: Run DB tests and confirm failure**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts
```

Expected: fails because `getUserDetail` is not implemented.

- [ ] **Step 3: Implement user detail repository**

In `packages/db/src/repositories/users-query.ts`, add:

```ts
export async function getUserDetail(db: Db, userId: string, filters: UserDetailFilters): Promise<UserDetailResponse>
```

Implementation requirements:

- Reject anonymous detail at the route layer, so repository can treat `userId` as a normal exact string.
- Compute exact user summary for the selected user and optional tenant filter. Do not reuse `listUsersActivity(...limit: 100)` to find the summary.
- Build `recentSessions` from all four signal tables, excluding null `session_id`, sorted by `lastSeenAt desc`, total signal count desc, `sessionId asc`, limited to 10.
- Build timeline from a union of events, errors, traces, and LLM calls only.
- Apply optional `tenantId`, optional `signalType`, and optional cursor.
- Fetch `limit + 1`, return first `limit`, and encode the next cursor from the last returned row when an extra row exists.

- [ ] **Step 4: Wire API main dependencies**

In `apps/api/src/main.ts`, import:

```ts
import { getUserDetail, listUsersActivity } from "@signal-hub/db/repositories/users-query.js";
```

Add to query dependencies:

```ts
listUsersActivity: (filters) => listUsersActivity(db, filters),
getUserDetail: (userId, filters) => getUserDetail(db, userId, filters)
```

If e2e tests import repository functions directly, add a Vitest alias in `vitest.config.ts`:

```ts
"@signal-hub/db/repositories/users-query.js": resolve(root, "packages/db/src/repositories/users-query.ts")
```

- [ ] **Step 5: Run backend verification**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts apps/api/test/query.test.ts apps/api/test/e2e.test.ts
pnpm --filter @signal-hub/db build
pnpm --filter @signal-hub/api build
```

Expected: all commands pass.

- [ ] **Step 6: Commit user detail and API wiring**

Run:

```bash
git add packages/db/src/repositories/users-query.ts packages/db/test/repositories.test.ts apps/api/src/main.ts apps/api/test/e2e.test.ts vitest.config.ts
git commit -m "feat: add user detail queries"
```

If `apps/api/test/e2e.test.ts` or `vitest.config.ts` did not change, omit those paths from `git add`.

## Task 4: Console User API Client

**Files:**

- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Modify: `apps/console/src/api/client.test.ts`
- Modify: existing console component tests with strong `ApiClient` mocks.

- [ ] **Step 1: Add failing client tests**

In `apps/console/src/api/client.test.ts`, add:

```ts
it("builds user list query URLs", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { users: [] } }));
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient("/api");
  await client.listUsersActivity({
    projectId: "prj_1",
    environmentId: "env_1",
    window: "30d",
    search: "user_1",
    tenantId: "tenant_1",
    limit: 25
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/query/users?project_id=prj_1&environment_id=env_1&window=30d&search=user_1&tenant_id=tenant_1&limit=25",
    expect.any(Object)
  );
});

it("builds encoded user detail query URLs", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { timeline: [] } }));
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient("/api");
  await client.getUserDetail("user/one", {
    projectId: "prj_1",
    environmentId: "env_1",
    window: "24h",
    tenantId: "tenant_1",
    signalType: "llm",
    limit: 10,
    cursor: "cursor_1"
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/query/users/user%2Fone?project_id=prj_1&environment_id=env_1&window=24h&tenant_id=tenant_1&signal_type=llm&limit=10&cursor=cursor_1",
    expect.any(Object)
  );
});
```

- [ ] **Step 2: Run client tests and confirm failure**

Run:

```bash
pnpm exec vitest run apps/console/src/api/client.test.ts
```

Expected: fails because user client methods and types do not exist.

- [ ] **Step 3: Add console user types**

In `apps/console/src/api/types.ts`, add the shared user types from this plan:

```ts
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

export type UserListResponse = { window: UserWindow; generatedAt: string; scope: { projectId: string; environmentId: string }; range: { from: string; to: string }; users: UserSummary[] };
export type UserDetailResponse = { window: UserWindow; generatedAt: string; scope: { projectId: string; environmentId: string }; range: { from: string; to: string }; user: UserSummary; recentSessions: UserRecentSession[]; timeline: UserTimelineRow[]; cursor?: string };
```

- [ ] **Step 4: Add console client methods**

In `apps/console/src/api/client.ts`, import user types and add methods to `ApiClient`:

```ts
listUsersActivity: (query: UserListQuery) => Promise<AggregateResponse<UserListResponse>>;
getUserDetail: (userId: string, query: UserDetailQuery) => Promise<AggregateResponse<UserDetailResponse>>;
```

Add path helpers:

```ts
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
```

Add implementation:

```ts
listUsersActivity: (query) => request<AggregateResponse<UserListResponse>>(path(apiBasePath, userListPath(query))),
getUserDetail: (userId, query) => request<AggregateResponse<UserDetailResponse>>(path(apiBasePath, userDetailPath(userId, query))),
```

- [ ] **Step 5: Update strict `ApiClient` mocks**

Run:

```bash
rg -n "listEntityTenants|getEntityTenantDetail" apps/console/src -g "*.test.tsx"
```

For each mock object that implements `ApiClient`, add:

```ts
listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [] } }),
getUserDetail: vi.fn().mockResolvedValue({
  data: {
    window: "7d",
    generatedAt: "2026-05-05T12:00:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
    user: {
      userId: "user_1",
      label: "user_1",
      isAnonymous: false,
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
      activeTenants: 0,
      activeSessions: 0
    },
    recentSessions: [],
    timeline: []
  }
})
```

If a test helper centralizes client mocks, add the methods there instead of repeating them.

- [ ] **Step 6: Run console client verification**

Run:

```bash
pnpm exec vitest run apps/console/src/api/client.test.ts
pnpm --filter @signal-hub/console build
```

Expected: both commands pass.

- [ ] **Step 7: Commit console user client**

Run:

```bash
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts apps/console/src/**/*.test.tsx
git commit -m "feat: add users console client"
```

## Task 5: Users Investigation UI Shell

**Files:**

- Create: `apps/console/src/components/UsersInvestigationPanel.tsx`
- Create: `apps/console/src/components/UsersUserList.tsx`
- Create: `apps/console/src/components/UsersUserDetail.tsx`
- Create: `apps/console/src/components/UsersInvestigationPanel.test.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.test.tsx`
- Modify: `apps/console/src/styles.css`

- [ ] **Step 1: Add failing UI tests**

Create `apps/console/src/components/UsersInvestigationPanel.test.tsx` with these imports and fixtures:

```ts
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { UserDetailResponse, UserRecentSession, UserSummary, UserTimelineRow } from "../api/types";
import { UsersInvestigationPanel } from "./UsersInvestigationPanel";

function user(overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    userId: "user_1",
    label: "user_1",
    isAnonymous: false,
    impactScore: 10,
    lastSeenAt: "2026-05-05T10:00:00.000Z",
    events: 5,
    errors: 1,
    openErrors: 1,
    severeErrors: 0,
    traces: 3,
    failedTraces: 1,
    llmCalls: 2,
    failedLlmCalls: 0,
    llmCostUsd: "1.25",
    activeTenants: 2,
    activeSessions: 3,
    ...overrides
  };
}

function session(overrides: Partial<UserRecentSession> = {}): UserRecentSession {
  return {
    sessionId: "session_1",
    tenantId: "tenant_alpha",
    events: 2,
    errors: 1,
    traces: 1,
    llmCalls: 1,
    llmCostUsd: "0.250000",
    firstSeenAt: "2026-05-05T09:30:00.000Z",
    lastSeenAt: "2026-05-05T10:00:00.000Z",
    ...overrides
  };
}

function eventRow(overrides: Partial<Extract<UserTimelineRow, { type: "event" }>> = {}): UserTimelineRow {
  return {
    type: "event",
    id: "evt_1",
    timestamp: "2026-05-05T10:00:00.000Z",
    label: "Checkout started",
    tenantId: "tenant_alpha",
    sessionId: "session_1",
    traceId: "trace_1",
    eventName: "checkout.started",
    ...overrides
  };
}

function errorRow(overrides: Partial<Extract<UserTimelineRow, { type: "error" }>> = {}): UserTimelineRow {
  return {
    type: "error",
    id: "err_1",
    timestamp: "2026-05-05T10:01:00.000Z",
    label: "Checkout failed",
    tenantId: "tenant_alpha",
    sessionId: "session_1",
    traceId: "trace_1",
    severity: "error",
    status: "open",
    message: "Checkout failed",
    ...overrides
  };
}

function traceRow(overrides: Partial<Extract<UserTimelineRow, { type: "trace" }>> = {}): UserTimelineRow {
  return {
    type: "trace",
    id: "trc_1",
    timestamp: "2026-05-05T10:02:00.000Z",
    label: "Checkout trace",
    tenantId: "tenant_alpha",
    sessionId: "session_1",
    traceId: "trace_1",
    status: "error",
    durationMs: 320,
    name: "checkout",
    ...overrides
  };
}

function llmRow(overrides: Partial<Extract<UserTimelineRow, { type: "llm" }>> = {}): UserTimelineRow {
  return {
    type: "llm",
    id: "llm_1",
    timestamp: "2026-05-05T10:03:00.000Z",
    label: "Summarize cart",
    tenantId: "tenant_alpha",
    sessionId: "session_1",
    traceId: "trace_1",
    provider: "openai",
    model: "gpt-5",
    promptName: "Unspecified",
    status: "error",
    costUsd: "0.250000",
    ...overrides
  };
}

function detail(overrides: Partial<UserDetailResponse> = {}): UserDetailResponse {
  return {
    window: "7d",
    generatedAt: "2026-05-05T12:30:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-04-28T12:30:00.000Z", to: "2026-05-05T12:30:00.000Z" },
    user: user(),
    recentSessions: [session()],
    timeline: [eventRow()],
    ...overrides
  };
}

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn(),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    listTraces: vi.fn(),
    listTraceSpans: vi.fn(),
    listLlmCalls: vi.fn(),
    getLlmAggregates: vi.fn(),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn(),
    listEntityTenants: vi.fn(),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [] } }),
    getUserDetail: vi.fn().mockResolvedValue({ data: detail() }),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    ...overrides
  };
}

afterEach(() => {
  cleanup();
});
```

Add this test block after the fixtures:

```ts
describe("UsersInvestigationPanel", () => {
it("renders impact-ranked users and disables Anonymous", async () => {
  const api = client({
    listUsersActivity: vi.fn().mockResolvedValue({
      data: {
        users: [
          user({ userId: "user_low", label: "user_low", impactScore: 1 }),
          user({ userId: null, label: "Anonymous / Unassigned", isAnonymous: true, impactScore: 100 }),
          user({ userId: "user_high", label: "user_high", impactScore: 20 })
        ]
      }
    })
  });

  render(<UsersInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

  const rows = await screen.findAllByRole("button", { name: /user_|Anonymous/ });
  expect(rows[0]).toHaveTextContent("Anonymous / Unassigned");
  expect(rows[1]).toHaveTextContent("user_high");
  expect(screen.getByRole("button", { name: /Anonymous/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /user_high/ })).toHaveTextContent("Failed traces 1");
  expect(screen.getByRole("button", { name: /user_high/ })).toHaveTextContent("LLM calls 2");
  expect(screen.getByRole("button", { name: /user_high/ })).toHaveTextContent("Active tenants 2");

  await userEvent.click(screen.getByRole("button", { name: /Anonymous/ }));
  expect(api.getUserDetail).not.toHaveBeenCalled();
});

it("selecting user loads summary recent sessions and timeline", async () => {
  const getUserDetail = vi.fn().mockResolvedValue({ data: detail() });
  const api = client({
    listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [user()] } }),
    getUserDetail
  });

  render(<UsersInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

  await userEvent.click(await screen.findByRole("button", { name: /user_1/ }));

  expect(await screen.findByText("Active tenants")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Session" })).toBeInTheDocument();
  expect(screen.getByText("session_1")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Checkout started/ })).toBeInTheDocument();
  expect(getUserDetail).toHaveBeenCalledWith("user_1", {
    projectId: "prj_1",
    environmentId: "env_1",
    window: "7d",
    limit: 50
  });
});

it("applies search and tenant list filters only after Apply", async () => {
  const listUsersActivity = vi.fn().mockResolvedValue({ data: { users: [] } });
  const api = client({ listUsersActivity });

  render(<UsersInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

  await screen.findByText("No user activity in this window.");
  await userEvent.type(screen.getByLabelText("Search"), "user_2");
  await userEvent.type(screen.getByLabelText("Tenant"), "tenant_2");
  expect(listUsersActivity).toHaveBeenCalledTimes(1);

  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));

  await waitFor(() => expect(listUsersActivity).toHaveBeenCalledTimes(2));
  expect(listUsersActivity).toHaveBeenLastCalledWith({
    projectId: "prj_1",
    environmentId: "env_1",
    window: "7d",
    search: "user_2",
    tenantId: "tenant_2",
    limit: 50
  });
});

it("loads more timeline rows with the returned cursor", async () => {
  const getUserDetail = vi
    .fn()
    .mockResolvedValueOnce({ data: detail({ timeline: [eventRow({ id: "evt_1", label: "First row" })], cursor: "cursor_1" }) })
    .mockResolvedValueOnce({ data: detail({ timeline: [eventRow({ id: "evt_2", label: "Second row" })] }) });
  const api = client({
    listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [user()] } }),
    getUserDetail
  });

  render(<UsersInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" initialUserId="user_1" />);

  expect(await screen.findByRole("button", { name: /First row/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));

  expect(await screen.findByRole("button", { name: /Second row/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /First row/ })).toBeInTheDocument();
  expect(getUserDetail).toHaveBeenLastCalledWith("user_1", {
    projectId: "prj_1",
    environmentId: "env_1",
    window: "7d",
    limit: 50,
    cursor: "cursor_1"
  });
});
});
```

Also modify `InvestigationWorkspace.test.tsx` to assert the `Users` tab only loads when active.

- [ ] **Step 2: Run UI tests and confirm failure**

Run:

```bash
pnpm exec vitest run apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/UsersInvestigationPanel.test.tsx
```

Expected: fails because Users components and tab do not exist.

- [ ] **Step 3: Implement Users UI components**

Implement components using the Entities UI structure with user-specific names and labels.

`UsersInvestigationPanel.tsx` state must include:

```ts
const [windowValue, setWindowValue] = useState<UserWindow>("7d");
const [searchDraft, setSearchDraft] = useState("");
const [tenantDraft, setTenantDraft] = useState("");
const [appliedSearch, setAppliedSearch] = useState("");
const [appliedListTenantId, setAppliedListTenantId] = useState("");
const [sort, setSort] = useState<UserSort>("impact");
const [selectedUserId, setSelectedUserId] = useState(initialUserId);
const [selectedScopeKey, setSelectedScopeKey] = useState<string | undefined>(() => (initialUserId ? scopeKey : undefined));
const [detailTenantDraft, setDetailTenantDraft] = useState("");
const [appliedDetailTenantId, setAppliedDetailTenantId] = useState("");
const [signalType, setSignalType] = useState<UserSignalType | "">("");
```

`UsersUserList.tsx` must sort by impact with recent/activity/label tie-breakers and render disabled anonymous rows using:

```ts
function userKey(user: UserSummary): string {
  return user.isAnonymous ? "_anonymous" : user.userId ?? "_anonymous";
}
```

`UsersUserDetail.tsx` must render:

- Summary cards: Events, Errors, Failed traces, LLM calls, LLM cost, Active tenants, Active sessions, Last seen.
- Recent sessions table with Session, Tenant, Events, Errors, Traces, LLM, Cost, First seen, Last seen.
- Timeline rows.
- `Load more` button when `detail.cursor` exists.

- [ ] **Step 4: Add Users tab to workspace**

In `InvestigationWorkspace.tsx`:

```ts
import { UsersInvestigationPanel } from "./UsersInvestigationPanel";

export type InvestigationTab = "events" | "errors" | "traces" | "llm" | "entities" | "users";

export type InvestigationInitialFilters = {
  events?: Partial<EventFilterValues>;
  errors?: Partial<ErrorFilterValues>;
  traces?: Partial<TraceFilterValues>;
  llm?: Partial<LlmFilterValues>;
  entities?: { tenantId?: string };
  users?: { userId?: string };
};
```

Add the nav button:

```tsx
<button aria-pressed={activeTab === "users"} onClick={() => setActiveTab("users")} type="button">
  Users
</button>
```

Render:

```tsx
{activeTab === "users" ? (
  <UsersInvestigationPanel
    client={client}
    environmentId={environmentId}
    initialUserId={mergedInitialFilters.users?.userId}
    onDrilldown={handleInvestigationDrilldown}
    projectId={projectId}
  />
) : null}
```

Rename `handleEntityDrilldown` to `handleInvestigationDrilldown` because it will serve both Entities and Users.

- [ ] **Step 5: Add CSS**

In `apps/console/src/styles.css`, either share entity selectors or add aliases:

```css
.users-shell {
  display: grid;
  gap: 1rem;
}

.users-layout {
  display: grid;
  grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
  gap: 1rem;
}

.user-row,
.user-timeline-row {
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  color: #111827;
  cursor: pointer;
  padding: 0.75rem;
  text-align: left;
}

.user-row {
  display: grid;
  gap: 0.35rem;
}

.user-row[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.65;
}

.user-timeline-row {
  display: grid;
  grid-template-columns: minmax(160px, 1.2fr) minmax(150px, 0.8fr) minmax(180px, 1fr);
  gap: 0.75rem;
}

@media (max-width: 860px) {
  .users-layout,
  .user-timeline-row {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 6: Run UI verification**

Run:

```bash
pnpm exec vitest run apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/UsersInvestigationPanel.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: both commands pass.

- [ ] **Step 7: Commit Users UI shell**

Run:

```bash
git add apps/console/src/components/UsersInvestigationPanel.tsx apps/console/src/components/UsersUserList.tsx apps/console/src/components/UsersUserDetail.tsx apps/console/src/components/UsersInvestigationPanel.test.tsx apps/console/src/components/InvestigationWorkspace.tsx apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/styles.css
git commit -m "feat: add users investigation view"
```

## Task 6: Users Drilldowns

**Files:**

- Modify: `apps/console/src/components/UsersInvestigationPanel.tsx`
- Modify: `apps/console/src/components/UsersInvestigationPanel.test.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.test.tsx`

- [ ] **Step 1: Add failing drilldown tests**

In `UsersInvestigationPanel.test.tsx`, add:

```ts
it("drills timeline rows into raw investigation tabs with user filters", async () => {
  const onDrilldown = vi.fn();
  const rows = [
    errorRow(),
    traceRow(),
    eventRow({ label: "Checkout started", eventName: "checkout.started", traceId: "trace_1" }),
    llmRow({ promptName: "cart.summary" })
  ];
  const api = client({
    listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [user({ userId: "user_alpha", label: "user_alpha" })] } }),
    getUserDetail: vi.fn().mockResolvedValue({
      data: detail({
        user: user({ userId: "user_alpha", label: "user_alpha" }),
        timeline: rows
      })
    })
  });

  render(
    <UsersInvestigationPanel client={api} environmentId="env_1" onDrilldown={onDrilldown} projectId="prj_1" initialUserId="user_alpha" />
  );

  await userEvent.click(await screen.findByRole("button", { name: /Checkout failed/ }));
  await userEvent.click(screen.getByRole("button", { name: /Checkout trace/ }));
  await userEvent.click(screen.getByRole("button", { name: /Checkout started/ }));
  await userEvent.click(screen.getByRole("button", { name: /Summarize cart/ }));

  expect(onDrilldown).toHaveBeenCalledWith({
    tab: "errors",
    filters: { userId: "user_alpha", tenantId: "tenant_alpha", sessionId: "session_1", severity: "error", status: "open", traceId: "trace_1" }
  });
  expect(onDrilldown).toHaveBeenCalledWith({
    tab: "traces",
    filters: { userId: "user_alpha", tenantId: "tenant_alpha", sessionId: "session_1", traceId: "trace_1" }
  });
  expect(onDrilldown).toHaveBeenCalledWith({
    tab: "events",
    filters: { userId: "user_alpha", tenantId: "tenant_alpha", sessionId: "session_1", eventName: "checkout.started", traceId: "trace_1" }
  });
  expect(onDrilldown).toHaveBeenCalledWith({
    tab: "llm",
    filters: {
      userId: "user_alpha",
      tenantId: "tenant_alpha",
      sessionId: "session_1",
      provider: "openai",
      model: "gpt-5",
      status: "error",
      promptName: "cart.summary",
      traceId: "trace_1"
    }
  });
});
```

In `InvestigationWorkspace.test.tsx`, add a test that a Users drilldown switches to the target tab and applies initial filters.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm exec vitest run apps/console/src/components/UsersInvestigationPanel.test.tsx apps/console/src/components/InvestigationWorkspace.test.tsx
```

Expected: fails because `UsersInvestigationPanel` does not map timeline rows to `InvestigationDrilldown`.

- [ ] **Step 3: Map user timeline rows to raw tab filters**

In `UsersInvestigationPanel.tsx`, implement:

```ts
function commonFilters(row: UserTimelineRow) {
  return {
    userId: selectedUserId,
    ...(row.tenantId ? { tenantId: row.tenantId } : {}),
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    ...(row.traceId ? { traceId: row.traceId } : {})
  };
}

function handleTimelineDrilldown(row: UserTimelineRow) {
  if (!onDrilldown || !selectedUserId || selectedUserId === "_anonymous") return;
  const common = commonFilters(row);

  if (row.type === "event") {
    onDrilldown({ tab: "events", filters: { ...common, eventName: row.eventName } });
    return;
  }

  if (row.type === "error") {
    onDrilldown({ tab: "errors", filters: { ...common, severity: row.severity, status: row.status } });
    return;
  }

  if (row.type === "trace") {
    onDrilldown({ tab: "traces", filters: common });
    return;
  }

  const promptName = row.promptName?.trim();
  onDrilldown({
    tab: "llm",
    filters: {
      ...common,
      provider: row.provider,
      model: row.model,
      status: row.status,
      ...(promptName && promptName !== "Unspecified" ? { promptName } : {})
    }
  });
}
```

If TypeScript needs narrowing for `selectedUserId`, assign it to `const userId = selectedUserId` before building filters.

- [ ] **Step 4: Ensure workspace drilldown type is shared**

Keep `InvestigationDrilldown` as:

```ts
export type InvestigationDrilldown =
  | { tab: "events"; filters: Partial<EventFilterValues> }
  | { tab: "errors"; filters: Partial<ErrorFilterValues> }
  | { tab: "traces"; filters: Partial<TraceFilterValues> }
  | { tab: "llm"; filters: Partial<LlmFilterValues> };
```

Use this type for both `EntitiesInvestigationPanel` and `UsersInvestigationPanel`.

- [ ] **Step 5: Run drilldown verification**

Run:

```bash
pnpm exec vitest run apps/console/src/components/UsersInvestigationPanel.test.tsx apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/EventInvestigationPanel.test.tsx apps/console/src/components/ErrorInvestigationPanel.test.tsx apps/console/src/components/TraceInvestigationPanel.test.tsx apps/console/src/components/LlmInvestigationPanel.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: all commands pass.

- [ ] **Step 6: Commit users drilldowns**

Run:

```bash
git add apps/console/src/components/UsersInvestigationPanel.tsx apps/console/src/components/UsersInvestigationPanel.test.tsx apps/console/src/components/InvestigationWorkspace.tsx apps/console/src/components/InvestigationWorkspace.test.tsx
git commit -m "feat: connect users investigation drilldowns"
```

## Task 7: Docs, Verification, and Branch Finish

**Files:**

- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`

- [ ] **Step 1: Update architecture docs**

In `.claude/docs/ARCHITECTURE.md`, add query routes:

```md
- `GET /query/users`
- `GET /query/users/:userKey`
```

Add to Investigation Console:

```md
The console also includes a read-only Users view for user-first investigation. It uses `GET /query/users` for impact-ranked user summaries and `GET /query/users/:userKey` for selected user details. User queries are implemented behind the repository boundary in `packages/db/src/repositories/users-query.ts` and aggregate existing `events`, `errors`, `traces`, and `llm_calls` records only. Spans are intentionally excluded from user timelines; trace rows link operators into the existing Traces investigation flow when span detail is needed.
```

- [ ] **Step 2: Update UI docs and project summary**

In `.claude/docs/UI-UX.md`, add:

```md
- Keep Users as a peer tab with Events, Errors, Traces, LLM, and Entities inside `Investigate`.
- Users uses a user-first layout with a default `7d` window, impact-ranked user rows, tenant/search filters, and a selected-user detail panel.
- The Anonymous / Unassigned user bucket should be visible for context but disabled for drill-in.
- User details should show compact summary metrics, recent sessions, and a cross-signal timeline from events, errors, traces, and LLM calls.
- User timeline rows should drill into the raw investigation tabs with seeded exact filters.
```

In `.claude/docs/PROJECT-SUMMARY.md`, add:

```md
- Read-only Users investigation workspace with impact-ranked user summaries, selected user recent sessions, and cross-signal timeline drilldowns.
```

- [ ] **Step 3: Update versioned memory**

Append to `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`:

```md
- Added and committed the Phase 3 Users investigation design spec and implementation plan in SignalHub at `docs/superpowers/specs/2026-05-05-users-investigation-design.md` and `docs/superpowers/plans/2026-05-05-users-investigation-implementation.md`.
- Implemented the user-first Users investigation with `GET /query/users`, `GET /query/users/:userKey`, Postgres user aggregate helpers over events/errors/traces/LLM calls, typed console client methods, the read-only Users tab, impact-ranked user summaries, selected user recent sessions, cross-signal timeline drilldowns, disabled Anonymous drill-in, and responsive console layout.
```

- [ ] **Step 4: Run final verification**

Run:

```bash
pnpm test
pnpm build
docker compose config --quiet
```

Expected: all pass.

- [ ] **Step 5: Run visual verification**

Start console dev server:

```bash
pnpm dev:console
```

Use Playwright CLI with mocked console API responses to open `http://localhost:5173/console/`, navigate to `Investigate -> Users`, select a user, and verify:

- Desktop `1440x1000`: no horizontal overflow, user list and detail both visible.
- Mobile `390x900`: no horizontal overflow, layout stacks, text fits, Anonymous row disabled.

The browser check can use:

```js
await page.evaluate(() => ({
  width: document.documentElement.scrollWidth,
  client: document.documentElement.clientWidth,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  hasUsers: document.body.innerText.includes("Users"),
  hasSelectedUser: document.body.innerText.includes("user_alpha")
}));
```

Expected: `overflow: false`, `hasUsers: true`, `hasSelectedUser: true`.

- [ ] **Step 6: Commit docs**

Run:

```bash
git add .claude/docs/ARCHITECTURE.md .claude/docs/UI-UX.md .claude/docs/PROJECT-SUMMARY.md
git commit -m "docs: document users investigation"
```

Commit and push memory in the config repo:

```bash
git -C /Users/diogo/Developer/Github/claude-config add projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
git -C /Users/diogo/Developer/Github/claude-config commit -m "docs: update SignalHub memory"
git -C /Users/diogo/Developer/Github/claude-config push origin main
```

- [ ] **Step 7: Finish branch**

Use `superpowers:finishing-a-development-branch`.

Recommended path if all verification passes:

```bash
git switch main
git pull
git merge feature/users-investigation
pnpm test
pnpm build
docker compose config --quiet
git worktree remove /Users/diogo/Developer/Github/SignalHub/.worktrees/users-investigation
git branch -d feature/users-investigation
git push origin main
```

Expected: `main` is pushed to `origin/main` with all Users investigation commits.

## Final Acceptance Checklist

- [ ] `GET /query/users` returns `7d` by default, caps `limit` at `100`, supports `24h`, `7d`, `30d`, trims search and tenant filters, and returns `{ data: UserListResponse }`.
- [ ] `GET /query/users/:userKey` rejects `_anonymous`, rejects invalid cursor payloads, filters by `tenant_id` and `signal_type`, and returns `{ data: UserDetailResponse }`.
- [ ] User summaries aggregate events, errors, traces, and LLM calls with deterministic impact ranking.
- [ ] Anonymous user activity is visible in list responses but not selectable in the UI.
- [ ] Recent sessions aggregate non-null sessions for selected assigned users.
- [ ] Timeline includes events, errors, traces, and LLM calls only.
- [ ] Timeline rows do not include event properties, error context, stack traces, LLM previews, raw metadata, span input/output, or span rows.
- [ ] Timeline cursor uses `timestamp`, `type`, and `id` with the required ordering.
- [ ] Users tab loads only while active and defaults to `7d`.
- [ ] User list search and tenant filters apply only on Apply.
- [ ] Detail tenant filter applies only on Apply and signal filter applies immediately.
- [ ] Timeline Load more appends rows and preserves previous rows.
- [ ] Timeline drilldowns seed existing raw investigation tabs with user, tenant, session, trace, and signal-specific filters.
- [ ] Final verification passes `pnpm test`, `pnpm build`, `docker compose config --quiet`, and visual checks.
