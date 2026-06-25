import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type {
  AlertEventResponse,
  AlertRuleResponse,
  AlertSeverity,
  AlertSuggestionResponse,
  CreateAlertRuleInput,
  CreateNotificationChannelInput,
  NotificationChannelResponse,
  UpdateAlertRuleInput,
  UpdateNotificationChannelInput,
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
  // raw editable fields for inline editor
  type: AlertRuleResponse["type"];
  threshold: string;
  windowMinutes: number;
  cooldownMinutes: number;
  routePattern: string | null;
  minimumSampleSize: number;
  notificationChannelId: string | null;
};

export type ChannelRowVM = {
  id: string;
  name: string;
  icon: "webhook" | "mail";
  target: string;
  ok: boolean;
  type: "webhook" | "email";
  url: string | null;
  emailRecipients: string[];
  secretHeaderName: string | null;
  hasSecret: boolean;
};

export type SuggestionRowVM = {
  key: string;
  type: AlertRuleResponse["type"];
  severity: AlertSeverity;
  title: string;
  sub: string;
  windowMinutes: number;
  threshold: string;
  routePattern?: string | null;
  minimumSampleSize?: number;
  cooldownMinutes: number;
  rationale: string;
};

export type TimelineFireVM = { hourFraction: number; tone: "critical" | "warn" };
export type TimelineDayVM = { label: string; fires: TimelineFireVM[] };

export type AlertsHeaderVM = { activeRuleCount: number; fires7d: number };

export type AlertsVM = {
  header: AlertsHeaderVM;
  rules: AlertRuleRowVM[];
  channels: ChannelRowVM[];
  timeline: TimelineDayVM[];
  suggestions: SuggestionRowVM[];
};

export type AlertsInput = {
  rules: AlertRuleResponse[];
  events: AlertEventResponse[];
  channels: NotificationChannelResponse[];
  suggestions?: AlertSuggestionResponse[];
};

export type CreateRuleForm = {
  name: string;
  type: AlertRuleResponse["type"];
  severity: AlertSeverity;
  windowMinutes: number;
  threshold: string;
  cooldownMinutes: number;
  routePattern?: string | null;
  minimumSampleSize?: number;
  notificationChannelId?: string | null;
  enabled?: boolean;
};

export type UseAlertsResult = {
  data: AlertsVM | null;
  status: "loading" | "ok" | "error";
  busy: boolean;
  reload: () => void;
  createRule: (form: CreateRuleForm) => Promise<boolean>;
  updateRule: (id: string, input: UpdateAlertRuleInput) => Promise<boolean>;
  archiveRule: (id: string) => Promise<boolean>;
  createChannel: (input: CreateNotificationChannelInput) => Promise<boolean>;
  updateChannel: (id: string, input: UpdateNotificationChannelInput) => Promise<boolean>;
  archiveChannel: (id: string) => Promise<boolean>;
  createFromSuggestion: (s: AlertSuggestionResponse) => Promise<boolean>;
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
  const { rules, events, channels, suggestions = [] } = input;

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
    type: r.type,
    threshold: r.threshold,
    windowMinutes: r.windowMinutes,
    cooldownMinutes: r.cooldownMinutes,
    routePattern: r.routePattern,
    minimumSampleSize: r.minimumSampleSize,
    notificationChannelId: r.notificationChannelId,
  }));

  const channelRows: ChannelRowVM[] = channels.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.type === "webhook" ? "webhook" : "mail",
    target: c.type === "webhook" ? c.url : c.emailRecipients.join(", "),
    ok: c.enabled,
    type: c.type,
    url: c.type === "webhook" ? c.url : null,
    emailRecipients: c.type === "email" ? c.emailRecipients : [],
    secretHeaderName: c.type === "webhook" ? c.secretHeaderName : null,
    hasSecret: c.hasSecret,
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

  const suggestionRows: SuggestionRowVM[] = suggestions.map((s) => ({
    key: s.key,
    type: s.type,
    severity: s.severity,
    title: s.title,
    sub: s.sub,
    windowMinutes: s.windowMinutes,
    threshold: s.threshold,
    routePattern: s.routePattern,
    minimumSampleSize: s.minimumSampleSize,
    cooldownMinutes: s.cooldownMinutes,
    rationale: s.rationale,
  }));

  return {
    header: { activeRuleCount, fires7d: recentEvents.length },
    rules: ruleRows,
    channels: channelRows,
    timeline,
    suggestions: suggestionRows,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type UseAlertsArgs = {
  client: Pick<
    ApiClient,
    | "listAlertRules"
    | "listAlertEvents"
    | "listNotificationChannels"
    | "createAlertRule"
    | "updateAlertRule"
    | "archiveAlertRule"
    | "createNotificationChannel"
    | "updateNotificationChannel"
    | "archiveNotificationChannel"
  > & Partial<Pick<ApiClient, "listAlertSuggestions">>;
  projectId: string | undefined;
  environmentId: string | undefined;
};

export function useAlerts({ client, projectId, environmentId }: UseAlertsArgs): UseAlertsResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<AlertsVM | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId) return;

    const gen = ++genRef.current;
    setStatus("loading");

    const nowMs = Date.now();

    const rulesFetch = client.listAlertRules({ projectId, environmentId });
    const eventsFetch = client.listAlertEvents({ projectId, environmentId, limit: 100 });
    const channelsFetch = client.listNotificationChannels();
    const suggestionsFetch = client.listAlertSuggestions
      ? client.listAlertSuggestions({ projectId, environmentId }).catch(() => ({ suggestions: [] as AlertSuggestionResponse[] }))
      : Promise.resolve({ suggestions: [] as AlertSuggestionResponse[] });

    Promise.all([rulesFetch, eventsFetch, channelsFetch, suggestionsFetch])
      .then(([rulesRes, eventsRes, channelsRes, suggestionsRes]) => {
        if (gen !== genRef.current) return;
        const vm = buildAlertsVM(
          {
            rules: rulesRes.rules,
            events: eventsRes.data,
            channels: channelsRes.channels,
            suggestions: suggestionsRes.suggestions,
          },
          nowMs,
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

  const run = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        reload();
        return true;
      } catch (err) {
        console.error(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const createRule = useCallback(
    (form: CreateRuleForm) =>
      run(async () => {
        if (!projectId || !environmentId) return;
        const input: CreateAlertRuleInput = {
          projectId,
          environmentId,
          name: form.name,
          type: form.type,
          severity: form.severity,
          windowMinutes: form.windowMinutes,
          threshold: form.threshold,
          cooldownMinutes: form.cooldownMinutes,
          routePattern: form.routePattern,
          minimumSampleSize: form.minimumSampleSize,
          notificationChannelId: form.notificationChannelId,
          enabled: form.enabled ?? true,
        };
        await client.createAlertRule(input);
      }),
    [client, environmentId, projectId, run],
  );

  const updateRule = useCallback(
    (id: string, input: UpdateAlertRuleInput) =>
      run(async () => {
        await client.updateAlertRule(id, input);
      }),
    [client, run],
  );

  const archiveRule = useCallback(
    (id: string) =>
      run(async () => {
        await client.archiveAlertRule(id);
      }),
    [client, run],
  );

  const createChannel = useCallback(
    (input: CreateNotificationChannelInput) =>
      run(async () => {
        await client.createNotificationChannel(input);
      }),
    [client, run],
  );

  const updateChannel = useCallback(
    (id: string, input: UpdateNotificationChannelInput) =>
      run(async () => {
        await client.updateNotificationChannel(id, input);
      }),
    [client, run],
  );

  const archiveChannel = useCallback(
    (id: string) =>
      run(async () => {
        await client.archiveNotificationChannel(id);
      }),
    [client, run],
  );

  const createFromSuggestion = useCallback(
    (s: AlertSuggestionResponse) =>
      run(async () => {
        if (!projectId || !environmentId) return;
        const input: CreateAlertRuleInput = {
          projectId,
          environmentId,
          name: s.title,
          type: s.type,
          severity: s.severity,
          windowMinutes: s.windowMinutes,
          threshold: s.threshold,
          cooldownMinutes: s.cooldownMinutes,
          routePattern: s.routePattern,
          minimumSampleSize: s.minimumSampleSize,
          notificationChannelId: undefined,
          enabled: true,
        };
        await client.createAlertRule(input);
      }),
    [client, environmentId, projectId, run],
  );

  return {
    data,
    status,
    busy,
    reload,
    createRule,
    updateRule,
    archiveRule,
    createChannel,
    updateChannel,
    archiveChannel,
    createFromSuggestion,
  };
}
