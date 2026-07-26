import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { ActivitySort, EntityWindow, TenantListQuery, TenantSummary } from "../../api/types";
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

/** Maps the view-level sort id to the server's wire-level sort value (the only mismatch is llmCost/llm_cost). */
function toServerSort(sort: TenantSort): ActivitySort {
  return sort === "llmCost" ? "llm_cost" : sort;
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
  const [cursor, setCursor] = useState<string | undefined>(undefined);
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
    setCursor(undefined);

    client
      .listEntityTenants({
        projectId,
        environmentId,
        window,
        limit: PAGE_SIZE,
        sort: toServerSort(sort),
        ...(trimmedSearch ? { search: trimmedSearch } : {}),
      })
      .then((res) => {
        if (gen !== genRef.current) return;
        setRaw(res.data.tenants);
        setCursor(res.data.cursor);
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
  }, [projectId, environmentId, window, trimmedSearch, sort, tick]);

  const loadMore = useCallback(() => {
    if (!projectId || !environmentId || !cursor || loadingMore || raw === null) return;

    const gen = ++genRef.current;
    setLoadingMore(true);

    client
      .listEntityTenants({
        projectId,
        environmentId,
        window,
        limit: PAGE_SIZE,
        sort: toServerSort(sort),
        cursor,
        ...(trimmedSearch ? { search: trimmedSearch } : {}),
      })
      .then((res) => {
        if (gen !== genRef.current) return;
        setRaw((current) => (current ? [...current, ...res.data.tenants] : res.data.tenants));
        setCursor(res.data.cursor);
        setLoadingMore(false);
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setLoadingMore(false);
      });
  }, [client, projectId, environmentId, window, trimmedSearch, sort, cursor, loadingMore, raw]);

  const data: TenantsVM | null = raw
    ? { window, rows: raw.map(buildRow), hasMore: Boolean(cursor) }
    : null;

  return { data, status, reload, loadMore, loadingMore };
}
