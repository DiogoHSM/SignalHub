import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { Environment, Project } from "../api/types";

export type UseConsoleProjectsResult = {
  projects: Project[];
  environments: Environment[];
  activeProject: Project | undefined;
  activeEnvironment: Environment | undefined;
  isLoading: boolean;
  selectProject: (projectId: string) => void;
  selectEnvironment: (name: string) => void;
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
  const [isLoading, setIsLoading] = useState(true);

  // Refs to safely read current values inside async callbacks without stale closures
  const activeProjectIdRef = useRef<string | undefined>(undefined);
  const activeEnvironmentRef = useRef<Environment | undefined>(undefined);
  const environmentsRef = useRef<Environment[]>([]);

  // Keep refs in sync with state
  useEffect(() => {
    activeProjectIdRef.current = activeProject?.id;
  }, [activeProject?.id]);

  useEffect(() => {
    activeEnvironmentRef.current = activeEnvironment;
  }, [activeEnvironment]);

  useEffect(() => {
    environmentsRef.current = environments;
  }, [environments]);

  // Load projects on mount
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    void client
      .listProjects()
      .then(({ projects: loaded }) => {
        if (cancelled) return;
        setProjects(loaded);
        setActiveProject((current) => {
          const next = current ?? loaded[0];
          activeProjectIdRef.current = next?.id;
          return next;
        });
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  // Load environments whenever the active project changes
  useEffect(() => {
    let cancelled = false;

    if (!activeProject) {
      environmentsRef.current = [];
      activeEnvironmentRef.current = undefined;
      setEnvironments([]);
      setActiveEnvironment(undefined);
      return () => {
        cancelled = true;
      };
    }

    environmentsRef.current = [];
    activeEnvironmentRef.current = undefined;
    setEnvironments([]);
    setActiveEnvironment(undefined);

    void client
      .listEnvironments(activeProject.id)
      .then(({ environments: loaded }) => {
        if (cancelled || activeProjectIdRef.current !== activeProject.id) return;

        const fetchedIds = new Set(loaded.map((e) => e.id));
        const localEnvironments = environmentsRef.current.filter(
          (e) => e.projectId === activeProject.id && !fetchedIds.has(e.id)
        );
        const merged = [...loaded, ...localEnvironments];

        const current = activeEnvironmentRef.current;
        const preserved =
          current?.projectId === activeProject.id
            ? merged.find((e) => e.id === current.id)
            : undefined;
        const next = preserved ?? merged[0];

        environmentsRef.current = merged;
        activeEnvironmentRef.current = next;
        setEnvironments(merged);
        setActiveEnvironment(next);
      });

    return () => {
      cancelled = true;
    };
  }, [client, activeProject]);

  const selectProject = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;
      activeProjectIdRef.current = project.id;
      setActiveProject(project);
    },
    [projects]
  );

  const selectEnvironment = useCallback(
    (name: string) => {
      const environment = environments.find((e) => e.name === name);
      if (!environment) return;
      activeEnvironmentRef.current = environment;
      setActiveEnvironment(environment);
    },
    [environments]
  );

  return {
    projects,
    environments,
    activeProject,
    activeEnvironment,
    isLoading,
    selectProject,
    selectEnvironment
  };
}
