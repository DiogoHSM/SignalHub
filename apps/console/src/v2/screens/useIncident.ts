import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, ErrorGroupApiClient } from "../../api/client";
import type {
  ErrorGroupIncident,
  ErrorGroupPriority,
  IncidentTimelineItem,
  UpdateErrorGroupTriageInput,
  User
} from "../../api/types";
import { relativeTime } from "../../components/ui/v2/format";
import type { NavSection } from "../nav";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type RelVM = {
  icon: string;
  tone: string;
  title: string;
  sub: string;
  target?: { kind: "section"; section: NavSection } | { kind: "drill"; groupId: string };
};

export type IncidentVM = {
  severity: string;
  severityColor: string;
  status: string;
  priority: "P1" | "P2" | "P3" | "P4" | null;
  groupId: string;
  release: string | null;
  incidentNumber: string | null;
  openedRelative: string;
  assigneeEmail: string | null;
  title: string;
  origin: string;
  occurrenceCount: number;
  affectedUsers: number;
  affectedTenants: number;
  firstSeenRelative: string;
  lastSeenRelative: string;
  silencedUntil: string | null;
  stack: string | null;
  sourceMapBadge: { resolved: boolean; frameCount: number };
  breadcrumbs: { kind: string; timeRelative: string; title: string }[];
  related: RelVM[];
  notes: { initials: string; authorEmail: string; timeRelative: string; body: string }[];
};

// ---------------------------------------------------------------------------
// Hook options + result
// ---------------------------------------------------------------------------

type UseIncidentClient = Pick<
  ApiClient,
  "listUsers"
> &
  Pick<
    ErrorGroupApiClient,
    "getErrorGroupIncident" | "updateErrorGroupTriage" | "silenceIncident" | "addTriageNote"
  >;

type UseIncidentOptions = {
  client: UseIncidentClient;
  projectId: string;
  environmentId: string;
  groupId: string;
  errorId?: string;
  onResolved: () => void;
};

export type UseIncidentResult = {
  data: IncidentVM | null;
  status: "loading" | "ready" | "error";
  reload: () => void;
  resolve: () => Promise<void>;
  reassign: (userId: string | null) => Promise<void>;
  silence: (minutes: number | null) => Promise<void>;
  addNote: (body: string) => Promise<void>;
  users: User[] | null;
  canReassign: boolean;
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

function mapPriority(p: ErrorGroupPriority | null): "P1" | "P2" | "P3" | "P4" | null {
  if (p == null) return null;
  return PRIORITY_MAP[p] ?? null;
}

function mapSeverityColor(severity: string): string {
  switch (severity) {
    case "critical":
    case "fatal":
      return "var(--sev-critical)";
    case "error":
      return "var(--sev-error)";
    case "warning":
      return "var(--sev-warning)";
    default:
      return "var(--sev-error)";
  }
}

function emailInitials(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase();
}

function mapBreadcrumbs(
  items: IncidentTimelineItem[]
): { kind: string; timeRelative: string; title: string }[] {
  return items.map((item) => ({
    kind: item.kind,
    timeRelative: relativeTime(item.timestamp),
    title: item.title
  }));
}

function mapRelated(incident: ErrorGroupIncident): RelVM[] {
  const { related } = incident;
  const rows: RelVM[] = [];

  if (related.traceId != null) {
    rows.push({
      icon: "waterfall",
      tone: "neutral",
      title: "Trace",
      sub: related.traceId,
      target: { kind: "section", section: "traces" }
    });
  } else {
    rows.push({
      icon: "waterfall",
      tone: "neutral",
      title: "Trace",
      sub: "—"
    });
  }

  if (related.sessionId != null) {
    rows.push({
      icon: "activity",
      tone: "neutral",
      title: "Session",
      sub: related.sessionId,
      target: { kind: "section", section: "investigate" }
    });
  } else {
    rows.push({
      icon: "activity",
      tone: "neutral",
      title: "Session",
      sub: "—"
    });
  }

  if (related.userId != null) {
    rows.push({
      icon: "users",
      tone: "neutral",
      title: "User",
      sub: related.userId,
      target: { kind: "section", section: "investigate" }
    });
  } else {
    rows.push({
      icon: "users",
      tone: "neutral",
      title: "User",
      sub: "—"
    });
  }

  if (related.tenantId != null) {
    rows.push({
      icon: "cube",
      tone: "neutral",
      title: "Tenant",
      sub: related.tenantId,
      target: { kind: "section", section: "investigate" }
    });
  } else {
    rows.push({
      icon: "cube",
      tone: "neutral",
      title: "Tenant",
      sub: "—"
    });
  }

  return rows;
}

function buildVM(incident: ErrorGroupIncident): IncidentVM {
  const { group, primaryOccurrence, sourceMapResolution, stronglyRelated } = incident;

  const sourceMapBadge =
    sourceMapResolution.status === "cached"
      ? { resolved: true, frameCount: sourceMapResolution.frameCount }
      : { resolved: false, frameCount: 0 };

  const notes = incident.notes.map((n) => ({
    initials: emailInitials(n.authorEmail),
    authorEmail: n.authorEmail,
    timeRelative: relativeTime(n.createdAt),
    body: n.body
  }));

  return {
    severity: group.severity,
    severityColor: mapSeverityColor(group.severity),
    status: group.status,
    priority: mapPriority(incident.priority),
    groupId: group.id,
    release: group.latestRelease,
    incidentNumber: incident.incidentNumber,
    openedRelative: relativeTime(primaryOccurrence.timestamp),
    assigneeEmail: incident.assignedTo?.email ?? null,
    title: group.message,
    origin: group.type ?? group.topStackFrame ?? "",
    occurrenceCount: group.occurrenceCount,
    affectedUsers: group.affectedUsersCount,
    affectedTenants: group.affectedTenantsCount,
    firstSeenRelative: relativeTime(group.firstSeenAt),
    lastSeenRelative: relativeTime(group.lastSeenAt),
    silencedUntil: incident.silencedUntil,
    stack: primaryOccurrence.stack,
    sourceMapBadge,
    breadcrumbs: mapBreadcrumbs(stronglyRelated.items),
    related: mapRelated(incident),
    notes
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useIncident({
  client,
  projectId,
  environmentId,
  groupId,
  errorId,
  onResolved
}: UseIncidentOptions): UseIncidentResult {
  const [hookStatus, setHookStatus] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<IncidentVM | null>(null);
  const [tick, setTick] = useState(0);
  const [users, setUsers] = useState<User[] | null>(null);
  const [canReassign, setCanReassign] = useState(false);
  const genRef = useRef(0);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  // Fetch incident — gen-counter guard for stale-fetch + unmount safety
  useEffect(() => {
    const gen = ++genRef.current;
    setHookStatus("loading");

    const query = {
      projectId,
      environmentId,
      ...(errorId !== undefined ? { errorId } : {})
    };

    client
      .getErrorGroupIncident(groupId, query)
      .then((res) => {
        if (gen !== genRef.current) return;
        setData(buildVM(res.data));
        setHookStatus("ready");
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
  }, [projectId, environmentId, groupId, errorId, tick]);

  // Fetch users (admin-gated) — on mount only
  useEffect(() => {
    client
      .listUsers()
      .then((res) => {
        setUsers(res.users);
        setCanReassign(true);
      })
      .catch(() => {
        setUsers(null);
        setCanReassign(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolve = useCallback(async () => {
    await client.updateErrorGroupTriage(groupId, {
      projectId,
      environmentId,
      status: "resolved"
    });
    onResolved();
  }, [client, groupId, projectId, environmentId, onResolved]);

  const reassign = useCallback(
    async (userId: string | null) => {
      // Cast needed: UpdateErrorGroupTriageInput requires status|priority, but
      // assignedToUserId-only updates are valid at the API level.
      await client.updateErrorGroupTriage(groupId, {
        projectId,
        environmentId,
        assignedToUserId: userId
      } as UpdateErrorGroupTriageInput);
      reload();
    },
    [client, groupId, projectId, environmentId, reload]
  );

  const silence = useCallback(
    async (minutes: number | null) => {
      await client.silenceIncident(groupId, { projectId, environmentId, minutes });
      reload();
    },
    [client, groupId, projectId, environmentId, reload]
  );

  const addNote = useCallback(
    async (body: string) => {
      await client.addTriageNote(groupId, { projectId, environmentId, body });
      reload();
    },
    [client, groupId, projectId, environmentId, reload]
  );

  return { data, status: hookStatus, reload, resolve, reassign, silence, addNote, users, canReassign };
}
