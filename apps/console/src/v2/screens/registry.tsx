import type { ReactNode } from "react";
import type { ApiClient } from "../../api/client";
import type { Environment, Project, User } from "../../api/types";
import type { NavSection } from "../nav";
import { createSharedGroupLoader, LazyScreen, selectLazyExport } from "./lazy/LazyScreen";

// ─── Drill types ─────────────────────────────────────────────────────────────

export type DrillTarget = "incident" | "tenant";
export type DrillParams =
  | { groupId: string; errorId?: string }
  | { tenantId: string };

// ─── One-time secret ─────────────────────────────────────────────────────────
//
// The shell holds exactly one one-time-secret slot above the remount
// boundary (see `onSecretCreated`/`createdSecret` on `ScreenCtx` below).
// `kind` tags which credential surface minted it so two surfaces mounted on
// the same screen (e.g. Setup's API key and the read-tokens panel) never
// misread each other's secret.
export type SecretKind = "apiKey" | "readToken";
export type CreatedSecret = { value: string; kind: SecretKind };

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
  apiEndpoint?: string;
  user?: User;
  project: Project | undefined;
  environment: Environment | undefined;
  environments: Environment[];
  onCreateEnvironment: (name: string) => Promise<void>;
  onArchiveEnvironment?: (environment: Environment) => Promise<void>;
  onArchiveProject: (projectId: string) => Promise<void>;
  /**
   * Hand a freshly created one-time secret to the shell. Screens live inside a
   * remount boundary (`key={seq}`), so a secret held in screen state is lost
   * the moment anything calls `ctx.reload`. Pass `null` to clear it. `kind`
   * tags which credential surface minted the secret — the shell has exactly
   * one slot, so each consumer must read only its own kind and ignore a
   * secret tagged for a different one (e.g. the Setup API-key panel must
   * never render a freshly minted read token, or vice versa).
   */
  onSecretCreated: (secret: string | null, kind: SecretKind) => void;
  /** The secret last passed to `onSecretCreated`, held above the remount boundary. */
  createdSecret?: CreatedSecret | null;
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

export type ScreenEntry = { render: (ctx: ScreenCtx) => ReactNode };

type CtxProps = { ctx: ScreenCtx };
type NavigableProps = CtxProps & { navigate: ScreenCtx["navigate"] };
type IncidentProps = CtxProps & { groupId: string; errorId?: string };
type TenantProps = CtxProps & { tenantId: string };

const operationsGroup = createSharedGroupLoader(() => import("./screen-groups/operations"));
const observabilityGroup = createSharedGroupLoader(() => import("./screen-groups/observability"));
const analyticsExperimentsGroup = createSharedGroupLoader(() => import("./screen-groups/analytics-experiments"));
const adminGroup = createSharedGroupLoader(() => import("./screen-groups/admin"));

const overviewScreen = selectLazyExport<typeof import("./screen-groups/operations"), "OverviewScreen", NavigableProps>(operationsGroup, "OverviewScreen");
const incidentsScreen = selectLazyExport<typeof import("./screen-groups/operations"), "IncidentsScreen", CtxProps>(operationsGroup, "IncidentsScreen");
const incidentScreen = selectLazyExport<typeof import("./screen-groups/operations"), "IncidentScreen", IncidentProps>(operationsGroup, "IncidentScreen");
const alertsScreen = selectLazyExport<typeof import("./screen-groups/operations"), "AlertsScreen", CtxProps>(operationsGroup, "AlertsScreen");
const monitorsScreen = selectLazyExport<typeof import("./screen-groups/operations"), "MonitorsScreen", CtxProps>(operationsGroup, "MonitorsScreen");

const errorsScreen = selectLazyExport<typeof import("./screen-groups/observability"), "ErrorsScreen", NavigableProps>(observabilityGroup, "ErrorsScreen");
const eventsScreen = selectLazyExport<typeof import("./screen-groups/observability"), "EventsScreen", CtxProps>(observabilityGroup, "EventsScreen");
const llmScreen = selectLazyExport<typeof import("./screen-groups/observability"), "LlmScreen", CtxProps>(observabilityGroup, "LlmScreen");
const tracesScreen = selectLazyExport<typeof import("./screen-groups/observability"), "TracesScreen", CtxProps>(observabilityGroup, "TracesScreen");
const tenantsScreen = selectLazyExport<typeof import("./screen-groups/observability"), "TenantsScreen", CtxProps>(observabilityGroup, "TenantsScreen");
const tenantScreen = selectLazyExport<typeof import("./screen-groups/observability"), "TenantScreen", TenantProps>(observabilityGroup, "TenantScreen");
const usersScreen = selectLazyExport<typeof import("./screen-groups/observability"), "UsersScreen", CtxProps>(observabilityGroup, "UsersScreen");

const analyticsScreen = selectLazyExport<typeof import("./screen-groups/analytics-experiments"), "AnalyticsScreen", CtxProps>(analyticsExperimentsGroup, "AnalyticsScreen");
const experimentsScreen = selectLazyExport<typeof import("./screen-groups/analytics-experiments"), "ExperimentsScreen", CtxProps>(analyticsExperimentsGroup, "ExperimentsScreen");

const setupScreen = selectLazyExport<typeof import("./screen-groups/admin"), "SetupScreen", CtxProps>(adminGroup, "SetupScreen");
const systemScreen = selectLazyExport<typeof import("./screen-groups/admin"), "SystemScreen", CtxProps>(adminGroup, "SystemScreen");

export const SCREENS: Record<NavSection, ScreenEntry> = {
  overview: {
    render: (ctx) => <LazyScreen loader={overviewScreen} props={{ ctx, navigate: ctx.navigate }} />,
  },

  investigate: {
    render: (ctx) => <LazyScreen loader={errorsScreen} props={{ ctx, navigate: ctx.navigate }} />,
  },

  incidents: {
    render: (ctx) => <LazyScreen loader={incidentsScreen} props={{ ctx }} />,
  },

  llm: {
    render: (ctx) => <LazyScreen loader={llmScreen} props={{ ctx }} />,
  },

  traces: {
    render: (ctx) => <LazyScreen loader={tracesScreen} props={{ ctx }} />,
  },

  entities: {
    render: (ctx) => <LazyScreen loader={tenantsScreen} props={{ ctx }} />,
  },

  users: {
    render: (ctx) => <LazyScreen loader={usersScreen} props={{ ctx }} />,
  },

  events: {
    render: (ctx) => <LazyScreen loader={eventsScreen} props={{ ctx }} />,
  },

  analytics: {
    render: (ctx) => <LazyScreen loader={analyticsScreen} props={{ ctx }} />,
  },

  alerts: {
    render: (ctx) => <LazyScreen loader={alertsScreen} props={{ ctx }} />,
  },

  monitors: {
    render: (ctx) => <LazyScreen loader={monitorsScreen} props={{ ctx }} />,
  },

  experiments: {
    render: (ctx) => <LazyScreen loader={experimentsScreen} props={{ ctx }} />,
  },

  system: {
    render: (ctx) => <LazyScreen loader={systemScreen} props={{ ctx }} />,
  },

  settings: {
    render: (ctx) => <LazyScreen loader={setupScreen} props={{ ctx }} />,
  },
};

// ─── renderSection ────────────────────────────────────────────────────────────

export function renderSection(section: NavSection, ctx: ScreenCtx): ReactNode {
  return SCREENS[section].render(ctx);
}

export function renderIncidentDetail(ctx: ScreenCtx, groupId: string, errorId?: string): ReactNode {
  return <LazyScreen loader={incidentScreen} props={{ ctx, groupId, errorId }} />;
}

export function renderTenantDetail(ctx: ScreenCtx, tenantId: string): ReactNode {
  return <LazyScreen loader={tenantScreen} props={{ ctx, tenantId }} />;
}
