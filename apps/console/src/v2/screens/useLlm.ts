import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type {
  LlmCostByModel,
  LlmPromptRow,
  LlmSummary,
  LlmTenantRow,
  OverviewWindow,
} from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type LlmKpis = {
  calls: number;
  costUsd: number;
  runRateUsd: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  errorRate: number; // 0..1
};

export type LlmCostSeriesVM = { model: string; color: string; costs: number[] };
export type LlmCostByModelVM = { buckets: string[]; series: LlmCostSeriesVM[] };

export type LlmTenantVM = {
  tenantId: string;
  calls: number;
  costUsd: number;
  share: number; // 0..1
};

export type LlmPromptVM = {
  promptName: string;
  model: string;
  calls: number;
  avgTokens: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  errorRate: number; // 0..1
  costUsd: number;
};

export type LlmVM = {
  window: OverviewWindow;
  kpis: LlmKpis;
  costByModel: LlmCostByModelVM;
  tenants: LlmTenantVM[];
  prompts: LlmPromptVM[];
};

export type UseLlmResult = {
  data: LlmVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

// ---------------------------------------------------------------------------
// Hook args
// ---------------------------------------------------------------------------

type UseLlmArgs = {
  client: {
    getLlmSummary?: ApiClient["getLlmSummary"];
    getLlmByTenant?: ApiClient["getLlmByTenant"];
    getLlmByPrompt?: ApiClient["getLlmByPrompt"];
    getLlmCostByModel?: ApiClient["getLlmCostByModel"];
  };
  projectId: string | undefined;
  environmentId: string | undefined;
  window: OverviewWindow;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fixed palette assigned by series index (cost-by-model + legend share this). */
export const MODEL_COLORS = [
  "var(--sev-violet)",
  "var(--accent)",
  "var(--sev-info)",
  "var(--sev-warning)",
  "var(--sev-critical)",
];

function toNum(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function errorRate(failed: number, calls: number): number {
  return calls > 0 ? failed / calls : 0;
}

/** Project a window's total cost to a 30-day run-rate. */
function monthlyRunRate(windowCost: number, window: OverviewWindow): number {
  if (window === "24h") return windowCost * 30;
  if (window === "7d") return (windowCost / 7) * 30;
  return windowCost; // 30d
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLlm({ client, projectId, environmentId, window }: UseLlmArgs): UseLlmResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<LlmVM | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId) return;

    const gen = ++genRef.current;
    setStatus("loading");

    const scope = { projectId, environmentId, window };

    const summaryFetch = client.getLlmSummary
      ? client.getLlmSummary(scope)
      : Promise.reject(new Error("getLlmSummary unavailable"));
    const tenantFetch = client.getLlmByTenant
      ? client.getLlmByTenant(scope).catch((e) => { console.error(e); return null; })
      : Promise.resolve(null);
    const promptFetch = client.getLlmByPrompt
      ? client.getLlmByPrompt(scope).catch((e) => { console.error(e); return null; })
      : Promise.resolve(null);
    const costFetch = client.getLlmCostByModel
      ? client.getLlmCostByModel(scope).catch((e) => { console.error(e); return null; })
      : Promise.resolve(null);

    Promise.all([summaryFetch, tenantFetch, promptFetch, costFetch])
      .then(([summaryRes, tenantRes, promptRes, costRes]) => {
        if (gen !== genRef.current) return;

        const summary: LlmSummary = summaryRes.data;
        const summaryCost = toNum(summary.costUsd);

        const kpis: LlmKpis = {
          calls: summary.calls,
          costUsd: summaryCost,
          runRateUsd: monthlyRunRate(summaryCost, window),
          avgLatencyMs: summary.avgLatencyMs,
          p95LatencyMs: summary.p95LatencyMs,
          errorRate: errorRate(summary.failedCalls, summary.calls),
        };

        const tenantRows: LlmTenantRow[] = tenantRes?.data ?? [];
        const tenants: LlmTenantVM[] = tenantRows.map((r) => {
          const cost = toNum(r.costUsd);
          return {
            tenantId: r.tenantId,
            calls: r.calls,
            costUsd: cost,
            share: summaryCost > 0 ? cost / summaryCost : 0,
          };
        });

        const promptRows: LlmPromptRow[] = promptRes?.data ?? [];
        const prompts: LlmPromptVM[] = promptRows.map((r) => ({
          promptName: r.promptName,
          model: r.model,
          calls: r.calls,
          avgTokens: r.avgTokens,
          avgLatencyMs: r.avgLatencyMs,
          p95LatencyMs: r.p95LatencyMs,
          errorRate: errorRate(r.failedCalls, r.calls),
          costUsd: toNum(r.costUsd),
        }));

        const cost: LlmCostByModel = costRes?.data ?? { buckets: [], series: [] };
        const costByModel: LlmCostByModelVM = {
          buckets: cost.buckets,
          series: cost.series.map((s, i) => ({
            model: s.model,
            color: MODEL_COLORS[i % MODEL_COLORS.length],
            costs: s.costs.map(toNum),
          })),
        };

        setData({ window, kpis, costByModel, tenants, prompts });
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, environmentId, window, tick]);

  return { data, status, reload };
}
