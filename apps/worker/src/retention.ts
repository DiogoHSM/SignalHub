import type { RetentionDeletedCounts, RetentionPolicy } from "@signal-hub/db/repositories/system.js";
import { sanitizePreviewText } from "@signal-hub/telemetry/sanitization";

const zeroDeleted: RetentionDeletedCounts = { events: 0, errors: 0, traces: 0, spans: 0, llmCalls: 0 };

export type RetentionRuntime = {
  now: () => Date;
  policy: RetentionPolicy;
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
    let deleted: RetentionDeletedCounts;
    try {
      deleted = await runtime.deleteExpiredTelemetry();
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
    }

    await runtime.recordRetentionRun({
      startedAt,
      finishedAt: runtime.now(),
      status: "success",
      deleted,
      policy: runtime.policy
    });
    return { ran: true, skipped: false };
  } finally {
    await runtime.releaseLock();
  }
}

type IntervalHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export function startRetentionScheduler(input: {
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
        console.error("Retention scheduler run failed", error);
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
