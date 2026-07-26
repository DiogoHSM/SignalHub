import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../../../api/client";
import type {
  Experiment,
  ExperimentResultsResponse,
  ExperimentStatus,
  ExperimentVariantResult,
} from "../../../api/types";

// ---------------------------------------------------------------------------
// Pure functions — ported 1:1 from ExperimentsPanel.tsx
// ---------------------------------------------------------------------------

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatLift(value: number | null): string {
  if (value === null) return "Baseline";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} pp`;
}

export function parseVariants(value: string): Array<{ key: string; name: string; weight: number }> {
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

export function interpretation(row: ExperimentVariantResult, index: number): string {
  if (index === 0) return "Baseline";
  if (row.exposures < 30) return "Needs sample";
  if (row.liftPoints === null || Math.abs(row.liftPoints) < 0.5) return "Flat";
  return row.liftPoints > 0 ? "Directional lead" : "Directional lag";
}

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type ExperimentRowVM = {
  id: string;
  key: string;
  name: string;
  status: ExperimentStatus;
  variantsLabel: string;
  conversionEvent: string;
};

export type ExperimentVariantRowVM = {
  key: string;
  weight: number;
  exposures: number;
  conversions: number;
  conversionRateLabel: string;
  liftLabel: string;
  interpretationLabel: string;
};

export type SelectedExperimentVM = {
  id: string;
  totals: { exposures: number; conversions: number; variants: number };
  variants: ExperimentVariantRowVM[];
};

export type AbTestsVM = {
  rows: ExperimentRowVM[];
  selected: SelectedExperimentVM | null;
};

export type CreateExperimentForm = {
  key: string;
  name: string;
  conversionEvent: string;
  variants: string;
};

export type UseAbTestsResult = {
  data: AbTestsVM | null;
  status: "loading" | "ok" | "error";
  busy: boolean;
  reload: () => void;
  createExperiment: (form: CreateExperimentForm) => Promise<boolean>;
  updateExperimentStatus: (id: string, status: ExperimentStatus) => Promise<boolean>;
  archiveExperiment: (id: string) => Promise<boolean>;
};

function toRowVM(e: Experiment): ExperimentRowVM {
  return {
    id: e.id,
    key: e.key,
    name: e.name,
    status: e.status,
    variantsLabel: e.variants.map((v) => `${v.key}:${v.weight}`).join(", "),
    conversionEvent: e.conversionEvent,
  };
}

export function buildAbTestsVM(rows: Experiment[], results: ExperimentResultsResponse | null): AbTestsVM {
  const selected: SelectedExperimentVM | null = results
    ? {
        id: results.experiment.id,
        totals: results.totals,
        variants: results.variants.map((v, i) => ({
          key: v.key,
          weight: v.weight,
          exposures: v.exposures,
          conversions: v.conversions,
          conversionRateLabel: formatPercent(v.conversionRate),
          liftLabel: formatLift(v.liftPoints),
          interpretationLabel: interpretation(v, i),
        })),
      }
    : null;

  return { rows: rows.map(toRowVM), selected };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type UseAbTestsArgs = {
  client: Partial<
    Pick<ApiClient, "listExperiments" | "createExperiment" | "updateExperiment" | "archiveExperiment" | "getExperimentResults">
  >;
  projectId: string | undefined;
  environmentId: string | undefined;
  selectedId: string | undefined;
  enabled: boolean;
};

export function useAbTests({ client, projectId, environmentId, selectedId, enabled }: UseAbTestsArgs): UseAbTestsResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [rows, setRows] = useState<Experiment[]>([]);
  const [results, setResults] = useState<ExperimentResultsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId || !enabled) return;

    if (!client.listExperiments) {
      setStatus("error");
      setRows([]);
      return;
    }

    const gen = ++genRef.current;
    setStatus("loading");

    client
      .listExperiments({ projectId, environmentId })
      .then(({ experiments }) => {
        if (gen !== genRef.current) return;
        setRows(experiments);
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
    if (!projectId || !environmentId || !selectedId || !client.getExperimentResults) {
      setResults(null);
      return;
    }
    let cancelled = false;
    client
      .getExperimentResults({ projectId, environmentId, experimentId: selectedId, window: "30d", limit: 500 })
      .then(({ data }) => {
        if (!cancelled) setResults(data);
      })
      .catch(() => {
        if (!cancelled) setResults(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, projectId, environmentId, selectedId]);

  const data = useMemo<AbTestsVM | null>(() => {
    if (status !== "ok") return null;
    return buildAbTestsVM(rows, results);
  }, [status, rows, results]);

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

  const createExperiment = useCallback(
    (form: CreateExperimentForm) =>
      run(async () => {
        if (!projectId || !environmentId || !client.createExperiment) return;
        const variants = parseVariants(form.variants);
        await client.createExperiment({
          projectId,
          environmentId,
          key: form.key,
          name: form.name,
          status: "running",
          actorType: "user",
          exposureEvent: "sigmon.experiment.exposed",
          conversionEvent: form.conversionEvent,
          variants,
          primaryMetric: { eventName: form.conversionEvent, windowHours: 24 },
        });
      }),
    [client, environmentId, projectId, run],
  );

  const updateExperimentStatus = useCallback(
    (id: string, nextStatus: ExperimentStatus) =>
      run(async () => {
        if (!projectId || !environmentId || !client.updateExperiment) return;
        await client.updateExperiment(id, { projectId, environmentId }, { status: nextStatus });
      }),
    [client, environmentId, projectId, run],
  );

  const archiveExperiment = useCallback(
    (id: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.archiveExperiment) return;
        await client.archiveExperiment(id, { projectId, environmentId });
      }),
    [client, environmentId, projectId, run],
  );

  return { data, status, busy, reload, createExperiment, updateExperimentStatus, archiveExperiment };
}
