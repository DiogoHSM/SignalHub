import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type {
  AlertEventResponse,
  AlertRuleResponse,
  AlertSeverity,
  NotificationChannelResponse,
} from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type SeverityTag = "critical" | "warn" | "";

export type AlertRuleRowVM = {
  id: string;
  name: string;
  subLabel: string;
  severity: AlertSeverity;
  severityTag: SeverityTag;
  enabled: boolean;
  channelLabel: string;
  fires7d: number;
};

export type ChannelRowVM = {
  id: string;
  name: string;
  icon: "webhook" | "mail";
  target: string;
  ok: boolean;
};

export type TimelineFireVM = { hourFraction: number; tone: "critical" | "warn" };
export type TimelineDayVM = { label: string; fires: TimelineFireVM[] };

export type AlertsHeaderVM = { activeRuleCount: number; fires7d: number };

export type AlertsVM = {
  header: AlertsHeaderVM;
  rules: AlertRuleRowVM[];
  channels: ChannelRowVM[];
  timeline: TimelineDayVM[];
};

export type AlertsInput = {
  rules: AlertRuleResponse[];
  events: AlertEventResponse[];
  channels: NotificationChannelResponse[];
};

export type UseAlertsResult = {
  data: AlertsVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function severityToTag(sev: AlertSeverity): SeverityTag {
  if (sev === "critical") return "critical";
  if (sev === "warning") return "warn";
  return "";
}

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// ---------------------------------------------------------------------------
// Pure VM builder
// ---------------------------------------------------------------------------

export function buildAlertsVM(input: AlertsInput, nowMs: number): AlertsVM {
  const { rules, events, channels } = input;

  const channelName = new Map<string, string>();
  for (const c of channels) channelName.set(c.id, c.name);

  const sevenDaysAgo = nowMs - 7 * DAY_MS;
  const recentEvents = events.filter((e) => {
    const t = new Date(e.triggeredAt).getTime();
    return Number.isFinite(t) && t >= sevenDaysAgo && t <= nowMs;
  });

  const firesByRule = new Map<string, number>();
  for (const e of recentEvents) {
    if (e.ruleId) firesByRule.set(e.ruleId, (firesByRule.get(e.ruleId) ?? 0) + 1);
  }

  const ruleRows: AlertRuleRowVM[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    subLabel: `${r.type} · ${r.threshold} · ${r.windowMinutes}m`,
    severity: r.severity,
    severityTag: severityToTag(r.severity),
    enabled: r.enabled,
    channelLabel:
      (r.notificationChannelId && channelName.get(r.notificationChannelId)) || "Unassigned",
    fires7d: firesByRule.get(r.id) ?? 0,
  }));

  const channelRows: ChannelRowVM[] = channels.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.type === "webhook" ? "webhook" : "mail",
    target: c.type === "webhook" ? c.url : c.emailRecipients.join(", "),
    ok: c.enabled,
  }));

  const startOfToday = startOfUtcDay(nowMs);
  const timeline: TimelineDayVM[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfToday - (6 - i) * DAY_MS);
    timeline.push({ label: `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`, fires: [] });
  }
  for (const e of recentEvents) {
    const t = new Date(e.triggeredAt).getTime();
    const dayIndex = 6 - Math.floor((startOfToday - startOfUtcDay(t)) / DAY_MS);
    if (dayIndex < 0 || dayIndex > 6) continue;
    const d = new Date(t);
    const hourFraction = (d.getUTCHours() + d.getUTCMinutes() / 60) / 24;
    timeline[dayIndex].fires.push({
      hourFraction,
      tone: e.severity === "critical" ? "critical" : "warn",
    });
  }

  const activeRuleCount = rules.filter((r) => r.enabled && r.archivedAt == null).length;

  return {
    header: { activeRuleCount, fires7d: recentEvents.length },
    rules: ruleRows,
    channels: channelRows,
    timeline,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type UseAlertsArgs = {
  client: {
    listAlertRules: ApiClient["listAlertRules"];
    listAlertEvents: ApiClient["listAlertEvents"];
    listNotificationChannels: ApiClient["listNotificationChannels"];
  };
  projectId: string | undefined;
  environmentId: string | undefined;
};

export function useAlerts({ client, projectId, environmentId }: UseAlertsArgs): UseAlertsResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<AlertsVM | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId) return;

    const gen = ++genRef.current;
    setStatus("loading");

    const rulesFetch = client.listAlertRules({ projectId, environmentId });
    const eventsFetch = client.listAlertEvents({ projectId, environmentId, limit: 100 });
    const channelsFetch = client.listNotificationChannels();

    Promise.all([rulesFetch, eventsFetch, channelsFetch])
      .then(([rulesRes, eventsRes, channelsRes]) => {
        if (gen !== genRef.current) return;
        const vm = buildAlertsVM(
          { rules: rulesRes.rules, events: eventsRes.data, channels: channelsRes.channels },
          Date.now(),
        );
        setData(vm);
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
  }, [projectId, environmentId, tick]);

  return { data, status, reload };
}
