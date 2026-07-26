// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NpsResultsResponse, Survey, SurveyResultsResponse } from "../../../api/types";
import { buildSurveysVM, formatAnswerPreview, formatNpsScore, isNpsSurvey, useSurveys } from "./useSurveys";

afterEach(() => vi.restoreAllMocks());

function ratingSurvey(over: Partial<Survey> = {}): Survey {
  return {
    id: "s1",
    projectId: "p",
    environmentId: "e",
    key: "activation_pulse",
    name: "Activation pulse",
    description: null,
    status: "active",
    actorType: "user",
    triggerEvent: null,
    questions: [{ id: "satisfaction", type: "rating", label: "How satisfied?", required: true, scale: { min: 1, max: 5 } }],
    targeting: {},
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

function npsSurvey(over: Partial<Survey> = {}): Survey {
  return ratingSurvey({
    id: "s2",
    key: "nps",
    name: "NPS campaign",
    questions: [{ id: "nps", type: "rating", label: "How likely?", required: true, scale: { min: 0, max: 10 } }],
    ...over,
  });
}

function surveyResults(survey: Survey, over: Partial<SurveyResultsResponse> = {}): SurveyResultsResponse {
  return {
    survey,
    window: "30d",
    totals: { responses: 10, users: 8, tenants: 3, sessions: 5 },
    questions: [{ id: survey.questions[0].id, label: survey.questions[0].label, type: "rating", responses: 10, average: 4.2 }],
    recentResponses: [
      { id: "r1", surveyId: survey.id, actorType: "user", actorId: "u1", tenantId: "t1", userId: "u1", sessionId: null, answers: { score: 9 }, submittedAt: "2026-06-23T12:00:00.000Z" },
    ],
    ...over,
  };
}

function npsResults(over: Partial<NpsResultsResponse> = {}): NpsResultsResponse {
  return {
    survey: npsSurvey(),
    window: "30d",
    questionId: "nps",
    totals: { responses: 10, promoters: 6, passives: 2, detractors: 2, score: 40, average: 8.1 },
    trend: [{ bucket: "2026-06-20", responses: 5, score: 30, promoters: 3, passives: 1, detractors: 1 }],
    segments: {
      tenants: [{ key: "t1", label: "Acme", responses: 5, score: 30, promoters: 3, passives: 1, detractors: 1 }],
      releases: [],
      plans: [],
    },
    recentResponses: [],
    ...over,
  };
}

describe("isNpsSurvey", () => {
  it("returns false for a plain rating survey", () => {
    expect(isNpsSurvey(ratingSurvey())).toBe(false);
  });
  it("returns true for a 0-10 nps question", () => {
    expect(isNpsSurvey(npsSurvey())).toBe(true);
  });
  it("returns false for null", () => {
    expect(isNpsSurvey(null)).toBe(false);
  });
});

describe("formatNpsScore", () => {
  it("adds a plus sign for positive scores", () => {
    expect(formatNpsScore(40)).toBe("+40");
  });
  it("leaves non-positive scores as-is", () => {
    expect(formatNpsScore(0)).toBe("0");
    expect(formatNpsScore(-10)).toBe("-10");
  });
});

describe("formatAnswerPreview", () => {
  it("returns the serialized value untruncated when short", () => {
    expect(formatAnswerPreview({ score: 9 })).toBe('{"score":9}');
  });
  it("truncates long serialized values to 90 chars with an ellipsis", () => {
    const long = { note: "x".repeat(100) };
    const preview = formatAnswerPreview(long);
    expect(preview.length).toBe(90);
    expect(preview.endsWith("...")).toBe(true);
  });
});

describe("buildSurveysVM", () => {
  it("maps rows and null selected without results", () => {
    const vm = buildSurveysVM([ratingSurvey()], null, null);
    expect(vm.rows).toHaveLength(1);
    expect(vm.rows[0].isNps).toBe(false);
    expect(vm.selected).toBeNull();
  });

  it("builds the selected survey totals and questions from results", () => {
    const survey = ratingSurvey();
    const vm = buildSurveysVM([survey], surveyResults(survey), null);
    expect(vm.selected?.totals).toEqual({ responses: 10, users: 8, tenants: 3, sessions: 5 });
    expect(vm.selected?.questions[0].averageOrChoicesLabel).toBe("4.2");
    expect(vm.selected?.recentResponses[0].answersPreview).toBe('{"score":9}');
  });

  it("labels and flattens nps segments with their prefix", () => {
    const survey = npsSurvey();
    const vm = buildSurveysVM([survey], surveyResults(survey), npsResults());
    expect(vm.selected?.isNps).toBe(true);
    expect(vm.selected?.nps?.scoreLabel).toBe("+40");
    expect(vm.selected?.nps?.segments[0].label).toBe("Tenant Acme");
  });
});

describe("useSurveys", () => {
  function makeClient() {
    return {
      listSurveys: vi.fn().mockResolvedValue({ surveys: [ratingSurvey()] }),
      createSurvey: vi.fn().mockResolvedValue({ survey: ratingSurvey() }),
      updateSurvey: vi.fn().mockResolvedValue({ survey: ratingSurvey() }),
      archiveSurvey: vi.fn().mockResolvedValue(undefined),
      getSurveyResults: vi.fn().mockResolvedValue({ data: surveyResults(ratingSurvey()) }),
      getNpsResults: vi.fn().mockResolvedValue({ data: npsResults() }),
    };
  }

  it("loads and builds a VM", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useSurveys({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.rows).toHaveLength(1);
  });

  it("goes to error status without throwing when listSurveys is missing", async () => {
    const client = {};
    const { result } = renderHook(() =>
      useSurveys({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });

  it("only fetches NPS results when the selected survey looks like NPS", async () => {
    const client = makeClient();
    client.listSurveys.mockResolvedValue({ surveys: [ratingSurvey(), npsSurvey()] });
    const { result, rerender } = renderHook(
      ({ selectedId }) => useSurveys({ client, projectId: "p", environmentId: "e", selectedId, enabled: true }),
      { initialProps: { selectedId: "s1" as string | undefined } },
    );
    await waitFor(() => expect(client.getSurveyResults).toHaveBeenCalled());
    expect(client.getNpsResults).not.toHaveBeenCalled();

    rerender({ selectedId: "s2" });
    await waitFor(() => expect(client.getNpsResults).toHaveBeenCalled());
  });

  it("createSurvey and createNpsSurvey mark busy and reload on success", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useSurveys({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let ok = false;
    await act(async () => {
      ok = await result.current.createSurvey({ key: "k", name: "n", question: "q", triggerEvent: "", targetTenantId: "" });
    });
    expect(ok).toBe(true);
    expect(client.createSurvey).toHaveBeenCalledTimes(1);

    await act(async () => {
      ok = await result.current.createNpsSurvey({ key: "", name: "", question: "", triggerEvent: "", targetTenantId: "" });
    });
    expect(ok).toBe(true);
    const npsCall = client.createSurvey.mock.calls[1][0];
    expect(npsCall.key).toBe("nps");
    expect(npsCall.questions.map((q: { id: string }) => q.id)).toEqual(["nps", "comment"]);
  });

  it("archiveSurvey returns false without throwing when the method is missing", async () => {
    const client = makeClient() as Record<string, unknown>;
    delete client.archiveSurvey;
    const { result } = renderHook(() =>
      useSurveys({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let ok = false;
    await act(async () => {
      ok = await result.current.archiveSurvey("s1");
    });
    expect(ok).toBe(true);
  });
});
