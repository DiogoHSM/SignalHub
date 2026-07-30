import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type {
  BetaProgram,
  BetaProgramAdoption,
  BetaProgramParticipant,
  Experiment,
  ExperimentResultsResponse,
  FeatureFlag,
  MessageCampaign,
  MessageCampaignResultsResponse,
  NpsResultsResponse,
  Survey,
  SurveyResultsResponse
} from "../api/types";
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

const survey: Survey = {
  id: "surv_1",
  projectId: "prj_1",
  environmentId: "env_1",
  key: "activation_pulse",
  name: "Activation pulse",
  description: null,
  status: "active",
  actorType: "user",
  triggerEvent: "checkout.completed",
  questions: [
    {
      id: "satisfaction",
      type: "rating",
      label: "How satisfied are you with this workflow?",
      required: true,
      scale: { min: 1, max: 5, minLabel: "Hard", maxLabel: "Great" }
    }
  ],
  targeting: { tenantId: "tenant_1" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null
};

const surveyResults: SurveyResultsResponse = {
  survey,
  window: "30d",
  totals: { responses: 2, users: 2, tenants: 1, sessions: 2 },
  questions: [{ id: "satisfaction", label: "How satisfied are you with this workflow?", type: "rating", responses: 2, average: 4.5 }],
  recentResponses: [
    {
      id: "srs_1",
      surveyId: "surv_1",
      actorType: "user",
      actorId: "user_1",
      tenantId: "tenant_1",
      userId: "user_1",
      sessionId: "sess_1",
      answers: { satisfaction: 5 },
      submittedAt: "2026-01-01T00:00:00.000Z"
    }
  ]
};

const npsSurvey: Survey = {
  ...survey,
  id: "surv_nps",
  key: "quarterly_nps",
  name: "Quarterly NPS",
  description: "Standard NPS",
  questions: [
    {
      id: "nps",
      type: "rating",
      label: "How likely are you to recommend us?",
      required: true,
      scale: { min: 0, max: 10, minLabel: "Not likely", maxLabel: "Very likely" }
    }
  ]
};

const npsResults: NpsResultsResponse = {
  survey: npsSurvey,
  window: "30d",
  questionId: "nps",
  totals: { responses: 3, promoters: 1, passives: 1, detractors: 1, score: 0, average: 7.3 },
  trend: [{ bucket: "2026-05-01", responses: 3, promoters: 1, passives: 1, detractors: 1, score: 0 }],
  segments: {
    tenants: [{ key: "tenant_1", label: "tenant_1", responses: 3, promoters: 1, passives: 1, detractors: 1, score: 0 }],
    releases: [],
    plans: [{ key: "pro", label: "pro", responses: 3, promoters: 1, passives: 1, detractors: 1, score: 0 }]
  },
  recentResponses: []
};

const campaign: MessageCampaign = {
  id: "cmp_1",
  projectId: "prj_1",
  environmentId: "env_1",
  key: "invoice_activation",
  name: "Invoice activation",
  description: null,
  status: "active",
  channelType: "in_app",
  notificationChannelId: null,
  segmentId: "seg_1",
  conversionEvent: "invoice.paid",
  subject: "Create your first invoice",
  body: "Create your first invoice to finish onboarding.",
  ctaUrl: "https://app.example.com/invoices",
  consentCategory: "product",
  privacyNote: "Respects Sigmon campaign opt-outs.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null
};

const campaignResults: MessageCampaignResultsResponse = {
  campaign,
  window: "30d",
  totals: {
    queued: 1,
    sent: 1,
    delivered: 1,
    opened: 1,
    clicked: 1,
    converted: 1,
    failed: 0,
    optedOut: 0,
    uniqueActors: 1
  },
  rates: { deliveryRate: 100, openRate: 100, clickRate: 100, conversionRate: 100, optOutRate: 0 },
  recentEvents: [
    {
      id: "cme_1",
      campaignId: "cmp_1",
      type: "converted",
      actorType: "user",
      actorId: "user_1",
      tenantId: "tenant_1",
      userId: "user_1",
      occurredAt: "2026-01-01T00:00:00.000Z"
    }
  ],
  optOuts: []
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
    listSurveys: vi.fn().mockResolvedValue({ surveys: [] }),
    createSurvey: vi.fn().mockResolvedValue({ survey }),
    updateSurvey: vi.fn().mockResolvedValue({ survey }),
    archiveSurvey: vi.fn().mockResolvedValue(undefined),
    getSurveyResults: vi.fn().mockResolvedValue({ data: surveyResults }),
    getNpsResults: vi.fn().mockResolvedValue({ data: npsResults }),
    listMessageCampaigns: vi.fn().mockResolvedValue({ campaigns: [] }),
    createMessageCampaign: vi.fn().mockResolvedValue({ campaign }),
    updateMessageCampaign: vi.fn().mockResolvedValue({ campaign }),
    archiveMessageCampaign: vi.fn().mockResolvedValue(undefined),
    getMessageCampaignResults: vi.fn().mockResolvedValue({ data: campaignResults }),
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

  it("loads surveys, creates a rating survey, and shows response results", async () => {
    const user = userEvent.setup();
    const createSurvey = vi.fn().mockResolvedValue({ survey: { ...survey, id: "surv_2", key: "pricing_pulse", name: "Pricing pulse" } });
    const api = client({
      listSurveys: vi.fn().mockResolvedValue({ surveys: [survey] }),
      getSurveyResults: vi.fn().mockResolvedValue({ data: surveyResults }),
      createSurvey
    });

    render(<ExperimentsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    const surveysRegion = await screen.findByRole("region", { name: "In-app surveys" });
    expect(within(surveysRegion).getByLabelText("Survey")).toHaveValue("surv_1");
    await waitFor(() => expect(within(surveysRegion).getByText("4.5")).toBeInTheDocument());
    expect(within(surveysRegion).getByText(/\"satisfaction\":5/)).toBeInTheDocument();

    await user.clear(within(surveysRegion).getByLabelText("Survey key"));
    await user.type(within(surveysRegion).getByLabelText("Survey key"), "pricing_pulse");
    await user.clear(within(surveysRegion).getByLabelText("Survey name"));
    await user.type(within(surveysRegion).getByLabelText("Survey name"), "Pricing pulse");
    await user.clear(within(surveysRegion).getByLabelText("Survey trigger event"));
    await user.type(within(surveysRegion).getByLabelText("Survey trigger event"), "pricing.viewed");
    await user.click(within(surveysRegion).getByRole("button", { name: "Create survey" }));

    expect(createSurvey).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        key: "pricing_pulse",
        name: "Pricing pulse",
        status: "active",
        actorType: "user",
        triggerEvent: "pricing.viewed",
        questions: [expect.objectContaining({ id: "satisfaction", type: "rating", required: true })]
      })
    );
  });

  it("creates a standard NPS campaign and renders NPS results", async () => {
    const user = userEvent.setup();
    const createSurvey = vi.fn().mockResolvedValue({ survey: { ...npsSurvey, id: "surv_nps_2" } });
    const api = client({
      listSurveys: vi.fn().mockResolvedValue({ surveys: [npsSurvey] }),
      getSurveyResults: vi.fn().mockResolvedValue({ data: { ...surveyResults, survey: npsSurvey } }),
      getNpsResults: vi.fn().mockResolvedValue({ data: npsResults }),
      createSurvey
    });

    render(<ExperimentsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    const surveysRegion = await screen.findByRole("region", { name: "In-app surveys" });
    expect(await within(surveysRegion).findByRole("region", { name: "NPS report" })).toBeInTheDocument();
    expect(within(surveysRegion).getByText("NPS score")).toBeInTheDocument();
    expect(within(surveysRegion).getByText("Tenant tenant_1")).toBeInTheDocument();

    await user.clear(within(surveysRegion).getByLabelText("Survey key"));
    await user.type(within(surveysRegion).getByLabelText("Survey key"), "quarterly_nps");
    await user.clear(within(surveysRegion).getByLabelText("Survey name"));
    await user.type(within(surveysRegion).getByLabelText("Survey name"), "Quarterly NPS");
    await user.click(within(surveysRegion).getByRole("button", { name: "Create NPS campaign" }));

    expect(createSurvey).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        key: "quarterly_nps",
        name: "Quarterly NPS",
        questions: [
          expect.objectContaining({ id: "nps", type: "rating", scale: { min: 0, max: 10, minLabel: "Not likely", maxLabel: "Very likely" } }),
          expect.objectContaining({ id: "comment", type: "text" })
        ]
      })
    );
  });

  it("loads message campaigns, creates one, and shows delivery results", async () => {
    const user = userEvent.setup();
    const createMessageCampaign = vi.fn().mockResolvedValue({ campaign: { ...campaign, id: "cmp_2", name: "Invoice activation v2" } });
    const api = client({
      listMessageCampaigns: vi.fn().mockResolvedValue({ campaigns: [campaign] }),
      getMessageCampaignResults: vi.fn().mockResolvedValue({ data: campaignResults }),
      createMessageCampaign
    });

    render(<ExperimentsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    const campaignsRegion = await screen.findByRole("region", { name: "Message campaigns" });
    expect(await within(campaignsRegion).findByLabelText("Campaign")).toHaveValue("cmp_1");
    await waitFor(() => expect(within(campaignsRegion).getAllByText("100.0%")[0]).toBeInTheDocument());
    expect(within(campaignsRegion).getByRole("row", { name: /converted/ })).toHaveTextContent("tenant_1");

    await user.clear(within(campaignsRegion).getByLabelText("Campaign key"));
    await user.type(within(campaignsRegion).getByLabelText("Campaign key"), "invoice_activation_v2");
    await user.clear(within(campaignsRegion).getByLabelText("Campaign name"));
    await user.type(within(campaignsRegion).getByLabelText("Campaign name"), "Invoice activation v2");
    await user.click(within(campaignsRegion).getByRole("button", { name: "Create campaign" }));

    expect(createMessageCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        key: "invoice_activation_v2",
        name: "Invoice activation v2",
        channelType: "in_app",
        notificationChannelId: null,
        consentCategory: "product"
      })
    );
  });
});
