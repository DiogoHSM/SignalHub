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
    };
  }, [client, reloadTick]);

  // Load environments whenever the active project changes
  useEffect(() => {
    let cancelled = false;

    if (!activeProject) {
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
      .listEnvironments(activeProject.id)
      .then(({ environments: loaded }) => {
        if (cancelled || activeProjectIdRef.current !== activeProject.id) return;

        const current = activeEnvironmentRef.current;
        const requested = pendingEnvironmentRef.current?.projectId === activeProject.id
          ? loaded.find((environment) => environment.name === pendingEnvironmentRef.current?.name)
          : undefined;
        const preserved =
          current?.projectId === activeProject.id
            ? loaded.find((e) => e.id === current.id)
            : undefined;
        const next = requested ?? preserved ?? loaded[0];
        if (pendingEnvironmentRef.current?.projectId === activeProject.id) {
          pendingEnvironmentRef.current = null;
        }

        activeEnvironmentRef.current = next;
        setEnvironments(loaded);
        setActiveEnvironment(next);
      })
      .catch((error) => {
        if (cancelled || activeProjectIdRef.current !== activeProject.id) return;
        console.error(error);
        setEnvironmentError(true);
      })
      .finally(() => {
        if (cancelled || activeProjectIdRef.current !== activeProject.id) return;
        setIsLoadingEnvironments(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, activeProject, reloadTick]);

  const selectProject = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project || project.id === activeProjectIdRef.current) return;
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

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

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
  };
}
