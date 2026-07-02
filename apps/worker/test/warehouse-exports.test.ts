import { describe, expect, it, vi } from "vitest";
import type {
  WarehouseDestinationRecord,
  WarehouseExportBatch,
  WarehouseExportCounts,
  WarehouseCursor
} from "@sigmon/db/repositories/warehouse-exports.js";
import { runWarehouseExportOnce, startWarehouseExportScheduler } from "../src/warehouse-exports.js";

function destination(overrides: Partial<WarehouseDestinationRecord> = {}): WarehouseDestinationRecord {
  return {
    id: "whdst_1",
    projectId: "prj_1",
    environmentId: "env_1",
    name: "Warehouse",
    destinationType: "postgres",
    connectionUrlPreview: "postgres://writer:***@warehouse/sigmon",
    connectionUrl: "postgres://writer:secret@warehouse/sigmon",
    datasets: ["events"],
    cursor: {},
    batchSize: 100,
    enabled: true,
    lastRunAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorMessage: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides
  };
}

function batch(overrides: Partial<WarehouseExportBatch> = {}): WarehouseExportBatch {
  const nextCursor: WarehouseCursor = { events: { timestamp: "2026-01-01T00:00:00.000Z", id: "evt_1" } };
  const counts: WarehouseExportCounts = { events: 1 };
  return {
    rows: {
      events: [{ id: "evt_1", timestamp: new Date("2026-01-01T00:00:00.000Z") } as never],
      errors: [],
      traces: [],
      llmCalls: []
    },
    counts,
    rowCount: 1,
    cursorBefore: {},
    nextCursor,
    ...overrides
  };
}

describe("runWarehouseExportOnce", () => {
  it("exports active destinations, advances cursors, and records successful runs", async () => {
    const now = new Date("2026-01-01T00:10:00.000Z");
    const selectedBatch = batch();
    const writer = vi.fn(async () => undefined);
    const updateCursor = vi.fn(async () => undefined);
    const recordRun = vi.fn(async () => undefined);

    const result = await runWarehouseExportOnce({
      now: () => now,
      withLock: async (run) => ({ locked: true, result: await run() }),
      listActiveDestinations: async () => [destination()],
      selectBatch: async () => selectedBatch,
      writeBatch: writer,
      updateCursor,
      recordRun
    });

    expect(result).toEqual({ ran: true, skipped: false, destinations: 1, exported: 1, failed: 0 });
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ destinationId: "whdst_1", batch: selectedBatch }));
    expect(updateCursor).toHaveBeenCalledWith({
      id: "whdst_1",
      projectId: "prj_1",
      environmentId: "env_1",
      cursor: selectedBatch.nextCursor,
      now,
      status: "success"
    });
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationId: "whdst_1",
        projectId: "prj_1",
        environmentId: "env_1",
        trigger: "scheduled",
        status: "success",
        startedAt: now,
        finishedAt: now,
        cursorBefore: {},
        cursorAfter: selectedBatch.nextCursor,
        exported: selectedBatch.counts
      })
    );
  });

  it("records failed runs without advancing cursors or leaking connection urls", async () => {
    const now = new Date("2026-01-01T00:10:00.000Z");
    const updateCursor = vi.fn(async () => undefined);
    const recordRun = vi.fn(async () => undefined);

    const result = await runWarehouseExportOnce({
      now: () => now,
      withLock: async (run) => ({ locked: true, result: await run() }),
      listActiveDestinations: async () => [destination()],
      selectBatch: async () => batch(),
      writeBatch: async () => {
        throw new Error("password=secret postgres://writer:secret@warehouse/sigmon failed");
      },
      updateCursor,
      recordRun
    });

    expect(result).toEqual({ ran: true, skipped: false, destinations: 1, exported: 0, failed: 1 });
    expect(updateCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        errorMessage: expect.not.stringContaining("secret")
      })
    );
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        errorMessage: expect.not.stringContaining("secret"),
        cursorAfter: {}
      })
    );
  });

  it("skips when another scheduler owns the lock", async () => {
    const result = await runWarehouseExportOnce({
      now: () => new Date("2026-01-01T00:10:00.000Z"),
      withLock: async () => ({ locked: false }),
      listActiveDestinations: async () => [],
      selectBatch: async () => batch(),
      writeBatch: async () => undefined,
      updateCursor: async () => undefined,
      recordRun: async () => undefined
    });

    expect(result).toEqual({ ran: false, skipped: true, destinations: 0, exported: 0, failed: 0 });
  });
});

describe("startWarehouseExportScheduler", () => {
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

    const stop = startWarehouseExportScheduler({
      intervalMinutes: 5,
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
});
