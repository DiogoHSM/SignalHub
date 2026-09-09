import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { Environment, Project } from "../api/types";

export type UseConsoleProjectsResult = {
  projects: Project[];
  environments: Environment[];
  activeProject: Project | undefined;
  activeEnvironment: Environment | undefined;
  isLoading: boolean;
  projectError: boolean;
  environmentError: boolean;
  selectProject: (projectId: string) => void;
  selectEnvironment: (environmentId: string) => void;
  selectEnvironmentByName: (name: string) => void;
  selectProjectEnvironmentByName: (projectId: string, name: string) => void;
  reload: () => void;
  refreshInBackground: () => Promise<void>;
};

/**
 * v2-local loader for project and environment state.
 * Mirrors the loading logic from ConsoleShell but lives independently
 * so ConsoleShellV2 can consume it without modifying the legacy shell.
 */
export function useConsoleProjects(client: ApiClient): UseConsoleProjectsResult {
  const [projects, setProjects] = useState<Project[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [activeProject, setActiveProject] = useState<Project | undefined>();
  const [activeEnvironment, setActiveEnvironment] = useState<Environment | undefined>();
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingEnvironments, setIsLoadingEnvironments] = useState(false);
  const [projectError, setProjectError] = useState(false);
  const [environmentError, setEnvironmentError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // Refs to safely read current values inside async callbacks without stale closures
  const activeProjectIdRef = useRef<string | undefined>(undefined);
  const activeEnvironmentRef = useRef<Environment | undefined>(undefined);
  const pendingEnvironmentRef = useRef<{ projectId: string; name: string } | null>(null);
  const refreshGenerationRef = useRef(0);
  const activeProjectId = activeProject?.id;

  // Load projects on mount
  useEffect(() => {
    let cancelled = false;
    setIsLoadingProjects(true);
    setProjectError(false);

    void client
      .listProjects()
      .then(({ projects: loaded }) => {
        if (cancelled) return;
        setProjects(loaded);
        setActiveProject((current) => {
          const next = current
            ? loaded.find((project) => project.id === current.id) ?? loaded[0]
            : loaded[0];
          activeProjectIdRef.current = next?.id;
          return next;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setProjects([]);
        setActiveProject(undefined);
        activeProjectIdRef.current = undefined;
        setProjectError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingProjects(false);
      });

    return () => {
      cancelled = true;
      refreshGenerationRef.current += 1;
    };
  }, [client, reloadTick]);

  // Load environments whenever the active project changes
  useEffect(() => {
    let cancelled = false;

    if (!activeProjectId) {
      setIsLoadingEnvironments(false);
      setEnvironmentError(false);
      activeEnvironmentRef.current = undefined;
      setEnvironments([]);
      setActiveEnvironment(undefined);
      return () => {
        cancelled = true;
      };
    }

    activeEnvironmentRef.current = undefined;
    setEnvironments([]);
    setActiveEnvironment(undefined);
    setIsLoadingEnvironments(true);
    setEnvironmentError(false);

    void client
      .listEnvironments(activeProjectId)
      .then(({ environments: loaded }) => {
        if (cancelled || activeProjectIdRef.current !== activeProjectId) return;

        const current = activeEnvironmentRef.current;
        const requested = pendingEnvironmentRef.current?.projectId === activeProjectId
          ? loaded.find((environment) => environment.name === pendingEnvironmentRef.current?.name)
          : undefined;
        const preserved =
          current?.projectId === activeProjectId
            ? loaded.find((e) => e.id === current.id)
            : undefined;
        const next = requested ?? preserved ?? loaded[0];
        if (pendingEnvironmentRef.current?.projectId === activeProjectId) {
          pendingEnvironmentRef.current = null;
        }

        activeEnvironmentRef.current = next;
        setEnvironments(loaded);
        setActiveEnvironment(next);
      })
      .catch((error) => {
        if (cancelled || activeProjectIdRef.current !== activeProjectId) return;
        console.error(error);
        setEnvironmentError(true);
      })
      .finally(() => {
        if (cancelled || activeProjectIdRef.current !== activeProjectId) return;
        setIsLoadingEnvironments(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, activeProjectId, reloadTick]);

  const selectProject = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project || project.id === activeProjectIdRef.current) return;
      refreshGenerationRef.current += 1;
      activeProjectIdRef.current = project.id;
      activeEnvironmentRef.current = undefined;
      setEnvironments([]);
      setActiveEnvironment(undefined);
      setEnvironmentError(false);
      setIsLoadingEnvironments(true);
      setActiveProject(project);
    },
    [projects]
  );

  const selectEnvironment = useCallback(
    (environmentId: string) => {
      const environment = environments.find((e) => e.id === environmentId);
      if (!environment) return;
      activeEnvironmentRef.current = environment;
      setActiveEnvironment(environment);
    },
    [environments]
  );

  const selectEnvironmentByName = useCallback(
    (name: string) => {
      const environment = environments.find((e) => e.name === name);
      if (!environment) return;
      activeEnvironmentRef.current = environment;
      setActiveEnvironment(environment);
    },
    [environments]
  );

  const selectProjectEnvironmentByName = useCallback(
    (projectId: string, name: string) => {
      pendingEnvironmentRef.current = { projectId, name };
      if (activeProjectIdRef.current === projectId) {
        const environment = environments.find((candidate) => candidate.name === name);
        if (environment) {
          activeEnvironmentRef.current = environment;
          setActiveEnvironment(environment);
          pendingEnvironmentRef.current = null;
        }
        return;
      }
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) return;
      refreshGenerationRef.current += 1;
      activeProjectIdRef.current = project.id;
      activeEnvironmentRef.current = undefined;
      setEnvironments([]);
      setActiveEnvironment(undefined);
      setEnvironmentError(false);
      setIsLoadingEnvironments(true);
      setActiveProject(project);
    },
    [environments, projects],
  );

  const reload = useCallback(() => { refreshGenerationRef.current += 1; setReloadTick((t) => t + 1); }, []);

  const refreshInBackground = useCallback(async () => {
    const generation = ++refreshGenerationRef.current;
    const projectId = activeProjectIdRef.current;
    const isCurrent = () => generation === refreshGenerationRef.current && projectId === activeProjectIdRef.current;
    try {
      // Commit metadata together so a partial failure leaves the usable scope intact.
      const [projectList, environmentList] = await Promise.all([
        client.listProjects(),
        projectId ? client.listEnvironments(projectId) : Promise.resolve({ environments: [] as Environment[] }),
      ]);
      if (!isCurrent()) return;
      const nextProject = projectList.projects.find((project) => project.id === projectId) ?? projectList.projects[0];
      setProjects(projectList.projects);
      setProjectError(false);
      setActiveProject(nextProject);
      if (nextProject?.id !== projectId) {
        activeProjectIdRef.current = nextProject?.id;
        activeEnvironmentRef.current = undefined;
        setEnvironments([]);
        setActiveEnvironment(undefined);
        setEnvironmentError(false);
        setIsLoadingEnvironments(!!nextProject);
        return;
      }
      const loaded = environmentList.environments;
      const requested = pendingEnvironmentRef.current?.projectId === projectId
        ? loaded.find((environment) => environment.name === pendingEnvironmentRef.current?.name)
        : undefined;
      const nextEnvironment = requested ?? loaded.find((environment) => environment.id === activeEnvironmentRef.current?.id) ?? loaded[0];
      if (pendingEnvironmentRef.current?.projectId === projectId) pendingEnvironmentRef.current = null;
      activeEnvironmentRef.current = nextEnvironment;
      setEnvironments(loaded);
      setActiveEnvironment(nextEnvironment);
      setEnvironmentError(false);
    } catch (error) {
      if (isCurrent()) throw error;
    }
  }, [client]);

  const isLoading = isLoadingProjects || isLoadingEnvironments;

  return {
    projects,
    environments,
    activeProject,
    activeEnvironment,
    isLoading,
    projectError,
    environmentError,
    selectProject,
    selectEnvironment,
    selectEnvironmentByName,
    selectProjectEnvironmentByName,
    reload,
    refreshInBackground,
  };
}
