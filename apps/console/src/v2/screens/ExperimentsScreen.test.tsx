// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../api/types";
import { ExperimentsScreen } from "./ExperimentsScreen";
import type { ScreenCtx } from "./registry";
import * as useAbTestsModule from "./experiments/useAbTests";
import * as useFeatureFlagsModule from "./experiments/useFeatureFlags";
import * as useSurveysModule from "./experiments/useSurveys";
import * as useCampaignsModule from "./experiments/useCampaigns";
import * as useBetaProgramsModule from "./experiments/useBetaPrograms";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project = { id: "p", name: "Demo" } as Project;
const environment = { id: "e", name: "production" } as Environment;

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: {} as never,
    project,
    environment,
    environments: [environment],
    onCreateEnvironment: vi.fn(),
    onArchiveProject: vi.fn(),
    onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn(),
    navigate: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
    ...over,
  } as ScreenCtx;
}

function mockAll() {
  vi.spyOn(useAbTestsModule, "useAbTests").mockReturnValue({
    data: { rows: [], selected: null },
    status: "ok",
    busy: false,
    reload: vi.fn(),
    createExperiment: vi.fn(),
    updateExperimentStatus: vi.fn(),
    archiveExperiment: vi.fn(),
  });
  const useFeatureFlagsSpy = vi.spyOn(useFeatureFlagsModule, "useFeatureFlags").mockReturnValue({
    data: { rows: [] },
    status: "ok",
    busy: false,
    reload: vi.fn(),
    createFlag: vi.fn(),
    updateFlagStatus: vi.fn(),
    archiveFlag: vi.fn(),
    evaluateFlag: vi.fn(),
    loadAudit: vi.fn(),
  });
  vi.spyOn(useSurveysModule, "useSurveys").mockReturnValue({
    data: { rows: [], selected: null },
    status: "ok",
    busy: false,
    reload: vi.fn(),
    createSurvey: vi.fn(),
    createNpsSurvey: vi.fn(),
    updateSurveyStatus: vi.fn(),
    archiveSurvey: vi.fn(),
  });
  vi.spyOn(useCampaignsModule, "useCampaigns").mockReturnValue({
    data: { rows: [], selected: null },
    status: "ok",
    busy: false,
    reload: vi.fn(),
    createCampaign: vi.fn(),
    updateCampaignStatus: vi.fn(),
    archiveCampaign: vi.fn(),
  });
  vi.spyOn(useBetaProgramsModule, "useBetaPrograms").mockReturnValue({
    data: { rows: [], selected: null },
    status: "ok",
    busy: false,
    reload: vi.fn(),
    createProgram: vi.fn(),
    updateProgramStatus: vi.fn(),
    archiveProgram: vi.fn(),
    addParticipant: vi.fn(),
    removeParticipant: vi.fn(),
  });
  return { useFeatureFlagsSpy };
}

describe("ExperimentsScreen", () => {
  it("shows a guard hint when no project/environment is selected", () => {
    mockAll();
    render(<ExperimentsScreen ctx={makeCtx({ project: undefined, environment: undefined })} />);
    expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
  });

  it("renders the PageHead title first and the 5-tab Segmented control", () => {
    mockAll();
    render(<ExperimentsScreen ctx={makeCtx()} />);
    expect(screen.getByRole("heading", { name: "Experiments", level: 1 })).toBeInTheDocument();
    for (const label of ["A/B", "Flags", "Surveys", "Campaigns", "Beta"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("defaults to the A/B tab and shows its empty state", () => {
    mockAll();
    render(<ExperimentsScreen ctx={makeCtx()} />);
    expect(screen.getByText(/no experiments yet/i)).toBeInTheDocument();
  });

  it("fetches feature flags only while the Flags or Beta tab is active", async () => {
    const { useFeatureFlagsSpy } = mockAll();
    render(<ExperimentsScreen ctx={makeCtx()} />);

    // A/B tab (default): flags fetch disabled
    expect(useFeatureFlagsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));

    await userEvent.click(screen.getByText("Flags"));
    expect(useFeatureFlagsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    expect(screen.getByText(/no feature flags yet/i)).toBeInTheDocument();

    await userEvent.click(screen.getByText("Beta"));
    expect(useFeatureFlagsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    expect(screen.getByText(/no beta programs yet/i)).toBeInTheDocument();

    await userEvent.click(screen.getByText("Surveys"));
    expect(useFeatureFlagsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    expect(screen.getByText(/no surveys yet/i)).toBeInTheDocument();

    await userEvent.click(screen.getByText("Campaigns"));
    expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument();
  });
});
