import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../../../api/client";
import type {
  NpsResultsResponse,
  NpsSegmentSummary,
  Survey,
  SurveyResultsResponse,
  SurveyStatus,
} from "../../../api/types";

// ---------------------------------------------------------------------------
// Pure functions — ported 1:1 from ExperimentsPanel.tsx
// ---------------------------------------------------------------------------

export function isNpsSurvey(survey: Survey | null): boolean {
  return Boolean(
    survey?.questions.some(
      (question) => question.id === "nps" && question.type === "rating" && question.scale?.min === 0 && question.scale?.max === 10,
    ),
  );
}

export function formatNpsScore(score: number): string {
  return score > 0 ? `+${score}` : String(score);
}

export function formatAnswerPreview(value: Record<string, unknown>): string {
  const serialized = JSON.stringify(value);
  return serialized.length > 90 ? `${serialized.slice(0, 87)}...` : serialized;
}

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type SurveyRowVM = {
  id: string;
  key: string;
  name: string;
  status: SurveyStatus;
  triggerEvent: string;
  isNps: boolean;
};

export type NpsSegmentRowVM = {
  label: string;
  responses: number;
  scoreLabel: string;
  promoters: number;
  detractors: number;
};

export type NpsTrendRowVM = {
  bucket: string;
  responses: number;
  scoreLabel: string;
  promoters: number;
  detractors: number;
};

export type NpsVM = {
  scoreLabel: string;
  promoters: number;
  passives: number;
  detractors: number;
  averageLabel: string;
  trend: NpsTrendRowVM[];
  segments: NpsSegmentRowVM[];
};

export type SurveyQuestionRowVM = {
  id: string;
  label: string;
  type: string;
  responses: number;
  averageOrChoicesLabel: string;
};

export type SurveyResponseRowVM = {
  id: string;
  submittedAtLabel: string;
  actorLabel: string;
  tenantLabel: string;
  answersPreview: string;
};

export type SelectedSurveyVM = {
  id: string;
  status: SurveyStatus;
  triggerLabel: string;
  totals: { responses: number; users: number; tenants: number; sessions: number };
  isNps: boolean;
  nps: NpsVM | null;
  questions: SurveyQuestionRowVM[];
  recentResponses: SurveyResponseRowVM[];
};

export type SurveysVM = {
  rows: SurveyRowVM[];
  selected: SelectedSurveyVM | null;
};

export type CreateSurveyForm = {
  key: string;
  name: string;
  question: string;
  triggerEvent: string;
  targetTenantId: string;
};

function toRowVM(s: Survey): SurveyRowVM {
  return {
    id: s.id,
    key: s.key,
    name: s.name,
    status: s.status,
    triggerEvent: s.triggerEvent ?? "manual",
    isNps: isNpsSurvey(s),
  };
}

function labelSegments(segments: NpsResultsResponse["segments"]): NpsSegmentRowVM[] {
  const withLabel = (prefix: string) => (s: NpsSegmentSummary) => ({ ...s, label: `${prefix} ${s.label}` });
  return [
    ...segments.tenants.map(withLabel("Tenant")),
    ...segments.releases.map(withLabel("Release")),
    ...segments.plans.map(withLabel("Plan")),
  ].map((s) => ({
    label: s.label,
    responses: s.responses,
    scoreLabel: formatNpsScore(s.score),
    promoters: s.promoters,
    detractors: s.detractors,
  }));
}

function buildNpsVM(nps: NpsResultsResponse): NpsVM {
  return {
    scoreLabel: formatNpsScore(nps.totals.score),
    promoters: nps.totals.promoters,
    passives: nps.totals.passives,
    detractors: nps.totals.detractors,
    averageLabel: nps.totals.average != null ? nps.totals.average.toFixed(1) : "none",
    trend: nps.trend.map((t) => ({
      bucket: t.bucket,
      responses: t.responses,
      scoreLabel: formatNpsScore(t.score),
      promoters: t.promoters,
      detractors: t.detractors,
    })),
    segments: labelSegments(nps.segments),
  };
}

export function buildSurveysVM(
  rows: Survey[],
  results: SurveyResultsResponse | null,
  nps: NpsResultsResponse | null,
): SurveysVM {
  const selected: SelectedSurveyVM | null = results
    ? {
        id: results.survey.id,
        status: results.survey.status,
        triggerLabel: results.survey.triggerEvent ?? "manual",
        totals: results.totals,
        isNps: isNpsSurvey(results.survey),
        nps: nps ? buildNpsVM(nps) : null,
        questions: results.questions.map((q) => ({
          id: q.id,
          label: q.label,
          type: q.type,
          responses: q.responses,
          averageOrChoicesLabel:
            q.average !== undefined ? q.average.toFixed(1) : q.choices?.map((c) => `${c.value}: ${c.count}`).join(", ") ?? "none",
        })),
        recentResponses: results.recentResponses.map((r) => ({
          id: r.id,
          submittedAtLabel: new Date(r.submittedAt).toLocaleString(),
          actorLabel: `${r.actorType} ${r.actorId ?? "anonymous"}`,
          tenantLabel: r.tenantId ?? "none",
          answersPreview: formatAnswerPreview(r.answers),
        })),
      }
    : null;

  return { rows: rows.map(toRowVM), selected };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type UseSurveysResult = {
  data: SurveysVM | null;
  status: "loading" | "ok" | "error";
  busy: boolean;
  reload: () => void;
  createSurvey: (form: CreateSurveyForm) => Promise<boolean>;
  createNpsSurvey: (form: CreateSurveyForm) => Promise<boolean>;
  updateSurveyStatus: (id: string, status: SurveyStatus) => Promise<boolean>;
  archiveSurvey: (id: string) => Promise<boolean>;
};

type UseSurveysArgs = {
  client: Partial<
    Pick<ApiClient, "listSurveys" | "createSurvey" | "updateSurvey" | "archiveSurvey" | "getSurveyResults" | "getNpsResults">
  >;
  projectId: string | undefined;
  environmentId: string | undefined;
  selectedId: string | undefined;
  enabled: boolean;
};

export function useSurveys({ client, projectId, environmentId, selectedId, enabled }: UseSurveysArgs): UseSurveysResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [rows, setRows] = useState<Survey[]>([]);
  const [results, setResults] = useState<SurveyResultsResponse | null>(null);
  const [npsResults, setNpsResults] = useState<NpsResultsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId || !enabled) return;

    if (!client.listSurveys) {
      setStatus("error");
      setRows([]);
      return;
    }

    const gen = ++genRef.current;
    setStatus("loading");

    client
      .listSurveys({ projectId, environmentId })
      .then(({ surveys }) => {
        if (gen !== genRef.current) return;
        setRows(surveys);
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setRows([]);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, environmentId, enabled, tick]);

  useEffect(() => {
    const survey = rows.find((r) => r.id === selectedId) ?? null;
    if (!projectId || !environmentId || !survey || !client.getSurveyResults) {
      setResults(null);
      setNpsResults(null);
      return;
    }
    let cancelled = false;
    client
      .getSurveyResults({ projectId, environmentId, surveyId: survey.id, window: "30d", limit: 25 })
      .then(({ data }) => {
        if (!cancelled) setResults(data);
      })
      .catch(() => {
        if (!cancelled) setResults(null);
      });

    if (isNpsSurvey(survey) && client.getNpsResults) {
      client
        .getNpsResults({ projectId, environmentId, surveyId: survey.id, window: "30d", limit: 25, questionId: "nps" })
        .then(({ data }) => {
          if (!cancelled) setNpsResults(data);
        })
        .catch(() => {
          if (!cancelled) setNpsResults(null);
        });
    } else {
      setNpsResults(null);
    }

    return () => {
      cancelled = true;
    };
  }, [client, projectId, environmentId, selectedId, rows]);

  const data = useMemo<SurveysVM | null>(() => {
    if (status !== "ok") return null;
    return buildSurveysVM(rows, results, npsResults);
  }, [status, rows, results, npsResults]);

  const run = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        reload();
        return true;
      } catch (err) {
        console.error(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const createSurvey = useCallback(
    (form: CreateSurveyForm) =>
      run(async () => {
        if (!projectId || !environmentId || !client.createSurvey) return;
        await client.createSurvey({
          projectId,
          environmentId,
          key: form.key,
          name: form.name,
          status: "active",
          actorType: "user",
          triggerEvent: form.triggerEvent.trim() || null,
          questions: [
            {
              id: "satisfaction",
              type: "rating",
              label: form.question,
              required: true,
              scale: { min: 1, max: 5, minLabel: "Hard", maxLabel: "Great" },
            },
          ],
          targeting: form.targetTenantId.trim() ? { tenantId: form.targetTenantId.trim() } : {},
        });
      }),
    [client, environmentId, projectId, run],
  );

  const createNpsSurvey = useCallback(
    (form: CreateSurveyForm) =>
      run(async () => {
        if (!projectId || !environmentId || !client.createSurvey) return;
        const key = form.key.trim() || "nps";
        const name = form.name.trim() || "NPS campaign";
        await client.createSurvey({
          projectId,
          environmentId,
          key,
          name,
          description: "Standard 0-10 Net Promoter Score campaign.",
          status: "active",
          actorType: "user",
          triggerEvent: form.triggerEvent.trim() || null,
          questions: [
            {
              id: "nps",
              type: "rating",
              label: "How likely are you to recommend us?",
              required: true,
              scale: { min: 0, max: 10, minLabel: "Not likely", maxLabel: "Very likely" },
            },
            {
              id: "comment",
              type: "text",
              label: "What is the main reason for your score?",
              required: false,
            },
          ],
          targeting: form.targetTenantId.trim() ? { tenantId: form.targetTenantId.trim() } : {},
        });
      }),
    [client, environmentId, projectId, run],
  );

  const updateSurveyStatus = useCallback(
    (id: string, nextStatus: SurveyStatus) =>
      run(async () => {
        if (!projectId || !environmentId || !client.updateSurvey) return;
        await client.updateSurvey(id, { projectId, environmentId }, { status: nextStatus });
      }),
    [client, environmentId, projectId, run],
  );

  const archiveSurvey = useCallback(
    (id: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.archiveSurvey) return;
        await client.archiveSurvey(id, { projectId, environmentId });
      }),
    [client, environmentId, projectId, run],
  );

  return { data, status, busy, reload, createSurvey, createNpsSurvey, updateSurveyStatus, archiveSurvey };
}
