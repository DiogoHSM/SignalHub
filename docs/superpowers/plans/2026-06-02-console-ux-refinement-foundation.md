# Console UX Refinement Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation for the console UX refinement by separating project-scoped work from Sigmon installation administration and adding a reusable Project Settings workspace.

**Architecture:** Keep the existing React console and API client. Introduce a clearer console mode model, a grouped rail, a Project Settings workspace that reuses existing setup components, and a Sigmon Admin workspace that wraps global installation health. Defer deep CRUD expansion and broad visual polish to follow-up plans.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, lucide-react, existing Sigmon API client.

---

## Scope

This plan implements PR 1 from `docs/superpowers/specs/2026-06-02-console-ux-refinement-design.md`.

It includes:

- Project Workspace vs Sigmon Admin navigation.
- `Project Settings` as the recurring configuration destination.
- `Setup` as an onboarding-oriented state/page.
- Initial Sigmon Admin shell.
- Shared UI primitives for field help, empty states, copy feedback, and confirm actions.
- Tests for navigation, scope behavior, and labels.

It does not include:

- full alert rule edit/archive implementation;
- full notification channel edit/archive implementation;
- per-project browser-origin persistence;
- backend admin setting mutation;
- broad redesign of every Investigate/Overview component.

Those should be covered by follow-up plans.

## File Structure

Modify:

- `apps/console/src/components/ConsoleModeTabs.tsx`
  - Owns grouped rail navigation for Project Workspace and Sigmon Admin.
- `apps/console/src/components/ConsoleShell.tsx`
  - Owns mode routing, active scope, onboarding vs settings, and Sigmon Admin rendering.
- `apps/console/src/components/SetupWorkspace.tsx`
  - Becomes onboarding-friendly and delegates recurring settings to Project Settings.
- `apps/console/src/components/SystemHealthPanel.tsx`
  - Receives clearer installation-scoped labels where needed.
- `apps/console/src/components/ConsoleShell.test.tsx`
  - Adds coverage for the new mode model.
- `apps/console/src/components/ConsoleModeTabs.test.tsx`
  - Updates navigation expectations.
- `apps/console/src/styles.css`
  - Adds grouped rail, settings shell, admin shell, field help, and utility styles.
- `.claude/docs/UI-UX.md`
  - Records the new navigation model.

Create:

- `apps/console/src/components/ProjectSettingsWorkspace.tsx`
  - Canonical project/environment settings workspace.
- `apps/console/src/components/SigmonAdminWorkspace.tsx`
  - Installation-scoped admin workspace.
- `apps/console/src/components/SettingsSectionNav.tsx`
  - Small side navigation for settings/admin sections.
- `apps/console/src/components/ui/FieldHelp.tsx`
  - Reusable field help text.
- `apps/console/src/components/ui/EmptyState.tsx`
  - Reusable empty state.
- `apps/console/src/components/ui/CopyButton.tsx`
  - Reusable copy-with-feedback button.
- `apps/console/src/components/ui/ConfirmActionButton.tsx`
  - Reusable confirmation wrapper for destructive actions.
- `apps/console/src/components/ProjectSettingsWorkspace.test.tsx`
  - Tests settings sections and reused panels.
- `apps/console/src/components/SigmonAdminWorkspace.test.tsx`
  - Tests admin scope independence.

## Task 1: Update Console Mode Model And Rail Tests

**Files:**

- Modify: `apps/console/src/components/ConsoleModeTabs.tsx`
- Modify: `apps/console/src/components/ConsoleModeTabs.test.tsx`

- [ ] **Step 1: Write the failing navigation grouping test**

Add this test to `apps/console/src/components/ConsoleModeTabs.test.tsx` or update the existing mode test if the file already covers all buttons:

```tsx
it("groups project workspace modes separately from sigmon admin", () => {
  const onChange = vi.fn();

  render(<ConsoleModeTabs activeMode="overview" onChange={onChange} />);

  expect(screen.getByText("Project Workspace")).toBeInTheDocument();
  expect(screen.getByText("Sigmon Admin")).toBeInTheDocument();

  expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Project Settings" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "System Health" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Project Settings" }));
  expect(onChange).toHaveBeenCalledWith("project-settings");

  await userEvent.click(screen.getByRole("button", { name: "System Health" }));
  expect(onChange).toHaveBeenCalledWith("system");
});
```

Make sure the test file imports `userEvent` and `vi`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConsoleModeTabs } from "./ConsoleModeTabs";
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm vitest run apps/console/src/components/ConsoleModeTabs.test.tsx
```

Expected: FAIL because `Project Workspace`, `Sigmon Admin`, and `project-settings` do not exist yet.

- [ ] **Step 3: Update the mode type and grouped rail**

In `apps/console/src/components/ConsoleModeTabs.tsx`, replace the mode type and mode list with:

```tsx
import {
  Activity,
  Bell,
  FileCode2,
  Gauge,
  HeartPulse,
  KeyRound,
  MonitorCheck,
  SearchCode,
  Settings,
  ShieldCheck
} from "lucide-react";

export type ConsoleMode =
  | "setup"
  | "overview"
  | "operations"
  | "investigate"
  | "alerts"
  | "monitors"
  | "artifacts"
  | "project-settings"
  | "system";

type Props = {
  activeMode: ConsoleMode;
  onChange: (mode: ConsoleMode) => void;
};

type ModeItem = {
  mode: ConsoleMode;
  label: string;
  icon: typeof Gauge;
  title: string;
};

function ModeButton({ activeMode, item, onChange }: { activeMode: ConsoleMode; item: ModeItem; onChange: (mode: ConsoleMode) => void }) {
  const Icon = item.icon;
  return (
    <button
      aria-pressed={activeMode === item.mode}
      onClick={() => onChange(item.mode)}
      title={item.title}
      type="button"
    >
      <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
      <span>{item.label}</span>
    </button>
  );
}

export function ConsoleModeTabs({ activeMode, onChange }: Props) {
  const projectModes: ModeItem[] = [
    { mode: "overview", label: "Overview", icon: Gauge, title: "Project telemetry summary" },
    { mode: "operations", label: "Operations", icon: Activity, title: "Project health cockpit" },
    { mode: "investigate", label: "Investigate", icon: SearchCode, title: "Inspect events, errors, traces, LLM calls, entities, and users" },
    { mode: "alerts", label: "Alerts", icon: Bell, title: "Project alert rules and notification delivery" },
    { mode: "monitors", label: "Monitors", icon: HeartPulse, title: "HTTP uptime and heartbeat checks" },
    { mode: "artifacts", label: "Artifacts", icon: FileCode2, title: "Source maps and upload tokens" },
    { mode: "project-settings", label: "Project Settings", icon: Settings, title: "Project, environment, keys, snippets, and configuration" }
  ];

  const adminModes: ModeItem[] = [
    { mode: "system", label: "System Health", icon: MonitorCheck, title: "Sigmon installation health and background workers" },
    { mode: "setup", label: "Onboarding", icon: KeyRound, title: "Create the first project or environment" }
  ];

  return (
    <div className="mode-tabs" aria-label="Console modes">
      <div className="mode-tabs__group-label">Project Workspace</div>
      {projectModes.map((item) => (
        <ModeButton activeMode={activeMode} item={item} key={item.mode} onChange={onChange} />
      ))}
      <div className="mode-tabs__spacer" />
      <div className="mode-tabs__group-label">Sigmon Admin</div>
      {adminModes.map((item) => (
        <ModeButton activeMode={activeMode} item={item} key={item.mode} onChange={onChange} />
      ))}
      <a className="mode-tabs__link" href="/sdk" title="Public SDK documentation">
        <ShieldCheck aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>SDK Docs</span>
      </a>
    </div>
  );
}
```

- [ ] **Step 4: Run the navigation test**

Run:

```bash
pnpm vitest run apps/console/src/components/ConsoleModeTabs.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/ConsoleModeTabs.tsx apps/console/src/components/ConsoleModeTabs.test.tsx
git commit -m "feat: group console navigation"
```

## Task 2: Add Shared Console UI Primitives

**Files:**

- Create: `apps/console/src/components/ui/FieldHelp.tsx`
- Create: `apps/console/src/components/ui/EmptyState.tsx`
- Create: `apps/console/src/components/ui/CopyButton.tsx`
- Create: `apps/console/src/components/ui/ConfirmActionButton.tsx`

- [ ] **Step 1: Create FieldHelp**

Create `apps/console/src/components/ui/FieldHelp.tsx`:

```tsx
type Props = {
  children: React.ReactNode;
  id?: string;
};

export function FieldHelp({ children, id }: Props) {
  return (
    <p className="field-help" id={id}>
      {children}
    </p>
  );
}
```

- [ ] **Step 2: Create EmptyState**

Create `apps/console/src/components/ui/EmptyState.tsx`:

```tsx
type Props = {
  title: string;
  description: string;
  action?: React.ReactNode;
};

export function EmptyState({ action, description, title }: Props) {
  return (
    <div className="console-empty-state">
      <strong>{title}</strong>
      <p>{description}</p>
      {action ? <div className="console-empty-state__action">{action}</div> : null}
    </div>
  );
}
```

- [ ] **Step 3: Create CopyButton**

Create `apps/console/src/components/ui/CopyButton.tsx`:

```tsx
import { useState } from "react";
import { Check, Copy } from "lucide-react";

type Props = {
  value: string;
  label?: string;
};

export function CopyButton({ label = "Copy", value }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const Icon = copied ? Check : Copy;

  return (
    <button className="copy-button" onClick={() => void copy()} title={copied ? "Copied" : label} type="button">
      <Icon aria-hidden="true" size={15} />
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}
```

- [ ] **Step 4: Create ConfirmActionButton**

Create `apps/console/src/components/ui/ConfirmActionButton.tsx`:

```tsx
type Props = {
  children: React.ReactNode;
  className?: string;
  confirmMessage: string;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
  title?: string;
};

export function ConfirmActionButton({ children, className, confirmMessage, disabled, onConfirm, title }: Props) {
  async function confirm() {
    if (disabled) return;
    if (!window.confirm(confirmMessage)) return;
    await onConfirm();
  }

  return (
    <button className={className} disabled={disabled} onClick={() => void confirm()} title={title} type="button">
      {children}
    </button>
  );
}
```

- [ ] **Step 5: Add CSS utilities**

Append these styles to `apps/console/src/styles.css` near the other shared console utility classes:

```css
.field-help {
  margin: 4px 0 0;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.4;
}

.console-empty-state {
  display: grid;
  gap: 6px;
  padding: 18px;
  border: 1px dashed rgba(148, 163, 184, 0.38);
  border-radius: 8px;
  color: #cbd5e1;
  background: rgba(15, 23, 42, 0.24);
}

.console-empty-state p {
  margin: 0;
  color: #94a3b8;
  font-size: 13px;
}

.console-empty-state__action {
  margin-top: 6px;
}

.copy-button {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(148, 163, 184, 0.32);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.72);
  color: #e2e8f0;
  cursor: pointer;
  font-weight: 700;
  padding: 6px 10px;
}
```

- [ ] **Step 6: Run TypeScript check for the console**

Run:

```bash
pnpm --filter @sigmon/console exec tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/components/ui apps/console/src/styles.css
git commit -m "feat: add shared console ui primitives"
```

## Task 3: Add Project Settings Workspace

**Files:**

- Create: `apps/console/src/components/SettingsSectionNav.tsx`
- Create: `apps/console/src/components/ProjectSettingsWorkspace.tsx`
- Create: `apps/console/src/components/ProjectSettingsWorkspace.test.tsx`

- [ ] **Step 1: Write the failing Project Settings test**

Create `apps/console/src/components/ProjectSettingsWorkspace.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { ProjectSettingsWorkspace } from "./ProjectSettingsWorkspace";

function client(): ApiClient {
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
    listApiKeys: vi.fn().mockResolvedValue({ apiKeys: [] }),
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
    getSystemHealth: vi.fn(),
    listEntityTenants: vi.fn(),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn(),
    getUserDetail: vi.fn(),
    listUsers: vi.fn().mockResolvedValue({ users: [] }),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    listNotificationChannels: vi.fn().mockResolvedValue({ channels: [] }),
    createNotificationChannel: vi.fn(),
    updateNotificationChannel: vi.fn(),
    archiveNotificationChannel: vi.fn(),
    listAlertRules: vi.fn().mockResolvedValue({ rules: [] }),
    createAlertRule: vi.fn(),
    updateAlertRule: vi.fn(),
    archiveAlertRule: vi.fn(),
    listAlertEvents: vi.fn(),
    getAlertEvent: vi.fn(),
    listErrorGroups: vi.fn(),
    getErrorGroup: vi.fn(),
    getErrorGroupIncident: vi.fn(),
    updateErrorGroupStatus: vi.fn(),
    updateErrorGroupTriage: vi.fn(),
    getSessionTimeline: vi.fn(),
    listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
    uploadSourceMap: vi.fn(),
    uploadSourceMapBundle: vi.fn(),
    deleteSourceMapArtifact: vi.fn(),
    getErrorSourceMapResolution: vi.fn()
  };
}

it("renders recurring project settings with explicit configuration sections", () => {
  render(
    <ProjectSettingsWorkspace
      activeEnvironment={{ id: "env_1", projectId: "prj_1", name: "production", createdAt: "", updatedAt: "", archivedAt: null }}
      activeProjectId="prj_1"
      apiEndpoint="https://my.sigmon.app"
      client={client()}
      environments={[{ id: "env_1", projectId: "prj_1", name: "production", createdAt: "", updatedAt: "", archivedAt: null }]}
      isEnvironmentCreationDisabled={false}
      latestSecret={undefined}
      onCreateEnvironment={vi.fn()}
      onSecretCreated={vi.fn()}
      onSelectEnvironment={vi.fn()}
    />
  );

  expect(screen.getByRole("heading", { name: "Project Settings" })).toBeInTheDocument();
  expect(screen.getByText("Recurring configuration for the selected project and environment.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Environments" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "API keys" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Browser origins" })).toBeInTheDocument();
  expect(screen.getByText("Browser origins must include protocol, for example https://app.example.com.")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm vitest run apps/console/src/components/ProjectSettingsWorkspace.test.tsx
```

Expected: FAIL because `ProjectSettingsWorkspace` does not exist.

- [ ] **Step 3: Create SettingsSectionNav**

Create `apps/console/src/components/SettingsSectionNav.tsx`:

```tsx
export type SettingsSection = {
  id: string;
  label: string;
  description: string;
};

type Props = {
  activeSectionId: string;
  sections: SettingsSection[];
  onChange: (sectionId: string) => void;
};

export function SettingsSectionNav({ activeSectionId, onChange, sections }: Props) {
  return (
    <nav className="settings-section-nav" aria-label="Settings sections">
      {sections.map((section) => (
        <button
          aria-pressed={activeSectionId === section.id}
          key={section.id}
          onClick={() => onChange(section.id)}
          type="button"
        >
          <strong>{section.label}</strong>
          <span>{section.description}</span>
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Create ProjectSettingsWorkspace**

Create `apps/console/src/components/ProjectSettingsWorkspace.tsx`:

```tsx
import { useState } from "react";
import type { ApiClient } from "../api/client";
import type { Environment } from "../api/types";
import { ApiKeyPanel } from "./ApiKeyPanel";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { EnvironmentSelector } from "./EnvironmentSelector";
import { SettingsSectionNav, type SettingsSection } from "./SettingsSectionNav";
import { SnippetPanel } from "./SnippetPanel";
import { UserAdminPanel } from "./UserAdminPanel";
import { EmptyState } from "./ui/EmptyState";
import { FieldHelp } from "./ui/FieldHelp";

type Props = {
  client: ApiClient;
  activeEnvironment?: Environment;
  activeProjectId?: string;
  apiEndpoint?: string;
  environments: Environment[];
  isEnvironmentCreationDisabled: boolean;
  latestSecret?: string;
  onCreateEnvironment: (name: string) => Promise<void>;
  onSecretCreated: (secret: string) => void;
  onSelectEnvironment: (environment: Environment) => void;
};

const sections: SettingsSection[] = [
  { id: "environments", label: "Environments", description: "Production, preview, staging, and local scopes" },
  { id: "api-keys", label: "API keys", description: "Server and browser ingestion credentials" },
  { id: "browser-origins", label: "Browser origins", description: "Allowed frontend origins for browser SDK calls" },
  { id: "snippets", label: "SDK snippets", description: "Copy integration examples for this environment" },
  { id: "artifacts", label: "Source maps", description: "Upload maps and manage CI upload metadata" },
  { id: "members", label: "Members", description: "Console users and access bootstrap" }
];

export function ProjectSettingsWorkspace({
  activeEnvironment,
  activeProjectId,
  apiEndpoint,
  client,
  environments,
  isEnvironmentCreationDisabled,
  latestSecret,
  onCreateEnvironment,
  onSecretCreated,
  onSelectEnvironment
}: Props) {
  const [activeSectionId, setActiveSectionId] = useState(sections[0].id);

  if (!activeProjectId) {
    return (
      <section className="settings-workspace">
        <EmptyState
          title="No project selected"
          description="Create or select a project before changing project settings."
        />
      </section>
    );
  }

  return (
    <section className="settings-workspace">
      <header className="settings-workspace__header">
        <div>
          <h2>Project Settings</h2>
          <p className="muted-text">Recurring configuration for the selected project and environment.</p>
        </div>
        <span className="scope-pill">
          <span className="scope-pill__dot" />
          {activeEnvironment ? `Environment: ${activeEnvironment.name}` : "Create an environment"}
        </span>
      </header>
      <div className="settings-workspace__body">
        <SettingsSectionNav activeSectionId={activeSectionId} onChange={setActiveSectionId} sections={sections} />
        <div className="settings-workspace__content">
          {activeSectionId === "environments" ? (
            <EnvironmentSelector
              activeEnvironmentId={activeEnvironment?.id}
              disabled={isEnvironmentCreationDisabled}
              environments={environments}
              onCreate={onCreateEnvironment}
              onSelect={onSelectEnvironment}
            />
          ) : null}
          {activeSectionId === "api-keys" ? (
            <ApiKeyPanel
              client={client}
              environmentId={activeEnvironment?.id}
              onSecretCreated={onSecretCreated}
              projectId={activeProjectId}
            />
          ) : null}
          {activeSectionId === "browser-origins" ? (
            <section className="panel">
              <div className="panel-header">
                <h2>Browser origins</h2>
              </div>
              <p className="muted-text">Browser SDK calls require an allowed origin for CORS preflight requests.</p>
              <FieldHelp>Browser origins must include protocol, for example https://app.example.com.</FieldHelp>
              <EmptyState
                title="Global origin configuration"
                description="This install currently reads browser origins from BROWSER_CORS_ORIGINS. Per-project origin editing will be added when the API stores origins by project and environment."
              />
            </section>
          ) : null}
          {activeSectionId === "snippets" ? (
            <SnippetPanel
              apiEndpoint={apiEndpoint}
              environmentId={activeEnvironment?.id}
              latestSecret={latestSecret}
              projectId={activeProjectId}
            />
          ) : null}
          {activeSectionId === "artifacts" ? (
            <ArtifactsPanel client={client} environmentId={activeEnvironment?.id} projectId={activeProjectId} />
          ) : null}
          {activeSectionId === "members" ? <UserAdminPanel client={client} /> : null}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Add settings CSS**

Append to `apps/console/src/styles.css`:

```css
.settings-workspace {
  display: grid;
  gap: 16px;
}

.settings-workspace__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.settings-workspace__header h2 {
  margin: 0;
  font-size: 24px;
}

.settings-workspace__body {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.settings-workspace__content {
  min-width: 0;
}

.settings-section-nav {
  display: grid;
  gap: 8px;
}

.settings-section-nav button {
  display: grid;
  gap: 3px;
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.42);
  color: #e2e8f0;
  cursor: pointer;
  padding: 10px 12px;
  text-align: left;
}

.settings-section-nav button[aria-pressed="true"] {
  border-color: rgba(74, 222, 128, 0.58);
  background: rgba(22, 101, 52, 0.24);
}

.settings-section-nav span {
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.35;
}

@media (max-width: 920px) {
  .settings-workspace__body {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 6: Run the Project Settings test**

Run:

```bash
pnpm vitest run apps/console/src/components/ProjectSettingsWorkspace.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/components/SettingsSectionNav.tsx apps/console/src/components/ProjectSettingsWorkspace.tsx apps/console/src/components/ProjectSettingsWorkspace.test.tsx apps/console/src/styles.css
git commit -m "feat: add project settings workspace"
```

## Task 4: Add Sigmon Admin Workspace

**Files:**

- Create: `apps/console/src/components/SigmonAdminWorkspace.tsx`
- Create: `apps/console/src/components/SigmonAdminWorkspace.test.tsx`
- Modify: `apps/console/src/components/SystemHealthPanel.tsx`

- [ ] **Step 1: Write the failing Sigmon Admin test**

Create `apps/console/src/components/SigmonAdminWorkspace.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { SystemHealthResponse } from "../api/types";
import { SigmonAdminWorkspace } from "./SigmonAdminWorkspace";

function health(): SystemHealthResponse {
  return {
    generatedAt: "2026-06-02T12:00:00.000Z",
    status: "healthy",
    services: {
      api: { status: "healthy", uptimeSeconds: 120 },
      postgres: { status: "healthy", latencyMs: 4 },
      redis: { status: "healthy", latencyMs: 2 },
      worker: { status: "healthy", expected: true, role: "queue", lastHeartbeatAt: "2026-06-02T11:59:00.000Z" },
      scheduler: { status: "healthy", expected: true, role: "scheduler", lastHeartbeatAt: "2026-06-02T11:59:00.000Z" }
    },
    deployment: {
      api: { nodeEnv: "production", consoleEnabled: true, publicEndpointConfigured: true, googleOAuthEnabled: false, smtpConfigured: true },
      background: { queueExpected: true, schedulerExpected: true, alertsEnabled: true, alertsIntervalMinutes: 1, monitorsEnabled: true, monitorsIntervalMinutes: 1, retentionEnabled: true, retentionIntervalMinutes: 60, backupsEnabled: true, backupsIntervalHours: 24 },
      storage: { backupS3Enabled: false, sourceMapRetentionEnabled: true }
    },
    queues: { telemetry: { status: "healthy", errorMessage: null, waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 } },
    ingestion: { lastEventAt: null, lastErrorAt: null, lastTraceAt: null, lastSpanAt: null, lastLlmCallAt: null },
    retention: { enabled: true, intervalMinutes: 60, policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180, breadcrumbsDays: 30, sourceMapsEnabled: true, sourceMapsDays: 180, sourceMapsBatchSize: 100 }, lastRun: null },
    backups: { enabled: true, intervalHours: 24, localRetentionDays: 14, s3Enabled: false, stale: false, latest: null }
  };
}

function client(): ApiClient {
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
    getSystemHealth: vi.fn().mockResolvedValue({ data: health() }),
    listEntityTenants: vi.fn(),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn(),
    getUserDetail: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    listNotificationChannels: vi.fn(),
    createNotificationChannel: vi.fn(),
    updateNotificationChannel: vi.fn(),
    archiveNotificationChannel: vi.fn(),
    listAlertRules: vi.fn(),
    createAlertRule: vi.fn(),
    updateAlertRule: vi.fn(),
    archiveAlertRule: vi.fn(),
    listAlertEvents: vi.fn(),
    getAlertEvent: vi.fn(),
    listErrorGroups: vi.fn(),
    getErrorGroup: vi.fn(),
    getErrorGroupIncident: vi.fn(),
    updateErrorGroupStatus: vi.fn(),
    updateErrorGroupTriage: vi.fn(),
    getSessionTimeline: vi.fn(),
    listSourceMapArtifacts: vi.fn(),
    uploadSourceMap: vi.fn(),
    uploadSourceMapBundle: vi.fn(),
    deleteSourceMapArtifact: vi.fn(),
    getErrorSourceMapResolution: vi.fn()
  };
}

it("renders installation-scoped Sigmon admin sections", async () => {
  render(<SigmonAdminWorkspace client={client()} />);

  expect(screen.getByRole("heading", { name: "Sigmon Admin" })).toBeInTheDocument();
  expect(screen.getByText("Installation-level status and server configuration.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "System health" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Server settings" })).toBeInTheDocument();

  await waitFor(() => expect(screen.getByText("API")).toBeInTheDocument());
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm vitest run apps/console/src/components/SigmonAdminWorkspace.test.tsx
```

Expected: FAIL because `SigmonAdminWorkspace` does not exist.

- [ ] **Step 3: Create SigmonAdminWorkspace**

Create `apps/console/src/components/SigmonAdminWorkspace.tsx`:

```tsx
import { useState } from "react";
import type { ApiClient } from "../api/client";
import { SettingsSectionNav, type SettingsSection } from "./SettingsSectionNav";
import { SystemHealthPanel } from "./SystemHealthPanel";
import { EmptyState } from "./ui/EmptyState";
import { FieldHelp } from "./ui/FieldHelp";

type Props = {
  client: ApiClient;
};

const sections: SettingsSection[] = [
  { id: "health", label: "System health", description: "API, data stores, workers, scheduler, queues" },
  { id: "server", label: "Server settings", description: "Deployment and environment-variable readiness" },
  { id: "smtp", label: "SMTP & delivery", description: "Server-level email provider configuration" },
  { id: "retention", label: "Retention & backups", description: "Data cleanup and backup job readiness" },
  { id: "security", label: "Security & CORS", description: "Browser origins and installation security posture" }
];

export function SigmonAdminWorkspace({ client }: Props) {
  const [activeSectionId, setActiveSectionId] = useState(sections[0].id);

  return (
    <section className="settings-workspace sigmon-admin-workspace">
      <header className="settings-workspace__header">
        <div>
          <h2>Sigmon Admin</h2>
          <p className="muted-text">Installation-level status and server configuration.</p>
        </div>
        <span className="status-pill status-pill--neutral">Global</span>
      </header>
      <div className="settings-workspace__body">
        <SettingsSectionNav activeSectionId={activeSectionId} onChange={setActiveSectionId} sections={sections} />
        <div className="settings-workspace__content">
          {activeSectionId === "health" ? <SystemHealthPanel client={client} /> : null}
          {activeSectionId === "server" ? (
            <section className="panel">
              <div className="panel-header">
                <h2>Server settings</h2>
              </div>
              <p className="muted-text">Read-only deployment readiness for this Sigmon installation.</p>
              <FieldHelp>Values are configured through EasyPanel, Docker, or environment variables until admin editing is added.</FieldHelp>
              <EmptyState
                title="Read-only readiness"
                description="Use System health for live configured/missing status. Editable server settings will be added behind explicit admin APIs."
              />
            </section>
          ) : null}
          {activeSectionId === "smtp" ? (
            <section className="panel">
              <div className="panel-header">
                <h2>SMTP & delivery</h2>
              </div>
              <p className="muted-text">SMTP is configured at the Sigmon installation level. Notification channels belong to projects.</p>
              <FieldHelp>Email notification channels use this server SMTP configuration for delivery.</FieldHelp>
            </section>
          ) : null}
          {activeSectionId === "retention" ? (
            <section className="panel">
              <div className="panel-header">
                <h2>Retention & backups</h2>
              </div>
              <p className="muted-text">Retention and backup status are summarized in System health.</p>
              <FieldHelp>Retention removes old telemetry according to the installation policy. Backup settings are deployment-level configuration.</FieldHelp>
            </section>
          ) : null}
          {activeSectionId === "security" ? (
            <section className="panel">
              <div className="panel-header">
                <h2>Security & CORS</h2>
              </div>
              <p className="muted-text">Global browser ingestion origins are currently configured by BROWSER_CORS_ORIGINS.</p>
              <FieldHelp>Project-specific browser origin editing requires a stored origin model and dynamic CORS lookup.</FieldHelp>
            </section>
          ) : null}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Update SystemHealthPanel title**

In `apps/console/src/components/SystemHealthPanel.tsx`, change:

```tsx
<h2>System</h2>
<p className="muted-text">Read-only operational status for core services and background work.</p>
```

to:

```tsx
<h2>System health</h2>
<p className="muted-text">Read-only installation status for core Sigmon services and background work.</p>
```

- [ ] **Step 5: Run the Sigmon Admin test**

Run:

```bash
pnpm vitest run apps/console/src/components/SigmonAdminWorkspace.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/components/SigmonAdminWorkspace.tsx apps/console/src/components/SigmonAdminWorkspace.test.tsx apps/console/src/components/SystemHealthPanel.tsx
git commit -m "feat: add sigmon admin workspace"
```

## Task 5: Wire New Workspaces Into ConsoleShell

**Files:**

- Modify: `apps/console/src/components/ConsoleShell.tsx`
- Modify: `apps/console/src/components/ConsoleShell.test.tsx`

- [ ] **Step 1: Write the failing ConsoleShell integration test**

Add this test to `apps/console/src/components/ConsoleShell.test.tsx`:

```tsx
it("opens Project Settings without returning to onboarding setup", async () => {
  const user = userEvent.setup();
  const testClient = client({
    listProjects: vi.fn().mockResolvedValue({
      projects: [{ id: "prj_1", name: "MicroERP", createdAt: "", updatedAt: "", archivedAt: null }]
    }),
    listEnvironments: vi.fn().mockResolvedValue({
      environments: [{ id: "env_1", projectId: "prj_1", name: "production", createdAt: "", updatedAt: "", archivedAt: null }]
    }),
    getOverview: vi.fn().mockResolvedValue({ data: overviewResponse() })
  });

  render(<ConsoleShell apiEndpoint="https://my.sigmon.app" client={testClient} />);

  await screen.findByText("MicroERP");
  await user.click(screen.getByRole("button", { name: "Project Settings" }));

  expect(screen.getByRole("heading", { name: "Project Settings" })).toBeInTheDocument();
  expect(screen.getByText("Recurring configuration for the selected project and environment.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Projects")).not.toBeVisible();
});

it("opens Sigmon Admin as a global installation workspace", async () => {
  const user = userEvent.setup();
  const testClient = client({
    listProjects: vi.fn().mockResolvedValue({
      projects: [{ id: "prj_1", name: "MicroERP", createdAt: "", updatedAt: "", archivedAt: null }]
    }),
    listEnvironments: vi.fn().mockResolvedValue({
      environments: [{ id: "env_1", projectId: "prj_1", name: "production", createdAt: "", updatedAt: "", archivedAt: null }]
    }),
    getOverview: vi.fn().mockResolvedValue({ data: overviewResponse() }),
    getSystemHealth: vi.fn().mockResolvedValue({ data: systemHealthResponse() })
  });

  render(<ConsoleShell apiEndpoint="https://my.sigmon.app" client={testClient} />);

  await screen.findByText("MicroERP");
  await user.click(screen.getByRole("button", { name: "System Health" }));

  expect(screen.getByRole("heading", { name: "Sigmon Admin" })).toBeInTheDocument();
  expect(screen.getByText("Installation-level status and server configuration.")).toBeInTheDocument();
  await screen.findByRole("heading", { name: "System health" });
});
```

- [ ] **Step 2: Run the failing ConsoleShell tests**

Run:

```bash
pnpm vitest run apps/console/src/components/ConsoleShell.test.tsx
```

Expected: FAIL because `ConsoleShell` does not route `project-settings` or render `SigmonAdminWorkspace` yet.

- [ ] **Step 3: Import new workspaces**

In `apps/console/src/components/ConsoleShell.tsx`, add imports:

```tsx
import { ProjectSettingsWorkspace } from "./ProjectSettingsWorkspace";
import { SigmonAdminWorkspace } from "./SigmonAdminWorkspace";
```

- [ ] **Step 4: Route Project Settings and Sigmon Admin**

In `ConsoleShell`, change the rendering block so the setup block is onboarding-only and add the two new modes.

Replace the existing setup render block:

```tsx
<div className="setup-shell" hidden={activeMode !== "setup"}>
  <ProjectSwitcher ... />
  <SetupWorkspace ... />
</div>
```

with:

```tsx
<div className="setup-shell" hidden={activeMode !== "setup"}>
  <ProjectSwitcher
    activeProjectId={activeProject?.id}
    disabled={isLoadingProjects}
    onCreate={createProject}
    onSelect={selectProject}
    projects={projects}
  />
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
</div>
<div hidden={activeMode !== "project-settings"}>
  {activeMode === "project-settings" ? (
    <ProjectSettingsWorkspace
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
  ) : null}
</div>
```

Replace the existing system block:

```tsx
<div hidden={activeMode !== "system"}>{activeMode === "system" ? <SystemHealthPanel client={client} /> : null}</div>
```

with:

```tsx
<div hidden={activeMode !== "system"}>
  {activeMode === "system" ? <SigmonAdminWorkspace client={client} /> : null}
</div>
```

- [ ] **Step 5: Update modeLabel**

In `modeLabel`, add the new label and update system wording:

```tsx
project-settings: "Project Settings",
system: "Sigmon Admin"
```

The full labels object should include:

```tsx
const labels: Record<ConsoleMode, string> = {
  alerts: "Alerts",
  artifacts: "Artifacts",
  investigate: "Investigate",
  monitors: "Monitors",
  operations: "Operations",
  overview: "Overview",
  "project-settings": "Project Settings",
  setup: "Onboarding",
  system: "Sigmon Admin"
};
```

- [ ] **Step 6: Run ConsoleShell tests**

Run:

```bash
pnpm vitest run apps/console/src/components/ConsoleShell.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/components/ConsoleShell.tsx apps/console/src/components/ConsoleShell.test.tsx
git commit -m "feat: wire console settings and admin workspaces"
```

## Task 6: Improve Onboarding Copy And Field Units

**Files:**

- Modify: `apps/console/src/components/SetupWorkspace.tsx`
- Modify: `apps/console/src/components/MonitorsPanel.tsx`
- Modify: `apps/console/src/components/AlertsPanel.tsx`
- Modify: `apps/console/src/components/MonitorsPanel.test.tsx`
- Modify: `apps/console/src/components/AlertsPanel.test.tsx`

- [ ] **Step 1: Add tests for unit labels**

In `apps/console/src/components/MonitorsPanel.test.tsx`, add or update expectations so the rendered form includes:

```tsx
expect(screen.getByLabelText("Check interval (minutes)")).toBeInTheDocument();
expect(screen.getByLabelText("Timeout (milliseconds)")).toBeInTheDocument();
expect(screen.getByLabelText("Expected heartbeat interval (minutes)")).toBeInTheDocument();
expect(screen.getByLabelText("Grace period (minutes)")).toBeInTheDocument();
```

In `apps/console/src/components/AlertsPanel.test.tsx`, add or update expectations so the rendered form includes:

```tsx
expect(screen.getByLabelText("Window (minutes)")).toBeInTheDocument();
expect(screen.getByLabelText("Threshold")).toBeInTheDocument();
expect(screen.getByLabelText("Cooldown (minutes)")).toBeInTheDocument();
```

- [ ] **Step 2: Run the failing label tests**

Run:

```bash
pnpm vitest run apps/console/src/components/MonitorsPanel.test.tsx apps/console/src/components/AlertsPanel.test.tsx
```

Expected: FAIL because labels are still `Interval`, `Timeout`, `Grace`, `Window`, and `Cooldown`.

- [ ] **Step 3: Update MonitorsPanel labels and help text**

In `apps/console/src/components/MonitorsPanel.tsx`, update HTTP monitor form labels:

```tsx
<label>
  Check interval (minutes)
  <input ... />
</label>
<label>
  Timeout (milliseconds)
  <input ... />
</label>
```

Update heartbeat form labels:

```tsx
<label>
  Expected heartbeat interval (minutes)
  <input ... />
</label>
<label>
  Grace period (minutes)
  <input ... />
</label>
```

Add concise help text under the heartbeat timing controls:

```tsx
<p className="field-help">A heartbeat is down when no check-in arrives inside the expected interval plus grace period.</p>
```

Use the same labels in the edit form.

- [ ] **Step 4: Update AlertsPanel labels and help text**

In `apps/console/src/components/AlertsPanel.tsx`, update alert rule labels:

```tsx
<label>
  Window (minutes)
  <input ... />
</label>
<label>
  Threshold
  <input ... />
</label>
<label>
  Cooldown (minutes)
  <input ... />
</label>
```

Add help text below the rule type select:

```tsx
<p className="field-help">Error-rate thresholds are percentages. Trace p95 latency thresholds are milliseconds.</p>
```

- [ ] **Step 5: Run label tests**

Run:

```bash
pnpm vitest run apps/console/src/components/MonitorsPanel.test.tsx apps/console/src/components/AlertsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/components/SetupWorkspace.tsx apps/console/src/components/MonitorsPanel.tsx apps/console/src/components/AlertsPanel.tsx apps/console/src/components/MonitorsPanel.test.tsx apps/console/src/components/AlertsPanel.test.tsx
git commit -m "fix: clarify console form units"
```

## Task 7: Final Styling, Docs, And Verification

**Files:**

- Modify: `apps/console/src/styles.css`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `docs/superpowers/plans/2026-06-02-console-ux-refinement-foundation.md`

- [ ] **Step 1: Add grouped rail styles**

In `apps/console/src/styles.css`, add or update the grouped rail styles:

```css
.mode-tabs__group-label {
  margin: 10px 8px 4px;
  color: #64748b;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.mode-tabs__link {
  display: flex;
  min-height: 32px;
  align-items: center;
  gap: 8px;
  border-radius: 8px;
  color: #94a3b8;
  font-weight: 700;
  padding: 7px 10px;
  text-decoration: none;
}

.mode-tabs__link:hover {
  background: rgba(148, 163, 184, 0.1);
  color: #e2e8f0;
}

.sigmon-admin-workspace .settings-workspace__header {
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  padding-bottom: 14px;
}
```

If existing `.mode-tabs` styles are horizontal from older CSS, update them to the current rail orientation without changing unrelated colors:

```css
.mode-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
```

- [ ] **Step 2: Update UI-UX docs**

Append this section to `.claude/docs/UI-UX.md`:

```markdown
## Console UX Refinement Foundation

- The console now uses a project-first navigation model.
- Project-scoped work lives in the Project Workspace: Overview, Operations, Investigate, Alerts, Monitors, Artifacts, and Project Settings.
- Project Settings is the recurring configuration area for environments, API keys, snippets, browser-origin guidance, source maps, and user administration.
- Setup is treated as onboarding for creating the first project/environment rather than the permanent settings surface.
- Sigmon Admin is installation-scoped and separate from monitored project health. It contains System Health and future server configuration areas.
- Form labels should include units when relevant, such as `Check interval (minutes)` and `Timeout (milliseconds)`.
```

- [ ] **Step 3: Run targeted tests**

Run:

```bash
pnpm vitest run apps/console/src/components/ConsoleModeTabs.test.tsx apps/console/src/components/ConsoleShell.test.tsx apps/console/src/components/ProjectSettingsWorkspace.test.tsx apps/console/src/components/SigmonAdminWorkspace.test.tsx apps/console/src/components/MonitorsPanel.test.tsx apps/console/src/components/AlertsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run console typecheck and build**

Run:

```bash
pnpm --filter @sigmon/console exec tsc -p tsconfig.json --noEmit
pnpm --filter @sigmon/console build
```

Expected: both PASS.

- [ ] **Step 5: Run full tests if targeted tests and build pass**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 6: Run diff whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 7: Commit docs and styling**

```bash
git add apps/console/src/styles.css .claude/docs/UI-UX.md docs/superpowers/plans/2026-06-02-console-ux-refinement-foundation.md
git commit -m "docs: record console ux foundation"
```

## Self-Review Checklist

Before opening a PR:

- [ ] Project Workspace modes are visually grouped.
- [ ] Sigmon Admin modes are visually separate.
- [ ] `Project Settings` renders with an active project.
- [ ] `Project Settings` explains browser-origin limitations instead of pretending per-project CORS editing exists.
- [ ] `Sigmon Admin` renders without depending on a selected project or environment.
- [ ] `System health` copy says installation-scoped, not project-scoped.
- [ ] Monitor labels include minutes/milliseconds units.
- [ ] Alert labels include minutes and threshold guidance.
- [ ] Existing setup/onboarding still allows project and environment creation.
- [ ] Tests and build pass.

## Follow-Up Plans

After this foundation PR lands, create separate plans for:

1. Alert rules and notification channel edit/archive flows.
2. Project Settings resource CRUD expansion.
3. Sigmon Admin readiness and SMTP test APIs.
4. Operational screen visual polish across Overview, Operations, Investigate, Alerts, Monitors, and Artifacts.
5. Per-project browser-origin persistence and dynamic CORS lookup.
