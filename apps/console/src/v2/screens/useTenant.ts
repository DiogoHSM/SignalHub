import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type {
  EntityWindow,
  TenantDetailResponse,
  TenantSummary,
  TenantTimelineRow,
  TenantTopUser,
} from "../../api/types";
import {
  formatClockUtc,
  formatCompact,
  formatLatency,
  formatUsd,
  relativeTime,
  type IconName,
} from "../../components/ui/v2";
import type { NavSection } from "../nav";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type TimelineTone = "ok" | "critical" | "warning" | "info" | "violet";

export type TenantHeaderVM = {
  initials: string;
  label: string;
  tenantId: string;
  statusLabel: string;
  plan: string;
  lastSeen: string;
};

export type TenantKpiVM = { label: string; value: string; color?: string };

export type TimelineRowVM = {
  id: string;
  clock: string;
  icon: IconName;
  tone: TimelineTone;
  title: string;
  sub: string;
  tag: string | null;
  navTo: NavSection | null;
};

export type TopUserVM = {
  userId: string;
  initials: string;
  events: string;
  cost: string;
  lastSeen: string;
};

export type SignalBarVM = { label: string; display: string; ratio: number; color: string };

export type TenantDetailVM = {
  header: TenantHeaderVM;
  kpis: TenantKpiVM[];
  timeline: TimelineRowVM[];
  topUsers: TopUserVM[];
  signalBars: SignalBarVM[];
};

export type UseTenantResult = {
  data: TenantDetailResponse | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

type UseTenantArgs = {
  client: { getEntityTenantDetail: ApiClient["getEntityTenantDetail"] };
  projectId: string | undefined;
  environmentId: string | undefined;
  tenantId: string | undefined;
  window: EntityWindow;
};

// ---------------------------------------------------------------------------
// Pure builder
// ---------------------------------------------------------------------------

function initialsOf(source: string): string {
  const cleaned = source.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned ? cleaned.slice(0, 2).toUpperCase() : "?";
}

function joinParts(...parts: Array<string | null | undefined>): string {
  return parts.filter((p) => p != null && p !== "").join(" · ");
}

function toNum(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildHeader(t: TenantSummary): TenantHeaderVM {
  const initialsSource = t.label || t.tenantId || "";
  const label = t.label || t.tenantId || "Unknown tenant";
  return {
    initials: initialsOf(initialsSource),
    label,
    tenantId: t.tenantId ?? "—",
    statusLabel: t.keyTraits.status ?? (t.lastSeenAt ? "active" : "inactive"),
    plan: t.keyTraits.plan ?? "—",
    lastSeen: t.lastSeenAt ? relativeTime(t.lastSeenAt) : "—",
  };
}

function buildKpis(t: TenantSummary): TenantKpiVM[] {
  return [
    { label: "Active users", value: formatCompact(t.activeUsers) },
    { label: "Events", value: formatCompact(t.events) },
    { label: "LLM cost", value: formatUsd(toNum(t.llmCostUsd)), color: "var(--sev-violet)" },
    { label: "Errors", value: formatCompact(t.errors), color: "var(--sev-critical)" },
    { label: "Traces", value: formatCompact(t.traces), color: "var(--sev-warning)" },
    { label: "Sessions", value: formatCompact(t.activeSessions) },
  ];
}

function buildTimelineRow(row: TenantTimelineRow): TimelineRowVM {
  const base = { id: row.id, clock: formatClockUtc(row.timestamp) };
  switch (row.type) {
    case "event":
      return { ...base, icon: "activity", tone: "ok", title: row.eventName,
        sub: joinParts(row.userId, row.sessionId), tag: null, navTo: null };
    case "error":
      return { ...base, icon: "error",
        tone: /critical|fatal|error/i.test(row.severity) ? "critical" : "warning",
        title: row.message, sub: joinParts(row.userId), tag: row.severity, navTo: null };
    case "trace":
      return { ...base, icon: "waterfall", tone: "info", title: row.name,
        sub: joinParts(formatLatency(row.durationMs), row.userId), tag: null, navTo: "traces" };
    case "llm":
      return { ...base, icon: "sparkles", tone: "violet", title: row.promptName ?? row.model,
        sub: joinParts(`${row.provider}/${row.model}`, formatUsd(toNum(row.costUsd))), tag: null, navTo: "llm" };
  }
}

function buildTopUser(u: TenantTopUser): TopUserVM {
  return {
    userId: u.userId,
    initials: initialsOf(u.userId),
    events: formatCompact(u.events),
    cost: formatUsd(toNum(u.llmCostUsd)),
    lastSeen: u.lastSeenAt ? relativeTime(u.lastSeenAt) : "—",
  };
}

function buildSignalBars(t: TenantSummary): SignalBarVM[] {
  const raw = [
    { label: "Events", value: t.events, color: "var(--accent)" },
    { label: "LLM calls", value: t.llmCalls, color: "var(--sev-violet)" },
    { label: "Traces", value: t.traces, color: "var(--sev-info)" },
    { label: "Errors", value: t.errors, color: "var(--sev-critical)" },
  ];
  const max = Math.max(1, ...raw.map((r) => r.value));
  return raw.map((r) => ({ label: r.label, display: formatCompact(r.value), ratio: r.value / max, color: r.color }));
}

export function buildTenantVM(res: TenantDetailResponse): TenantDetailVM {
  return {
    header: buildHeader(res.tenant),
    kpis: buildKpis(res.tenant),
    timeline: res.timeline.map(buildTimelineRow),
    topUsers: res.topUsers.map(buildTopUser),
    signalBars: buildSignalBars(res.tenant),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTenant({ client, projectId, environmentId, tenantId, window }: UseTenantArgs): UseTenantResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<TenantDetailResponse | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId || !tenantId) return;

    const gen = ++genRef.current;
    setStatus("loading");

    client
      .getEntityTenantDetail(tenantId, { projectId, environmentId, window })
      .then((res) => {
        if (gen !== genRef.current) return;
        setData(res.data);
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, environmentId, tenantId, window, tick]);

  return { data, status, reload };
}
