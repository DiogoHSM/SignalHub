import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, Command, LogOut, RefreshCw } from "lucide-react";
import type { ApiClient } from "../api/client";
import type { Environment, OperationsResponse, Project, User } from "../api/types";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { ConsoleModeTabs, type ConsoleMode } from "./ConsoleModeTabs";
import { GlobalHomeDashboard, type GlobalProjectSignal, type GlobalProjectStatus } from "./GlobalHomeDashboard";
import { IncidentView } from "./IncidentView";
import { AlertsPanel } from "./AlertsPanel";
import { InvestigationWorkspace, type InvestigationInitialFilters, type InvestigationTab } from "./InvestigationWorkspace";
import { MonitorsPanel } from "./MonitorsPanel";
import { OperationsDashboard } from "./OperationsDashboard";
import { OverviewDashboard, type OverviewDrilldown } from "./OverviewDashboard";
import { ProjectSettingsWorkspace } from "./ProjectSettingsWorkspace";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SigmonAdminWorkspace } from "./SigmonAdminWorkspace";
import { SetupWorkspace } from "./SetupWorkspace";

type LatestSecret = {
  secret: string;
  projectId: string;
  environmentId: string;
};

type IncidentRoute =
  | { kind: "none" }
  | { kind: "error-group"; groupId: string; projectId: string; environmentId: string; errorId?: string };

const autoRefreshOptions = [
  { label: "Off", value: "0", milliseconds: 0 },
  { label: "1 min", value: "60000", milliseconds: 60_000 },
  { label: "2 min", value: "120000", milliseconds: 120_000 },
  { label: "15 min", value: "900000", milliseconds: 900_000 }
];

const commandDestinations: Array<{
  mode: ConsoleMode;
  title: string;
  scope: "Global" | "Project workspace" | "Sigmon admin";
  description: string;
  keywords: string[];
}> = [
  {
    mode: "home",
    title: "Home",
    scope: "Global",
    description: "All monitored projects and global operational risk.",
    keywords: ["home", "global", "dashboard", "risk", "projects"]
  },
  {
    mode: "operations",
    title: "Operations",
    scope: "Project workspace",
    description: "Health cockpit for monitored app reliability.",
    keywords: ["health", "status", "latency", "error rate"]
  },
  {
    mode: "overview",
    title: "Overview",
    scope: "Project workspace",
    description: "Legacy telemetry summary, KPI trends, and top activity.",
    keywords: ["dashboard", "kpi", "trend", "legacy"]
  },
  {
    mode: "analyze",
    title: "Analyze",
    scope: "Project workspace",
    description: "Events, errors, traces, LLM calls, tenants, and users.",
    keywords: ["event", "error", "trace", "llm", "tenant", "user"]
  },
  {
    mode: "traces",
    title: "Traces",
    scope: "Project workspace",
    description: "Request timelines, route latency, and span-level investigation.",
    keywords: ["trace", "span", "latency", "route", "p95"]
  },
  {
    mode: "errors",
    title: "Errors",
    scope: "Project workspace",
    description: "Grouped incidents, raw occurrences, severity, and triage.",
    keywords: ["error", "incident", "fingerprint", "severity", "triage"]
  },
  {
    mode: "experiments",
    title: "Experiments",
    scope: "Project workspace",
    description: "Feature flags, A/B tests, prompt variants, and model comparisons.",
    keywords: ["experiment", "ab test", "feature flag", "prompt", "model"]
  },
  {
    mode: "configure",
    title: "Configure",
    scope: "Project workspace",
    description: "Environments, API keys, browser origins, snippets, and users.",
    keywords: ["settings", "api key", "origin", "sdk", "user"]
  },
  {
    mode: "alerts",
    title: "Alerts",
    scope: "Project workspace",
    description: "Alert rules, channels, recent alerts, and delivery state.",
    keywords: ["rule", "email", "webhook", "notification"]
  },
  {
    mode: "monitors",
    title: "Monitors",
    scope: "Project workspace",
    description: "HTTP uptime checks and heartbeat monitors.",
    keywords: ["uptime", "heartbeat", "check"]
  },
  {
    mode: "artifacts",
    title: "Artifacts",
    scope: "Project workspace",
    description: "Source maps, upload tokens, releases, and artifact cleanup.",
    keywords: ["source map", "sourcemap", "release", "token"]
  },
  {
    mode: "setup",
    title: "Onboarding",
    scope: "Project workspace",
    description: "Create projects, environments, API keys, and smoke checks.",
    keywords: ["setup", "install", "create", "onboard"]
  },
  {
    mode: "system",
    title: "Admin",
    scope: "Sigmon admin",
    description: "Sigmon server health, workers, scheduler, retention, and backups.",
    keywords: ["admin", "server", "worker", "scheduler", "backup", "retention"]
  }
];

function parseIncidentRoute(location: Location): IncidentRoute {
  const match = location.pathname.match(/\/console\/incidents\/error-groups\/([^/]+)$/);
  if (!match) return { kind: "none" };
  let groupId: string;
  try {
    groupId = decodeURIComponent(match[1]);
  } catch {
    return { kind: "none" };
  }
  const params = new URLSearchParams(location.search);
  const projectId = params.get("project_id");
  const environmentId = params.get("environment_id");
  if (!projectId || !environmentId) return { kind: "none" };
  return {
    kind: "error-group",
    groupId,
    projectId,
    environmentId,
    errorId: params.get("error_id") ?? undefined
  };
}

function operationsToGlobalSignal(data: OperationsResponse): GlobalProjectSignal {
  const downMonitors = data.summary.monitors.http.down + data.summary.monitors.heartbeat.down;
  const setupGaps = data.setupGaps.filter((gap) => gap.severity === "warning").length;

  return {
    criticalAlerts: data.summary.alerts.events.critical,
    downMonitors,
    errorRatePercent: data.summary.telemetry.errorRatePercent,
    openIncidents: data.summary.incidents.open + data.summary.incidents.investigating,
    p95LatencyMs: data.summary.telemetry.p95TraceDurationMs,
    setupGaps,
    status: operationsStatusToGlobalStatus(data.status)
  };
}

function operationsStatusToGlobalStatus(status: OperationsResponse["status"]): GlobalProjectStatus {
  if (status === "unhealthy") return "critical";
  if (status === "degraded") return "degraded";
  if (status === "not_configured") return "attention";
  return "healthy";
}

export function ConsoleShell({
  browserCorsOrigins = [],
  client,
  apiEndpoint,
  onSignOut,
  user
}: {
  browserCorsOrigins?: string[];
  client: ApiClient;
  apiEndpoint?: string;
  onSignOut?: () => Promise<void>;
  user?: User;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [activeProject, setActiveProject] = useState<Project | undefined>();
  const [activeEnvironment, setActiveEnvironment] = useState<Environment | undefined>();
  const [incidentRoute, setIncidentRoute] = useState<IncidentRoute>(() => parseIncidentRoute(window.location));
  const [activeMode, setActiveMode] = useState<ConsoleMode>(() =>
    parseIncidentRoute(window.location).kind === "error-group" ? "errors" : "home"
  );
  const [investigationDrilldown, setInvestigationDrilldown] = useState<{
    nonce: number;
    tab: InvestigationTab;
    filters: InvestigationInitialFilters;
  }>();
  const [latestSecret, setLatestSecret] = useState<LatestSecret | undefined>();
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadedEnvironmentProjectId, setLoadedEnvironmentProjectId] = useState<string | undefined>();
  const [globalProjectSignals, setGlobalProjectSignals] = useState<Record<string, GlobalProjectSignal | undefined>>({});
  const [refreshToken, setRefreshToken] = useState(0);
  const [autoRefreshMs, setAutoRefreshMs] = useState(0);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const activeProjectIdRef = useRef<string | undefined>(undefined);
  const activeEnvironmentRef = useRef<Environment | undefined>(undefined);
  const environmentsRef = useRef<Environment[]>([]);
  const isEnvironmentCreationDisabled = !activeProject || loadedEnvironmentProjectId !== activeProject.id;
  const scopedLatestSecret =
    latestSecret && latestSecret.projectId === activeProject?.id && latestSecret.environmentId === activeEnvironment?.id
      ? latestSecret.secret
      : undefined;

  useEffect(() => {
    function handlePopState() {
      const nextRoute = parseIncidentRoute(window.location);
      setIncidentRoute(nextRoute);
      if (nextRoute.kind === "error-group") {
        setActiveMode("errors");
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    activeProjectIdRef.current = activeProject?.id;
  }, [activeProject?.id]);

  useEffect(() => {
    activeEnvironmentRef.current = activeEnvironment;
  }, [activeEnvironment]);

  useEffect(() => {
    setLatestSecret(undefined);
  }, [activeProject?.id, activeEnvironment?.id]);

  useEffect(() => {
    environmentsRef.current = environments;
  }, [environments]);

  useEffect(() => {
    if (autoRefreshMs <= 0) return undefined;
    const timer = window.setInterval(() => {
      setRefreshToken((current) => current + 1);
    }, autoRefreshMs);
    return () => window.clearInterval(timer);
  }, [autoRefreshMs]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
      }
      if (event.key === "Escape") {
        setIsCommandPaletteOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingProjects(true);

    void client
      .listProjects()
      .then(({ projects }) => {
        if (cancelled) return;
        setProjects(projects);
        setActiveProject((current) => {
          const next = current ?? projects[0];
          activeProjectIdRef.current = next?.id;
          return next;
        });
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingProjects(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    let cancelled = false;

    if (projects.length === 0 || !client.getOperations) {
      setGlobalProjectSignals({});
      return () => {
        cancelled = true;
      };
    }

    const getOperations = client.getOperations;

    void Promise.all(
      projects.map(async (project) => {
        try {
          const { environments } = await client.listEnvironments(project.id);
          const environment = environments[0];
          if (!environment) {
            return [project.id, { status: "attention", setupGaps: 1 } satisfies GlobalProjectSignal] as const;
          }
          const { data } = await getOperations({ projectId: project.id, environmentId: environment.id, window: "24h" });
          if (!data) return [project.id, undefined] as const;
          return [project.id, operationsToGlobalSignal(data)] as const;
        } catch {
          return [project.id, undefined] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setGlobalProjectSignals(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [client, projects, refreshToken]);

  useEffect(() => {
    let cancelled = false;

    if (!activeProject) {
      environmentsRef.current = [];
      activeEnvironmentRef.current = undefined;
      setEnvironments([]);
      setActiveEnvironment(undefined);
      setLoadedEnvironmentProjectId(undefined);
      return () => {
        cancelled = true;
      };
    }

    environmentsRef.current = [];
    activeEnvironmentRef.current = undefined;
    setEnvironments([]);
    setActiveEnvironment(undefined);
    setLoadedEnvironmentProjectId(undefined);

    void client
      .listEnvironments(activeProject.id)
      .then(({ environments }) => {
        if (cancelled || activeProjectIdRef.current !== activeProject.id) return;

        const fetchedEnvironmentIds = new Set(environments.map((environment) => environment.id));
        const localEnvironments = environmentsRef.current.filter(
          (environment) => environment.projectId === activeProject.id && !fetchedEnvironmentIds.has(environment.id)
        );
        const mergedEnvironments = [...environments, ...localEnvironments];
        const currentActiveEnvironment = activeEnvironmentRef.current;
        const preservedActiveEnvironment =
          currentActiveEnvironment?.projectId === activeProject.id
            ? mergedEnvironments.find((environment) => environment.id === currentActiveEnvironment.id)
            : undefined;
        const nextActiveEnvironment = preservedActiveEnvironment ?? mergedEnvironments[0];

        environmentsRef.current = mergedEnvironments;
        activeEnvironmentRef.current = nextActiveEnvironment;
        setEnvironments(mergedEnvironments);
        setActiveEnvironment(nextActiveEnvironment);
        setLoadedEnvironmentProjectId(activeProject.id);
      });

    return () => {
      cancelled = true;
    };
  }, [client, activeProject]);

  function selectProject(project: Project) {
    activeProjectIdRef.current = project.id;
    setActiveProject(project);
  }

  function selectProjectById(projectId: string) {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) return;
    selectProject(project);
  }

  function openProjectWorkspace(projectId: string) {
    selectProjectById(projectId);
    setActiveMode("operations");
  }

  function selectEnvironmentById(environmentId: string) {
    const environment = environments.find((candidate) => candidate.id === environmentId);
    if (!environment) return;
    activeEnvironmentRef.current = environment;
    setActiveEnvironment(environment);
    setRefreshToken((current) => current + 1);
  }

  function storeLatestSecret(secret: string) {
    if (!activeProject || !activeEnvironment) return;
    setLatestSecret({
      secret,
      projectId: activeProject.id,
      environmentId: activeEnvironment.id
    });
  }

  function handleOverviewDrilldown(drilldown: OverviewDrilldown) {
    const filters: InvestigationInitialFilters =
      drilldown.tab === "events"
        ? { events: drilldown.filters }
        : drilldown.tab === "errors"
          ? { errors: drilldown.filters }
          : drilldown.tab === "llm"
            ? { llm: drilldown.filters }
            : { entities: drilldown.filters };

    setInvestigationDrilldown((current) => ({
      nonce: (current?.nonce ?? 0) + 1,
      tab: drilldown.tab,
      filters
    }));
    setActiveMode(drilldown.tab === "errors" ? "errors" : "analyze");
  }

  function openOperationsErrors(filters: { status?: "open" | "investigating"; severity?: string } = {}) {
    setInvestigationDrilldown((current) => ({
      nonce: (current?.nonce ?? 0) + 1,
      tab: "errors",
      filters: { errors: filters }
    }));
    setActiveMode("errors");
  }

  function openOperationsTraces() {
    setInvestigationDrilldown((current) => ({
      nonce: (current?.nonce ?? 0) + 1,
      tab: "traces",
      filters: { traces: {} }
    }));
    setActiveMode("traces");
  }

  function closeIncidentView() {
    window.history.replaceState({}, "", "/console");
    setIncidentRoute({ kind: "none" });
    setActiveMode("errors");
  }

  function navigateToMode(mode: ConsoleMode) {
    if (incidentRoute.kind !== "none") {
      window.history.replaceState({}, "", "/console");
      setIncidentRoute({ kind: "none" });
    }
    setActiveMode(mode);
    setIsCommandPaletteOpen(false);
    setCommandQuery("");
  }

  function openErrorGroupIncident(groupId: string, options?: { errorId?: string }) {
    if (!activeProject || !activeEnvironment) return;

    const params = new URLSearchParams({
      project_id: activeProject.id,
      environment_id: activeEnvironment.id
    });
    if (options?.errorId) params.set("error_id", options.errorId);

    const path = `/console/incidents/error-groups/${encodeURIComponent(groupId)}?${params.toString()}`;
    window.history.pushState({}, "", path);
    setIncidentRoute({
      kind: "error-group",
      groupId,
      projectId: activeProject.id,
      environmentId: activeEnvironment.id,
      errorId: options?.errorId
    });
    setActiveMode("errors");
  }

  function refreshWorkspace() {
    setRefreshToken((current) => current + 1);
  }

  async function signOut() {
    if (!onSignOut || isSigningOut) return;
    setIsSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setIsSigningOut(false);
      setIsUserMenuOpen(false);
    }
  }

  async function createProject(name: string) {
    if (isLoadingProjects) return;

    const { project } = await client.createProject({ name });
    setProjects((current) => [...current, project]);
    selectProject(project);
    environmentsRef.current = [];
    activeEnvironmentRef.current = undefined;
    setEnvironments([]);
    setActiveEnvironment(undefined);
  }

  async function updateProject(projectId: string, input: { name?: string }) {
    const { project } = await client.updateProject(projectId, input);

    setProjects((current) => current.map((candidate) => (candidate.id === project.id ? project : candidate)));
    setActiveProject((current) => (current?.id === project.id ? project : current));
  }

  async function archiveProject(projectId: string) {
    await client.archiveProject(projectId);

    const remainingProjects = projects.filter((project) => project.id !== projectId);
    setProjects(remainingProjects);

    if (activeProject?.id !== projectId) return;

    const nextProject = remainingProjects[0];
    activeProjectIdRef.current = nextProject?.id;
    setActiveProject(nextProject);
    environmentsRef.current = [];
    activeEnvironmentRef.current = undefined;
    setEnvironments([]);
    setActiveEnvironment(undefined);
    setLoadedEnvironmentProjectId(undefined);
  }

  async function createEnvironment(name: string) {
    if (isEnvironmentCreationDisabled) return;

    const projectId = activeProject.id;
    const { environment } = await client.createEnvironment(projectId, { name });
    if (activeProjectIdRef.current !== projectId) return;

    setEnvironments((current) => {
      const next = current.some((currentEnvironment) => currentEnvironment.id === environment.id)
        ? current.map((currentEnvironment) => (currentEnvironment.id === environment.id ? environment : currentEnvironment))
        : [...current, environment];
      environmentsRef.current = next;
      return next;
    });
    activeEnvironmentRef.current = environment;
    setActiveEnvironment(environment);
  }

  async function updateEnvironment(environment: Environment, name: string) {
    const { environment: updatedEnvironment } = await client.updateEnvironment(environment.id, { name });
    if (activeProjectIdRef.current !== updatedEnvironment.projectId) return;

    setEnvironments((current) => {
      const next = current.map((currentEnvironment) =>
        currentEnvironment.id === updatedEnvironment.id ? updatedEnvironment : currentEnvironment
      );
      environmentsRef.current = next;
      return next;
    });

    if (activeEnvironmentRef.current?.id === updatedEnvironment.id) {
      activeEnvironmentRef.current = updatedEnvironment;
      setActiveEnvironment(updatedEnvironment);
    }
  }

  async function archiveEnvironment(environment: Environment) {
    await client.archiveEnvironment(environment.id);
    if (activeProjectIdRef.current !== environment.projectId) return;

    setEnvironments((current) => {
      const next = current.filter((currentEnvironment) => currentEnvironment.id !== environment.id);
      environmentsRef.current = next;
      const shouldReplaceActive = activeEnvironmentRef.current?.id === environment.id;
      if (shouldReplaceActive) {
        const nextActiveEnvironment = next[0];
        activeEnvironmentRef.current = nextActiveEnvironment;
        setActiveEnvironment(nextActiveEnvironment);
      }
      return next;
    });
  }

  const isGlobalHomeMode = activeMode === "home";
  const isSigmonAdminMode = activeMode === "system";
  const isProjectWorkspaceMode = !isGlobalHomeMode && !isSigmonAdminMode;
  const isIncidentViewActive = activeMode === "errors" && incidentRoute.kind === "error-group";
  const activeModeLabel = activeMode === "setup" ? "Setup" : isIncidentViewActive ? "Incident" : modeLabel(activeMode);
  const userInitials = initials(user?.email);
  const normalizedCommandQuery = commandQuery.trim().toLowerCase();
  const filteredCommands = normalizedCommandQuery
    ? commandDestinations.filter((destination) =>
        [destination.title, destination.scope, destination.description, ...destination.keywords]
          .join(" ")
          .toLowerCase()
          .includes(normalizedCommandQuery)
      )
    : commandDestinations;

  return (
    <main className="console-layout console-shell">
      <aside className="console-rail" aria-label="Console navigation">
        <div className="console-logo" role="img" aria-label="sigmon heartbeat logo">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M3 12h4l2.4-6 5.2 12 2.4-6h4" />
          </svg>
        </div>
        <ConsoleModeTabs activeMode={activeMode} onChange={navigateToMode} />
      </aside>
      <section className="console-main">
        <header className="workspace-header">
          <div className="workspace-crumb">
            {isGlobalHomeMode ? (
              <strong>Global</strong>
            ) : isSigmonAdminMode ? (
              <strong>Sigmon</strong>
            ) : (
              <label className="project-scope-control">
                <span>Project</span>
                <select
                  aria-label="Current project"
                  disabled={isLoadingProjects || projects.length === 0}
                  onChange={(event) => selectProjectById(event.target.value)}
                  value={activeProject?.id ?? ""}
                >
                  {activeProject ? null : <option value="">No project selected</option>}
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span aria-hidden="true">/</span>
            <strong>{activeModeLabel}</strong>
          </div>
          <div className="workspace-scope">
            {isProjectWorkspaceMode ? (
              <label className="environment-scope-control">
                <span>Environment</span>
                <select
                  aria-label="Current environment"
                  disabled={!activeProject || loadedEnvironmentProjectId !== activeProject.id || environments.length === 0}
                  onChange={(event) => selectEnvironmentById(event.target.value)}
                  value={activeEnvironment?.id ?? ""}
                >
                  {activeEnvironment ? null : <option value="">No environment selected</option>}
                  {environments.map((environment) => (
                    <option key={environment.id} value={environment.id}>
                      {environment.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <span className="scope-pill">
              <span className="scope-pill__dot" />
              {isGlobalHomeMode
                ? "All monitored projects"
                : isSigmonAdminMode
                ? "Installation-wide"
                : activeEnvironment
                  ? `Environment: ${activeEnvironment.name}`
                  : "Create an environment to continue setup."}
            </span>
            <button aria-label="Open command palette" className="console-search" onClick={() => setIsCommandPaletteOpen(true)} type="button">
              <Command aria-hidden="true" size={14} />
              <span>Jump to event, error, tenant, user, trace...</span>
              <kbd>⌘K</kbd>
            </button>
          </div>
          <div className="workspace-actions">
            <button aria-label="Refresh current view" className="icon-button" onClick={refreshWorkspace} title="Refresh current view" type="button">
              <RefreshCw aria-hidden="true" size={15} />
            </button>
            <label className="auto-refresh-control">
              <span>Auto refresh</span>
              <select
                aria-label="Auto refresh interval"
                onChange={(event) => setAutoRefreshMs(Number(event.target.value))}
                value={String(autoRefreshMs)}
              >
                {autoRefreshOptions.map((option) => (
                  <option key={option.value} value={option.milliseconds}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="icon-button" title="Notifications" type="button">
              <Bell aria-hidden="true" size={15} />
            </button>
            <div className="user-menu">
              <button
                aria-expanded={isUserMenuOpen}
                aria-haspopup="menu"
                className="console-avatar-button"
                onClick={() => setIsUserMenuOpen((current) => !current)}
                title={user?.email ?? "Signed in operator"}
                type="button"
              >
                <span className="console-avatar" aria-hidden="true">{userInitials}</span>
                <ChevronDown aria-hidden="true" size={13} />
                <span className="sr-only">Signed in operator menu</span>
              </button>
              {isUserMenuOpen ? (
                <div className="user-menu__popover" role="menu">
                  <div className="user-menu__identity">
                    <strong>{user?.email ?? "Console operator"}</strong>
                    <span>{user?.isAdmin ? "Administrator" : "User"}</span>
                  </div>
                  <button disabled={!onSignOut || isSigningOut} onClick={() => void signOut()} role="menuitem" type="button">
                    <LogOut aria-hidden="true" size={15} />
                    {isSigningOut ? "Signing out" : "Sign out"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        {isCommandPaletteOpen ? (
          <div aria-label="Command palette" aria-modal="true" className="command-palette" role="dialog">
            <div className="command-palette__backdrop" onClick={() => setIsCommandPaletteOpen(false)} />
            <section className="command-palette__panel">
              <label className="command-palette__search">
                <Command aria-hidden="true" size={16} />
                <input
                  aria-label="Search commands"
                  autoFocus
                  onChange={(event) => setCommandQuery(event.target.value)}
                  placeholder="Jump to project, error, monitor, settings..."
                  value={commandQuery}
                />
                <kbd>Esc</kbd>
              </label>
              <div className="command-palette__list">
                {filteredCommands.length === 0 ? (
                  <p className="muted-text">No commands match this search.</p>
                ) : (
                  filteredCommands.map((destination) => (
                    <button
                      aria-label={`Open ${destination.title}`}
                      className="command-palette__item"
                      key={destination.mode}
                      onClick={() => navigateToMode(destination.mode)}
                      type="button"
                    >
                      <span>
                        <strong>Open {destination.title}</strong>
                        <small>{destination.description}</small>
                      </span>
                      <em>{destination.scope}</em>
                    </button>
                  ))
                )}
              </div>
            </section>
          </div>
        ) : null}
        <div className="workspace">
          {isIncidentViewActive ? (
            <IncidentView
              client={client}
              environmentId={incidentRoute.environmentId}
              errorId={incidentRoute.errorId}
              groupId={incidentRoute.groupId}
              key={`${incidentRoute.groupId}:${incidentRoute.errorId ?? ""}:${refreshToken}`}
              onBack={closeIncidentView}
              projectId={incidentRoute.projectId}
            />
          ) : (
            <>
              <div hidden={activeMode !== "home"}>
                {activeMode === "home" ? (
                  <GlobalHomeDashboard
                    isLoading={isLoadingProjects}
                    onOpenProject={openProjectWorkspace}
                    projectSignals={globalProjectSignals}
                    projects={projects}
                  />
                ) : null}
              </div>
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
              <div hidden={activeMode !== "overview"}>
                {activeMode === "overview" ? (
                  <OverviewDashboard
                    client={client}
                    environmentId={activeEnvironment?.id}
                    key={`overview:${refreshToken}`}
                    onDrilldown={handleOverviewDrilldown}
                    projectId={activeProject?.id}
                  />
                ) : null}
              </div>
              <div hidden={activeMode !== "operations"}>
                {activeMode === "operations" ? (
                  <OperationsDashboard
                    client={client}
                    environmentId={activeEnvironment?.id}
                    key={`operations:${refreshToken}`}
                    onOpenAlerts={() => setActiveMode("alerts")}
                    onOpenErrors={openOperationsErrors}
                    onOpenIncident={openErrorGroupIncident}
                    onOpenMonitors={() => setActiveMode("monitors")}
                    onOpenTraces={openOperationsTraces}
                    projectId={activeProject?.id}
                  />
                ) : null}
              </div>
              <div hidden={activeMode !== "investigate"}>
                {activeMode === "investigate" ? (
                  <InvestigationWorkspace
                    client={client}
                    environmentId={activeEnvironment?.id}
                    initialFilters={investigationDrilldown?.filters}
                    initialTab={investigationDrilldown?.tab}
                    key={`${investigationDrilldown?.nonce ?? "investigation"}:${refreshToken}`}
                    onOpenIncident={openErrorGroupIncident}
                    projectId={activeProject?.id}
                  />
                ) : null}
              </div>
              <div hidden={activeMode !== "analyze"}>
                {activeMode === "analyze" ? (
                  <InvestigationWorkspace
                    client={client}
                    environmentId={activeEnvironment?.id}
                    initialFilters={investigationDrilldown?.filters}
                    initialTab={investigationDrilldown?.tab ?? "events"}
                    key={`${investigationDrilldown?.nonce ?? "analyze"}:${refreshToken}`}
                    onOpenIncident={openErrorGroupIncident}
                    projectId={activeProject?.id}
                  />
                ) : null}
              </div>
              <div hidden={activeMode !== "traces"}>
                {activeMode === "traces" ? (
                  <InvestigationWorkspace
                    client={client}
                    environmentId={activeEnvironment?.id}
                    initialFilters={investigationDrilldown?.filters}
                    initialTab="traces"
                    key={`${investigationDrilldown?.nonce ?? "traces"}:${refreshToken}`}
                    onOpenIncident={openErrorGroupIncident}
                    projectId={activeProject?.id}
                  />
                ) : null}
              </div>
              <div hidden={activeMode !== "errors"}>
                {activeMode === "errors" ? (
                  <InvestigationWorkspace
                    client={client}
                    environmentId={activeEnvironment?.id}
                    initialFilters={investigationDrilldown?.filters}
                    initialTab="errors"
                    key={`${investigationDrilldown?.nonce ?? "errors"}:${refreshToken}`}
                    onOpenIncident={openErrorGroupIncident}
                    projectId={activeProject?.id}
                  />
                ) : null}
              </div>
              <div hidden={activeMode !== "experiments"}>
                {activeMode === "experiments" ? (
                  <section className="panel experiments-panel" aria-labelledby="experiments-title">
                    <p className="eyebrow">Project Workspace</p>
                    <h1 id="experiments-title">Experiments</h1>
                    <p className="muted-text">
                      Feature flags, A/B tests, prompt variants, and model comparisons will land as a dedicated product slice.
                    </p>
                    <div className="experiments-panel__grid">
                      <article>
                        <strong>Feature flags</strong>
                        <span>Rollout controls and operational guardrails.</span>
                      </article>
                      <article>
                        <strong>A/B tests</strong>
                        <span>Variant performance by conversion, latency, and error impact.</span>
                      </article>
                      <article>
                        <strong>Prompt comparisons</strong>
                        <span>Cost, success rate, model behavior, and regression checks.</span>
                      </article>
                    </div>
                  </section>
                ) : null}
              </div>
              <div hidden={activeMode !== "alerts"}>
                {activeMode === "alerts" ? (
                  <AlertsPanel client={client} environmentId={activeEnvironment?.id} key={`alerts:${refreshToken}`} projectId={activeProject?.id} />
                ) : null}
              </div>
              <div hidden={activeMode !== "monitors"}>
                {activeMode === "monitors" ? (
                  <MonitorsPanel
                    apiEndpoint={apiEndpoint ?? ""}
                    client={client}
                    environmentId={activeEnvironment?.id}
                    key={`monitors:${refreshToken}`}
                    projectId={activeProject?.id}
                  />
                ) : null}
              </div>
              <div hidden={activeMode !== "artifacts"}>
                {activeMode === "artifacts" ? (
                  <ArtifactsPanel
                    client={client}
                    environmentId={activeEnvironment?.id}
                    key={`${activeProject?.id ?? "none"}:${activeEnvironment?.id ?? "none"}:${refreshToken}`}
                    projectId={activeProject?.id}
                  />
                ) : null}
              </div>
              <div hidden={activeMode !== "project-settings" && activeMode !== "configure"}>
                {activeMode === "project-settings" || activeMode === "configure" ? (
                  <ProjectSettingsWorkspace
                    activeEnvironment={activeEnvironment}
                    activeProject={activeProject}
                    activeProjectId={activeProject?.id}
                    apiEndpoint={apiEndpoint}
                    browserCorsOrigins={browserCorsOrigins}
                    client={client}
                    environments={environments}
                    isEnvironmentCreationDisabled={isEnvironmentCreationDisabled}
                    latestSecret={scopedLatestSecret}
                    onArchiveEnvironment={archiveEnvironment}
                    onCreateEnvironment={createEnvironment}
                    onArchiveProject={archiveProject}
                    onSecretCreated={storeLatestSecret}
                    onSelectEnvironment={setActiveEnvironment}
                    onUpdateProject={updateProject}
                    onUpdateEnvironment={updateEnvironment}
                  />
                ) : null}
              </div>
              <div hidden={activeMode !== "system"}>
                {activeMode === "system" ? (
                  <SigmonAdminWorkspace browserCorsOrigins={browserCorsOrigins} client={client} key={`system:${refreshToken}`} />
                ) : null}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function initials(email: string | undefined): string {
  if (!email) return "OP";
  const [name] = email.split("@");
  const parts = name.split(/[._\-\s]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function modeLabel(mode: ConsoleMode): string {
  const labels: Record<ConsoleMode, string> = {
    analyze: "Analyze",
    alerts: "Alerts",
    artifacts: "Artifacts",
    configure: "Configure",
    errors: "Errors",
    experiments: "Experiments",
    home: "Home",
    investigate: "Investigate",
    monitors: "Monitors",
    operations: "Operations",
    overview: "Overview",
    "project-settings": "Project Settings",
    setup: "Setup",
    system: "Sigmon Admin",
    traces: "Traces"
  };
  return labels[mode];
}
