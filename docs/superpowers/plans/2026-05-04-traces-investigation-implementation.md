# Phase 3 Traces Investigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Traces investigation view with lazy span timeline details inside the existing `Investigate` workspace.

**Architecture:** Reuse the existing human-session query routes: `GET /query/traces` for raw traces and `GET /query/traces/:id/spans` for spans. Keep the console pattern established by Events and Errors: tab-gated panel mounting, filters that apply only on `Apply`, list/detail layout, retry/empty/unavailable states, and stale-response guards. This slice adds no backend routes, storage tables, mutation workflows, charts, cross-signal timelines, or new indexes.

**Tech Stack:** Fastify query API, Kysely/Postgres repositories, Vite + React + TypeScript, Testing Library, Vitest, pnpm workspaces.

---

## Source Documents

- Approved spec: `docs/superpowers/specs/2026-05-04-traces-investigation-design.md`
- Existing Events design: `docs/superpowers/specs/2026-05-04-phase3-events-investigation-design.md`
- Existing Errors design: `docs/superpowers/specs/2026-05-04-errors-investigation-design.md`
- PRD: `PRD.md`
- Existing query route: `apps/api/src/routes/query.ts`
- Existing telemetry query repository: `packages/db/src/repositories/telemetry-query.ts`
- Existing investigation shell: `apps/console/src/components/InvestigationWorkspace.tsx`
- Existing Events panel pattern: `apps/console/src/components/EventInvestigationPanel.tsx`
- Existing Errors panel pattern: `apps/console/src/components/ErrorInvestigationPanel.tsx`

## File Structure

Create:

```txt
apps/console/src/components/TraceInvestigationPanel.tsx
apps/console/src/components/TraceFilters.tsx
apps/console/src/components/TraceList.tsx
apps/console/src/components/TraceDetailDrawer.tsx
apps/console/src/components/SpanTimeline.tsx
apps/console/src/components/TraceInvestigationPanel.test.tsx
apps/console/src/components/TraceDetailDrawer.test.tsx
```

Modify:

```txt
apps/console/src/api/types.ts
apps/console/src/api/client.ts
apps/console/src/api/client.test.ts
apps/console/src/components/ApiKeyPanel.test.tsx
apps/console/src/components/AuthGate.test.tsx
apps/console/src/components/ConnectionCheck.test.tsx
apps/console/src/components/ErrorInvestigationPanel.test.tsx
apps/console/src/components/EventInvestigationPanel.test.tsx
apps/console/src/components/InvestigationWorkspace.tsx
apps/console/src/components/InvestigationWorkspace.test.tsx
apps/console/src/components/ConsoleShell.test.tsx
apps/console/src/components/UserAdminPanel.test.tsx
apps/console/src/styles.css
.claude/docs/ARCHITECTURE.md
.claude/docs/UI-UX.md
.claude/docs/PROJECT-SUMMARY.md
CLAUDE.md
```

Responsibilities:

- `TraceInvestigationPanel.tsx`: trace query state, span query state, filter application/reset, selected trace, stale-response guards, retry actions.
- `TraceFilters.tsx`: controlled trace filter form and `Apply` / `Reset` actions.
- `TraceList.tsx`: dense read-only list of raw trace rows.
- `TraceDetailDrawer.tsx`: selected trace detail and span-state orchestration surface.
- `SpanTimeline.tsx`: ordered span list and formatted JSON sections.
- `InvestigationWorkspace.tsx`: active investigation tab state and panel switching across Events, Errors, and Traces.

## Task 1: Type Trace Query Results In The Console API Client

**Files:**
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Modify: `apps/console/src/api/client.test.ts`
- Modify: `apps/console/src/components/ApiKeyPanel.test.tsx`
- Modify: `apps/console/src/components/AuthGate.test.tsx`
- Modify: `apps/console/src/components/ConnectionCheck.test.tsx`
- Modify: `apps/console/src/components/ErrorInvestigationPanel.test.tsx`
- Modify: `apps/console/src/components/EventInvestigationPanel.test.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.test.tsx`
- Modify: `apps/console/src/components/ConsoleShell.test.tsx`
- Modify: `apps/console/src/components/UserAdminPanel.test.tsx`

- [ ] **Step 1: Write failing client tests for trace routes**

Add these tests to `apps/console/src/api/client.test.ts` after the query-param encoding tests:

```ts
  it("encodes trace query filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listTraces({
      projectId: "prj_1",
      environmentId: "env_1",
      traceId: "trace_1",
      tenantId: "tenant_1",
      userId: "user_1",
      sessionId: "session_1",
      from: "2026-05-04T12:00:00.000Z",
      to: "2026-05-04T13:00:00.000Z",
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/traces?project_id=prj_1&environment_id=env_1&tenant_id=tenant_1&user_id=user_1&session_id=session_1&trace_id=trace_1&from=2026-05-04T12%3A00%3A00.000Z&to=2026-05-04T13%3A00%3A00.000Z&limit=25",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes trace span query path and scope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listTraceSpans("trace/1", {
      projectId: "prj_1",
      environmentId: "env_1"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/traces/trace%2F1/spans?project_id=prj_1&environment_id=env_1",
      expect.objectContaining({ method: "GET" })
    );
  });
```

- [ ] **Step 2: Run client tests and verify they fail**

Run:

```sh
pnpm test apps/console/src/api/client.test.ts
```

Expected: fail because `listTraces`, `listTraceSpans`, `TraceRecord`, and `SpanRecord` do not exist in the console API client.

- [ ] **Step 3: Add trace and span response types**

Modify `apps/console/src/api/types.ts`.

Add this type after `ErrorRecord`:

```ts
export type TraceRecord = {
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
  name: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
};
```

Add this type after `TraceRecord`:

```ts
export type SpanRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string;
  timestamp: string;
  receivedAt: string;
  source: string | null;
  release: string | null;
  metadata: unknown;
  parentSpanId: string | null;
  name: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  input: unknown | null;
  output: unknown | null;
  error: unknown | null;
  costUsd: string | null;
};
```

- [ ] **Step 4: Type trace client methods and implement routes**

Modify `apps/console/src/api/client.ts`.

Add `SpanRecord` and `TraceRecord` to the type imports:

```ts
  SpanRecord,
  TraceRecord,
```

Add methods to `ApiClient` after `listErrors`:

```ts
  listTraces: (filters: QueryFilters) => Promise<QueryListResponse<TraceRecord>>;
  listTraceSpans: (traceId: string, filters: QueryFilters) => Promise<QueryListResponse<SpanRecord>>;
```

Add implementations after `listErrors`:

```ts
    listTraces: (filters) => request<QueryListResponse<TraceRecord>>(path(apiBasePath, queryPath("/query/traces", filters))),
    listTraceSpans: (traceId, filters) =>
      request<QueryListResponse<SpanRecord>>(
        path(apiBasePath, queryPath(`/query/traces/${encodePathSegment(traceId)}/spans`, filters))
      ),
```

Do not add span-specific query params. `queryPath` already encodes project/environment and shared scope/date/limit filters.

- [ ] **Step 5: Update typed test client helpers**

The `ApiClient` type now has two required trace methods. In every `client(overrides: Partial<ApiClient>): ApiClient` helper in these files, add defaults after `listErrors`:

```txt
apps/console/src/components/ApiKeyPanel.test.tsx
apps/console/src/components/AuthGate.test.tsx
apps/console/src/components/ConnectionCheck.test.tsx
apps/console/src/components/ErrorInvestigationPanel.test.tsx
apps/console/src/components/EventInvestigationPanel.test.tsx
apps/console/src/components/InvestigationWorkspace.test.tsx
apps/console/src/components/ConsoleShell.test.tsx
apps/console/src/components/UserAdminPanel.test.tsx
```

Add:

```ts
    listTraces: vi.fn().mockResolvedValue({ data: [] }),
    listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
```

Keep existing per-test overrides unchanged.

- [ ] **Step 6: Run client verification**

Run:

```sh
pnpm test apps/console/src/api/client.test.ts
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [ ] **Step 7: Commit typed trace client**

Run:

```sh
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts apps/console/src/components/ApiKeyPanel.test.tsx apps/console/src/components/AuthGate.test.tsx apps/console/src/components/ConnectionCheck.test.tsx apps/console/src/components/ErrorInvestigationPanel.test.tsx apps/console/src/components/EventInvestigationPanel.test.tsx apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/ConsoleShell.test.tsx apps/console/src/components/UserAdminPanel.test.tsx
git commit -m "feat: type console trace queries"
```

## Task 2: Enable Traces Tab And Build Traces Investigation UI

**Files:**
- Create: `apps/console/src/components/TraceInvestigationPanel.tsx`
- Create: `apps/console/src/components/TraceFilters.tsx`
- Create: `apps/console/src/components/TraceList.tsx`
- Create: `apps/console/src/components/TraceDetailDrawer.tsx`
- Create: `apps/console/src/components/SpanTimeline.tsx`
- Create: `apps/console/src/components/TraceInvestigationPanel.test.tsx`
- Create: `apps/console/src/components/TraceDetailDrawer.test.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.test.tsx`
- Modify: `apps/console/src/components/ConsoleShell.test.tsx`
- Modify: `apps/console/src/styles.css`

- [ ] **Step 1: Write failing tab-switch test**

Modify `apps/console/src/components/InvestigationWorkspace.test.tsx`.

Update the tab-switch test so Traces is enabled and LLM remains disabled:

```tsx
  it("switches between events errors and traces investigation views", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [] }),
      listErrors: vi.fn().mockResolvedValue({ data: [] }),
      listTraces: vi.fn().mockResolvedValue({ data: [] }),
      listTraceSpans: vi.fn().mockResolvedValue({ data: [] })
    });

    render(<InvestigationWorkspace client={api} environmentId="env_1" projectId="prj_1" />);

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Errors" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Traces" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "LLM" })).toBeDisabled();
    expect(await screen.findByText("No events found")).toBeInTheDocument();
    expect(api.listTraces).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Traces" }));

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Traces" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("No traces found")).toBeInTheDocument();
    expect(api.listTraces).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
    expect(api.listTraceSpans).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Add shell regression test for no background Traces query**

Add this test to `apps/console/src/components/ConsoleShell.test.tsx` near the existing investigation background query tests:

```tsx
  it("does not query investigation traces until the traces tab is opened", async () => {
    const listTraces = vi.fn().mockResolvedValue({ data: [] });
    const listTraceSpans = vi.fn().mockResolvedValue({ data: [] });
    const api = client({
      listTraces,
      listTraceSpans,
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

    expect(listTraces).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Traces" }));

    await waitFor(() => expect(listTraces).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 }));
    expect(listTraceSpans).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Implement active Traces tab wiring**

Modify `apps/console/src/components/InvestigationWorkspace.tsx`.

Import the panel:

```tsx
import { TraceInvestigationPanel } from "./TraceInvestigationPanel";
```

Change the tab type:

```tsx
type InvestigationTab = "events" | "errors" | "traces";
```

Replace the disabled Traces button with an enabled button:

```tsx
        <button aria-pressed={activeTab === "traces"} onClick={() => setActiveTab("traces")} type="button">
          Traces
        </button>
```

Render the panel:

```tsx
      {activeTab === "traces" ? <TraceInvestigationPanel client={client} environmentId={environmentId} projectId={projectId} /> : null}
```

- [ ] **Step 4: Run workspace tests and verify they fail**

Run:

```sh
pnpm test apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/ConsoleShell.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: fail because `TraceInvestigationPanel` does not exist.

- [ ] **Step 5: Write trace detail drawer tests**

Create `apps/console/src/components/TraceDetailDrawer.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SpanRecord, TraceRecord } from "../api/types";
import { TraceDetailDrawer } from "./TraceDetailDrawer";

const trace: TraceRecord = {
  id: "trc_row_1",
  projectId: "prj_1",
  environmentId: "env_1",
  tenantId: "tenant_1",
  userId: "user_1",
  sessionId: "session_1",
  traceId: "trace_1",
  timestamp: "2026-05-04T12:00:00.000Z",
  receivedAt: "2026-05-04T12:00:01.000Z",
  source: "api",
  release: "1.0.0",
  metadata: { workflow: "checkout" },
  name: "checkout flow",
  status: "success",
  startedAt: "2026-05-04T12:00:00.000Z",
  endedAt: "2026-05-04T12:00:02.000Z",
  durationMs: 2000
};

const spans: SpanRecord[] = [
  {
    id: "spn_2",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: "tenant_1",
    userId: "user_1",
    sessionId: "session_1",
    traceId: "trace_1",
    timestamp: "2026-05-04T12:00:01.000Z",
    receivedAt: "2026-05-04T12:00:02.000Z",
    source: "api",
    release: "1.0.0",
    metadata: { cache: "miss" },
    parentSpanId: "spn_1",
    name: "charge card",
    status: "success",
    startedAt: "2026-05-04T12:00:01.000Z",
    endedAt: "2026-05-04T12:00:02.000Z",
    durationMs: 1000,
    input: { amount: 25 },
    output: { approved: true },
    error: null,
    costUsd: "0.0100"
  },
  {
    id: "spn_1",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: "tenant_1",
    userId: "user_1",
    sessionId: "session_1",
    traceId: "trace_1",
    timestamp: "2026-05-04T12:00:00.000Z",
    receivedAt: "2026-05-04T12:00:01.000Z",
    source: "api",
    release: "1.0.0",
    metadata: {},
    parentSpanId: null,
    name: "load cart",
    status: "success",
    startedAt: "2026-05-04T12:00:00.000Z",
    endedAt: "2026-05-04T12:00:01.000Z",
    durationMs: 1000,
    input: null,
    output: { items: 2 },
    error: null,
    costUsd: null
  }
];

afterEach(() => cleanup());

describe("TraceDetailDrawer", () => {
  it("renders selected trace details and ordered spans", () => {
    render(<TraceDetailDrawer spanState="ready" spans={spans} trace={trace} onRetrySpans={() => undefined} />);

    expect(screen.getByRole("heading", { name: "checkout flow" })).toBeInTheDocument();
    expect(screen.getByText("trace_1")).toBeInTheDocument();
    expect(screen.getAllByText("success").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("2000 ms")).toBeInTheDocument();
    expect(screen.getByText(/"workflow": "checkout"/)).toBeInTheDocument();
    expect(screen.getAllByText(/load cart|charge card/).map((node) => node.textContent)).toEqual(["load cart", "charge card"]);
    expect(screen.getByText("spn_1")).toBeInTheDocument();
    expect(screen.getByText(/"approved": true/)).toBeInTheDocument();
    expect(screen.getByText("0.0100")).toBeInTheDocument();
  });

  it("renders empty selection state", () => {
    render(<TraceDetailDrawer spanState="idle" spans={[]} onRetrySpans={() => undefined} />);

    expect(screen.getByText("Select a trace to inspect its spans.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Write trace panel tests**

Create `apps/console/src/components/TraceInvestigationPanel.test.tsx` with these required tests:

```tsx
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { SpanRecord, TraceRecord } from "../api/types";
import { TraceInvestigationPanel } from "./TraceInvestigationPanel";

function trace(overrides: Partial<TraceRecord>): TraceRecord {
  return {
    id: "trc_row_1",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: "tenant_1",
    userId: "user_1",
    sessionId: "session_1",
    traceId: "trace_1",
    timestamp: "2026-05-04T12:00:00.000Z",
    receivedAt: "2026-05-04T12:00:01.000Z",
    source: "api",
    release: "1.0.0",
    metadata: {},
    name: "checkout flow",
    status: "success",
    startedAt: "2026-05-04T12:00:00.000Z",
    endedAt: "2026-05-04T12:00:02.000Z",
    durationMs: 2000,
    ...overrides
  };
}

function span(overrides: Partial<SpanRecord>): SpanRecord {
  return {
    id: "spn_1",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: "tenant_1",
    userId: "user_1",
    sessionId: "session_1",
    traceId: "trace_1",
    timestamp: "2026-05-04T12:00:00.000Z",
    receivedAt: "2026-05-04T12:00:01.000Z",
    source: "api",
    release: "1.0.0",
    metadata: {},
    parentSpanId: null,
    name: "load cart",
    status: "success",
    startedAt: "2026-05-04T12:00:00.000Z",
    endedAt: "2026-05-04T12:00:01.000Z",
    durationMs: 1000,
    input: null,
    output: {},
    error: null,
    costUsd: null,
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
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
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

describe("TraceInvestigationPanel", () => {
  it("loads latest traces without loading spans", async () => {
    const api = client({
      listTraces: vi.fn().mockResolvedValue({ data: [trace({ name: "checkout flow" })] })
    });

    render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("checkout flow")).toBeInTheDocument();
    expect(api.listTraces).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
    expect(api.listTraceSpans).not.toHaveBeenCalled();
  });

  it("applies filters only after Apply and clears selected trace", async () => {
    const api = client({
      listTraces: vi.fn().mockResolvedValue({ data: [trace({ traceId: "trace_1" })] }),
      listTraceSpans: vi.fn().mockResolvedValue({ data: [span({})] })
    });

    render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /checkout flow/ }));
    expect(await screen.findByText("load cart")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Trace"), "trace_2");
    expect(api.listTraces).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(api.listTraces).toHaveBeenLastCalledWith({ projectId: "prj_1", environmentId: "env_1", traceId: "trace_2", limit: 50 })
    );
    expect(screen.getByText("Select a trace to inspect its spans.")).toBeInTheDocument();
  });

  it("loads spans when a trace is selected", async () => {
    const api = client({
      listTraces: vi.fn().mockResolvedValue({ data: [trace({ traceId: "trace_1" })] }),
      listTraceSpans: vi.fn().mockResolvedValue({ data: [span({ name: "load cart" })] })
    });

    render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /checkout flow/ }));

    expect(await screen.findByText("load cart")).toBeInTheDocument();
    expect(api.listTraceSpans).toHaveBeenCalledWith("trace_1", { projectId: "prj_1", environmentId: "env_1" });
  });

  it("shows independent unavailable states and retries", async () => {
    const api = client({
      listTraces: vi.fn().mockRejectedValueOnce(new Error("trace failed")).mockResolvedValueOnce({ data: [trace({})] }),
      listTraceSpans: vi.fn().mockRejectedValueOnce(new Error("span failed")).mockResolvedValueOnce({ data: [] })
    });

    render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("Traces unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry traces" }));
    await userEvent.click(await screen.findByRole("button", { name: /checkout flow/ }));
    expect(await screen.findByText("Spans unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry spans" }));
    expect(await screen.findByText("No spans found for this trace.")).toBeInTheDocument();
  });

  it("ignores stale trace responses after environment changes", async () => {
    const firstTraces = deferred<{ data: TraceRecord[] }>();
    const api = client({
      listTraces: vi.fn().mockReturnValueOnce(firstTraces.promise).mockResolvedValueOnce({ data: [trace({ environmentId: "env_2", name: "new trace" })] })
    });

    const { rerender } = render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);
    rerender(<TraceInvestigationPanel client={api} environmentId="env_2" projectId="prj_1" />);

    expect(await screen.findByText("new trace")).toBeInTheDocument();

    await act(async () => {
      firstTraces.resolve({ data: [trace({ name: "old trace" })] });
      await firstTraces.promise;
    });

    expect(screen.queryByText("old trace")).not.toBeInTheDocument();
    expect(screen.getByText("new trace")).toBeInTheDocument();
  });

  it("ignores stale span responses after selecting another trace", async () => {
    const firstSpans = deferred<{ data: SpanRecord[] }>();
    const api = client({
      listTraces: vi.fn().mockResolvedValue({
        data: [
          trace({ id: "trc_row_1", traceId: "trace_1", name: "old trace" }),
          trace({ id: "trc_row_2", traceId: "trace_2", name: "new trace" })
        ]
      }),
      listTraceSpans: vi.fn().mockReturnValueOnce(firstSpans.promise).mockResolvedValueOnce({ data: [span({ traceId: "trace_2", name: "new span" })] })
    });

    render(<TraceInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /old trace/ }));
    await userEvent.click(await screen.findByRole("button", { name: /new trace/ }));
    expect(await screen.findByText("new span")).toBeInTheDocument();

    await act(async () => {
      firstSpans.resolve({ data: [span({ name: "old span" })] });
      await firstSpans.promise;
    });

    expect(screen.queryByText("old span")).not.toBeInTheDocument();
    expect(screen.getByText("new span")).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run Traces UI tests and verify they fail**

Run:

```sh
pnpm test apps/console/src/components/TraceDetailDrawer.test.tsx apps/console/src/components/TraceInvestigationPanel.test.tsx
```

Expected: fail because Traces components do not exist.

- [ ] **Step 8: Implement `TraceFilters`**

Create `apps/console/src/components/TraceFilters.tsx`:

```tsx
import type { FormEvent } from "react";

export type TraceFilterValues = {
  traceId: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  from: string;
  to: string;
  limit: string;
};

type Props = {
  values: TraceFilterValues;
  onChange: (values: TraceFilterValues) => void;
  onApply: () => void;
  onReset: () => void;
};

function update(values: TraceFilterValues, key: keyof TraceFilterValues, value: string): TraceFilterValues {
  return { ...values, [key]: value };
}

export function TraceFilters({ values, onChange, onApply, onReset }: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply();
  }

  return (
    <form className="event-filters" onSubmit={submit}>
      <label>
        Trace
        <input value={values.traceId} onChange={(event) => onChange(update(values, "traceId", event.target.value))} />
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

- [ ] **Step 9: Implement `TraceList`**

Create `apps/console/src/components/TraceList.tsx`:

```tsx
import type { TraceRecord } from "../api/types";

type Props = {
  traces: TraceRecord[];
  selectedTraceId?: string;
  onSelect: (trace: TraceRecord) => void;
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

export function TraceList({ traces, selectedTraceId, onSelect }: Props) {
  return (
    <div className="event-list" aria-label="Traces">
      {traces.map((trace) => (
        <button
          aria-pressed={trace.id === selectedTraceId}
          className="event-row trace-row"
          key={trace.id}
          onClick={() => onSelect(trace)}
          type="button"
        >
          <span>
            <strong>{trace.name}</strong>
            <code>{trace.traceId ?? trace.id}</code>
          </span>
          <span>{trace.status}</span>
          <span>{duration(trace.durationMs)}</span>
          <span>{formatTimestamp(trace.startedAt)}</span>
          <span>{label(trace.userId)}</span>
          <span>{label(trace.tenantId)}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 10: Implement `SpanTimeline`**

Create `apps/console/src/components/SpanTimeline.tsx`:

```tsx
import type { SpanRecord } from "../api/types";

type Props = {
  spans: SpanRecord[];
};

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function detailValue(value: string | null | undefined): string {
  return value ?? "none";
}

function duration(value: number | null): string {
  return value === null ? "none" : `${value} ms`;
}

function ordered(spans: SpanRecord[]): SpanRecord[] {
  return [...spans].sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime());
}

export function SpanTimeline({ spans }: Props) {
  return (
    <section className="json-section">
      <h3>Spans</h3>
      <div className="span-timeline">
        {ordered(spans).map((span) => (
          <article className="span-row" key={span.id}>
            <header>
              <strong>{span.name}</strong>
              <code>{span.id}</code>
            </header>
            <dl className="detail-grid">
              <dt>Status</dt>
              <dd>{span.status}</dd>
              <dt>Parent</dt>
              <dd>{detailValue(span.parentSpanId)}</dd>
              <dt>Started</dt>
              <dd>{formatTimestamp(span.startedAt)}</dd>
              <dt>Duration</dt>
              <dd>{duration(span.durationMs)}</dd>
              <dt>Cost</dt>
              <dd>{detailValue(span.costUsd)}</dd>
            </dl>
            <section className="json-section">
              <h4>Input JSON</h4>
              <pre><code>{formatJson(span.input)}</code></pre>
            </section>
            <section className="json-section">
              <h4>Output JSON</h4>
              <pre><code>{formatJson(span.output)}</code></pre>
            </section>
            <section className="json-section">
              <h4>Error JSON</h4>
              <pre><code>{formatJson(span.error)}</code></pre>
            </section>
            <section className="json-section">
              <h4>Metadata JSON</h4>
              <pre><code>{formatJson(span.metadata)}</code></pre>
            </section>
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 11: Implement `TraceDetailDrawer`**

Create `apps/console/src/components/TraceDetailDrawer.tsx`:

```tsx
import type { SpanRecord, TraceRecord } from "../api/types";
import { SpanTimeline } from "./SpanTimeline";

type SpanState = "idle" | "loading" | "ready" | "empty" | "unavailable";

type Props = {
  trace?: TraceRecord;
  spans: SpanRecord[];
  spanState: SpanState;
  onRetrySpans: () => void;
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

export function TraceDetailDrawer({ trace, spans, spanState, onRetrySpans }: Props) {
  if (!trace) {
    return (
      <aside className="detail-drawer">
        <p className="muted-text">Select a trace to inspect its spans.</p>
      </aside>
    );
  }

  return (
    <aside className="detail-drawer">
      <div className="panel-header">
        <h2>{trace.name}</h2>
      </div>
      <dl className="detail-grid">
        <dt>ID</dt>
        <dd><code>{trace.id}</code></dd>
        <dt>Trace</dt>
        <dd>{detailValue(trace.traceId)}</dd>
        <dt>Project</dt>
        <dd>{trace.projectId}</dd>
        <dt>Environment</dt>
        <dd>{trace.environmentId}</dd>
        <dt>Status</dt>
        <dd>{trace.status}</dd>
        <dt>Duration</dt>
        <dd>{duration(trace.durationMs)}</dd>
        <dt>Started</dt>
        <dd>{formatTimestamp(trace.startedAt)}</dd>
        <dt>Ended</dt>
        <dd>{trace.endedAt ? formatTimestamp(trace.endedAt) : "none"}</dd>
        <dt>Tenant</dt>
        <dd>{detailValue(trace.tenantId)}</dd>
        <dt>User</dt>
        <dd>{detailValue(trace.userId)}</dd>
        <dt>Session</dt>
        <dd>{detailValue(trace.sessionId)}</dd>
        <dt>Source</dt>
        <dd>{detailValue(trace.source)}</dd>
        <dt>Release</dt>
        <dd>{detailValue(trace.release)}</dd>
      </dl>
      <section className="json-section">
        <h3>Metadata JSON</h3>
        <pre><code>{formatJson(trace.metadata)}</code></pre>
      </section>
      {spanState === "loading" ? <p className="muted-text">Loading spans</p> : null}
      {spanState === "empty" ? <p className="muted-text">No spans found for this trace.</p> : null}
      {spanState === "unavailable" ? (
        <div className="status-box unavailable">
          <strong>Spans unavailable</strong>
          <button onClick={onRetrySpans} type="button">
            Retry spans
          </button>
        </div>
      ) : null}
      {spanState === "ready" ? <SpanTimeline spans={spans} /> : null}
    </aside>
  );
}
```

- [ ] **Step 12: Implement `TraceInvestigationPanel`**

Create `apps/console/src/components/TraceInvestigationPanel.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api/client";
import type { QueryFilters, SpanRecord, TraceRecord } from "../api/types";
import { TraceDetailDrawer } from "./TraceDetailDrawer";
import { TraceFilters, type TraceFilterValues } from "./TraceFilters";
import { TraceList } from "./TraceList";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
};

type LoadState = "loading" | "ready" | "empty" | "unavailable";
type SpanState = "idle" | LoadState;

const defaultFilters: TraceFilterValues = {
  traceId: "",
  tenantId: "",
  userId: "",
  sessionId: "",
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

function queryFromValues(projectId: string, environmentId: string, values: TraceFilterValues): QueryFilters {
  const query: QueryFilters = { projectId, environmentId, limit: toLimit(values.limit) };
  const traceId = values.traceId.trim();
  const tenantId = values.tenantId.trim();
  const userId = values.userId.trim();
  const sessionId = values.sessionId.trim();
  const from = toIso(values.from);
  const to = toIso(values.to);

  if (traceId) query.traceId = traceId;
  if (tenantId) query.tenantId = tenantId;
  if (userId) query.userId = userId;
  if (sessionId) query.sessionId = sessionId;
  if (from) query.from = from;
  if (to) query.to = to;
  return query;
}

export function TraceInvestigationPanel({ client, projectId, environmentId }: Props) {
  const [draftFilters, setDraftFilters] = useState<TraceFilterValues>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<TraceFilterValues>(defaultFilters);
  const [reloadToken, setReloadToken] = useState(0);
  const [spanReloadToken, setSpanReloadToken] = useState(0);
  const [traces, setTraces] = useState<TraceRecord[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<TraceRecord | undefined>();
  const [spans, setSpans] = useState<SpanRecord[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [spanState, setSpanState] = useState<SpanState>("idle");
  const query = useMemo(() => queryFromValues(projectId, environmentId, appliedFilters), [projectId, environmentId, appliedFilters]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setSelectedTrace(undefined);
    setSpans([]);
    setSpanState("idle");

    void client.listTraces(query).then(
      ({ data }) => {
        if (cancelled) return;
        setTraces(data);
        setState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setTraces([]);
        setState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, query, reloadToken]);

  useEffect(() => {
    if (!selectedTrace?.traceId) {
      setSpans([]);
      setSpanState(selectedTrace ? "empty" : "idle");
      return;
    }

    let cancelled = false;
    const traceId = selectedTrace.traceId;
    setSpanState("loading");
    setSpans([]);

    void client.listTraceSpans(traceId, { projectId, environmentId }).then(
      ({ data }) => {
        if (cancelled) return;
        setSpans(data);
        setSpanState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setSpans([]);
        setSpanState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, projectId, environmentId, selectedTrace, spanReloadToken]);

  function applyFilters() {
    setAppliedFilters({ ...draftFilters });
  }

  function resetFilters() {
    setDraftFilters(defaultFilters);
    setAppliedFilters({ ...defaultFilters });
    setReloadToken((current) => current + 1);
  }

  function retryTraces() {
    setReloadToken((current) => current + 1);
  }

  function retrySpans() {
    setSpanReloadToken((current) => current + 1);
  }

  return (
    <section className="investigation-layout">
      <div className="panel event-panel">
        <div className="panel-header">
          <h2>Traces</h2>
        </div>
        <TraceFilters values={draftFilters} onApply={applyFilters} onChange={setDraftFilters} onReset={resetFilters} />
        {state === "loading" ? <p className="muted-text">Loading traces</p> : null}
        {state === "unavailable" ? (
          <div className="status-box unavailable">
            <strong>Traces unavailable</strong>
            <button onClick={retryTraces} type="button">
              Retry traces
            </button>
          </div>
        ) : null}
        {state === "empty" ? <p className="muted-text">No traces found</p> : null}
        {state === "ready" ? <TraceList onSelect={setSelectedTrace} selectedTraceId={selectedTrace?.id} traces={traces} /> : null}
      </div>
      <TraceDetailDrawer onRetrySpans={retrySpans} spanState={spanState} spans={spans} trace={selectedTrace} />
    </section>
  );
}
```

- [ ] **Step 13: Add trace row styles**

Append near `.error-row` in `apps/console/src/styles.css`:

```css
.trace-row {
  grid-template-columns:
    minmax(220px, 1.5fr)
    minmax(90px, 0.55fr)
    minmax(90px, 0.55fr)
    minmax(150px, 1fr)
    repeat(2, minmax(110px, 0.7fr));
}

.span-timeline {
  display: grid;
  gap: 0.75rem;
}

.span-row {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.75rem;
}

.span-row header {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}
```

If `.event-list` does not already include `overflow-x: auto`, add it to keep wide trace rows contained inside the panel.

- [ ] **Step 14: Run Traces UI verification**

Run:

```sh
pnpm test apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/TraceDetailDrawer.test.tsx apps/console/src/components/TraceInvestigationPanel.test.tsx apps/console/src/components/ConsoleShell.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [ ] **Step 15: Commit Traces UI**

Run:

```sh
git add apps/console/src/components/InvestigationWorkspace.tsx apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/ConsoleShell.test.tsx apps/console/src/components/TraceInvestigationPanel.tsx apps/console/src/components/TraceFilters.tsx apps/console/src/components/TraceList.tsx apps/console/src/components/TraceDetailDrawer.tsx apps/console/src/components/SpanTimeline.tsx apps/console/src/components/TraceInvestigationPanel.test.tsx apps/console/src/components/TraceDetailDrawer.test.tsx apps/console/src/styles.css
git commit -m "feat: add traces investigation workspace"
```

## Task 3: Update Docs And Run Final Verification

**Files:**
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update architecture docs**

Append this paragraph to `## Investigation Console` in `.claude/docs/ARCHITECTURE.md`:

```md
The console also includes a read-only Traces view for raw traces and ordered spans. It uses `GET /query/traces` for trace rows and `GET /query/traces/:id/spans` for spans loaded after selecting a trace. This slice does not add cross-signal timelines, trace mutation, charts, storage tables, or ingestion routes.
```

- [ ] **Step 2: Update UI/UX docs**

Append these bullets to `## Investigation UX` in `.claude/docs/UI-UX.md`:

```md
- Keep Traces as a peer tab with Events and Errors inside `Investigate`.
- Traces use the same filter/list/detail pattern, with spans loaded only after trace selection.
- Trace rows should prioritize name, status, duration, started time, user, tenant, and trace id.
- Span details should remain a dense ordered list before adding graphical timelines.
```

- [ ] **Step 3: Update project summary**

In `.claude/docs/PROJECT-SUMMARY.md`, add this implemented capability:

```md
- Read-only Traces investigation workspace with lazy ordered span details.
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
git commit -m "docs: document traces investigation console"
```

## Final Review

- [ ] Run `git status -sb` and confirm the worktree is clean.
- [ ] Run `git log --oneline -10` and confirm the task commits are readable.
- [ ] Run final code review across the implementation range before merging.
- [ ] Use `superpowers:finishing-a-development-branch` after final review approves.
