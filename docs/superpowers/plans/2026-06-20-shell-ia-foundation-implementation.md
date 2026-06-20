# Shell + IA Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved Global Home + Project Workspace information architecture foundation while preserving all existing console functionality.

**Architecture:** Introduce `home` as the global default mode and split navigation into Global, Project Workspace, and Sigmon Admin destinations. Add a lightweight Global Home component that lists projects and routes into project Operations, then map new workspace destinations (`Analyze`, `Traces`, `Errors`, `Experiments`, `Configure`) onto existing screens or explicit interim panels until deeper redesign PRs land.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, existing console API client and CSS system.

---

## Scope Boundaries

This plan implements the foundation only.

It does not implement the full Global Home risk aggregation backend, trace waterfall, incident redesign, experiment engine, or analytics dashboards. Those are covered by later Linear issues:

- `PER-310` Global Home executive risk dashboard.
- `PER-311` Project Operations dashboard refresh.
- `PER-312` Sigmon Admin separation and configuration health.
- Existing `PER-266` through `PER-271` detailed surface redesigns.

## File Structure

- Modify `apps/console/src/components/ConsoleModeTabs.tsx`
  - Expand `ConsoleMode`.
  - Replace old rail items with Global, Project Workspace, and Sigmon Admin groups.
- Create `apps/console/src/components/GlobalHomeDashboard.tsx`
  - Lightweight global entry screen.
  - Renders project list, empty state, and explicit "next signal rollups" copy for data that lands in `PER-310`.
  - Calls `onOpenProject(projectId)` to enter project Operations.
- Create `apps/console/src/components/GlobalHomeDashboard.test.tsx`
  - Component-level coverage for project list and drilldown.
- Modify `apps/console/src/components/ConsoleShell.tsx`
  - Default to `home`.
  - Route project selection from Global Home into `operations`.
  - Hide project/environment scope for `home` and `system`.
  - Render new workspace modes.
  - Keep hidden legacy modes reachable only through compatibility commands where needed.
- Modify `apps/console/src/components/ConsoleShell.test.tsx`
  - Add navigation and context tests for Global Home, project drilldown, new labels, and admin separation.
- Modify `apps/console/src/styles.css`
  - Add styles for Global Home, new navigation labels, and the Experiments interim panel.
- Modify `.claude/docs/UI-UX.md`
  - Add a short implementation note for `PER-309`.
- Optionally modify `docs/superpowers/plans/2026-06-20-shell-ia-foundation-implementation.md`
  - Check off completed steps during execution.

## Task 1: Add Global Home Component Tests

**Files:**
- Create: `apps/console/src/components/GlobalHomeDashboard.test.tsx`
- Create in Task 2: `apps/console/src/components/GlobalHomeDashboard.tsx`

- [ ] **Step 1: Write the failing test file**

Create `apps/console/src/components/GlobalHomeDashboard.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../api/types";
import { GlobalHomeDashboard } from "./GlobalHomeDashboard";

const projects: Project[] = [
  { id: "prj_microerp", name: "MicroERP", archivedAt: null },
  { id: "prj_dissip", name: "dissip", archivedAt: null }
];

describe("GlobalHomeDashboard", () => {
  it("renders the executive risk home with monitored projects", () => {
    render(<GlobalHomeDashboard isLoading={false} onOpenProject={vi.fn()} projects={projects} />);

    expect(screen.getByRole("heading", { name: "Executive risk dashboard" })).toBeInTheDocument();
    expect(screen.getByText("All monitored projects, ordered by operational attention needed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open MicroERP operations/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open dissip operations/i })).toBeInTheDocument();
  });

  it("opens project operations from a project row", async () => {
    const user = userEvent.setup();
    const onOpenProject = vi.fn();

    render(<GlobalHomeDashboard isLoading={false} onOpenProject={onOpenProject} projects={projects} />);

    await user.click(screen.getByRole("button", { name: /Open MicroERP operations/i }));

    expect(onOpenProject).toHaveBeenCalledWith("prj_microerp");
  });

  it("renders an actionable empty state when no projects exist", () => {
    render(<GlobalHomeDashboard isLoading={false} onOpenProject={vi.fn()} projects={[]} />);

    expect(screen.getByText("No monitored projects yet.")).toBeInTheDocument();
    expect(screen.getByText("Create a project in Configure or Onboarding to start collecting telemetry.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm exec vitest run apps/console/src/components/GlobalHomeDashboard.test.tsx
```

Expected: FAIL because `./GlobalHomeDashboard` does not exist.

## Task 2: Implement Global Home Component

**Files:**
- Create: `apps/console/src/components/GlobalHomeDashboard.tsx`
- Modify: `apps/console/src/styles.css`
- Test: `apps/console/src/components/GlobalHomeDashboard.test.tsx`

- [ ] **Step 1: Create the component**

Create `apps/console/src/components/GlobalHomeDashboard.tsx` with:

```tsx
import { Activity, AlertTriangle, ArrowRight, Gauge, HeartPulse, ServerCrash } from "lucide-react";
import type { Project } from "../api/types";

type Props = {
  isLoading: boolean;
  onOpenProject: (projectId: string) => void;
  projects: Project[];
};

export function GlobalHomeDashboard({ isLoading, onOpenProject, projects }: Props) {
  const projectCount = projects.length;

  return (
    <section className="global-home" aria-labelledby="global-home-title">
      <div className="global-home__hero">
        <div>
          <p className="eyebrow">Global Home</p>
          <h1 id="global-home-title">Executive risk dashboard</h1>
          <p>All monitored projects, ordered by operational attention needed.</p>
        </div>
        <span className="status-pill status-pill--attention">{projectCount === 0 ? "Setup needed" : "Baseline view"}</span>
      </div>

      <div className="global-home__kpis" aria-label="Global operational summary">
        <article className="metric-card">
          <span><Gauge aria-hidden="true" size={16} /> Projects</span>
          <strong>{projectCount}</strong>
          <small>{projectCount === 1 ? "monitored project" : "monitored projects"}</small>
        </article>
        <article className="metric-card">
          <span><AlertTriangle aria-hidden="true" size={16} /> Open incidents</span>
          <strong>--</strong>
          <small>Global aggregation lands in the next PR</small>
        </article>
        <article className="metric-card">
          <span><HeartPulse aria-hidden="true" size={16} /> Monitors</span>
          <strong>--</strong>
          <small>Down/degraded rollup pending</small>
        </article>
        <article className="metric-card">
          <span><Activity aria-hidden="true" size={16} /> Outliers</span>
          <strong>--</strong>
          <small>Error rate, p95, ingest, and LLM cost</small>
        </article>
      </div>

      <div className="global-home__grid">
        <section className="panel global-home__attention" aria-labelledby="attention-queue-title">
          <div className="panel-header">
            <div>
              <h2 id="attention-queue-title">Attention queue</h2>
              <p className="muted-text">Start from the project that needs operational review.</p>
            </div>
            <span className="count-pill">{isLoading ? "Loading" : projectCount}</span>
          </div>

          {isLoading ? (
            <p className="muted-text">Loading monitored projects...</p>
          ) : projectCount === 0 ? (
            <div className="empty-state-inline">
              <ServerCrash aria-hidden="true" size={22} />
              <strong>No monitored projects yet.</strong>
              <p>Create a project in Configure or Onboarding to start collecting telemetry.</p>
            </div>
          ) : (
            <div className="global-project-list">
              {projects.map((project) => (
                <button
                  aria-label={`Open ${project.name} operations`}
                  className="global-project-row"
                  key={project.id}
                  onClick={() => onOpenProject(project.id)}
                  type="button"
                >
                  <span>
                    <strong>{project.name}</strong>
                    <small>Open the project workspace to review operational health.</small>
                  </span>
                  <em>Operations</em>
                  <ArrowRight aria-hidden="true" size={16} />
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="panel global-home__notes" aria-labelledby="global-home-next-title">
          <div className="panel-header">
            <h2 id="global-home-next-title">Next signal rollups</h2>
          </div>
          <ul className="signal-list">
            <li><span className="signal-dot signal-dot--danger" /> Error-rate and incident spikes</li>
            <li><span className="signal-dot signal-dot--warning" /> p95 route and monitor degradation</li>
            <li><span className="signal-dot signal-dot--info" /> Positive traffic and usage outliers</li>
            <li><span className="signal-dot signal-dot--success" /> Configuration health coverage</li>
          </ul>
        </aside>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Add styles**

Append these focused styles to `apps/console/src/styles.css` near the other console shell styles:

```css
.global-home {
  display: grid;
  gap: 18px;
}

.global-home__hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.global-home__hero h1 {
  margin: 0;
  font-size: 28px;
  letter-spacing: 0;
}

.global-home__hero p {
  margin: 6px 0 0;
}

.global-home__kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.global-home__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.38fr);
  gap: 14px;
}

.global-home__attention,
.global-home__notes {
  min-height: 260px;
}

.global-project-list {
  display: grid;
  gap: 8px;
}

.global-project-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  border: 1px solid var(--border-subtle, #334155);
  border-radius: 8px;
  background: var(--surface-raised, #1f2937);
  color: inherit;
  cursor: pointer;
  padding: 12px;
  text-align: left;
}

.global-project-row:hover,
.global-project-row:focus-visible {
  border-color: var(--signal-green, #67e38a);
  outline: none;
}

.global-project-row strong,
.global-project-row small {
  display: block;
}

.global-project-row small {
  color: var(--text-muted, #94a3b8);
  margin-top: 4px;
}

.global-project-row em {
  color: var(--signal-green, #67e38a);
  font-style: normal;
  font-weight: 800;
}

.empty-state-inline {
  display: grid;
  justify-items: start;
  gap: 8px;
  color: var(--text-muted, #94a3b8);
  padding: 16px 0;
}

.empty-state-inline strong {
  color: var(--text-primary, #f8fafc);
}

.signal-list {
  display: grid;
  gap: 12px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.signal-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted, #94a3b8);
}

.signal-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--text-muted, #94a3b8);
}

.signal-dot--danger {
  background: var(--signal-red, #ff7272);
}

.signal-dot--warning {
  background: var(--signal-amber, #f0bc5e);
}

.signal-dot--info {
  background: var(--signal-blue, #83b8ff);
}

.signal-dot--success {
  background: var(--signal-green, #67e38a);
}

@media (max-width: 1040px) {
  .global-home__kpis,
  .global-home__grid {
    grid-template-columns: 1fr;
  }
}
```

If equivalent token variables already exist in `styles.css`, use those variable names instead of adding new ones.

- [ ] **Step 3: Run the focused test**

Run:

```bash
pnpm exec vitest run apps/console/src/components/GlobalHomeDashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add apps/console/src/components/GlobalHomeDashboard.tsx apps/console/src/components/GlobalHomeDashboard.test.tsx apps/console/src/styles.css
git commit -m "feat: add global home dashboard shell"
```

## Task 3: Reframe Navigation Modes

**Files:**
- Modify: `apps/console/src/components/ConsoleModeTabs.tsx`
- Test: `apps/console/src/components/ConsoleModeTabs.test.tsx`

- [ ] **Step 1: Update the mode test expectations**

Modify `apps/console/src/components/ConsoleModeTabs.test.tsx` so it asserts the new IA labels. Add or update tests to include:

```tsx
expect(screen.getByLabelText("Global")).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Home/i })).toBeInTheDocument();
expect(screen.getByLabelText("Project Workspace")).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Operations/i })).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Analyze/i })).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Traces/i })).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Errors/i })).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Experiments/i })).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Configure/i })).toBeInTheDocument();
expect(screen.getByLabelText("Sigmon Admin")).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Admin/i })).toBeInTheDocument();
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm exec vitest run apps/console/src/components/ConsoleModeTabs.test.tsx
```

Expected: FAIL because the new labels and modes do not exist.

- [ ] **Step 3: Update `ConsoleModeTabs.tsx`**

Change `ConsoleMode` to:

```ts
export type ConsoleMode =
  | "home"
  | "operations"
  | "analyze"
  | "traces"
  | "errors"
  | "experiments"
  | "configure"
  | "system"
  | "setup"
  | "overview"
  | "investigate"
  | "alerts"
  | "monitors"
  | "artifacts"
  | "project-settings";
```

Use these visible mode groups:

```ts
const globalModes: ModeItem[] = [{ mode: "home", label: "Home", icon: Gauge }];

const projectModes: ModeItem[] = [
  { mode: "operations", label: "Operations", icon: Activity },
  { mode: "analyze", label: "Analyze", icon: SearchCode },
  { mode: "traces", label: "Traces", icon: Activity },
  { mode: "errors", label: "Errors", icon: Bell },
  { mode: "experiments", label: "Experiments", icon: ShieldCheck },
  { mode: "configure", label: "Configure", icon: Settings }
];

const adminModes: ModeItem[] = [{ mode: "system", label: "Admin", icon: MonitorCheck }];
```

Render section labels as:

```tsx
<span aria-label="Global" className="mode-tabs__label">
  <span aria-hidden="true">Global</span>
  <span className="sr-only">Global</span>
</span>
```

Keep the SDK Docs link unchanged.

- [ ] **Step 4: Run the focused test**

Run:

```bash
pnpm exec vitest run apps/console/src/components/ConsoleModeTabs.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/console/src/components/ConsoleModeTabs.tsx apps/console/src/components/ConsoleModeTabs.test.tsx
git commit -m "feat: reframe console navigation areas"
```

## Task 4: Wire Global Home and Workspace Mode Routing

**Files:**
- Modify: `apps/console/src/components/ConsoleShell.tsx`
- Modify: `apps/console/src/components/ConsoleShell.test.tsx`
- Test: `apps/console/src/components/ConsoleShell.test.tsx`

- [ ] **Step 1: Add failing shell tests**

Add tests to `ConsoleShell.test.tsx` that verify:

```tsx
it("opens on Global Home without project environment scope", async () => {
  const api = client({
    listProjects: vi.fn().mockResolvedValue({ projects: [{ id: "prj_1", name: "MicroERP", archivedAt: null }] }),
    getOverview: vi.fn().mockResolvedValue({ data: overviewResponse() }),
    getOperations: vi.fn().mockResolvedValue({ data: operationsResponse() }),
    getSystemHealth: vi.fn().mockResolvedValue({ data: systemHealthResponse() })
  });

  render(<ConsoleShell client={api} user={{ id: "usr_1", email: "diogo@example.com", isAdmin: true }} />);

  expect(await screen.findByRole("heading", { name: "Executive risk dashboard" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Current environment")).not.toBeInTheDocument();
});

it("opens project Operations from Global Home", async () => {
  const user = userEvent.setup();
  const api = client({
    listProjects: vi.fn().mockResolvedValue({ projects: [{ id: "prj_1", name: "MicroERP", archivedAt: null }] }),
    listEnvironments: vi.fn().mockResolvedValue({ environments: [{ id: "env_1", projectId: "prj_1", name: "production", archivedAt: null }] }),
    getOverview: vi.fn().mockResolvedValue({ data: overviewResponse() }),
    getOperations: vi.fn().mockResolvedValue({ data: operationsResponse() }),
    getSystemHealth: vi.fn().mockResolvedValue({ data: systemHealthResponse() })
  });

  render(<ConsoleShell client={api} user={{ id: "usr_1", email: "diogo@example.com", isAdmin: true }} />);

  await user.click(await screen.findByRole("button", { name: /Open MicroERP operations/i }));

  expect(await screen.findByRole("heading", { name: /Operations/i })).toBeInTheDocument();
  expect(screen.getByLabelText("Current environment")).toBeInTheDocument();
});
```

Adjust the `User` object shape if `apps/console/src/api/types.ts` requires additional fields.

- [ ] **Step 2: Run the shell test to verify it fails**

Run:

```bash
pnpm exec vitest run apps/console/src/components/ConsoleShell.test.tsx
```

Expected: FAIL because `home` mode is not wired.

- [ ] **Step 3: Update `ConsoleShell.tsx` imports and state**

Import:

```ts
import { GlobalHomeDashboard } from "./GlobalHomeDashboard";
```

Change active mode initialization to:

```ts
const [activeMode, setActiveMode] = useState<ConsoleMode>(() =>
  parseIncidentRoute(window.location).kind === "error-group" ? "errors" : "home"
);
```

Add helpers:

```ts
const isGlobalHomeMode = activeMode === "home";
const isSigmonAdminMode = activeMode === "system";
const isProjectWorkspaceMode = !isGlobalHomeMode && !isSigmonAdminMode;
```

Replace older `isSigmonAdminMode` declaration with the three constants above.

- [ ] **Step 4: Add project drilldown helper**

Add:

```ts
function openProjectWorkspace(projectId: string) {
  selectProjectById(projectId);
  setActiveMode("operations");
}
```

If environment loading is async, do not force environment here. Existing `useEffect` will load environments after project selection.

- [ ] **Step 5: Update mode label mapping**

Update `modeLabel` to include:

```ts
home: "Home",
analyze: "Analyze",
traces: "Traces",
errors: "Errors",
experiments: "Experiments",
configure: "Configure",
```

Keep legacy labels for compatibility modes.

- [ ] **Step 6: Update header context logic**

Use `isProjectWorkspaceMode` to decide when project/environment controls render:

```tsx
{isProjectWorkspaceMode ? (
  <label className="project-scope-control">
    ...
  </label>
) : (
  <strong>{isGlobalHomeMode ? "Global" : "Sigmon"}</strong>
)}
```

Only render environment selector when `isProjectWorkspaceMode`.

Update scope pill:

```tsx
{isGlobalHomeMode
  ? "All monitored projects"
  : isSigmonAdminMode
    ? "Installation-wide"
    : activeEnvironment
      ? `Environment: ${activeEnvironment.name}`
      : "Create an environment to continue setup."}
```

- [ ] **Step 7: Render new modes**

Inside `<div className="workspace">`, add a `home` block before project-specific blocks:

```tsx
<div hidden={activeMode !== "home"}>
  {activeMode === "home" ? (
    <GlobalHomeDashboard isLoading={isLoadingProjects} onOpenProject={openProjectWorkspace} projects={projects} />
  ) : null}
</div>
```

Map new workspace modes:

- `operations` -> existing `OperationsDashboard`.
- `analyze` -> `InvestigationWorkspace` with `initialTab="events"`.
- `traces` -> `InvestigationWorkspace` with `initialTab="traces"`.
- `errors` -> `InvestigationWorkspace` with `initialTab="errors"`.
- `experiments` -> interim panel with heading `Experiments` and copy `Feature flags, A/B tests, prompt variants, and model comparisons will land in a later product slice.`
- `configure` -> existing `ProjectSettingsWorkspace`.

Keep legacy blocks for `overview`, `investigate`, `alerts`, `monitors`, `artifacts`, `project-settings`, and `setup` for command/backward compatibility during this transition.

- [ ] **Step 8: Update incident route behavior**

When an incident route is active, set mode to `"errors"` instead of `"investigate"`:

```ts
setActiveMode("errors");
```

Incident view remains active when `activeMode === "errors"` and `incidentRoute.kind === "error-group"`.

- [ ] **Step 9: Run focused shell tests**

Run:

```bash
pnpm exec vitest run apps/console/src/components/ConsoleShell.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add apps/console/src/components/ConsoleShell.tsx apps/console/src/components/ConsoleShell.test.tsx
git commit -m "feat: wire global home project workspace routing"
```

## Task 5: Update Command Palette Compatibility

**Files:**
- Modify: `apps/console/src/components/ConsoleShell.tsx`
- Test: `apps/console/src/components/ConsoleShell.test.tsx`

- [ ] **Step 1: Add or update command destination expectations**

In `ConsoleShell.test.tsx`, add a command palette assertion that the new labels exist:

```tsx
await user.keyboard("{Meta>}k{/Meta}");
expect(screen.getByRole("button", { name: /Open Home/i })).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Open Analyze/i })).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Open Traces/i })).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Open Errors/i })).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Open Configure/i })).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Open Sigmon Admin/i })).toBeInTheDocument();
```

- [ ] **Step 2: Run focused shell tests**

Run:

```bash
pnpm exec vitest run apps/console/src/components/ConsoleShell.test.tsx
```

Expected: FAIL if command destinations still use only old labels.

- [ ] **Step 3: Replace `commandDestinations` visible entries**

Use:

```ts
const commandDestinations = [
  {
    mode: "home",
    title: "Home",
    scope: "Global",
    description: "Executive risk dashboard across all monitored projects.",
    keywords: ["global", "risk", "dashboard", "projects"]
  },
  {
    mode: "operations",
    title: "Operations",
    scope: "Project workspace",
    description: "Operational cockpit for the selected project and environment.",
    keywords: ["health", "status", "latency", "error rate", "monitors"]
  },
  {
    mode: "analyze",
    title: "Analyze",
    scope: "Project workspace",
    description: "Events, tenants, users, dashboards, funnels, and retention.",
    keywords: ["event", "tenant", "user", "analytics", "funnel"]
  },
  {
    mode: "traces",
    title: "Traces",
    scope: "Project workspace",
    description: "Routes, traces, spans, latency, and waterfall investigation.",
    keywords: ["trace", "span", "route", "p95", "apm"]
  },
  {
    mode: "errors",
    title: "Errors",
    scope: "Project workspace",
    description: "Issue inbox, error groups, raw occurrences, and incident triage.",
    keywords: ["error", "incident", "source map", "stack"]
  },
  {
    mode: "experiments",
    title: "Experiments",
    scope: "Project workspace",
    description: "Feature flags, A/B tests, prompt variants, and model comparisons.",
    keywords: ["flag", "ab test", "prompt", "model"]
  },
  {
    mode: "configure",
    title: "Configure",
    scope: "Project workspace",
    description: "Environments, API keys, browser origins, SDK setup, and source maps.",
    keywords: ["settings", "api key", "origin", "sdk", "source map"]
  },
  {
    mode: "system",
    title: "Sigmon Admin",
    scope: "Sigmon admin",
    description: "Installation health, workers, scheduler, storage, backups, and deploy readiness.",
    keywords: ["admin", "server", "worker", "scheduler", "backup", "retention"]
  }
] satisfies Array<{
  mode: ConsoleMode;
  title: string;
  scope: "Global" | "Project workspace" | "Sigmon admin";
  description: string;
  keywords: string[];
}>;
```

- [ ] **Step 4: Run focused shell tests**

Run:

```bash
pnpm exec vitest run apps/console/src/components/ConsoleShell.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/console/src/components/ConsoleShell.tsx apps/console/src/components/ConsoleShell.test.tsx
git commit -m "feat: update console command destinations"
```

## Task 6: Documentation and Linear Closure

**Files:**
- Modify: `.claude/docs/UI-UX.md`
- Modify: `docs/superpowers/plans/2026-06-20-shell-ia-foundation-implementation.md`

- [ ] **Step 1: Update UI docs**

Add a short note under `Product Console Architecture` in `.claude/docs/UI-UX.md`:

```md
- `PER-309` implements the first architecture slice: Global Home as the default console context, Project Workspace drilldown to Operations, new visible workspace destinations, and compatibility mappings to existing screens while deeper Global Home/Operations/Errors/Traces/Analyze work lands in later PRs.
```

- [ ] **Step 2: Mark plan task checkboxes as complete**

Update this plan's completed checkboxes for the tasks actually finished in this PR.

- [ ] **Step 3: Run docs diff check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Commit docs**

Run:

```bash
git add .claude/docs/UI-UX.md docs/superpowers/plans/2026-06-20-shell-ia-foundation-implementation.md
git commit -m "docs: plan shell ia foundation"
```

## Task 7: Final Verification

**Files:**
- No direct edits unless verification reveals a bug.

- [ ] **Step 1: Run focused console tests**

Run:

```bash
pnpm exec vitest run apps/console/src/components/GlobalHomeDashboard.test.tsx apps/console/src/components/ConsoleModeTabs.test.tsx apps/console/src/components/ConsoleShell.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full console tests**

Run:

```bash
pnpm --filter @sigmon/console test
```

Expected: PASS.

- [ ] **Step 3: Run console build**

Run:

```bash
pnpm --filter @sigmon/console build
```

Expected: PASS.

- [ ] **Step 4: Run full project test if time allows**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 5: Open PR**

Run:

```bash
git status -sb
git push origin HEAD
gh pr create --base main --title "Add shell IA foundation" --body "## Summary
- add Global Home as the default console context
- reframe navigation around Global, Project Workspace, and Sigmon Admin
- preserve existing screens through compatibility routing

## Validation
- pnpm exec vitest run apps/console/src/components/GlobalHomeDashboard.test.tsx apps/console/src/components/ConsoleModeTabs.test.tsx apps/console/src/components/ConsoleShell.test.tsx
- pnpm --filter @sigmon/console test
- pnpm --filter @sigmon/console build
"
```

Expected: PR created.

## Self-Review Checklist

- [ ] Global Home is the first screen after login.
- [ ] Project and environment controls do not appear on Global Home.
- [ ] Clicking a project opens project Operations.
- [ ] Visible navigation uses Global, Project Workspace, and Sigmon Admin grouping.
- [ ] Existing implemented screens remain reachable during transition.
- [ ] Incident URLs still render the Incident view.
- [ ] Manual refresh, auto-refresh, command palette, and user menu still work.
- [ ] Tests cover Global Home, navigation labels, and project drilldown.
- [ ] No white/light surfaces are introduced inside the dark shell.
