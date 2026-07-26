import type { ReactNode } from "react";
import type { ApiClient } from "../../api/client";
import type { Environment, Project } from "../../api/types";
import { LegacyIsland } from "./LegacyIsland";
import { SetupScreen } from "./SetupScreen";
import { OverviewScreen } from "./OverviewScreen";
import { ErrorsScreen } from "./ErrorsScreen";
import { IncidentsScreen } from "./IncidentsScreen";
import { LlmScreen } from "./LlmScreen";
import { TracesScreen } from "./TracesScreen";
import { AlertsScreen } from "./AlertsScreen";
import { MonitorsScreen } from "./MonitorsScreen";
import { SystemScreen } from "./SystemScreen";
import { EventsScreen } from "./EventsScreen";
import { AnalyticsScreen } from "./AnalyticsScreen";
import type { NavSection } from "../nav";

// ─── Drill types ─────────────────────────────────────────────────────────────

export type DrillTarget = "incident" | "tenant";
export type DrillParams =
  | { groupId: string; errorId?: string }
  | { tenantId: string };

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
  /** Reload shell-level project/environment data after a mutation. */
  reload?: () => void;
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
    kind: "v2",
    render: (ctx) => <TracesScreen ctx={ctx} />,
  },

  events: {
    kind: "v2",
    render: (ctx) => <EventsScreen ctx={ctx} />,
  },

  analytics: {
    kind: "v2",
    render: (ctx) => <AnalyticsScreen ctx={ctx} />,
  },

  alerts: {
    kind: "v2",
    render: (ctx) => <AlertsScreen ctx={ctx} />,
  },

  monitors: {
    kind: "v2",
    render: (ctx) => <MonitorsScreen ctx={ctx} />,
  },

  system: {
    kind: "v2",
    render: (ctx) => <SystemScreen ctx={ctx} />,
  },

  settings: {
    kind: "v2",
    render: (ctx) => <SetupScreen ctx={ctx} />,
  },
};

// ─── renderSection ────────────────────────────────────────────────────────────

export function renderSection(section: NavSection, ctx: ScreenCtx): ReactNode {
  const entry = SCREENS[section];
  const node = entry.render(ctx);
  return entry.kind === "legacy" ? <LegacyIsland>{node}</LegacyIsland> : node;
}
