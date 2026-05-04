# Phase 3 Events Investigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Events investigation workspace to the existing Integration Console, including exact event-name filtering and a list/detail drawer workflow.

**Architecture:** Keep backend changes narrow by extending the existing `GET /query/events` route with optional exact `event_name` filtering. Reorganize the console into `Setup` and `Investigate` modes, extract the current setup workspace, and build focused Events investigation components that reuse the active project/environment. This slice establishes the reusable investigation pattern without adding Errors, Traces, LLM, Overview dashboards, saved filters, or telemetry mutations.

**Tech Stack:** Fastify, Kysely/Postgres repositories, Vite + React + TypeScript, Testing Library, Vitest, pnpm workspaces.

---

## Source Documents

- Approved spec: `docs/superpowers/specs/2026-05-04-phase3-events-investigation-design.md`
- PRD: `PRD.md`
- Existing query route: `apps/api/src/routes/query.ts`
- Existing telemetry query repository: `packages/db/src/repositories/telemetry-query.ts`
- Existing console shell: `apps/console/src/components/ConsoleShell.tsx`
- Existing console API client: `apps/console/src/api/client.ts`

## File Structure

Create:

```txt
apps/console/src/components/ConsoleModeTabs.tsx
apps/console/src/components/SetupWorkspace.tsx
apps/console/src/components/InvestigationWorkspace.tsx
apps/console/src/components/EventInvestigationPanel.tsx
apps/console/src/components/EventFilters.tsx
apps/console/src/components/EventList.tsx
apps/console/src/components/EventDetailDrawer.tsx
apps/console/src/components/ConsoleModeTabs.test.tsx
apps/console/src/components/InvestigationWorkspace.test.tsx
apps/console/src/components/EventInvestigationPanel.test.tsx
apps/console/src/components/EventDetailDrawer.test.tsx
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
apps/console/src/components/ConsoleShell.tsx
apps/console/src/components/ConsoleShell.test.tsx
apps/console/src/styles.css
.claude/docs/ARCHITECTURE.md
.claude/docs/UI-UX.md
.claude/docs/PROJECT-SUMMARY.md
CLAUDE.md
```

Responsibilities:

- `ConsoleModeTabs.tsx`: top-level `Setup` / `Investigate` mode switch.
- `SetupWorkspace.tsx`: existing setup grid extracted from `ConsoleShell`.
- `InvestigationWorkspace.tsx`: investigation mode shell, tab navigation, setup-required state, and Events view wiring.
- `EventInvestigationPanel.tsx`: event query state, query lifecycle, filter application/reset, selected event, stale-response guard.
- `EventFilters.tsx`: controlled filter form and `Apply` / `Reset` actions.
- `EventList.tsx`: dense read-only list of event rows.
- `EventDetailDrawer.tsx`: read-only selected event detail and formatted JSON.

## Task 1: Add Exact Event Name Filtering To Query Backend

**Files:**
- Modify: `apps/api/src/routes/query.ts`
- Modify: `apps/api/test/query.test.ts`
- Modify: `packages/db/src/repositories/telemetry-query.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Write failing route test for `event_name` parsing**

Add this test inside the existing query routes `describe` block in `apps/api/test/query.test.ts`, near the other `/query/events` tests:

```ts
  it("parses event_name for event queries", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEvents: async (filters) => {
          receivedFilters.push(filters);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1&event_name=checkout.started"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        eventName: "checkout.started",
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

Expected: fail because `receivedFilters[0]` does not include `eventName`.

- [ ] **Step 3: Write failing repository test for exact event-name filtering**

Add this test near the existing event-listing repository tests in `packages/db/test/repositories.test.ts`:

```ts
  it("filters events by exact event name", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Named Events API" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-04T12:00:00.000Z"),
        receivedAt: new Date("2026-05-04T12:00:01.000Z")
      };

      await insertEvent(db, { ...base, id: "evt_named_1", name: "checkout.started" });
      await insertEvent(db, { ...base, id: "evt_named_2", name: "checkout.completed" });

      await expect(
        listEvents(db, { projectId: project.id, environmentId: environment.id, eventName: "checkout.started" })
      ).resolves.toEqual([expect.objectContaining({ id: "evt_named_1", name: "checkout.started" })]);
    });
  });
```

- [ ] **Step 4: Run repository test and verify it fails**

Run:

```sh
pnpm test packages/db/test/repositories.test.ts
```

Expected: fail because `TelemetryFilters` does not accept `eventName`, or because both events are returned.

- [ ] **Step 5: Implement backend filter types and parsing**

Modify `apps/api/src/routes/query.ts`.

Change `QueryFilters` to include `eventName`:

```ts
export type QueryFilters = {
  projectId: string;
  environmentId: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  eventName?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
};
```

In `parseFilters`, after reading `traceId`, read `event_name`:

```ts
  const eventName = optionalNonEmpty(raw, "event_name");
```

Then add it to `filters` only when present:

```ts
  if (eventName) {
    filters.eventName = eventName;
  }
```

This does not change other query routes because only `listEvents` will use `eventName`.

- [ ] **Step 6: Implement repository exact-name filter**

Modify `packages/db/src/repositories/telemetry-query.ts`.

Add `eventName` to `TelemetryFilters`:

```ts
export interface TelemetryFilters {
  projectId: string;
  environmentId: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  eventName?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}
```

In `listEvents`, after the existing `traceId` filter, add:

```ts
  if (filters.eventName) query = query.where("name", "=", filters.eventName);
```

Do not apply `eventName` to `listErrors`, `listLlmCalls`, `listTraces`, or `listTraceSpans`.

- [ ] **Step 7: Run backend verification**

Run:

```sh
pnpm test apps/api/test/query.test.ts packages/db/test/repositories.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit backend filter**

Run:

```sh
git add apps/api/src/routes/query.ts apps/api/test/query.test.ts packages/db/src/repositories/telemetry-query.ts packages/db/test/repositories.test.ts
git commit -m "feat: add event name query filter"
```

## Task 2: Type Event Query Results In The Console API Client

**Files:**
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Modify: `apps/console/src/api/client.test.ts`

- [ ] **Step 1: Write failing client test for `eventName` encoding**

Add this test to `apps/console/src/api/client.test.ts`:

```ts
  it("encodes event name query filter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listEvents({
      projectId: "prj_1",
      environmentId: "env_1",
      eventName: "checkout.started"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/events?project_id=prj_1&environment_id=env_1&event_name=checkout.started",
      expect.objectContaining({ method: "GET" })
    );
  });
```

- [ ] **Step 2: Run client test and verify it fails**

Run:

```sh
pnpm test apps/console/src/api/client.test.ts
```

Expected: fail because `eventName` is not encoded.

- [ ] **Step 3: Add `EventRecord` and `eventName` types**

Modify `apps/console/src/api/types.ts`.

Add this type after `CreatedApiKey`:

```ts
export type EventRecord = {
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
  properties: unknown;
};
```

Add `eventName` to `QueryFilters`:

```ts
export type QueryFilters = {
  projectId: string;
  environmentId: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  eventName?: string;
  from?: Date | string;
  to?: Date | string;
  limit?: number;
  cursor?: string;
};
```

- [ ] **Step 4: Type `listEvents` and encode `eventName`**

Modify `apps/console/src/api/client.ts`.

Add `EventRecord` to the type imports:

```ts
  EventRecord,
```

Change the `ApiClient` method type:

```ts
  listEvents: (filters: QueryFilters) => Promise<QueryListResponse<EventRecord>>;
```

In `queryPath`, after `traceId`, add:

```ts
  if (filters.eventName) params.set("event_name", filters.eventName);
```

Change `listEvents` implementation:

```ts
    listEvents: (filters) => request<QueryListResponse<EventRecord>>(path(apiBasePath, queryPath("/query/events", filters))),
```

- [ ] **Step 5: Run client verification**

Run:

```sh
pnpm test apps/console/src/api/client.test.ts
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [ ] **Step 6: Commit typed client filter**

Run:

```sh
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts
git commit -m "feat: type console event queries"
```

## Task 3: Extract Setup Workspace And Add Console Mode Tabs

**Files:**
- Create: `apps/console/src/components/ConsoleModeTabs.tsx`
- Create: `apps/console/src/components/SetupWorkspace.tsx`
- Create: `apps/console/src/components/ConsoleModeTabs.test.tsx`
- Modify: `apps/console/src/components/ConsoleShell.tsx`
- Modify: `apps/console/src/components/ConsoleShell.test.tsx`
- Modify: `apps/console/src/styles.css`

- [ ] **Step 1: Write mode tab tests**

Create `apps/console/src/components/ConsoleModeTabs.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleModeTabs } from "./ConsoleModeTabs";

afterEach(() => {
  cleanup();
});

describe("ConsoleModeTabs", () => {
  it("shows the active mode and switches modes", async () => {
    const onChange = vi.fn();

    render(<ConsoleModeTabs activeMode="setup" onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Setup" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Investigate" })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));

    expect(onChange).toHaveBeenCalledWith("investigate");
  });
});
```

- [ ] **Step 2: Run mode tab test and verify it fails**

Run:

```sh
pnpm test apps/console/src/components/ConsoleModeTabs.test.tsx
```

Expected: fail because `ConsoleModeTabs` does not exist.

- [ ] **Step 3: Implement `ConsoleModeTabs`**

Create `apps/console/src/components/ConsoleModeTabs.tsx`:

```tsx
export type ConsoleMode = "setup" | "investigate";

type Props = {
  activeMode: ConsoleMode;
  onChange: (mode: ConsoleMode) => void;
};

export function ConsoleModeTabs({ activeMode, onChange }: Props) {
  return (
    <div className="mode-tabs" aria-label="Console modes">
      <button aria-pressed={activeMode === "setup"} onClick={() => onChange("setup")} type="button">
        Setup
      </button>
      <button aria-pressed={activeMode === "investigate"} onClick={() => onChange("investigate")} type="button">
        Investigate
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Extract `SetupWorkspace`**

Create `apps/console/src/components/SetupWorkspace.tsx`:

```tsx
import type { ApiClient } from "../api/client";
import type { Environment } from "../api/types";
import { ApiKeyPanel } from "./ApiKeyPanel";
import { ConnectionCheck } from "./ConnectionCheck";
import { EnvironmentSelector } from "./EnvironmentSelector";
import { SnippetPanel } from "./SnippetPanel";
import { UserAdminPanel } from "./UserAdminPanel";

type Props = {
  client: ApiClient;
  activeEnvironment?: Environment;
  environments: Environment[];
  isEnvironmentCreationDisabled: boolean;
  onCreateEnvironment: (name: string) => Promise<void>;
  onSelectEnvironment: (environment: Environment) => void;
  onSecretCreated: (secret: string) => void;
  activeProjectId?: string;
  apiEndpoint?: string;
  latestSecret?: string;
};

export function SetupWorkspace({
  client,
  activeEnvironment,
  environments,
  isEnvironmentCreationDisabled,
  onCreateEnvironment,
  onSelectEnvironment,
  onSecretCreated,
  activeProjectId,
  apiEndpoint,
  latestSecret
}: Props) {
  return (
    <>
      <div className="workspace-grid">
        <EnvironmentSelector
          activeEnvironmentId={activeEnvironment?.id}
          disabled={isEnvironmentCreationDisabled}
          environments={environments}
          onCreate={onCreateEnvironment}
          onSelect={onSelectEnvironment}
        />
        <ApiKeyPanel
          client={client}
          environmentId={activeEnvironment?.id}
          onSecretCreated={onSecretCreated}
          projectId={activeProjectId}
        />
        <SnippetPanel
          apiEndpoint={apiEndpoint}
          environmentId={activeEnvironment?.id}
          latestSecret={latestSecret}
          projectId={activeProjectId}
        />
      </div>
      <div className="workspace-grid">
        <ConnectionCheck client={client} environmentId={activeEnvironment?.id} projectId={activeProjectId} />
        <UserAdminPanel client={client} />
      </div>
    </>
  );
}
```

- [ ] **Step 5: Wire mode tabs into `ConsoleShell`**

Modify `apps/console/src/components/ConsoleShell.tsx`.

Remove direct imports for setup child components:

```tsx
import { ApiKeyPanel } from "./ApiKeyPanel";
import { ConnectionCheck } from "./ConnectionCheck";
import { EnvironmentSelector } from "./EnvironmentSelector";
import { SnippetPanel } from "./SnippetPanel";
import { UserAdminPanel } from "./UserAdminPanel";
```

Add imports:

```tsx
import { ConsoleModeTabs, type ConsoleMode } from "./ConsoleModeTabs";
import { SetupWorkspace } from "./SetupWorkspace";
```

Add state near the other `useState` calls:

```tsx
  const [activeMode, setActiveMode] = useState<ConsoleMode>("setup");
```

Render mode tabs inside the workspace header:

```tsx
        <header className="workspace-header">
          <div>
            <h1>{activeProject?.name ?? "No project selected"}</h1>
            <p>{activeEnvironment ? `Environment: ${activeEnvironment.name}` : "Create an environment to continue setup."}</p>
          </div>
          <ConsoleModeTabs activeMode={activeMode} onChange={setActiveMode} />
        </header>
```

Replace the existing setup grids with:

```tsx
        {activeMode === "setup" ? (
          <SetupWorkspace
            activeEnvironment={activeEnvironment}
            activeProjectId={activeProject?.id}
            apiEndpoint={apiEndpoint}
            client={client}
            environments={environments}
            isEnvironmentCreationDisabled={isEnvironmentCreationDisabled}
            latestSecret={scopedLatestSecret}
            onCreateEnvironment={createEnvironment}
            onSecretCreated={storeLatestSecret}
            onSelectEnvironment={setActiveEnvironment}
          />
        ) : (
          <div className="panel">
            <div className="panel-header">
              <h2>Investigate</h2>
            </div>
            <p className="muted-text">Events investigation will be available in this section.</p>
          </div>
        )}
```

This temporary Investigate panel will be replaced in Task 4.

- [ ] **Step 6: Add mode tab styles**

Append to `apps/console/src/styles.css` near `.button-row`:

```css
.mode-tabs {
  display: inline-flex;
  gap: 4px;
  border: 1px solid #d7dde7;
  border-radius: 6px;
  background: #fff;
  padding: 4px;
}

.mode-tabs button {
  min-height: 32px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #475569;
  cursor: pointer;
  font-weight: 700;
  padding: 6px 10px;
}

.mode-tabs button[aria-pressed="true"] {
  background: #dbeafe;
  color: #1d4ed8;
}
```

Update `.workspace-header` to align the tabs:

```css
.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
```

Inside the existing mobile media query, add:

```css
  .workspace-header {
    align-items: flex-start;
    flex-direction: column;
  }
```

- [ ] **Step 7: Update `ConsoleShell` tests for mode switch**

Add this test to `apps/console/src/components/ConsoleShell.test.tsx`:

```tsx
  it("switches between setup and investigate modes without losing active environment", async () => {
    const api = client({
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
    expect(screen.getByRole("heading", { name: "Investigate" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Setup" }));
    expect(screen.getByText("Environment: Production")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Environments" })).toBeInTheDocument();
  });
```

- [ ] **Step 8: Run console shell verification**

Run:

```sh
pnpm test apps/console/src/components/ConsoleModeTabs.test.tsx apps/console/src/components/ConsoleShell.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [ ] **Step 9: Commit setup extraction and mode tabs**

Run:

```sh
git add apps/console/src/components/ConsoleModeTabs.tsx apps/console/src/components/SetupWorkspace.tsx apps/console/src/components/ConsoleModeTabs.test.tsx apps/console/src/components/ConsoleShell.tsx apps/console/src/components/ConsoleShell.test.tsx apps/console/src/styles.css
git commit -m "feat: add console investigation mode"
```

## Task 4: Build Events Investigation Components

**Files:**
- Create: `apps/console/src/components/InvestigationWorkspace.tsx`
- Create: `apps/console/src/components/EventInvestigationPanel.tsx`
- Create: `apps/console/src/components/EventFilters.tsx`
- Create: `apps/console/src/components/EventList.tsx`
- Create: `apps/console/src/components/EventDetailDrawer.tsx`
- Create: `apps/console/src/components/InvestigationWorkspace.test.tsx`
- Create: `apps/console/src/components/EventInvestigationPanel.test.tsx`
- Create: `apps/console/src/components/EventDetailDrawer.test.tsx`
- Modify: `apps/console/src/components/ConsoleShell.tsx`
- Modify: `apps/console/src/styles.css`

- [ ] **Step 1: Write `InvestigationWorkspace` tests**

Create `apps/console/src/components/InvestigationWorkspace.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { InvestigationWorkspace } from "./InvestigationWorkspace";

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
    listErrors: vi.fn(),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
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

describe("InvestigationWorkspace", () => {
  it("requires a project and environment", () => {
    render(<InvestigationWorkspace client={client({})} />);

    expect(screen.getByText("Select a project and environment in Setup to investigate events.")).toBeInTheDocument();
  });

  it("renders the events investigation view when scope exists", async () => {
    render(<InvestigationWorkspace client={client({})} environmentId="env_1" projectId="prj_1" />);

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Errors" })).toBeDisabled();
    expect(await screen.findByText("No events found")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write `EventDetailDrawer` tests**

Create `apps/console/src/components/EventDetailDrawer.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EventRecord } from "../api/types";
import { EventDetailDrawer } from "./EventDetailDrawer";

const event: EventRecord = {
  id: "evt_1",
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
  metadata: { plan: "pro" },
  name: "checkout.started",
  properties: { cart_value: 120 }
};

afterEach(() => {
  cleanup();
});

describe("EventDetailDrawer", () => {
  it("renders selected event details and formatted JSON", () => {
    render(<EventDetailDrawer event={event} />);

    expect(screen.getByRole("heading", { name: "checkout.started" })).toBeInTheDocument();
    expect(screen.getByText("tenant_1")).toBeInTheDocument();
    expect(screen.getByText("trace_1")).toBeInTheDocument();
    expect(screen.getByText(/"cart_value": 120/)).toBeInTheDocument();
    expect(screen.getByText(/"plan": "pro"/)).toBeInTheDocument();
  });

  it("renders an empty selection state", () => {
    render(<EventDetailDrawer />);

    expect(screen.getByText("Select an event to inspect its details.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Write `EventInvestigationPanel` tests**

Create `apps/console/src/components/EventInvestigationPanel.test.tsx`:

```tsx
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { EventRecord } from "../api/types";
import { EventInvestigationPanel } from "./EventInvestigationPanel";

function event(overrides: Partial<EventRecord>): EventRecord {
  return {
    id: "evt_1",
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
    name: "checkout.started",
    properties: {},
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
    listErrors: vi.fn(),
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

describe("EventInvestigationPanel", () => {
  it("loads latest events for the active project and environment", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [event({ id: "evt_1", name: "checkout.started" })] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("checkout.started")).toBeInTheDocument();
    expect(api.listEvents).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });

  it("applies event name filters only after Apply", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No events found");
    await userEvent.type(screen.getByLabelText("Event name"), "checkout.started");

    expect(api.listEvents).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(api.listEvents).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        eventName: "checkout.started",
        limit: 50
      })
    );
  });

  it("resets optional filters and reloads latest events", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No events found");
    await userEvent.type(screen.getByLabelText("Event name"), "checkout.started");
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.getByLabelText("Event name")).toHaveValue("");
    await waitFor(() =>
      expect(api.listEvents).toHaveBeenLastCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 })
    );
  });

  it("opens the detail drawer when an event is selected", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [event({ id: "evt_1", name: "checkout.started" })] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /checkout.started/ }));

    expect(screen.getByRole("heading", { name: "checkout.started" })).toBeInTheDocument();
    expect(screen.getByText("trace_1")).toBeInTheDocument();
  });

  it("shows unavailable state and retries after query failure", async () => {
    const api = client({
      listEvents: vi.fn().mockRejectedValueOnce(new Error("query failed")).mockResolvedValueOnce({ data: [] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("Events unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No events found")).toBeInTheDocument();
  });

  it("ignores stale event responses after scope changes", async () => {
    const first = deferred<{ data: EventRecord[] }>();
    const api = client({
      listEvents: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ data: [event({ id: "evt_2", environmentId: "env_2", name: "new.scope" })] })
    });

    const { rerender } = render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    rerender(<EventInvestigationPanel client={api} environmentId="env_2" projectId="prj_1" />);

    expect(await screen.findByText("new.scope")).toBeInTheDocument();

    await act(async () => {
      first.resolve({ data: [event({ id: "evt_1", name: "old.scope" })] });
      await first.promise;
    });

    expect(screen.queryByText("old.scope")).not.toBeInTheDocument();
    expect(screen.getByText("new.scope")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run investigation tests and verify they fail**

Run:

```sh
pnpm test apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/EventDetailDrawer.test.tsx apps/console/src/components/EventInvestigationPanel.test.tsx
```

Expected: fail because the components do not exist.

- [ ] **Step 5: Implement `EventFilters`**

Create `apps/console/src/components/EventFilters.tsx`:

```tsx
import type { FormEvent } from "react";

export type EventFilterValues = {
  eventName: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  traceId: string;
  from: string;
  to: string;
  limit: string;
};

type Props = {
  values: EventFilterValues;
  onChange: (values: EventFilterValues) => void;
  onApply: () => void;
  onReset: () => void;
};

function update(values: EventFilterValues, key: keyof EventFilterValues, value: string): EventFilterValues {
  return { ...values, [key]: value };
}

export function EventFilters({ values, onChange, onApply, onReset }: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply();
  }

  return (
    <form className="event-filters" onSubmit={submit}>
      <label>
        Event name
        <input value={values.eventName} onChange={(event) => onChange(update(values, "eventName", event.target.value))} />
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

- [ ] **Step 6: Implement `EventList`**

Create `apps/console/src/components/EventList.tsx`:

```tsx
import type { EventRecord } from "../api/types";

type Props = {
  events: EventRecord[];
  selectedEventId?: string;
  onSelect: (event: EventRecord) => void;
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function label(value: string | null): string {
  return value ?? "none";
}

export function EventList({ events, selectedEventId, onSelect }: Props) {
  return (
    <div className="event-list" role="list" aria-label="Events">
      {events.map((event) => (
        <button
          aria-pressed={event.id === selectedEventId}
          className="event-row"
          key={event.id}
          onClick={() => onSelect(event)}
          type="button"
        >
          <span>
            <strong>{event.name}</strong>
            <code>{event.id}</code>
          </span>
          <span>{formatTimestamp(event.timestamp)}</span>
          <span>{label(event.userId)}</span>
          <span>{label(event.tenantId)}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Implement `EventDetailDrawer`**

Create `apps/console/src/components/EventDetailDrawer.tsx`:

```tsx
import type { EventRecord } from "../api/types";

type Props = {
  event?: EventRecord;
};

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function detailValue(value: string | null | undefined): string {
  return value ?? "none";
}

export function EventDetailDrawer({ event }: Props) {
  if (!event) {
    return (
      <aside className="detail-drawer">
        <p className="muted-text">Select an event to inspect its details.</p>
      </aside>
    );
  }

  return (
    <aside className="detail-drawer">
      <div className="panel-header">
        <h2>{event.name}</h2>
      </div>
      <dl className="detail-grid">
        <dt>ID</dt>
        <dd><code>{event.id}</code></dd>
        <dt>Timestamp</dt>
        <dd>{new Date(event.timestamp).toLocaleString()}</dd>
        <dt>Received</dt>
        <dd>{new Date(event.receivedAt).toLocaleString()}</dd>
        <dt>Tenant</dt>
        <dd>{detailValue(event.tenantId)}</dd>
        <dt>User</dt>
        <dd>{detailValue(event.userId)}</dd>
        <dt>Session</dt>
        <dd>{detailValue(event.sessionId)}</dd>
        <dt>Trace</dt>
        <dd>{detailValue(event.traceId)}</dd>
        <dt>Source</dt>
        <dd>{detailValue(event.source)}</dd>
        <dt>Release</dt>
        <dd>{detailValue(event.release)}</dd>
      </dl>
      <section className="json-section">
        <h3>Properties</h3>
        <pre><code>{formatJson(event.properties)}</code></pre>
      </section>
      <section className="json-section">
        <h3>Metadata</h3>
        <pre><code>{formatJson(event.metadata)}</code></pre>
      </section>
    </aside>
  );
}
```

- [ ] **Step 8: Implement `EventInvestigationPanel`**

Create `apps/console/src/components/EventInvestigationPanel.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api/client";
import type { EventRecord, QueryFilters } from "../api/types";
import { EventDetailDrawer } from "./EventDetailDrawer";
import { EventFilters, type EventFilterValues } from "./EventFilters";
import { EventList } from "./EventList";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
};

type LoadState = "loading" | "ready" | "empty" | "unavailable";

const defaultFilters: EventFilterValues = {
  eventName: "",
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

function queryFromValues(projectId: string, environmentId: string, values: EventFilterValues): QueryFilters {
  const query: QueryFilters = {
    projectId,
    environmentId,
    limit: toLimit(values.limit)
  };

  const eventName = values.eventName.trim();
  const tenantId = values.tenantId.trim();
  const userId = values.userId.trim();
  const sessionId = values.sessionId.trim();
  const traceId = values.traceId.trim();
  const from = toIso(values.from);
  const to = toIso(values.to);

  if (eventName) query.eventName = eventName;
  if (tenantId) query.tenantId = tenantId;
  if (userId) query.userId = userId;
  if (sessionId) query.sessionId = sessionId;
  if (traceId) query.traceId = traceId;
  if (from) query.from = from;
  if (to) query.to = to;

  return query;
}

export function EventInvestigationPanel({ client, projectId, environmentId }: Props) {
  const [draftFilters, setDraftFilters] = useState<EventFilterValues>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<EventFilterValues>(defaultFilters);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventRecord | undefined>();
  const [state, setState] = useState<LoadState>("loading");
  const query = useMemo(
    () => queryFromValues(projectId, environmentId, appliedFilters),
    [projectId, environmentId, appliedFilters]
  );

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setSelectedEvent(undefined);

    void client.listEvents(query).then(
      ({ data }) => {
        if (cancelled) return;
        setEvents(data);
        setState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setEvents([]);
        setState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, query]);

  function applyFilters() {
    setAppliedFilters(draftFilters);
  }

  function resetFilters() {
    setDraftFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
  }

  return (
    <section className="investigation-layout">
      <div className="panel event-panel">
        <div className="panel-header">
          <h2>Events</h2>
        </div>
        <EventFilters values={draftFilters} onApply={applyFilters} onChange={setDraftFilters} onReset={resetFilters} />
        {state === "loading" ? <p className="muted-text">Loading events</p> : null}
        {state === "unavailable" ? (
          <div className="status-box unavailable">
            <strong>Events unavailable</strong>
            <button onClick={applyFilters} type="button">Retry</button>
          </div>
        ) : null}
        {state === "empty" ? <p className="muted-text">No events found</p> : null}
        {state === "ready" ? <EventList events={events} onSelect={setSelectedEvent} selectedEventId={selectedEvent?.id} /> : null}
      </div>
      <EventDetailDrawer event={selectedEvent} />
    </section>
  );
}
```

- [ ] **Step 9: Implement `InvestigationWorkspace`**

Create `apps/console/src/components/InvestigationWorkspace.tsx`:

```tsx
import type { ApiClient } from "../api/client";
import { EventInvestigationPanel } from "./EventInvestigationPanel";

type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
};

export function InvestigationWorkspace({ client, projectId, environmentId }: Props) {
  if (!projectId || !environmentId) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Investigate</h2>
        </div>
        <p className="muted-text">Select a project and environment in Setup to investigate events.</p>
      </section>
    );
  }

  return (
    <section className="investigation-workspace">
      <nav className="investigation-tabs" aria-label="Investigation views">
        <button aria-pressed="true" type="button">Events</button>
        <button disabled type="button">Errors</button>
        <button disabled type="button">Traces</button>
        <button disabled type="button">LLM</button>
      </nav>
      <EventInvestigationPanel client={client} environmentId={environmentId} projectId={projectId} />
    </section>
  );
}
```

- [ ] **Step 10: Wire `InvestigationWorkspace` into `ConsoleShell`**

Modify `apps/console/src/components/ConsoleShell.tsx`.

Add import:

```tsx
import { InvestigationWorkspace } from "./InvestigationWorkspace";
```

Replace the temporary Investigate panel from Task 3 with:

```tsx
        ) : (
          <InvestigationWorkspace client={client} environmentId={activeEnvironment?.id} projectId={activeProject?.id} />
        )}
```

- [ ] **Step 11: Add investigation styles**

Append to `apps/console/src/styles.css` before the mobile media query:

```css
.investigation-workspace {
  display: grid;
  gap: 12px;
}

.investigation-tabs {
  display: flex;
  gap: 8px;
}

.investigation-tabs button {
  min-height: 34px;
  border: 1px solid #d7dde7;
  border-radius: 6px;
  background: #fff;
  color: #475569;
  cursor: pointer;
  font-weight: 700;
  padding: 7px 10px;
}

.investigation-tabs button[aria-pressed="true"] {
  border-color: #2563eb;
  background: #dbeafe;
  color: #1d4ed8;
}

.investigation-tabs button:disabled {
  color: #94a3b8;
  cursor: not-allowed;
}

.investigation-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  gap: 16px;
}

.event-panel {
  min-width: 0;
}

.event-filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.event-filters label {
  display: grid;
  gap: 5px;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
}

.event-filters input {
  min-height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 7px 9px;
}

.filter-actions {
  display: flex;
  align-items: end;
  gap: 8px;
}

.filter-actions button {
  min-height: 34px;
  border: 0;
  border-radius: 6px;
  background: #2563eb;
  color: #fff;
  font-weight: 700;
  padding: 7px 10px;
}

.filter-actions button[type="button"] {
  border: 1px solid #d7dde7;
  background: #fff;
  color: #475569;
}

.event-list {
  display: grid;
  gap: 6px;
}

.event-row {
  display: grid;
  grid-template-columns: minmax(180px, 1.5fr) minmax(150px, 1fr) minmax(110px, 0.8fr) minmax(110px, 0.8fr);
  align-items: center;
  gap: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  color: #111827;
  cursor: pointer;
  padding: 10px;
  text-align: left;
}

.event-row[aria-pressed="true"] {
  border-color: #2563eb;
  background: #eff6ff;
}

.event-row span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.event-row code,
.detail-grid code,
.json-section code {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

.event-row code {
  display: block;
  color: #64748b;
  font-size: 11px;
}

.detail-drawer {
  min-width: 0;
  border: 1px solid #d7dde7;
  border-radius: 8px;
  background: #fff;
  padding: 16px;
}

.detail-grid {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  gap: 8px 10px;
  margin: 0;
  font-size: 13px;
}

.detail-grid dt {
  color: #64748b;
  font-weight: 700;
}

.detail-grid dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.json-section {
  display: grid;
  gap: 6px;
  margin-top: 14px;
}

.json-section h3 {
  margin: 0;
  font-size: 13px;
}

.json-section pre {
  overflow-x: auto;
  margin: 0;
  border-radius: 6px;
  background: #0f172a;
  padding: 10px;
}

.json-section code {
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
}
```

Inside the existing mobile media query, add:

```css
  .investigation-layout,
  .event-filters,
  .event-row {
    grid-template-columns: 1fr;
  }
```

- [ ] **Step 12: Run investigation verification**

Run:

```sh
pnpm test apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/EventDetailDrawer.test.tsx apps/console/src/components/EventInvestigationPanel.test.tsx apps/console/src/components/ConsoleShell.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [ ] **Step 13: Commit Events investigation UI**

Run:

```sh
git add apps/console/src/components/InvestigationWorkspace.tsx apps/console/src/components/EventInvestigationPanel.tsx apps/console/src/components/EventFilters.tsx apps/console/src/components/EventList.tsx apps/console/src/components/EventDetailDrawer.tsx apps/console/src/components/InvestigationWorkspace.test.tsx apps/console/src/components/EventInvestigationPanel.test.tsx apps/console/src/components/EventDetailDrawer.test.tsx apps/console/src/components/ConsoleShell.tsx apps/console/src/styles.css
git commit -m "feat: add events investigation workspace"
```

## Task 5: Update Docs And Run Final Verification

**Files:**
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update architecture docs**

Append this section to `.claude/docs/ARCHITECTURE.md`:

```md
## Events Investigation

The console includes a read-only `Investigate` mode for Events. It uses the existing human-session query route `GET /query/events` and keeps project/environment scope tied to the active console selection.

The Events query supports exact `event_name` filtering in addition to project, environment, tenant, user, session, trace, date range, and limit filters. The first investigation slice does not mutate telemetry data and does not add new storage tables.
```

- [ ] **Step 2: Update UI/UX docs**

Append this section to `.claude/docs/UI-UX.md`:

```md
## Investigation UX

- Keep `Setup` and `Investigate` as separate top-level console modes.
- Investigation views are operational, dense, and read-only by default.
- Events use a list/detail layout with filters above the list and a detail drawer for selected records.
- Filters apply only when the operator clicks `Apply`; typing does not auto-query.
- Missing project/environment state should point operators back to Setup.
```

- [ ] **Step 3: Update project summary**

In `.claude/docs/PROJECT-SUMMARY.md`, change the current phase line to:

```md
Phase 3: Operational Console.
```

Add these implemented capabilities to the existing list:

```md
- Admin Integration Console for setup and API key generation.
- Read-only Events investigation workspace with exact event-name filtering.
```

Keep the existing SDK capability because Phase 2 remains completed.

- [ ] **Step 4: Update CLAUDE.md conventions**

Add this convention to `CLAUDE.md` under `## Project Conventions`:

```md
- Keep investigation console views read-only unless a design explicitly introduces a mutation workflow.
```

- [ ] **Step 5: Run final verification**

Run:

```sh
pnpm test
pnpm build
docker compose config --quiet
```

Expected: all pass.

- [ ] **Step 6: Optional browser smoke check**

If local Postgres and Redis are available, run a smoke check:

```sh
docker compose up -d postgres redis
CONSOLE_ENABLED=true SIGNALHUB_PUBLIC_ENDPOINT=http://localhost:3000 DATABASE_URL=postgres://signalhub:signalhub-local-only-change-me@localhost:5432/signalhub REDIS_URL=redis://localhost:6379 SESSION_SECRET=change-me-to-a-long-random-secret API_KEY_PEPPER=change-me-to-a-long-random-pepper BOOTSTRAP_ADMIN_EMAIL=admin@example.com BOOTSTRAP_ADMIN_PASSWORD=change-me-admin-password-32-chars-min pnpm start:api
pnpm dev:console
```

Verify in the browser:

- Login form appears for unauthenticated users.
- Admin login reaches the console.
- `Setup` mode still shows the setup workspace.
- `Investigate` mode shows Events.
- Missing events show `No events found`.
- Event filters remain visible.

If services are unavailable, document the limitation and rely on the automated verification commands.

- [ ] **Step 7: Commit docs and verification notes**

Run:

```sh
git add .claude/docs/ARCHITECTURE.md .claude/docs/UI-UX.md .claude/docs/PROJECT-SUMMARY.md CLAUDE.md
git commit -m "docs: document events investigation console"
```

## Final Review

- [ ] Run `git status -sb` and confirm the worktree is clean.
- [ ] Run `git log --oneline -8` and confirm the task commits are readable.
- [ ] Run final code review across the implementation range before merging.
- [ ] Use `superpowers:finishing-a-development-branch` after the final review approves.
