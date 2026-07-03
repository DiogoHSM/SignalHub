import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api/client";
import type {
  BetaProgram,
  BetaProgramAdoption,
  BetaProgramParticipant,
  Experiment,
  ExperimentResultsResponse,
  FeatureFlag,
  Survey,
  SurveyResultsResponse
} from "../api/types";

type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
};

type LoadState = "idle" | "loading" | "ready" | "empty" | "unavailable";

const defaultDraft = {
  key: "checkout_copy",
  name: "Checkout copy",
  conversionEvent: "checkout.completed",
  variants: "control:50,treatment:50"
};

const defaultFlagDraft = {
  key: "new_checkout",
  name: "New checkout",
  enabledUserId: "",
  rolloutPercentage: "0"
};

const defaultBetaDraft = {
  key: "checkout_beta",
  name: "Checkout beta",
  featureFlagId: "",
  participantId: ""
};

const defaultSurveyDraft = {
  key: "activation_pulse",
  name: "Activation pulse",
  question: "How satisfied are you with this workflow?",
  triggerEvent: "",
  targetTenantId: ""
};

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatLift(value: number | null): string {
  if (value === null) return "Baseline";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} pp`;
}

function parseVariants(value: string) {
  return value
    .split(",")
    .map((part) => {
      const [rawKey, rawWeight] = part.split(":");
      const key = rawKey?.trim();
      const weight = Number(rawWeight);
      return key && Number.isFinite(weight) ? { key, name: key, weight } : null;
    })
    .filter((variant): variant is { key: string; name: string; weight: number } => Boolean(variant));
}

function interpretation(row: ExperimentResultsResponse["variants"][number], index: number): string {
  if (index === 0) return "Baseline";
  if (row.exposures < 30) return "Needs sample";
  if (row.liftPoints === null || Math.abs(row.liftPoints) < 0.5) return "Flat";
  return row.liftPoints > 0 ? "Directional lead" : "Directional lag";
}

function formatFlagRollout(flag: FeatureFlag): string {
  const rollout = flag.rules.find((rule) => rule.rollout)?.rollout;
  return rollout ? `${rollout.percentage}% ${rollout.stickiness}` : "none";
}

function formatAnswerPreview(value: Record<string, unknown>): string {
  const serialized = JSON.stringify(value);
  return serialized.length > 90 ? `${serialized.slice(0, 87)}...` : serialized;
}

export function ExperimentsPanel({ client, projectId, environmentId }: Props) {
  const [draft, setDraft] = useState(defaultDraft);
  const [flagDraft, setFlagDraft] = useState(defaultFlagDraft);
  const [betaDraft, setBetaDraft] = useState(defaultBetaDraft);
  const [surveyDraft, setSurveyDraft] = useState(defaultSurveyDraft);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [betaPrograms, setBetaPrograms] = useState<BetaProgram[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [betaParticipants, setBetaParticipants] = useState<BetaProgramParticipant[]>([]);
  const [betaAdoption, setBetaAdoption] = useState<BetaProgramAdoption | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [selectedBetaId, setSelectedBetaId] = useState("");
  const [selectedSurveyId, setSelectedSurveyId] = useState("");
  const [results, setResults] = useState<ExperimentResultsResponse | null>(null);
  const [surveyResults, setSurveyResults] = useState<SurveyResultsResponse | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [flagsState, setFlagsState] = useState<LoadState>("idle");
  const [betaState, setBetaState] = useState<LoadState>("idle");
  const [surveyState, setSurveyState] = useState<LoadState>("idle");
  const [error, setError] = useState("");
  const [flagError, setFlagError] = useState("");
  const [betaError, setBetaError] = useState("");
  const [surveyError, setSurveyError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!projectId || !environmentId) {
      setExperiments([]);
      setResults(null);
      setState("idle");
      return;
    }
    if (!client.listExperiments) {
      setState("unavailable");
      return;
    }

    let cancelled = false;
    setState("loading");
    setError("");
    void client.listExperiments({ projectId, environmentId }).then(
      ({ experiments: rows }) => {
        if (cancelled) return;
        setExperiments(rows);
        setSelectedId((current) => (rows.some((row) => row.id === current) ? current : rows[0]?.id ?? ""));
        setState(rows.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setExperiments([]);
        setResults(null);
        setState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId, reloadToken]);

  useEffect(() => {
    if (!projectId || !environmentId) {
      setSurveys([]);
      setSelectedSurveyId("");
      setSurveyResults(null);
      setSurveyState("idle");
      return;
    }
    if (!client.listSurveys) {
      setSurveyState("unavailable");
      return;
    }

    let cancelled = false;
    setSurveyState("loading");
    setSurveyError("");
    void client.listSurveys({ projectId, environmentId }).then(
      ({ surveys: rows }) => {
        if (cancelled) return;
        setSurveys(rows);
        setSelectedSurveyId((current) => (rows.some((row) => row.id === current) ? current : rows[0]?.id ?? ""));
        setSurveyState(rows.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setSurveys([]);
        setSelectedSurveyId("");
        setSurveyResults(null);
        setSurveyState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId, reloadToken]);

  useEffect(() => {
    if (!projectId || !environmentId) {
      setFlags([]);
      setFlagsState("idle");
      return;
    }
    if (!client.listFeatureFlags) {
      setFlagsState("unavailable");
      return;
    }

    let cancelled = false;
    setFlagsState("loading");
    setFlagError("");
    void client.listFeatureFlags({ projectId, environmentId }).then(
      ({ flags: rows }) => {
        if (cancelled) return;
        setFlags(rows);
        setFlagsState(rows.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setFlags([]);
        setFlagsState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId, reloadToken]);

  useEffect(() => {
    if (!projectId || !environmentId) {
      setBetaPrograms([]);
      setSelectedBetaId("");
      setBetaState("idle");
      return;
    }
    if (!client.listBetaPrograms) {
      setBetaState("unavailable");
      return;
    }

    let cancelled = false;
    setBetaState("loading");
    setBetaError("");
    void client.listBetaPrograms({ projectId, environmentId }).then(
      ({ programs }) => {
        if (cancelled) return;
        setBetaPrograms(programs);
        setSelectedBetaId((current) => (programs.some((program) => program.id === current) ? current : programs[0]?.id ?? ""));
        setBetaState(programs.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setBetaPrograms([]);
        setSelectedBetaId("");
        setBetaState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId, reloadToken]);

  const selected = useMemo(() => experiments.find((experiment) => experiment.id === selectedId) ?? null, [experiments, selectedId]);
  const selectedBeta = useMemo(() => betaPrograms.find((program) => program.id === selectedBetaId) ?? null, [betaPrograms, selectedBetaId]);
  const selectedSurvey = useMemo(() => surveys.find((survey) => survey.id === selectedSurveyId) ?? null, [surveys, selectedSurveyId]);

  useEffect(() => {
    if (!projectId || !environmentId || !selected || !client.getExperimentResults) {
      setResults(null);
      return;
    }
    let cancelled = false;
    void client.getExperimentResults({ projectId, environmentId, experimentId: selected.id, window: "30d", limit: 500 }).then(
      ({ data }) => {
        if (!cancelled) setResults(data);
      },
      () => {
        if (!cancelled) setResults(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId, selected]);

  useEffect(() => {
    if (!projectId || !environmentId || !selectedSurvey || !client.getSurveyResults) {
      setSurveyResults(null);
      return;
    }
    let cancelled = false;
    void client.getSurveyResults({ projectId, environmentId, surveyId: selectedSurvey.id, window: "30d", limit: 25 }).then(
      ({ data }) => {
        if (!cancelled) setSurveyResults(data);
      },
      () => {
        if (!cancelled) setSurveyResults(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId, selectedSurvey]);

  useEffect(() => {
    if (!projectId || !environmentId || !selectedBeta) {
      setBetaParticipants([]);
      setBetaAdoption(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      client.listBetaProgramParticipants?.(selectedBeta.id, { projectId, environmentId }) ?? Promise.resolve({ participants: [] }),
      client.getBetaProgramAdoption?.(selectedBeta.id, { projectId, environmentId, window: "30d" }) ?? Promise.resolve({ adoption: null })
    ]).then(
      ([participantsResponse, adoptionResponse]) => {
        if (cancelled) return;
        setBetaParticipants(participantsResponse.participants);
        setBetaAdoption(adoptionResponse.adoption);
      },
      () => {
        if (cancelled) return;
        setBetaParticipants([]);
        setBetaAdoption(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId, selectedBeta]);

  async function createExperiment() {
    if (!projectId || !environmentId || !client.createExperiment) return;
    const variants = parseVariants(draft.variants);
    if (variants.length < 2) {
      setError("Add at least two variants as key:weight pairs.");
      return;
    }

    setError("");
    const response = await client.createExperiment({
      projectId,
      environmentId,
      key: draft.key,
      name: draft.name,
      status: "running",
      actorType: "user",
      exposureEvent: "sigmon.experiment.exposed",
      conversionEvent: draft.conversionEvent,
      variants,
      primaryMetric: { eventName: draft.conversionEvent, windowHours: 24 }
    });
    setExperiments((current) => [response.experiment, ...current]);
    setSelectedId(response.experiment.id);
    setState("ready");
  }

  async function createFlag() {
    if (!projectId || !environmentId || !client.createFeatureFlag) return;
    if (!flagDraft.key.trim() || !flagDraft.name.trim()) {
      setFlagError("Flag key and name are required.");
      return;
    }
    setFlagError("");
    const rules = [];
    if (flagDraft.enabledUserId.trim()) {
      rules.push({ id: "target_user", description: "Target user", variant: "on", match: { userId: flagDraft.enabledUserId.trim() } });
    }
    const rolloutPercentage = Math.min(100, Math.max(0, Number(flagDraft.rolloutPercentage)));
    if (Number.isFinite(rolloutPercentage) && rolloutPercentage > 0) {
      rules.push({
        id: "gradual_rollout",
        description: `${rolloutPercentage}% user rollout`,
        variant: "on",
        match: {},
        rollout: { percentage: rolloutPercentage, stickiness: "user" as const }
      });
    }
    const response = await client.createFeatureFlag({
      projectId,
      environmentId,
      key: flagDraft.key,
      name: flagDraft.name,
      status: "active",
      defaultVariant: "off",
      variants: [
        { key: "off", value: false },
        { key: "on", value: true }
      ],
      rules
    });
    setFlags((current) => [response.flag, ...current]);
    setFlagsState("ready");
  }

  async function createSurvey() {
    if (!projectId || !environmentId || !client.createSurvey) return;
    if (!surveyDraft.key.trim() || !surveyDraft.name.trim() || !surveyDraft.question.trim()) {
      setSurveyError("Survey key, name, and question are required.");
      return;
    }
    setSurveyError("");
    const response = await client.createSurvey({
      projectId,
      environmentId,
      key: surveyDraft.key,
      name: surveyDraft.name,
      status: "active",
      actorType: "user",
      triggerEvent: surveyDraft.triggerEvent.trim() || null,
      questions: [
        {
          id: "satisfaction",
          type: "rating",
          label: surveyDraft.question,
          required: true,
          scale: { min: 1, max: 5, minLabel: "Hard", maxLabel: "Great" }
        }
      ],
      targeting: surveyDraft.targetTenantId.trim() ? { tenantId: surveyDraft.targetTenantId.trim() } : {}
    });
    setSurveys((current) => [response.survey, ...current]);
    setSelectedSurveyId(response.survey.id);
    setSurveyState("ready");
  }

  async function pauseSurvey(survey: Survey) {
    if (!projectId || !environmentId || !client.updateSurvey) return;
    const nextStatus = survey.status === "active" ? "paused" : "active";
    const response = await client.updateSurvey(survey.id, { projectId, environmentId }, { status: nextStatus });
    setSurveys((current) => current.map((row) => (row.id === survey.id ? response.survey : row)));
  }

  async function archiveSurvey(survey: Survey) {
    if (!projectId || !environmentId || !client.archiveSurvey) return;
    await client.archiveSurvey(survey.id, { projectId, environmentId });
    setSurveys((current) => current.filter((row) => row.id !== survey.id));
    setSelectedSurveyId((current) => (current === survey.id ? surveys.find((row) => row.id !== survey.id)?.id ?? "" : current));
    setSurveyState((current) => (surveys.length <= 1 ? "empty" : current));
  }

  async function pauseFlag(flag: FeatureFlag) {
    if (!projectId || !environmentId || !client.updateFeatureFlag) return;
    const nextStatus = flag.status === "active" ? "paused" : "active";
    const response = await client.updateFeatureFlag(flag.id, { projectId, environmentId }, { status: nextStatus });
    setFlags((current) => current.map((row) => (row.id === flag.id ? response.flag : row)));
  }

  async function archiveFlag(flag: FeatureFlag) {
    if (!projectId || !environmentId || !client.archiveFeatureFlag) return;
    await client.archiveFeatureFlag(flag.id, { projectId, environmentId });
    setFlags((current) => current.filter((row) => row.id !== flag.id));
    setFlagsState((current) => (flags.length <= 1 ? "empty" : current));
  }

  async function createBetaProgram() {
    if (!projectId || !environmentId || !client.createBetaProgram) return;
    if (!betaDraft.key.trim() || !betaDraft.name.trim()) {
      setBetaError("Program key and name are required.");
      return;
    }
    setBetaError("");
    const response = await client.createBetaProgram({
      projectId,
      environmentId,
      key: betaDraft.key,
      name: betaDraft.name,
      status: "active",
      actorType: "user",
      featureFlagId: betaDraft.featureFlagId || null,
      featureFlagVariant: "on"
    });
    setBetaPrograms((current) => [response.program, ...current]);
    setSelectedBetaId(response.program.id);
    setBetaState("ready");
  }

  async function addBetaParticipant() {
    if (!projectId || !environmentId || !selectedBeta || !client.addBetaProgramParticipant) return;
    const actorId = betaDraft.participantId.trim();
    if (!actorId) {
      setBetaError("Participant id is required.");
      return;
    }
    setBetaError("");
    const response = await client.addBetaProgramParticipant(selectedBeta.id, {
      projectId,
      environmentId,
      actorType: selectedBeta.actorType,
      actorId,
      status: "active"
    });
    setBetaParticipants((current) => [response.participant, ...current.filter((participant) => participant.id !== response.participant.id)]);
    setBetaDraft((current) => ({ ...current, participantId: "" }));
  }

  async function removeBetaParticipant(participant: BetaProgramParticipant) {
    if (!projectId || !environmentId || !selectedBeta || !client.removeBetaProgramParticipant) return;
    await client.removeBetaProgramParticipant(selectedBeta.id, participant.id, { projectId, environmentId });
    setBetaParticipants((current) => current.filter((row) => row.id !== participant.id));
  }

  return (
    <section className="panel experiments-panel" aria-labelledby="experiments-title">
      <p className="eyebrow">Project Workspace</p>
      <h1 id="experiments-title">Experiments</h1>
      <p className="muted-text">Create A/B tests, assign variants with the SDK, and read conversion by variant from event telemetry.</p>

      <div className="experiments-form">
        <label>
          Experiment key
          <span>Stable key used by SDK assignment and event properties.</span>
          <input aria-label="Experiment key" value={draft.key} onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))} />
        </label>
        <label>
          Name
          <span>Operator-facing title for this test.</span>
          <input aria-label="Experiment name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
        </label>
        <label>
          Conversion event
          <span>Event counted as success after exposure.</span>
          <input
            aria-label="Conversion event"
            value={draft.conversionEvent}
            onChange={(event) => setDraft((current) => ({ ...current, conversionEvent: event.target.value }))}
          />
        </label>
        <label>
          Variants
          <span>Comma-separated key:weight pairs, for example control:50,treatment:50.</span>
          <input aria-label="Variants" value={draft.variants} onChange={(event) => setDraft((current) => ({ ...current, variants: event.target.value }))} />
        </label>
        <button type="button" onClick={() => void createExperiment()}>
          Create experiment
        </button>
      </div>

      {error ? <p className="status-box unavailable">{error}</p> : null}
      {state === "idle" ? <p className="muted-text">Select a project and environment to analyze experiments.</p> : null}
      {state === "loading" ? <p className="muted-text">Loading experiments</p> : null}
      {state === "unavailable" ? (
        <div className="status-box unavailable">
          <strong>Experiments unavailable</strong>
          <button type="button" onClick={() => setReloadToken((current) => current + 1)}>
            Retry
          </button>
        </div>
      ) : null}

      <label className="experiments-picker">
        Experiment
        <span>Saved experiments for this environment.</span>
        <select aria-label="Experiment" disabled={experiments.length === 0} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          {experiments.length === 0 ? <option value="">No experiments yet</option> : null}
          {experiments.map((experiment) => (
            <option key={experiment.id} value={experiment.id}>
              {experiment.name}
            </option>
          ))}
        </select>
      </label>

      <section className="experiments-readout" aria-label="A/B test readout">
        <div className="panel-header">
          <h2>A/B test readout</h2>
          <span>{results ? `${results.totals.exposures} exposures` : "No result loaded"}</span>
        </div>
        {results ? (
          <div className="experiments-summary" aria-label="Experiment summary">
            <div>
              <span>Exposures</span>
              <strong>{results.totals.exposures}</strong>
            </div>
            <div>
              <span>Conversions</span>
              <strong>{results.totals.conversions}</strong>
            </div>
            <div>
              <span>Variants</span>
              <strong>{results.totals.variants}</strong>
            </div>
          </div>
        ) : null}
        {state === "empty" ? <p className="muted-text">No experiments yet. Create one above, then use the SDK assignment helper in your app.</p> : null}
        {results && results.variants.length > 0 ? (
          <div className="experiments-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Weight</th>
                  <th>Exposures</th>
                  <th>Conversions</th>
                  <th>Conversion rate</th>
                  <th>Lift</th>
                  <th>Interpretation</th>
                </tr>
              </thead>
              <tbody>
                {results.variants.map((row, index) => (
                  <tr key={row.key}>
                    <th scope="row">Variant {row.key}</th>
                    <td>{row.weight}%</td>
                    <td>{row.exposures}</td>
                    <td>{row.conversions}</td>
                    <td>{formatPercent(row.conversionRate)}</td>
                    <td>{formatLift(row.liftPoints)}</td>
                    <td>{interpretation(row, index)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="experiments-readout" aria-label="In-app surveys">
        <div className="panel-header">
          <h2>In-app surveys</h2>
          <span>{surveys.length} definitions</span>
        </div>
        <p className="muted-text">
          Create lightweight product feedback prompts and collect browser-safe responses linked to users, tenants, sessions, and triggering events.
        </p>

        <div className="experiments-form">
          <label>
            Survey key
            <span>Stable key used by the SDK or widget placement.</span>
            <input aria-label="Survey key" value={surveyDraft.key} onChange={(event) => setSurveyDraft((current) => ({ ...current, key: event.target.value }))} />
          </label>
          <label>
            Survey name
            <span>Operator-facing label for this prompt.</span>
            <input aria-label="Survey name" value={surveyDraft.name} onChange={(event) => setSurveyDraft((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label>
            Rating question
            <span>Shown as a 1-5 rating question in the first widget version.</span>
            <input
              aria-label="Survey question"
              value={surveyDraft.question}
              onChange={(event) => setSurveyDraft((current) => ({ ...current, question: event.target.value }))}
            />
          </label>
          <label>
            Trigger event
            <span>Optional event name that should make the survey eligible.</span>
            <input
              aria-label="Survey trigger event"
              value={surveyDraft.triggerEvent}
              onChange={(event) => setSurveyDraft((current) => ({ ...current, triggerEvent: event.target.value }))}
            />
          </label>
          <label>
            Target tenant
            <span>Optional tenant id for a narrow rollout.</span>
            <input
              aria-label="Survey target tenant"
              value={surveyDraft.targetTenantId}
              onChange={(event) => setSurveyDraft((current) => ({ ...current, targetTenantId: event.target.value }))}
            />
          </label>
          <button type="button" onClick={() => void createSurvey()}>
            Create survey
          </button>
        </div>

        {surveyError ? <p className="status-box unavailable">{surveyError}</p> : null}
        {surveyState === "loading" ? <p className="muted-text">Loading surveys</p> : null}
        {surveyState === "unavailable" ? (
          <div className="status-box unavailable">
            <strong>Surveys unavailable</strong>
            <button type="button" onClick={() => setReloadToken((current) => current + 1)}>
              Retry
            </button>
          </div>
        ) : null}
        {surveyState === "empty" ? <p className="muted-text">No surveys yet. Create one above, then submit responses through the SDK.</p> : null}

        {surveys.length > 0 ? (
          <div className="experiments-panel__grid">
            <article>
              <label className="experiments-picker">
                Survey
                <span>Feedback prompt configured for this environment.</span>
                <select aria-label="Survey" value={selectedSurveyId} onChange={(event) => setSelectedSurveyId(event.target.value)}>
                  {surveys.map((survey) => (
                    <option key={survey.id} value={survey.id}>
                      {survey.name}
                    </option>
                  ))}
                </select>
              </label>

              {selectedSurvey ? (
                <>
                  <div className="experiments-summary" aria-label="Survey summary">
                    <div>
                      <span>Status</span>
                      <strong>{selectedSurvey.status}</strong>
                    </div>
                    <div>
                      <span>Trigger</span>
                      <strong>{selectedSurvey.triggerEvent ?? "manual"}</strong>
                    </div>
                    <div>
                      <span>Responses</span>
                      <strong>{surveyResults?.totals.responses ?? 0}</strong>
                    </div>
                  </div>
                  <div className="experiments-row-actions">
                    <button type="button" onClick={() => void pauseSurvey(selectedSurvey)}>
                      {selectedSurvey.status === "active" ? "Pause survey" : "Activate survey"}
                    </button>
                    <button type="button" onClick={() => void archiveSurvey(selectedSurvey)}>
                      Archive survey
                    </button>
                  </div>
                </>
              ) : null}
            </article>

            <article>
              <div className="panel-header">
                <h3>Response report</h3>
                <span>{surveyResults ? `${surveyResults.window} window` : "No report"}</span>
              </div>
              {surveyResults ? (
                <>
                  <div className="experiments-summary" aria-label="Survey response totals">
                    <div>
                      <span>Users</span>
                      <strong>{surveyResults.totals.users}</strong>
                    </div>
                    <div>
                      <span>Tenants</span>
                      <strong>{surveyResults.totals.tenants}</strong>
                    </div>
                    <div>
                      <span>Sessions</span>
                      <strong>{surveyResults.totals.sessions}</strong>
                    </div>
                  </div>
                  <div className="experiments-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Question</th>
                          <th>Type</th>
                          <th>Responses</th>
                          <th>Average / choices</th>
                        </tr>
                      </thead>
                      <tbody>
                        {surveyResults.questions.map((question) => (
                          <tr key={question.id}>
                            <th scope="row">{question.label}</th>
                            <td>{question.type}</td>
                            <td>{question.responses}</td>
                            <td>
                              {question.average !== undefined
                                ? question.average.toFixed(1)
                                : question.choices?.map((choice) => `${choice.value}: ${choice.count}`).join(", ") ?? "none"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="experiments-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Submitted</th>
                          <th>Actor</th>
                          <th>Tenant</th>
                          <th>Answers</th>
                        </tr>
                      </thead>
                      <tbody>
                        {surveyResults.recentResponses.map((response) => (
                          <tr key={response.id}>
                            <th scope="row">{new Date(response.submittedAt).toLocaleString()}</th>
                            <td>
                              {response.actorType} {response.actorId ?? "anonymous"}
                            </td>
                            <td>{response.tenantId ?? "none"}</td>
                            <td>{formatAnswerPreview(response.answers)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {surveyResults.recentResponses.length === 0 ? <p className="muted-text">No responses in this window yet.</p> : null}
                </>
              ) : (
                <p className="muted-text">Select a survey to inspect response quality, actors, and recent answers.</p>
              )}
            </article>
          </div>
        ) : null}
      </section>

      <section className="experiments-readout" aria-label="Feature flags">
        <div className="panel-header">
          <h2>Feature flags</h2>
          <span>{flags.length} active definitions</span>
        </div>
        <p className="muted-text">Create project-scoped flags with safe defaults. The SDK can evaluate the same rules locally and record exposures.</p>

        <div className="experiments-form">
          <label>
            Flag key
            <span>Stable key used in SDK evaluation.</span>
            <input aria-label="Flag key" value={flagDraft.key} onChange={(event) => setFlagDraft((current) => ({ ...current, key: event.target.value }))} />
          </label>
          <label>
            Flag name
            <span>Operator-facing label for this control.</span>
            <input aria-label="Flag name" value={flagDraft.name} onChange={(event) => setFlagDraft((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label>
            Optional enabled user
            <span>When filled, this user receives the on variant.</span>
            <input
              aria-label="Optional enabled user"
              value={flagDraft.enabledUserId}
              onChange={(event) => setFlagDraft((current) => ({ ...current, enabledUserId: event.target.value }))}
            />
          </label>
          <label>
            Rollout percentage
            <span>Gradually enables the on variant for this percent of users.</span>
            <input
              aria-label="Rollout percentage"
              inputMode="decimal"
              min="0"
              max="100"
              type="number"
              value={flagDraft.rolloutPercentage}
              onChange={(event) => setFlagDraft((current) => ({ ...current, rolloutPercentage: event.target.value }))}
            />
          </label>
          <button type="button" onClick={() => void createFlag()}>
            Create flag
          </button>
        </div>

        {flagError ? <p className="status-box unavailable">{flagError}</p> : null}
        {flagsState === "loading" ? <p className="muted-text">Loading feature flags</p> : null}
        {flagsState === "unavailable" ? (
          <div className="status-box unavailable">
            <strong>Feature flags unavailable</strong>
            <button type="button" onClick={() => setReloadToken((current) => current + 1)}>
              Retry
            </button>
          </div>
        ) : null}
        {flagsState === "empty" ? <p className="muted-text">No feature flags yet. Create one with an off fallback before wiring the SDK.</p> : null}
        {flags.length > 0 ? (
          <div className="experiments-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Flag</th>
                  <th>Status</th>
                  <th>Default</th>
                  <th>Variants</th>
                  <th>Rules</th>
                  <th>Rollout</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((flag) => (
                  <tr key={flag.id}>
                    <th scope="row">
                      {flag.key}
                      <span>{flag.name}</span>
                    </th>
                    <td>{flag.status}</td>
                    <td>{flag.defaultVariant}</td>
                    <td>{flag.variants.map((variant) => variant.key).join(", ")}</td>
                    <td>{flag.rules.length}</td>
                    <td>{formatFlagRollout(flag)}</td>
                    <td>
                      <div className="experiments-row-actions">
                        <button type="button" onClick={() => void pauseFlag(flag)}>
                          {flag.status === "active" ? "Pause" : "Activate"}
                        </button>
                        <button type="button" onClick={() => void archiveFlag(flag)}>
                          Archive
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="experiments-readout" aria-label="Beta programs">
        <div className="panel-header">
          <h2>Beta programs</h2>
          <span>{betaPrograms.length} programs</span>
        </div>
        <p className="muted-text">Manage early access cohorts and optionally sync active participants into a linked feature flag.</p>

        <div className="experiments-form">
          <label>
            Program key
            <span>Stable id for this early-access group.</span>
            <input aria-label="Beta program key" value={betaDraft.key} onChange={(event) => setBetaDraft((current) => ({ ...current, key: event.target.value }))} />
          </label>
          <label>
            Program name
            <span>Operator-facing name.</span>
            <input aria-label="Beta program name" value={betaDraft.name} onChange={(event) => setBetaDraft((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label>
            Controlled flag
            <span>Optional flag that receives participant targeting rules.</span>
            <select
              aria-label="Controlled flag"
              value={betaDraft.featureFlagId}
              onChange={(event) => setBetaDraft((current) => ({ ...current, featureFlagId: event.target.value }))}
            >
              <option value="">No linked flag</option>
              {flags.map((flag) => (
                <option key={flag.id} value={flag.id}>
                  {flag.key}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void createBetaProgram()}>
            Create beta program
          </button>
        </div>

        {betaError ? <p className="status-box unavailable">{betaError}</p> : null}
        {betaState === "loading" ? <p className="muted-text">Loading beta programs</p> : null}
        {betaState === "unavailable" ? (
          <div className="status-box unavailable">
            <strong>Beta programs unavailable</strong>
            <button type="button" onClick={() => setReloadToken((current) => current + 1)}>
              Retry
            </button>
          </div>
        ) : null}
        {betaState === "empty" ? <p className="muted-text">No beta programs yet. Create one and add users or tenants below.</p> : null}

        {betaPrograms.length > 0 ? (
          <div className="experiments-panel__grid">
            <article>
              <label className="experiments-picker">
                Program
                <span>Early-access program for this environment.</span>
                <select aria-label="Beta program" value={selectedBetaId} onChange={(event) => setSelectedBetaId(event.target.value)}>
                  {betaPrograms.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectedBeta ? (
                <div className="experiments-summary" aria-label="Beta program summary">
                  <div>
                    <span>Status</span>
                    <strong>{selectedBeta.status}</strong>
                  </div>
                  <div>
                    <span>Participants</span>
                    <strong>{betaAdoption?.participants ?? betaParticipants.length}</strong>
                  </div>
                  <div>
                    <span>Adoption</span>
                    <strong>{(betaAdoption?.adoptionRate ?? 0).toFixed(1)}% adoption</strong>
                  </div>
                </div>
              ) : null}
              <div className="experiments-form compact">
                <label>
                  Participant id
                  <span>User or tenant id, according to program actor type.</span>
                  <input
                    aria-label="Participant id"
                    value={betaDraft.participantId}
                    onChange={(event) => setBetaDraft((current) => ({ ...current, participantId: event.target.value }))}
                  />
                </label>
                <button type="button" onClick={() => void addBetaParticipant()}>
                  Add participant
                </button>
              </div>
            </article>
            <article>
              <div className="panel-header">
                <h3>Participants</h3>
                <span>{betaParticipants.length}</span>
              </div>
              {betaParticipants.length === 0 ? <p className="muted-text">No participants yet.</p> : null}
              <div className="experiments-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Actor</th>
                      <th>Status</th>
                      <th>Notes</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {betaParticipants.map((participant) => (
                      <tr key={participant.id}>
                        <th scope="row">{participant.actorId}</th>
                        <td>{participant.status}</td>
                        <td>{participant.notes ?? "none"}</td>
                        <td>
                          <button type="button" onClick={() => void removeBetaParticipant(participant)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        ) : null}
      </section>
    </section>
  );
}
