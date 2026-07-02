import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api/client";
import type { Experiment, ExperimentResultsResponse } from "../api/types";

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

export function ExperimentsPanel({ client, projectId, environmentId }: Props) {
  const [draft, setDraft] = useState(defaultDraft);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [results, setResults] = useState<ExperimentResultsResponse | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState("");
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

  const selected = useMemo(() => experiments.find((experiment) => experiment.id === selectedId) ?? null, [experiments, selectedId]);

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
    </section>
  );
}
