import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { BetaProgram, BetaProgramAdoption, BetaProgramParticipant, Experiment, ExperimentResultsResponse, FeatureFlag } from "../api/types";
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

const flag: FeatureFlag = {
  id: "flg_1",
  projectId: "prj_1",
  environmentId: "env_1",
  key: "new_checkout",
  name: "New checkout",
  description: null,
  status: "active",
  defaultVariant: "off",
  variants: [
    { key: "off", value: false },
    { key: "on", value: true }
  ],
  rules: [{ id: "internal", description: "Internal user", variant: "on", match: { userId: "user_1" } }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null
};

const betaProgram: BetaProgram = {
  id: "beta_1",
  projectId: "prj_1",
  environmentId: "env_1",
  key: "checkout_beta",
  name: "Checkout beta",
  description: "Early access",
  status: "active",
  actorType: "user",
  featureFlagId: "flg_1",
  featureFlagVariant: "on",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null
};

const betaParticipant: BetaProgramParticipant = {
  id: "betap_1",
  programId: "beta_1",
  projectId: "prj_1",
  environmentId: "env_1",
  actorType: "user",
  actorId: "user_1",
  status: "active",
  notes: "Requested early access.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  removedAt: null
};

const betaAdoption: BetaProgramAdoption = {
  programId: "beta_1",
  window: "30d",
  participants: 1,
  activeParticipants: 1,
  activeActorsWithEvents: 1,
  events: 3,
  adoptionRate: 100,
  samples: [{ actorId: "user_1", events: 3, lastSeenAt: "2026-01-01T00:00:00.000Z" }]
};

function client(overrides: Partial<ApiClient>): ApiClient {
  return {
    listEvents: vi.fn().mockResolvedValue({ data: [] }),
    listExperiments: vi.fn().mockResolvedValue({ experiments: [] }),
    getExperimentResults: vi.fn().mockResolvedValue({ data: results }),
    createExperiment: vi.fn().mockResolvedValue({ experiment }),
    listFeatureFlags: vi.fn().mockResolvedValue({ flags: [] }),
    createFeatureFlag: vi.fn().mockResolvedValue({ flag }),
    updateFeatureFlag: vi.fn().mockResolvedValue({ flag }),
    archiveFeatureFlag: vi.fn().mockResolvedValue(undefined),
    listFeatureFlagAudit: vi.fn().mockResolvedValue({ audit: [] }),
    listBetaPrograms: vi.fn().mockResolvedValue({ programs: [] }),
    createBetaProgram: vi.fn().mockResolvedValue({ program: betaProgram }),
    updateBetaProgram: vi.fn().mockResolvedValue({ program: betaProgram }),
    archiveBetaProgram: vi.fn().mockResolvedValue(undefined),
    listBetaProgramParticipants: vi.fn().mockResolvedValue({ participants: [] }),
    addBetaProgramParticipant: vi.fn().mockResolvedValue({ participant: betaParticipant }),
    removeBetaProgramParticipant: vi.fn().mockResolvedValue(undefined),
    getBetaProgramAdoption: vi.fn().mockResolvedValue({ adoption: betaAdoption }),
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

  it("loads feature flags and creates a boolean flag", async () => {
    const user = userEvent.setup();
    const createFeatureFlag = vi.fn().mockResolvedValue({ flag: { ...flag, id: "flg_2", key: "pricing_cards", name: "Pricing cards" } });
    const api = client({
      listFeatureFlags: vi.fn().mockResolvedValue({ flags: [flag] }),
      createFeatureFlag
    });

    render(<ExperimentsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    const flagsRegion = await screen.findByRole("region", { name: "Feature flags" });
    expect(within(flagsRegion).getByText("new_checkout")).toBeInTheDocument();
    expect(within(flagsRegion).getByText("active")).toBeInTheDocument();

    await user.clear(within(flagsRegion).getByLabelText("Flag key"));
    await user.type(within(flagsRegion).getByLabelText("Flag key"), "pricing_cards");
    await user.clear(within(flagsRegion).getByLabelText("Flag name"));
    await user.type(within(flagsRegion).getByLabelText("Flag name"), "Pricing cards");
    await user.clear(within(flagsRegion).getByLabelText("Rollout percentage"));
    await user.type(within(flagsRegion).getByLabelText("Rollout percentage"), "10");
    await user.click(within(flagsRegion).getByRole("button", { name: "Create flag" }));

    expect(createFeatureFlag).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        key: "pricing_cards",
        name: "Pricing cards",
        defaultVariant: "off",
        variants: [
          { key: "off", value: false },
          { key: "on", value: true }
        ],
        rules: [expect.objectContaining({ id: "gradual_rollout", variant: "on", rollout: { percentage: 10, stickiness: "user" } })]
      })
    );
  });

  it("loads beta programs, adds participants, and shows adoption", async () => {
    const user = userEvent.setup();
    const addBetaProgramParticipant = vi.fn().mockResolvedValue({ participant: betaParticipant });
    const api = client({
      listBetaPrograms: vi.fn().mockResolvedValue({ programs: [betaProgram] }),
      listBetaProgramParticipants: vi.fn().mockResolvedValue({ participants: [betaParticipant] }),
      getBetaProgramAdoption: vi.fn().mockResolvedValue({ adoption: betaAdoption }),
      addBetaProgramParticipant
    });

    render(<ExperimentsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    const betaRegion = await screen.findByRole("region", { name: "Beta programs" });
    expect(within(betaRegion).getByText("Checkout beta")).toBeInTheDocument();
    await waitFor(() => expect(within(betaRegion).getByText("100.0% adoption")).toBeInTheDocument());
    expect(within(betaRegion).getByText("user_1")).toBeInTheDocument();

    await user.type(within(betaRegion).getByLabelText("Participant id"), "user_2");
    await user.click(within(betaRegion).getByRole("button", { name: "Add participant" }));

    expect(addBetaProgramParticipant).toHaveBeenCalledWith(
      "beta_1",
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        actorType: "user",
        actorId: "user_2",
        status: "active"
      })
    );
  });
});
