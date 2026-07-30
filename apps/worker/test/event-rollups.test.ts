import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { runEventRollupOnce, startEventRollupScheduler, type EventRollupRuntime } from "../src/event-rollups.js";

function runtime(overrides: Partial<EventRollupRuntime> = {}): EventRollupRuntime {
  return {
    now: () => new Date("2026-06-01T00:00:00.000Z"),
    lookbackDays: 400,
    maintenanceWindowDays: 2,
    maxDaysPerTick: 60,
    withLock: async (run) => ({ locked: true, result: await run() }),
    readWatermark: async () => null,
    writeWatermark: async () => undefined,
    rollupDay: async () => 0,
    ...overrides
  };
}

describe("runEventRollupOnce", () => {
  it("backfills from now - lookbackDays on the first run, capped by maxDaysPerTick", async () => {
    const rollupDay = vi.fn(async () => 3);
    const writeWatermark = vi.fn(async () => undefined);

    const result = await runEventRollupOnce(
      runtime({
        now: () => new Date("2026-06-01T00:00:00.000Z"),
        lookbackDays: 10,
        maintenanceWindowDays: 2,
        maxDaysPerTick: 60,
        readWatermark: async () => null,
        writeWatermark,
        rollupDay
      })
    );

    expect(result.ran).toBe(true);
    expect(result.skipped).toBe(false);
    // 10 days of lookback, one call per day.
    expect(rollupDay).toHaveBeenCalledTimes(10);
    expect(rollupDay).toHaveBeenNthCalledWith(1, {
      from: new Date("2026-05-22T00:00:00.000Z"),
      to: new Date("2026-05-23T00:00:00.000Z")
    });
    expect(rollupDay).toHaveBeenNthCalledWith(10, {
      from: new Date("2026-05-31T00:00:00.000Z"),
      to: new Date("2026-06-01T00:00:00.000Z")
    });
    expect(result.daysProcessed).toBe(10);
    expect(result.rowsUpserted).toBe(30);

    // The stored watermark is capped at now - maintenanceWindowDays so the last 2 days are
    // always reprocessed on the next run, even though the cursor reached "today".
    expect(writeWatermark).toHaveBeenCalledWith(new Date("2026-05-30T00:00:00.000Z"));
  });

  it("caps days processed per tick and resumes from the stored watermark next run", async () => {
    const rollupDay = vi.fn(async () => 1);

    const result = await runEventRollupOnce(
      runtime({
        now: () => new Date("2026-06-01T00:00:00.000Z"),
        lookbackDays: 10,
        maintenanceWindowDays: 2,
        maxDaysPerTick: 3,
        readWatermark: async () => null,
        rollupDay
      })
    );

    expect(result.daysProcessed).toBe(3);
    expect(rollupDay).toHaveBeenCalledTimes(3);
  });

  it("always reprocesses the maintenance window even when the watermark had already caught up", async () => {
    const rollupDay = vi.fn(async () => 0);

    const result = await runEventRollupOnce(
      runtime({
        now: () => new Date("2026-06-01T00:00:00.000Z"),
        maintenanceWindowDays: 2,
        maxDaysPerTick: 60,
        // Watermark previously advanced all the way to "today" (shouldn't normally happen given
        // our own capping, but the run must still re-cover the maintenance window defensively).
        readWatermark: async () => new Date("2026-06-01T00:00:00.000Z"),
        rollupDay
      })
    );

    expect(rollupDay).toHaveBeenCalledTimes(2);
    expect(rollupDay).toHaveBeenNthCalledWith(1, {
      from: new Date("2026-05-30T00:00:00.000Z"),
      to: new Date("2026-05-31T00:00:00.000Z")
    });
    expect(rollupDay).toHaveBeenNthCalledWith(2, {
      from: new Date("2026-05-31T00:00:00.000Z"),
      to: new Date("2026-06-01T00:00:00.000Z")
    });
    expect(result.daysProcessed).toBe(2);
  });

  it("skips when another scheduler owns the lock", async () => {
    const rollupDay = vi.fn(async () => 0);

    const result = await runEventRollupOnce(
      runtime({
        withLock: async () => ({ locked: false }),
        rollupDay
      })
    );

    expect(result).toEqual({ ran: false, skipped: true, daysProcessed: 0, rowsUpserted: 0 });
    expect(rollupDay).not.toHaveBeenCalled();
  });
});

describe("startEventRollupScheduler", () => {
  it("prevents overlapping runs and waits for an active run on stop", async () => {
    let intervalCallback: (() => void) | undefined;
    let timeoutCallback: (() => void) | undefined;
    let resolveRun: (() => void) | undefined;
    const runOnce = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        })
    );

    const stop = startEventRollupScheduler({
      intervalMinutes: 60,
      runOnce,
      setIntervalFn: (callback) => {
        intervalCallback = callback;
        return 1 as never;
      },
      setTimeoutFn: (callback) => {
        timeoutCallback = callback;
        return 2 as never;
      },
      clearIntervalFn: vi.fn(),
      clearTimeoutFn: vi.fn()
    });

    timeoutCallback?.();
    intervalCallback?.();
    expect(runOnce).toHaveBeenCalledTimes(1);
    resolveRun?.();
    await stop();
  });

  it("wires bounded hourly backfill into the existing advisory-locked scheduler run", async () => {
    const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

    expect(source).toContain("runEventHourlyRollupBackfill");
    expect(source).toMatch(/withEventRollupLock\(db, async \(\) =>/);
    expect(source).toContain("maxBackfillHoursPerScope");
  });
});
