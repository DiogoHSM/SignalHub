# Phase 3 Overview Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete, read-only Overview dashboard for the selected project/environment using existing telemetry tables.

**Architecture:** Add one backend query contract, `GET /query/overview`, backed by a single DB repository helper that returns KPIs, four mini trends, top lists, and recent important signals. The console adds `Overview` as a top-level mode, calls the endpoint only while active, renders the dashboard with lightweight in-app SVG/CSS trend visuals, and supports top-list drilldowns into existing investigation tabs.

**Tech Stack:** Fastify query API, Kysely/Postgres, Vite + React + TypeScript, Testing Library, Vitest, pnpm workspaces.

---

## Source Documents

- Approved spec: `docs/superpowers/specs/2026-05-05-overview-dashboard-design.md`
- PRD: `PRD.md`
- Existing query routes: `apps/api/src/routes/query.ts`
- Existing telemetry repository: `packages/db/src/repositories/telemetry-query.ts`
- Existing console shell: `apps/console/src/components/ConsoleShell.tsx`
- Existing investigation shell: `apps/console/src/components/InvestigationWorkspace.tsx`

## File Structure

Create:

```txt
apps/console/src/components/OverviewDashboard.tsx
apps/console/src/components/OverviewKpiGrid.tsx
apps/console/src/components/OverviewMiniTrends.tsx
apps/console/src/components/OverviewTopLists.tsx
apps/console/src/components/OverviewRecentSignals.tsx
apps/console/src/components/OverviewDashboard.test.tsx
```

Modify:

```txt
apps/api/src/routes/query.ts
apps/api/src/main.ts
apps/api/test/query.test.ts
packages/db/src/repositories/telemetry-query.ts
packages/db/test/repositories.test.ts
apps/console/src/api/types.ts
apps/console/src/api/client.ts
apps/console/src/api/client.test.ts
apps/console/src/App.test.tsx
apps/console/src/components/ApiKeyPanel.test.tsx
apps/console/src/components/AuthGate.test.tsx
apps/console/src/components/ConnectionCheck.test.tsx
apps/console/src/components/ConsoleModeTabs.tsx
apps/console/src/components/ConsoleModeTabs.test.tsx
apps/console/src/components/ConsoleShell.tsx
apps/console/src/components/ConsoleShell.test.tsx
apps/console/src/components/ErrorInvestigationPanel.tsx
apps/console/src/components/ErrorInvestigationPanel.test.tsx
apps/console/src/components/EventInvestigationPanel.tsx
apps/console/src/components/EventInvestigationPanel.test.tsx
apps/console/src/components/InvestigationWorkspace.tsx
apps/console/src/components/InvestigationWorkspace.test.tsx
apps/console/src/components/LlmInvestigationPanel.tsx
apps/console/src/components/LlmInvestigationPanel.test.tsx
apps/console/src/components/TraceInvestigationPanel.test.tsx
apps/console/src/components/UserAdminPanel.test.tsx
apps/console/src/styles.css
.claude/docs/ARCHITECTURE.md
.claude/docs/UI-UX.md
.claude/docs/PROJECT-SUMMARY.md
```

Responsibilities:

- `query.ts`: parse Overview filters, expose `GET /query/overview`, and forward the typed overview query dependency.
- `telemetry-query.ts`: compute Overview KPIs, trends, top lists, and recent rows from existing telemetry tables.
- `client.ts` / `types.ts`: expose typed `getOverview`.
- `ConsoleModeTabs.tsx`: add `Overview` as a peer mode.
- `ConsoleShell.tsx`: mount `OverviewDashboard` only while Overview is active and coordinate drilldowns into Investigate.
- `InvestigationWorkspace.tsx`: accept an initial tab and initial filters for drilldowns.
- `EventInvestigationPanel.tsx`, `ErrorInvestigationPanel.tsx`, `LlmInvestigationPanel.tsx`: accept initial filters and apply them on mount/change.
- `OverviewDashboard.tsx`: load Overview data, own selected window, retry/unavailable/loading/stale-response state, and dispatch drilldown intents.
- `OverviewKpiGrid.tsx`: compact KPI cards.
- `OverviewMiniTrends.tsx`: four lightweight mini trend panels, rendered with in-app SVG/CSS.
- `OverviewTopLists.tsx`: top 5 lists and drilldown buttons.
- `OverviewRecentSignals.tsx`: recent errors, failed traces, and failed LLM calls.

## Shared Types

Use these names consistently across backend and frontend:

```ts
export type OverviewWindow = "24h" | "7d" | "30d";

export type OverviewTrendBucket = "hour" | "day";

export type OverviewRecentError = {
  id: string;
  timestamp: string;
  message: string;
  type: string | null;
  severity: string;
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
    errorSeverity: Array<{ severity: string; total: number }>;
    errorStatus: Array<{ status: string; total: number }>;
  };
  recent: {
    errors: OverviewRecentError[];
    failedTraces: OverviewRecentTrace[];
    failedLlmCalls: OverviewRecentLlmCall[];
  };
};
```

---

## Task 1: Add Overview Query Route Contract

**Files:**
- Modify: `apps/api/src/routes/query.ts`
- Modify: `apps/api/test/query.test.ts`

- [ ] **Step 1: Write failing API route tests**

Add these tests to `apps/api/test/query.test.ts` before `it("returns 501 when a query dependency method is missing"`:

```ts
  it("forwards default overview filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getOverview: async (filters) => {
          receivedFilters.push(filters);
          return { ok: true };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/overview?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { ok: true } });
    expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", window: "24h" }]);
  });

  it("forwards explicit overview windows", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getOverview: async (filters) => {
          receivedFilters.push(filters);
          return { ok: true };
        }
      }
    });

    for (const window of ["24h", "7d", "30d"]) {
      const response = await app.inject({
        method: "GET",
        url: `/query/overview?project_id=prj_1&environment_id=env_1&window=${window}`
      });
      expect(response.statusCode).toBe(200);
    }

    expect(receivedFilters).toEqual([
      { projectId: "prj_1", environmentId: "env_1", window: "24h" },
      { projectId: "prj_1", environmentId: "env_1", window: "7d" },
      { projectId: "prj_1", environmentId: "env_1", window: "30d" }
    ]);
  });

  it("rejects unsupported overview windows", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getOverview: async () => ({ ok: true })
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/overview?project_id=prj_1&environment_id=env_1&window=custom"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 501 when overview query dependency is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {}
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/overview?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "query_method_unavailable" });
  });

  it("returns 503 when overview query dependency throws", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getOverview: async () => {
          throw new Error("database down");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/overview?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "query_unavailable" });
  });
```

- [ ] **Step 2: Run API query tests and verify failure**

Run:

```sh
pnpm test apps/api/test/query.test.ts
```

Expected: fail because `getOverview` does not exist on `QueryDependencies` and `/query/overview` is not registered.

- [ ] **Step 3: Implement overview route parsing**

Modify `apps/api/src/routes/query.ts`.

Add these types near `QueryFilters`:

```ts
export type OverviewWindow = "24h" | "7d" | "30d";

export type OverviewFilters = {
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
};
```

Add to `QueryDependencies`:

```ts
  getOverview?: (filters: OverviewFilters) => Promise<unknown>;
```

Add this parser after `parseFilters`:

```ts
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
```

Add this handler after `handleAggregateRoute`:

```ts
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
```

Register the route before list routes:

```ts
  app.get("/query/overview", (request, reply) => handleOverviewRoute(request, reply, options));
```

- [ ] **Step 4: Run API query tests**

Run:

```sh
pnpm test apps/api/test/query.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit route contract**

Run:

```sh
git add apps/api/src/routes/query.ts apps/api/test/query.test.ts
git commit -m "feat: add overview query route"
```

---

## Task 2: Implement Overview Repository Aggregates

**Files:**
- Modify: `packages/db/src/repositories/telemetry-query.ts`
- Modify: `packages/db/test/repositories.test.ts`
- Modify: `apps/api/src/main.ts`

- [ ] **Step 1: Write failing repository test**

Add `getOverview` to the import list from `../src/repositories/telemetry-query.js`.

Add this test after `it("filters LLM calls and aggregates by exact LLM fields"`:

```ts
  it("builds overview metrics trends top lists and recent signals", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Overview Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const otherProject = await createProject(db, { name: "Other Project" });
      const otherEnvironment = await createEnvironment(db, { projectId: otherProject.id, name: "production" });
      const now = new Date("2026-05-05T12:00:00.000Z");
      const inWindow = new Date("2026-05-05T10:00:00.000Z");
      const olderInWindow = new Date("2026-05-05T09:00:00.000Z");
      const outsideWindow = new Date("2026-05-03T12:00:00.000Z");
      const receivedAt = new Date("2026-05-05T12:00:01.000Z");
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        receivedAt,
        source: "api",
        release: "1.0.0"
      };

      await insertEvent(db, {
        ...base,
        id: "evt_overview_1",
        name: "dashboard_created",
        tenantId: "tenant_a",
        userId: "user_a",
        sessionId: "session_a",
        traceId: "trace_success",
        timestamp: inWindow
      });
      await insertEvent(db, {
        ...base,
        id: "evt_overview_2",
        name: "dashboard_created",
        tenantId: "tenant_a",
        userId: "user_b",
        sessionId: "session_b",
        traceId: "trace_failed",
        timestamp: inWindow
      });
      await insertEvent(db, {
        ...base,
        id: "evt_overview_3",
        name: "chat_started",
        tenantId: "tenant_b",
        userId: "user_c",
        sessionId: "session_c",
        traceId: "trace_llm",
        timestamp: olderInWindow
      });
      await insertEvent(db, {
        projectId: otherProject.id,
        environmentId: otherEnvironment.id,
        id: "evt_other_scope",
        name: "dashboard_created",
        timestamp: inWindow,
        receivedAt
      });
      await insertEvent(db, { ...base, id: "evt_old", name: "old_event", timestamp: outsideWindow, receivedAt });

      await insertError(db, {
        ...base,
        id: "err_recent",
        message: "Checkout failed",
        type: "CheckoutError",
        severity: "critical",
        status: "open",
        tenantId: "tenant_a",
        userId: "user_a",
        traceId: "trace_failed",
        timestamp: inWindow
      });
      await insertError(db, {
        ...base,
        id: "err_warning",
        message: "Slow response",
        severity: "warning",
        status: "resolved",
        tenantId: "tenant_b",
        userId: "user_c",
        timestamp: olderInWindow
      });

      await insertTrace(db, {
        ...base,
        id: "trc_success",
        name: "Generate dashboard",
        status: "success",
        tenantId: "tenant_a",
        userId: "user_a",
        traceId: "trace_success",
        timestamp: inWindow,
        startedAt: inWindow,
        durationMs: 100
      });
      await insertTrace(db, {
        ...base,
        id: "trc_failed",
        name: "Checkout",
        status: "error",
        tenantId: "tenant_b",
        userId: "user_c",
        traceId: "trace_failed",
        timestamp: olderInWindow,
        startedAt: olderInWindow,
        durationMs: 300
      });

      await insertLlmCall(db, {
        ...base,
        id: "llm_success",
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: "0.300000",
        latencyMs: 1200,
        status: "success",
        tenantId: "tenant_a",
        userId: "user_b",
        traceId: "trace_llm",
        timestamp: inWindow
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_failed",
        provider: "anthropic",
        model: "claude",
        promptName: "summarize_error",
        inputTokens: 20,
        outputTokens: 10,
        costUsd: "0.100000",
        latencyMs: 900,
        status: "error",
        error: "provider_error",
        tenantId: "tenant_b",
        userId: "user_c",
        traceId: "trace_failed",
        timestamp: olderInWindow
      });

      const overview = await getOverview(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h",
        now
      });

      expect(overview.scope).toEqual({ projectId: project.id, environmentId: environment.id });
      expect(overview.window).toBe("24h");
      expect(overview.range.bucket).toBe("hour");
      expect(overview.kpis).toMatchObject({
        events: 3,
        activeUsers: 3,
        activeTenants: 2,
        errors: 2,
        openErrors: 1,
        traces: 2,
        failedTraces: 1,
        averageTraceDurationMs: 200,
        p95TraceDurationMs: expect.any(Number),
        llmCalls: 2,
        failedLlmCalls: 1,
        llmInputTokens: 120,
        llmOutputTokens: 60,
        llmCostUsd: "0.400000"
      });
      expect(overview.top.events).toEqual([
        { name: "dashboard_created", total: 2 },
        { name: "chat_started", total: 1 }
      ]);
      expect(overview.top.tenantsByUsage[0]).toEqual({ tenantId: "tenant_a", total: 5 });
      expect(overview.top.tenantsByErrors).toEqual([
        { tenantId: "tenant_a", total: 1 },
        { tenantId: "tenant_b", total: 1 }
      ]);
      expect(overview.top.tenantsByLlmCost).toEqual([
        { tenantId: "tenant_a", totalCostUsd: "0.300000" },
        { tenantId: "tenant_b", totalCostUsd: "0.100000" }
      ]);
      expect(overview.top.llmModels).toEqual([
        { model: "gpt-5", total: 1, totalCostUsd: "0.300000" },
        { model: "claude", total: 1, totalCostUsd: "0.100000" }
      ]);
      expect(overview.top.errorStatus).toEqual([
        { status: "open", total: 1 },
        { status: "resolved", total: 1 }
      ]);
      expect(overview.recent.errors).toEqual([
        expect.objectContaining({ id: "err_recent", message: "Checkout failed", severity: "critical", status: "open" }),
        expect.objectContaining({ id: "err_warning", message: "Slow response", severity: "warning", status: "resolved" })
      ]);
      expect(overview.recent.failedTraces).toEqual([expect.objectContaining({ id: "trc_failed", status: "error" })]);
      expect(overview.recent.failedLlmCalls).toEqual([expect.objectContaining({ id: "llm_failed", status: "error" })]);
      expect(overview.trends.usage).toHaveLength(25);
      expect(overview.trends.errors).toHaveLength(25);
      expect(overview.trends.latency).toHaveLength(25);
      expect(overview.trends.aiCost).toHaveLength(25);
      expect(overview.trends.usage.map((bucket) => bucket.bucketStart)).toEqual(
        overview.trends.aiCost.map((bucket) => bucket.bucketStart)
      );
    });
  });
```

- [ ] **Step 2: Run repository tests and verify failure**

Run:

```sh
pnpm test packages/db/test/repositories.test.ts
```

Expected: fail because `getOverview` is not exported.

- [ ] **Step 3: Add overview repository types**

Modify `packages/db/src/repositories/telemetry-query.ts`.

Add exported types matching the Shared Types section. Add `now?: Date` to the DB filter type so tests can use a stable clock:

```ts
export interface OverviewFilters {
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
  now?: Date;
}
```

- [ ] **Step 4: Add overview helper functions**

Add these helpers near `toNumber`:

```ts
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toIso(value: Date | string): string {
  return toDate(value).toISOString();
}

function resolveOverviewRange(window: OverviewWindow, now = new Date()) {
  const to = now;
  const from = new Date(to);
  if (window === "24h") {
    from.setHours(from.getHours() - 24);
    return { from, to, bucket: "hour" as const };
  }
  if (window === "7d") {
    from.setDate(from.getDate() - 7);
    return { from, to, bucket: "day" as const };
  }
  from.setDate(from.getDate() - 30);
  return { from, to, bucket: "day" as const };
}

function bucketStep(bucket: OverviewTrendBucket): number {
  return bucket === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

function startOfBucket(date: Date, bucket: OverviewTrendBucket): Date {
  const next = new Date(date);
  next.setUTCMinutes(0, 0, 0);
  if (bucket === "day") {
    next.setUTCHours(0, 0, 0, 0);
  }
  return next;
}

function makeBucketStarts(from: Date, to: Date, bucket: OverviewTrendBucket): string[] {
  const starts: string[] = [];
  const step = bucketStep(bucket);
  let current = startOfBucket(from, bucket);
  while (current <= to) {
    starts.push(current.toISOString());
    current = new Date(current.getTime() + step);
  }
  return starts;
}

function bucketExpression(bucket: OverviewTrendBucket, column = "timestamp") {
  return bucket === "hour" ? sql<string>`date_trunc('hour', ${sql.ref(column)})::text` : sql<string>`date_trunc('day', ${sql.ref(column)})::text`;
}
```

- [ ] **Step 5: Implement `getOverview`**

Add `export async function getOverview(db: Db, filters: OverviewFilters): Promise<OverviewResponse>`.

Implementation requirements:

- Use `resolveOverviewRange(filters.window, filters.now)` for range.
- Use `where("project_id", "=", filters.projectId)`, `where("environment_id", "=", filters.environmentId)`, `where("timestamp", ">=", from)`, and `where("timestamp", "<=", to)` for every telemetry-table query.
- Use `count(distinct user_id)` / `count(distinct tenant_id)` over a `union all` SQL expression for active users and tenants.
- Use `percentile_cont(0.95) within group (order by duration_ms)` for p95 trace duration.
- Use `coalesce(sum(cost_usd), 0)::text` for cost totals.
- Build zero-filled buckets from `makeBucketStarts`.
- Limit top lists and recent lists to 5 rows.

Use this return shape:

```ts
  return {
    window: filters.window,
    generatedAt: to.toISOString(),
    scope: {
      projectId: filters.projectId,
      environmentId: filters.environmentId
    },
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      bucket
    },
    kpis,
    trends,
    top,
    recent
  };
```

The implementation may use multiple small Kysely queries rather than one giant SQL query. Keep helper functions private in `telemetry-query.ts`.

- [ ] **Step 6: Wire API main dependencies**

Modify `apps/api/src/main.ts`.

Add `getOverview` to the telemetry-query import list, then add:

```ts
    getOverview: (filters) => getOverview(db, filters),
```

inside the `query` dependency object.

- [ ] **Step 7: Run repository and API build verification**

Run:

```sh
pnpm test packages/db/test/repositories.test.ts
pnpm --filter @signal-hub/db build
pnpm --filter @signal-hub/api build
```

Expected: pass.

- [ ] **Step 8: Commit overview repository**

Run:

```sh
git add packages/db/src/repositories/telemetry-query.ts packages/db/test/repositories.test.ts apps/api/src/main.ts
git commit -m "feat: add overview query repository"
```

---

## Task 3: Type Overview In Console API Client

**Files:**
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Modify: `apps/console/src/api/client.test.ts`
- Modify typed `ApiClient` mocks in console tests.

- [ ] **Step 1: Write failing client tests**

Add these tests to `apps/console/src/api/client.test.ts` after aggregate/query tests:

```ts
  it("encodes overview query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: overviewResponse() }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getOverview({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/overview?project_id=prj_1&environment_id=env_1&window=7d",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("does not encode investigation filters for overview queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: overviewResponse() }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getOverview({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "24h",
      tenantId: "tenant_1",
      eventName: "dashboard_created",
      status: "open"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/overview?project_id=prj_1&environment_id=env_1&window=24h",
      expect.objectContaining({ method: "GET" })
    );
  });
```

Add this helper in the test file:

```ts
function overviewResponse() {
  return {
    window: "24h",
    generatedAt: "2026-05-05T12:00:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-05-04T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z", bucket: "hour" },
    kpis: {
      events: 0,
      activeUsers: 0,
      activeTenants: 0,
      errors: 0,
      openErrors: 0,
      traces: 0,
      failedTraces: 0,
      averageTraceDurationMs: 0,
      p95TraceDurationMs: null,
      llmCalls: 0,
      failedLlmCalls: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      llmCostUsd: "0"
    },
    trends: { usage: [], errors: [], latency: [], aiCost: [] },
    top: {
      events: [],
      tenantsByUsage: [],
      tenantsByErrors: [],
      tenantsByLlmCalls: [],
      tenantsByLlmCost: [],
      llmProviders: [],
      llmModels: [],
      llmPrompts: [],
      errorSeverity: [],
      errorStatus: []
    },
    recent: { errors: [], failedTraces: [], failedLlmCalls: [] }
  };
}
```

- [ ] **Step 2: Run client tests and verify failure**

Run:

```sh
pnpm test apps/console/src/api/client.test.ts
```

Expected: fail because `getOverview` and Overview types do not exist.

- [ ] **Step 3: Add console Overview types**

Modify `apps/console/src/api/types.ts`.

Copy the Shared Types section into this file after `LlmAggregates`.

Add:

```ts
export type OverviewQuery = {
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
  tenantId?: string;
  eventName?: string;
  status?: string;
};
```

The extra optional fields are only for the negative encoding test; `getOverview` must ignore them.

- [ ] **Step 4: Implement `getOverview` client method**

Modify `apps/console/src/api/client.ts`.

Import `OverviewQuery` and `OverviewResponse`.

Add to `ApiClient` after aggregate methods:

```ts
  getOverview: (query: OverviewQuery) => Promise<AggregateResponse<OverviewResponse>>;
```

Add helper:

```ts
function overviewPath(query: OverviewQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);
  return `/query/overview?${params.toString()}`;
}
```

Add method implementation:

```ts
    getOverview: (query) => request<AggregateResponse<OverviewResponse>>(path(apiBasePath, overviewPath(query))),
```

- [ ] **Step 5: Update typed test client helpers**

In every `client(overrides: Partial<ApiClient>): ApiClient` helper and `satisfies ApiClient` mock, add:

```ts
    getOverview: vi.fn().mockResolvedValue({ data: overviewResponse() }),
```

Files to check:

```txt
apps/console/src/App.test.tsx
apps/console/src/components/ApiKeyPanel.test.tsx
apps/console/src/components/AuthGate.test.tsx
apps/console/src/components/ConnectionCheck.test.tsx
apps/console/src/components/ConsoleShell.test.tsx
apps/console/src/components/ErrorInvestigationPanel.test.tsx
apps/console/src/components/EventInvestigationPanel.test.tsx
apps/console/src/components/InvestigationWorkspace.test.tsx
apps/console/src/components/LlmInvestigationPanel.test.tsx
apps/console/src/components/TraceInvestigationPanel.test.tsx
apps/console/src/components/UserAdminPanel.test.tsx
```

If repeated helper setup becomes noisy, create local minimal `overviewResponse` helpers in files that need typed defaults.

- [ ] **Step 6: Run client verification**

Run:

```sh
pnpm test apps/console/src/api/client.test.ts
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [ ] **Step 7: Commit client types**

Run:

```sh
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts apps/console/src/App.test.tsx apps/console/src/components/*.test.tsx
git commit -m "feat: type console overview query"
```

---

## Task 4: Add Overview UI And Drilldowns

**Files:**
- Create: `apps/console/src/components/OverviewDashboard.tsx`
- Create: `apps/console/src/components/OverviewKpiGrid.tsx`
- Create: `apps/console/src/components/OverviewMiniTrends.tsx`
- Create: `apps/console/src/components/OverviewTopLists.tsx`
- Create: `apps/console/src/components/OverviewRecentSignals.tsx`
- Create: `apps/console/src/components/OverviewDashboard.test.tsx`
- Modify: `apps/console/src/components/ConsoleModeTabs.tsx`
- Modify: `apps/console/src/components/ConsoleModeTabs.test.tsx`
- Modify: `apps/console/src/components/ConsoleShell.tsx`
- Modify: `apps/console/src/components/ConsoleShell.test.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.test.tsx`
- Modify: `apps/console/src/components/EventInvestigationPanel.tsx`
- Modify: `apps/console/src/components/ErrorInvestigationPanel.tsx`
- Modify: `apps/console/src/components/LlmInvestigationPanel.tsx`
- Modify: `apps/console/src/styles.css`

- [ ] **Step 1: Write failing console mode tests**

Update `apps/console/src/components/ConsoleModeTabs.test.tsx` to expect `Overview`:

```tsx
  it("renders setup overview and investigate tabs", () => {
    const onChange = vi.fn();
    render(<ConsoleModeTabs activeMode="setup" onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Setup" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Investigate" })).toHaveAttribute("aria-pressed", "false");
  });
```

Add a test in `ConsoleShell.test.tsx`:

```tsx
  it("does not query overview until Overview mode is opened", async () => {
    const getOverview = vi.fn().mockResolvedValue({ data: overviewResponse() });
    const api = client({
      getOverview,
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();
    expect(getOverview).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Overview" }));

    await waitFor(() =>
      expect(getOverview).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", window: "24h" })
    );
  });
```

- [ ] **Step 2: Run shell tests and verify failure**

Run:

```sh
pnpm test apps/console/src/components/ConsoleModeTabs.test.tsx apps/console/src/components/ConsoleShell.test.tsx
```

Expected: fail because Overview mode is not implemented.

- [ ] **Step 3: Implement top-level Overview mode**

Modify `ConsoleModeTabs.tsx`:

```tsx
export type ConsoleMode = "setup" | "overview" | "investigate";
```

Add the button:

```tsx
      <button aria-pressed={activeMode === "overview"} onClick={() => onChange("overview")} type="button">
        Overview
      </button>
```

Modify `ConsoleShell.tsx`:

- Import `OverviewDashboard`.
- Add a `<div hidden={activeMode !== "overview"}>` between Setup and Investigate.
- Render `OverviewDashboard` only when `activeMode === "overview"`.

```tsx
        <div hidden={activeMode !== "overview"}>
          {activeMode === "overview" ? (
            <OverviewDashboard
              client={client}
              environmentId={activeEnvironment?.id}
              onDrilldown={handleOverviewDrilldown}
              projectId={activeProject?.id}
            />
          ) : null}
        </div>
```

Temporarily add:

```tsx
  function handleOverviewDrilldown() {
    setActiveMode("investigate");
  }
```

Task 4 Step 7 replaces this with typed drilldowns.

- [ ] **Step 4: Write failing OverviewDashboard tests**

Create `apps/console/src/components/OverviewDashboard.test.tsx`.

Include tests for:

```tsx
it("shows setup guidance without project or environment");
it("loads overview cards trends top lists and recent signals");
it("reloads when the window changes");
it("shows unavailable state and retries");
it("ignores stale overview responses");
it("dispatches top-list drilldowns");
```

Use a local `overviewResponse(overrides = {})` helper. The default response should include:

- `kpis.events = 18`
- `kpis.activeUsers = 4`
- `kpis.activeTenants = 2`
- `kpis.errors = 3`
- `kpis.openErrors = 1`
- `kpis.traces = 7`
- `kpis.averageTraceDurationMs = 250`
- `kpis.p95TraceDurationMs = 400`
- `kpis.llmCalls = 5`
- `kpis.llmCostUsd = "1.250000"`
- one row in each top list
- one recent error, one failed trace, and one failed LLM call

The drilldown test should assert:

```tsx
expect(onDrilldown).toHaveBeenCalledWith({ tab: "events", filters: { eventName: "dashboard_created" } });
expect(onDrilldown).toHaveBeenCalledWith({ tab: "errors", filters: { severity: "critical" } });
expect(onDrilldown).toHaveBeenCalledWith({ tab: "llm", filters: { model: "gpt-5" } });
```

- [ ] **Step 5: Run OverviewDashboard tests and verify failure**

Run:

```sh
pnpm test apps/console/src/components/OverviewDashboard.test.tsx
```

Expected: fail because Overview components do not exist.

- [ ] **Step 6: Implement Overview components**

Implement `OverviewDashboard.tsx` with:

```tsx
export type OverviewDrilldown =
  | { tab: "events"; filters: { eventName?: string; tenantId?: string } }
  | { tab: "errors"; filters: { severity?: string; status?: string; tenantId?: string } }
  | { tab: "llm"; filters: { provider?: string; model?: string; promptName?: string; tenantId?: string } };
```

Props:

```tsx
type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
  onDrilldown: (drilldown: OverviewDrilldown) => void;
};
```

Behavior:

- If `projectId` or `environmentId` is missing, render a panel with heading `Overview` and text `Select a project and environment in Setup to view the overview.`
- Default `window` to `24h`.
- Call `client.getOverview({ projectId, environmentId, window })`.
- Use cancellation boolean in `useEffect` to ignore stale responses.
- Show `Loading overview`.
- Show `Overview unavailable` and a `Retry` button on failure.
- Render:
  - `OverviewKpiGrid`
  - `OverviewMiniTrends`
  - `OverviewTopLists`
  - `OverviewRecentSignals`

Implement `OverviewKpiGrid.tsx` as simple cards with labels:

```txt
Events
Active users
Active tenants
Errors
Open errors
Traces
Avg latency
P95 latency
LLM calls
LLM tokens
LLM cost
```

Implement `OverviewMiniTrends.tsx` with SVG polylines. Keep the helper simple:

```tsx
function points(values: number[]): string {
  const max = Math.max(1, ...values);
  return values.map((value, index) => {
    const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
    const y = 36 - (value / max) * 32;
    return `${x},${y}`;
  }).join(" ");
}
```

Implement `OverviewTopLists.tsx` with buttons for drilldowns:

- Event name -> `{ tab: "events", filters: { eventName: row.name } }`
- Error severity -> `{ tab: "errors", filters: { severity: row.severity } }`
- Error status -> `{ tab: "errors", filters: { status: row.status } }`
- LLM provider/model/prompt -> matching LLM filter.
- Tenant usage -> `{ tab: "events", filters: { tenantId } }`
- Tenant errors -> `{ tab: "errors", filters: { tenantId } }`
- Tenant LLM -> `{ tab: "llm", filters: { tenantId } }`

Implement `OverviewRecentSignals.tsx` as read-only lists.

- [ ] **Step 7: Implement investigation drilldown state**

Modify `InvestigationWorkspace.tsx`.

Export:

```tsx
export type InvestigationTab = "events" | "errors" | "traces" | "llm";

export type InvestigationInitialFilters = {
  events?: Partial<EventFilterValues>;
  errors?: Partial<ErrorFilterValues>;
  llm?: Partial<LlmFilterValues>;
};
```

Update props:

```tsx
type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
  initialTab?: InvestigationTab;
  initialFilters?: InvestigationInitialFilters;
};
```

In `InvestigationWorkspace`, update active tab when `initialTab` changes:

```tsx
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);
```

Pass initial filters:

```tsx
{activeTab === "events" ? (
  <EventInvestigationPanel
    client={client}
    environmentId={environmentId}
    initialFilters={initialFilters?.events}
    projectId={projectId}
  />
) : null}
{activeTab === "errors" ? (
  <ErrorInvestigationPanel
    client={client}
    environmentId={environmentId}
    initialFilters={initialFilters?.errors}
    projectId={projectId}
  />
) : null}
{activeTab === "traces" ? <TraceInvestigationPanel client={client} environmentId={environmentId} projectId={projectId} /> : null}
{activeTab === "llm" ? (
  <LlmInvestigationPanel client={client} environmentId={environmentId} initialFilters={initialFilters?.llm} projectId={projectId} />
) : null}
```

Modify `EventInvestigationPanel.tsx`, `ErrorInvestigationPanel.tsx`, and `LlmInvestigationPanel.tsx`:

- Export their filter value types from their filter files if not already exported.
- Add `initialFilters?: Partial<EventFilterValues>` in `EventInvestigationPanel.tsx`.
- Add `initialFilters?: Partial<ErrorFilterValues>` in `ErrorInvestigationPanel.tsx`.
- Add `initialFilters?: Partial<LlmFilterValues>` in `LlmInvestigationPanel.tsx`.
- Build defaults with `{ ...defaultFilters, ...initialFilters }`.
- Use an effect to update draft and applied filters when `initialFilters` changes:

```tsx
  useEffect(() => {
    const next = { ...defaultFilters, ...initialFilters };
    setDraftFilters(next);
    setAppliedFilters(next);
  }, [initialFilters]);
```

Modify `ConsoleShell.tsx`:

- Track:

```tsx
const [investigationDrilldown, setInvestigationDrilldown] = useState<{
  nonce: number;
  tab: InvestigationTab;
  filters: InvestigationInitialFilters;
}>();
```

- Implement:

```tsx
function handleOverviewDrilldown(drilldown: OverviewDrilldown) {
  const filters =
    drilldown.tab === "events"
      ? { events: drilldown.filters }
      : drilldown.tab === "errors"
        ? { errors: drilldown.filters }
        : { llm: drilldown.filters };
  setInvestigationDrilldown((current) => ({
    nonce: (current?.nonce ?? 0) + 1,
    tab: drilldown.tab,
    filters
  }));
  setActiveMode("investigate");
}
```

- Pass:

```tsx
<InvestigationWorkspace
  client={client}
  environmentId={activeEnvironment?.id}
  initialFilters={investigationDrilldown?.filters}
  initialTab={investigationDrilldown?.tab}
  key={investigationDrilldown?.nonce ?? "investigation"}
  projectId={activeProject?.id}
/>
```

- [ ] **Step 8: Add Overview styles**

Modify `apps/console/src/styles.css`.

Add classes:

```css
.overview-dashboard {
  display: grid;
  gap: 16px;
}

.overview-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.overview-window-tabs,
.overview-top-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.overview-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 10px;
}

.overview-kpi {
  border: 1px solid #d7dde7;
  border-radius: 8px;
  background: #fff;
  padding: 12px;
}

.overview-kpi span {
  color: #64748b;
  display: block;
  font-size: 12px;
  font-weight: 700;
}

.overview-kpi strong {
  color: #111827;
  display: block;
  font-size: 20px;
  margin-top: 4px;
}

.overview-trends,
.overview-lists,
.overview-recent {
  display: grid;
  grid-template-columns: repeat(2, minmax(220px, 1fr));
  gap: 12px;
}

.overview-trend,
.overview-list,
.overview-recent-list {
  border: 1px solid #d7dde7;
  border-radius: 8px;
  background: #fff;
  padding: 12px;
}

.overview-list button {
  align-items: center;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #eef2f7;
  color: #111827;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  text-align: left;
  width: 100%;
}
```

Inside the mobile media query, include:

```css
  .overview-controls,
  .overview-kpis,
  .overview-trends,
  .overview-lists,
  .overview-recent {
    grid-template-columns: 1fr;
  }

  .overview-controls {
    align-items: flex-start;
    flex-direction: column;
  }
```

- [ ] **Step 9: Run UI verification**

Run:

```sh
pnpm test apps/console/src/components/ConsoleModeTabs.test.tsx apps/console/src/components/ConsoleShell.test.tsx apps/console/src/components/OverviewDashboard.test.tsx apps/console/src/components/InvestigationWorkspace.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [ ] **Step 10: Commit Overview UI**

Run:

```sh
git add apps/console/src/components/OverviewDashboard.tsx apps/console/src/components/OverviewKpiGrid.tsx apps/console/src/components/OverviewMiniTrends.tsx apps/console/src/components/OverviewTopLists.tsx apps/console/src/components/OverviewRecentSignals.tsx apps/console/src/components/OverviewDashboard.test.tsx apps/console/src/components/ConsoleModeTabs.tsx apps/console/src/components/ConsoleModeTabs.test.tsx apps/console/src/components/ConsoleShell.tsx apps/console/src/components/ConsoleShell.test.tsx apps/console/src/components/InvestigationWorkspace.tsx apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/EventInvestigationPanel.tsx apps/console/src/components/ErrorInvestigationPanel.tsx apps/console/src/components/LlmInvestigationPanel.tsx apps/console/src/styles.css
git commit -m "feat: add overview dashboard"
```

---

## Task 5: Update Docs And Run Final Verification

**Files:**
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`

- [ ] **Step 1: Update architecture docs**

Append this paragraph to `## Investigation Console` or create `## Overview Console` after it in `.claude/docs/ARCHITECTURE.md`:

```md
## Overview Console

The console includes a read-only `Overview` mode scoped to the selected project and environment. It uses `GET /query/overview` with fixed `24h`, `7d`, and `30d` windows to return KPI cards, mini trends, top lists, and recent important signals from existing telemetry tables. This slice does not add rollups, storage tables, alerts, logs, custom ranges, or cross-project aggregation.
```

- [ ] **Step 2: Update UI/UX docs**

Append these bullets to `.claude/docs/UI-UX.md` under console principles or investigation UX:

```md
- Keep `Overview` as a peer top-level console mode with `Setup` and `Investigate`.
- Overview is scoped to the selected project and environment.
- Overview uses compact KPI cards, four mini trends, top 5 ranked lists, and recent important signals.
- Overview top-list drilldowns may switch into `Investigate` with the relevant tab and filter prefilled.
```

- [ ] **Step 3: Update project summary**

Add this implemented capability to `.claude/docs/PROJECT-SUMMARY.md`:

```md
- Read-only Overview dashboard for selected project/environment health, usage, latency, AI cost, top lists, and recent important signals.
```

- [ ] **Step 4: Run final verification**

Run:

```sh
pnpm test
pnpm build
docker compose config --quiet
```

Expected: all pass.

- [ ] **Step 5: Commit docs**

Run:

```sh
git add .claude/docs/ARCHITECTURE.md .claude/docs/UI-UX.md .claude/docs/PROJECT-SUMMARY.md
git commit -m "docs: document overview dashboard"
```

---

## Final Review

- [ ] Run `git status -sb` and confirm the worktree is clean.
- [ ] Run `git log --oneline -10` and confirm commits are readable.
- [ ] Run final code review across the implementation range before merging.
- [ ] Use `superpowers:finishing-a-development-branch` after final review approves.
