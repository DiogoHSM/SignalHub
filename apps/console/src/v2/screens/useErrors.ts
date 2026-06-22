import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, ErrorGroupApiClient } from "../../api/client";
import type { ErrorGroupRecord, ErrorGroupStatus, OverviewWindow } from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type ErrorTabsVM = {
  events: number;
  errors: number;
  traces: number;
  llm: number;
  tenants: number;
  users: number;
};

export type ErrorSummaryVM = {
  errors24h: number;
  openGroups: number;
  critical: number;
  mttr: null;
  topRelease: string | null;
};

export type ErrorRowVM = {
  id: string;
  message: string;
  severity: string;
  status: string;
  priority: "P1" | "P2" | "P3" | "P4" | null;
  events: number;
  users: number | null;
  tenants: number | null;
  last: string;
};

export type ErrorsVM = {
  tabs: ErrorTabsVM;
  summary: ErrorSummaryVM;
  volume: number[];
  rows: ErrorRowVM[];
};

// ---------------------------------------------------------------------------
// Hook options
// ---------------------------------------------------------------------------

type UseErrorsOptions = {
  client: Pick<ApiClient, "getOverview"> & Pick<ErrorGroupApiClient, "listErrorGroups">;
  projectId: string;
  environmentId: string;
  window: OverviewWindow;
  severity?: string;
  status?: ErrorGroupStatus;
};

export type UseErrorsResult = {
  data: ErrorsVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRIORITY_MAP: Record<string, "P1" | "P2" | "P3" | "P4"> = {
  urgent: "P1",
  high: "P2",
  normal: "P3",
  low: "P4"
};

function mapPriority(p: ErrorGroupRecord["priority"]): "P1" | "P2" | "P3" | "P4" | null {
  if (p == null) return null;
  return PRIORITY_MAP[p] ?? null;
}

function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function topRelease(rows: ErrorGroupRecord[]): string | null {
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (row.latestRelease == null) continue;
    counts.set(row.latestRelease, (counts.get(row.latestRelease) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  let best: string | null = null;
  let bestCount = 0;

  for (const [release, count] of counts) {
    if (count > bestCount) {
      best = release;
      bestCount = count;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useErrors({
  client,
  projectId,
  environmentId,
  window: timeWindow,
  severity,
  status
}: UseErrorsOptions): UseErrorsResult {
  const [hookStatus, setHookStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<ErrorsVM | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => {
    setHookStatus("loading");
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const gen = ++genRef.current;
    setHookStatus("loading");

    const overviewQuery = { projectId, environmentId, window: timeWindow };
    const groupsQuery = {
      projectId,
      environmentId,
      ...(severity !== undefined ? { severity } : {}),
      ...(status !== undefined ? { status } : {})
    };

    Promise.all([
      client.listErrorGroups(groupsQuery),
      client.getOverview(overviewQuery).then((r) => r.data)
    ])
      .then(([groupsRes, overview]) => {
        if (gen !== genRef.current) return;

        const groups = groupsRes.data;

        // tabs
        const { kpis } = overview;
        const tabs: ErrorTabsVM = {
          events: kpis.events,
          errors: kpis.errors,
          traces: kpis.traces,
          llm: kpis.llmCalls,
          tenants: kpis.activeTenants,
          users: kpis.activeUsers
        };

        // volume
        const volume = overview.trends.errors.map((b) => b.errors);

        // summary
        const criticalSeverities = new Set(["critical", "fatal"]);
        const critical = overview.top.errorSeverity
          .filter((e) => criticalSeverities.has(e.severity))
          .reduce((sum, e) => sum + e.total, 0);

        const openStatuses = new Set<string>(["open", "investigating"]);
        const openGroups = groups.filter((g) => openStatuses.has(g.status)).length;

        const summary: ErrorSummaryVM = {
          errors24h: kpis.errors,
          openGroups,
          critical,
          mttr: null,
          topRelease: topRelease(groups)
        };

        // rows
        const rows: ErrorRowVM[] = groups.map((g) => ({
          id: g.id,
          message: g.message,
          severity: g.severity,
          status: g.status,
          priority: mapPriority(g.priority),
          events: g.occurrenceCount,
          users: g.affectedUsersCount,
          tenants: g.affectedTenantsCount,
          last: relativeTime(g.lastSeenAt)
        }));

        setData({ tabs, summary, volume, rows });
        setHookStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        setHookStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, environmentId, timeWindow, severity, status, tick]);

  return { data, status: hookStatus, reload };
}
