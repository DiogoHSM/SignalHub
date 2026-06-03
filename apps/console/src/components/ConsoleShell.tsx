import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, Command, LogOut, RefreshCw } from "lucide-react";
import type { ApiClient } from "../api/client";
import type { Environment, Project, User } from "../api/types";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { ConsoleModeTabs, type ConsoleMode } from "./ConsoleModeTabs";
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
  scope: "Project workspace" | "Sigmon admin";
  description: string;
  keywords: string[];
}> = [
  {
    mode: "overview",
    title: "Overview",
    scope: "Project workspace",
    description: "Telemetry summary, KPIs, trends, and top activity.",
    keywords: ["home", "dashboard", "kpi", "trend"]
  },
  {
    mode: "operations",
    title: "Operations",
    scope: "Project workspace",
    description: "Health cockpit for monitored app reliability.",
    keywords: ["health", "status", "latency", "error rate"]
  },
  {
    mode: "investigate",
    title: "Investigate",
    scope: "Project workspace",
    description: "Events, errors, traces, LLM calls, tenants, and users.",
    keywords: ["event", "error", "trace", "llm", "tenant", "user"]
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
    mode: "project-settings",
    title: "Project Settings",
    scope: "Project workspace",
    description: "Environments, API keys, browser origins, snippets, and users.",
    keywords: ["settings", "api key", "origin", "sdk", "user"]
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
    title: "System Health",
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

export function ConsoleShell({
  client,
  apiEndpoint,
  onSignOut,
  user
}: {
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
    parseIncidentRoute(window.location).kind === "error-group" ? "investigate" : "overview"
  );
  const [investigationDrilldown, setInvestigationDrilldown] = useState<{
    nonce: number;
    tab: InvestigationTab;
    filters: InvestigationInitialFilters;
  }>();
  const [latestSecret, setLatestSecret] = useState<LatestSecret | undefined>();
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadedEnvironmentProjectId, setLoadedEnvironmentProjectId] = useState<string | undefined>();
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
        setActiveMode("investigate");
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
    setActiveMode("investigate");
  }

  function openOperationsErrors(filters: { status?: "open" | "investigating"; severity?: string } = {}) {
    setInvestigationDrilldown((current) => ({
      nonce: (current?.nonce ?? 0) + 1,
      tab: "errors",
      filters: { errors: filters }
    }));
    setActiveMode("investigate");
  }

  function openOperationsTraces() {
    setInvestigationDrilldown((current) => ({
      nonce: (current?.nonce ?? 0) + 1,
      tab: "traces",
      filters: { traces: {} }
    }));
    setActiveMode("investigate");
  }

  function closeIncidentView() {
    window.history.replaceState({}, "", "/console");
    setIncidentRoute({ kind: "none" });
    setActiveMode("investigate");
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
    setActiveMode("investigate");
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

  const isSigmonAdminMode = activeMode === "system";
  const isIncidentViewActive = activeMode === "investigate" && incidentRoute.kind === "error-group";
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
    <main className="console-layout">
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
            {isSigmonAdminMode ? (
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
            <span className="scope-pill">
              <span className="scope-pill__dot" />
              {isSigmonAdminMode
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
              <div hidden={activeMode !== "project-settings"}>
                {activeMode === "project-settings" ? (
                  <ProjectSettingsWorkspace
                    activeEnvironment={activeEnvironment}
                    activeProject={activeProject}
                    activeProjectId={activeProject?.id}
                    apiEndpoint={apiEndpoint}
                    client={client}
                    environments={environments}
                    isEnvironmentCreationDisabled={isEnvironmentCreationDisabled}
                    latestSecret={scopedLatestSecret}
                    onCreateEnvironment={createEnvironment}
                    onArchiveProject={archiveProject}
                    onSecretCreated={storeLatestSecret}
                    onSelectEnvironment={setActiveEnvironment}
                    onUpdateProject={updateProject}
                  />
                ) : null}
              </div>
              <div hidden={activeMode !== "system"}>{activeMode === "system" ? <SigmonAdminWorkspace client={client} key={`system:${refreshToken}`} /> : null}</div>
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
    alerts: "Alerts",
    artifacts: "Artifacts",
    investigate: "Investigate",
    monitors: "Monitors",
    operations: "Operations",
    overview: "Overview",
    "project-settings": "Project Settings",
    setup: "Setup",
    system: "Sigmon Admin"
  };
  return labels[mode];
}
