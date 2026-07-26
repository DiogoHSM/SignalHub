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
import { UsersScreen } from "./UsersScreen";
import { AlertsScreen } from "./AlertsScreen";
import { MonitorsScreen } from "./MonitorsScreen";
import { SystemScreen } from "./SystemScreen";
import type { NavSection } from "../nav";

// ─── Drill types ─────────────────────────────────────────────────────────────

export type DrillTarget = "incident" | "tenant";
export type DrillParams =
  | { groupId: string; errorId?: string }
  | { tenantId: string };

// ─── Navigation filter payload ───────────────────────────────────────────────
//
// Sections that accept a filter seed via `navigate(section, filters)`. The
// receiving screen reads `ctx.pendingFilters` once on mount (the payload is
// one-shot — see `clearPendingFilters`) and pre-applies it as its initial
// local filter state. Each filter type mirrors the 1:1 subset of fields the
// target screen's query already supports (see client.ts `QueryFilters` and
// `ErrorGroupQuery`).
export type EventsFilters = { eventName?: string; tenantId?: string; userId?: string; sessionId?: string; traceId?: string };
export type ErrorsFilters = { tenantId?: string; userId?: string; severity?: string; status?: string };
export type TracesFilters = { tenantId?: string; userId?: string; sessionId?: string; traceId?: string };
export type LlmFilters = { tenantId?: string; userId?: string; provider?: string; model?: string; promptName?: string; status?: string };

// PER-436 will add `events: EventsFilters` here once the events section exists.
export type SectionFilters = { investigate: ErrorsFilters; traces: TracesFilters; llm: LlmFilters };
export type FilterableSection = keyof SectionFilters;
export type NavPayload = { [S in FilterableSection]: { section: S; filters: SectionFilters[S] } }[FilterableSection];

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
  navigate: <S extends NavSection>(section: S, filters?: S extends FilterableSection ? SectionFilters[S] : never) => void;
  /** One-shot filter payload set by the last `navigate(section, filters)` call, or null. */
  pendingFilters: NavPayload | null;
  /** Consume `pendingFilters` — call once the receiving screen has seeded its local state. */
  clearPendingFilters: () => void;
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

  users: {
    kind: "v2",
    render: (ctx) => <UsersScreen ctx={ctx} />,
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
