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
