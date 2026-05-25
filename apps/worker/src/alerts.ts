import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { lookup as resolveDns } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { AlertRuleRecord, NotificationChannelRecord } from "@sigmon/db/repositories/alerts.js";
import {
  assertSafeResolvedAddresses,
  assertSafeWebhookHost,
  validateWebhookTargetUrl,
  type ResolvedAddress
} from "@sigmon/config";
import { sanitizePreviewText } from "@sigmon/telemetry/sanitization";

export type AlertWebhookPayload = {
  alertEventId: string;
  ruleId: string;
  ruleName: string;
  ruleType: AlertRuleRecord["type"];
  severity: AlertRuleRecord["severity"];
  projectId: string;
  environmentId: string;
  triggeredAt: string;
  window: { from: string; to: string; minutes: number };
  observedValue: string;
  threshold: string;
  message: string;
  sigmon: { source: "sigmon" };
};

export type DeliveryResult = {
  status: "success" | "failed";
  responseStatus: number | null;
  errorMessage: string | null;
};

export type AlertEvaluationRuntime = {
  now: () => Date;
  withLock: <T>(run: () => Promise<T>) => Promise<{ locked: false } | { locked: true; result: T }>;
  listActiveRules: () => Promise<AlertRuleRecord[]>;
  getNotificationChannel: (id: string) => Promise<NotificationChannelRecord | null | undefined>;
  evaluateRule: (
    rule: AlertRuleRecord,
    windowStart: Date,
    windowEnd: Date
  ) => Promise<{ observedValue: string }>;
  recordAlertEvent: (input: {
    rule: AlertRuleRecord;
    triggeredAt: Date;
    windowStart: Date;
    windowEnd: Date;
    observedValue: string;
    message: string;
    metadata: unknown;
  }) => Promise<{ id: string }>;
  updateRuleEvaluation: (input: {
    ruleId: string;
    evaluatedAt: Date;
    triggeredAt?: Date | null;
  }) => Promise<unknown>;
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

type PendingDelivery = {
  eventId: string;
  channel: NotificationChannelRecord;
  payload: AlertWebhookPayload;
};

type WebhookDeliveryChannel = Pick<
  Extract<NotificationChannelRecord, { type: "webhook" }>,
  | "id"
  | "name"
  | "type"
  | "url"
  | "secretHeaderName"
  | "secretHeaderValue"
  | "hasSecret"
  | "enabled"
  | "createdAt"
  | "updatedAt"
  | "archivedAt"
>;

type ResolveHostname = (hostname: string) => Promise<Array<{ address: string; family?: number }>>;
type WebhookRequest = (input: {
  url: URL;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  lookup: LookupFunction;
}) => Promise<{ status: number }>;

export async function runAlertEvaluationOnce(runtime: AlertEvaluationRuntime): Promise<{
  ran: boolean;
  skipped: boolean;
  evaluated: number;
  triggered: number;
}> {
  const lockResult = await runtime.withLock(async () => {
    const now = runtime.now();
    const rules = await runtime.listActiveRules();
    let triggered = 0;
    const pendingDeliveries: PendingDelivery[] = [];

    for (const rule of rules) {
      const windowEnd = now;
      const windowStart = new Date(windowEnd.getTime() - rule.windowMinutes * 60 * 1000);

      try {
        if (isInCooldown(rule, now)) {
          await runtime.updateRuleEvaluation({ ruleId: rule.id, evaluatedAt: now });
          continue;
        }

        const observed = await runtime.evaluateRule(rule, windowStart, windowEnd);
        if (Number(observed.observedValue) < Number(rule.threshold)) {
          await runtime.updateRuleEvaluation({ ruleId: rule.id, evaluatedAt: now });
          continue;
        }

        const message = sanitizeMessage(
          `${rule.name} threshold reached: ${observed.observedValue} >= ${rule.threshold}`
        );
        const event = await runtime.recordAlertEvent({
          rule,
          triggeredAt: now,
          windowStart,
          windowEnd,
          observedValue: observed.observedValue,
          message,
          metadata: { ruleType: rule.type }
        });

        await runtime.updateRuleEvaluation({ ruleId: rule.id, evaluatedAt: now, triggeredAt: now });
        triggered += 1;

        if (rule.notificationChannelId) {
          const channel = await runtime.getNotificationChannel(rule.notificationChannelId);
          if (channel?.enabled === true && channel.archivedAt === null) {
            pendingDeliveries.push({
              eventId: event.id,
              channel,
              payload: toWebhookPayload(rule, event.id, now, windowStart, windowEnd, observed.observedValue, message)
            });
          }
        }
      } catch (error) {
        console.error(`Alert rule ${rule.id} evaluation failed`, error);
        await runtime.updateRuleEvaluation({ ruleId: rule.id, evaluatedAt: now });
      }
    }

    return { evaluated: rules.length, triggered, pendingDeliveries };
  });

  if (!lockResult.locked) return { ran: false, skipped: true, evaluated: 0, triggered: 0 };

  for (const pending of lockResult.result.pendingDeliveries) {
    let delivery: DeliveryResult;

    try {
      delivery = await runtime.deliver(pending.channel, pending.payload);
    } catch (error) {
      console.error(`Alert webhook delivery ${pending.eventId} failed`, error);
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
      console.error(`Alert webhook delivery ${pending.eventId} recording failed`, error);
    }
  }

  return {
    ran: true,
    skipped: false,
    evaluated: lockResult.result.evaluated,
    triggered: lockResult.result.triggered
  };
}

export function validateWebhookTarget(rawUrl: string, _nodeEnv: string): URL {
  return validateWebhookTargetUrl(rawUrl);
}

export async function deliverWebhook(input: {
  channel: WebhookDeliveryChannel;
  payload: AlertWebhookPayload;
  fetchImpl?: typeof fetch;
  resolveHostname?: ResolveHostname;
  requestImpl?: WebhookRequest;
  requestLookup?: LookupFunction;
  timeoutMs: number;
  nodeEnv: string;
}): Promise<DeliveryResult> {
  let url: URL;
  try {
    url = validateWebhookTarget(input.channel.url, input.nodeEnv);
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      errorMessage: sanitizeMessage(error instanceof Error ? error.message : "invalid webhook URL")
    };
  }

  try {
    validateSecretHeaderName(input.channel.secretHeaderName);
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      errorMessage: sanitizeMessage(error instanceof Error ? error.message : "invalid webhook secret header name")
    };
  }

  if (shouldResolveWebhookHostname(url)) {
    const resolveHostname = input.resolveHostname ?? defaultResolveHostname;

    try {
      const resolved = await resolveHostname(url.hostname);
      assertSafeResolvedAddresses(toResolvedAddresses(resolved));
    } catch (error) {
      if (error instanceof Error && error.message === "unsafe webhook target") {
        return { status: "failed", responseStatus: null, errorMessage: "unsafe webhook target" };
      }
      return { status: "failed", responseStatus: null, errorMessage: "Webhook DNS resolution failed" };
    }
  }

  const body = JSON.stringify(input.payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body))
  };
  if (input.channel.secretHeaderName && input.channel.secretHeaderValue) {
    headers[input.channel.secretHeaderName] = input.channel.secretHeaderValue;
  }

  try {
    const response = await (input.requestImpl ?? defaultWebhookRequest)({
      url,
      headers,
      body,
      timeoutMs: input.timeoutMs,
      lookup: createValidatingWebhookLookup(input.requestLookup ?? defaultWebhookLookup)
    });

    if (response.status >= 200 && response.status < 300) {
      return { status: "success", responseStatus: response.status, errorMessage: null };
    }

    return {
      status: "failed",
      responseStatus: response.status,
      errorMessage: sanitizeMessage(`Webhook returned HTTP ${response.status}`)
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      errorMessage: sanitizeMessage(formatWebhookDeliveryError(error))
    };
  }
}

function defaultResolveHostname(hostname: string): Promise<ResolvedAddress[]> {
  return resolveDns(hostname, { all: true });
}

function toResolvedAddresses(addresses: Array<{ address: string; family?: number }>): ResolvedAddress[] {
  return addresses.map((address) => ({ address: address.address, family: address.family ?? isIP(address.address) }));
}

const defaultWebhookLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, options, callback);
};

function defaultWebhookRequest(input: {
  url: URL;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  lookup: LookupFunction;
}): Promise<{ status: number }> {
  if (input.url.protocol === "https:") {
    return requestHttpsWebhook(input);
  }

  return requestHttpWebhook(input);
}

function requestHttpWebhook(input: {
  url: URL;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  lookup: LookupFunction;
}): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const request = httpRequest(
      input.url,
      {
        method: "POST",
        headers: input.headers,
        lookup: input.lookup
      },
      (response) => {
        if (timeout) clearTimeout(timeout);
        response.resume();
        resolve({ status: response.statusCode ?? 0 });
      }
    );

    timeout = setTimeout(() => {
      request.destroy(new Error("Webhook delivery timed out"));
    }, input.timeoutMs);

    request.on("error", reject);
    request.on("close", () => {
      if (timeout) clearTimeout(timeout);
    });
    request.end(input.body);
  });
}

function requestHttpsWebhook(input: {
  url: URL;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  lookup: LookupFunction;
}): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const request = httpsRequest(
      input.url,
      {
        method: "POST",
        headers: input.headers,
        lookup: input.lookup,
        servername: input.url.hostname
      },
      (response) => {
        if (timeout) clearTimeout(timeout);
        response.resume();
        resolve({ status: response.statusCode ?? 0 });
      }
    );

    timeout = setTimeout(() => {
      request.destroy(new Error("Webhook delivery timed out"));
    }, input.timeoutMs);

    request.on("error", reject);
    request.on("close", () => {
      if (timeout) clearTimeout(timeout);
    });
    request.end(input.body);
  });
}

function createValidatingWebhookLookup(lookup: LookupFunction): LookupFunction {
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
          } catch (unsafeError) {
            callback(
              unsafeError instanceof Error ? unsafeError : new Error("unsafe webhook target"),
              entry.address,
              entry.family
            );
            return;
          }
        }

        callback(null, address as LookupAddress[], family);
        return;
      }

      try {
        assertSafeWebhookHost(address);
      } catch (unsafeError) {
        callback(unsafeError instanceof Error ? unsafeError : new Error("unsafe webhook target"), address, family);
        return;
      }

      callback(null, address, family);
    });
  };
}

function formatWebhookDeliveryError(error: unknown): string {
  if (!(error instanceof Error)) return "Webhook delivery failed";

  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") {
    return "Webhook DNS resolution failed";
  }

  return error.message;
}

type IntervalHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export function startAlertScheduler(input: {
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
        console.error("Alert scheduler run failed", error);
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

function isInCooldown(rule: AlertRuleRecord, now: Date): boolean {
  return (
    rule.lastTriggeredAt !== null &&
    now.getTime() - rule.lastTriggeredAt.getTime() < rule.cooldownMinutes * 60 * 1000
  );
}

function sanitizeMessage(message: string): string {
  return sanitizePreviewText(message) ?? "Webhook delivery failed";
}

const HTTP_TOKEN_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function validateSecretHeaderName(headerName: string | null | undefined): void {
  if (!headerName) return;

  if (!HTTP_TOKEN_PATTERN.test(headerName)) {
    throw new Error("invalid webhook secret header name");
  }

  const normalizedHeaderName = headerName.toLowerCase();
  if (!normalizedHeaderName.startsWith("x-") && !normalizedHeaderName.startsWith("sigmon-")) {
    throw new Error("reserved webhook secret header name");
  }
}

function shouldResolveWebhookHostname(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");

  return host !== "localhost" && isIP(host) === 0;
}

function toWebhookPayload(
  rule: AlertRuleRecord,
  alertEventId: string,
  triggeredAt: Date,
  windowStart: Date,
  windowEnd: Date,
  observedValue: string,
  message: string
): AlertWebhookPayload {
  return {
    alertEventId,
    ruleId: rule.id,
    ruleName: rule.name,
    ruleType: rule.type,
    severity: rule.severity,
    projectId: rule.projectId,
    environmentId: rule.environmentId,
    triggeredAt: triggeredAt.toISOString(),
    window: {
      from: windowStart.toISOString(),
      to: windowEnd.toISOString(),
      minutes: rule.windowMinutes
    },
    observedValue,
    threshold: rule.threshold,
    message,
    sigmon: { source: "sigmon" }
  };
}
