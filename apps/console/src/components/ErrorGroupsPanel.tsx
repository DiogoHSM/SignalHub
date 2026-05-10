import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ErrorGroupQuery, ErrorGroupRecord } from "../api/types";
import type { ErrorFilterValues } from "./ErrorFilters";
import { ErrorGroupDetail } from "./ErrorGroupDetail";
import { ErrorGroupFilters, type ErrorGroupFilterValues } from "./ErrorGroupFilters";
import { ErrorGroupList } from "./ErrorGroupList";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
  initialFilters?: Partial<ErrorFilterValues>;
};

type LoadState = "loading" | "ready" | "empty" | "unavailable";

const defaultFilters: ErrorGroupFilterValues = {
  severity: "",
  status: "",
  fingerprint: "",
  tenantId: "",
  userId: "",
  release: "",
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

function queryFromValues(projectId: string, environmentId: string, values: ErrorGroupFilterValues): ErrorGroupQuery {
  const query: ErrorGroupQuery = { projectId, environmentId, limit: toLimit(values.limit) };
  const severity = values.severity.trim();
  const status = values.status.trim();
  const fingerprint = values.fingerprint.trim();
  const tenantId = values.tenantId.trim();
  const userId = values.userId.trim();
  const release = values.release.trim();
  const from = toIso(values.from);
  const to = toIso(values.to);

  if (severity) query.severity = severity;
  if (status) query.status = status as ErrorGroupQuery["status"];
  if (fingerprint) query.fingerprint = fingerprint;
  if (tenantId) query.tenantId = tenantId;
  if (userId) query.userId = userId;
  if (release) query.release = release;
  if (from) query.from = from;
  if (to) query.to = to;
  return query;
}

function filtersWithDefaults(initialFilters?: Partial<ErrorFilterValues>): ErrorGroupFilterValues {
  return {
    ...defaultFilters,
    severity: initialFilters?.severity ?? defaultFilters.severity,
    status: initialFilters?.status ?? defaultFilters.status,
    fingerprint: initialFilters?.fingerprint ?? defaultFilters.fingerprint,
    tenantId: initialFilters?.tenantId ?? defaultFilters.tenantId,
    userId: initialFilters?.userId ?? defaultFilters.userId,
    from: initialFilters?.from ?? defaultFilters.from,
    to: initialFilters?.to ?? defaultFilters.to,
    limit: initialFilters?.limit ?? defaultFilters.limit
  };
}

export function ErrorGroupsPanel({ client, projectId, environmentId, initialFilters }: Props) {
  const initialFilterKey = JSON.stringify(initialFilters ?? {});
  const hasSyncedInitialFilters = useRef(false);
  const [draftFilters, setDraftFilters] = useState<ErrorGroupFilterValues>(() => filtersWithDefaults(initialFilters));
  const [appliedFilters, setAppliedFilters] = useState<ErrorGroupFilterValues>(() => filtersWithDefaults(initialFilters));
  const [reloadToken, setReloadToken] = useState(0);
  const [groups, setGroups] = useState<ErrorGroupRecord[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ErrorGroupRecord | undefined>();
  const [state, setState] = useState<LoadState>("loading");
  const query = useMemo(
    () => queryFromValues(projectId, environmentId, appliedFilters),
    [projectId, environmentId, appliedFilters]
  );

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setSelectedGroup(undefined);

    void client.listErrorGroups(query).then(
      ({ data }) => {
        if (cancelled) return;
        setGroups(data);
        setState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setGroups([]);
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

  function updateGroup(updatedGroup: ErrorGroupRecord) {
    setSelectedGroup(updatedGroup);
    setGroups((current) => current.map((group) => (group.id === updatedGroup.id ? updatedGroup : group)));
  }

  return (
    <section className="investigation-layout">
      <div className="panel event-panel">
        <div className="panel-header">
          <h2>Grouped errors</h2>
        </div>
        <ErrorGroupFilters values={draftFilters} onApply={applyFilters} onChange={setDraftFilters} onReset={resetFilters} />
        {state === "loading" ? <p className="muted-text">Loading error groups</p> : null}
        {state === "unavailable" ? (
          <div className="status-box unavailable">
            <strong>Error groups unavailable</strong>
            <button onClick={retry} type="button">
              Retry
            </button>
          </div>
        ) : null}
        {state === "empty" ? <p className="muted-text">No error groups found</p> : null}
        {state === "ready" ? (
          <ErrorGroupList groups={groups} onSelect={setSelectedGroup} selectedGroupId={selectedGroup?.id} />
        ) : null}
      </div>
      <ErrorGroupDetail
        client={client}
        environmentId={environmentId}
        group={selectedGroup}
        onStatusUpdated={updateGroup}
        projectId={projectId}
      />
    </section>
  );
}
