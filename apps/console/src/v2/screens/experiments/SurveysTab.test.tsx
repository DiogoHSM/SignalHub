// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../../api/types";
import { SurveysTab } from "./SurveysTab";
import type { ScreenCtx } from "../registry";
import * as useSurveysModule from "./useSurveys";
import type { SurveysVM } from "./useSurveys";

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

const npsVm: SurveysVM = {
  rows: [{ id: "s1", key: "nps", name: "NPS campaign", status: "active", triggerEvent: "manual", isNps: true }],
  selected: {
    id: "s1",
    status: "active",
    triggerLabel: "manual",
    totals: { responses: 10, users: 8, tenants: 3, sessions: 5 },
    isNps: true,
    nps: {
      scoreLabel: "+40",
      promoters: 6,
      passives: 2,
      detractors: 2,
      averageLabel: "8.1",
      trend: [{ bucket: "2026-06-20", responses: 5, scoreLabel: "+30", promoters: 3, detractors: 1 }],
      segments: [{ label: "Tenant Acme", responses: 5, scoreLabel: "+30", promoters: 3, detractors: 1 }],
    },
    questions: [{ id: "nps", label: "How likely?", type: "rating", responses: 10, averageOrChoicesLabel: "8.1" }],
    recentResponses: [{ id: "r1", submittedAtLabel: "6/23/2026", actorLabel: "user u1", tenantLabel: "t1", answersPreview: '{"score":9}' }],
  },
};

function mockHook(over: Partial<useSurveysModule.UseSurveysResult> = {}) {
  vi.spyOn(useSurveysModule, "useSurveys").mockReturnValue({
    data: npsVm,
    status: "ok",
    busy: false,
    reload: vi.fn(),
    createSurvey: vi.fn().mockResolvedValue(true),
    createNpsSurvey: vi.fn().mockResolvedValue(true),
    updateSurveyStatus: vi.fn().mockResolvedValue(true),
    archiveSurvey: vi.fn().mockResolvedValue(true),
    ...over,
  });
}

describe("SurveysTab", () => {
  it("shows a loading hint", () => {
    mockHook({ data: null, status: "loading" });
    render(<SurveysTab ctx={makeCtx()} enabled />);
    expect(screen.getByText(/loading surveys/i)).toBeInTheDocument();
  });

  it("shows an unavailable hint on error", () => {
    mockHook({ data: null, status: "error" });
    render(<SurveysTab ctx={makeCtx()} enabled />);
    expect(screen.getByText(/surveys unavailable/i)).toBeInTheDocument();
  });

  it("shows an empty hint with no surveys", () => {
    mockHook({ data: { rows: [], selected: null } });
    render(<SurveysTab ctx={makeCtx()} enabled />);
    expect(screen.getByText(/no surveys yet/i)).toBeInTheDocument();
  });

  it("renders the NPS report with score, promoters/passives/detractors, and segments", () => {
    mockHook();
    render(<SurveysTab ctx={makeCtx()} enabled />);
    expect(screen.getByText(/nps report/i)).toBeInTheDocument();
    expect(screen.getByText("+40")).toBeInTheDocument();
    expect(screen.getByText("Tenant Acme")).toBeInTheDocument();
  });

  it("shows a warning hint when a survey looks like NPS but has no results", () => {
    mockHook({ data: { ...npsVm, selected: { ...npsVm.selected!, nps: null } } });
    render(<SurveysTab ctx={makeCtx()} enabled />);
    expect(screen.getByText(/no nps data yet/i)).toBeInTheDocument();
  });

  it("opens the create form and creates an NPS campaign via the dedicated button", async () => {
    const createNpsSurvey = vi.fn().mockResolvedValue(true);
    mockHook({ createNpsSurvey });
    const ctx = makeCtx();
    render(<SurveysTab ctx={ctx} enabled />);
    await userEvent.click(screen.getByText(/new survey/i));
    await userEvent.click(screen.getByText(/create nps campaign/i));
    expect(createNpsSurvey).toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith("NPS campaign created");
  });

  it("archives a survey only after two ConfirmButton clicks", async () => {
    const archiveSurvey = vi.fn().mockResolvedValue(true);
    mockHook({ archiveSurvey });
    render(<SurveysTab ctx={makeCtx()} enabled />);
    const archiveBtn = screen.getByTitle("Pause").parentElement?.querySelector("button:last-child") as HTMLElement;
    await userEvent.click(archiveBtn);
    expect(archiveSurvey).not.toHaveBeenCalled();
    await userEvent.click(archiveBtn);
    expect(archiveSurvey).toHaveBeenCalledWith("s1");
  });
});
