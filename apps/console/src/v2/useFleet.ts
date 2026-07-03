import { useEffect, useMemo, useRef, useState } from "react";
import type { FleetProject, FleetResponse, FleetRollup } from "../api/client";
import type { Project } from "../api/types";

export type UseFleetResult = {
  projects: FleetProject[];
  rollup: FleetRollup;
  status: "ok" | "fallback";
  lastUpdated: number;
};

type UseFleetOptions = {
  fetchFleet: () => Promise<FleetResponse>;
  seedProjects: Project[];
};

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

export function useFleet({ fetchFleet, seedProjects }: UseFleetOptions): UseFleetResult {
  const fallbackProjects = useMemo(() => buildFallbackProjects(seedProjects), [seedProjects]);
  const fallbackRollup = useMemo(() => buildFallbackRollup(fallbackProjects), [fallbackProjects]);
  const fallbackRef = useRef({ projects: fallbackProjects, rollup: fallbackRollup });

  const [result, setResult] = useState<UseFleetResult>(() => ({
    projects: fallbackProjects,
    rollup: fallbackRollup,
    status: "fallback",
    lastUpdated: 0
  }));

  // Keep a stable ref of lastUpdated for the interval
  const lastUpdatedRef = useRef(0);

  useEffect(() => {
    fallbackRef.current = { projects: fallbackProjects, rollup: fallbackRollup };
    setResult((prev) => {
      if (prev.status !== "fallback") return prev;
      if (prev.projects === fallbackProjects && prev.rollup === fallbackRollup) return prev;
      return { ...prev, projects: fallbackProjects, rollup: fallbackRollup };
    });
  }, [fallbackProjects, fallbackRollup]);

  // Fetch on mount
  useEffect(() => {
    let cancelled = false;

    fetchFleet()
      .then((response) => {
        if (cancelled) return;
        setResult((prev) => ({
          projects: response.data.projects,
          rollup: response.data.rollup,
          status: "ok",
          lastUpdated: prev.lastUpdated
        }));
      })
      .catch(() => {
        if (cancelled) return;
        // Already in fallback state from initial — no change needed for status,
        // but update projects from the latest seed in case seedProjects changed
        const fallback = fallbackRef.current;
        setResult((prev) => ({
          ...prev,
          projects: fallback.projects,
          rollup: fallback.rollup,
          status: "fallback"
        }));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchFleet]);

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

  return result;
}
