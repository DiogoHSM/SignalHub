import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api/client";
import type { QueryFilters, SpanRecord, TraceRecord } from "../api/types";
import { TraceDetailDrawer } from "./TraceDetailDrawer";
import { TraceFilters, type TraceFilterValues } from "./TraceFilters";
import { TraceList } from "./TraceList";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
};

type LoadState = "loading" | "ready" | "empty" | "unavailable";
type SpanState = "idle" | LoadState;

const defaultFilters: TraceFilterValues = {
  traceId: "",
  tenantId: "",
  userId: "",
  sessionId: "",
  from: "",
  to: "",
  limit: "50"
};

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toLimit(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 50;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(500, Math.max(1, Math.trunc(parsed)));
}

function queryFromValues(projectId: string, environmentId: string, values: TraceFilterValues): QueryFilters {
  const query: QueryFilters = { projectId, environmentId, limit: toLimit(values.limit) };
  const traceId = values.traceId.trim();
  const tenantId = values.tenantId.trim();
  const userId = values.userId.trim();
  const sessionId = values.sessionId.trim();
  const from = toIso(values.from);
  const to = toIso(values.to);

  if (traceId) query.traceId = traceId;
  if (tenantId) query.tenantId = tenantId;
  if (userId) query.userId = userId;
  if (sessionId) query.sessionId = sessionId;
  if (from) query.from = from;
  if (to) query.to = to;
  return query;
}

export function TraceInvestigationPanel({ client, projectId, environmentId }: Props) {
  const [draftFilters, setDraftFilters] = useState<TraceFilterValues>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<TraceFilterValues>(defaultFilters);
  const [reloadToken, setReloadToken] = useState(0);
  const [spanReloadToken, setSpanReloadToken] = useState(0);
  const [traces, setTraces] = useState<TraceRecord[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<TraceRecord | undefined>();
  const [spans, setSpans] = useState<SpanRecord[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [spanState, setSpanState] = useState<SpanState>("idle");
  const query = useMemo(
    () => queryFromValues(projectId, environmentId, appliedFilters),
    [projectId, environmentId, appliedFilters]
  );

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setSelectedTrace(undefined);
    setSpans([]);
    setSpanState("idle");

    void client.listTraces(query).then(
      ({ data }) => {
        if (cancelled) return;
        setTraces(data);
        setState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setTraces([]);
        setState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, query, reloadToken]);

  useEffect(() => {
    if (!selectedTrace?.traceId) {
      setSpans([]);
      setSpanState(selectedTrace ? "empty" : "idle");
      return;
    }

    let cancelled = false;
    const traceId = selectedTrace.traceId;
    setSpanState("loading");
    setSpans([]);

    void client.listTraceSpans(traceId, { projectId, environmentId }).then(
      ({ data }) => {
        if (cancelled) return;
        setSpans(data);
        setSpanState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setSpans([]);
        setSpanState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, projectId, environmentId, selectedTrace, spanReloadToken]);

  function applyFilters() {
    setAppliedFilters({ ...draftFilters });
  }

  function resetFilters() {
    setDraftFilters(defaultFilters);
    setAppliedFilters({ ...defaultFilters });
    setReloadToken((current) => current + 1);
  }

  function retryTraces() {
    setReloadToken((current) => current + 1);
  }

  function retrySpans() {
    setSpanReloadToken((current) => current + 1);
  }

  return (
    <section className="investigation-layout">
      <div className="panel event-panel">
        <div className="panel-header">
          <h2>Traces</h2>
        </div>
        <TraceFilters values={draftFilters} onApply={applyFilters} onChange={setDraftFilters} onReset={resetFilters} />
        {state === "loading" ? <p className="muted-text">Loading traces</p> : null}
        {state === "unavailable" ? (
          <div className="status-box unavailable">
            <strong>Traces unavailable</strong>
            <button onClick={retryTraces} type="button">
              Retry traces
            </button>
          </div>
        ) : null}
        {state === "empty" ? <p className="muted-text">No traces found</p> : null}
        {state === "ready" ? <TraceList onSelect={setSelectedTrace} selectedTraceId={selectedTrace?.id} traces={traces} /> : null}
      </div>
      <TraceDetailDrawer onRetrySpans={retrySpans} spanState={spanState} spans={spans} trace={selectedTrace} />
    </section>
  );
}
