import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { LlmAggregates, LlmCallRecord, QueryFilters } from "../api/types";
import { LlmAggregateStrip } from "./LlmAggregateStrip";
import { LlmCallDetailDrawer } from "./LlmCallDetailDrawer";
import { LlmCallList } from "./LlmCallList";
import { LlmFilters, type LlmFilterValues } from "./LlmFilters";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
  initialFilters?: Partial<LlmFilterValues>;
};

type LoadState = "loading" | "ready" | "empty" | "unavailable";
type AggregateState = "loading" | "ready" | "unavailable";

const defaultFilters: LlmFilterValues = {
  provider: "",
  model: "",
  promptName: "",
  status: "",
  tenantId: "",
  userId: "",
  sessionId: "",
  traceId: "",
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

function queryFromValues(projectId: string, environmentId: string, values: LlmFilterValues): QueryFilters {
  const query: QueryFilters = { projectId, environmentId, limit: toLimit(values.limit) };
  const provider = values.provider.trim();
  const model = values.model.trim();
  const promptName = values.promptName.trim();
  const status = values.status.trim();
  const tenantId = values.tenantId.trim();
  const userId = values.userId.trim();
  const sessionId = values.sessionId.trim();
  const traceId = values.traceId.trim();
  const from = toIso(values.from);
  const to = toIso(values.to);

  if (provider) query.provider = provider;
  if (model) query.model = model;
  if (promptName) query.promptName = promptName;
  if (status) query.status = status;
  if (tenantId) query.tenantId = tenantId;
  if (userId) query.userId = userId;
  if (sessionId) query.sessionId = sessionId;
  if (traceId) query.traceId = traceId;
  if (from) query.from = from;
  if (to) query.to = to;
  return query;
}

function filtersWithDefaults(initialFilters?: Partial<LlmFilterValues>): LlmFilterValues {
  return { ...defaultFilters, ...initialFilters };
}

export function LlmInvestigationPanel({ client, projectId, environmentId, initialFilters }: Props) {
  const initialFilterKey = JSON.stringify(initialFilters ?? {});
  const hasSyncedInitialFilters = useRef(false);
  const [draftFilters, setDraftFilters] = useState<LlmFilterValues>(() => filtersWithDefaults(initialFilters));
  const [appliedFilters, setAppliedFilters] = useState<LlmFilterValues>(() => filtersWithDefaults(initialFilters));
  const [reloadToken, setReloadToken] = useState(0);
  const [aggregateReloadToken, setAggregateReloadToken] = useState(0);
  const [calls, setCalls] = useState<LlmCallRecord[]>([]);
  const [selectedCall, setSelectedCall] = useState<LlmCallRecord | undefined>();
  const [totals, setTotals] = useState<LlmAggregates | undefined>();
  const [state, setState] = useState<LoadState>("loading");
  const [aggregateState, setAggregateState] = useState<AggregateState>("loading");
  const query = useMemo(
    () => queryFromValues(projectId, environmentId, appliedFilters),
    [projectId, environmentId, appliedFilters]
  );

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setSelectedCall(undefined);

    void client.listLlmCalls(query).then(
      ({ data }) => {
        if (cancelled) return;
        setCalls(data);
        setState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setCalls([]);
        setState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, query, reloadToken]);

  useEffect(() => {
    if (!hasSyncedInitialFilters.current) {
      hasSyncedInitialFilters.current = true;
      return;
    }

    const next = filtersWithDefaults(initialFilters);
    setDraftFilters(next);
    setAppliedFilters(next);
  }, [initialFilterKey]);

  useEffect(() => {
    let cancelled = false;
    setAggregateState("loading");

    void client.getLlmAggregates(query).then(
      ({ data }) => {
        if (cancelled) return;
        setTotals(data);
        setAggregateState("ready");
      },
      () => {
        if (cancelled) return;
        setTotals(undefined);
        setAggregateState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, query, aggregateReloadToken]);

  function applyFilters() {
    setAppliedFilters({ ...draftFilters });
  }

  function resetFilters() {
    setDraftFilters(defaultFilters);
    setAppliedFilters({ ...defaultFilters });
    setReloadToken((current) => current + 1);
    setAggregateReloadToken((current) => current + 1);
  }

  function retryCalls() {
    setReloadToken((current) => current + 1);
  }

  function retryTotals() {
    setAggregateReloadToken((current) => current + 1);
  }

  return (
    <section className="investigation-layout">
      <div className="panel event-panel">
        <div className="panel-header">
          <h2>LLM</h2>
        </div>
        <LlmAggregateStrip onRetry={retryTotals} state={aggregateState} totals={totals} />
        <LlmFilters values={draftFilters} onApply={applyFilters} onChange={setDraftFilters} onReset={resetFilters} />
        {state === "loading" ? <p className="muted-text">Loading LLM calls</p> : null}
        {state === "unavailable" ? (
          <div className="status-box unavailable">
            <strong>LLM calls unavailable</strong>
            <button onClick={retryCalls} type="button">
              Retry calls
            </button>
          </div>
        ) : null}
        {state === "empty" ? <p className="muted-text">No LLM calls found</p> : null}
        {state === "ready" ? <LlmCallList calls={calls} onSelect={setSelectedCall} selectedCallId={selectedCall?.id} /> : null}
      </div>
      <LlmCallDetailDrawer call={selectedCall} />
    </section>
  );
}
