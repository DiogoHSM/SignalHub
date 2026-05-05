# Phase 3 LLM Investigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only LLM investigation view with exact LLM filters, raw call details, and aggregate totals inside the existing `Investigate` workspace.

**Architecture:** Extend the existing query contract instead of adding new routes: `GET /query/llm-calls` and `GET /query/aggregates/llm` gain exact `provider`, `model`, `prompt_name`, and `status` filters. The console follows the Events, Errors, and Traces investigation pattern: tab-gated mounting, controlled filters, list/detail drawer, retry/empty/unavailable states, and stale-response guards. This slice adds no charts, grouping, mutation workflow, cross-signal timeline, storage tables, ingestion routes, or indexes.

**Tech Stack:** Fastify query API, Kysely/Postgres repositories, Vite + React + TypeScript, Testing Library, Vitest, pnpm workspaces.

---

## Source Documents

- Approved spec: `docs/superpowers/specs/2026-05-05-llm-investigation-design.md`
- Existing Events design: `docs/superpowers/specs/2026-05-04-phase3-events-investigation-design.md`
- Existing Errors design: `docs/superpowers/specs/2026-05-04-errors-investigation-design.md`
- Existing Traces design: `docs/superpowers/specs/2026-05-04-traces-investigation-design.md`
- PRD: `PRD.md`
- Existing query route: `apps/api/src/routes/query.ts`
- Existing telemetry query repository: `packages/db/src/repositories/telemetry-query.ts`
- Existing investigation shell: `apps/console/src/components/InvestigationWorkspace.tsx`
- Existing Traces panel pattern: `apps/console/src/components/TraceInvestigationPanel.tsx`

## File Structure

Create:

```txt
apps/console/src/components/LlmInvestigationPanel.tsx
apps/console/src/components/LlmFilters.tsx
apps/console/src/components/LlmAggregateStrip.tsx
apps/console/src/components/LlmCallList.tsx
apps/console/src/components/LlmCallDetailDrawer.tsx
apps/console/src/components/LlmInvestigationPanel.test.tsx
apps/console/src/components/LlmCallDetailDrawer.test.tsx
```

Modify:

```txt
apps/api/src/routes/query.ts
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
apps/console/src/components/ConsoleShell.test.tsx
apps/console/src/components/ErrorInvestigationPanel.test.tsx
apps/console/src/components/EventInvestigationPanel.test.tsx
apps/console/src/components/InvestigationWorkspace.test.tsx
apps/console/src/components/InvestigationWorkspace.tsx
apps/console/src/components/TraceInvestigationPanel.test.tsx
apps/console/src/components/UserAdminPanel.test.tsx
apps/console/src/styles.css
.claude/docs/ARCHITECTURE.md
.claude/docs/UI-UX.md
.claude/docs/PROJECT-SUMMARY.md
CLAUDE.md
```

Responsibilities:

- `query.ts`: parse and forward LLM-specific exact filters only on LLM list and aggregate routes.
- `telemetry-query.ts`: apply LLM-specific exact filters to LLM list and aggregate DB queries.
- `client.ts`: expose typed LLM list and aggregate methods and encode only supported filters for each route type.
- `LlmInvestigationPanel.tsx`: LLM call query state, aggregate query state, filter application/reset, selected call, stale-response guards, retry actions.
- `LlmFilters.tsx`: controlled LLM filter form and `Apply` / `Reset` actions.
- `LlmAggregateStrip.tsx`: compact total calls, token, and cost strip with independent loading/unavailable states.
- `LlmCallList.tsx`: dense read-only list of raw LLM call rows.
- `LlmCallDetailDrawer.tsx`: selected LLM call detail drawer.
- `InvestigationWorkspace.tsx`: active investigation tab state and panel switching across Events, Errors, Traces, and LLM.

## Task 1: Add LLM-Specific Query Filters To API And DB

**Files:**
- Modify: `apps/api/src/routes/query.ts`
- Modify: `apps/api/test/query.test.ts`
- Modify: `packages/db/src/repositories/telemetry-query.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Write failing API route tests for LLM filters**

Add these tests to `apps/api/test/query.test.ts` before `it("returns 501 when a query dependency method is missing"`:

```ts
  it("forwards LLM-specific filters for LLM call queries", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listLlmCalls: async (filters) => {
          receivedFilters.push(filters);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/llm-calls?project_id=prj_1&environment_id=env_1&provider=openai&model=gpt-5&prompt_name=generate_sql&status=success&limit=25"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        status: "success",
        limit: 25
      }
    ]);
  });

  it("forwards LLM-specific filters for LLM aggregate queries", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmAggregates: async (filters) => {
          receivedFilters.push(filters);
          return { totalCalls: 1 };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/aggregates/llm?project_id=prj_1&environment_id=env_1&provider=openai&model=gpt-5&prompt_name=generate_sql&status=success"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        status: "success",
        limit: 50
      }
    ]);
  });

  it("does not forward LLM-specific filters for event aggregate queries", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getEventAggregates: async (filters) => {
          receivedFilters.push(filters);
          return { total: 2 };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/aggregates/events?project_id=prj_1&environment_id=env_1&provider=openai&model=gpt-5&prompt_name=generate_sql&status=success"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        limit: 50
      }
    ]);
  });
```

- [ ] **Step 2: Run API query tests and verify they fail**

Run:

```sh
pnpm test apps/api/test/query.test.ts
```

Expected: fail because `provider`, `model`, `promptName`, and LLM `status` are not parsed or forwarded yet.

- [ ] **Step 3: Implement LLM filter parsing**

Modify `apps/api/src/routes/query.ts`.

Add fields to `QueryFilters`:

```ts
  provider?: string;
  model?: string;
  promptName?: string;
```

Change `parseFilters` options type:

```ts
function parseFilters(
  query: unknown,
  options: { includeEventName?: boolean; includeErrorFilters?: boolean; includeLlmFilters?: boolean } = {}
): QueryFilters | undefined {
```

Inside `parseFilters`, after the `includeErrorFilters` block, add:

```ts
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
```

Change `handleListRoute` filter options type:

```ts
  filterOptions?: { includeEventName?: boolean; includeErrorFilters?: boolean; includeLlmFilters?: boolean }
```

Change `handleAggregateRoute` filter options type:

```ts
  filterOptions?: { includeEventName?: boolean; includeErrorFilters?: boolean; includeLlmFilters?: boolean }
```

Change the LLM list route to pass LLM filter options:

```ts
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
```

Change the LLM aggregate route to pass LLM filter options:

```ts
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
```

Do not pass `{ includeLlmFilters: true }` to Events, Errors, Traces, Trace spans, or unrelated aggregate routes.

- [ ] **Step 4: Run API query tests and verify they pass**

Run:

```sh
pnpm test apps/api/test/query.test.ts
```

Expected: pass.

- [ ] **Step 5: Write failing DB repository tests for LLM filters**

Add this test to `packages/db/test/repositories.test.ts` after `it("supports runtime telemetry list and aggregate helpers"`:

```ts
  it("filters LLM calls and aggregates by exact LLM fields", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "LLM Filters" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_llm",
        userId: "user_llm",
        sessionId: "session_llm",
        traceId: "trace_llm",
        timestamp: new Date("2026-05-05T12:00:00.000Z"),
        receivedAt: new Date("2026-05-05T12:00:01.000Z")
      };

      await insertLlmCall(db, {
        ...base,
        id: "llm_match",
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: "0.250000",
        latencyMs: 1200,
        status: "success"
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_other_model",
        provider: "openai",
        model: "gpt-4",
        promptName: "generate_sql",
        inputTokens: 100,
        outputTokens: 200,
        costUsd: "2.500000",
        latencyMs: 2200,
        status: "success"
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_other_status",
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        inputTokens: 5,
        outputTokens: 6,
        costUsd: "0.050000",
        latencyMs: 800,
        status: "error"
      });

      const filters = {
        projectId: project.id,
        environmentId: environment.id,
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        status: "success"
      };

      await expect(listLlmCalls(db, filters)).resolves.toEqual([expect.objectContaining({ id: "llm_match" })]);
      await expect(getLlmAggregates(db, filters)).resolves.toMatchObject({
        totalCalls: 1,
        totalInputTokens: 10,
        totalOutputTokens: 20,
        totalCostUsd: "0.250000"
      });
    });
  });
```

- [ ] **Step 6: Run DB repository tests and verify they fail**

Run:

```sh
pnpm test packages/db/test/repositories.test.ts
```

Expected: fail because `TelemetryFilters` does not include LLM-specific fields and the LLM queries do not filter by them.

- [ ] **Step 7: Implement DB LLM filters**

Modify `packages/db/src/repositories/telemetry-query.ts`.

Add fields to `TelemetryFilters`:

```ts
  provider?: string;
  model?: string;
  promptName?: string;
```

In `listLlmCalls`, after the shared filters and before `from` / `to`, add:

```ts
  if (filters.provider) query = query.where("provider", "=", filters.provider);
  if (filters.model) query = query.where("model", "=", filters.model);
  if (filters.promptName) query = query.where("prompt_name", "=", filters.promptName);
  if (filters.status) query = query.where("status", "=", filters.status);
```

In `getLlmAggregates`, after the shared filters and before `from` / `to`, add:

```ts
  if (filters.provider) query = query.where("provider", "=", filters.provider);
  if (filters.model) query = query.where("model", "=", filters.model);
  if (filters.promptName) query = query.where("prompt_name", "=", filters.promptName);
  if (filters.status) query = query.where("status", "=", filters.status);
```

Do not apply these LLM-specific filters to `listEvents`, `listErrors`, `listTraces`, `listTraceSpans`, `getEventAggregates`, `getErrorAggregates`, or `getTraceAggregates`.

- [ ] **Step 8: Run backend verification**

Run:

```sh
pnpm test apps/api/test/query.test.ts packages/db/test/repositories.test.ts
pnpm --filter @signal-hub/api build
pnpm --filter @signal-hub/db build
```

Expected: pass.

- [ ] **Step 9: Commit backend LLM filters**

Run:

```sh
git add apps/api/src/routes/query.ts apps/api/test/query.test.ts packages/db/src/repositories/telemetry-query.ts packages/db/test/repositories.test.ts
git commit -m "feat: add llm query filters"
```

## Task 2: Type LLM Query Results In The Console API Client

**Files:**
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Modify: `apps/console/src/api/client.test.ts`
- Modify: `apps/console/src/App.test.tsx`
- Modify: `apps/console/src/components/ApiKeyPanel.test.tsx`
- Modify: `apps/console/src/components/AuthGate.test.tsx`
- Modify: `apps/console/src/components/ConnectionCheck.test.tsx`
- Modify: `apps/console/src/components/ConsoleShell.test.tsx`
- Modify: `apps/console/src/components/ErrorInvestigationPanel.test.tsx`
- Modify: `apps/console/src/components/EventInvestigationPanel.test.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.test.tsx`
- Modify: `apps/console/src/components/TraceInvestigationPanel.test.tsx`
- Modify: `apps/console/src/components/UserAdminPanel.test.tsx`

- [ ] **Step 1: Write failing client tests for LLM routes**

Add these tests to `apps/console/src/api/client.test.ts` after the trace query tests:

```ts
  it("encodes LLM call query filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listLlmCalls({
      projectId: "prj_1",
      environmentId: "env_1",
      provider: "openai",
      model: "gpt-5",
      promptName: "generate_sql",
      status: "success",
      tenantId: "tenant_1",
      userId: "user_1",
      sessionId: "session_1",
      traceId: "trace_1",
      from: "2026-05-05T12:00:00.000Z",
      to: "2026-05-05T13:00:00.000Z",
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/llm-calls?project_id=prj_1&environment_id=env_1&tenant_id=tenant_1&user_id=user_1&session_id=session_1&trace_id=trace_1&provider=openai&model=gpt-5&prompt_name=generate_sql&status=success&from=2026-05-05T12%3A00%3A00.000Z&to=2026-05-05T13%3A00%3A00.000Z&limit=25",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes LLM aggregate filters without list-only limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getLlmAggregates({
      projectId: "prj_1",
      environmentId: "env_1",
      provider: "openai",
      model: "gpt-5",
      promptName: "generate_sql",
      status: "success",
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/aggregates/llm?project_id=prj_1&environment_id=env_1&provider=openai&model=gpt-5&prompt_name=generate_sql&status=success",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("does not encode LLM-specific filters for trace queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listTraces({
      projectId: "prj_1",
      environmentId: "env_1",
      provider: "openai",
      model: "gpt-5",
      promptName: "generate_sql",
      status: "success"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/traces?project_id=prj_1&environment_id=env_1",
      expect.objectContaining({ method: "GET" })
    );
  });
```

- [ ] **Step 2: Run client tests and verify they fail**

Run:

```sh
pnpm test apps/console/src/api/client.test.ts
```

Expected: fail because `LlmCallRecord`, `LlmAggregates`, `listLlmCalls`, `getLlmAggregates`, and LLM filter encoding do not exist in the console API client.

- [ ] **Step 3: Add LLM console types**

Modify `apps/console/src/api/types.ts`.

Add this type after `SpanRecord`:

```ts
export type LlmCallRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  timestamp: string;
  receivedAt: string;
  source: string | null;
  release: string | null;
  metadata: unknown;
  provider: string;
  model: string;
  promptName: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  latencyMs: number | null;
  status: string;
  error: string | null;
  inputPreview: string | null;
  outputPreview: string | null;
};

export type LlmAggregates = {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string;
};
```

Add LLM filter fields to `QueryFilters`:

```ts
  provider?: string;
  model?: string;
  promptName?: string;
```

- [ ] **Step 4: Type and implement LLM client methods**

Modify `apps/console/src/api/client.ts`.

Add imports:

```ts
  LlmAggregates,
  LlmCallRecord,
```

Add methods to `ApiClient` after `listTraceSpans`:

```ts
  listLlmCalls: (filters: QueryFilters) => Promise<QueryListResponse<LlmCallRecord>>;
  getLlmAggregates: (filters: QueryFilters) => Promise<AggregateResponse<LlmAggregates>>;
```

Change `queryPath` options type:

```ts
  options: { includeEventName?: boolean; includeErrorFilters?: boolean; includeLlmFilters?: boolean; includeLimit?: boolean } = {}
```

After the error filter encoding block, add:

```ts
  if (options.includeLlmFilters) {
    if (filters.provider) params.set("provider", filters.provider);
    if (filters.model) params.set("model", filters.model);
    if (filters.promptName) params.set("prompt_name", filters.promptName);
    if (filters.status) params.set("status", filters.status);
  }
```

Replace the limit encoding line with:

```ts
  if (filters.limit !== undefined && options.includeLimit !== false) params.set("limit", String(filters.limit));
```

Add implementations after `listTraceSpans`:

```ts
    listLlmCalls: (filters) =>
      request<QueryListResponse<LlmCallRecord>>(path(apiBasePath, queryPath("/query/llm-calls", filters, { includeLlmFilters: true }))),
    getLlmAggregates: (filters) =>
      request<AggregateResponse<LlmAggregates>>(
        path(apiBasePath, queryPath("/query/aggregates/llm", filters, { includeLlmFilters: true, includeLimit: false }))
      ),
```

Do not encode LLM-specific filters for Events, Errors, Traces, Trace spans, event aggregates, or error aggregates.

- [ ] **Step 5: Update typed test client helpers**

The `ApiClient` type now has two required LLM methods. In every `client(overrides: Partial<ApiClient>): ApiClient` helper and `satisfies ApiClient` mock in these files, add defaults after `listTraceSpans`:

```txt
apps/console/src/App.test.tsx
apps/console/src/components/ApiKeyPanel.test.tsx
apps/console/src/components/AuthGate.test.tsx
apps/console/src/components/ConnectionCheck.test.tsx
apps/console/src/components/ConsoleShell.test.tsx
apps/console/src/components/ErrorInvestigationPanel.test.tsx
apps/console/src/components/EventInvestigationPanel.test.tsx
apps/console/src/components/InvestigationWorkspace.test.tsx
apps/console/src/components/TraceInvestigationPanel.test.tsx
apps/console/src/components/UserAdminPanel.test.tsx
```

Add:

```ts
    listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
    getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } }),
```

Keep existing per-test overrides unchanged.

- [ ] **Step 6: Run client verification**

Run:

```sh
pnpm test apps/console/src/api/client.test.ts
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [ ] **Step 7: Commit typed LLM client**

Run:

```sh
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts apps/console/src/App.test.tsx apps/console/src/components/ApiKeyPanel.test.tsx apps/console/src/components/AuthGate.test.tsx apps/console/src/components/ConnectionCheck.test.tsx apps/console/src/components/ConsoleShell.test.tsx apps/console/src/components/ErrorInvestigationPanel.test.tsx apps/console/src/components/EventInvestigationPanel.test.tsx apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/TraceInvestigationPanel.test.tsx apps/console/src/components/UserAdminPanel.test.tsx
git commit -m "feat: type console llm queries"
```

## Task 3: Enable LLM Tab And Build LLM Investigation UI

**Files:**
- Create: `apps/console/src/components/LlmInvestigationPanel.tsx`
- Create: `apps/console/src/components/LlmFilters.tsx`
- Create: `apps/console/src/components/LlmAggregateStrip.tsx`
- Create: `apps/console/src/components/LlmCallList.tsx`
- Create: `apps/console/src/components/LlmCallDetailDrawer.tsx`
- Create: `apps/console/src/components/LlmInvestigationPanel.test.tsx`
- Create: `apps/console/src/components/LlmCallDetailDrawer.test.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.test.tsx`
- Modify: `apps/console/src/components/ConsoleShell.test.tsx`
- Modify: `apps/console/src/styles.css`

- [ ] **Step 1: Write failing workspace and shell tests**

Modify the tab-switch test in `apps/console/src/components/InvestigationWorkspace.test.tsx` so it verifies LLM is enabled:

```tsx
  it("switches between events errors traces and llm investigation views", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [] }),
      listErrors: vi.fn().mockResolvedValue({ data: [] }),
      listTraces: vi.fn().mockResolvedValue({ data: [] }),
      listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
      listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
      getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } })
    });

    render(<InvestigationWorkspace client={api} environmentId="env_1" projectId="prj_1" />);

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Errors" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Traces" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "LLM" })).toHaveAttribute("aria-pressed", "false");
    expect(await screen.findByText("No events found")).toBeInTheDocument();
    expect(api.listLlmCalls).not.toHaveBeenCalled();
    expect(api.getLlmAggregates).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "LLM" }));

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "LLM" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("No LLM calls found")).toBeInTheDocument();
    expect(api.listLlmCalls).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
    expect(api.getLlmAggregates).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });
```

Add this test to `apps/console/src/components/ConsoleShell.test.tsx` near the existing investigation background query tests:

```tsx
  it("does not query investigation LLM calls until the LLM tab is opened", async () => {
    const listLlmCalls = vi.fn().mockResolvedValue({ data: [] });
    const getLlmAggregates = vi.fn().mockResolvedValue({
      data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" }
    });
    const api = client({
      listLlmCalls,
      getLlmAggregates,
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));

    expect(listLlmCalls).not.toHaveBeenCalled();
    expect(getLlmAggregates).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "LLM" }));

    await waitFor(() => expect(listLlmCalls).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 }));
    expect(getLlmAggregates).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });
```

- [ ] **Step 2: Implement LLM tab wiring**

Modify `apps/console/src/components/InvestigationWorkspace.tsx`.

Import the panel:

```tsx
import { LlmInvestigationPanel } from "./LlmInvestigationPanel";
```

Change the tab type:

```tsx
type InvestigationTab = "events" | "errors" | "traces" | "llm";
```

Replace the disabled LLM button with:

```tsx
        <button aria-pressed={activeTab === "llm"} onClick={() => setActiveTab("llm")} type="button">
          LLM
        </button>
```

Render the panel:

```tsx
      {activeTab === "llm" ? <LlmInvestigationPanel client={client} environmentId={environmentId} projectId={projectId} /> : null}
```

- [ ] **Step 3: Run workspace tests and verify they fail**

Run:

```sh
pnpm test apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/ConsoleShell.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: fail because `LlmInvestigationPanel` does not exist.

- [ ] **Step 4: Write LLM detail drawer tests**

Create `apps/console/src/components/LlmCallDetailDrawer.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LlmCallRecord } from "../api/types";
import { LlmCallDetailDrawer } from "./LlmCallDetailDrawer";

const call: LlmCallRecord = {
  id: "llm_1",
  projectId: "prj_1",
  environmentId: "env_1",
  tenantId: "tenant_1",
  userId: "user_1",
  sessionId: "session_1",
  traceId: "trace_1",
  timestamp: "2026-05-05T12:00:00.000Z",
  receivedAt: "2026-05-05T12:00:01.000Z",
  source: "api",
  release: "1.0.0",
  metadata: { workflow: "checkout" },
  provider: "openai",
  model: "gpt-5",
  promptName: "generate_sql",
  inputTokens: 120,
  outputTokens: 80,
  costUsd: "0.250000",
  latencyMs: 1800,
  status: "success",
  error: null,
  inputPreview: "Generate SQL for checkout revenue",
  outputPreview: "select sum(total) from orders"
};

afterEach(() => cleanup());

describe("LlmCallDetailDrawer", () => {
  it("renders selected LLM call details", () => {
    render(<LlmCallDetailDrawer call={call} />);

    expect(screen.getByRole("heading", { name: "openai / gpt-5" })).toBeInTheDocument();
    expect(screen.getByText("generate_sql")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("0.250000")).toBeInTheDocument();
    expect(screen.getByText("1800 ms")).toBeInTheDocument();
    expect(screen.getByText("trace_1")).toBeInTheDocument();
    expect(screen.getByText("Generate SQL for checkout revenue")).toBeInTheDocument();
    expect(screen.getByText("select sum(total) from orders")).toBeInTheDocument();
    expect(screen.getByText(/"workflow": "checkout"/)).toBeInTheDocument();
  });

  it("renders empty selection state", () => {
    render(<LlmCallDetailDrawer />);

    expect(screen.getByText("Select an LLM call to inspect its details.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Write LLM panel tests**

Create `apps/console/src/components/LlmInvestigationPanel.test.tsx` with these required tests:

```tsx
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { LlmAggregates, LlmCallRecord } from "../api/types";
import { LlmInvestigationPanel } from "./LlmInvestigationPanel";

function llmCall(overrides: Partial<LlmCallRecord>): LlmCallRecord {
  return {
    id: "llm_1",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: "tenant_1",
    userId: "user_1",
    sessionId: "session_1",
    traceId: "trace_1",
    timestamp: "2026-05-05T12:00:00.000Z",
    receivedAt: "2026-05-05T12:00:01.000Z",
    source: "api",
    release: "1.0.0",
    metadata: {},
    provider: "openai",
    model: "gpt-5",
    promptName: "generate_sql",
    inputTokens: 120,
    outputTokens: 80,
    costUsd: "0.250000",
    latencyMs: 1800,
    status: "success",
    error: null,
    inputPreview: "input",
    outputPreview: "output",
    ...overrides
  };
}

function aggregates(overrides: Partial<LlmAggregates> = {}): LlmAggregates {
  return {
    totalCalls: 3,
    totalInputTokens: 300,
    totalOutputTokens: 200,
    totalCostUsd: "0.750000",
    ...overrides
  };
}

function client(overrides: Partial<ApiClient>): ApiClient {
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
    listTraces: vi.fn().mockResolvedValue({ data: [] }),
    listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
    listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getLlmAggregates: vi.fn().mockResolvedValue({ data: aggregates({ totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" }) }),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

afterEach(() => cleanup());

describe("LlmInvestigationPanel", () => {
  it("loads latest LLM calls and aggregate totals", async () => {
    const api = client({
      listLlmCalls: vi.fn().mockResolvedValue({ data: [llmCall({ provider: "openai", model: "gpt-5" })] }),
      getLlmAggregates: vi.fn().mockResolvedValue({ data: aggregates() })
    });

    render(<LlmInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("openai / gpt-5")).toBeInTheDocument();
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("0.750000")).toBeInTheDocument();
    expect(api.listLlmCalls).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
    expect(api.getLlmAggregates).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });

  it("applies filters only after Apply and clears selected call", async () => {
    const api = client({
      listLlmCalls: vi.fn().mockResolvedValue({ data: [llmCall({})] }),
      getLlmAggregates: vi.fn().mockResolvedValue({ data: aggregates() })
    });

    render(<LlmInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /openai \/ gpt-5/ }));
    expect(await screen.findByText("input")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Provider"), "anthropic");
    expect(api.listLlmCalls).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(api.listLlmCalls).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        provider: "anthropic",
        limit: 50
      })
    );
    expect(api.getLlmAggregates).toHaveBeenLastCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      provider: "anthropic",
      limit: 50
    });
    expect(screen.getByText("Select an LLM call to inspect its details.")).toBeInTheDocument();
  });

  it("shows independent unavailable states and retries", async () => {
    const api = client({
      listLlmCalls: vi.fn().mockRejectedValueOnce(new Error("list failed")).mockResolvedValueOnce({ data: [] }),
      getLlmAggregates: vi.fn().mockRejectedValueOnce(new Error("totals failed")).mockResolvedValueOnce({ data: aggregates() })
    });

    render(<LlmInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("LLM calls unavailable")).toBeInTheDocument();
    expect(await screen.findByText("LLM totals unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry calls" }));
    await userEvent.click(screen.getByRole("button", { name: "Retry totals" }));
    expect(await screen.findByText("No LLM calls found")).toBeInTheDocument();
    expect(await screen.findByText("0.750000")).toBeInTheDocument();
  });

  it("ignores stale LLM list and aggregate responses", async () => {
    const firstCalls = deferred<{ data: LlmCallRecord[] }>();
    const firstTotals = deferred<{ data: LlmAggregates }>();
    const api = client({
      listLlmCalls: vi.fn().mockReturnValueOnce(firstCalls.promise).mockResolvedValueOnce({ data: [llmCall({ provider: "anthropic", model: "claude", environmentId: "env_2" })] }),
      getLlmAggregates: vi.fn().mockReturnValueOnce(firstTotals.promise).mockResolvedValueOnce({ data: aggregates({ totalCalls: 9, totalCostUsd: "9.000000" }) })
    });

    const { rerender } = render(<LlmInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);
    rerender(<LlmInvestigationPanel client={api} environmentId="env_2" projectId="prj_1" />);

    expect(await screen.findByText("anthropic / claude")).toBeInTheDocument();
    expect(await screen.findByText("9.000000")).toBeInTheDocument();

    await act(async () => {
      firstCalls.resolve({ data: [llmCall({ provider: "old", model: "model" })] });
      firstTotals.resolve({ data: aggregates({ totalCalls: 1, totalCostUsd: "1.000000" }) });
      await Promise.all([firstCalls.promise, firstTotals.promise]);
    });

    expect(screen.queryByText("old / model")).not.toBeInTheDocument();
    expect(screen.queryByText("1.000000")).not.toBeInTheDocument();
    expect(screen.getByText("anthropic / claude")).toBeInTheDocument();
    expect(screen.getByText("9.000000")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run LLM UI tests and verify they fail**

Run:

```sh
pnpm test apps/console/src/components/LlmCallDetailDrawer.test.tsx apps/console/src/components/LlmInvestigationPanel.test.tsx
```

Expected: fail because LLM components do not exist.

- [ ] **Step 7: Implement LLM components**

Create `apps/console/src/components/LlmFilters.tsx`:

```tsx
import type { FormEvent } from "react";

export type LlmFilterValues = {
  provider: string;
  model: string;
  promptName: string;
  status: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  traceId: string;
  from: string;
  to: string;
  limit: string;
};

type Props = {
  values: LlmFilterValues;
  onChange: (values: LlmFilterValues) => void;
  onApply: () => void;
  onReset: () => void;
};

function update(values: LlmFilterValues, key: keyof LlmFilterValues, value: string): LlmFilterValues {
  return { ...values, [key]: value };
}

export function LlmFilters({ values, onChange, onApply, onReset }: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply();
  }

  return (
    <form className="event-filters llm-filters" onSubmit={submit}>
      <label>
        Provider
        <input value={values.provider} onChange={(event) => onChange(update(values, "provider", event.target.value))} />
      </label>
      <label>
        Model
        <input value={values.model} onChange={(event) => onChange(update(values, "model", event.target.value))} />
      </label>
      <label>
        Prompt
        <input value={values.promptName} onChange={(event) => onChange(update(values, "promptName", event.target.value))} />
      </label>
      <label>
        Status
        <input value={values.status} onChange={(event) => onChange(update(values, "status", event.target.value))} />
      </label>
      <label>
        Tenant
        <input value={values.tenantId} onChange={(event) => onChange(update(values, "tenantId", event.target.value))} />
      </label>
      <label>
        User
        <input value={values.userId} onChange={(event) => onChange(update(values, "userId", event.target.value))} />
      </label>
      <label>
        Session
        <input value={values.sessionId} onChange={(event) => onChange(update(values, "sessionId", event.target.value))} />
      </label>
      <label>
        Trace
        <input value={values.traceId} onChange={(event) => onChange(update(values, "traceId", event.target.value))} />
      </label>
      <label>
        From
        <input type="datetime-local" value={values.from} onChange={(event) => onChange(update(values, "from", event.target.value))} />
      </label>
      <label>
        To
        <input type="datetime-local" value={values.to} onChange={(event) => onChange(update(values, "to", event.target.value))} />
      </label>
      <label>
        Limit
        <input min="1" max="500" type="number" value={values.limit} onChange={(event) => onChange(update(values, "limit", event.target.value))} />
      </label>
      <div className="filter-actions">
        <button type="submit">Apply</button>
        <button onClick={onReset} type="button">
          Reset
        </button>
      </div>
    </form>
  );
}
```

Create `apps/console/src/components/LlmAggregateStrip.tsx`:

```tsx
import type { LlmAggregates } from "../api/types";

type State = "loading" | "ready" | "unavailable";

type Props = {
  state: State;
  totals?: LlmAggregates;
  onRetry: () => void;
};

function value(value: number | string | undefined): string {
  return value === undefined ? "none" : String(value);
}

export function LlmAggregateStrip({ state, totals, onRetry }: Props) {
  if (state === "unavailable") {
    return (
      <div className="status-box unavailable">
        <strong>LLM totals unavailable</strong>
        <button onClick={onRetry} type="button">
          Retry totals
        </button>
      </div>
    );
  }

  return (
    <div className="aggregate-strip" aria-label="LLM totals">
      <div>
        <span>Total calls</span>
        <strong>{state === "loading" ? "Loading" : value(totals?.totalCalls)}</strong>
      </div>
      <div>
        <span>Input tokens</span>
        <strong>{state === "loading" ? "Loading" : value(totals?.totalInputTokens)}</strong>
      </div>
      <div>
        <span>Output tokens</span>
        <strong>{state === "loading" ? "Loading" : value(totals?.totalOutputTokens)}</strong>
      </div>
      <div>
        <span>Total cost</span>
        <strong>{state === "loading" ? "Loading" : value(totals?.totalCostUsd)}</strong>
      </div>
    </div>
  );
}
```

Create `apps/console/src/components/LlmCallList.tsx`:

```tsx
import type { LlmCallRecord } from "../api/types";

type Props = {
  calls: LlmCallRecord[];
  selectedCallId?: string;
  onSelect: (call: LlmCallRecord) => void;
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function duration(value: number | null): string {
  return value === null ? "none" : `${value} ms`;
}

function label(value: string | null): string {
  return value ?? "none";
}

function tokenTotal(call: LlmCallRecord): string {
  return String(call.inputTokens + call.outputTokens);
}

export function LlmCallList({ calls, selectedCallId, onSelect }: Props) {
  return (
    <div className="event-list" aria-label="LLM calls">
      {calls.map((call) => (
        <button
          aria-pressed={call.id === selectedCallId}
          className="event-row llm-row"
          key={call.id}
          onClick={() => onSelect(call)}
          type="button"
        >
          <span>
            <strong>{call.provider} / {call.model}</strong>
            <code>{call.id}</code>
          </span>
          <span>{label(call.promptName)}</span>
          <span>{call.status}</span>
          <span>{call.costUsd}</span>
          <span>{tokenTotal(call)}</span>
          <span>{duration(call.latencyMs)}</span>
          <span>{formatTimestamp(call.timestamp)}</span>
          <span>{label(call.userId)}</span>
          <span>{label(call.tenantId)}</span>
        </button>
      ))}
    </div>
  );
}
```

Create `apps/console/src/components/LlmCallDetailDrawer.tsx`:

```tsx
import type { LlmCallRecord } from "../api/types";

type Props = {
  call?: LlmCallRecord;
};

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function detailValue(value: string | null | undefined): string {
  return value ?? "none";
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function duration(value: number | null): string {
  return value === null ? "none" : `${value} ms`;
}

export function LlmCallDetailDrawer({ call }: Props) {
  if (!call) {
    return (
      <aside className="detail-drawer">
        <p className="muted-text">Select an LLM call to inspect its details.</p>
      </aside>
    );
  }

  return (
    <aside className="detail-drawer">
      <div className="panel-header">
        <h2>{call.provider} / {call.model}</h2>
      </div>
      <dl className="detail-grid">
        <dt>ID</dt>
        <dd><code>{call.id}</code></dd>
        <dt>Prompt</dt>
        <dd>{detailValue(call.promptName)}</dd>
        <dt>Status</dt>
        <dd>{call.status}</dd>
        <dt>Input tokens</dt>
        <dd>{call.inputTokens}</dd>
        <dt>Output tokens</dt>
        <dd>{call.outputTokens}</dd>
        <dt>Cost</dt>
        <dd>{call.costUsd}</dd>
        <dt>Latency</dt>
        <dd>{duration(call.latencyMs)}</dd>
        <dt>Project</dt>
        <dd>{call.projectId}</dd>
        <dt>Environment</dt>
        <dd>{call.environmentId}</dd>
        <dt>Timestamp</dt>
        <dd>{formatTimestamp(call.timestamp)}</dd>
        <dt>Received</dt>
        <dd>{formatTimestamp(call.receivedAt)}</dd>
        <dt>Tenant</dt>
        <dd>{detailValue(call.tenantId)}</dd>
        <dt>User</dt>
        <dd>{detailValue(call.userId)}</dd>
        <dt>Session</dt>
        <dd>{detailValue(call.sessionId)}</dd>
        <dt>Trace</dt>
        <dd>{detailValue(call.traceId)}</dd>
        <dt>Source</dt>
        <dd>{detailValue(call.source)}</dd>
        <dt>Release</dt>
        <dd>{detailValue(call.release)}</dd>
      </dl>
      <section className="json-section">
        <h3>Error</h3>
        <pre><code>{call.error ?? "none"}</code></pre>
      </section>
      <section className="json-section">
        <h3>Input preview</h3>
        <pre><code>{call.inputPreview ?? "none"}</code></pre>
      </section>
      <section className="json-section">
        <h3>Output preview</h3>
        <pre><code>{call.outputPreview ?? "none"}</code></pre>
      </section>
      <section className="json-section">
        <h3>Metadata JSON</h3>
        <pre><code>{formatJson(call.metadata)}</code></pre>
      </section>
    </aside>
  );
}
```

Create `apps/console/src/components/LlmInvestigationPanel.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api/client";
import type { LlmAggregates, LlmCallRecord, QueryFilters } from "../api/types";
import { LlmAggregateStrip } from "./LlmAggregateStrip";
import { LlmCallDetailDrawer } from "./LlmCallDetailDrawer";
import { LlmCallList } from "./LlmCallList";
import { LlmFilters, type LlmFilterValues } from "./LlmFilters";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
};

type LoadState = "loading" | "ready" | "empty" | "unavailable";
type AggregateState = "loading" | "ready" | "unavailable";

const defaultFilters: LlmFilterValues = {
  provider: "",
  model: "",
  promptName: "",
  status: "",
  tenantId: "",
  userId: "",
  sessionId: "",
  traceId: "",
  from: "",
  to: "",
  limit: "50"
};

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toLimit(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 50;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(500, Math.max(1, Math.trunc(parsed)));
}

function queryFromValues(projectId: string, environmentId: string, values: LlmFilterValues): QueryFilters {
  const query: QueryFilters = { projectId, environmentId, limit: toLimit(values.limit) };
  const provider = values.provider.trim();
  const model = values.model.trim();
  const promptName = values.promptName.trim();
  const status = values.status.trim();
  const tenantId = values.tenantId.trim();
  const userId = values.userId.trim();
  const sessionId = values.sessionId.trim();
  const traceId = values.traceId.trim();
  const from = toIso(values.from);
  const to = toIso(values.to);

  if (provider) query.provider = provider;
  if (model) query.model = model;
  if (promptName) query.promptName = promptName;
  if (status) query.status = status;
  if (tenantId) query.tenantId = tenantId;
  if (userId) query.userId = userId;
  if (sessionId) query.sessionId = sessionId;
  if (traceId) query.traceId = traceId;
  if (from) query.from = from;
  if (to) query.to = to;
  return query;
}

export function LlmInvestigationPanel({ client, projectId, environmentId }: Props) {
  const [draftFilters, setDraftFilters] = useState<LlmFilterValues>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<LlmFilterValues>(defaultFilters);
  const [reloadToken, setReloadToken] = useState(0);
  const [aggregateReloadToken, setAggregateReloadToken] = useState(0);
  const [calls, setCalls] = useState<LlmCallRecord[]>([]);
  const [selectedCall, setSelectedCall] = useState<LlmCallRecord | undefined>();
  const [totals, setTotals] = useState<LlmAggregates | undefined>();
  const [state, setState] = useState<LoadState>("loading");
  const [aggregateState, setAggregateState] = useState<AggregateState>("loading");
  const query = useMemo(
    () => queryFromValues(projectId, environmentId, appliedFilters),
    [projectId, environmentId, appliedFilters]
  );

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setSelectedCall(undefined);

    void client.listLlmCalls(query).then(
      ({ data }) => {
        if (cancelled) return;
        setCalls(data);
        setState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setCalls([]);
        setState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, query, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    setAggregateState("loading");

    void client.getLlmAggregates(query).then(
      ({ data }) => {
        if (cancelled) return;
        setTotals(data);
        setAggregateState("ready");
      },
      () => {
        if (cancelled) return;
        setTotals(undefined);
        setAggregateState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, query, aggregateReloadToken]);

  function applyFilters() {
    setAppliedFilters({ ...draftFilters });
  }

  function resetFilters() {
    setDraftFilters(defaultFilters);
    setAppliedFilters({ ...defaultFilters });
    setReloadToken((current) => current + 1);
    setAggregateReloadToken((current) => current + 1);
  }

  function retryCalls() {
    setReloadToken((current) => current + 1);
  }

  function retryTotals() {
    setAggregateReloadToken((current) => current + 1);
  }

  return (
    <section className="investigation-layout">
      <div className="panel event-panel">
        <div className="panel-header">
          <h2>LLM</h2>
        </div>
        <LlmAggregateStrip onRetry={retryTotals} state={aggregateState} totals={totals} />
        <LlmFilters values={draftFilters} onApply={applyFilters} onChange={setDraftFilters} onReset={resetFilters} />
        {state === "loading" ? <p className="muted-text">Loading LLM calls</p> : null}
        {state === "unavailable" ? (
          <div className="status-box unavailable">
            <strong>LLM calls unavailable</strong>
            <button onClick={retryCalls} type="button">
              Retry calls
            </button>
          </div>
        ) : null}
        {state === "empty" ? <p className="muted-text">No LLM calls found</p> : null}
        {state === "ready" ? <LlmCallList calls={calls} onSelect={setSelectedCall} selectedCallId={selectedCall?.id} /> : null}
      </div>
      <LlmCallDetailDrawer call={selectedCall} />
    </section>
  );
}
```

- [ ] **Step 8: Add LLM styles**

Append near `.trace-row` in `apps/console/src/styles.css`:

```css
.llm-filters {
  grid-template-columns: repeat(4, minmax(140px, 1fr));
}

.llm-row {
  grid-template-columns:
    minmax(190px, 1.4fr)
    minmax(130px, 0.9fr)
    minmax(80px, 0.55fr)
    minmax(90px, 0.55fr)
    minmax(80px, 0.55fr)
    minmax(90px, 0.55fr)
    minmax(150px, 1fr)
    repeat(2, minmax(110px, 0.7fr));
}

.aggregate-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.aggregate-strip > div {
  border: 1px solid #d7dde7;
  border-radius: 8px;
  background: #fff;
  padding: 10px;
}

.aggregate-strip span {
  display: block;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.aggregate-strip strong {
  display: block;
  margin-top: 4px;
  color: #111827;
  font-size: 16px;
}
```

In the existing mobile media query block, include `.aggregate-strip` with the one-column layouts:

```css
  .investigation-layout,
  .event-filters,
  .aggregate-strip,
  .event-row {
    grid-template-columns: 1fr;
  }
```

- [ ] **Step 9: Run LLM UI verification**

Run:

```sh
pnpm test apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/LlmCallDetailDrawer.test.tsx apps/console/src/components/LlmInvestigationPanel.test.tsx apps/console/src/components/ConsoleShell.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [ ] **Step 10: Commit LLM UI**

Run:

```sh
git add apps/console/src/components/InvestigationWorkspace.tsx apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/ConsoleShell.test.tsx apps/console/src/components/LlmInvestigationPanel.tsx apps/console/src/components/LlmFilters.tsx apps/console/src/components/LlmAggregateStrip.tsx apps/console/src/components/LlmCallList.tsx apps/console/src/components/LlmCallDetailDrawer.tsx apps/console/src/components/LlmInvestigationPanel.test.tsx apps/console/src/components/LlmCallDetailDrawer.test.tsx apps/console/src/styles.css
git commit -m "feat: add llm investigation workspace"
```

## Task 4: Update Docs And Run Final Verification

**Files:**
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update architecture docs**

Append this paragraph to `## Investigation Console` in `.claude/docs/ARCHITECTURE.md`:

```md
The console also includes a read-only LLM view for raw AI calls and compact aggregate totals. It uses `GET /query/llm-calls` for call rows and `GET /query/aggregates/llm` for total calls, input tokens, output tokens, and total cost. This slice supports exact `provider`, `model`, `prompt_name`, and `status` filters and does not add charts, grouping, mutation, cross-signal timelines, storage tables, or ingestion routes.
```

- [ ] **Step 2: Update UI/UX docs**

Append these bullets to `## Investigation UX` in `.claude/docs/UI-UX.md`:

```md
- Keep LLM as a peer tab with Events, Errors, and Traces inside `Investigate`.
- LLM uses the same filter/list/detail pattern, with a compact aggregate strip for calls, tokens, and total cost.
- LLM rows should prioritize provider/model, prompt, status, cost, tokens, latency, time, user, and tenant.
- LLM details should show immutable identifiers, cost and token fields, previews, error text, and metadata JSON.
```

- [ ] **Step 3: Update project summary**

In `.claude/docs/PROJECT-SUMMARY.md`, add this implemented capability:

```md
- Read-only LLM investigation workspace with exact provider, model, prompt, and status filtering plus aggregate totals.
```

- [ ] **Step 4: Update CLAUDE.md convention if missing**

If this line does not already exist under `## Project Conventions`, add it:

```md
- Keep investigation console views read-only unless a design explicitly introduces a mutation workflow.
```

If the line already exists, do not duplicate it.

- [ ] **Step 5: Run final verification**

Run:

```sh
pnpm test
pnpm build
docker compose config --quiet
```

Expected: all pass.

- [ ] **Step 6: Commit docs**

Run:

```sh
git add .claude/docs/ARCHITECTURE.md .claude/docs/UI-UX.md .claude/docs/PROJECT-SUMMARY.md CLAUDE.md
git commit -m "docs: document llm investigation console"
```

## Final Review

- [ ] Run `git status -sb` and confirm the worktree is clean.
- [ ] Run `git log --oneline -10` and confirm the task commits are readable.
- [ ] Run final code review across the implementation range before merging.
- [ ] Use `superpowers:finishing-a-development-branch` after final review approves.
