import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { EntityWindow, TenantSummary } from "../../api/types";
import { formatImpactScore, relativeTime } from "../../components/ui/v2";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type TenantSort = "impact" | "usage" | "errors" | "llmCost" | "recent";

export type TenantRowVM = {
  key: string;
  tenantId: string | null;
  label: string;
  isUnassigned: boolean;
  keyTraits: Array<{ key: string; value: string }>;
  impactScore: number;
  events: number;
  errors: number;
  llmCalls: number;
  llmCostUsd: number;
  activeUsers: number;
  lastSeenAt: string | null;
  lastSeen: string;
};

export type TenantsVM = {
  window: EntityWindow;
  rows: TenantRowVM[];
  hasMore: boolean;
};

export type UseTenantsResult = {
  data: TenantsVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
  loadMore: () => void;
  loadingMore: boolean;
};

// ---------------------------------------------------------------------------
// Hook args
// ---------------------------------------------------------------------------

type UseTenantsArgs = {
  client: { listEntityTenants: ApiClient["listEntityTenants"] };
  projectId: string | undefined;
  environmentId: string | undefined;
  window: EntityWindow;
  search: string;
  sort: TenantSort;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

/** Stable row identity: unassigned tenants collapse into a single bucket. */
export function tenantKey(t: TenantSummary): string {
  return t.isUnassigned ? "_unassigned" : (t.tenantId ?? "_unassigned");
}

function sortValue(t: TenantSummary, sort: TenantSort): number {
  if (sort === "impact") return t.impactScore;
  if (sort === "usage") return t.events;
  if (sort === "errors") return t.errors;
  if (sort === "llmCost") return Number(t.llmCostUsd) || 0;
  return t.lastSeenAt ? new Date(t.lastSeenAt).getTime() : 0;
}

/** Client-side sort — the list endpoint has no `sort` query param (types.ts TenantListQuery). */
function sortTenants(tenants: TenantSummary[], sort: TenantSort): TenantSummary[] {
  return [...tenants].sort((left, right) => {
    const byMetric = sortValue(right, sort) - sortValue(left, sort);
    if (byMetric !== 0) return byMetric;
    return left.label.localeCompare(right.label);
  });
}

function buildRow(t: TenantSummary): TenantRowVM {
  return {
    key: tenantKey(t),
    tenantId: t.tenantId,
    label: t.label || t.tenantId || "Unknown tenant",
    isUnassigned: t.isUnassigned,
    keyTraits: Object.entries(t.keyTraits).map(([key, value]) => ({ key, value })),
    impactScore: formatImpactScore(t.impactScore),
    events: t.events,
    errors: t.errors,
    llmCalls: t.llmCalls,
    llmCostUsd: Number(t.llmCostUsd) || 0,
    activeUsers: t.activeUsers,
    lastSeenAt: t.lastSeenAt,
    lastSeen: t.lastSeenAt ? relativeTime(t.lastSeenAt) : "—",
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTenants({
  client,
  projectId,
  environmentId,
  window,
  search,
  sort,
}: UseTenantsArgs): UseTenantsResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [raw, setRaw] = useState<TenantSummary[] | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const trimmedSearch = search.trim();

  useEffect(() => {
    if (!projectId || !environmentId) return;

    const gen = ++genRef.current;
    setStatus("loading");
    setLoadingMore(false);
    setLimit(PAGE_SIZE);

    client
      .listEntityTenants({
        projectId,
        environmentId,
        window,
        limit: PAGE_SIZE,
        ...(trimmedSearch ? { search: trimmedSearch } : {}),
      })
      .then((res) => {
        if (gen !== genRef.current) return;
        setRaw(res.data.tenants);
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setRaw(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, environmentId, window, trimmedSearch, tick]);

  const loadMore = useCallback(() => {
    if (!projectId || !environmentId || loadingMore || raw === null) return;

    const gen = ++genRef.current;
    const nextLimit = limit + PAGE_SIZE;
    setLoadingMore(true);

    client
      .listEntityTenants({
        projectId,
        environmentId,
        window,
        limit: nextLimit,
        ...(trimmedSearch ? { search: trimmedSearch } : {}),
      })
      .then((res) => {
        if (gen !== genRef.current) return;
        setLimit(nextLimit);
        setRaw(res.data.tenants);
        setLoadingMore(false);
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setLoadingMore(false);
      });
  }, [client, projectId, environmentId, window, trimmedSearch, limit, loadingMore, raw]);

  const data: TenantsVM | null = useMemo(() => {
    if (raw === null) return null;
    return {
      window,
      rows: sortTenants(raw, sort).map(buildRow),
      hasMore: raw.length > 0 && raw.length >= limit,
    };
  }, [raw, sort, window, limit]);

  return { data, status, reload, loadMore, loadingMore };
}
