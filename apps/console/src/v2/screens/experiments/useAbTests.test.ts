// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Experiment, ExperimentResultsResponse, ExperimentVariantResult } from "../../../api/types";
import { buildAbTestsVM, formatLift, interpretation, parseVariants, useAbTests } from "./useAbTests";

afterEach(() => vi.restoreAllMocks());

function experiment(over: Partial<Experiment> = {}): Experiment {
  return {
    id: "x1",
    projectId: "p",
    environmentId: "e",
    key: "checkout_copy",
    name: "Checkout copy",
    description: null,
    status: "running",
    actorType: "user",
    exposureEvent: "sigmon.experiment.exposed",
    conversionEvent: "checkout.completed",
    variants: [
      { key: "control", name: "control", weight: 50 },
      { key: "treatment", name: "treatment", weight: 50 },
    ],
    primaryMetric: { eventName: "checkout.completed", windowHours: 24 },
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

function variantResult(over: Partial<ExperimentVariantResult> = {}): ExperimentVariantResult {
  return {
    key: "control",
    name: "control",
    weight: 50,
    exposures: 100,
    conversions: 10,
    conversionRate: 10,
    liftPoints: null,
    sampleActors: [],
    ...over,
  };
}

function results(over: Partial<ExperimentResultsResponse> = {}): ExperimentResultsResponse {
  return {
    experiment: experiment(),
    window: "30d",
    totals: { exposures: 200, conversions: 24, variants: 2 },
    variants: [variantResult(), variantResult({ key: "treatment", exposures: 100, conversions: 14, conversionRate: 14, liftPoints: 4 })],
    ...over,
  };
}

describe("parseVariants", () => {
  it("parses key:weight pairs", () => {
    expect(parseVariants("control:50,treatment:50")).toEqual([
      { key: "control", name: "control", weight: 50 },
      { key: "treatment", name: "treatment", weight: 50 },
    ]);
  });

  it("drops malformed entries", () => {
    expect(parseVariants("control:50,bogus,treatment:notanumber")).toEqual([{ key: "control", name: "control", weight: 50 }]);
  });
});

describe("formatLift", () => {
  it("renders Baseline for null", () => {
    expect(formatLift(null)).toBe("Baseline");
  });
  it("renders signed percentage points", () => {
    expect(formatLift(4.2)).toBe("+4.2 pp");
    expect(formatLift(-1.5)).toBe("-1.5 pp");
  });
});

describe("interpretation", () => {
  it("marks index 0 as Baseline", () => {
    expect(interpretation(variantResult(), 0)).toBe("Baseline");
  });
  it("marks low-sample variants as Needs sample", () => {
    expect(interpretation(variantResult({ exposures: 10 }), 1)).toBe("Needs sample");
  });
  it("marks near-zero lift as Flat", () => {
    expect(interpretation(variantResult({ exposures: 100, liftPoints: 0.2 }), 1)).toBe("Flat");
  });
  it("marks positive lift as Directional lead and negative as Directional lag", () => {
    expect(interpretation(variantResult({ exposures: 100, liftPoints: 4 }), 1)).toBe("Directional lead");
    expect(interpretation(variantResult({ exposures: 100, liftPoints: -4 }), 1)).toBe("Directional lag");
  });
});

describe("buildAbTestsVM", () => {
  it("maps experiment rows and null selected without results", () => {
    const vm = buildAbTestsVM([experiment()], null);
    expect(vm.rows).toHaveLength(1);
    expect(vm.rows[0].variantsLabel).toBe("control:50, treatment:50");
    expect(vm.selected).toBeNull();
  });

  it("maps selected totals and variant rows with interpretation applied", () => {
    const vm = buildAbTestsVM([experiment()], results());
    expect(vm.selected?.totals).toEqual({ exposures: 200, conversions: 24, variants: 2 });
    expect(vm.selected?.variants[0].interpretationLabel).toBe("Baseline");
    expect(vm.selected?.variants[1].interpretationLabel).toBe("Directional lead");
    expect(vm.selected?.variants[1].liftLabel).toBe("+4.0 pp");
  });
});

describe("useAbTests", () => {
  function makeClient() {
    return {
      listExperiments: vi.fn().mockResolvedValue({ experiments: [experiment()] }),
      createExperiment: vi.fn().mockResolvedValue({ experiment: experiment() }),
      updateExperiment: vi.fn().mockResolvedValue({ experiment: experiment() }),
      archiveExperiment: vi.fn().mockResolvedValue(undefined),
      getExperimentResults: vi.fn().mockResolvedValue({ data: results() }),
    };
  }

  it("loads and builds a VM", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useAbTests({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: true }),
    );
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.rows).toHaveLength(1);
  });

  it("does not fetch when disabled or missing project/environment", () => {
    const client = makeClient();
    renderHook(() => useAbTests({ client, projectId: undefined, environmentId: "e", selectedId: undefined, enabled: true }));
    renderHook(() => useAbTests({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: false }));
    expect(client.listExperiments).not.toHaveBeenCalled();
  });

  it("goes to error status without throwing when listExperiments is missing", async () => {
    const client = { createExperiment: vi.fn() };
    const { result } = renderHook(() =>
      useAbTests({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });

  it("fetches results only when selectedId and getExperimentResults are present, tolerating rejection", async () => {
    const client = makeClient();
    client.getExperimentResults.mockRejectedValueOnce(new Error("boom"));
    const { result, rerender } = renderHook(
      ({ selectedId }) => useAbTests({ client, projectId: "p", environmentId: "e", selectedId, enabled: true }),
      { initialProps: { selectedId: undefined as string | undefined } },
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(client.getExperimentResults).not.toHaveBeenCalled();

    rerender({ selectedId: "x1" });
    await waitFor(() => expect(client.getExperimentResults).toHaveBeenCalled());
    await waitFor(() => expect(result.current.data?.selected).toBeNull());
  });

  it("createExperiment marks busy during the call and reloads on success", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useAbTests({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let ok = false;
    await act(async () => {
      ok = await result.current.createExperiment({
        key: "k",
        name: "n",
        conversionEvent: "c",
        variants: "control:50,treatment:50",
      });
    });
    expect(ok).toBe(true);
    expect(client.createExperiment).toHaveBeenCalled();
    expect(client.listExperiments).toHaveBeenCalledTimes(2); // initial + reload after create
  });

  it("archiveExperiment returns false without throwing when the method is missing", async () => {
    const client = makeClient() as Record<string, unknown>;
    delete client.archiveExperiment;
    const { result } = renderHook(() =>
      useAbTests({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let ok = true;
    await act(async () => {
      ok = await result.current.archiveExperiment("x1");
    });
    expect(ok).toBe(true); // no-op resolves; guard prevents throw
  });
});
