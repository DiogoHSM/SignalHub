import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api/client";
import type { EventRecord } from "../api/types";

type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
};

type LoadState = "idle" | "loading" | "ready" | "empty" | "unavailable";

type ExperimentConfig = {
  experimentProperty: string;
  variantProperty: string;
  exposureEvent: string;
  conversionEvent: string;
};

type VariantRow = {
  variant: string;
  exposures: number;
  conversions: number;
  conversionRate: number;
  liftPoints: number | null;
};

type VariantInterpretation = {
  label: string;
  tone: "neutral" | "positive" | "negative" | "warning";
};

const minimumReadableExposures = 30;

const defaultConfig: ExperimentConfig = {
  experimentProperty: "experiment",
  variantProperty: "variant",
  exposureEvent: "checkout.exposed",
  conversionEvent: "checkout.completed"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function propertyValue(event: EventRecord, property: string): string | null {
  if (!isRecord(event.properties)) return null;
  const value = event.properties[property];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatLift(value: number | null): string {
  if (value === null) return "Baseline";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)} pp`;
}

function interpretVariant(row: VariantRow, index: number): VariantInterpretation {
  if (index === 0) return { label: "Baseline", tone: "neutral" };
  if (row.exposures < minimumReadableExposures) return { label: "Needs sample", tone: "warning" };
  if (row.liftPoints === null || Math.abs(row.liftPoints) < 0.005) return { label: "Flat", tone: "neutral" };
  return row.liftPoints > 0
    ? { label: "Directional lead", tone: "positive" }
    : { label: "Directional lag", tone: "negative" };
}

function listExperiments(events: EventRecord[], config: ExperimentConfig): string[] {
  const experiments = new Set<string>();
  for (const event of events) {
    const experiment = propertyValue(event, config.experimentProperty);
    if (experiment) experiments.add(experiment);
  }
  return Array.from(experiments).sort((left, right) => left.localeCompare(right));
}

function buildVariantRows(events: EventRecord[], config: ExperimentConfig): VariantRow[] {
  const variants = new Map<string, { exposures: number; conversions: number }>();

  for (const event of events) {
    const experiment = propertyValue(event, config.experimentProperty);
    const variant = propertyValue(event, config.variantProperty);
    if (!experiment || !variant) continue;

    const current = variants.get(variant) ?? { exposures: 0, conversions: 0 };
    if (event.name === config.exposureEvent) current.exposures += 1;
    if (event.name === config.conversionEvent) current.conversions += 1;
    variants.set(variant, current);
  }

  const rows = Array.from(variants, ([variant, counts]) => ({
    variant,
    exposures: counts.exposures,
    conversions: counts.conversions,
    conversionRate: counts.exposures === 0 ? 0 : counts.conversions / counts.exposures,
    liftPoints: null
  })).sort((left, right) => left.variant.localeCompare(right.variant));

  const baselineRate = rows[0]?.conversionRate ?? null;
  return rows.map((row, index) => ({
    ...row,
    liftPoints: index === 0 || baselineRate === null ? null : row.conversionRate - baselineRate
  }));
}

export function ExperimentsPanel({ client, projectId, environmentId }: Props) {
  const [draftConfig, setDraftConfig] = useState<ExperimentConfig>(defaultConfig);
  const [config, setConfig] = useState<ExperimentConfig>(defaultConfig);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedExperiment, setSelectedExperiment] = useState("");

  useEffect(() => {
    if (!projectId || !environmentId) {
      setEvents([]);
      setState("idle");
      return;
    }

    let cancelled = false;
    setState("loading");
    void client.listEvents({ projectId, environmentId, limit: 500 }).then(
      ({ data }) => {
        if (cancelled) return;
        setEvents(data);
        setState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setEvents([]);
        setState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId, reloadToken]);

  const experimentNames = useMemo(() => listExperiments(events, config), [events, config]);

  useEffect(() => {
    setSelectedExperiment((current) => {
      if (experimentNames.length === 0) return "";
      return experimentNames.includes(current) ? current : experimentNames[0];
    });
  }, [experimentNames]);

  const experimentEvents = useMemo(() => {
    if (!selectedExperiment) return events;
    return events.filter((event) => propertyValue(event, config.experimentProperty) === selectedExperiment);
  }, [config.experimentProperty, events, selectedExperiment]);

  const rows = useMemo(() => buildVariantRows(experimentEvents, config), [experimentEvents, config]);
  const totalExposures = rows.reduce((sum, row) => sum + row.exposures, 0);
  const totalConversions = rows.reduce((sum, row) => sum + row.conversions, 0);
  const bestVariant = rows.reduce<VariantRow | null>(
    (best, row) => (best === null || row.conversionRate > best.conversionRate ? row : best),
    null
  );

  function updateField(field: keyof ExperimentConfig, value: string) {
    setDraftConfig((current) => ({ ...current, [field]: value }));
  }

  function applyConfig() {
    setConfig({
      experimentProperty: draftConfig.experimentProperty.trim() || defaultConfig.experimentProperty,
      variantProperty: draftConfig.variantProperty.trim() || defaultConfig.variantProperty,
      exposureEvent: draftConfig.exposureEvent.trim() || defaultConfig.exposureEvent,
      conversionEvent: draftConfig.conversionEvent.trim() || defaultConfig.conversionEvent
    });
  }

  return (
    <section className="panel experiments-panel" aria-labelledby="experiments-title">
      <p className="eyebrow">Project Workspace</p>
      <h1 id="experiments-title">Experiments</h1>
      <p className="muted-text">Event-based A/B readouts from telemetry properties already sent to Sigmon.</p>

      <form
        className="experiments-form"
        onSubmit={(event) => {
          event.preventDefault();
          applyConfig();
        }}
      >
        <label>
          Experiment property
          <span>Event property used to group tests.</span>
          <input
            aria-label="Experiment property"
            value={draftConfig.experimentProperty}
            onChange={(event) => updateField("experimentProperty", event.target.value)}
          />
        </label>
        <label>
          Variant property
          <span>Event property used to identify each arm.</span>
          <input
            aria-label="Variant property"
            value={draftConfig.variantProperty}
            onChange={(event) => updateField("variantProperty", event.target.value)}
          />
        </label>
        <label>
          Exposure event
          <span>Event counted as a visitor seeing the variant.</span>
          <input
            aria-label="Exposure event"
            value={draftConfig.exposureEvent}
            onChange={(event) => updateField("exposureEvent", event.target.value)}
          />
        </label>
        <label>
          Conversion event
          <span>Event counted as success for the variant.</span>
          <input
            aria-label="Conversion event"
            value={draftConfig.conversionEvent}
            onChange={(event) => updateField("conversionEvent", event.target.value)}
          />
        </label>
        <button type="submit">Apply experiment</button>
      </form>

      {state === "idle" ? <p className="muted-text">Select a project and environment to analyze experiments.</p> : null}
      {state === "loading" ? <p className="muted-text">Loading experiment events</p> : null}
      {state === "unavailable" ? (
        <div className="status-box unavailable">
          <strong>Experiment events unavailable</strong>
          <button type="button" onClick={() => setReloadToken((current) => current + 1)}>
            Retry events
          </button>
        </div>
      ) : null}

      <label className="experiments-picker">
        Experiment
        <span>Detected from the configured experiment property.</span>
        <select
          aria-label="Experiment"
          disabled={experimentNames.length === 0}
          value={selectedExperiment}
          onChange={(event) => setSelectedExperiment(event.target.value)}
        >
          {experimentNames.length === 0 ? <option value="">No experiments found</option> : null}
          {experimentNames.map((experiment) => (
            <option key={experiment} value={experiment}>
              {experiment}
            </option>
          ))}
        </select>
      </label>

      <section className="experiments-readout" aria-label="A/B test readout">
        <div className="panel-header">
          <h2>A/B test readout</h2>
          <span>{rows.length} variants from {experimentEvents.length} events</span>
        </div>
        {rows.length > 0 ? (
          <div className="experiments-summary" aria-label="Experiment summary">
            <div>
              <span>Exposures</span>
              <strong>{totalExposures}</strong>
            </div>
            <div>
              <span>Conversions</span>
              <strong>{totalConversions}</strong>
            </div>
            <div>
              <span>Top variant</span>
              <strong>{bestVariant ? `Variant ${bestVariant.variant}` : "none"}</strong>
            </div>
          </div>
        ) : null}
        {(state === "empty" || (state !== "loading" && state !== "unavailable" && rows.length === 0)) ? (
          <p className="muted-text">No matching experiment variants in the current event sample.</p>
        ) : null}
        {rows.length > 0 ? (
          <div className="experiments-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Exposures</th>
                  <th>Conversions</th>
                  <th>Conversion rate</th>
                  <th>Lift</th>
                  <th>Interpretation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const interpretation = interpretVariant(row, index);
                  return (
                    <tr key={row.variant}>
                      <th scope="row">Variant {row.variant}</th>
                      <td>{row.exposures} exposures</td>
                      <td>{row.conversions} conversions</td>
                      <td>{formatPercent(row.conversionRate)}</td>
                      <td>{formatLift(row.liftPoints)}</td>
                      <td>
                        <span className={`experiments-interpretation ${interpretation.tone}`}>{interpretation.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </section>
  );
}
