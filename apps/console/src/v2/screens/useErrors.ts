import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, ErrorGroupApiClient } from "../../api/client";
import type { ErrorGroupRecord, ErrorGroupStatus, OverviewWindow } from "../../api/types";
import { relativeTime } from "../../components/ui/v2/format";

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
  crashes: number;
  critical: number;
  mttr: number | null;
  topRelease: string | null;
};

export type ErrorRowVM = {
  id: string;
  message: string;
  severity: string;
  isCrash: boolean;
  status: string;
  priority: "P1" | "P2" | "P3" | "P4" | null;
  events: number;
  users: number | null;
  tenants: number | null;
  last: string;
  trend: number[];
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
  client: Pick<ApiClient, "getOverview"> & Pick<ErrorGroupApiClient, "listErrorGroups"> & {
    getIncidentMttr?: ApiClient["getIncidentMttr"];
  };
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

function topRelease(rows: ErrorGroupRecord[]): string | null {
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (row.latestRelease == null) continue;
    counts.set(row.latestRelease, (counts.get(row.latestRelease) ?? 0) + row.occurrenceCount);
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
      client.getOverview(overviewQuery).then((r) => r.data),
      client.getIncidentMttr
        ? client
            .getIncidentMttr({ projectId, environmentId, window: "7d" })
            .then((r) => r.data)
            .catch(() => ({ mttrMs: null, resolvedCount: 0, windowDays: 7 }))
        : Promise.resolve({ mttrMs: null, resolvedCount: 0, windowDays: 7 })
    ])
      .then(([groupsRes, overview, mttr]) => {
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
        const crashes = overview.top.errorSeverity
          .filter((e) => e.severity === "fatal")
          .reduce((sum, e) => sum + e.total, 0);

        const openStatuses = new Set<string>(["open", "investigating"]);
        const openGroups = groups.filter((g) => openStatuses.has(g.status)).length;

        const summary: ErrorSummaryVM = {
          errors24h: kpis.errors,
          openGroups,
          crashes,
          critical,
          mttr: mttr.mttrMs,
          topRelease: topRelease(groups)
        };

        // rows
        const rows: ErrorRowVM[] = groups.map((g) => ({
          id: g.id,
          message: g.message,
          severity: g.severity,
          isCrash: g.severity === "fatal",
          status: g.status,
          priority: mapPriority(g.priority),
          events: g.occurrenceCount,
          users: g.affectedUsersCount,
          tenants: g.affectedTenantsCount,
          last: relativeTime(g.lastSeenAt),
          trend: g.trend ?? []
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
