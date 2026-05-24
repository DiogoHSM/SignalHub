import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { Environment, Project } from "../api/types";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { ConsoleModeTabs, type ConsoleMode } from "./ConsoleModeTabs";
import { IncidentView } from "./IncidentView";
import { AlertsPanel } from "./AlertsPanel";
import { InvestigationWorkspace, type InvestigationInitialFilters, type InvestigationTab } from "./InvestigationWorkspace";
import { OverviewDashboard, type OverviewDrilldown } from "./OverviewDashboard";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SetupWorkspace } from "./SetupWorkspace";
import { SystemHealthPanel } from "./SystemHealthPanel";

type LatestSecret = {
  secret: string;
  projectId: string;
  environmentId: string;
};

type IncidentRoute =
  | { kind: "none" }
  | { kind: "error-group"; groupId: string; projectId: string; environmentId: string; errorId?: string };

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

export function ConsoleShell({ client, apiEndpoint }: { client: ApiClient; apiEndpoint?: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [activeProject, setActiveProject] = useState<Project | undefined>();
  const [activeEnvironment, setActiveEnvironment] = useState<Environment | undefined>();
  const [activeMode, setActiveMode] = useState<ConsoleMode>("setup");
  const [incidentRoute, setIncidentRoute] = useState<IncidentRoute>(() => parseIncidentRoute(window.location));
  const [investigationDrilldown, setInvestigationDrilldown] = useState<{
    nonce: number;
    tab: InvestigationTab;
    filters: InvestigationInitialFilters;
  }>();
  const [latestSecret, setLatestSecret] = useState<LatestSecret | undefined>();
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadedEnvironmentProjectId, setLoadedEnvironmentProjectId] = useState<string | undefined>();
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
      setIncidentRoute(parseIncidentRoute(window.location));
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

  function closeIncidentView() {
    window.history.pushState({}, "", "/console");
    setIncidentRoute({ kind: "none" });
    setActiveMode("investigate");
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

  return (
    <main className="console-layout">
      <ProjectSwitcher
        activeProjectId={activeProject?.id}
        disabled={isLoadingProjects}
        onCreate={createProject}
        onSelect={selectProject}
        projects={projects}
      />
      <section className="workspace">
        <header className="workspace-header">
          <div>
            <h1>{activeProject?.name ?? "No project selected"}</h1>
            <p>{activeEnvironment ? `Environment: ${activeEnvironment.name}` : "Create an environment to continue setup."}</p>
          </div>
          <ConsoleModeTabs activeMode={activeMode} onChange={setActiveMode} />
        </header>
        {incidentRoute.kind === "error-group" ? (
          <IncidentView
            client={client}
            environmentId={incidentRoute.environmentId}
            errorId={incidentRoute.errorId}
            groupId={incidentRoute.groupId}
            onBack={closeIncidentView}
            projectId={incidentRoute.projectId}
          />
        ) : (
          <>
            <div hidden={activeMode !== "setup"}>
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
                  onDrilldown={handleOverviewDrilldown}
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
                  key={investigationDrilldown?.nonce ?? "investigation"}
                  onOpenIncident={openErrorGroupIncident}
                  projectId={activeProject?.id}
                />
              ) : null}
            </div>
            <div hidden={activeMode !== "alerts"}>
              {activeMode === "alerts" ? (
                <AlertsPanel client={client} environmentId={activeEnvironment?.id} projectId={activeProject?.id} />
              ) : null}
            </div>
            <div hidden={activeMode !== "artifacts"}>
              {activeMode === "artifacts" ? (
                <ArtifactsPanel
                  client={client}
                  environmentId={activeEnvironment?.id}
                  key={`${activeProject?.id ?? "none"}:${activeEnvironment?.id ?? "none"}`}
                  projectId={activeProject?.id}
                />
              ) : null}
            </div>
            <div hidden={activeMode !== "system"}>{activeMode === "system" ? <SystemHealthPanel client={client} /> : null}</div>
          </>
        )}
      </section>
    </main>
  );
}
