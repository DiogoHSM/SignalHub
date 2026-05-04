# Phase 3 Errors Investigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only raw Errors investigation view to the existing `Investigate` workspace, including exact error filters and a list/detail drawer workflow.

**Architecture:** Keep backend changes narrow by extending the existing `GET /query/errors` route with optional exact `severity`, `status`, and `fingerprint` filters. Reuse the Events investigation pattern in the console: `InvestigationWorkspace` owns active investigation tab state, Events remains default, Errors becomes enabled, and Traces/LLM remain disabled. This slice does not add grouping, occurrence counts, status mutation, charts, cross-signal links, or new tables.

**Tech Stack:** Fastify, Kysely/Postgres repositories, Vite + React + TypeScript, Testing Library, Vitest, pnpm workspaces.

---

## Source Documents

- Approved spec: `docs/superpowers/specs/2026-05-04-errors-investigation-design.md`
- Prior Events design: `docs/superpowers/specs/2026-05-04-phase3-events-investigation-design.md`
- PRD: `PRD.md`
- Existing query route: `apps/api/src/routes/query.ts`
- Existing telemetry query repository: `packages/db/src/repositories/telemetry-query.ts`
- Existing investigation shell: `apps/console/src/components/InvestigationWorkspace.tsx`
- Existing Events panel pattern: `apps/console/src/components/EventInvestigationPanel.tsx`

## File Structure

Create:

```txt
apps/console/src/components/ErrorInvestigationPanel.tsx
apps/console/src/components/ErrorFilters.tsx
apps/console/src/components/ErrorList.tsx
apps/console/src/components/ErrorDetailDrawer.tsx
apps/console/src/components/ErrorInvestigationPanel.test.tsx
apps/console/src/components/ErrorDetailDrawer.test.tsx
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
apps/console/src/components/InvestigationWorkspace.tsx
apps/console/src/components/InvestigationWorkspace.test.tsx
apps/console/src/components/ConsoleShell.test.tsx
apps/console/src/styles.css
.claude/docs/ARCHITECTURE.md
.claude/docs/UI-UX.md
.claude/docs/PROJECT-SUMMARY.md
CLAUDE.md
```

Responsibilities:

- `ErrorInvestigationPanel.tsx`: error query state, query lifecycle, filter application/reset, selected error, stale-response guard.
- `ErrorFilters.tsx`: controlled filter form and `Apply` / `Reset` actions.
- `ErrorList.tsx`: dense read-only list of raw error occurrence rows.
- `ErrorDetailDrawer.tsx`: read-only selected error detail, stack, context JSON, and metadata JSON.
- `InvestigationWorkspace.tsx`: active investigation tab state and panel switching between Events and Errors.

## Task 1: Add Exact Error Filters To Query Backend

**Files:**
- Modify: `apps/api/src/routes/query.ts`
- Modify: `apps/api/test/query.test.ts`
- Modify: `packages/db/src/repositories/telemetry-query.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Write failing route test for error filter parsing**

Add this test inside the existing query routes `describe` block in `apps/api/test/query.test.ts`, near the current optional filter query-param test:

```ts
  it("parses severity status and fingerprint for error queries", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listErrors: async (filters) => {
          receivedFilters.push(filters);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/errors?project_id=prj_1&environment_id=env_1" +
        "&severity=critical&status=open&fingerprint=fp_checkout_fetch"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        severity: "critical",
        status: "open",
        fingerprint: "fp_checkout_fetch",
        limit: 50
      }
    ]);
  });
```

- [ ] **Step 2: Run route test and verify it fails**

Run:

```sh
pnpm test apps/api/test/query.test.ts
```

Expected: fail because parsed filters do not include `severity`, `status`, or `fingerprint`.

- [ ] **Step 3: Write failing repository test for exact error filtering**

Add this test near the existing `filters events by exact event name` test in `packages/db/test/repositories.test.ts`:

```ts
  it("filters errors by exact severity status and fingerprint", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Filtered Errors API" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-04T12:00:00.000Z"),
        receivedAt: new Date("2026-05-04T12:00:01.000Z")
      };

      await insertError(db, {
        ...base,
        id: "err_filtered_1",
        message: "Checkout fetch failed",
        severity: "critical",
        status: "open",
        fingerprint: "fp_checkout_fetch"
      });
      await insertError(db, {
        ...base,
        id: "err_filtered_2",
        message: "Checkout fetch failed",
        severity: "warning",
        status: "open",
        fingerprint: "fp_checkout_fetch"
      });
      await insertError(db, {
        ...base,
        id: "err_filtered_3",
        message: "Checkout fetch failed",
        severity: "critical",
        status: "resolved",
        fingerprint: "fp_checkout_fetch"
      });
      await insertError(db, {
        ...base,
        id: "err_filtered_4",
        message: "Other error",
        severity: "critical",
        status: "open",
        fingerprint: "fp_other"
      });

      await expect(
        listErrors(db, {
          projectId: project.id,
          environmentId: environment.id,
          severity: "critical",
          status: "open",
          fingerprint: "fp_checkout_fetch"
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "err_filtered_1",
          severity: "critical",
          status: "open",
          fingerprint: "fp_checkout_fetch"
        })
      ]);
    });
  });
```

- [ ] **Step 4: Run repository test and verify it fails**

Run:

```sh
pnpm test packages/db/test/repositories.test.ts
```

Expected: fail because `TelemetryFilters` does not accept the new filter fields, or because multiple errors are returned.

- [ ] **Step 5: Implement backend filter types and parsing**

Modify `apps/api/src/routes/query.ts`.

Change `QueryFilters` to include the new optional fields:

```ts
export type QueryFilters = {
  projectId: string;
  environmentId: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  eventName?: string;
  severity?: string;
  status?: string;
  fingerprint?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
};
```

In `parseFilters`, after reading `eventName`, read the new query params:

```ts
  const severity = optionalNonEmpty(raw, "severity");
  const status = optionalNonEmpty(raw, "status");
  const fingerprint = optionalNonEmpty(raw, "fingerprint");
```

After the existing `eventName` assignment block, add:

```ts
  if (severity) {
    filters.severity = severity;
  }
  if (status) {
    filters.status = status;
  }
  if (fingerprint) {
    filters.fingerprint = fingerprint;
  }
```

The parsed fields are shared on `QueryFilters`, but Task 1 repository changes must only consume them in `listErrors`.

- [ ] **Step 6: Implement repository exact filters**

Modify `packages/db/src/repositories/telemetry-query.ts`.

Add the new optional fields to `TelemetryFilters`:

```ts
export interface TelemetryFilters {
  projectId: string;
  environmentId: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  eventName?: string;
  severity?: string;
  status?: string;
  fingerprint?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}
```

In `listErrors`, after the existing `traceId` filter, add:

```ts
  if (filters.severity) query = query.where("severity", "=", filters.severity);
  if (filters.status) query = query.where("status", "=", filters.status);
  if (filters.fingerprint) query = query.where("fingerprint", "=", filters.fingerprint);
```

Do not apply these filters to `listEvents`, `listLlmCalls`, `listTraces`, `listTraceSpans`, or aggregate functions.

- [ ] **Step 7: Run backend verification**

Run:

```sh
pnpm test apps/api/test/query.test.ts packages/db/test/repositories.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit backend filters**

Run:

```sh
git add apps/api/src/routes/query.ts apps/api/test/query.test.ts packages/db/src/repositories/telemetry-query.ts packages/db/test/repositories.test.ts
git commit -m "feat: add error query filters"
```

## Task 2: Type Error Query Results In The Console API Client

**Files:**
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Modify: `apps/console/src/api/client.test.ts`

- [ ] **Step 1: Write failing client test for error filter encoding**

Add this test to `apps/console/src/api/client.test.ts` after the event-name encoding test:

```ts
  it("encodes error query filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listErrors({
      projectId: "prj_1",
      environmentId: "env_1",
      severity: "critical",
      status: "open",
      fingerprint: "fp_checkout_fetch"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/errors?project_id=prj_1&environment_id=env_1&severity=critical&status=open&fingerprint=fp_checkout_fetch",
      expect.objectContaining({ method: "GET" })
    );
  });
```

- [ ] **Step 2: Run client test and verify it fails**

Run:

```sh
pnpm test apps/console/src/api/client.test.ts
```

Expected: fail because `severity`, `status`, and `fingerprint` are not encoded.

- [ ] **Step 3: Add `ErrorRecord` and filter types**

Modify `apps/console/src/api/types.ts`.

Add this type after `EventRecord`:

```ts
export type ErrorRecord = {
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
  message: string;
  type: string | null;
  severity: string;
  stack: string | null;
  status: string;
  fingerprint: string | null;
  context: unknown;
};
```

Add the new optional fields to `QueryFilters`:

```ts
export type QueryFilters = {
  projectId: string;
  environmentId: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  eventName?: string;
  severity?: string;
  status?: string;
  fingerprint?: string;
  from?: Date | string;
  to?: Date | string;
  limit?: number;
  cursor?: string;
};
```

- [ ] **Step 4: Type `listErrors` and encode filters**

Modify `apps/console/src/api/client.ts`.

Add `ErrorRecord` to the type imports:

```ts
  ErrorRecord,
```

Change the `ApiClient` method type:

```ts
  listErrors: (filters: QueryFilters) => Promise<QueryListResponse<ErrorRecord>>;
```

In `queryPath`, after `eventName`, add:

```ts
  if (filters.severity) params.set("severity", filters.severity);
  if (filters.status) params.set("status", filters.status);
  if (filters.fingerprint) params.set("fingerprint", filters.fingerprint);
```

Change `listErrors` implementation:

```ts
    listErrors: (filters) => request<QueryListResponse<ErrorRecord>>(path(apiBasePath, queryPath("/query/errors", filters))),
```

- [ ] **Step 5: Run client verification**

Run:

```sh
pnpm test apps/console/src/api/client.test.ts
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [ ] **Step 6: Commit typed error client**

Run:

```sh
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts
git commit -m "feat: type console error queries"
```

## Task 3: Enable Errors Tab And Build Errors Investigation UI

**Files:**
- Create: `apps/console/src/components/ErrorInvestigationPanel.tsx`
- Create: `apps/console/src/components/ErrorFilters.tsx`
- Create: `apps/console/src/components/ErrorList.tsx`
- Create: `apps/console/src/components/ErrorDetailDrawer.tsx`
- Create: `apps/console/src/components/ErrorInvestigationPanel.test.tsx`
- Create: `apps/console/src/components/ErrorDetailDrawer.test.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.tsx`
- Modify: `apps/console/src/components/InvestigationWorkspace.test.tsx`
- Modify: `apps/console/src/components/ConsoleShell.test.tsx`
- Modify: `apps/console/src/styles.css`

- [ ] **Step 1: Write failing tab-switch test**

Modify `apps/console/src/components/InvestigationWorkspace.test.tsx`.

Replace the existing scoped test with this test:

```tsx
  it("switches between events and errors investigation views", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [] }),
      listErrors: vi.fn().mockResolvedValue({ data: [] })
    });

    render(<InvestigationWorkspace client={api} environmentId="env_1" projectId="prj_1" />);

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Errors" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Traces" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "LLM" })).toBeDisabled();
    expect(await screen.findByText("No events found")).toBeInTheDocument();
    expect(api.listErrors).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Errors" }));

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Errors" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("No errors found")).toBeInTheDocument();
    expect(api.listErrors).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });
```

Add these imports at the top of the test file:

```tsx
import userEvent from "@testing-library/user-event";
```

- [ ] **Step 2: Run workspace test and verify it fails**

Run:

```sh
pnpm test apps/console/src/components/InvestigationWorkspace.test.tsx
```

Expected: fail because Errors is disabled or because `ErrorInvestigationPanel` does not exist.

- [ ] **Step 3: Add shell regression test for no background Errors query**

Add this test to `apps/console/src/components/ConsoleShell.test.tsx` near the existing test that prevents background Events investigation queries:

```tsx
  it("does not query investigation errors until the errors tab is opened", async () => {
    const listErrors = vi.fn().mockResolvedValue({ data: [] });
    const api = client({
      listErrors,
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

    expect(listErrors).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Errors" }));

    await waitFor(() => expect(listErrors).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 }));
  });
```

- [ ] **Step 4: Implement active tab state**

Modify `apps/console/src/components/InvestigationWorkspace.tsx`.

Add imports:

```tsx
import { useState } from "react";
import { ErrorInvestigationPanel } from "./ErrorInvestigationPanel";
```

Add a tab type:

```tsx
type InvestigationTab = "events" | "errors";
```

Inside the component, after the setup-required return guard, add:

```tsx
  const [activeTab, setActiveTab] = useState<InvestigationTab>("events");
```

Replace the nav with enabled Events and Errors buttons:

```tsx
      <nav className="investigation-tabs" aria-label="Investigation views">
        <button aria-pressed={activeTab === "events"} onClick={() => setActiveTab("events")} type="button">
          Events
        </button>
        <button aria-pressed={activeTab === "errors"} onClick={() => setActiveTab("errors")} type="button">
          Errors
        </button>
        <button disabled type="button">
          Traces
        </button>
        <button disabled type="button">
          LLM
        </button>
      </nav>
```

Replace the unconditional Events panel with:

```tsx
      {activeTab === "events" ? <EventInvestigationPanel client={client} environmentId={environmentId} projectId={projectId} /> : null}
      {activeTab === "errors" ? <ErrorInvestigationPanel client={client} environmentId={environmentId} projectId={projectId} /> : null}
```

- [ ] **Step 5: Run tab-switch tests and verify they still fail**

Run:

```sh
pnpm test apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/ConsoleShell.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: fail because `ErrorInvestigationPanel` does not exist yet.

### UI Implementation Steps

- [ ] **Step 6: Write `ErrorDetailDrawer` tests**

Create `apps/console/src/components/ErrorDetailDrawer.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ErrorRecord } from "../api/types";
import { ErrorDetailDrawer } from "./ErrorDetailDrawer";

const error: ErrorRecord = {
  id: "err_1",
  projectId: "prj_1",
  environmentId: "env_1",
  tenantId: "tenant_1",
  userId: "user_1",
  sessionId: "session_1",
  traceId: "trace_1",
  timestamp: "2026-05-04T12:00:00.000Z",
  receivedAt: "2026-05-04T12:00:01.000Z",
  source: "web",
  release: "1.0.0",
  metadata: { region: "us-east-1" },
  message: "Checkout fetch failed",
  type: "TypeError",
  severity: "critical",
  stack: "TypeError: Checkout fetch failed\n    at checkout.ts:12:3",
  status: "open",
  fingerprint: "fp_checkout_fetch",
  context: { route: "/checkout" }
};

afterEach(() => {
  cleanup();
});

describe("ErrorDetailDrawer", () => {
  it("renders selected error details stack context and metadata", () => {
    render(<ErrorDetailDrawer error={error} />);

    expect(screen.getByRole("heading", { name: "Checkout fetch failed" })).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByText("prj_1")).toBeInTheDocument();
    expect(screen.getByText("env_1")).toBeInTheDocument();
    expect(screen.getByText("trace_1")).toBeInTheDocument();
    expect(screen.getByText("fp_checkout_fetch")).toBeInTheDocument();
    expect(screen.getByText(/checkout.ts:12:3/)).toBeInTheDocument();
    expect(screen.getByText(/"route": "\/checkout"/)).toBeInTheDocument();
    expect(screen.getByText(/"region": "us-east-1"/)).toBeInTheDocument();
  });

  it("renders an empty selection state", () => {
    render(<ErrorDetailDrawer />);

    expect(screen.getByText("Select an error to inspect its details.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Write `ErrorInvestigationPanel` tests**

Create `apps/console/src/components/ErrorInvestigationPanel.test.tsx`:

```tsx
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { ErrorRecord } from "../api/types";
import { ErrorInvestigationPanel } from "./ErrorInvestigationPanel";

function error(overrides: Partial<ErrorRecord>): ErrorRecord {
  return {
    id: "err_1",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: "tenant_1",
    userId: "user_1",
    sessionId: "session_1",
    traceId: "trace_1",
    timestamp: "2026-05-04T12:00:00.000Z",
    receivedAt: "2026-05-04T12:00:01.000Z",
    source: "web",
    release: "1.0.0",
    metadata: {},
    message: "Checkout fetch failed",
    type: "TypeError",
    severity: "critical",
    stack: "TypeError: Checkout fetch failed",
    status: "open",
    fingerprint: "fp_checkout_fetch",
    context: {},
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
    listEvents: vi.fn().mockResolvedValue({ data: [] }),
    listErrors: vi.fn().mockResolvedValue({ data: [] }),
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
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
});

describe("ErrorInvestigationPanel", () => {
  it("loads latest errors for the active project and environment", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [error({ id: "err_1", message: "Checkout fetch failed" })] })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("Checkout fetch failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Checkout fetch failed/ })).toHaveTextContent("critical");
    expect(screen.getByRole("button", { name: /Checkout fetch failed/ })).toHaveTextContent("open");
    expect(screen.getByRole("button", { name: /Checkout fetch failed/ })).toHaveTextContent("trace_1");
    expect(api.listErrors).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });

  it("applies exact filters only after Apply", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [] })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No errors found");
    await userEvent.type(screen.getByLabelText("Severity"), "critical");
    await userEvent.type(screen.getByLabelText("Status"), "open");
    await userEvent.type(screen.getByLabelText("Fingerprint"), "fp_checkout_fetch");

    expect(api.listErrors).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(api.listErrors).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        severity: "critical",
        status: "open",
        fingerprint: "fp_checkout_fetch",
        limit: 50
      })
    );
  });

  it("resets optional filters and reloads latest errors", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [] })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No errors found");
    await userEvent.type(screen.getByLabelText("Severity"), "critical");
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.getByLabelText("Severity")).toHaveValue("");
    await waitFor(() =>
      expect(api.listErrors).toHaveBeenLastCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 })
    );
  });

  it("opens the detail drawer when an error is selected", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [error({ id: "err_1", message: "Checkout fetch failed" })] })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /Checkout fetch failed/ }));

    expect(screen.getByRole("heading", { name: "Checkout fetch failed" })).toBeInTheDocument();
    expect(screen.getAllByText("trace_1")).toHaveLength(2);
  });

  it("shows unavailable state and retries after query failure", async () => {
    const api = client({
      listErrors: vi.fn().mockRejectedValueOnce(new Error("query failed")).mockResolvedValueOnce({ data: [] })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("Errors unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No errors found")).toBeInTheDocument();
  });

  it("ignores stale error responses after scope changes", async () => {
    const first = deferred<{ data: ErrorRecord[] }>();
    const api = client({
      listErrors: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ data: [error({ id: "err_2", environmentId: "env_2", message: "New scope failed" })] })
    });

    const { rerender } = render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    rerender(<ErrorInvestigationPanel client={api} environmentId="env_2" projectId="prj_1" />);

    expect(await screen.findByText("New scope failed")).toBeInTheDocument();

    await act(async () => {
      first.resolve({ data: [error({ id: "err_1", message: "Old scope failed" })] });
      await first.promise;
    });

    expect(screen.queryByText("Old scope failed")).not.toBeInTheDocument();
    expect(screen.getByText("New scope failed")).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run Errors UI tests and verify they fail**

Run:

```sh
pnpm test apps/console/src/components/ErrorDetailDrawer.test.tsx apps/console/src/components/ErrorInvestigationPanel.test.tsx
```

Expected: fail because components do not exist.

- [ ] **Step 9: Implement `ErrorFilters`**

Create `apps/console/src/components/ErrorFilters.tsx`:

```tsx
import type { FormEvent } from "react";

export type ErrorFilterValues = {
  severity: string;
  status: string;
  fingerprint: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  traceId: string;
  from: string;
  to: string;
  limit: string;
};

type Props = {
  values: ErrorFilterValues;
  onChange: (values: ErrorFilterValues) => void;
  onApply: () => void;
  onReset: () => void;
};

function update(values: ErrorFilterValues, key: keyof ErrorFilterValues, value: string): ErrorFilterValues {
  return { ...values, [key]: value };
}

export function ErrorFilters({ values, onChange, onApply, onReset }: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply();
  }

  return (
    <form className="event-filters" onSubmit={submit}>
      <label>
        Severity
        <input value={values.severity} onChange={(event) => onChange(update(values, "severity", event.target.value))} />
      </label>
      <label>
        Status
        <input value={values.status} onChange={(event) => onChange(update(values, "status", event.target.value))} />
      </label>
      <label>
        Fingerprint
        <input value={values.fingerprint} onChange={(event) => onChange(update(values, "fingerprint", event.target.value))} />
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

- [ ] **Step 10: Implement `ErrorList`**

Create `apps/console/src/components/ErrorList.tsx`:

```tsx
import type { ErrorRecord } from "../api/types";

type Props = {
  errors: ErrorRecord[];
  selectedErrorId?: string;
  onSelect: (error: ErrorRecord) => void;
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function label(value: string | null): string {
  return value ?? "none";
}

function typeOrFingerprint(error: ErrorRecord): string {
  return error.type ?? error.fingerprint ?? "none";
}

function contextLabel(error: ErrorRecord): string {
  return error.traceId ?? error.sessionId ?? "none";
}

export function ErrorList({ errors, selectedErrorId, onSelect }: Props) {
  return (
    <div className="event-list" aria-label="Errors">
      {errors.map((error) => (
        <button
          aria-pressed={error.id === selectedErrorId}
          className="event-row error-row"
          key={error.id}
          onClick={() => onSelect(error)}
          type="button"
        >
          <span>
            <strong>{error.message}</strong>
            <code>{error.id}</code>
          </span>
          <span>{error.severity}</span>
          <span>{error.status}</span>
          <span>{typeOrFingerprint(error)}</span>
          <span>{formatTimestamp(error.timestamp)}</span>
          <span>{label(error.userId)}</span>
          <span>{label(error.tenantId)}</span>
          <span>{contextLabel(error)}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 11: Implement `ErrorDetailDrawer`**

Create `apps/console/src/components/ErrorDetailDrawer.tsx`:

```tsx
import type { ErrorRecord } from "../api/types";

type Props = {
  error?: ErrorRecord;
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

export function ErrorDetailDrawer({ error }: Props) {
  if (!error) {
    return (
      <aside className="detail-drawer">
        <p className="muted-text">Select an error to inspect its details.</p>
      </aside>
    );
  }

  return (
    <aside className="detail-drawer">
      <div className="panel-header">
        <h2>{error.message}</h2>
      </div>
      <dl className="detail-grid">
        <dt>ID</dt>
        <dd><code>{error.id}</code></dd>
        <dt>Project</dt>
        <dd>{error.projectId}</dd>
        <dt>Environment</dt>
        <dd>{error.environmentId}</dd>
        <dt>Type</dt>
        <dd>{detailValue(error.type)}</dd>
        <dt>Severity</dt>
        <dd>{error.severity}</dd>
        <dt>Status</dt>
        <dd>{error.status}</dd>
        <dt>Timestamp</dt>
        <dd>{formatTimestamp(error.timestamp)}</dd>
        <dt>Received</dt>
        <dd>{formatTimestamp(error.receivedAt)}</dd>
        <dt>Tenant</dt>
        <dd>{detailValue(error.tenantId)}</dd>
        <dt>User</dt>
        <dd>{detailValue(error.userId)}</dd>
        <dt>Session</dt>
        <dd>{detailValue(error.sessionId)}</dd>
        <dt>Trace</dt>
        <dd>{detailValue(error.traceId)}</dd>
        <dt>Source</dt>
        <dd>{detailValue(error.source)}</dd>
        <dt>Release</dt>
        <dd>{detailValue(error.release)}</dd>
        <dt>Fingerprint</dt>
        <dd>{detailValue(error.fingerprint)}</dd>
      </dl>
      <section className="json-section">
        <h3>Stack</h3>
        <pre><code>{error.stack ?? "none"}</code></pre>
      </section>
      <section className="json-section">
        <h3>Context</h3>
        <pre><code>{formatJson(error.context)}</code></pre>
      </section>
      <section className="json-section">
        <h3>Metadata</h3>
        <pre><code>{formatJson(error.metadata)}</code></pre>
      </section>
    </aside>
  );
}
```

- [ ] **Step 12: Implement `ErrorInvestigationPanel`**

Create `apps/console/src/components/ErrorInvestigationPanel.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ErrorRecord, QueryFilters } from "../api/types";
import { ErrorDetailDrawer } from "./ErrorDetailDrawer";
import { ErrorFilters, type ErrorFilterValues } from "./ErrorFilters";
import { ErrorList } from "./ErrorList";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
};

type LoadState = "loading" | "ready" | "empty" | "unavailable";

const defaultFilters: ErrorFilterValues = {
  severity: "",
  status: "",
  fingerprint: "",
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
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(500, Math.max(1, Math.trunc(parsed)));
}

function queryFromValues(projectId: string, environmentId: string, values: ErrorFilterValues): QueryFilters {
  const query: QueryFilters = {
    projectId,
    environmentId,
    limit: toLimit(values.limit)
  };

  const severity = values.severity.trim();
  const status = values.status.trim();
  const fingerprint = values.fingerprint.trim();
  const tenantId = values.tenantId.trim();
  const userId = values.userId.trim();
  const sessionId = values.sessionId.trim();
  const traceId = values.traceId.trim();
  const from = toIso(values.from);
  const to = toIso(values.to);

  if (severity) query.severity = severity;
  if (status) query.status = status;
  if (fingerprint) query.fingerprint = fingerprint;
  if (tenantId) query.tenantId = tenantId;
  if (userId) query.userId = userId;
  if (sessionId) query.sessionId = sessionId;
  if (traceId) query.traceId = traceId;
  if (from) query.from = from;
  if (to) query.to = to;

  return query;
}

export function ErrorInvestigationPanel({ client, projectId, environmentId }: Props) {
  const [draftFilters, setDraftFilters] = useState<ErrorFilterValues>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<ErrorFilterValues>(defaultFilters);
  const [reloadToken, setReloadToken] = useState(0);
  const [errors, setErrors] = useState<ErrorRecord[]>([]);
  const [selectedError, setSelectedError] = useState<ErrorRecord | undefined>();
  const [state, setState] = useState<LoadState>("loading");
  const query = useMemo(
    () => queryFromValues(projectId, environmentId, appliedFilters),
    [projectId, environmentId, appliedFilters]
  );

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setSelectedError(undefined);

    void client.listErrors(query).then(
      ({ data }) => {
        if (cancelled) return;
        setErrors(data);
        setState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setErrors([]);
        setState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, query, reloadToken]);

  function applyFilters() {
    setAppliedFilters({ ...draftFilters });
  }

  function resetFilters() {
    setDraftFilters(defaultFilters);
    setAppliedFilters({ ...defaultFilters });
    setReloadToken((current) => current + 1);
  }

  function retry() {
    setReloadToken((current) => current + 1);
  }

  return (
    <section className="investigation-layout">
      <div className="panel event-panel">
        <div className="panel-header">
          <h2>Errors</h2>
        </div>
        <ErrorFilters values={draftFilters} onApply={applyFilters} onChange={setDraftFilters} onReset={resetFilters} />
        {state === "loading" ? <p className="muted-text">Loading errors</p> : null}
        {state === "unavailable" ? (
          <div className="status-box unavailable">
            <strong>Errors unavailable</strong>
            <button onClick={retry} type="button">
              Retry
            </button>
          </div>
        ) : null}
        {state === "empty" ? <p className="muted-text">No errors found</p> : null}
        {state === "ready" ? <ErrorList errors={errors} onSelect={setSelectedError} selectedErrorId={selectedError?.id} /> : null}
      </div>
      <ErrorDetailDrawer error={selectedError} />
    </section>
  );
}
```

- [ ] **Step 13: Finalize `InvestigationWorkspace` tabs**

Modify `apps/console/src/components/InvestigationWorkspace.tsx` to use the real `ErrorInvestigationPanel` from Step 12 and ensure:

```tsx
      {activeTab === "events" ? <EventInvestigationPanel client={client} environmentId={environmentId} projectId={projectId} /> : null}
      {activeTab === "errors" ? <ErrorInvestigationPanel client={client} environmentId={environmentId} projectId={projectId} /> : null}
```

The missing project/environment message should stay:

```tsx
Select a project and environment in Setup to investigate events.
```

- [ ] **Step 14: Add Errors row styles**

Append to `apps/console/src/styles.css` near `.event-row` styles:

```css
.error-row {
  grid-template-columns:
    minmax(220px, 1.5fr)
    minmax(90px, 0.55fr)
    minmax(90px, 0.55fr)
    minmax(130px, 0.9fr)
    minmax(150px, 1fr)
    repeat(3, minmax(110px, 0.7fr));
}
```

Inside the existing mobile media query where `.event-row` is already set to one column, no additional mobile rule is needed because `.error-row` also has `event-row`.

- [ ] **Step 15: Run Errors UI verification**

Run:

```sh
pnpm test apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/ErrorDetailDrawer.test.tsx apps/console/src/components/ErrorInvestigationPanel.test.tsx apps/console/src/components/ConsoleShell.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [ ] **Step 16: Commit Errors UI**

Run:

```sh
git add apps/console/src/components/InvestigationWorkspace.tsx apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/ConsoleShell.test.tsx apps/console/src/components/ErrorInvestigationPanel.tsx apps/console/src/components/ErrorFilters.tsx apps/console/src/components/ErrorList.tsx apps/console/src/components/ErrorDetailDrawer.tsx apps/console/src/components/ErrorInvestigationPanel.test.tsx apps/console/src/components/ErrorDetailDrawer.test.tsx apps/console/src/styles.css
git commit -m "feat: add errors investigation workspace"
```

## Task 4: Update Docs And Run Final Verification

**Files:**
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update architecture docs**

Append this paragraph to the existing `## Events Investigation` section in `.claude/docs/ARCHITECTURE.md`, then rename the heading to `## Investigation Console`:

```md
The console also includes a read-only Errors view for raw error occurrences. It uses `GET /query/errors` with exact `severity`, `status`, and `fingerprint` filters in addition to project, environment, tenant, user, session, trace, date range, and limit filters. This slice does not group errors, mutate status, or add storage tables.
```

- [ ] **Step 2: Update UI/UX docs**

Append these bullets to the existing `## Investigation UX` section in `.claude/docs/UI-UX.md`:

```md
- Keep Events and Errors as peer tabs inside `Investigate`.
- Errors use the same list/detail drawer pattern as Events.
- Error rows should prioritize severity, status, message, and trace/session context.
- Error details should show stack, context JSON, metadata JSON, and immutable identifiers.
```

- [ ] **Step 3: Update project summary**

In `.claude/docs/PROJECT-SUMMARY.md`, add this implemented capability:

```md
- Read-only Errors investigation workspace with exact severity, status, and fingerprint filtering.
```

- [ ] **Step 4: Update CLAUDE.md convention**

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
git commit -m "docs: document errors investigation console"
```

## Final Review

- [ ] Run `git status -sb` and confirm the worktree is clean.
- [ ] Run `git log --oneline -10` and confirm the task commits are readable.
- [ ] Run final code review across the implementation range before merging.
- [ ] Use `superpowers:finishing-a-development-branch` after final review approves.
