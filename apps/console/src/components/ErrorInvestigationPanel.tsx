import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ErrorRecord, QueryFilters } from "../api/types";
import { ErrorDetailDrawer } from "./ErrorDetailDrawer";
import { ErrorFilters, type ErrorFilterValues } from "./ErrorFilters";
import { ErrorList } from "./ErrorList";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
};

type LoadState = "loading" | "ready" | "empty" | "unavailable";

const defaultFilters: ErrorFilterValues = {
  severity: "",
  status: "",
  fingerprint: "",
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

function queryFromValues(projectId: string, environmentId: string, values: ErrorFilterValues): QueryFilters {
  const query: QueryFilters = {
    projectId,
    environmentId,
    limit: toLimit(values.limit)
  };

  const severity = values.severity.trim();
  const status = values.status.trim();
  const fingerprint = values.fingerprint.trim();
  const tenantId = values.tenantId.trim();
  const userId = values.userId.trim();
  const sessionId = values.sessionId.trim();
  const traceId = values.traceId.trim();
  const from = toIso(values.from);
  const to = toIso(values.to);

  if (severity) query.severity = severity;
  if (status) query.status = status;
  if (fingerprint) query.fingerprint = fingerprint;
  if (tenantId) query.tenantId = tenantId;
  if (userId) query.userId = userId;
  if (sessionId) query.sessionId = sessionId;
  if (traceId) query.traceId = traceId;
  if (from) query.from = from;
  if (to) query.to = to;

  return query;
}

export function ErrorInvestigationPanel({ client, projectId, environmentId }: Props) {
  const [draftFilters, setDraftFilters] = useState<ErrorFilterValues>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<ErrorFilterValues>(defaultFilters);
  const [reloadToken, setReloadToken] = useState(0);
  const [errors, setErrors] = useState<ErrorRecord[]>([]);
  const [selectedError, setSelectedError] = useState<ErrorRecord | undefined>();
  const [state, setState] = useState<LoadState>("loading");
  const query = useMemo(
    () => queryFromValues(projectId, environmentId, appliedFilters),
    [projectId, environmentId, appliedFilters]
  );

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setSelectedError(undefined);

    void client.listErrors(query).then(
      ({ data }) => {
        if (cancelled) return;
        setErrors(data);
        setState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setErrors([]);
        setState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, query, reloadToken]);

  function applyFilters() {
    setAppliedFilters({ ...draftFilters });
  }

  function resetFilters() {
    setDraftFilters(defaultFilters);
    setAppliedFilters({ ...defaultFilters });
    setReloadToken((current) => current + 1);
  }

  function retry() {
    setReloadToken((current) => current + 1);
  }

  return (
    <section className="investigation-layout">
      <div className="panel event-panel">
        <div className="panel-header">
          <h2>Errors</h2>
        </div>
        <ErrorFilters values={draftFilters} onApply={applyFilters} onChange={setDraftFilters} onReset={resetFilters} />
        {state === "loading" ? <p className="muted-text">Loading errors</p> : null}
        {state === "unavailable" ? (
          <div className="status-box unavailable">
            <strong>Errors unavailable</strong>
            <button onClick={retry} type="button">
              Retry
            </button>
          </div>
        ) : null}
        {state === "empty" ? <p className="muted-text">No errors found</p> : null}
        {state === "ready" ? <ErrorList errors={errors} onSelect={setSelectedError} selectedErrorId={selectedError?.id} /> : null}
      </div>
      <ErrorDetailDrawer error={selectedError} />
    </section>
  );
}
