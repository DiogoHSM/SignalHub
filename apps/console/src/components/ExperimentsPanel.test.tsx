import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { Experiment, ExperimentResultsResponse } from "../api/types";
import { ExperimentsPanel } from "./ExperimentsPanel";

const experiment: Experiment = {
  id: "exp_1",
  projectId: "prj_1",
  environmentId: "env_1",
  key: "checkout_copy",
  name: "Checkout copy",
  description: null,
  status: "running",
  actorType: "user",
  exposureEvent: "sigmon.experiment.exposed",
  conversionEvent: "checkout.completed",
  variants: [
    { key: "control", name: "Control", weight: 50 },
    { key: "treatment", name: "Treatment", weight: 50 }
  ],
  primaryMetric: { eventName: "checkout.completed", windowHours: 24 },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null
};

const results: ExperimentResultsResponse = {
  experiment,
  window: "30d",
  totals: { exposures: 4, conversions: 3, variants: 2 },
  variants: [
    { key: "control", name: "Control", weight: 50, exposures: 2, conversions: 1, conversionRate: 50, liftPoints: null, sampleActors: ["user_1"] },
    { key: "treatment", name: "Treatment", weight: 50, exposures: 2, conversions: 2, conversionRate: 100, liftPoints: 50, sampleActors: ["user_3"] }
  ]
};

function client(overrides: Partial<ApiClient>): ApiClient {
  return {
    listEvents: vi.fn().mockResolvedValue({ data: [] }),
    listExperiments: vi.fn().mockResolvedValue({ experiments: [] }),
    getExperimentResults: vi.fn().mockResolvedValue({ data: results }),
    createExperiment: vi.fn().mockResolvedValue({ experiment }),
    ...overrides
  } as ApiClient;
}

afterEach(() => {
  cleanup();
});

describe("ExperimentsPanel", () => {
  it("loads saved experiments and renders variant result rows", async () => {
    const api = client({
      listExperiments: vi.fn().mockResolvedValue({ experiments: [experiment] }),
      getExperimentResults: vi.fn().mockResolvedValue({ data: results })
    });

    render(<ExperimentsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByLabelText("Experiment")).toHaveValue("exp_1");
    const readout = screen.getByRole("region", { name: "A/B test readout" });
    await waitFor(() => expect(within(readout).getByRole("row", { name: /Variant treatment/ })).toHaveTextContent("100.0%"));
    expect(within(readout).getByRole("row", { name: /Variant treatment/ })).toHaveTextContent("+50.0 pp");
    expect(api.getExperimentResults).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      experimentId: "exp_1",
      window: "30d",
      limit: 500
    });
  });

  it("creates an experiment with two weighted variants", async () => {
    const user = userEvent.setup();
    const createExperiment = vi.fn().mockResolvedValue({ experiment });
    const api = client({ listExperiments: vi.fn().mockResolvedValue({ experiments: [] }), createExperiment });

    render(<ExperimentsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText(/No experiments yet/i);
    await user.clear(screen.getByLabelText("Experiment key"));
    await user.type(screen.getByLabelText("Experiment key"), "pricing_copy");
    await user.clear(screen.getByLabelText("Experiment name"));
    await user.type(screen.getByLabelText("Experiment name"), "Pricing copy");
    await user.click(screen.getByRole("button", { name: "Create experiment" }));

    expect(createExperiment).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        key: "pricing_copy",
        name: "Pricing copy",
        variants: [
          { key: "control", name: "control", weight: 50 },
          { key: "treatment", name: "treatment", weight: 50 }
        ]
      })
    );
  });
});
