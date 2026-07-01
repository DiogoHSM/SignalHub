import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { ApmEndpoint, TraceRecord } from "../../api/types";

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

export type UseTracesResult = {
  data: TraceListItemVM[] | null;
  endpoints: ApmEndpointVM[];
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
  client: { listTraces: ApiClient["listTraces"]; getApmEndpoints?: ApiClient["getApmEndpoints"] };
  projectId: string | undefined;
  environmentId: string | undefined;
  endpointName?: string | null;
};

const RECENT_TRACES_LIMIT = 25;
const APM_ENDPOINT_LIMIT = 50;

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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTraces({ client, projectId, environmentId, endpointName }: UseTracesArgs): UseTracesResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<TraceListItemVM[] | null>(null);
  const [endpoints, setEndpoints] = useState<ApmEndpointVM[]>([]);
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

    Promise.all([tracesPromise, apmPromise])
      .then(([res, apm]) => {
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
        setTotals(apm?.totals ?? null);
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        setEndpoints([]);
        setTotals(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, environmentId, endpointName, tick]);

  return { data, endpoints, totals, status, reload };
}
