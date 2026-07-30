import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FleetProject,
  FleetProjectEnvironment,
  FleetProjectEnvironmentsResponse,
  FleetResponse,
  FleetRollup
} from "../api/client";
import type { Project } from "../api/types";

export type UseFleetResult = {
  projects: FleetProject[];
  rollup: FleetRollup;
  status: "ok" | "fallback";
  lastUpdated: number;
  refreshFleet: () => Promise<void>;
  environments: Record<string, FleetEnvironmentState>;
  loadProjectEnvironments: (projectId: string) => Promise<void>;
  invalidateProjectEnvironments: (projectId?: string) => void;
  refreshProjectEnvironments: (projectId: string) => Promise<void>;
};

export type FleetEnvironmentState = {
  status: "loading" | "ready" | "error";
  data: FleetProjectEnvironment[];
};

type UseFleetOptions = {
  fetchFleet: () => Promise<FleetResponse>;
  fetchProjectEnvironments?: (
    projectId: string,
    options?: { window?: "24h" | "7d" | "30d" }
  ) => Promise<FleetProjectEnvironmentsResponse>;
  seedProjects: Project[];
};

type FleetCoreResult = Omit<
  UseFleetResult,
  "environments" | "loadProjectEnvironments" | "invalidateProjectEnvironments" | "refreshProjectEnvironments" | "refreshFleet"
>;

function buildFallbackProjects(seeds: Project[]): FleetProject[] {
  return seeds.map((p) => ({
    id: p.id,
    name: p.name,
    status: "idle" as const,
    incidents: 0,
    alerts: 0,
    errorRatePercent: null,
    errorRateDelta: null,
    errorTrend: [],
    events: 0,
    activeUsers: 0,
    activeTenants: 0,
    llmCostUsd: "0.00",
    llmCostDeltaUsd: null,
    p95TraceDurationMs: null,
    p95DeltaMs: null,
    infra: {
      api: "ok" as const,
      db: "ok" as const,
      redis: "ok" as const,
      queue: "ok" as const
    },
    topIncident: null
  }));
}

function buildFallbackRollup(projects: FleetProject[]): FleetRollup {
  return {
    counts: { ok: 0, warning: 0, critical: 0 },
    incidents: 0,
    alerts: 0,
    llmCostUsd: "0.00",
    overall: "ok",
    total: projects.length
  };
}

export function useFleet({ fetchFleet, fetchProjectEnvironments, seedProjects }: UseFleetOptions): UseFleetResult {
  const fallbackProjects = useMemo(() => buildFallbackProjects(seedProjects), [seedProjects]);
  const fallbackRollup = useMemo(() => buildFallbackRollup(fallbackProjects), [fallbackProjects]);
  const fallbackRef = useRef({ projects: fallbackProjects, rollup: fallbackRollup });

  const [result, setResult] = useState<FleetCoreResult>(() => ({
    projects: fallbackProjects,
    rollup: fallbackRollup,
    status: "fallback",
    lastUpdated: 0
  }));

  // Keep a stable ref of lastUpdated for the interval
  const lastUpdatedRef = useRef(0);
  const fleetGeneration = useRef(0);
  const fleetInFlight = useRef<Promise<void> | null>(null);
  const [environments, setEnvironments] = useState<Record<string, FleetEnvironmentState>>({});
  const environmentsRef = useRef<Record<string, FleetEnvironmentState>>({});
  const environmentGeneration = useRef(new Map<string, number>());
  const validProjectIds = useRef(new Set(seedProjects.map((project) => project.id)));

  useEffect(() => {
    const valid = new Set(seedProjects.map((project) => project.id));
    validProjectIds.current = valid;
    const cachedProjectIds = Object.keys(environmentsRef.current);
    if (cachedProjectIds.some((projectId) => !valid.has(projectId))) {
      const nextEnvironments = Object.fromEntries(
        Object.entries(environmentsRef.current).filter(([projectId]) => valid.has(projectId))
      );
      environmentsRef.current = nextEnvironments;
      setEnvironments(nextEnvironments);
    }
    for (const projectId of environmentGeneration.current.keys()) {
      if (!valid.has(projectId)) {
        environmentGeneration.current.set(projectId, (environmentGeneration.current.get(projectId) ?? 0) + 1);
      }
    }
  }, [seedProjects]);

  const requestProjectEnvironments = useCallback(async (projectId: string, force: boolean) => {
    if (!fetchProjectEnvironments || !validProjectIds.current.has(projectId)) return;
    const existing = environmentsRef.current[projectId];
    if (existing?.status === "loading" || (!force && existing?.status === "ready")) return;
    environmentsRef.current = {
      ...environmentsRef.current,
      [projectId]: { status: "loading", data: existing?.data ?? [] }
    };
    setEnvironments(environmentsRef.current);

    const generation = (environmentGeneration.current.get(projectId) ?? 0) + 1;
    environmentGeneration.current.set(projectId, generation);
    try {
      const response = await fetchProjectEnvironments(projectId, { window: "24h" });
      if (
        environmentGeneration.current.get(projectId) !== generation ||
        !validProjectIds.current.has(projectId)
      ) return;
      environmentsRef.current = {
        ...environmentsRef.current,
        [projectId]: { status: "ready", data: response.data.envs }
      };
      setEnvironments(environmentsRef.current);
    } catch {
      if (
        environmentGeneration.current.get(projectId) !== generation ||
        !validProjectIds.current.has(projectId)
      ) return;
      environmentsRef.current = {
        ...environmentsRef.current,
        [projectId]: { status: "error", data: [] }
      };
      setEnvironments(environmentsRef.current);
    }
  }, [fetchProjectEnvironments]);

  const loadProjectEnvironments = useCallback(
    (projectId: string) => requestProjectEnvironments(projectId, false),
    [requestProjectEnvironments],
  );

  const invalidateProjectEnvironments = useCallback((projectId?: string) => {
    const ids = projectId ? [projectId] : Object.keys(environmentsRef.current);
    const next = { ...environmentsRef.current };
    for (const id of ids) {
      environmentGeneration.current.set(id, (environmentGeneration.current.get(id) ?? 0) + 1);
      delete next[id];
    }
    environmentsRef.current = next;
    setEnvironments(next);
  }, []);

  const refreshProjectEnvironments = useCallback(
    (projectId: string) => requestProjectEnvironments(projectId, true),
    [requestProjectEnvironments],
  );

  useEffect(() => {
    fallbackRef.current = { projects: fallbackProjects, rollup: fallbackRollup };
    setResult((prev) => {
      if (prev.status !== "fallback") return prev;
      if (prev.projects === fallbackProjects && prev.rollup === fallbackRollup) return prev;
      const sameProjects = prev.projects.length === fallbackProjects.length && prev.projects.every(
        (project, index) => project.id === fallbackProjects[index]?.id && project.name === fallbackProjects[index]?.name
      );
      if (sameProjects) return prev;
      return { ...prev, projects: fallbackProjects, rollup: fallbackRollup };
    });
  }, [fallbackProjects, fallbackRollup]);

  const refreshFleet = useCallback(() => {
    if (fleetInFlight.current) return fleetInFlight.current;
    const generation = ++fleetGeneration.current;
    const request = fetchFleet()
      .then((response) => {
        if (generation !== fleetGeneration.current) return;
        setResult((previous) => {
          if (
            previous.status === "ok" &&
            previous.projects === response.data.projects &&
            previous.rollup === response.data.rollup
          ) return previous;
          lastUpdatedRef.current = 0;
          return {
            projects: response.data.projects,
            rollup: response.data.rollup,
            status: "ok",
            lastUpdated: 0
          };
        });
      })
      .catch(() => {
        if (generation !== fleetGeneration.current) return;
        // Already in fallback state from initial — no change needed for status,
        // but update projects from the latest seed in case seedProjects changed
        const fallback = fallbackRef.current;
        setResult((previous) => {
          const sameProjects = previous.projects.length === fallback.projects.length && previous.projects.every(
            (project, index) => project.id === fallback.projects[index]?.id && project.name === fallback.projects[index]?.name
          );
          if (previous.status === "fallback" && sameProjects) return previous;
          lastUpdatedRef.current = 0;
          return {
            projects: fallback.projects,
            rollup: fallback.rollup,
            status: "fallback",
            lastUpdated: 0
          };
        });
      })
      .finally(() => {
        if (fleetInFlight.current === request) fleetInFlight.current = null;
      });
    fleetInFlight.current = request;
    return request;
  }, [fetchFleet]);

  // Fetch on mount and invalidate obsolete responses when the dependency changes.
  useEffect(() => {
    void refreshFleet();

    return () => {
      fleetGeneration.current += 1;
      fleetInFlight.current = null;
    };
  }, [refreshFleet]);

  // Tick lastUpdated each second
  useEffect(() => {
    // eslint-disable-next-line prefer-const
    let id: ReturnType<typeof setInterval>;
    id = setInterval(() => {
      lastUpdatedRef.current += 1;
      setResult((prev) => ({ ...prev, lastUpdated: lastUpdatedRef.current }));
    }, 1000);

    return () => {
      // Guard for environments where clearInterval may not be available during cleanup
      if (typeof clearInterval === "function") {
        clearInterval(id);
      }
    };
  }, []);

  return {
    ...result,
    refreshFleet,
    environments,
    loadProjectEnvironments,
    invalidateProjectEnvironments,
    refreshProjectEnvironments,
  };
}
