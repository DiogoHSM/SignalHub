import type { RetentionDeletedCounts, RetentionPolicy } from "@sigmon/db/repositories/system.js";
import { sanitizePreviewText } from "@sigmon/telemetry/sanitization";
import { SourceMapRetentionError } from "./source-map-retention.js";

const zeroDeleted: RetentionDeletedCounts = {
  events: 0,
  errors: 0,
  traces: 0,
  spans: 0,
  llmCalls: 0,
  breadcrumbs: 0,
  sourceMapArtifacts: 0,
  sourceMapFiles: 0
};

export type RetentionRuntime = {
  now: () => Date;
  policy: RetentionPolicy;
  withLock: <T>(
    run: (lockedRuntime: RetentionLockedRuntime) => Promise<T>
  ) => Promise<{ locked: false } | { locked: true; result: T }>;
  deleteExpiredSourceMapArtifacts: () => Promise<
    Pick<RetentionDeletedCounts, "sourceMapArtifacts" | "sourceMapFiles">
  >;
  recordRetentionRun: (input: {
    startedAt: Date;
    finishedAt: Date | null;
    status: "success" | "failed";
    errorMessage?: string | null;
    deleted: RetentionDeletedCounts;
    policy: RetentionPolicy;
  }) => Promise<unknown>;
};

export type RetentionLockedRuntime = {
  deleteExpiredTelemetry: () => Promise<RetentionDeletedCounts>;
};

export async function runRetentionOnce(runtime: RetentionRuntime): Promise<{ ran: boolean; skipped: boolean }> {
  const startedAt = runtime.now();
  let result: { locked: false } | { locked: true; result: RetentionDeletedCounts };
  try {
    result = await runtime.withLock((lockedRuntime) => lockedRuntime.deleteExpiredTelemetry());
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("retention_delete_failed:")) {
      throw error;
    }

    await runtime.recordRetentionRun({
      startedAt,
      finishedAt: runtime.now(),
      status: "failed",
      errorMessage: sanitizePreviewText(error.message.replace(/^retention_delete_failed:\s*/, "")),
      deleted: zeroDeleted,
      policy: runtime.policy
    });
    return { ran: true, skipped: false };
  }

  if (!result.locked) return { ran: false, skipped: true };

  let deleted = result.result;
  if (runtime.policy.sourceMapsEnabled) {
    try {
      const sourceMapsDeleted = await runtime.deleteExpiredSourceMapArtifacts();
      deleted = { ...deleted, ...sourceMapsDeleted };
    } catch (error) {
      const sourceMapsDeleted =
        error instanceof SourceMapRetentionError ? error.deleted : { sourceMapArtifacts: 0, sourceMapFiles: 0 };
      await runtime.recordRetentionRun({
        startedAt,
        finishedAt: runtime.now(),
        status: "failed",
        errorMessage: sanitizePreviewText(error instanceof Error ? error.message : String(error)),
        deleted: { ...deleted, ...sourceMapsDeleted },
        policy: runtime.policy
      });
      return { ran: true, skipped: false };
    }
  }

  await runtime.recordRetentionRun({
    startedAt,
    finishedAt: runtime.now(),
    status: "success",
    deleted,
    policy: runtime.policy
  });

  return { ran: true, skipped: false };
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
