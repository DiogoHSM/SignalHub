import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { TraceRecord } from "../../api/types";

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

export type UseTracesResult = {
  data: TraceListItemVM[] | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

type UseTracesArgs = {
  client: { listTraces: ApiClient["listTraces"] };
  projectId: string | undefined;
  environmentId: string | undefined;
};

const RECENT_TRACES_LIMIT = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A trace/span is errored when it carries an error payload or an error-like status. */
export function isErrorStatus(status: string): boolean {
  return /error|fail/i.test(status);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTraces({ client, projectId, environmentId }: UseTracesArgs): UseTracesResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<TraceListItemVM[] | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId) return;

    const gen = ++genRef.current;
    setStatus("loading");

    client
      .listTraces({ projectId, environmentId, limit: RECENT_TRACES_LIMIT })
      .then((res) => {
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
  }, [projectId, environmentId, tick]);

  return { data, status, reload };
}
