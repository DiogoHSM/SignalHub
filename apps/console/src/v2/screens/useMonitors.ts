import { useCallback, useEffect, useRef, useState } from "react";
import type { Status } from "../../components/ui/v2";
import type { ApiClient } from "../../api/client";
import type {
  CreateHeartbeatMonitorInput,
  CreateHttpMonitorInput,
  MonitorCheckResponse,
  MonitorKind,
  MonitorResponse,
  MonitorStatus,
  NotificationChannelResponse,
} from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type MonitorRowVM = {
  id: string;
  name: string;
  kind: MonitorKind;
  status: MonitorStatus;
  statusV2: Status;
  enabled: boolean;
  target: string;
  cadence: string;
  lastCheckedLabel: string;
  channelLabel: string | null;
  hasChannel: boolean;
};

export type MonitorRollupVM = {
  total: number;
  enabled: number;
  up: number;
  degraded: number;
  down: number;
  paused: number;
  withoutChannel: number;
};

export type MonitorChannelVM = { id: string; label: string };

export type MonitorCheckVM = {
  id: string;
  statusV2: Status;
  checkedLabel: string;
  detail: string;
  hasError: boolean;
};

export type MonitorsVM = {
  rollup: MonitorRollupVM;
  rows: MonitorRowVM[];
  channels: MonitorChannelVM[];
};

export type LatestMonitorSecret = {
  monitorId: string;
  monitorName: string;
  secret: string;
  url: string;
};

// ---------------------------------------------------------------------------
// Action form types (already-validated values from the screen)
// ---------------------------------------------------------------------------

export type CreateHttpForm = {
  name: string;
  url: string;
  intervalMinutes: number;
  timeoutMs: number;
  notificationChannelId: string;
};

export type CreateHeartbeatForm = {
  name: string;
  expectedIntervalMinutes: number;
  graceMinutes: number;
  notificationChannelId: string;
};

export type EditMonitorForm = {
  id: string;
  kind: MonitorKind;
  name: string;
  enabled: boolean;
  notificationChannelId: string;
  url: string;
  intervalMinutes: number;
  timeoutMs: number;
  expectedIntervalMinutes: number;
  graceMinutes: number;
};

export type BuildMonitorsInput = {
  monitors: MonitorResponse[];
  channels: NotificationChannelResponse[];
};

export type UseMonitorsResult = {
  data: MonitorsVM | null;
  status: "loading" | "ok" | "error" | "unavailable";
  latestSecret: LatestMonitorSecret | null;
  busy: boolean;
  reload: () => void;
  clearSecret: () => void;
  createHttpMonitor: (form: CreateHttpForm) => Promise<boolean>;
  createHeartbeatMonitor: (form: CreateHeartbeatForm) => Promise<boolean>;
  updateMonitor: (form: EditMonitorForm) => Promise<boolean>;
  archiveMonitor: (id: string) => Promise<void>;
  loadChecks: (id: string) => Promise<MonitorCheckVM[]>;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function monitorStatusToV2(status: MonitorStatus): Status {
  switch (status) {
    case "up":
      return "ok";
    case "degraded":
      return "warning";
    case "down":
      return "critical";
    default:
      return "idle";
  }
}

function relativeTimeFrom(iso: string | null, nowMs: number): string {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "Never";
  const diff = nowMs - t;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function channelOptionLabel(channel: NotificationChannelResponse): string {
  return channel.type === "email" ? `${channel.name} · email` : `${channel.name} · webhook`;
}

function monitorTarget(monitor: MonitorResponse): string {
  if (monitor.kind === "http") return monitor.url ?? "—";
  return "Heartbeat check-in";
}

function monitorCadence(monitor: MonitorResponse): string {
  if (monitor.kind === "http") return `every ${monitor.intervalMinutes ?? 5}m`;
  return `expects every ${monitor.expectedIntervalMinutes ?? 5}m ±${monitor.graceMinutes ?? 0}m`;
}

// ---------------------------------------------------------------------------
// Pure VM builders
// ---------------------------------------------------------------------------

export function buildMonitorsVM(input: BuildMonitorsInput, nowMs: number): MonitorsVM {
  const { monitors, channels } = input;
  const channelName = new Map<string, string>();
  for (const c of channels) channelName.set(c.id, c.name);

  const rows: MonitorRowVM[] = monitors.map((m) => {
    const channelLabel = m.notificationChannelId ? channelName.get(m.notificationChannelId) ?? null : null;
    return {
      id: m.id,
      name: m.name,
      kind: m.kind,
      status: m.status,
      statusV2: monitorStatusToV2(m.status),
      enabled: m.enabled,
      target: monitorTarget(m),
      cadence: monitorCadence(m),
      lastCheckedLabel: relativeTimeFrom(m.lastCheckedAt, nowMs),
      channelLabel,
      hasChannel: m.notificationChannelId != null,
    };
  });

  const rollup: MonitorRollupVM = {
    total: monitors.length,
    enabled: monitors.filter((m) => m.enabled).length,
    up: monitors.filter((m) => m.status === "up").length,
    degraded: monitors.filter((m) => m.status === "degraded").length,
    down: monitors.filter((m) => m.status === "down").length,
    paused: monitors.filter((m) => m.status === "paused").length,
    withoutChannel: monitors.filter((m) => m.notificationChannelId == null).length,
  };

  const channelVMs: MonitorChannelVM[] = channels.map((c) => ({ id: c.id, label: channelOptionLabel(c) }));

  return { rollup, rows, channels: channelVMs };
}

export function buildCheckVMs(checks: MonitorCheckResponse[], nowMs: number): MonitorCheckVM[] {
  return checks.map((c) => {
    const code = c.responseStatus != null ? String(c.responseStatus) : "heartbeat";
    const detail = c.errorMessage ? `${code} · ${c.errorMessage}` : `${code} · ${c.latencyMs ?? 0}ms`;
    return {
      id: c.id,
      statusV2: c.status === "success" ? "ok" : "critical",
      checkedLabel: relativeTimeFrom(c.checkedAt, nowMs),
      detail,
      hasError: c.errorMessage != null,
    };
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function heartbeatUrl(endpoint: string, monitorId: string): string {
  const base = endpoint.replace(/\/+$/, "");
  return `${base}/v1/heartbeats/${encodeURIComponent(monitorId)}`;
}

type UseMonitorsArgs = {
  client: ApiClient;
  projectId: string | undefined;
  environmentId: string | undefined;
  endpoint: string;
};

export function useMonitors({ client, projectId, environmentId, endpoint }: UseMonitorsArgs): UseMonitorsResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "unavailable">("loading");
  const [data, setData] = useState<MonitorsVM | null>(null);
  const [latestSecret, setLatestSecret] = useState<LatestMonitorSecret | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const clearSecret = useCallback(() => setLatestSecret(null), []);

  useEffect(() => {
    setLatestSecret(null);
  }, [projectId, environmentId]);

  useEffect(() => {
    if (!projectId || !environmentId) return;
    if (!client.listMonitors || !client.listNotificationChannels) {
      setStatus("unavailable");
      setData(null);
      return;
    }

    const gen = ++genRef.current;
    setStatus("loading");

    const monitorsP = client.listMonitors({ projectId, environmentId });
    const channelsP = client.listNotificationChannels();

    Promise.all([monitorsP, channelsP])
      .then(([monitorsRes, channelsRes]) => {
        if (gen !== genRef.current) return;
        setData(buildMonitorsVM({ monitors: monitorsRes.monitors, channels: channelsRes.channels }, Date.now()));
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
  }, [client, projectId, environmentId, tick]);

  // Returns true on success, false on failure. The caller surfaces the
  // user-facing message via pushToast when this resolves false.
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

  const createHttpMonitor = useCallback(
    (form: CreateHttpForm) =>
      run(async () => {
        if (!projectId || !environmentId || !client.createHttpMonitor) return;
        const input: CreateHttpMonitorInput = {
          projectId,
          environmentId,
          notificationChannelId: form.notificationChannelId || null,
          name: form.name,
          url: form.url,
          method: "GET",
          intervalMinutes: form.intervalMinutes,
          timeoutMs: form.timeoutMs,
          expectedStatus: "2xx",
          failureThreshold: 2,
          recoveryThreshold: 2,
          enabled: true,
        };
        await client.createHttpMonitor(input);
      }),
    [client, environmentId, projectId, run],
  );

  const createHeartbeatMonitor = useCallback(
    (form: CreateHeartbeatForm) =>
      run(async () => {
        if (!projectId || !environmentId || !client.createHeartbeatMonitor) return;
        const input: CreateHeartbeatMonitorInput = {
          projectId,
          environmentId,
          notificationChannelId: form.notificationChannelId || null,
          name: form.name,
          expectedIntervalMinutes: form.expectedIntervalMinutes,
          graceMinutes: form.graceMinutes,
          enabled: true,
        };
        const { monitor, secret } = await client.createHeartbeatMonitor(input);
        setLatestSecret({
          monitorId: monitor.id,
          monitorName: monitor.name,
          secret,
          url: heartbeatUrl(endpoint, monitor.id),
        });
      }),
    [client, endpoint, environmentId, projectId, run],
  );

  const updateMonitor = useCallback(
    (form: EditMonitorForm) =>
      run(async () => {
        if (!client.updateMonitor) return;
        const input: Partial<CreateHttpMonitorInput & CreateHeartbeatMonitorInput> = {
          notificationChannelId: form.notificationChannelId || null,
          name: form.name,
          enabled: form.enabled,
        };
        if (form.kind === "http") {
          input.url = form.url;
          input.intervalMinutes = form.intervalMinutes;
          input.timeoutMs = form.timeoutMs;
        } else {
          input.expectedIntervalMinutes = form.expectedIntervalMinutes;
          input.graceMinutes = form.graceMinutes;
        }
        await client.updateMonitor(form.id, input);
      }),
    [client, run],
  );

  const archiveMonitor = useCallback(
    async (id: string) => {
      await run(async () => {
        if (!client.archiveMonitor) return;
        await client.archiveMonitor(id);
      });
    },
    [client, run],
  );

  const loadChecks = useCallback(
    async (id: string): Promise<MonitorCheckVM[]> => {
      if (!client.listMonitorChecks) return [];
      try {
        const { checks } = await client.listMonitorChecks(id, 20);
        return buildCheckVMs(checks, Date.now());
      } catch (err) {
        console.error(err);
        return [];
      }
    },
    [client],
  );

  return {
    data,
    status,
    latestSecret,
    busy,
    reload,
    clearSecret,
    createHttpMonitor,
    createHeartbeatMonitor,
    updateMonitor,
    archiveMonitor,
    loadChecks,
  };
}
