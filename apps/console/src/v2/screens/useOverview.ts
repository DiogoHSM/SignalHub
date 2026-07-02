import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { OperationsResponse, OverviewWindow, ReleaseSummary } from "../../api/types";

// ---------------------------------------------------------------------------
// OverviewVM — the view-model the Overview screen consumes
// ---------------------------------------------------------------------------

export type BannerVM = {
  incidents: number;
  alerts: number;
  top: { message: string; severity: string; path?: string } | null;
};

export type KpisVM = {
  // raw kpi values
  events: number;
  activeUsers: number;
  activeTenants: number;
  errors: number;
  traces: number;
  failedTraces: number;
  p95TraceDurationMs: number | null;
  averageTraceDurationMs: number | null;
  llmCalls: number;
  llmCostUsd: string;
  // computed
  errorRate: number | null;
  topModel: string | null;
  // sparklines — last 12 buckets of each trend series
  errorsSparkline: number[];
  usageSparkline: number[];
  latencySparkline: number[];
  aiCostSparkline: number[];
};

export type TenantVM = {
  id: string;
  name: string;
  events: number;
  costUsd: string;
  errors: number;
};

export type LlmByModelVM = {
  model: string;
  costUsd: string;
};

export type ActivityKind = "error" | "trace" | "llm";

export type ActivityItemVM = {
  kind: ActivityKind;
  title: string;
  sub: string | null;
  timestamp: string;
};

export type OverviewVM = {
  banner: BannerVM;
  kpis: KpisVM;
  topTenants: TenantVM[];
  llmByModel: LlmByModelVM[];
  releases: ReleaseSummary[];
  selectedRelease: string | null;
  selectRelease: (release: string | null) => void;
  activity: ActivityItemVM[];
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type UseOverviewOptions = {
  client: Pick<ApiClient, "getOverview" | "listEntityTenants"> & {
    getOperations?: ApiClient["getOperations"];
    listReleases?: ApiClient["listReleases"];
  };
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
};

export type UseOverviewResult = {
  data: OverviewVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
  selectedRelease: string | null;
  selectRelease: (release: string | null) => void;
};

const SPARKLINE_BUCKETS = 12;
const TOP_TENANTS_LIMIT = 5;
const TOP_RELEASES_LIMIT = 5;

function buildBanner(ops: OperationsResponse | null): BannerVM {
  if (!ops) {
    return { incidents: 0, alerts: 0, top: null };
  }

  const incidents = (ops.summary.incidents.open ?? 0) + (ops.summary.incidents.investigating ?? 0);
  const alerts = ops.summary.alerts.events.total;
  const topIncident = ops.recent.incidents[0] ?? null;

  return {
    incidents,
    alerts,
    top: topIncident
      ? { message: topIncident.message, severity: topIncident.severity }
      : null
  };
}

function lastN<T>(arr: T[], n: number): T[] {
  return arr.length <= n ? arr : arr.slice(arr.length - n);
}

export function useOverview({
  client,
  projectId,
  environmentId,
  window: timeWindow
}: UseOverviewOptions): UseOverviewResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<OverviewVM | null>(null);
  const [tick, setTick] = useState(0);
  const [selectedRelease, setSelectedRelease] = useState<string | null>(null);
  const genRef = useRef(0);

  const reload = useCallback(() => {
    setStatus("loading");
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const gen = ++genRef.current;
    setStatus("loading");

    const query = selectedRelease
      ? { projectId, environmentId, window: timeWindow, release: selectedRelease }
      : { projectId, environmentId, window: timeWindow };

    const opsPromise: Promise<OperationsResponse | null> = client.getOperations
      ? client.getOperations(query).then((r) => r.data)
      : Promise.resolve(null);
    const releasesPromise = client.listReleases
      ? client
          .listReleases({ projectId, environmentId, window: timeWindow, limit: TOP_RELEASES_LIMIT })
          .then((r) => r.data)
      : Promise.resolve({
          window: timeWindow,
          generatedAt: "",
          scope: { projectId, environmentId },
          range: { from: "", to: "" },
          releases: []
        });

    Promise.all([
      client.getOverview(query).then((r) => r.data),
      opsPromise,
      client
        .listEntityTenants({ ...query, limit: TOP_TENANTS_LIMIT })
        .then((r) => r.data),
      releasesPromise
    ])
      .then(([overview, ops, tenantList, releaseList]) => {
        if (gen !== genRef.current) return;

        // banner
        const banner = buildBanner(ops);

        // kpis
        const { kpis, trends, top } = overview;
        const errorRate = kpis.traces > 0 ? (kpis.errors / kpis.traces) * 100 : null;
        const topModel = top.llmModels[0]?.model ?? null;
        const errorsSparkline = lastN(trends.errors, SPARKLINE_BUCKETS).map((b) => b.errors);
        const usageSparkline = lastN(trends.usage, SPARKLINE_BUCKETS).map((b) => b.events);
        const latencySparkline = lastN(trends.latency, SPARKLINE_BUCKETS).map(
          (b) => b.p95TraceDurationMs ?? b.averageTraceDurationMs
        );
        const aiCostSparkline = lastN(trends.aiCost, SPARKLINE_BUCKETS).map((b) =>
          parseFloat(b.llmCostUsd)
        );

        const kpisVM: KpisVM = {
          events: kpis.events,
          activeUsers: kpis.activeUsers,
          activeTenants: kpis.activeTenants,
          errors: kpis.errors,
          traces: kpis.traces,
          failedTraces: kpis.failedTraces,
          p95TraceDurationMs: kpis.p95TraceDurationMs,
          averageTraceDurationMs: kpis.averageTraceDurationMs ?? null,
          llmCalls: kpis.llmCalls,
          llmCostUsd: kpis.llmCostUsd,
          errorRate,
          topModel,
          errorsSparkline,
          usageSparkline,
          latencySparkline,
          aiCostSparkline
        };

        // topTenants — sort by events desc, limit 5
        const topTenants: TenantVM[] = [...tenantList.tenants]
          .sort((a, b) => b.events - a.events)
          .slice(0, TOP_TENANTS_LIMIT)
          .map((t) => ({
            id: t.tenantId ?? "",
            name: t.label,
            events: t.events,
            costUsd: t.llmCostUsd,
            errors: t.errors
          }));

        // llmByModel
        const llmByModel: LlmByModelVM[] = top.llmModels.map((m) => ({
          model: m.model,
          costUsd: m.totalCostUsd
        }));

        // activity — merge & sort desc
        const activity: ActivityItemVM[] = [
          ...overview.recent.errors.map((e) => ({
            kind: "error" as const,
            title: e.message,
            sub: e.type,
            timestamp: e.timestamp
          })),
          ...overview.recent.failedTraces.map((t) => ({
            kind: "trace" as const,
            title: t.name,
            sub: t.status,
            timestamp: t.timestamp
          })),
          ...overview.recent.failedLlmCalls.map((l) => ({
            kind: "llm" as const,
            title: `${l.provider} / ${l.model}${l.promptName ? ` (${l.promptName})` : ""}`,
            sub: l.status,
            timestamp: l.timestamp
          }))
        ].sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));

        setData({
          banner,
          kpis: kpisVM,
          topTenants,
          llmByModel,
          releases: releaseList.releases,
          selectedRelease,
          selectRelease: setSelectedRelease,
          activity
        });
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
  }, [projectId, environmentId, timeWindow, selectedRelease, tick]);

  return { data, status, reload, selectedRelease, selectRelease: setSelectedRelease };
}
