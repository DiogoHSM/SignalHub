import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { Environment, User } from "../api/types";
import { CommandPalette, type CommandPaletteItem } from "../components/CommandPalette";
import { NavRail } from "./shell/NavRail";
import { TopBar } from "./shell/TopBar";
import { HealthRail } from "./shell/HealthRail";
import { ToastStack } from "./shell/ToastStack";
import { useConsoleProjects } from "./useConsoleProjects";
import { useToasts } from "./useToasts";
import { useFleet } from "./useFleet";
import { renderSection } from "./screens/registry";
import type { ScreenCtx, DrillTarget, DrillParams } from "./screens/registry";
import { IncidentScreen } from "./screens/IncidentScreen";
import { TenantScreen } from "./screens/TenantScreen";
import type { NavSection } from "./nav";
import type { BreadcrumbItem } from "./shell/TopBar";
import { EmptyHint } from "../components/ui/v2";

// ─── persistence ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "sh_v2_state";

type PersistedState = {
  nav?: NavSection;
  projectId?: string;
  environmentId?: string;
  /** Legacy localStorage key from the first v2 shell. Prefer environmentId. */
  env?: string;
  railCollapsed?: boolean;
};

function loadState(): PersistedState {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveState(patch: Partial<PersistedState>) {
  try {
    const current = loadState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // storage may be unavailable in some environments
  }
}

// ─── breadcrumb derivation ───────────────────────────────────────────────────

const NAV_LABELS: Record<NavSection, string> = {
  overview: "Overview",
  investigate: "Investigate",
  incidents: "Incidents",
  llm: "LLM",
  traces: "Traces",
  alerts: "Alerts",
  monitors: "Monitors",
  system: "System",
  settings: "Settings",
};

function buildCrumb(nav: NavSection, drillStack: string[]): BreadcrumbItem[] {
  const root: BreadcrumbItem = { label: NAV_LABELS[nav] };
  if (drillStack.length === 0) return [root];
  return [root, ...drillStack.map((label) => ({ label }))];
}

// ─── ConsoleShellV2 ──────────────────────────────────────────────────────────

export type ConsoleShellV2Props = {
  client: ApiClient;
  user: User;
};

export function ConsoleShellV2({ client, user }: ConsoleShellV2Props) {
  // Restore persisted state on mount
  const persisted = useRef(loadState()).current;

  const [nav, setNavRaw] = useState<NavSection>(persisted.nav ?? "overview");
  const [railCollapsed, setRailCollapsedRaw] = useState(persisted.railCollapsed ?? false);
  const [drillStack, setDrillStack] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<
    | { target: "incident"; groupId: string; errorId?: string }
    | { target: "tenant"; tenantId: string }
    | null
  >(null);

  // Page-transition state (remount the page div on nav change)
  const [seq, setSeq] = useState(0);
  const [anim, setAnim] = useState<"nav" | "forward" | "back">("nav");

  // Command palette
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // ─── hooks ────────────────────────────────────────────────────────────────

  const { toasts, toast, dismiss } = useToasts();

  const {
    projects,
    environments,
    activeProject,
    activeEnvironment,
    selectProject,
    selectEnvironment,
    selectEnvironmentByName,
    reload: reloadProjects,
  } = useConsoleProjects(client);

  const fleet = useFleet({
    fetchFleet: client.fetchFleet,
    seedProjects: projects,
  });

  // ─── restore persisted project/env after load ─────────────────────────────

  useEffect(() => {
    if (!persisted.projectId || projects.length === 0) return;
    const project = projects.find((p) => p.id === persisted.projectId);
    if (project) selectProject(project.id);
    // only run once after initial project load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.length > 0]);

  useEffect(() => {
    if (environments.length === 0) return;
    const env = persisted.environmentId
      ? environments.find((e) => e.id === persisted.environmentId)
      : persisted.env
        ? environments.find((e) => e.name === persisted.env)
        : undefined;
    if (env) selectEnvironment(env.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environments.length > 0]);

  // ─── document title ──────────────────────────────────────────────────────
  useEffect(() => {
    document.title = `SignalMonitor · ${NAV_LABELS[nav]}`;
  }, [nav]);

  // ─── ⌘K keyboard shortcut ───────────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
      if (e.key === "Escape") {
        setIsCommandPaletteOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ─── actions ─────────────────────────────────────────────────────────────

  const navigate = useCallback((section: NavSection) => {
    setDetail(null);
    setNavRaw(section);
    setDrillStack([]);
    setAnim("nav");
    setSeq((s) => s + 1);
    saveState({ nav: section });
  }, []);

  const toggleRail = useCallback(() => {
    setRailCollapsedRaw((prev) => {
      const next = !prev;
      saveState({ railCollapsed: next });
      return next;
    });
  }, []);

  const handleSelectProject = useCallback(
    (id: string) => {
      setDetail(null);
      selectProject(id);
      saveState({ projectId: id, environmentId: undefined, env: undefined });
    },
    [selectProject]
  );

  const handleSelectEnv = useCallback(
    (environmentId: string) => {
      setDetail(null);
      selectEnvironment(environmentId);
      saveState({ environmentId, env: undefined });
    },
    [selectEnvironment]
  );

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleOpenEnv = useCallback(
    (projectId: string, envName: string) => {
      handleSelectProject(projectId);
      selectEnvironmentByName(envName);
      if (railCollapsed) toggleRail();
    },
    [handleSelectProject, railCollapsed, selectEnvironmentByName, toggleRail]
  );

  const handleRefresh = useCallback(() => {
    // Bump seq to remount the current page section
    setSeq((s) => s + 1);
  }, []);

  // ─── breadcrumb ──────────────────────────────────────────────────────────
  const crumb = buildCrumb(nav, drillStack);

  // ─── fleet critical count (for nav badge) ────────────────────────────────
  const fleetCritical = fleet.rollup.counts.critical;

  // ─── screen context callbacks ─────────────────────────────────────────────

  const handleCreateEnvironment = useCallback(
    async (name: string) => {
      if (!activeProject) return;
      const { environment: created } = await client.createEnvironment(activeProject.id, { name });
      selectEnvironment(created.id);
    },
    [client, activeProject, selectEnvironment]
  );

  const handleArchiveEnvironment = useCallback(
    async (env: Environment) => {
      await client.archiveEnvironment(env.id);
    },
    [client]
  );

  const handleArchiveProject = useCallback(
    async (projectId: string) => {
      await client.archiveProject(projectId);
    },
    [client]
  );

  const handleSecretCreated = useCallback(() => undefined, []);

  const handleSelectEnvironmentObj = useCallback(
    (env: Environment) => {
      selectEnvironment(env.id);
      saveState({ environmentId: env.id, env: undefined });
    },
    [selectEnvironment]
  );

  const handleUpdateProject = useCallback(
    async (projectId: string, input: { name?: string }) => {
      await client.updateProject(projectId, input);
    },
    [client]
  );

  const handleUpdateEnvironment = useCallback(
    async (env: Environment, name: string) => {
      await client.updateEnvironment(env.id, { name });
    },
    [client]
  );

  const handleDrill = useCallback((target: DrillTarget, params: DrillParams) => {
    if (target === "tenant" && "tenantId" in params) {
      setDetail({ target: "tenant", tenantId: params.tenantId });
    } else if (target === "incident" && "groupId" in params) {
      setDetail({ target: "incident", groupId: params.groupId, errorId: params.errorId });
    }
  }, []);

  const handleBack = useCallback(() => {
    setDetail(null);
  }, []);

  // ─── render section context ───────────────────────────────────────────────
  const screenCtx: ScreenCtx = {
    client,
    project: activeProject,
    environment: activeEnvironment,
    environments,
    onCreateEnvironment: handleCreateEnvironment,
    onArchiveEnvironment: handleArchiveEnvironment,
    onArchiveProject: handleArchiveProject,
    onSecretCreated: handleSecretCreated,
    onSelectEnvironment: handleSelectEnvironmentObj,
    onUpdateProject: handleUpdateProject,
    onUpdateEnvironment: handleUpdateEnvironment,
    navigate,
    drill: handleDrill,
    back: handleBack,
    pushToast: (message: string) => toast({ title: message }),
    reload: () => {
      reloadProjects();
      setSeq((s) => s + 1);
    },
  };

  // ─── command palette commands ─────────────────────────────────────────────
  const commandDestinations: Array<{ section: NavSection; title: string; description: string }> = [
    { section: "overview", title: "Overview", description: "Project health overview" },
    { section: "investigate", title: "Investigate", description: "Events, errors, traces, and LLM calls" },
    { section: "incidents", title: "Incidents", description: "Active and resolved incidents" },
    { section: "llm", title: "LLM", description: "LLM call logs, costs, and analysis" },
    { section: "traces", title: "Traces", description: "Request timelines and span-level investigation" },
    { section: "alerts", title: "Alerts", description: "Alert rules and recent alerts" },
    { section: "monitors", title: "Monitors", description: "HTTP uptime and heartbeat checks" },
    { section: "system", title: "System", description: "Server health, workers, and scheduler" },
    { section: "settings", title: "Settings", description: "Project and environment settings" },
  ];

  const commandItems: CommandPaletteItem[] = commandDestinations.map((destination) => ({
    id: destination.section,
    title: destination.title,
    description: destination.description
  }));

  return (
    <div className="sh-v2">
      <div className="app" data-rail={railCollapsed ? "collapsed" : "open"}>
        {/* Left navigation rail */}
        <NavRail active={nav} onNavigate={navigate} fleetCritical={fleetCritical} />

        {/* Main content area */}
        <div className="app-main">
          <TopBar
            projects={projects}
            project={activeProject ?? { id: "", name: "Loading…", createdAt: "", updatedAt: "", archivedAt: null }}
            environments={environments}
            env={activeEnvironment ?? { id: "", projectId: "", name: "…", createdAt: "", updatedAt: "", archivedAt: null }}
            onSelectProject={handleSelectProject}
            onSelectEnv={handleSelectEnv}
            crumb={crumb}
            railCollapsed={railCollapsed}
            onToggleRail={toggleRail}
            onRefresh={handleRefresh}
            onOpenSearch={() => setIsCommandPaletteOpen(true)}
            userEmail={user.email}
          />

          <div className="app-workspace">
            <div className="page" key={seq} data-anim={anim}>
              {activeProject && activeEnvironment
                ? detail
                  ? detail.target === "tenant"
                    ? <TenantScreen ctx={screenCtx} tenantId={detail.tenantId} />
                    : <IncidentScreen ctx={screenCtx} groupId={detail.groupId} errorId={detail.errorId} />
                  : renderSection(nav, screenCtx)
                : (
                  <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
                    <EmptyHint
                      icon="activity"
                      title="Loading project…"
                      sub="Waiting for project and environment data."
                    />
                  </div>
                )}
            </div>
          </div>
        </div>

        {/* Health rail */}
        <HealthRail
          collapsed={railCollapsed}
          onToggleCollapse={toggleRail}
          selectedProjectId={activeProject?.id}
          onSelectProject={handleSelectProject}
          onOpenEnv={handleOpenEnv}
          expandedIds={expandedIds}
          onToggleExpand={handleToggleExpand}
          fleet={{
            projects: fleet.projects,
            rollup: fleet.rollup,
            lastUpdated: fleet.lastUpdated,
          }}
        />

        {/* Toast stack */}
        <ToastStack toasts={toasts} onDismiss={dismiss} />
      </div>

      {isCommandPaletteOpen ? (
        <CommandPalette
          items={commandItems}
          onClose={() => setIsCommandPaletteOpen(false)}
          onSelect={(item) => {
            navigate(item.id as NavSection);
            setIsCommandPaletteOpen(false);
          }}
          placeholder="Jump to section..."
        />
      ) : null}
    </div>
  );
}
