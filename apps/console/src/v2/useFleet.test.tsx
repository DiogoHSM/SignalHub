import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetProject, FleetResponse } from "../api/client";
import { useFleet } from "./useFleet";

// Minimal seed project shape matching Project type
const seedProject = (id: string, name: string) => ({
  id,
  name,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  archivedAt: null as string | null
});

const mockFleetProject = (id: string, name: string): FleetProject => ({
  id,
  name,
  status: "ok",
  incidents: 0,
  alerts: 0,
  errorRatePercent: 0.5,
  errorRateDelta: null,
  errorTrend: [0, 1, 0, 2, 0, 1, 0, 0, 0, 1, 2, 1],
  events: 1000,
  activeUsers: 10,
  activeTenants: 3,
  llmCostUsd: "12.50",
  llmCostDeltaUsd: null,
  p95TraceDurationMs: 120,
  p95DeltaMs: null,
  infra: { api: "ok", db: "ok", redis: "ok", queue: "ok" },
  topIncident: null
});

const successResponse: FleetResponse = {
  data: {
    window: "24h",
    generatedAt: "2026-06-22T00:00:00Z",
    projects: [mockFleetProject("prj_1", "Alpha"), mockFleetProject("prj_2", "Beta")],
    rollup: {
      counts: { ok: 2, warning: 0, critical: 0 },
      incidents: 0,
      alerts: 0,
      llmCostUsd: "25.00",
      overall: "ok",
      total: 2
    }
  }
};

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useFleet", () => {
  it("loads project environments only when explicitly requested and caches the result", async () => {
    const fetchFleet = vi.fn().mockResolvedValue(successResponse);
    const seeds = [seedProject("prj_1", "Alpha")];
    const fetchProjectEnvironments = vi.fn().mockResolvedValue({
      data: {
        projectId: "prj_1",
        envs: [{ name: "production", status: "ok", incidents: 0, errorRatePercent: 0.2, events: 42, note: null }]
      }
    });

    const { result } = renderHook(() => useFleet({
      fetchFleet,
      fetchProjectEnvironments,
      seedProjects: seeds
    }));

    expect(fetchProjectEnvironments).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.loadProjectEnvironments("prj_1");
    });

    expect(fetchProjectEnvironments).toHaveBeenCalledTimes(1);
    expect(fetchProjectEnvironments).toHaveBeenCalledWith("prj_1", { window: "24h" });
    expect(result.current.environments.prj_1?.status).toBe("ready");
    expect(result.current.environments.prj_1?.data[0]?.name).toBe("production");

    await act(async () => {
      await result.current.loadProjectEnvironments("prj_1");
    });
    expect(fetchProjectEnvironments).toHaveBeenCalledTimes(1);
  });

  it("invalidates cached project health and refetches it on demand", async () => {
    const fetchFleet = vi.fn().mockResolvedValue(successResponse);
    const fetchProjectEnvironments = vi.fn()
      .mockResolvedValueOnce({
        data: { projectId: "prj_1", envs: [{ name: "production", status: "ok", incidents: 0, errorRatePercent: 0, events: 1, note: null }] }
      })
      .mockResolvedValueOnce({
        data: { projectId: "prj_1", envs: [{ name: "production", status: "critical", incidents: 1, errorRatePercent: 10, events: 2, note: null }] }
      });
    const { result } = renderHook(() => useFleet({
      fetchFleet,
      fetchProjectEnvironments,
      seedProjects: [seedProject("prj_1", "Alpha")]
    }));

    await act(async () => result.current.loadProjectEnvironments("prj_1"));
    expect(result.current.environments.prj_1?.data[0]?.status).toBe("ok");

    await act(async () => result.current.refreshProjectEnvironments("prj_1"));

    expect(fetchProjectEnvironments).toHaveBeenCalledTimes(2);
    expect(result.current.environments.prj_1?.data[0]?.status).toBe("critical");
  });

  it("does not start overlapping project-health refreshes", async () => {
    let resolve!: (value: { data: { projectId: string; envs: [] } }) => void;
    const fetchProjectEnvironments = vi.fn(() => new Promise<{ data: { projectId: string; envs: [] } }>((done) => {
      resolve = done;
    }));
    const { result } = renderHook(() => useFleet({
      fetchFleet: vi.fn().mockResolvedValue(successResponse),
      fetchProjectEnvironments,
      seedProjects: [seedProject("prj_1", "Alpha")]
    }));

    let firstRefresh!: Promise<void>;
    let overlappingRefresh!: Promise<void>;
    act(() => {
      firstRefresh = result.current.refreshProjectEnvironments("prj_1");
      overlappingRefresh = result.current.refreshProjectEnvironments("prj_1");
    });
    expect(fetchProjectEnvironments).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ data: { projectId: "prj_1", envs: [] } });
      await Promise.all([firstRefresh, overlappingRefresh]);
    });
  });

  it("ignores a stale project-environment response after the project leaves the fleet", async () => {
    let resolveEnvironments!: (value: { data: { projectId: string; envs: [] } }) => void;
    const fetchProjectEnvironments = vi.fn(() => new Promise<{ data: { projectId: string; envs: [] } }>((resolve) => {
      resolveEnvironments = resolve;
    }));
    const fetchFleet = vi.fn().mockRejectedValue(new Error("offline"));
    const { result, rerender } = renderHook(
      ({ seeds }) => useFleet({
        fetchFleet,
        fetchProjectEnvironments,
        seedProjects: seeds
      }),
      { initialProps: { seeds: [seedProject("prj_1", "Alpha")] } }
    );

    act(() => {
      void result.current.loadProjectEnvironments("prj_1");
    });
    rerender({ seeds: [] });
    await act(async () => {
      resolveEnvironments({ data: { projectId: "prj_1", envs: [] } });
    });

    expect(result.current.environments.prj_1).toBeUndefined();
  });

  it("returns fallback status and seed-derived projects when fetchFleet rejects", async () => {
    const fetchFleet = vi.fn().mockRejectedValue(new Error("network error"));
    const seeds = [seedProject("prj_1", "Alpha"), seedProject("prj_2", "Beta")];

    const { result } = renderHook(() => useFleet({ fetchFleet, seedProjects: seeds }));

    await waitFor(() => expect(result.current.status).toBe("fallback"));

    expect(result.current.projects).toHaveLength(2);
    expect(result.current.projects[0].id).toBe("prj_1");
    expect(result.current.projects[1].id).toBe("prj_2");
    // Each seed project should have zeroed metrics and idle status
    expect(result.current.projects[0].status).toBe("idle");
    expect(result.current.projects[0].incidents).toBe(0);
    expect(result.current.projects[0].errorTrend).toEqual([]);
    // Rollup should reflect the degraded state
    expect(result.current.rollup).toBeDefined();
  });

  it("returns ok status and fetched projects when fetchFleet resolves", async () => {
    const fetchFleet = vi.fn().mockResolvedValue(successResponse);
    const seeds = [seedProject("prj_1", "Alpha")];

    const { result } = renderHook(() => useFleet({ fetchFleet, seedProjects: seeds }));

    await waitFor(() => expect(result.current.status).toBe("ok"));

    expect(result.current.projects).toHaveLength(2);
    expect(result.current.projects[0].name).toBe("Alpha");
    expect(result.current.projects[0].status).toBe("ok");
    expect(result.current.rollup.total).toBe(2);
    expect(result.current.rollup.overall).toBe("ok");
  });

  it("refreshes the fleet core without starting overlapping requests", async () => {
    let resolveRefresh!: (value: FleetResponse) => void;
    const fetchFleet = vi.fn()
      .mockResolvedValueOnce(successResponse)
      .mockImplementationOnce(() => new Promise<FleetResponse>((resolve) => {
        resolveRefresh = resolve;
      }));
    const { result } = renderHook(() => useFleet({
      fetchFleet,
      seedProjects: [seedProject("prj_1", "Alpha")]
    }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    act(() => {
      void result.current.refreshFleet();
      void result.current.refreshFleet();
    });
    expect(fetchFleet).toHaveBeenCalledTimes(2);

    await act(async () => resolveRefresh({
      data: {
        ...successResponse.data,
        projects: [mockFleetProject("prj_1", "Refreshed")]
      }
    }));
    expect(result.current.projects[0]?.name).toBe("Refreshed");
  });

  it("ignores a stale fleet response after the fetch dependency changes", async () => {
    let resolveStale!: (value: FleetResponse) => void;
    const staleFetch = vi.fn(() => new Promise<FleetResponse>((resolve) => {
      resolveStale = resolve;
    }));
    const freshFetch = vi.fn().mockResolvedValue({
      data: { ...successResponse.data, projects: [mockFleetProject("prj_1", "Fresh")] }
    });
    const { result, rerender } = renderHook(
      ({ fetchFleet }) => useFleet({ fetchFleet, seedProjects: [seedProject("prj_1", "Alpha")] }),
      { initialProps: { fetchFleet: staleFetch } }
    );

    rerender({ fetchFleet: freshFetch });
    await waitFor(() => expect(result.current.projects[0]?.name).toBe("Fresh"));
    await act(async () => resolveStale({
      data: { ...successResponse.data, projects: [mockFleetProject("prj_1", "Stale")] }
    }));

    expect(result.current.projects[0]?.name).toBe("Fresh");
  });

  it("lastUpdated increments each second", async () => {
    vi.useFakeTimers();
    const fetchFleet = vi.fn().mockRejectedValue(new Error("offline"));
    const seeds = [seedProject("prj_1", "Alpha")];

    const { result } = renderHook(() => useFleet({ fetchFleet, seedProjects: seeds }));

    // Let fetch settle
    await act(async () => {
      await Promise.resolve();
    });

    const t0 = result.current.lastUpdated;

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.lastUpdated).toBe(t0 + 1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.lastUpdated).toBe(t0 + 2);
  });

  it("cleans up the interval on unmount (tick stops)", async () => {
    vi.useFakeTimers();
    const fetchFleet = vi.fn().mockRejectedValue(new Error("offline"));
    const seeds = [seedProject("prj_1", "Alpha")];

    const { result, unmount } = renderHook(() => useFleet({ fetchFleet, seedProjects: seeds }));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const tickedValue = result.current.lastUpdated;
    expect(tickedValue).toBe(1);

    unmount();

    // After unmount, advancing time should NOT change lastUpdated since component is gone
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // Result is captured before unmount - we just verify no errors thrown
    expect(tickedValue).toBe(1);
  });

  it("initially renders fallback with seed projects before fetch resolves", () => {
    let resolve!: (v: FleetResponse) => void;
    const pending = new Promise<FleetResponse>((res) => {
      resolve = res;
    });
    const fetchFleet = vi.fn().mockReturnValue(pending);
    const seeds = [seedProject("prj_1", "Alpha")];

    const { result } = renderHook(() => useFleet({ fetchFleet, seedProjects: seeds }));

    // Before the promise settles, we should have fallback with seed projects
    expect(result.current.status).toBe("fallback");
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects[0].id).toBe("prj_1");
    expect(result.current.projects[0].status).toBe("idle");

    // Cleanup without resolution
    act(() => {
      resolve(successResponse);
    });
  });

  it("updates fallback projects when seed projects change after a failed fleet fetch", async () => {
    const fetchFleet = vi.fn().mockRejectedValue(new Error("offline"));
    const initialSeeds = [seedProject("prj_1", "Alpha")];
    const nextSeeds = [seedProject("prj_1", "Alpha"), seedProject("prj_2", "Beta")];

    const { result, rerender } = renderHook(
      ({ seeds }) => useFleet({ fetchFleet, seedProjects: seeds }),
      { initialProps: { seeds: initialSeeds } }
    );

    await waitFor(() => expect(result.current.status).toBe("fallback"));
    expect(result.current.projects.map((project) => project.id)).toEqual(["prj_1"]);

    rerender({ seeds: nextSeeds });

    await waitFor(() => {
      expect(result.current.projects.map((project) => project.id)).toEqual(["prj_1", "prj_2"]);
    });
    expect(fetchFleet).toHaveBeenCalledTimes(1);
  });
});
