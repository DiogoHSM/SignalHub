import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { Environment, Project } from "../api/types";
import { ConsoleModeTabs, type ConsoleMode } from "./ConsoleModeTabs";
import { InvestigationWorkspace } from "./InvestigationWorkspace";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SetupWorkspace } from "./SetupWorkspace";

type LatestSecret = {
  secret: string;
  projectId: string;
  environmentId: string;
};

export function ConsoleShell({ client, apiEndpoint }: { client: ApiClient; apiEndpoint?: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [activeProject, setActiveProject] = useState<Project | undefined>();
  const [activeEnvironment, setActiveEnvironment] = useState<Environment | undefined>();
  const [activeMode, setActiveMode] = useState<ConsoleMode>("setup");
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
        <div hidden={activeMode !== "investigate"}>
          {activeMode === "investigate" ? (
            <InvestigationWorkspace client={client} environmentId={activeEnvironment?.id} projectId={activeProject?.id} />
          ) : null}
        </div>
      </section>
    </main>
  );
}
