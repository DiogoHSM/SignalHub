import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { ActivitySort, UserListQuery, UserSummary, UserWindow } from "../../api/types";
import { formatImpactScore, relativeTime } from "../../components/ui/v2";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type UserSort = "impact" | "usage" | "errors" | "llmCost" | "recent";

export type UserRowVM = {
  key: string;
  userId: string | null;
  label: string;
  isAnonymous: boolean;
  impactScore: number;
  events: number;
  errors: number;
  failedTraces: number;
  llmCalls: number;
  llmCostUsd: number;
  activeTenants: number;
  activeSessions: number;
  lastSeenAt: string | null;
  lastSeenLabel: string;
  keyTraits: Record<string, string>;
};

export type UsersVM = {
  rows: UserRowVM[];
  hasMore: boolean;
};

export type UseUsersResult = {
  data: UsersVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
  loadMore: () => void;
  loadingMore: boolean;
};

type UseUsersArgs = {
  client: { listUsersActivity: ApiClient["listUsersActivity"] };
  projectId: string;
  environmentId: string;
  window: UserWindow;
  search?: string;
  tenantId?: string;
  sort: UserSort;
  limit?: number;
};

const PAGE_SIZE_DEFAULT = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Anonymous users collapse to a single stable row key — mirrors the v1 rule. */
export function userKey(user: Pick<UserSummary, "userId" | "isAnonymous">): string {
  return user.isAnonymous ? "_anonymous" : (user.userId ?? "_anonymous");
}

/** Maps the view-level sort id to the server's wire-level sort value (the only mismatch is llmCost/llm_cost). */
function toServerSort(sort: UserSort): ActivitySort {
  return sort === "llmCost" ? "llm_cost" : sort;
}

function mapRow(user: UserSummary): UserRowVM {
  return {
    key: userKey(user),
    userId: user.userId,
    label: user.label,
    isAnonymous: user.isAnonymous,
    impactScore: formatImpactScore(user.impactScore),
    events: user.events,
    errors: user.errors,
    failedTraces: user.failedTraces,
    llmCalls: user.llmCalls,
    llmCostUsd: Number(user.llmCostUsd),
    activeTenants: user.activeTenants,
    activeSessions: user.activeSessions,
    lastSeenAt: user.lastSeenAt,
    lastSeenLabel: user.lastSeenAt ? relativeTime(user.lastSeenAt) : "—",
    keyTraits: user.keyTraits,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUsers({
  client,
  projectId,
  environmentId,
  window: timeWindow,
  search,
  tenantId,
  sort,
  limit = PAGE_SIZE_DEFAULT,
}: UseUsersArgs): UseUsersResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [rawUsers, setRawUsers] = useState<UserSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const gen = ++genRef.current;
    setStatus("loading");
    setLoadingMore(false);
    setCursor(undefined);

    const query: UserListQuery = { projectId, environmentId, window: timeWindow, limit, sort: toServerSort(sort) };
    if (search) query.search = search;
    if (tenantId) query.tenantId = tenantId;

    client
      .listUsersActivity(query)
      .then((res) => {
        if (gen !== genRef.current) return;
        setRawUsers(res.data.users);
        setCursor(res.data.cursor);
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setRawUsers(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, environmentId, timeWindow, search, tenantId, sort, limit, tick]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore || rawUsers === null) return;

    const gen = ++genRef.current;
    setLoadingMore(true);

    const query: UserListQuery = { projectId, environmentId, window: timeWindow, limit, sort: toServerSort(sort), cursor };
    if (search) query.search = search;
    if (tenantId) query.tenantId = tenantId;

    client
      .listUsersActivity(query)
      .then((res) => {
        if (gen !== genRef.current) return;
        setRawUsers((current) => (current ? [...current, ...res.data.users] : res.data.users));
        setCursor(res.data.cursor);
        setLoadingMore(false);
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setLoadingMore(false);
      });
  }, [client, cursor, loadingMore, rawUsers, projectId, environmentId, timeWindow, search, tenantId, sort, limit]);

  const data: UsersVM | null = rawUsers ? { rows: rawUsers.map(mapRow), hasMore: Boolean(cursor) } : null;

  return { data, status, reload, loadMore, loadingMore };
}
