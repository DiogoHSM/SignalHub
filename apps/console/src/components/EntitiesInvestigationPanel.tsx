import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { EntitySignalType, EntityWindow, TenantDetailResponse, TenantListQuery, TenantSummary } from "../api/types";
import { EntitiesTenantDetail } from "./EntitiesTenantDetail";
import { EntitiesTenantList, type TenantSort } from "./EntitiesTenantList";
import type { InvestigationDrilldown } from "./InvestigationWorkspace";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
  initialTenantId?: string;
  onDrilldown?: (drilldown: InvestigationDrilldown) => void;
};

type LoadState = "loading" | "ready" | "unavailable";
type DetailState = "idle" | LoadState;

function tenantKey(tenant: TenantSummary): string {
  return tenant.isUnassigned ? "_unassigned" : tenant.tenantId ?? "_unassigned";
}

export function EntitiesInvestigationPanel({ client, projectId, environmentId, initialTenantId, onDrilldown }: Props) {
  const scopeKey = `${projectId}:${environmentId}`;
  const [windowValue, setWindowValue] = useState<EntityWindow>("7d");
  const [searchDraft, setSearchDraft] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [sort, setSort] = useState<TenantSort>("impact");
  const [selectedTenantId, setSelectedTenantId] = useState(initialTenantId);
  const [selectedScopeKey, setSelectedScopeKey] = useState<string | undefined>(() => (initialTenantId ? scopeKey : undefined));
  const [draftUserId, setDraftUserId] = useState("");
  const [appliedUserId, setAppliedUserId] = useState("");
  const [signalType, setSignalType] = useState<EntitySignalType | "">("");
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<TenantSummary | undefined>();
  const [detail, setDetail] = useState<TenantDetailResponse | undefined>();
  const [listState, setListState] = useState<LoadState>("loading");
  const [detailState, setDetailState] = useState<DetailState>("idle");
  const [listRetryToken, setListRetryToken] = useState(0);
  const [detailRetryToken, setDetailRetryToken] = useState(0);
  const listRequestId = useRef(0);
  const detailRequestId = useRef(0);

  const listQuery = useMemo<TenantListQuery>(() => {
    const query: TenantListQuery = { projectId, environmentId, window: windowValue, limit: 50 };
    const search = appliedSearch.trim();
    if (search) query.search = search;
    return query;
  }, [projectId, environmentId, windowValue, appliedSearch]);

  useEffect(() => {
    const requestId = ++listRequestId.current;
    setListState("loading");

    void client.listEntityTenants(listQuery).then(
      ({ data }) => {
        if (requestId !== listRequestId.current) return;
        setTenants(data.tenants);
        setListState("ready");
      },
      () => {
        if (requestId !== listRequestId.current) return;
        setTenants([]);
        setListState("unavailable");
      }
    );
  }, [client, listQuery, listRetryToken]);

  useEffect(() => {
    detailRequestId.current += 1;
    setSelectedTenantId(undefined);
    setSelectedScopeKey(undefined);
    setDetail(undefined);
    setSelectedTenant(undefined);
    setDetailState("idle");
  }, [projectId, environmentId]);

  useEffect(() => {
    if (initialTenantId) {
      setSelectedTenantId(initialTenantId);
      setSelectedScopeKey(scopeKey);
    }
  }, [initialTenantId]);

  useEffect(() => {
    setSelectedTenant(tenants.find((tenant) => tenantKey(tenant) === selectedTenantId));
  }, [tenants, selectedTenantId]);

  useEffect(() => {
    if (!selectedTenantId || selectedTenantId === "_unassigned" || selectedScopeKey !== scopeKey) {
      setDetail(undefined);
      setDetailState("idle");
      return;
    }

    const requestId = ++detailRequestId.current;
    setDetailState("loading");
    setDetail(undefined);

    const query = {
      projectId,
      environmentId,
      window: windowValue,
      ...(appliedUserId.trim() ? { userId: appliedUserId.trim() } : {}),
      ...(signalType ? { signalType } : {}),
      limit: 50
    };

    void client.getEntityTenantDetail(selectedTenantId, query).then(
      ({ data }) => {
        if (requestId !== detailRequestId.current) return;
        setDetail(data);
        setSelectedTenant(data.tenant);
        setDetailState("ready");
      },
      () => {
        if (requestId !== detailRequestId.current) return;
        setDetail(undefined);
        setDetailState("unavailable");
      }
    );
  }, [client, projectId, environmentId, scopeKey, windowValue, selectedTenantId, selectedScopeKey, appliedUserId, signalType, detailRetryToken]);

  function applySearch() {
    setAppliedSearch(searchDraft);
  }

  function selectTenant(tenant: TenantSummary) {
    if (!tenant.tenantId || tenant.isUnassigned) return;
    setSelectedTenantId(tenant.tenantId);
    setSelectedScopeKey(scopeKey);
    setSelectedTenant(tenant);
  }

  function handleTimelineDrilldown(row: TenantDetailResponse["timeline"][number]) {
    if (!onDrilldown || !selectedTenantId || selectedTenantId === "_unassigned") return;

    const tenantId = selectedTenantId;
    const traceFilter = row.traceId ? { traceId: row.traceId } : {};

    if (row.type === "event") {
      onDrilldown({ tab: "events", filters: { tenantId, eventName: row.eventName, ...traceFilter } });
      return;
    }

    if (row.type === "error") {
      onDrilldown({ tab: "errors", filters: { tenantId, severity: row.severity, status: row.status, ...traceFilter } });
      return;
    }

    if (row.type === "trace") {
      onDrilldown({ tab: "traces", filters: { tenantId, ...traceFilter } });
      return;
    }

    const promptName = row.promptName?.trim();
    onDrilldown({
      tab: "llm",
      filters: {
        tenantId,
        provider: row.provider,
        model: row.model,
        status: row.status,
        ...traceFilter,
        ...(promptName && promptName !== "Unspecified" ? { promptName } : {})
      }
    });
  }

  return (
    <section className="entities-shell">
      <div className="entity-toolbar">
        <div className="investigation-tabs" aria-label="Entity window">
          {(["24h", "7d", "30d"] as EntityWindow[]).map((value) => (
            <button aria-pressed={windowValue === value} key={value} onClick={() => setWindowValue(value)} type="button">
              {value}
            </button>
          ))}
        </div>
        <label>
          Search
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} />
        </label>
        <div className="filter-actions">
          <button onClick={applySearch} type="button">
            Apply search
          </button>
        </div>
      </div>
      <div className="entities-layout">
        <EntitiesTenantList
          error={listState === "unavailable"}
          loading={listState === "loading"}
          onRetry={() => setListRetryToken((current) => current + 1)}
          onSelectTenant={selectTenant}
          onSortChange={setSort}
          selectedTenantId={selectedTenantId}
          sort={sort}
          tenants={tenants}
        />
        <EntitiesTenantDetail
          appliedUserId={appliedUserId}
          detail={detail}
          draftUserId={draftUserId}
          error={detailState === "unavailable"}
          loading={detailState === "loading"}
          onApplyUser={() => setAppliedUserId(draftUserId)}
          onDraftUserIdChange={setDraftUserId}
          onRetry={() => setDetailRetryToken((current) => current + 1)}
          onSignalTypeChange={setSignalType}
          onTimelineDrilldown={handleTimelineDrilldown}
          signalType={signalType}
          tenant={selectedTenant}
        />
      </div>
    </section>
  );
}
