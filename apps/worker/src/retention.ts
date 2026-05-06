import type { RetentionDeletedCounts, RetentionPolicy } from "@signal-hub/db/repositories/system.js";
import { sanitizePreviewText } from "@signal-hub/telemetry/sanitization";

const zeroDeleted: RetentionDeletedCounts = { events: 0, errors: 0, traces: 0, spans: 0, llmCalls: 0 };

export type RetentionRuntime = {
  now: () => Date;
  policy: RetentionPolicy;
  batchSize: number;
  tryAcquireLock: () => Promise<boolean>;
  releaseLock: () => Promise<void>;
  deleteExpiredTelemetry: () => Promise<RetentionDeletedCounts>;
  recordRetentionRun: (input: {
    startedAt: Date;
    finishedAt: Date | null;
    status: "success" | "failed";
    errorMessage?: string | null;
    deleted: RetentionDeletedCounts;
    policy: RetentionPolicy;
  }) => Promise<unknown>;
};

export async function runRetentionOnce(runtime: RetentionRuntime): Promise<{ ran: boolean; skipped: boolean }> {
  const locked = await runtime.tryAcquireLock();
  if (!locked) return { ran: false, skipped: true };

  const startedAt = runtime.now();
  try {
    const deleted = await runtime.deleteExpiredTelemetry();
    await runtime.recordRetentionRun({
      startedAt,
      finishedAt: runtime.now(),
      status: "success",
      deleted,
      policy: runtime.policy
    });
    return { ran: true, skipped: false };
  } catch (error) {
    await runtime.recordRetentionRun({
      startedAt,
      finishedAt: runtime.now(),
      status: "failed",
      errorMessage: sanitizePreviewText(error instanceof Error ? error.message : String(error)),
      deleted: zeroDeleted,
      policy: runtime.policy
    });
    return { ran: true, skipped: false };
  } finally {
    await runtime.releaseLock();
  }
}

export function startRetentionScheduler(input: {
  intervalMinutes: number;
  runOnce: () => Promise<unknown>;
  setIntervalFn?: typeof setInterval;
  setTimeoutFn?: typeof setTimeout;
  clearIntervalFn?: typeof clearInterval;
  clearTimeoutFn?: typeof clearTimeout;
}) {
  const setIntervalFn = input.setIntervalFn ?? setInterval;
  const setTimeoutFn = input.setTimeoutFn ?? setTimeout;
  const clearIntervalFn = input.clearIntervalFn ?? clearInterval;
  const clearTimeoutFn = input.clearTimeoutFn ?? clearTimeout;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await input.runOnce();
    } catch (error) {
      console.error("Retention scheduler run failed", error);
    } finally {
      running = false;
    }
  };

  const startupTimer = setTimeoutFn(() => void tick(), 1000);
  const interval = setIntervalFn(() => void tick(), input.intervalMinutes * 60 * 1000);

  return () => {
    clearTimeoutFn(startupTimer);
    clearIntervalFn(interval);
  };
}
