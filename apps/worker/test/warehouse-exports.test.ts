import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WarehouseDestinationRecord,
  WarehouseExportBatch,
  WarehouseExportCounts,
  WarehouseCursor
} from "@sigmon/db/repositories/warehouse-exports.js";
import { runWarehouseExportOnce, startWarehouseExportScheduler, writePostgresWarehouseBatch } from "../src/warehouse-exports.js";

const postgres = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  query: vi.fn(async (_statement: string, _params?: unknown[]) => ({ rows: [] as unknown[] })),
  end: vi.fn(async () => undefined)
}));

vi.mock("pg", () => ({ Client: vi.fn(() => postgres) }));

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
      llmCalls: [],
      userProfiles: [],
      tenantProfiles: []
    },
    counts,
    rowCount: 1,
    cursorBefore: {},
    nextCursor,
    ...overrides
  };
}

type CapturedWarehouseError = { errorMessage?: string | null };

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

  it.each([
    ["token", "query-token"],
    ["api_key", "query-api-key"],
    ["password", "query-password"],
    ["secret", "query-secret"],
    ["access_key", "query-access-key"],
    ["private_key", "query-private-key"],
    ["sslkey", "query-ssl-key"],
    ["sslcert", "query-ssl-cert"]
  ])("redacts a warehouse %s credential echoed outside the connection url", async (key, secret) => {
    const updateCursor = vi.fn(async (_input: CapturedWarehouseError) => undefined);
    const recordRun = vi.fn(async (_input: CapturedWarehouseError) => undefined);
    const configuredDestination = destination({
      connectionUrl: `postgres://writer:url-password@warehouse/sigmon?${key}=${encodeURIComponent(secret)}`,
      connectionUrlPreview: `postgres://writer:***@warehouse/sigmon?${key}=***`
    });

    await runWarehouseExportOnce({
      now: () => new Date("2026-01-01T00:10:00.000Z"),
      withLock: async (run) => ({ locked: true, result: await run() }),
      listActiveDestinations: async () => [configuredDestination],
      selectBatch: async () => batch(),
      writeBatch: async () => {
        throw new Error(`driver rejected ${key}=${secret}; credential ${secret}`);
      },
      updateCursor,
      recordRun
    });

    for (const storedError of [
      updateCursor.mock.calls[0]?.[0].errorMessage,
      recordRun.mock.calls[0]?.[0].errorMessage
    ]) {
      expect(storedError).toContain("[REDACTED]");
      expect(storedError).not.toContain(secret);
      expect(storedError).not.toContain("url-password");
    }
  });

  it("redacts named warehouse credentials even when the driver omits the configured url", async () => {
    const updateCursor = vi.fn(async (_input: CapturedWarehouseError) => undefined);
    const recordRun = vi.fn(async (_input: CapturedWarehouseError) => undefined);

    await runWarehouseExportOnce({
      now: () => new Date("2026-01-01T00:10:00.000Z"),
      withLock: async (run) => ({ locked: true, result: await run() }),
      listActiveDestinations: async () => [destination()],
      selectBatch: async () => batch(),
      writeBatch: async () => {
        throw new Error(
          "access-key: unexpected-access private_key=unexpected-private ssl_key: unexpected-ssl ssl-cert=unexpected-cert"
        );
      },
      updateCursor,
      recordRun
    });

    const storedError = updateCursor.mock.calls[0]?.[0].errorMessage;
    expect(storedError).toBe(
      "access-key=[REDACTED] private_key=[REDACTED] ssl_key=[REDACTED] ssl-cert=[REDACTED]"
    );
    expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: storedError }));
  });

  it("does not roll back an advanced cursor when success history recording fails", async () => {
    const selectedBatch = batch();
    const updateCursor = vi.fn(async () => undefined);
    const recordRun = vi.fn(async () => {
      throw new Error("run history unavailable");
    });

    const result = await runWarehouseExportOnce({
      now: () => new Date("2026-01-01T00:10:00.000Z"),
      withLock: async (run) => ({ locked: true, result: await run() }),
      listActiveDestinations: async () => [destination()],
      selectBatch: async () => selectedBatch,
      writeBatch: async () => undefined,
      updateCursor,
      recordRun
    });

    expect(result).toEqual({ ran: true, skipped: false, destinations: 1, exported: 1, failed: 0 });
    expect(updateCursor).toHaveBeenCalledTimes(1);
    expect(updateCursor).toHaveBeenCalledWith(expect.objectContaining({
      cursor: selectedBatch.nextCursor,
      status: "success"
    }));
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

describe("writePostgresWarehouseBatch", () => {
  beforeEach(() => {
    postgres.connect.mockClear();
    postgres.query.mockReset().mockResolvedValue({ rows: [] });
    postgres.end.mockClear();
  });

  it("upserts each non-empty dataset with one parameterized multi-row statement", async () => {
    const selected = batch({
      rows: {
        events: [
          { id: "evt_1", project_id: "prj_1", environment_id: "env_1", timestamp: new Date("2026-01-01T00:00:00.000Z") },
          { id: "evt_2", project_id: "prj_1", environment_id: "env_1", timestamp: new Date("2026-01-01T00:01:00.000Z") }
        ] as never,
        errors: [],
        traces: [],
        llmCalls: [],
        userProfiles: [
          {
            id: "prj_1:env_1:user_1",
            project_id: "prj_1",
            environment_id: "env_1",
            timestamp: new Date("2026-01-01T00:02:00.000Z"),
            received_at: new Date("2026-01-01T00:02:00.000Z"),
            user_id: "user_1",
            traits: { plan: "team" }
          }
        ] as never,
        tenantProfiles: []
      },
      rowCount: 3,
      counts: { events: 2, userProfiles: 1 }
    });

    await writePostgresWarehouseBatch({
      destinationId: "whdst_1",
      connectionUrl: "postgres://warehouse",
      batch: selected
    });

    const inserts = postgres.query.mock.calls.filter(([statement]) =>
      typeof statement === "string" && statement.includes("insert into sigmon_telemetry_export")
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.[0]).toContain("on conflict (dataset, source_id) do update");
    expect(inserts[0]?.[1]).toHaveLength(14);
    expect(inserts[1]?.[1]?.[0]).toBe("user_profiles");
    expect(postgres.query).toHaveBeenCalledWith("commit");
  });

  it("rolls back the whole destination transaction when a dataset batch fails", async () => {
    postgres.query.mockImplementation(async (statement) => {
      if (typeof statement === "string" && statement.includes("insert into sigmon_telemetry_export")) {
        throw new Error("destination rejected batch");
      }
      return { rows: [] };
    });

    await expect(writePostgresWarehouseBatch({
      destinationId: "whdst_1",
      connectionUrl: "postgres://warehouse",
      batch: batch()
    })).rejects.toThrow("destination rejected batch");

    expect(postgres.query).toHaveBeenCalledWith("rollback");
    expect(postgres.query).not.toHaveBeenCalledWith("commit");
    expect(postgres.end).toHaveBeenCalledOnce();
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
