import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { renderIncidentDetail, renderSection, renderTenantDetail } from "./screens/registry";
import type { ScreenCtx, CreatedSecret, DrillTarget, DrillParams, FilterableSection, NavPayload, SecretKind, SectionFilters } from "./screens/registry";
import { NAV_GROUPS, navGroup, isInstanceSection, type NavSection, type NavMode } from "./nav";
import { useIncidentCount } from "./useIncidentCount";
import type { BreadcrumbItem } from "./shell/TopBar";
import { EmptyHint, Icon } from "../components/ui/v2";
import {
  buildConsoleUrl,
  detailOwner as defaultDetailOwner,
  parseConsoleRoute,
  type ConsoleDetail,
} from "./console-route";

// ─── persistence ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "sh_v2_state";

type PersistedState = {
  nav?: NavSection;
  projectId?: string;
  environmentId?: string;
  /** Legacy localStorage key from the first v2 shell. Prefer environmentId. */
  env?: string;
  railCollapsed?: boolean;
  navMode?: NavMode;
};

type DesiredScope = {
  projectId?: string;
  environmentId?: string;
  environmentName?: string;
};

/**
 * A one-time credential secret plus the project/environment pair it was
 * minted for. The stamp is what makes the secret impossible to read outside
 * its own scope: it is compared against the scope the shell is currently
 * rendering, every render, rather than being cleared by whichever code path
 * happened to move the scope.
 */
type MintedSecret = CreatedSecret & {
  projectId: string | undefined;
  environmentId: string | undefined;
};

type ConsoleHistoryState = {
  sigmonConsole?: true;
  detailOwner?: NavSection;
  detailEntry?: true;
};

function historyDetailOwner(detail: ConsoleDetail): NavSection {
  const state = window.history.state as ConsoleHistoryState | null;
  return state?.sigmonConsole && state.detailOwner ? state.detailOwner : defaultDetailOwner(detail);
}

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

const NAV_LABELS = Object.fromEntries(NAV_GROUPS.flatMap((group) => group.items).map((item) => [item.id, item.label])) as Record<NavSection, string>;

function buildCrumb(nav: NavSection, drillStack: string[]): BreadcrumbItem[] {
  const root: BreadcrumbItem = { label: NAV_LABELS[nav] };
  const group = navGroup(nav);
  const prefix: BreadcrumbItem[] = group.label ? [{ label: group.label }] : [];
  if (drillStack.length === 0) return [...prefix, root];
  return [...prefix, root, ...drillStack.map((label) => ({ label }))];
}

// ─── ConsoleShellV2 ──────────────────────────────────────────────────────────

export type ConsoleShellV2Props = {
  client: ApiClient;
  apiEndpoint?: string;
  user: User;
  onSignOut?: () => Promise<void>;
};

function FirstProjectOnboarding({
  client,
  onComplete,
  onError,
}: {
  client: ApiClient;
  onComplete: () => void;
  onError: (message: string) => void;
}) {
  const [projectName, setProjectName] = useState("");
  const [environmentName, setEnvironmentName] = useState("production");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const project = projectName.trim();
    const environment = environmentName.trim();
    if (!project || !environment || busy) return;

    setBusy(true);
    setErrorMessage(null);
    let createdProjectId: string;
    try {
      const created = await client.createProject({ name: project });
      createdProjectId = created.project.id;
    } catch (error) {
      console.error(error);
      setErrorMessage("Could not create the project. Check the name and try again.");
      setBusy(false);
      return;
    }

    try {
      await client.createEnvironment(createdProjectId, { name: environment });
    } catch (error) {
      console.error(error);
      onError("Project created, but the environment could not be created. Finish setup from the project workspace.");
    } finally {
      onComplete();
      setBusy(false);
    }
  }, [busy, client, environmentName, onComplete, onError, projectName]);

  return (
    <div style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="sh-card" style={{ width: "min(100%, 560px)" }}>
        <div className="sh-card__body" style={{ display: "grid", gap: 20, padding: 28 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <span style={{ color: "var(--accent)" }}><Icon name="activity" size={24} /></span>
            <h1 className="sh-h1">Create your first project</h1>
            <p className="sh-muted" style={{ margin: 0 }}>
              Projects isolate telemetry and environments keep production, preview, and development signals separate.
            </p>
          </div>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="sh-label">Project name</span>
            <input
              autoFocus
              className="sh-input"
              aria-label="Project name"
              value={projectName}
              placeholder="Customer portal"
              onChange={(event) => setProjectName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="sh-label">Environment name</span>
            <input
              className="sh-input"
              aria-label="Environment name"
              value={environmentName}
              placeholder="production"
              onChange={(event) => setEnvironmentName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
            />
          </label>
          <button
            className="sh-btn primary"
            type="button"
            disabled={busy || !projectName.trim() || !environmentName.trim()}
            onClick={() => void submit()}
          >
            {busy ? "Creating…" : "Create project and environment"}
          </button>
          {errorMessage ? <p role="alert" className="sh-error" style={{ margin: 0 }}>{errorMessage}</p> : null}
        </div>
      </div>
    </div>
  );
}

function DenseConsoleShellV2({ client, apiEndpoint, user, onSignOut }: ConsoleShellV2Props) {
  // Restore persisted state on mount
  const persisted = useRef(loadState()).current;
  const initialRoute = useRef(parseConsoleRoute(window.location)).current;
  const initialNav = initialRoute.valid
    ? initialRoute.nav
    : initialRoute.root
      ? persisted.nav ?? "overview"
      : "overview";

  const [nav, setNavRaw] = useState<NavSection>(initialNav);
  const [railCollapsed, setRailCollapsedRaw] = useState(persisted.railCollapsed ?? true);
  const [navMode, setNavMode] = useState<NavMode>(["open", "compact", "auto"].includes(persisted.navMode ?? "") ? persisted.navMode! : "open");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [drillStack, setDrillStack] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<NavPayload | null>(null);
  const [detail, setDetail] = useState<ConsoleDetail | null>(initialRoute.valid ? initialRoute.detail : null);
  const [detailReturnNav, setDetailReturnNav] = useState<NavSection>(
    initialRoute.detail ? historyDetailOwner(initialRoute.detail) : initialNav,
  );
  const [desiredScope, setDesiredScope] = useState<DesiredScope>({
    projectId: initialRoute.projectId ?? persisted.projectId,
    environmentId: initialRoute.environmentId ?? persisted.environmentId,
    environmentName: initialRoute.environmentId ? undefined : persisted.env,
  });

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
    selectProjectEnvironmentByName,
    isLoading: isLoadingProjects,
    projectError,
    environmentError,
    reload: reloadProjects,
    refreshInBackground,
  } = useConsoleProjects(client);

  // One-time secrets (API keys, read tokens, ...) live here, not in the
  // screen: the page container below is keyed on `seq`, and creating one
  // calls ctx.reload, so a secret held in screen state was destroyed before
  // the operator could copy it. `kind` tags which credential surface minted
  // the secret, since the shell has only one slot but multiple credential
  // surfaces can mount on the same screen. The secret is stamped with the
  // scope it was minted for; `createdSecret` below derives what screens may
  // read from it. See the derivation for why that, and not a set of clearing
  // call sites, is what confines the secret to its own scope.
  const [mintedSecret, setMintedSecret] = useState<MintedSecret | null>(null);
  const activeProjectId = activeProject?.id;
  const activeEnvironmentId = activeEnvironment?.id;
  const handleSecretCreated = useCallback(
    (secret: string | null, kind: SecretKind) =>
      setMintedSecret(secret ? { value: secret, kind, projectId: activeProjectId, environmentId: activeEnvironmentId } : null),
    [activeEnvironmentId, activeProjectId],
  );

  const fleet = useFleet({
    fetchFleet: client.fetchFleet,
    fetchProjectEnvironments: client.fetchFleetProjectEnvironments,
    seedProjects: projects,
  });

  // ─── restore URL/persisted project and environment after load ─────────────

  useEffect(() => {
    if (!desiredScope.projectId || projects.length === 0) return;
    const project = projects.find((candidate) => candidate.id === desiredScope.projectId);
    if (project) {
      if (activeProject?.id !== project.id) selectProject(project.id);
      return;
    }
    if (!isLoadingProjects) {
      setDesiredScope((current) => ({
        ...current,
        projectId: undefined,
        environmentId: undefined,
        environmentName: undefined,
      }));
    }
  }, [activeProject?.id, desiredScope.projectId, isLoadingProjects, projects, selectProject]);

  useEffect(() => {
    if (!activeProject || isLoadingProjects) return;
    if (desiredScope.projectId && activeProject.id !== desiredScope.projectId) return;
    const environment = desiredScope.environmentId
      ? environments.find((candidate) => candidate.id === desiredScope.environmentId)
      : desiredScope.environmentName
        ? environments.find((candidate) => candidate.name === desiredScope.environmentName)
        : undefined;
    if (environment) {
      if (activeEnvironment?.id !== environment.id) selectEnvironment(environment.id);
      return;
    }
    if ((desiredScope.environmentId || desiredScope.environmentName) && (activeEnvironment || environments.length > 0)) {
      setDesiredScope((current) => ({
        ...current,
        environmentId: undefined,
        environmentName: undefined,
      }));
    }
  }, [
    activeEnvironment?.id,
    activeProject,
    desiredScope.environmentId,
    desiredScope.environmentName,
    desiredScope.projectId,
    environments,
    isLoadingProjects,
    selectEnvironment,
  ]);

  const isRestoringScope = Boolean(
    (desiredScope.projectId && activeProject?.id !== desiredScope.projectId)
    || (desiredScope.environmentId && activeEnvironment?.id !== desiredScope.environmentId)
    || (desiredScope.environmentName && activeEnvironment?.name !== desiredScope.environmentName)
  );

  // ─── one-time secret confinement ──────────────────────────────────────────
  //
  // Screens only ever see a secret whose stamped scope is the scope being
  // rendered right now. Confinement is therefore a property of the render,
  // not an obligation on scope-changing code: every way the active scope can
  // move — the top-bar project and environment pickers, the fleet tree, a
  // screen's own onSelectEnvironment, an environment created through
  // onCreateEnvironment, popstate/deep-link restore, archiving the active
  // project or environment, or useConsoleProjects settling somewhere else on
  // its own after a reload — breaks the match with no code of its own, and a
  // future scope-changing path cannot forget to clear anything.
  //
  // Survival is the same rule read the other way: a same-scope reload settles
  // back on the minting scope (the shell keeps steering there via
  // desiredScope), so the secret becomes readable again once it does. That is
  // why nothing here watches for id *changes*: useConsoleProjects transiently
  // reports no environment, then the wrong one, on every ctx.reload(). A
  // transient mismatch only withholds the secret for the renders it lasts —
  // during which the shell is showing its restoring state anyway — instead of
  // destroying it.
  const createdSecret = useMemo<CreatedSecret | null>(
    () => (
      mintedSecret && mintedSecret.projectId === activeProjectId && mintedSecret.environmentId === activeEnvironmentId
        ? { value: mintedSecret.value, kind: mintedSecret.kind }
        : null
    ),
    [activeEnvironmentId, activeProjectId, mintedSecret],
  );

  // Backstop, not the invariant: once the shell has *settled* on a different
  // scope, drop the value so returning to the minting scope cannot reveal it
  // again and so it stops being held in memory. Deliberately ignores every
  // unsettled render — mid-reload, or while the restore effects are still
  // steering back to the requested scope — which is exactly where
  // useConsoleProjects reports a scope the operator never chose.
  useEffect(() => {
    if (!mintedSecret || isLoadingProjects || isRestoringScope) return;
    if (!activeProjectId || !activeEnvironmentId) return;
    if (mintedSecret.projectId === activeProjectId && mintedSecret.environmentId === activeEnvironmentId) return;
    setMintedSecret(null);
  }, [activeEnvironmentId, activeProjectId, isLoadingProjects, isRestoringScope, mintedSecret]);

  useEffect(() => {
    const handlePopState = () => {
      const route = parseConsoleRoute(window.location);
      const nextNav = route.valid
        ? route.nav
        : route.root
          ? loadState().nav ?? "overview"
          : "overview";
      setNavRaw(nextNav);
      setDetail(route.valid ? route.detail : null);
      setDetailReturnNav(route.detail ? historyDetailOwner(route.detail) : nextNav);
      setPending(null);
      setDrillStack([]);
      setAnim("back");
      setSeq((current) => current + 1);
      setDesiredScope({
        projectId: route.projectId,
        environmentId: route.environmentId,
      });
      saveState({
        nav: nextNav,
        ...(route.projectId ? { projectId: route.projectId } : {}),
        ...(route.environmentId ? { environmentId: route.environmentId } : {}),
      });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (isLoadingProjects || isRestoringScope) return;
    const url = buildConsoleUrl(nav, detail, {
      projectId: activeProject?.id,
      environmentId: activeEnvironment?.id,
    });
    const current = `${window.location.pathname}${window.location.search}`;
    const state: ConsoleHistoryState = {
      sigmonConsole: true,
      ...(detail ? { detailOwner: detailReturnNav } : {}),
    };
    if (current !== url || !(window.history.state as ConsoleHistoryState | null)?.sigmonConsole) {
      window.history.replaceState(state, "", url);
    }
  }, [
    activeEnvironment?.id,
    activeProject?.id,
    detail,
    detailReturnNav,
    isLoadingProjects,
    isRestoringScope,
    nav,
  ]);

  useEffect(() => {
    if (isLoadingProjects || isRestoringScope || !activeProject) return;
    const environmentId = activeEnvironment?.projectId === activeProject.id
      ? activeEnvironment.id
      : undefined;
    saveState({
      projectId: activeProject.id,
      environmentId,
      env: undefined,
    });
  }, [activeEnvironment, activeProject, isLoadingProjects, isRestoringScope]);

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

  const navigate = useCallback(
    <S extends NavSection>(section: S, filters?: S extends FilterableSection ? SectionFilters[S] : never) => {
      setDetail(null);
      setPending(filters ? ({ section, filters } as NavPayload) : null);
      setNavRaw(section);
      setDrillStack([]);
      setAnim("nav");
      setSeq((s) => s + 1);
      saveState({ nav: section });
      window.history.pushState(
        { sigmonConsole: true } satisfies ConsoleHistoryState,
        "",
        buildConsoleUrl(section, null, {
          projectId: activeProject?.id,
          environmentId: activeEnvironment?.id,
        }),
      );
    },
    [activeEnvironment?.id, activeProject?.id]
  );

  const clearPendingFilters = useCallback(() => setPending(null), []);

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
      setDesiredScope({ projectId: id });
      selectProject(id);
      saveState({ projectId: id, environmentId: undefined, env: undefined });
      window.history.replaceState(
        { sigmonConsole: true } satisfies ConsoleHistoryState,
        "",
        buildConsoleUrl(nav, null, { projectId: id }),
      );
    },
    [nav, selectProject]
  );

  const handleSelectEnv = useCallback(
    (environmentId: string) => {
      setDetail(null);
      setDesiredScope({ projectId: activeProject?.id, environmentId });
      selectEnvironment(environmentId);
      saveState({ environmentId, env: undefined });
      window.history.replaceState(
        { sigmonConsole: true } satisfies ConsoleHistoryState,
        "",
        buildConsoleUrl(nav, null, { projectId: activeProject?.id, environmentId }),
      );
    },
    [activeProject?.id, nav, selectEnvironment]
  );

  const handleToggleExpand = useCallback((id: string) => {
    const opening = !expandedIds.has(id);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (opening) void fleet.loadProjectEnvironments(id);
  }, [expandedIds, fleet.loadProjectEnvironments]);

  const handleOpenEnv = useCallback(
    (projectId: string, envName: string) => {
      setDetail(null);
      const knownEnvironment = projectId === activeProject?.id
        ? environments.find((candidate) => candidate.name === envName)
        : undefined;
      setDesiredScope({ projectId, environmentId: knownEnvironment?.id, environmentName: envName });
      selectProjectEnvironmentByName(projectId, envName);
      saveState({ projectId, environmentId: undefined, env: envName });
      window.history.replaceState(
        { sigmonConsole: true } satisfies ConsoleHistoryState,
        "",
        buildConsoleUrl(nav, null, { projectId, environmentId: knownEnvironment?.id }),
      );
      if (railCollapsed) toggleRail();
    },
    [activeProject?.id, environments, nav, railCollapsed, selectProjectEnvironmentByName, toggleRail]
  );

  const handleRefresh = useCallback(() => {
    void fleet.refreshFleet();
    for (const projectId of expandedIds) {
      void fleet.refreshProjectEnvironments(projectId);
    }
    // Bump seq to remount the current page section.
    setSeq((s) => s + 1);
  }, [expandedIds, fleet.refreshFleet, fleet.refreshProjectEnvironments]);

  // ─── breadcrumb ──────────────────────────────────────────────────────────
  const crumb = buildCrumb(nav, drillStack);

  const instanceScope = isInstanceSection(nav);
  const category = navGroup(nav);
  const incidentCount = useIncidentCount(client, activeProject?.id, activeEnvironment?.id, seq);

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

  const handleSelectEnvironmentObj = useCallback(
    (env: Environment) => {
      setDesiredScope({ projectId: env.projectId, environmentId: env.id });
      selectEnvironment(env.id);
      saveState({ environmentId: env.id, env: undefined });
      window.history.replaceState(
        { sigmonConsole: true } satisfies ConsoleHistoryState,
        "",
        buildConsoleUrl(nav, detail, { projectId: env.projectId, environmentId: env.id }),
      );
    },
    [detail, nav, selectEnvironment]
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
    let nextDetail: ConsoleDetail | null = null;
    if (target === "tenant" && "tenantId" in params) {
      nextDetail = { target: "tenant", tenantId: params.tenantId };
    } else if (target === "incident" && "groupId" in params) {
      nextDetail = { target: "incident", groupId: params.groupId, errorId: params.errorId };
    }
    if (!nextDetail) return;
    setDetailReturnNav(nav);
    setDetail(nextDetail);
    window.history.pushState(
      { sigmonConsole: true, detailOwner: nav, detailEntry: true } satisfies ConsoleHistoryState,
      "",
      buildConsoleUrl(nav, nextDetail, {
        projectId: activeProject?.id,
        environmentId: activeEnvironment?.id,
      }),
    );
  }, [activeEnvironment?.id, activeProject?.id, nav]);

  const handleBack = useCallback(() => {
    const historyState = window.history.state as ConsoleHistoryState | null;
    if (detail && historyState?.sigmonConsole && historyState.detailEntry) {
      window.history.back();
      return;
    }
    const owner = detail ? detailReturnNav : nav;
    setNavRaw(owner);
    setDetail(null);
    setDrillStack([]);
    setAnim("back");
    setSeq((current) => current + 1);
    saveState({ nav: owner });
    window.history.replaceState(
      { sigmonConsole: true } satisfies ConsoleHistoryState,
      "",
      buildConsoleUrl(owner, null, {
        projectId: activeProject?.id,
        environmentId: activeEnvironment?.id,
      }),
    );
  }, [activeEnvironment?.id, activeProject?.id, detail, detailReturnNav, nav]);

  // ─── render section context ───────────────────────────────────────────────
  const screenCtx: ScreenCtx = {
    client,
    apiEndpoint: apiEndpoint || (typeof window === "undefined" ? "https://your-instance.example.com" : window.location.origin),
    user,
    project: activeProject,
    environment: activeEnvironment,
    environments,
    onCreateEnvironment: handleCreateEnvironment,
    onArchiveEnvironment: handleArchiveEnvironment,
    onArchiveProject: handleArchiveProject,
    onSecretCreated: handleSecretCreated,
    createdSecret,
    onSelectEnvironment: handleSelectEnvironmentObj,
    onUpdateProject: handleUpdateProject,
    onUpdateEnvironment: handleUpdateEnvironment,
    navigate,
    pendingFilters: pending,
    clearPendingFilters,
    drill: handleDrill,
    back: handleBack,
    pushToast: (message: string) => toast({ title: message }),
    refreshProjects: () => { void refreshInBackground().catch(() => toast({ title: "Changes saved, but the project list could not refresh. Refresh when your drafts are saved.", tone: "warn" })); },
    reload: () => {
      reloadProjects();
      setSeq((s) => s + 1);
    },
  };

  // ─── command palette commands ─────────────────────────────────────────────
  const commandDestinations: Array<{ section: NavSection; title: string; description: string }> = [
    { section: "overview", title: "Operations", description: "Project health, risks, monitors, and alerts" },
    { section: "investigate", title: "Investigate", description: "Events, errors, traces, and LLM calls" },
    { section: "incidents", title: "Incidents", description: "Active and resolved incidents" },
    { section: "llm", title: "LLM", description: "LLM call logs, costs, and analysis" },
    { section: "traces", title: "Traces", description: "Request timelines and span-level investigation" },
    { section: "entities", title: "Entities", description: "Tenants ranked by impact across signals" },
    { section: "users", title: "Users", description: "User activity, impact, and identity profiles" },
    { section: "events", title: "Events", description: "Event explorer, replay samples, and saved segments" },
    { section: "analytics", title: "Analytics", description: "Funnels, retention, paths, click maps, and property governance" },
    { section: "alerts", title: "Alerts", description: "Alert rules and recent alerts" },
    { section: "monitors", title: "Monitors", description: "HTTP uptime and heartbeat checks" },
    { section: "experiments", title: "Experiments", description: "A/B tests, feature flags, surveys, campaigns, and beta programs" },
    { section: "system", title: "Sigmon health", description: "Health of this Sigmon installation" },
    { section: "installation", title: "Installation & SDK", description: "Connect your application and verify telemetry" },
    { section: "administration", title: "Administration", description: "Manage projects and console access across this instance" },
    { section: "settings", title: "Settings", description: "Project and environment settings" },
  ];

  const commandItems: CommandPaletteItem[] = commandDestinations.map((destination) => ({
    id: destination.section,
    title: NAV_LABELS[destination.section],
    description: destination.description
  }));

  return (
    <div className="sh-v2" data-category={category.id}>
      <div className="app" data-nav={navMode} data-rail={instanceScope ? "hidden" : railCollapsed ? "collapsed" : "open"}>
        {/* Left navigation rail */}
        {mobileNavOpen ? <button className="nv-backdrop" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} /> : null}
        <NavRail active={nav} onNavigate={navigate} incidentCount={incidentCount} mode={navMode}
          onModeChange={(mode) => { setNavMode(mode); saveState({ navMode: mode }); }} mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

        {/* Main content area */}
        <div className="app-main" inert={mobileNavOpen ? true : undefined}>
          <TopBar
            instanceScope={instanceScope}
            onOpenNavigation={() => setMobileNavOpen(true)}
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
            onSignOut={onSignOut}
          />

          <div className="app-workspace">
            <div className="page" key={seq} data-anim={anim}>
              {instanceScope ? renderSection(nav, screenCtx) : isLoadingProjects || isRestoringScope
                ? (
                  <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
                    <EmptyHint icon="activity" title="Loading projects…" sub="Fetching project and environment data." />
                  </div>
                )
                : projectError
                  ? (
                    <div role="alert" style={{ padding: "48px 24px", display: "grid", placeItems: "center", gap: 16 }}>
                      <EmptyHint icon="alert" title="Could not load projects" sub="The console could not reach the project API." />
                      <button className="sh-btn" type="button" onClick={reloadProjects}>Retry loading projects</button>
                    </div>
                  )
                : projects.length === 0
                  ? <FirstProjectOnboarding client={client} onComplete={reloadProjects} onError={(message) => toast({ title: message, tone: "critical" })} />
                  : environmentError
                    ? (
                      <div role="alert" style={{ padding: "48px 24px", display: "grid", placeItems: "center", gap: 16 }}>
                        <EmptyHint icon="alert" title="Could not load environments" sub="Retry before changing the active project." />
                        <button className="sh-btn" type="button" onClick={reloadProjects}>Retry loading environments</button>
                      </div>
                    )
                  : activeProject && activeEnvironment
                ? detail
                  ? detail.target === "tenant"
                    ? renderTenantDetail(screenCtx, detail.tenantId)
                    : renderIncidentDetail(screenCtx, detail.groupId, detail.errorId)
                  : renderSection(nav, screenCtx)
                : activeProject
                  ? renderSection(nav === "installation" ? "installation" : "settings", screenCtx)
                : (
                  <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
                    <EmptyHint
                      icon="activity"
                      title="Project unavailable"
                      sub="Refresh the page or select another project."
                    />
                  </div>
                )}
            </div>
          </div>
        </div>

        {/* Health rail */}
        {!instanceScope ? <HealthRail
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
            environments: fleet.environments,
          }}
        /> : null}

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

export function ConsoleShellV2(props: ConsoleShellV2Props) {
  return <DenseConsoleShellV2 {...props} />;
}
