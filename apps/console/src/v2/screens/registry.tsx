import type { ReactNode } from "react";
import type { ApiClient } from "../../api/client";
import type { Environment, Project } from "../../api/types";
import { AlertsPanel } from "../../components/AlertsPanel";
import { InvestigationWorkspace } from "../../components/InvestigationWorkspace";
import { ProjectSettingsWorkspace } from "../../components/ProjectSettingsWorkspace";
import { SigmonAdminWorkspace } from "../../components/SigmonAdminWorkspace";
import { LegacyIsland } from "./LegacyIsland";
import { OverviewScreen } from "./OverviewScreen";
import { ErrorsScreen } from "./ErrorsScreen";
import { IncidentsScreen } from "./IncidentsScreen";
import { LlmScreen } from "./LlmScreen";
import type { NavSection } from "../nav";

// ─── Drill types ─────────────────────────────────────────────────────────────

export type DrillTarget = "incident";
export type DrillParams = { groupId: string; errorId?: string };

// ─── ScreenCtx ───────────────────────────────────────────────────────────────

export type ScreenCtx = {
  client: ApiClient;
  project: Project | undefined;
  environment: Environment | undefined;
  environments: Environment[];
  onCreateEnvironment: (name: string) => Promise<void>;
  onArchiveEnvironment?: (environment: Environment) => Promise<void>;
  onArchiveProject: (projectId: string) => Promise<void>;
  onSecretCreated: (secret: string) => void;
  onSelectEnvironment: (environment: Environment) => void;
  onUpdateProject: (projectId: string, input: { name?: string }) => Promise<void>;
  onUpdateEnvironment?: (environment: Environment, name: string) => Promise<void>;
  navigate: (section: NavSection) => void;
  /** Navigate back to the previous screen. */
  back: () => void;
  /** Drill into a nested screen. */
  drill: (target: DrillTarget, params: DrillParams) => void;
  /** Push a transient toast notification. */
  pushToast: (message: string) => void;
};

// ─── Screen entries ───────────────────────────────────────────────────────────

export type ScreenEntry = { kind: "v2" | "legacy"; render: (ctx: ScreenCtx) => ReactNode };

export const SCREENS: Record<NavSection, ScreenEntry> = {
  overview: {
    kind: "v2",
    render: (ctx) => <OverviewScreen ctx={ctx} navigate={ctx.navigate} />,
  },

  investigate: {
    kind: "v2",
    render: (ctx) => <ErrorsScreen ctx={ctx} navigate={ctx.navigate} />,
  },

  incidents: {
    kind: "v2",
    render: (ctx) => <IncidentsScreen ctx={ctx} />,
  },

  llm: {
    kind: "v2",
    render: (ctx) => <LlmScreen ctx={ctx} />,
  },

  traces: {
    kind: "legacy",
    render: (ctx) => (
      <InvestigationWorkspace
        client={ctx.client}
        projectId={ctx.project?.id}
        environmentId={ctx.environment?.id}
        initialTab="traces"
      />
    ),
  },

  alerts: {
    kind: "legacy",
    render: (ctx) => (
      <AlertsPanel
        client={ctx.client}
        projectId={ctx.project?.id}
        environmentId={ctx.environment?.id}
      />
    ),
  },

  system: {
    kind: "legacy",
    render: (ctx) => (
      <SigmonAdminWorkspace client={ctx.client} />
    ),
  },

  settings: {
    kind: "legacy",
    render: (ctx) => (
      <ProjectSettingsWorkspace
        client={ctx.client}
        activeProject={ctx.project}
        activeEnvironment={ctx.environment}
        activeProjectId={ctx.project?.id}
        environments={ctx.environments}
        isEnvironmentCreationDisabled={!ctx.project}
        onCreateEnvironment={ctx.onCreateEnvironment}
        onArchiveEnvironment={ctx.onArchiveEnvironment}
        onArchiveProject={ctx.onArchiveProject}
        onSecretCreated={ctx.onSecretCreated}
        onSelectEnvironment={ctx.onSelectEnvironment}
        onUpdateProject={ctx.onUpdateProject}
        onUpdateEnvironment={ctx.onUpdateEnvironment}
      />
    ),
  },
};

// ─── renderSection ────────────────────────────────────────────────────────────

export function renderSection(section: NavSection, ctx: ScreenCtx): ReactNode {
  const entry = SCREENS[section];
  const node = entry.render(ctx);
  return entry.kind === "legacy" ? <LegacyIsland>{node}</LegacyIsland> : node;
}
