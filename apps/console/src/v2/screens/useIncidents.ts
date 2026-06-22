import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { ErrorGroupRecord, ErrorGroupPriority } from "../../api/types";
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
};

export type IncidentsVM = {
  kpis: { active: number; p1: number; mttrLabel: string; resolved7d: number };
  rows: IncidentRowVM[];
};

export type UseIncidentsResult = {
  data: IncidentsVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

// ---------------------------------------------------------------------------
// Hook args
// ---------------------------------------------------------------------------

type UseIncidentsArgs = {
  client: Pick<ApiClient, "listErrorGroups" | "listUsers"> & {
    getIncidentMttr?: ApiClient["getIncidentMttr"];
  };
  projectId: string | undefined;
  environmentId: string | undefined;
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useIncidents({
  client,
  projectId,
  environmentId
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

    const openFetch = client.listErrorGroups({ ...scope, status: "open", limit: 100 });
    const investigatingFetch = client.listErrorGroups({ ...scope, status: "investigating", limit: 100 });
    const mttrFetch = client.getIncidentMttr
      ? client.getIncidentMttr({ ...scope, window: "7d" }).catch(() => null)
      : Promise.resolve(null);
    const usersFetch = client.listUsers().catch(() => null);

    Promise.all([openFetch, investigatingFetch, mttrFetch, usersFetch])
      .then(([openRes, investigatingRes, mttrRes, usersRes]) => {
        if (gen !== genRef.current) return;

        // Merge open + investigating
        const allGroups: ErrorGroupRecord[] = [
          ...openRes.data,
          ...investigatingRes.data
        ];

        // Build user map for assignee resolution (null means fetch failed → degrade)
        const userMap = usersRes
          ? new Map(usersRes.users.map((u) => [u.id, u]))
          : null;

        // Sort: priority rank asc, then lastSeenAt desc
        const sorted = [...allGroups].sort((a, b) => {
          const rankA = priorityRank(a.priority);
          const rankB = priorityRank(b.priority);
          if (rankA !== rankB) return rankA - rankB;
          return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
        });

        // Rows
        const rows: IncidentRowVM[] = sorted.map((g) => {
          let assignee: IncidentAssignee = null;
          if (g.assignedToUserId != null) {
            if (userMap === null) {
              // listUsers failed — degrade to generic
              assignee = { kind: "generic" };
            } else {
              const user = userMap.get(g.assignedToUserId);
              if (user) {
                assignee = { kind: "initials", initials: emailInitials(user.email) };
              } else {
                // User ID not found in list (could be deleted) — generic
                assignee = { kind: "generic" };
              }
            }
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
            affectedTenantsCount: g.affectedTenantsCount
          };
        });

        // KPIs
        const active = allGroups.length;
        const p1 = allGroups.filter((g) => g.priority === "urgent").length;
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
  }, [projectId, environmentId, tick]);

  return { data, status: hookStatus, reload };
}
