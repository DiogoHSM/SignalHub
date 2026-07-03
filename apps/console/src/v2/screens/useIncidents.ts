import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { ErrorGroupRecord, ErrorGroupPriority, ErrorGroupStatus } from "../../api/types";
import { formatDurationShort, relativeTime } from "../../components/ui/v2/format";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type IncidentAssignee =
  | { kind: "initials"; initials: string }
  | { kind: "generic" }
  | null;

export type IncidentRowVM = {
  id: string;
  message: string;
  severity: string;
  status: "open" | "investigating" | "resolved" | "ignored";
  priority: "P1" | "P2" | "P3" | "P4" | null;
  incidentNumber: string | null;
  openedRelative: string;
  assignee: IncidentAssignee;
  occurrenceCount: number;
  affectedUsersCount: number;
  affectedTenantsCount: number;
  trend: number[];
};

export type IncidentsVM = {
  kpis: { active: number; p1: number; mttrLabel: string; resolved7d: number };
  rows: IncidentRowVM[];
};

export type IncidentView = "active" | "history";
export type IncidentPriorityFilter = "all" | "P1" | "P2" | "P3" | "P4" | "none";
export type IncidentStatusFilter = "all" | ErrorGroupStatus;
export type IncidentAssigneeFilter = "all" | "assigned" | "unassigned";

export type UseIncidentsResult = {
  data: IncidentsVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

// ---------------------------------------------------------------------------
// Hook args
// ---------------------------------------------------------------------------

type UseIncidentsArgs = {
  client: Pick<ApiClient, "listErrorGroups"> & {
    getIncidentMttr?: ApiClient["getIncidentMttr"];
    getOperations?: ApiClient["getOperations"];
  };
  projectId: string | undefined;
  environmentId: string | undefined;
  view?: IncidentView;
  priorityFilter?: IncidentPriorityFilter;
  statusFilter?: IncidentStatusFilter;
  assigneeFilter?: IncidentAssigneeFilter;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRIORITY_MAP: Record<ErrorGroupPriority, "P1" | "P2" | "P3" | "P4"> = {
  urgent: "P1",
  high: "P2",
  normal: "P3",
  low: "P4"
};

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3
};

function mapPriority(p: ErrorGroupPriority | null): "P1" | "P2" | "P3" | "P4" | null {
  if (p == null) return null;
  return PRIORITY_MAP[p] ?? null;
}

function priorityRank(p: ErrorGroupPriority | null): number {
  if (p == null) return 999;
  return PRIORITY_RANK[p] ?? 999;
}

function emailInitials(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase();
}

function statusQueries(view: IncidentView, statusFilter: IncidentStatusFilter): ErrorGroupStatus[] {
  if (statusFilter !== "all") return [statusFilter];
  return view === "history" ? ["resolved", "ignored"] : ["open", "investigating"];
}

function matchesPriority(group: ErrorGroupRecord, priorityFilter: IncidentPriorityFilter): boolean {
  if (priorityFilter === "all") return true;
  if (priorityFilter === "none") return group.priority == null;
  return mapPriority(group.priority) === priorityFilter;
}

function matchesAssignee(group: ErrorGroupRecord, assigneeFilter: IncidentAssigneeFilter): boolean {
  if (assigneeFilter === "all") return true;
  const isAssigned = group.assignedToUserId != null;
  return assigneeFilter === "assigned" ? isAssigned : !isAssigned;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useIncidents({
  client,
  projectId,
  environmentId,
  view = "active",
  priorityFilter = "all",
  statusFilter = "all",
  assigneeFilter = "all"
}: UseIncidentsArgs): UseIncidentsResult {
  const [hookStatus, setHookStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<IncidentsVM | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    // Guard: do nothing if scope is not yet known
    if (!projectId || !environmentId) return;

    const gen = ++genRef.current;
    setHookStatus("loading");

    const scope = { projectId, environmentId };
    const statuses = statusQueries(view, statusFilter);

    const groupFetches = statuses.map((status) =>
      client.listErrorGroups({ ...scope, status, limit: 100 })
    );
    const mttrFetch = client.getIncidentMttr
      ? client.getIncidentMttr({ ...scope, window: "7d" }).catch((err) => {
          console.error(err);
          return null;
        })
      : Promise.resolve(null);
    const operationsFetch = client.getOperations
      ? client.getOperations({ ...scope, window: "24h" })
          .then((response) => response.data)
          .catch((err) => {
            console.error(err);
            return null;
          })
      : Promise.resolve(null);

    Promise.all([Promise.all(groupFetches), mttrFetch, operationsFetch])
      .then(([groupResponses, mttrRes, operationsRes]) => {
        if (gen !== genRef.current) return;

        const allGroups: ErrorGroupRecord[] = groupResponses.flatMap((response) => response.data);

        // Sort: priority rank asc, then lastSeenAt desc
        const visibleGroups = allGroups.filter(
          (group) =>
            matchesPriority(group, priorityFilter) &&
            matchesAssignee(group, assigneeFilter)
        );

        const sorted = [...visibleGroups].sort((a, b) => {
          const rankA = priorityRank(a.priority);
          const rankB = priorityRank(b.priority);
          if (rankA !== rankB) return rankA - rankB;
          return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
        });

        // Rows
        const rows: IncidentRowVM[] = sorted.map((g) => {
          let assignee: IncidentAssignee = null;
          if (g.assignedToUserId != null) {
            assignee = g.assignedTo
              ? { kind: "initials", initials: emailInitials(g.assignedTo.email) }
              : { kind: "generic" };
          }

          return {
            id: g.id,
            message: g.message,
            severity: g.severity,
            status: g.status,
            priority: mapPriority(g.priority),
            incidentNumber: g.incidentNumber,
            openedRelative: relativeTime(g.firstSeenAt),
            assignee,
            occurrenceCount: g.occurrenceCount,
            affectedUsersCount: g.affectedUsersCount,
            affectedTenantsCount: g.affectedTenantsCount,
            trend: g.trend ?? []
          };
        });

        // KPIs
        const serverIncidents = operationsRes?.summary?.incidents ?? null;
        const active = serverIncidents
          ? serverIncidents.open + serverIncidents.investigating
          : allGroups.length;
        const p1 = serverIncidents
          ? serverIncidents.urgent
          : allGroups.filter((g) => g.priority === "urgent").length;
        const mttrMs = mttrRes?.data?.mttrMs ?? null;
        const mttrLabel = formatDurationShort(mttrMs);
        const resolved7d = mttrRes?.data?.resolvedCount ?? 0;

        setData({
          kpis: { active, p1, mttrLabel, resolved7d },
          rows
        });
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
  }, [projectId, environmentId, view, priorityFilter, statusFilter, assigneeFilter, tick]);

  return { data, status: hookStatus, reload };
}
