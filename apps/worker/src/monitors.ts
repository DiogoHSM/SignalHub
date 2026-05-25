import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { lookup as resolveDns } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import {
  assertSafeResolvedAddresses,
  assertSafeWebhookHost,
  validateWebhookTargetUrl,
  type ResolvedAddress
} from "@sigmon/config";
import type { NotificationChannelRecord } from "@sigmon/db/repositories/alerts.js";
import type { MonitorRecord } from "@sigmon/db/repositories/monitors.js";
import { sanitizePreviewText } from "@sigmon/telemetry/sanitization";
import type { AlertWebhookPayload, DeliveryResult } from "./alerts.js";

export type MonitorCheckResult = {
  status: "success" | "failed";
  latencyMs: number | null;
  responseStatus: number | null;
  errorMessage: string | null;
};

type ResolveHostname = (hostname: string) => Promise<Array<{ address: string; family?: number }>>;
type MonitorRequest = (input: {
  url: URL;
  method: "GET" | "HEAD";
  timeoutMs: number;
  lookup: LookupFunction;
}) => Promise<{ status: number; body: string; latencyMs: number }>;

type PendingDelivery = {
  eventId: string;
  channel: NotificationChannelRecord;
  payload: AlertWebhookPayload;
};

export type MonitorEvaluationRuntime = {
  now: () => Date;
  withLock: <T>(run: (lockedRuntime: MonitorLockedRuntime) => Promise<T>) => Promise<
    { locked: false } | { locked: true; result: T }
  >;
  maxConcurrency: number;
  checkHttpMonitor: (monitor: MonitorRecord) => Promise<MonitorCheckResult>;
  recordMonitorCheck: (input: {
    monitorId: string;
    checkedAt: Date;
    status: "success" | "failed";
    latencyMs: number | null;
    responseStatus: number | null;
    errorMessage: string | null;
  }) => Promise<MonitorRecord>;
  recordAlertEvent: (input: {
    monitor: MonitorRecord;
    triggeredAt: Date;
    windowStart: Date;
    windowEnd: Date;
    observedValue: string;
    threshold: string;
    severity: "warning" | "critical";
    message: string;
    metadata: unknown;
  }) => Promise<{ id: string }>;
  getNotificationChannel: (id: string) => Promise<NotificationChannelRecord | null | undefined>;
  deliver: (channel: NotificationChannelRecord, payload: AlertWebhookPayload) => Promise<DeliveryResult>;
  recordDelivery: (input: {
    alertEventId: string;
    notificationChannelId: string;
    status: "success" | "failed";
    attemptedAt: Date;
    responseStatus: number | null;
    errorMessage: string | null;
  }) => Promise<unknown>;
};

export type MonitorLockedRuntime = {
  listDueHttpMonitors: () => Promise<MonitorRecord[]>;
  listStaleHeartbeatMonitors: () => Promise<MonitorRecord[]>;
};

export async function runMonitorEvaluationOnce(runtime: MonitorEvaluationRuntime): Promise<{
  ran: boolean;
  skipped: boolean;
  checked: number;
  staleHeartbeats: number;
  triggered: number;
}> {
  const now = runtime.now();
  const lockResult = await runtime.withLock(async (lockedRuntime) => ({
    httpMonitors: await lockedRuntime.listDueHttpMonitors(),
    staleHeartbeats: await lockedRuntime.listStaleHeartbeatMonitors()
  }));

  if (!lockResult.locked) return { ran: false, skipped: true, checked: 0, staleHeartbeats: 0, triggered: 0 };

  const pendingDeliveries: PendingDelivery[] = [];
  let checked = 0;
  let triggered = 0;

  await runWithConcurrency(lockResult.result.httpMonitors, runtime.maxConcurrency, async (monitor) => {
    try {
      const check = await runtime.checkHttpMonitor(monitor);
      const updated = await runtime.recordMonitorCheck({ monitorId: monitor.id, checkedAt: now, ...check });
      checked += 1;

      if (check.status === "failed" && updated.status === "down" && monitor.status !== "down") {
        const event = await recordMonitorTriggeredEvent({
          runtime,
          monitor,
          now,
          windowStart: now,
          observedValue: "1",
          threshold: String(monitor.failureThreshold),
          severity: "critical",
          message: `${monitor.name} uptime monitor is down: ${check.errorMessage ?? "HTTP check failed"}`,
          metadata: { monitorType: "http", responseStatus: check.responseStatus }
        });
        triggered += 1;
        await enqueueMonitorDelivery({ runtime, monitor, eventId: event.id, now, pendingDeliveries, message: event.message });
      }
    } catch (error) {
      console.error(`Monitor ${monitor.id} HTTP evaluation failed`, error);
    }
  });

  for (const monitor of lockResult.result.staleHeartbeats) {
    try {
      const staleMinutes = calculateStaleMinutes(monitor, now);
      const updated = await runtime.recordMonitorCheck({
        monitorId: monitor.id,
        checkedAt: now,
        status: "failed",
        latencyMs: null,
        responseStatus: null,
        errorMessage: "Heartbeat is stale"
      });
      if (updated.status !== "down" || monitor.status === "down") {
        continue;
      }

      const threshold = String((monitor.expectedIntervalMinutes ?? 0) + (monitor.graceMinutes ?? 0));
      const event = await recordMonitorTriggeredEvent({
        runtime,
        monitor,
        now,
        windowStart: monitor.lastHeartbeatAt ?? monitor.createdAt,
        observedValue: String(staleMinutes),
        threshold,
        severity: "critical",
        message: `${monitor.name} heartbeat is stale for ${staleMinutes} minutes`,
        metadata: { monitorType: "heartbeat", lastHeartbeatAt: monitor.lastHeartbeatAt?.toISOString() ?? null }
      });
      triggered += 1;
      await enqueueMonitorDelivery({ runtime, monitor, eventId: event.id, now, pendingDeliveries, message: event.message });
    } catch (error) {
      console.error(`Monitor ${monitor.id} heartbeat evaluation failed`, error);
    }
  }

  for (const pending of pendingDeliveries) {
    let delivery: DeliveryResult;
    try {
      delivery = await runtime.deliver(pending.channel, pending.payload);
    } catch (error) {
      console.error(`Monitor notification delivery ${pending.eventId} failed`, error);
      continue;
    }

    try {
      await runtime.recordDelivery({
        alertEventId: pending.eventId,
        notificationChannelId: pending.channel.id,
        attemptedAt: runtime.now(),
        ...delivery
      });
    } catch (error) {
      console.error(`Monitor notification delivery ${pending.eventId} recording failed`, error);
    }
  }

  return {
    ran: true,
    skipped: false,
    checked,
    staleHeartbeats: lockResult.result.staleHeartbeats.length,
    triggered
  };
}

async function runWithConcurrency<T>(
  items: T[],
  maxConcurrency: number,
  run: (item: T) => Promise<void>
): Promise<void> {
  const limit = Math.max(1, maxConcurrency);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item !== undefined) {
        await run(item);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

export async function checkHttpMonitor(input: {
  monitor: MonitorRecord;
  timeoutMs: number;
  requestImpl?: MonitorRequest;
  resolveHostname?: ResolveHostname;
  requestLookup?: LookupFunction;
}): Promise<MonitorCheckResult> {
  if (input.monitor.kind !== "http" || !input.monitor.url || !input.monitor.method) {
    return failedCheck("invalid HTTP monitor");
  }

  let url: URL;
  try {
    url = validateWebhookTargetUrl(input.monitor.url);
  } catch (error) {
    return failedCheck(formatMonitorTargetError(error));
  }

  if (shouldResolveMonitorHostname(url)) {
    const resolveHostname = input.resolveHostname ?? defaultResolveHostname;
    try {
      const resolved = await resolveHostname(url.hostname);
      assertSafeResolvedAddresses(toResolvedAddresses(resolved));
    } catch (error) {
      return failedCheck(formatMonitorDnsError(error));
    }
  }

  try {
    const response = await (input.requestImpl ?? defaultMonitorRequest)({
      url,
      method: input.monitor.method,
      timeoutMs: input.monitor.timeoutMs ?? input.timeoutMs,
      lookup: createValidatingMonitorLookup(input.requestLookup ?? defaultMonitorLookup)
    });

    if (!isExpectedStatus(response.status, input.monitor.expectedStatus)) {
      return {
        status: "failed",
        latencyMs: response.latencyMs,
        responseStatus: response.status,
        errorMessage: sanitizeMessage(`Monitor returned HTTP ${response.status}`)
      };
    }

    if (input.monitor.method === "GET" && input.monitor.bodyContains && !response.body.includes(input.monitor.bodyContains)) {
      return {
        status: "failed",
        latencyMs: response.latencyMs,
        responseStatus: response.status,
        errorMessage: "Monitor response body did not contain expected text"
      };
    }

    return { status: "success", latencyMs: response.latencyMs, responseStatus: response.status, errorMessage: null };
  } catch (error) {
    return failedCheck(formatMonitorRequestError(error));
  }
}

async function recordMonitorTriggeredEvent(input: {
  runtime: MonitorEvaluationRuntime;
  monitor: MonitorRecord;
  now: Date;
  windowStart: Date;
  observedValue: string;
  threshold: string;
  severity: "warning" | "critical";
  message: string;
  metadata: unknown;
}): Promise<{ id: string; message: string }> {
  const message = sanitizeMessage(input.message);
  const event = await input.runtime.recordAlertEvent({
    monitor: input.monitor,
    triggeredAt: input.now,
    windowStart: input.windowStart,
    windowEnd: input.now,
    observedValue: input.observedValue,
    threshold: input.threshold,
    severity: input.severity,
    message,
    metadata: input.metadata
  });

  return { id: event.id, message };
}

async function enqueueMonitorDelivery(input: {
  runtime: MonitorEvaluationRuntime;
  monitor: MonitorRecord;
  eventId: string;
  now: Date;
  pendingDeliveries: PendingDelivery[];
  message: string;
}): Promise<void> {
  if (!input.monitor.notificationChannelId) return;

  const channel = await input.runtime.getNotificationChannel(input.monitor.notificationChannelId);
  if (channel?.enabled !== true || channel.archivedAt !== null) return;

  input.pendingDeliveries.push({
    eventId: input.eventId,
    channel,
    payload: toMonitorPayload(input.monitor, input.eventId, input.now, input.message)
  });
}

function toMonitorPayload(monitor: MonitorRecord, eventId: string, now: Date, message: string): AlertWebhookPayload {
  const threshold =
    monitor.kind === "heartbeat"
      ? String((monitor.expectedIntervalMinutes ?? 0) + (monitor.graceMinutes ?? 0))
      : String(monitor.failureThreshold);

  return {
    alertEventId: eventId,
    ruleId: monitor.id,
    ruleName: monitor.name,
    ruleType: monitor.kind === "heartbeat" ? "heartbeat_monitor" : "http_monitor",
    severity: "critical",
    projectId: monitor.projectId,
    environmentId: monitor.environmentId,
    triggeredAt: now.toISOString(),
    window: { from: (monitor.lastCheckedAt ?? monitor.createdAt).toISOString(), to: now.toISOString(), minutes: 0 },
    observedValue: monitor.kind === "heartbeat" ? String(calculateStaleMinutes(monitor, now)) : "1",
    threshold,
    message,
    sigmon: { source: "sigmon" }
  };
}

function calculateStaleMinutes(monitor: MonitorRecord, now: Date): number {
  const since = monitor.lastHeartbeatAt ?? monitor.createdAt;
  return Math.max(0, Math.ceil((now.getTime() - since.getTime()) / 60_000));
}

function failedCheck(errorMessage: string): MonitorCheckResult {
  return { status: "failed", latencyMs: null, responseStatus: null, errorMessage: sanitizeMessage(errorMessage) };
}

function isExpectedStatus(status: number, expectedStatus: string | null): boolean {
  if (!expectedStatus) return status >= 200 && status < 300;
  if (expectedStatus === "2xx") return status >= 200 && status < 300;
  if (expectedStatus === "3xx") return status >= 300 && status < 400;

  const rangeMatch = /^(\d{3})-(\d{3})$/.exec(expectedStatus);
  if (rangeMatch) {
    const lower = Number(rangeMatch[1]);
    const upper = Number(rangeMatch[2]);
    return status >= lower && status <= upper;
  }

  return status === Number(expectedStatus);
}

function defaultResolveHostname(hostname: string): Promise<ResolvedAddress[]> {
  return resolveDns(hostname, { all: true });
}

function toResolvedAddresses(addresses: Array<{ address: string; family?: number }>): ResolvedAddress[] {
  return addresses.map((address) => ({ address: address.address, family: address.family ?? isIP(address.address) }));
}

const defaultMonitorLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, options, callback);
};

function defaultMonitorRequest(input: {
  url: URL;
  method: "GET" | "HEAD";
  timeoutMs: number;
  lookup: LookupFunction;
}): Promise<{ status: number; body: string; latencyMs: number }> {
  return input.url.protocol === "https:" ? requestHttpsMonitor(input) : requestHttpMonitor(input);
}

type NodeRequest = typeof httpRequest;

function requestHttpMonitor(input: {
  url: URL;
  method: "GET" | "HEAD";
  timeoutMs: number;
  lookup: LookupFunction;
}): Promise<{ status: number; body: string; latencyMs: number }> {
  return requestMonitor(httpRequest, input);
}

function requestHttpsMonitor(input: {
  url: URL;
  method: "GET" | "HEAD";
  timeoutMs: number;
  lookup: LookupFunction;
}): Promise<{ status: number; body: string; latencyMs: number }> {
  return requestMonitor(httpsRequest, input);
}

function requestMonitor(
  requestFn: NodeRequest,
  input: {
    url: URL;
    method: "GET" | "HEAD";
    timeoutMs: number;
    lookup: LookupFunction;
  }
): Promise<{ status: number; body: string; latencyMs: number }> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const chunks: string[] = [];
    let bytes = 0;

    const request = requestFn(
      input.url,
      {
        method: input.method,
        lookup: input.lookup
      },
      (response) => {
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (bytes >= 65_536) return;
          const remaining = 65_536 - bytes;
          const chunkBytes = Buffer.byteLength(chunk);
          chunks.push(chunkBytes > remaining ? chunk.slice(0, remaining) : chunk);
          bytes += chunkBytes;
        });
        response.on("end", () => {
          if (timeout) clearTimeout(timeout);
          resolve({ status: response.statusCode ?? 0, body: chunks.join(""), latencyMs: Date.now() - startedAt });
        });
      }
    );

    timeout = setTimeout(() => {
      request.destroy(new Error("Monitor request timed out"));
    }, input.timeoutMs);

    request.on("error", reject);
    request.on("close", () => {
      if (timeout) clearTimeout(timeout);
    });
    request.end();
  });
}

function createValidatingMonitorLookup(lookup: LookupFunction): LookupFunction {
  return (hostname, options, callback) => {
    lookup(hostname, options, (error, address, family) => {
      if (error) {
        callback(error, address as string, family);
        return;
      }

      if (Array.isArray(address)) {
        for (const entry of address) {
          try {
            assertSafeWebhookHost(entry.address);
          } catch {
            callback(new Error("unsafe monitor target"), entry.address, entry.family);
            return;
          }
        }
        callback(null, address as LookupAddress[], family);
        return;
      }

      try {
        assertSafeWebhookHost(address);
      } catch {
        callback(new Error("unsafe monitor target"), address, family);
        return;
      }
      callback(null, address, family);
    });
  };
}

function shouldResolveMonitorHostname(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return host !== "localhost" && isIP(host) === 0;
}

function formatMonitorTargetError(error: unknown): string {
  if (!(error instanceof Error)) return "invalid monitor URL";
  if (error.message === "unsafe webhook target") return "unsafe monitor target";
  return error.message.replaceAll("webhook", "monitor");
}

function formatMonitorDnsError(error: unknown): string {
  if (error instanceof Error && error.message === "unsafe webhook target") return "unsafe monitor target";
  return "Monitor DNS resolution failed";
}

function formatMonitorRequestError(error: unknown): string {
  if (!(error instanceof Error)) return "Monitor request failed";
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") {
    return "Monitor DNS resolution failed";
  }
  return error.message;
}

function sanitizeMessage(message: string): string {
  return sanitizePreviewText(message) ?? "Monitor check failed";
}

type IntervalHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export function startMonitorScheduler(input: {
  intervalMinutes: number;
  runOnce: () => Promise<unknown>;
  setIntervalFn?: (callback: () => void, delay: number) => IntervalHandle;
  setTimeoutFn?: (callback: () => void, delay: number) => TimeoutHandle;
  clearIntervalFn?: (handle: IntervalHandle) => void;
  clearTimeoutFn?: (handle: TimeoutHandle) => void;
}): () => Promise<void> {
  const setIntervalFn = input.setIntervalFn ?? setInterval;
  const setTimeoutFn = input.setTimeoutFn ?? setTimeout;
  const clearIntervalFn = input.clearIntervalFn ?? clearInterval;
  const clearTimeoutFn = input.clearTimeoutFn ?? clearTimeout;
  let stopped = false;
  let activeRun: Promise<void> | null = null;

  const tick = () => {
    if (stopped || activeRun) return;
    activeRun = (async () => {
      try {
        await input.runOnce();
      } catch (error) {
        console.error("Monitor scheduler run failed", error);
      } finally {
        activeRun = null;
      }
    })();
  };

  const startupTimer = setTimeoutFn(tick, 1000);
  const interval = setIntervalFn(tick, input.intervalMinutes * 60 * 1000);

  return async () => {
    stopped = true;
    clearTimeoutFn(startupTimer);
    clearIntervalFn(interval);
    await activeRun;
  };
}
