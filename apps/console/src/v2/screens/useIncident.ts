import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, ErrorGroupApiClient } from "../../api/client";
import type {
  ErrorGroupIncident,
  ErrorGroupPriority,
  ErrorGroupStatus,
  IncidentExternalLink,
  IncidentReplay,
  IncidentTimelineItem,
  SourceMapResolution,
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
  errorTimestamp: string;
  replay: IncidentReplay | null;
  sourceMapBadge: { resolved: boolean; frameCount: number };
  sourceMapDiagnostic: {
    status: "resolved" | "partially_resolved" | "unresolved" | "unavailable" | "none";
    label: string;
    detail: string;
    release: string | null;
    frameCount: number;
    unresolvedFrameCount: number;
  };
  breadcrumbs: { kind: string; timeRelative: string; title: string }[];
  related: RelVM[];
  notes: { initials: string; authorEmail: string; timeRelative: string; body: string }[];
  externalIssues: IncidentExternalLink[];
  codeContext: ErrorGroupIncident["codeContext"];
};

// ---------------------------------------------------------------------------
// Hook options + result
// ---------------------------------------------------------------------------

type UseIncidentClient = Pick<
  ApiClient,
  "listUsers"
> &
  Partial<Pick<ApiClient, "getErrorSourceMapResolution">> &
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
  setPriority: (priority: "P1" | "P2" | "P3" | "P4" | null) => Promise<void>;
  setStatus: (status: ErrorGroupStatus) => Promise<void>;
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

const VM_PRIORITY_TO_API: Record<"P1" | "P2" | "P3" | "P4", ErrorGroupPriority> = {
  P1: "urgent",
  P2: "high",
  P3: "normal",
  P4: "low"
};

function priorityToApi(p: "P1" | "P2" | "P3" | "P4" | null): ErrorGroupPriority | null {
  if (p == null) return null;
  return VM_PRIORITY_TO_API[p];
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

function sourceMapDiagnostic(
  incident: ErrorGroupIncident,
  resolution: SourceMapResolution | null
): IncidentVM["sourceMapDiagnostic"] {
  const { group, primaryOccurrence, sourceMapResolution } = incident;
  const release = resolution?.release ?? primaryOccurrence.release ?? group.latestRelease;

  if (resolution) {
    if (resolution.status === "resolved") {
      return {
        status: "resolved",
        label: "Source maps resolved",
        detail: `${resolution.frames.length} stack frame${resolution.frames.length === 1 ? "" : "s"} resolved for release ${release ?? "unknown"}.`,
        release,
        frameCount: resolution.frames.length,
        unresolvedFrameCount: 0
      };
    }

    if (resolution.status === "partially_resolved") {
      return {
        status: "partially_resolved",
        label: "Source maps partially resolved",
        detail: `${resolution.frames.length} frame${resolution.frames.length === 1 ? "" : "s"} resolved, ${resolution.unresolvedFrameCount} unresolved. Upload maps for the missing generated files using the same release.`,
        release,
        frameCount: resolution.frames.length,
        unresolvedFrameCount: resolution.unresolvedFrameCount
      };
    }

    if (resolution.status === "unavailable") {
      return {
        status: "unavailable",
        label: "Source maps unavailable",
        detail: "Resolution could not run for this occurrence. Check Sigmon source-map storage and retry after the artifacts API is healthy.",
        release,
        frameCount: 0,
        unresolvedFrameCount: resolution.unresolvedFrameCount
      };
    }

    const missingRelease = release == null;
    return {
      status: "unresolved",
      label: "Source maps not applied",
      detail: missingRelease
        ? "This error has no release. Send a release from the SDK and upload source maps with the same release value."
        : `No matching source map resolved for release ${release}. Check that CI uploaded the map for the generated file path shown in the stack.`,
      release,
      frameCount: 0,
      unresolvedFrameCount: resolution.unresolvedFrameCount
    };
  }

  if (sourceMapResolution.status === "cached") {
    return {
      status: "resolved",
      label: "Source maps resolved",
      detail: `${sourceMapResolution.frameCount} cached stack frame${sourceMapResolution.frameCount === 1 ? "" : "s"} resolved for this group.`,
      release,
      frameCount: sourceMapResolution.frameCount,
      unresolvedFrameCount: 0
    };
  }

  if (!primaryOccurrence.stack) {
    return {
      status: "none",
      label: "No stack trace captured",
      detail: "This occurrence did not include a stack trace. Capture thrown Error objects in the SDK so Sigmon can map frames.",
      release,
      frameCount: 0,
      unresolvedFrameCount: 0
    };
  }

  return {
    status: "unresolved",
    label: "Source maps not applied",
    detail: release == null
      ? "This error has a stack trace but no release. Configure the SDK release and upload matching maps from CI."
      : `No cached source-map resolution was found for release ${release}. Upload maps from CI or open Artifacts to verify the release.`,
    release,
    frameCount: 0,
    unresolvedFrameCount: 0
  };
}

// Always emits four rows (trace/session/user/tenant); rows without an underlying id get no `target` (screen renders them as unavailable).
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

function buildVM(incident: ErrorGroupIncident, resolution: SourceMapResolution | null = null): IncidentVM {
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
    openedRelative: relativeTime(group.firstSeenAt),
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
    errorTimestamp: primaryOccurrence.timestamp,
    replay: incident.replay,
    sourceMapBadge,
    sourceMapDiagnostic: sourceMapDiagnostic(incident, resolution),
    breadcrumbs: mapBreadcrumbs(stronglyRelated.items),
    related: mapRelated(incident),
    notes,
    externalIssues: incident.externalIssues ?? [],
    codeContext: incident.codeContext
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
      .then(async (res) => {
        if (gen !== genRef.current) return;

        const primaryErrorId = errorId ?? res.data.primaryOccurrence.id;
        const resolution = client.getErrorSourceMapResolution
          ? await client.getErrorSourceMapResolution(primaryErrorId, { projectId, environmentId }).catch(() => null)
          : null;

        if (gen !== genRef.current) return;
        setData(buildVM(res.data, resolution));
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
      .catch((err: unknown) => {
        setUsers(null);
        setCanReassign(false);
        const status = (err as { status?: number } | null)?.status;
        if (status !== 401 && status !== 403) {
          console.warn("listUsers failed with non-auth error:", err);
        }
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

  const setPriority = useCallback(
    async (priority: "P1" | "P2" | "P3" | "P4" | null) => {
      await client.updateErrorGroupTriage(groupId, {
        projectId,
        environmentId,
        priority: priorityToApi(priority)
      });
      reload();
    },
    [client, groupId, projectId, environmentId, reload]
  );

  const setStatus = useCallback(
    async (status: ErrorGroupStatus) => {
      await client.updateErrorGroupTriage(groupId, {
        projectId,
        environmentId,
        status
      });
      reload();
    },
    [client, groupId, projectId, environmentId, reload]
  );

  const reassign = useCallback(
    async (userId: string | null) => {
      await client.updateErrorGroupTriage(groupId, {
        projectId,
        environmentId,
        assignedToUserId: userId
      });
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

  return {
    data,
    status: hookStatus,
    reload,
    resolve,
    setPriority,
    setStatus,
    reassign,
    silence,
    addNote,
    users,
    canReassign
  };
}
