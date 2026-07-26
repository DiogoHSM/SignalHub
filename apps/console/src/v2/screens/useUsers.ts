import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { UserListQuery, UserSummary, UserWindow } from "../../api/types";
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
};

export type UseUsersResult = {
  data: UsersVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Anonymous users collapse to a single stable row key — mirrors the v1 rule. */
export function userKey(user: Pick<UserSummary, "userId" | "isAnonymous">): string {
  return user.isAnonymous ? "_anonymous" : (user.userId ?? "_anonymous");
}

export function recentValue(user: UserSummary): number {
  return user.lastSeenAt ? new Date(user.lastSeenAt).getTime() : 0;
}

export function sortValue(user: UserSummary, sort: UserSort): number {
  if (sort === "impact") return user.impactScore;
  if (sort === "usage") return user.events;
  if (sort === "errors") return user.errors;
  if (sort === "llmCost") return Number(user.llmCostUsd);
  return recentValue(user);
}

/** Sort users by the given metric, with the `impact` default tie-broken by lastSeenAt → events → label. */
export function sortUsers(users: UserSummary[], sort: UserSort): UserSummary[] {
  return [...users].sort((left, right) => {
    const byMetric = sortValue(right, sort) - sortValue(left, sort);
    if (byMetric !== 0) return byMetric;
    if (sort === "impact") {
      const byRecent = recentValue(right) - recentValue(left);
      if (byRecent !== 0) return byRecent;
      const byEvents = right.events - left.events;
      if (byEvents !== 0) return byEvents;
    }
    return left.label.localeCompare(right.label);
  });
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
  limit = 50,
}: UseUsersArgs): UseUsersResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [rawUsers, setRawUsers] = useState<UserSummary[] | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const gen = ++genRef.current;
    setStatus("loading");

    const query: UserListQuery = { projectId, environmentId, window: timeWindow, limit };
    if (search) query.search = search;
    if (tenantId) query.tenantId = tenantId;

    client
      .listUsersActivity(query)
      .then((res) => {
        if (gen !== genRef.current) return;
        setRawUsers(res.data.users);
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
  }, [projectId, environmentId, timeWindow, search, tenantId, limit, tick]);

  const data: UsersVM | null = rawUsers ? { rows: sortUsers(rawUsers, sort).map(mapRow) } : null;

  return { data, status, reload };
}
