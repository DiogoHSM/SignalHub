import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { UserDetailResponse, UserListQuery, UserSignalType, UserSummary, UserTimelineRow } from "../api/types";
import type { InvestigationDrilldown } from "./InvestigationWorkspace";
import { UsersUserDetail } from "./UsersUserDetail";
import { UsersUserList, type UserSort } from "./UsersUserList";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
  initialUserId?: string;
  onDrilldown?: (drilldown: InvestigationDrilldown) => void;
};

type UserWindow = "24h" | "7d" | "30d";
type LoadState = "loading" | "ready" | "unavailable";
type DetailState = "idle" | LoadState;

function userKey(user: UserSummary): string {
  return user.isAnonymous ? "_anonymous" : user.userId ?? "_anonymous";
}

export function UsersInvestigationPanel({ client, projectId, environmentId, initialUserId, onDrilldown }: Props) {
  const scopeKey = `${projectId}:${environmentId}`;
  const [windowValue, setWindowValue] = useState<UserWindow>("7d");
  const [searchDraft, setSearchDraft] = useState("");
  const [tenantDraft, setTenantDraft] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedListTenantId, setAppliedListTenantId] = useState("");
  const [sort, setSort] = useState<UserSort>("impact");
  const [selectedUserId, setSelectedUserId] = useState(initialUserId);
  const [selectedScopeKey, setSelectedScopeKey] = useState<string | undefined>(() => (initialUserId ? scopeKey : undefined));
  const [detailTenantDraft, setDetailTenantDraft] = useState("");
  const [appliedDetailTenantId, setAppliedDetailTenantId] = useState("");
  const [signalType, setSignalType] = useState<UserSignalType | "">("");
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSummary | undefined>();
  const [detail, setDetail] = useState<UserDetailResponse | undefined>();
  const [listState, setListState] = useState<LoadState>("loading");
  const [detailState, setDetailState] = useState<DetailState>("idle");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [listRetryToken, setListRetryToken] = useState(0);
  const [detailRetryToken, setDetailRetryToken] = useState(0);
  const listRequestId = useRef(0);
  const detailRequestId = useRef(0);

  const listQuery = useMemo<UserListQuery>(() => {
    const query: UserListQuery = { projectId, environmentId, window: windowValue, limit: 50 };
    const search = appliedSearch.trim();
    const tenantId = appliedListTenantId.trim();
    if (search) query.search = search;
    if (tenantId) query.tenantId = tenantId;
    return query;
  }, [projectId, environmentId, windowValue, appliedSearch, appliedListTenantId]);

  useEffect(() => {
    const requestId = ++listRequestId.current;
    setListState("loading");

    void client.listUsersActivity(listQuery).then(
      ({ data }) => {
        if (requestId !== listRequestId.current) return;
        setUsers(data.users);
        setListState("ready");
      },
      () => {
        if (requestId !== listRequestId.current) return;
        setUsers([]);
        setListState("unavailable");
      }
    );
  }, [client, listQuery, listRetryToken]);

  useEffect(() => {
    detailRequestId.current += 1;
    setSelectedUserId(undefined);
    setSelectedScopeKey(undefined);
    setDetail(undefined);
    setSelectedUser(undefined);
    setDetailState("idle");
    setLoadingMore(false);
    setLoadMoreError(false);
  }, [projectId, environmentId]);

  useEffect(() => {
    if (initialUserId) {
      setSelectedUserId(initialUserId);
      setSelectedScopeKey(scopeKey);
    }
  }, [initialUserId, scopeKey]);

  useEffect(() => {
    setSelectedUser(users.find((user) => userKey(user) === selectedUserId));
  }, [users, selectedUserId]);

  useEffect(() => {
    if (!selectedUserId || selectedUserId === "_anonymous" || selectedScopeKey !== scopeKey) {
      setDetail(undefined);
      setDetailState("idle");
      setLoadingMore(false);
      setLoadMoreError(false);
      return;
    }

    const requestId = ++detailRequestId.current;
    setDetailState("loading");
    setDetail(undefined);
    setLoadingMore(false);
    setLoadMoreError(false);

    const query = {
      projectId,
      environmentId,
      window: windowValue,
      ...(appliedDetailTenantId.trim() ? { tenantId: appliedDetailTenantId.trim() } : {}),
      ...(signalType ? { signalType } : {}),
      limit: 50
    };

    void client.getUserDetail(selectedUserId, query).then(
      ({ data }) => {
        if (requestId !== detailRequestId.current) return;
        setDetail(data);
        setSelectedUser(data.user);
        setDetailState("ready");
      },
      () => {
        if (requestId !== detailRequestId.current) return;
        setDetail(undefined);
        setDetailState("unavailable");
        setLoadingMore(false);
      }
    );
  }, [
    client,
    projectId,
    environmentId,
    scopeKey,
    windowValue,
    selectedUserId,
    selectedScopeKey,
    appliedDetailTenantId,
    signalType,
    detailRetryToken
  ]);

  function applyListFilters() {
    setAppliedSearch(searchDraft);
    setAppliedListTenantId(tenantDraft);
  }

  function selectUser(user: UserSummary) {
    if (!user.userId || user.isAnonymous) return;
    setSelectedUserId(user.userId);
    setSelectedScopeKey(scopeKey);
    setSelectedUser(user);
  }

  function loadMoreTimeline() {
    if (!selectedUserId || selectedUserId === "_anonymous" || selectedScopeKey !== scopeKey || !detail?.cursor || loadingMore) return;

    const requestId = ++detailRequestId.current;
    const cursor = detail.cursor;
    setLoadingMore(true);
    setLoadMoreError(false);

    const query = {
      projectId,
      environmentId,
      window: windowValue,
      ...(appliedDetailTenantId.trim() ? { tenantId: appliedDetailTenantId.trim() } : {}),
      ...(signalType ? { signalType } : {}),
      limit: 50,
      cursor
    };

    void client.getUserDetail(selectedUserId, query).then(
      ({ data }) => {
        if (requestId !== detailRequestId.current) return;
        setDetail((current) =>
          current
            ? {
                ...data,
                timeline: [...current.timeline, ...data.timeline]
              }
            : data
        );
        setSelectedUser(data.user);
        setDetailState("ready");
        setLoadingMore(false);
        setLoadMoreError(false);
      },
      () => {
        if (requestId !== detailRequestId.current) return;
        setLoadingMore(false);
        setLoadMoreError(true);
      }
    );
  }

  function handleTimelineDrilldown(row: UserTimelineRow) {
    if (!onDrilldown || !selectedUserId || selectedUserId === "_anonymous") return;

    const common = {
      userId: selectedUserId,
      ...(row.tenantId ? { tenantId: row.tenantId } : {}),
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      ...(row.traceId ? { traceId: row.traceId } : {})
    };

    if (row.type === "event") {
      onDrilldown({ tab: "events", filters: { ...common, eventName: row.eventName } });
      return;
    }

    if (row.type === "error") {
      onDrilldown({ tab: "errors", filters: { ...common, severity: row.severity, status: row.status } });
      return;
    }

    if (row.type === "trace") {
      onDrilldown({ tab: "traces", filters: common });
      return;
    }

    const promptName = row.promptName?.trim();
    onDrilldown({
      tab: "llm",
      filters: {
        ...common,
        provider: row.provider,
        model: row.model,
        status: row.status,
        ...(promptName && promptName !== "Unspecified" ? { promptName } : {})
      }
    });
  }

  return (
    <section className="users-shell">
      <div className="entity-toolbar">
        <div className="investigation-tabs" aria-label="User window">
          {(["24h", "7d", "30d"] as UserWindow[]).map((value) => (
            <button aria-pressed={windowValue === value} key={value} onClick={() => setWindowValue(value)} type="button">
              {value}
            </button>
          ))}
        </div>
        <label>
          Search
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} />
        </label>
        <label>
          Tenant
          <input value={tenantDraft} onChange={(event) => setTenantDraft(event.target.value)} />
        </label>
        <div className="filter-actions">
          <button onClick={applyListFilters} type="button">
            Apply filters
          </button>
        </div>
      </div>
      <div className="users-layout">
        <UsersUserList
          error={listState === "unavailable"}
          loading={listState === "loading"}
          onRetry={() => setListRetryToken((current) => current + 1)}
          onSelectUser={selectUser}
          onSortChange={setSort}
          selectedUserId={selectedUserId}
          sort={sort}
          users={users}
        />
        <UsersUserDetail
          appliedTenantId={appliedDetailTenantId}
          detail={detail}
          draftTenantId={detailTenantDraft}
          error={detailState === "unavailable"}
          loadMoreError={loadMoreError}
          loading={detailState === "loading"}
          loadingMore={loadingMore}
          onApplyTenant={() => setAppliedDetailTenantId(detailTenantDraft)}
          onDraftTenantIdChange={setDetailTenantDraft}
          onLoadMore={loadMoreTimeline}
          onRetry={() => setDetailRetryToken((current) => current + 1)}
          onSignalTypeChange={setSignalType}
          onTimelineDrilldown={handleTimelineDrilldown}
          signalType={signalType}
          user={selectedUser}
        />
      </div>
    </section>
  );
}
