import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { ApmEndpoint, RuntimeProfile, RuntimeProfileHotFunction, ServiceMapEdge, WebVitalMetric } from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type TraceListItemVM = {
  id: string;
  traceId: string;
  name: string;
  status: string;
  hasError: boolean;
  durationMs: number | null;
  startedAt: string;
  tenantId: string | null;
  userId: string | null;
};

export type ApmEndpointVM = {
  name: string;
  requests: number;
  errors: number;
  errorRatePercent: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  p99DurationMs: number | null;
  averageDurationMs: number | null;
  apdex: number | null;
  lastSeenAt: string | null;
};

export type ServiceMapEdgeVM = {
  source: string;
  target: string;
  dependencyType: string;
  spans: number;
  traces: number;
  errors: number;
  errorRatePercent: number | null;
  averageDurationMs: number | null;
  p95DurationMs: number | null;
  lastSeenAt: string | null;
};

export type WebVitalMetricVM = {
  name: "CLS" | "FCP" | "FID" | "INP" | "LCP" | "TTFB";
  route: string;
  samples: number;
  good: number;
  needsImprovement: number;
  poor: number;
  averageValue: number | null;
  p75Value: number | null;
  latestRelease: string | null;
  latestReleaseP75Value: number | null;
  previousRelease: string | null;
  previousReleaseP75Value: number | null;
  regressionPercent: number | null;
  lastSeenAt: string | null;
};

export type RuntimeProfileVM = {
  id: string;
  name: string;
  kind: "cpu" | "memory";
  runtime: string;
  service: string | null;
  route: string | null;
  traceId: string | null;
  startedAt: string;
  durationMs: number | null;
  sampleCount: number;
  cpuUsagePercent: number | null;
  heapUsedBytes: number | null;
  topFunction: string | null;
  topFunctionSelfTimeMs: number | null;
};

export type RuntimeProfileHotFunctionVM = {
  functionName: string;
  url: string | null;
  selfTimeMs: number;
  totalTimeMs: number | null;
  sampleCount: number;
  profileCount: number;
  lastSeenAt: string | null;
};

export type UseTracesResult = {
  data: TraceListItemVM[] | null;
  endpoints: ApmEndpointVM[];
  serviceMap: {
    edges: ServiceMapEdgeVM[];
    totals: {
      services: number;
      edges: number;
      spans: number;
      errors: number;
      errorRatePercent: number | null;
    } | null;
  };
  webVitals: {
    metrics: WebVitalMetricVM[];
    totals: {
      samples: number;
      routes: number;
      releases: number;
      poorSamples: number;
      p75LcpMs: number | null;
      p75InpMs: number | null;
      p75Cls: number | null;
    } | null;
  };
  runtimeProfiles: {
    profiles: RuntimeProfileVM[];
    hotFunctions: RuntimeProfileHotFunctionVM[];
    totals: {
      profiles: number;
      cpuProfiles: number;
      memoryProfiles: number;
      samples: number;
      avgCpuUsagePercent: number | null;
      maxHeapUsedBytes: number | null;
      p95DurationMs: number | null;
    } | null;
  };
  totals: {
    endpoints: number;
    requests: number;
    errors: number;
    errorRatePercent: number | null;
    p95DurationMs: number | null;
    apdex: number | null;
  } | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

type UseTracesArgs = {
  client: {
    listTraces: ApiClient["listTraces"];
    getApmEndpoints?: ApiClient["getApmEndpoints"];
    getServiceMap?: ApiClient["getServiceMap"];
    getWebVitals?: ApiClient["getWebVitals"];
    getRuntimeProfiles?: ApiClient["getRuntimeProfiles"];
  };
  projectId: string | undefined;
  environmentId: string | undefined;
  endpointName?: string | null;
};

const RECENT_TRACES_LIMIT = 25;
const APM_ENDPOINT_LIMIT = 50;
const SERVICE_MAP_LIMIT = 50;
const WEB_VITALS_LIMIT = 50;
const RUNTIME_PROFILES_LIMIT = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A trace/span is errored when it carries an error payload or an error-like status. */
export function isErrorStatus(status: string): boolean {
  return /error|fail/i.test(status);
}

function mapEndpoint(row: ApmEndpoint): ApmEndpointVM {
  return {
    name: row.name,
    requests: row.requests,
    errors: row.errors,
    errorRatePercent: row.errorRatePercent,
    p50DurationMs: row.p50DurationMs,
    p95DurationMs: row.p95DurationMs,
    p99DurationMs: row.p99DurationMs,
    averageDurationMs: row.averageDurationMs,
    apdex: row.apdex,
    lastSeenAt: row.lastSeenAt,
  };
}

function mapServiceMapEdge(row: ServiceMapEdge): ServiceMapEdgeVM {
  return {
    source: row.source,
    target: row.target,
    dependencyType: row.dependencyType,
    spans: row.spans,
    traces: row.traces,
    errors: row.errors,
    errorRatePercent: row.errorRatePercent,
    averageDurationMs: row.averageDurationMs,
    p95DurationMs: row.p95DurationMs,
    lastSeenAt: row.lastSeenAt,
  };
}

function mapWebVitalMetric(row: WebVitalMetric): WebVitalMetricVM {
  return {
    name: row.name,
    route: row.route,
    samples: row.samples,
    good: row.good,
    needsImprovement: row.needsImprovement,
    poor: row.poor,
    averageValue: row.averageValue,
    p75Value: row.p75Value,
    latestRelease: row.latestRelease,
    latestReleaseP75Value: row.latestReleaseP75Value,
    previousRelease: row.previousRelease,
    previousReleaseP75Value: row.previousReleaseP75Value,
    regressionPercent: row.regressionPercent,
    lastSeenAt: row.lastSeenAt,
  };
}

function mapRuntimeProfile(row: RuntimeProfile): RuntimeProfileVM {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    runtime: row.runtime,
    service: row.service,
    route: row.route,
    traceId: row.traceId,
    startedAt: row.startedAt,
    durationMs: row.durationMs,
    sampleCount: row.sampleCount,
    cpuUsagePercent: row.cpuUsagePercent,
    heapUsedBytes: row.heapUsedBytes,
    topFunction: row.topFunction,
    topFunctionSelfTimeMs: row.topFunctionSelfTimeMs,
  };
}

function mapRuntimeHotFunction(row: RuntimeProfileHotFunction): RuntimeProfileHotFunctionVM {
  return {
    functionName: row.functionName,
    url: row.url,
    selfTimeMs: row.selfTimeMs,
    totalTimeMs: row.totalTimeMs,
    sampleCount: row.sampleCount,
    profileCount: row.profileCount,
    lastSeenAt: row.lastSeenAt,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTraces({ client, projectId, environmentId, endpointName }: UseTracesArgs): UseTracesResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<TraceListItemVM[] | null>(null);
  const [endpoints, setEndpoints] = useState<ApmEndpointVM[]>([]);
  const [serviceMap, setServiceMap] = useState<UseTracesResult["serviceMap"]>({ edges: [], totals: null });
  const [webVitals, setWebVitals] = useState<UseTracesResult["webVitals"]>({ metrics: [], totals: null });
  const [runtimeProfiles, setRuntimeProfiles] = useState<UseTracesResult["runtimeProfiles"]>({
    profiles: [],
    hotFunctions: [],
    totals: null,
  });
  const [totals, setTotals] = useState<UseTracesResult["totals"]>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId) return;

    const gen = ++genRef.current;
    setStatus("loading");

    const tracesPromise = client.listTraces({
      projectId,
      environmentId,
      limit: RECENT_TRACES_LIMIT,
      ...(endpointName ? { traceName: endpointName } : {})
    });
    const apmPromise = client.getApmEndpoints
      ? client.getApmEndpoints({ projectId, environmentId, window: "24h", limit: APM_ENDPOINT_LIMIT }).then((res) => res.data)
      : Promise.resolve(null);
    const serviceMapPromise = client.getServiceMap
      ? client.getServiceMap({ projectId, environmentId, window: "24h", limit: SERVICE_MAP_LIMIT }).then((res) => res.data)
      : Promise.resolve(null);
    const webVitalsPromise = client.getWebVitals
      ? client.getWebVitals({ projectId, environmentId, window: "24h", limit: WEB_VITALS_LIMIT }).then((res) => res.data)
      : Promise.resolve(null);
    const runtimeProfilesPromise = client.getRuntimeProfiles
      ? client.getRuntimeProfiles({ projectId, environmentId, window: "24h", limit: RUNTIME_PROFILES_LIMIT }).then((res) => res.data)
      : Promise.resolve(null);

    Promise.all([tracesPromise, apmPromise, serviceMapPromise, webVitalsPromise, runtimeProfilesPromise])
      .then(([res, apm, map, vitals, profiles]) => {
        if (gen !== genRef.current) return;
        const rows: TraceListItemVM[] = res.data.map((t) => ({
          id: t.id,
          traceId: t.traceId ?? t.id,
          name: t.name,
          status: t.status,
          hasError: isErrorStatus(t.status),
          durationMs: t.durationMs,
          startedAt: t.startedAt,
          tenantId: t.tenantId,
          userId: t.userId,
        }));
        setData(rows);
        setEndpoints(apm?.endpoints.map(mapEndpoint) ?? []);
        setServiceMap({
          edges: map?.edges.map(mapServiceMapEdge) ?? [],
          totals: map?.totals ?? null,
        });
        setWebVitals({
          metrics: vitals?.metrics.map(mapWebVitalMetric) ?? [],
          totals: vitals?.totals ?? null,
        });
        setRuntimeProfiles({
          profiles: profiles?.profiles.map(mapRuntimeProfile) ?? [],
          hotFunctions: profiles?.hotFunctions.map(mapRuntimeHotFunction) ?? [],
          totals: profiles?.totals ?? null,
        });
        setTotals(apm?.totals ?? null);
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        setEndpoints([]);
        setServiceMap({ edges: [], totals: null });
        setWebVitals({ metrics: [], totals: null });
        setRuntimeProfiles({ profiles: [], hotFunctions: [], totals: null });
        setTotals(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, environmentId, endpointName, tick]);

  return { data, endpoints, serviceMap, webVitals, runtimeProfiles, totals, status, reload };
}
