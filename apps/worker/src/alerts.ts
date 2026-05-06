import type { AlertRuleRecord, NotificationChannelRecord } from "@signal-hub/db/repositories/alerts.js";
import { sanitizePreviewText } from "@signal-hub/telemetry/sanitization";

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
  signalhub: { source: "signalhub" };
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
            const delivery = await runtime.deliver(
              channel,
              toWebhookPayload(rule, event.id, now, windowStart, windowEnd, observed.observedValue, message)
            );
            await runtime.recordDelivery({
              alertEventId: event.id,
              notificationChannelId: channel.id,
              attemptedAt: now,
              ...delivery
            });
          }
        }
      } catch (error) {
        console.error(`Alert rule ${rule.id} evaluation failed`, error);
        await runtime.updateRuleEvaluation({ ruleId: rule.id, evaluatedAt: now });
      }
    }

    return { evaluated: rules.length, triggered };
  });

  if (!lockResult.locked) return { ran: false, skipped: true, evaluated: 0, triggered: 0 };
  return { ran: true, skipped: false, ...lockResult.result };
}

export function validateWebhookTarget(rawUrl: string, nodeEnv: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("webhook URL must use http or https");
  }

  const host = url.hostname.toLowerCase();
  const privateHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

  if (nodeEnv === "production" && privateHost) {
    throw new Error("private webhook targets are not allowed in production");
  }

  return url;
}

export async function deliverWebhook(input: {
  channel: NotificationChannelRecord;
  payload: AlertWebhookPayload;
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  nodeEnv: string;
}): Promise<DeliveryResult> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    return { status: "failed", responseStatus: null, errorMessage: "fetch is unavailable" };
  }

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (input.channel.secretHeaderName && input.channel.secretHeaderValue) {
    headers[input.channel.secretHeaderName] = input.channel.secretHeaderValue;
  }

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input.payload),
      signal: controller.signal
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
      errorMessage: sanitizeMessage(error instanceof Error ? error.message : "Webhook delivery failed")
    };
  } finally {
    clearTimeout(timeout);
  }
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
    signalhub: { source: "signalhub" }
  };
}
