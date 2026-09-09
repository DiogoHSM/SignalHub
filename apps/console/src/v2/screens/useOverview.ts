import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type {
  OperationsAnomaly,
  OperationsPrediction,
  OperationsResponse,
  OverviewResponse,
  OverviewWindow,
  ReleaseSummary
} from "../../api/types";

// ---------------------------------------------------------------------------
// OverviewVM — the view-model the Overview screen consumes
// ---------------------------------------------------------------------------

export type BannerVM = {
  incidents: number;
  alerts: number;
  top: { message: string; severity: string; groupId: string; errorId: string | null; path?: string } | null;
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
  errorId?: string;
  groupId?: string;
  tenantId?: string | null;
};

export type OperationsDestination =
  | "alerts"
  | "events"
  | "incident"
  | "incidents"
  | "investigate"
  | "llm"
  | "monitors"
  | "overview"
  | "settings"
  | "traces";

export type RecommendedActionVM = {
  key: string;
  title: string;
  description: string;
  action: string;
  tone: "neutral" | "warning" | "critical";
  destination: OperationsDestination;
  groupId?: string;
  errorId?: string;
};

export type PredictionVM = {
  id: string;
  label: string;
  severity: OperationsPrediction["severity"];
  score: number;
  confidence: OperationsPrediction["confidence"];
  probabilityPercent: number;
  baselineRiskScore: number;
  delta: number;
  sampleSize: number;
  baselineSampleSize: number;
  method: string;
  destination: OperationsDestination;
  factors: OperationsPrediction["factors"];
};

export type AnomalyVM = {
  id: string;
  label: string;
  severity: OperationsAnomaly["severity"];
  observedValue: number;
  baselineValue: number;
  changePercent: number | null;
  sampleSize: number;
  baselineSampleSize: number;
  threshold: string;
  reason: string;
  suggestedAlertRuleType: OperationsAnomaly["suggestedAlertRuleType"];
  destination: OperationsDestination;
};

export type OperationsVM = {
  posture: {
    status: OperationsResponse["status"] | "unknown";
    monitors: { total: number; up: number; down: number; degraded: number; paused: number; unknown: number };
    alerts: { enabledRules: number; events: number; critical: number; deliveryFailed: number };
    setupGaps: Array<{
      key: string;
      label: string;
      severity: "info" | "warning";
      destination: OperationsDestination;
    }>;
  };
  recommendedActions: RecommendedActionVM[];
  predictions: PredictionVM[];
  anomalies: AnomalyVM[];
  topLatency: OperationsResponse["topLatency"];
};

export type OverviewVM = {
  coverage?: TelemetryCoverageVM;
  banner: BannerVM;
  operations: OperationsVM;
  kpis: KpisVM;
  topTenants: TenantVM[];
  llmByModel: LlmByModelVM[];
  releases: ReleaseSummary[];
  selectedRelease: string | null;
  selectRelease: (release: string | null) => void;
  activity: ActivityItemVM[];
};

export type TelemetryCoverageVM = {
  state: "missing" | "insufficient" | "stale" | "healthy" | "incidents" | "attention" | "unknown";
  signalCount: number;
  lastSignalAt: string | null;
  generatedAt: string;
};

export function buildTelemetryCoverage(overview: OverviewResponse, ops: OperationsResponse | null): TelemetryCoverageVM {
  const signalCount = overview.kpis.events + overview.kpis.errors + overview.kpis.traces + overview.kpis.llmCalls;
  const timestamps = ops ? [ops.summary.telemetry.lastEventAt, ops.summary.telemetry.lastErrorAt, ops.summary.telemetry.lastTraceAt] : [];
  const lastSignalAt = timestamps.filter((value): value is string => !!value && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const baselineSupported = ops?.predictions?.some((prediction) => prediction.validation.sampleSize > 0 && prediction.validation.baselineSampleSize > 0 && prediction.confidence !== "low");
  let state: TelemetryCoverageVM["state"] = "unknown";
  if (ops) {
    if (ops.summary.incidents.open + ops.summary.incidents.investigating > 0) state = "incidents";
    // Operations timestamps exclude LLM calls. Current LLM activity prevents a
    // stale verdict based only on the older event/error/trace timestamps.
    else if (lastSignalAt && Date.parse(lastSignalAt) < Date.parse(overview.range.from)) state = overview.kpis.llmCalls > 0 ? "unknown" : "stale";
    else if (signalCount === 0) state = "missing";
    else if (!lastSignalAt) state = "unknown";
    else if (!baselineSupported) state = "insufficient";
    else state = ops.status === "healthy" ? "healthy" : "attention";
  }
  return { state, signalCount, lastSignalAt, generatedAt: overview.generatedAt };
}

function supportedPrediction(prediction: OperationsPrediction): boolean {
  return prediction.validation.sampleSize > 0 && prediction.validation.baselineSampleSize > 0;
}

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
  const topIncident = ops.recent.incidents.find((incident) => incident.status === "open" || incident.status === "investigating") ?? null;

  return {
    incidents,
    alerts,
    top: topIncident
      ? { message: topIncident.message, severity: topIncident.severity, groupId: topIncident.id, errorId: topIncident.latestErrorId }
      : null
  };
}

function predictionSeverityRank(severity: OperationsPrediction["severity"]): number {
  if (severity === "critical") return 4;
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function predictionDestination(
  drilldown: OperationsPrediction["suggestedDrilldown"]
): OperationsDestination {
  return drilldown === "errors" ? "investigate" : drilldown === "operations" ? "overview" : drilldown;
}

function anomalyDestination(drilldown: OperationsAnomaly["drilldown"]): OperationsDestination {
  return drilldown === "errors" ? "investigate" : drilldown;
}

function setupDestination(action: OperationsResponse["setupGaps"][number]["action"]): OperationsDestination {
  if (action === "setup") return "settings";
  return action;
}

function actionLabel(destination: OperationsDestination): string {
  if (destination === "investigate" || destination === "incidents" || destination === "incident") return "Open incident";
  if (destination === "overview") return "Review operations";
  return `Open ${destination}`;
}

function buildRecommendedActions(data: OperationsResponse): RecommendedActionVM[] {
  const actions: RecommendedActionVM[] = [];
  const predictions = [...(data.predictions ?? [])].filter(supportedPrediction).sort((left, right) => {
    const severity = predictionSeverityRank(right.severity) - predictionSeverityRank(left.severity);
    return severity || right.score - left.score;
  });
  const topPrediction = predictions[0];
  const topAnomaly = data.anomalies[0];
  const activeIncidents = data.summary.incidents.open + data.summary.incidents.investigating;
  const downMonitors = data.summary.monitors.http.down + data.summary.monitors.heartbeat.down;
  const degradedMonitors = data.summary.monitors.http.degraded + data.summary.monitors.heartbeat.degraded;
  const monitorGaps = data.setupGaps.filter((gap) => gap.action === "monitors").length;
  const slowestTrace = data.topLatency[0];

  if (topPrediction && (topPrediction.severity === "high" || topPrediction.severity === "critical")) {
    const destination = predictionDestination(topPrediction.suggestedDrilldown);
    actions.push({
      key: `prediction-${topPrediction.id}`,
      title: topPrediction.severity === "critical" ? "Act on critical predicted risk" : "Review high predicted risk",
      description: `${topPrediction.label}: review the contributing signals across ${topPrediction.validation.sampleSize} current samples.`,
      action: actionLabel(destination),
      tone: topPrediction.severity === "critical" ? "critical" : "warning",
      destination
    });
  }

  if (topAnomaly) {
    const destination = topAnomaly.suggestedAlertRuleType ? "alerts" : anomalyDestination(topAnomaly.drilldown);
    actions.push({
      key: `anomaly-${topAnomaly.id}`,
      title: topAnomaly.severity === "critical" ? "Respond to critical anomaly" : "Review detected anomaly",
      description: `${topAnomaly.label}: ${topAnomaly.reason}`,
      action: topAnomaly.suggestedAlertRuleType ? "Review alert rule" : actionLabel(destination),
      tone: topAnomaly.severity === "critical" ? "critical" : topAnomaly.severity === "warning" ? "warning" : "neutral",
      destination
    });
  }

  if (activeIncidents > 0) {
    const incident = data.recent.incidents[0];
    actions.push({
      key: "incidents",
      title: "Investigate active incidents",
      description: `${activeIncidents} active incidents, including ${data.summary.incidents.high} high priority.`,
      action: incident ? "Open incident" : "Open incidents",
      tone: data.summary.incidents.urgent > 0 ? "critical" : "warning",
      destination: incident ? "incident" : "incidents",
      groupId: incident?.id,
      errorId: incident?.latestErrorId ?? undefined
    });
  }

  if (downMonitors > 0 || degradedMonitors > 0 || monitorGaps > 0) {
    actions.push({
      key: "monitors",
      title: downMonitors > 0 ? "Recover down monitors" : "Fix monitor coverage gaps",
      description: downMonitors > 0
        ? `${downMonitors} monitors are down and ${degradedMonitors} are degraded.`
        : `${monitorGaps} monitor setup gaps are still open.`,
      action: "Open monitors",
      tone: downMonitors > 0 ? "critical" : "warning",
      destination: "monitors"
    });
  }

  if (data.summary.alerts.events.critical > 0 || data.summary.alerts.events.deliveryFailed > 0) {
    actions.push({
      key: "alerts",
      title: data.summary.alerts.events.critical > 0 ? "Review critical alert firings" : "Review failed alert deliveries",
      description: `${data.summary.alerts.events.critical} critical alerts and ${data.summary.alerts.events.deliveryFailed} failed deliveries in this window.`,
      action: "Open alerts",
      tone: data.summary.alerts.events.critical > 0 ? "critical" : "warning",
      destination: "alerts"
    });
  }

  if (slowestTrace && slowestTrace.p95TraceDurationMs >= 500) {
    actions.push({
      key: "latency",
      title: "Inspect slow traces",
      description: `p95 latency is ${slowestTrace.p95TraceDurationMs} ms across ${slowestTrace.traces} traces.`,
      action: "Open traces",
      tone: slowestTrace.failedTraces > 0 ? "warning" : "neutral",
      destination: "traces"
    });
  }

  if (data.summary.telemetry.errorRatePercent !== null && data.summary.telemetry.errorRatePercent >= 5) {
    actions.push({
      key: "error-rate",
      title: "Check error-rate outlier",
      description: `Error rate is ${data.summary.telemetry.errorRatePercent.toFixed(1)}% for this window.`,
      action: "Open errors",
      tone: data.summary.telemetry.errorRatePercent >= 10 ? "critical" : "warning",
      destination: "investigate"
    });
  }

  const toneRank: Record<RecommendedActionVM["tone"], number> = {
    critical: 3,
    warning: 2,
    neutral: 1
  };
  return actions.sort((left, right) => toneRank[right.tone] - toneRank[left.tone]).slice(0, 4);
}

function buildOperations(ops: OperationsResponse | null): OperationsVM {
  if (!ops) {
    return {
      posture: {
        status: "unknown",
        monitors: { total: 0, up: 0, down: 0, degraded: 0, paused: 0, unknown: 0 },
        alerts: { enabledRules: 0, events: 0, critical: 0, deliveryFailed: 0 },
        setupGaps: []
      },
      recommendedActions: [],
      predictions: [],
      anomalies: [],
      topLatency: []
    };
  }

  const monitorStatus = [ops.summary.monitors.http, ops.summary.monitors.heartbeat];
  const predictions = [...(ops.predictions ?? [])]
    .filter(supportedPrediction)
    .sort((left, right) => {
      const severity = predictionSeverityRank(right.severity) - predictionSeverityRank(left.severity);
      return severity || right.score - left.score;
    })
    .map((prediction): PredictionVM => ({
      id: prediction.id,
      label: prediction.label,
      severity: prediction.severity,
      score: prediction.score,
      confidence: prediction.confidence,
      probabilityPercent: prediction.probabilityPercent,
      baselineRiskScore: prediction.validation.baselineRiskScore,
      delta: prediction.validation.delta,
      sampleSize: prediction.validation.sampleSize,
      baselineSampleSize: prediction.validation.baselineSampleSize,
      method: prediction.validation.method,
      destination: predictionDestination(prediction.suggestedDrilldown),
      factors: [...prediction.factors].sort((left, right) => right.weight - left.weight).slice(0, 3)
    }));

  return {
    posture: {
      status: ops.status,
      monitors: {
        total: ops.summary.monitors.total,
        up: monitorStatus.reduce((sum, counts) => sum + counts.up, 0),
        down: monitorStatus.reduce((sum, counts) => sum + counts.down, 0),
        degraded: monitorStatus.reduce((sum, counts) => sum + counts.degraded, 0),
        paused: monitorStatus.reduce((sum, counts) => sum + counts.paused, 0),
        unknown: monitorStatus.reduce((sum, counts) => sum + counts.unknown, 0)
      },
      alerts: {
        enabledRules: ops.summary.alerts.rules.enabled,
        events: ops.summary.alerts.events.total,
        critical: ops.summary.alerts.events.critical,
        deliveryFailed: ops.summary.alerts.events.deliveryFailed
      },
      setupGaps: ops.setupGaps
        .filter((gap) => gap.key !== "recent_telemetry")
        .map((gap) => ({
          key: gap.key,
          label: gap.label,
          severity: gap.severity,
          destination: setupDestination(gap.action)
        }))
    },
    recommendedActions: buildRecommendedActions(ops),
    predictions,
    anomalies: ops.anomalies.map((anomaly) => ({
      id: anomaly.id,
      label: anomaly.label,
      severity: anomaly.severity,
      observedValue: anomaly.observedValue,
      baselineValue: anomaly.baselineValue,
      changePercent: anomaly.changePercent,
      sampleSize: anomaly.sampleSize,
      baselineSampleSize: anomaly.baselineSampleSize,
      threshold: anomaly.threshold,
      reason: anomaly.reason,
      suggestedAlertRuleType: anomaly.suggestedAlertRuleType,
      destination: anomalyDestination(anomaly.drilldown)
    })),
    topLatency: ops.topLatency
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
        const operations = buildOperations(ops);

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
            timestamp: e.timestamp,
            errorId: e.id,
            groupId: e.errorGroupId ?? undefined,
            tenantId: e.tenantId
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
          coverage: buildTelemetryCoverage(overview, ops),
          banner,
          operations,
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
