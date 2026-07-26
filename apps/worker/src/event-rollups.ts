const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export type EventRollupRuntime = {
  now: () => Date;
  /** Days to backfill from on the very first run (no watermark recorded yet). */
  lookbackDays: number;
  /** Trailing days always reprocessed on every run, for telemetry that arrives late. */
  maintenanceWindowDays: number;
  /** Upper bound on days rolled up per tick, so a large backlog can't block the scheduler. */
  maxDaysPerTick: number;
  withLock: <T>(run: () => Promise<T>) => Promise<{ locked: false } | { locked: true; result: T }>;
  readWatermark: () => Promise<Date | null>;
  writeWatermark: (watermarkAt: Date) => Promise<void>;
  rollupDay: (input: { from: Date; to: Date }) => Promise<number>;
};

export type EventRollupResult = {
  ran: boolean;
  skipped: boolean;
  daysProcessed: number;
  rowsUpserted: number;
};

export async function runEventRollupOnce(runtime: EventRollupRuntime): Promise<EventRollupResult> {
  const lockResult = await runtime.withLock(async () => {
    const now = runtime.now();
    const today = startOfUtcDay(now);
    const maintenanceStart = new Date(today.getTime() - runtime.maintenanceWindowDays * DAY_MS);
    const fallbackStart = startOfUtcDay(new Date(now.getTime() - runtime.lookbackDays * DAY_MS));

    const existingWatermark = await runtime.readWatermark();
    const startingPoint = existingWatermark ?? fallbackStart;
    // Always re-cover the maintenance window even if the stored watermark had advanced past it.
    let cursor = new Date(Math.min(startingPoint.getTime(), maintenanceStart.getTime()));

    let daysProcessed = 0;
    let rowsUpserted = 0;
    while (cursor.getTime() < today.getTime() && daysProcessed < runtime.maxDaysPerTick) {
      const dayEnd = new Date(cursor.getTime() + DAY_MS);
      rowsUpserted += await runtime.rollupDay({ from: cursor, to: dayEnd });
      daysProcessed += 1;
      cursor = dayEnd;
    }

    // Cap the stored watermark so the maintenance window is always reprocessed next run, even
    // once the cursor has caught all the way up to today.
    const newWatermark = new Date(Math.min(cursor.getTime(), maintenanceStart.getTime()));
    await runtime.writeWatermark(newWatermark);

    return { daysProcessed, rowsUpserted };
  });

  if (!lockResult.locked) {
    return { ran: false, skipped: true, daysProcessed: 0, rowsUpserted: 0 };
  }

  return { ran: true, skipped: false, ...lockResult.result };
}

type IntervalHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export function startEventRollupScheduler(input: {
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
        console.error("Event rollup scheduler run failed", error);
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
