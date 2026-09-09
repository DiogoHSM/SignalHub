import { beforeEach, describe, expect, it, vi } from "vitest";
import { OutboundPolicy } from "@sigmon/config";
import type {
  WarehouseDestinationRecord,
  WarehouseExportBatch,
  WarehouseExportCounts,
  WarehouseCursor
} from "@sigmon/db/repositories/warehouse-exports.js";
import { runWarehouseExportOnce, startWarehouseExportScheduler, writePostgresWarehouseBatch } from "../src/warehouse-exports.js";

const pgHarness = vi.hoisted(() => ({
  config: undefined as Record<string, unknown> | undefined,
  postgres: {
    connect: vi.fn(async () => undefined),
    query: vi.fn(async (_statement: string, _params?: unknown[]) => ({ rows: [] as unknown[] })),
    end: vi.fn(async () => undefined)
  }
}));

const postgres = pgHarness.postgres;

vi.mock("pg", () => ({
  Client: vi.fn(function (config: Record<string, unknown>) {
    pgHarness.config = config;
    return postgres;
  })
}));

const warehouseTimeouts = {
  connectionTimeoutMs: 25,
  statementTimeoutMs: 40,
  lockTimeoutMs: 20,
  queryTimeoutMs: 45,
  totalTimeoutMs: 75
};

const publicOnlyPolicy = new OutboundPolicy({ nodeEnv: "test" });

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
    const postgresOptions = { outboundPolicy: publicOnlyPolicy, timeouts: warehouseTimeouts };

    const result = await runWarehouseExportOnce({
      now: () => now,
      withLock: async (run) => ({ locked: true, result: await run() }),
      listActiveDestinations: async () => [destination()],
      selectBatch: async () => selectedBatch,
      writeBatch: writer,
      updateCursor,
      recordRun,
      postgresOptions
    });

    expect(result).toEqual({ ran: true, skipped: false, destinations: 1, exported: 1, failed: 0 });
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({
      destinationId: "whdst_1",
      batch: selectedBatch,
      outboundPolicy: publicOnlyPolicy,
      timeouts: warehouseTimeouts
    }));
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

  it("isolates sanitized bookkeeping failures and continues to the next destination", async () => {
    const first = destination({ id: "whdst_1", connectionUrl: "postgres://writer:first-secret@one.example/analytics" });
    const second = destination({ id: "whdst_2", connectionUrl: "postgres://writer:second-secret@two.example/analytics" });
    const updateCursor = vi.fn(async (input: { id: string }) => {
      if (input.id === first.id) throw new Error("password=first-secret cursor failed");
    });
    const recordRun = vi.fn(async (input: { destinationId: string }) => {
      if (input.destinationId === first.id) throw new Error("password=first-secret history failed");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await runWarehouseExportOnce({
      now: () => new Date("2026-01-01T00:10:00.000Z"),
      withLock: async (run) => ({ locked: true, result: await run() }),
      listActiveDestinations: async () => [first, second],
      selectBatch: async () => batch(),
      writeBatch: async () => undefined,
      updateCursor,
      recordRun
    });

    expect(result).toEqual({ ran: true, skipped: false, destinations: 2, exported: 1, failed: 1 });
    expect(updateCursor).toHaveBeenCalledWith(expect.objectContaining({ id: second.id, status: "success" }));
    expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({ destinationId: second.id, status: "success" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("first-secret");
    expect(JSON.stringify(updateCursor.mock.calls)).not.toContain("first-secret");
    expect(JSON.stringify(recordRun.mock.calls)).not.toContain("first-secret");
  });

  it("uses identical configured PostgreSQL controls for a manual run", async () => {
    const writer = vi.fn(async () => undefined);
    await runWarehouseExportOnce({
      now: () => new Date("2026-01-01T00:10:00.000Z"),
      withLock: async (run) => ({ locked: true, result: await run() }),
      listActiveDestinations: async () => [destination()],
      selectBatch: async () => batch(),
      writeBatch: writer,
      postgresOptions: { outboundPolicy: publicOnlyPolicy, timeouts: warehouseTimeouts },
      updateCursor: async () => undefined,
      recordRun: async (input) => {
        expect(input.trigger).toBe("manual");
      }
    }, "manual");

    expect(writer).toHaveBeenCalledWith(expect.objectContaining({
      outboundPolicy: publicOnlyPolicy,
      timeouts: warehouseTimeouts
    }));
  });
});

describe("writePostgresWarehouseBatch", () => {
  beforeEach(() => {
    pgHarness.config = undefined;
    postgres.connect.mockReset().mockResolvedValue(undefined);
    postgres.connect.mockClear();
    postgres.query.mockReset().mockResolvedValue({ rows: [] });
    postgres.end.mockReset().mockResolvedValue(undefined);
  });

  it.each([
    ["unsupported scheme", "https://writer:secret@warehouse.example/analytics", "warehouse_protocol_forbidden"],
    ["missing host", "postgres:///analytics", "warehouse_host_required"],
    ["missing user", "postgres://warehouse.example/analytics", "warehouse_user_required"],
    ["missing database", "postgres://writer@warehouse.example", "warehouse_database_required"],
    ["malformed port", "postgres://writer@warehouse.example:abc/analytics", "warehouse_url_invalid"],
    ["fragment", "postgres://writer@warehouse.example/analytics#password=fragment-secret", "warehouse_url_invalid"],
    ["disabled TLS", "postgres://writer@warehouse.example/analytics?sslmode=disable", "warehouse_tls_required"],
    ["opportunistic TLS", "postgres://writer@warehouse.example/analytics?sslmode=prefer", "warehouse_tls_required"],
    ["encryption-only TLS", "postgres://writer@warehouse.example/analytics?sslmode=require", "warehouse_tls_required"],
    ["TLS verifier override", "postgres://writer@warehouse.example/analytics?rejectUnauthorized=false", "warehouse_tls_invalid"],
    ["TLS server-name override", "postgres://writer@warehouse.example/analytics?servername=attacker.example", "warehouse_tls_invalid"],
    ["duplicate TLS mode", "postgres://writer@warehouse.example/analytics?sslmode=verify-full&sslmode=verify-full", "warehouse_tls_invalid"],
    ["unknown URL option", "postgres://writer@warehouse.example/analytics?password=query-secret", "warehouse_url_options_invalid"],
    ["empty explicit port", "postgres://writer@warehouse.example:/analytics", "warehouse_url_invalid"],
    ["private literal", "postgres://writer:secret@10.2.3.4/analytics", "warehouse_destination_forbidden"]
  ])("rejects a %s with a stable redacted error", async (_label, connectionUrl, expectedError) => {
    await expect(writePostgresWarehouseBatch({
      destinationId: "whdst_1",
      connectionUrl,
      batch: batch(),
      outboundPolicy: publicOnlyPolicy,
      timeouts: warehouseTimeouts
    } as never)).rejects.toThrow(expectedError);

    expect(pgHarness.config).toBeUndefined();
  });

  it("builds a separate verified-TLS pg config with decoded non-enumerable credentials", async () => {
    await writePostgresWarehouseBatch({
      destinationId: "whdst_1",
      connectionUrl: "postgresql://writer%40team:s%65cret@warehouse.example:5433/analytics%2Fprod?sslmode=verify-full",
      batch: batch(),
      outboundPolicy: publicOnlyPolicy,
      timeouts: warehouseTimeouts
    } as never);

    const config = pgHarness.config as Record<string, unknown>;
    expect(config).not.toHaveProperty("connectionString");
    expect(config).toMatchObject({
      host: "warehouse.example",
      port: 5433,
      database: "analytics/prod",
      user: "writer@team",
      connectionTimeoutMillis: 25,
      statement_timeout: 40,
      lock_timeout: 20,
      query_timeout: 45,
      idle_in_transaction_session_timeout: 75,
      ssl: { rejectUnauthorized: true, servername: "warehouse.example" }
    });
    expect(Object.keys(config)).not.toContain("password");
    expect(typeof config.password).toBe("function");
    await expect((config.password as () => Promise<string>)()).resolves.toBe("secret");
  });

  it("accepts one strict application name without allowing it to change transport settings", async () => {
    await writePostgresWarehouseBatch({
      destinationId: "whdst_1",
      connectionUrl: "postgres://writer@warehouse.example/analytics?application_name=sigmon.prod-1",
      batch: batch(),
      outboundPolicy: publicOnlyPolicy,
      timeouts: warehouseTimeouts
    } as never);

    expect(pgHarness.config).toMatchObject({
      application_name: "sigmon.prod-1",
      ssl: { rejectUnauthorized: true, servername: "warehouse.example" }
    });
  });

  it("supplies an explicit password provider for passwordless certificate authentication", async () => {
    await writePostgresWarehouseBatch({
      destinationId: "whdst_1",
      connectionUrl: "postgres://writer@warehouse.example/analytics",
      batch: batch(),
      outboundPolicy: publicOnlyPolicy,
      timeouts: warehouseTimeouts
    } as never);

    const config = pgHarness.config as Record<string, unknown>;
    expect(Object.keys(config)).not.toContain("password");
    await expect((config.password as () => Promise<string>)()).resolves.toBe("");
  });

  it("permits plaintext only for an explicit non-production literal-loopback policy", async () => {
    const loopbackPolicy = new OutboundPolicy({ nodeEnv: "development", allowLoopback: true });
    await writePostgresWarehouseBatch({
      destinationId: "whdst_1",
      connectionUrl: "postgres://writer:secret@127.0.0.1:5432/analytics",
      batch: batch(),
      outboundPolicy: loopbackPolicy,
      timeouts: warehouseTimeouts
    } as never);

    expect(pgHarness.config).toMatchObject({ host: "127.0.0.1", ssl: false });
  });

  it("parses a bracketed IPv6 loopback authority without treating its port as part of the host", async () => {
    const loopbackPolicy = new OutboundPolicy({ nodeEnv: "test", allowLoopback: true });
    await writePostgresWarehouseBatch({
      destinationId: "whdst_1",
      connectionUrl: "postgres://writer@[::1]:5433/analytics",
      batch: batch(),
      outboundPolicy: loopbackPolicy,
      timeouts: warehouseTimeouts
    } as never);

    expect(pgHarness.config).toMatchObject({ host: "::1", port: 5433, ssl: false });
  });

  it("validates every DNS answer on the custom stream's actual connect path", async () => {
    const lookup = vi.fn((_hostname, options, callback) => {
      expect(options).toMatchObject({ all: true, verbatim: true });
      callback(null, [
        { address: "203.0.113.10", family: 4 },
        { address: "10.0.0.8", family: 4 }
      ] as never);
    });

    await writePostgresWarehouseBatch({
      destinationId: "whdst_1",
      connectionUrl: "postgres://writer@warehouse.example/analytics",
      batch: batch(),
      outboundPolicy: publicOnlyPolicy,
      timeouts: warehouseTimeouts,
      lookup
    } as never);

    const socket = (pgHarness.config?.stream as () => import("node:net").Socket)();
    const error = new Promise<Error>((resolve) => socket.once("error", resolve));
    socket.connect(5432, "warehouse.example");
    await expect(error).resolves.toMatchObject({ message: "outbound_address_forbidden" });
    expect(lookup).toHaveBeenCalledOnce();
  });

  it.each(["connect", "query"] as const)("expires a hanging %s under one total deadline and suppresses late rejection", async (stage) => {
    let rejectLate: ((error: Error) => void) | undefined;
    const hanging = new Promise<never>((_resolve, reject) => {
      rejectLate = reject;
    });
    if (stage === "connect") {
      postgres.connect.mockReturnValueOnce(hanging);
    } else {
      postgres.query.mockReturnValueOnce(hanging);
    }

    const outcome = writePostgresWarehouseBatch({
      destinationId: "whdst_1",
      connectionUrl: "postgres://writer@warehouse.example/analytics",
      batch: batch(),
      outboundPolicy: publicOnlyPolicy,
      timeouts: { ...warehouseTimeouts, totalTimeoutMs: 20 }
    } as never);

    await expect(Promise.race([
      outcome,
      new Promise((_, reject) => setTimeout(() => reject(new Error("test_guard_timeout")), 200))
    ])).rejects.toThrow("warehouse_destination_timeout");
    expect(postgres.end).toHaveBeenCalledOnce();
    const socket = (pgHarness.config?.stream as () => import("node:net").Socket)();
    expect(socket.destroyed).toBe(true);
    rejectLate?.(new Error("password=late-secret"));
    await new Promise((resolve) => setImmediate(resolve));
  });

  it.each([
    ["table setup", 1],
    ["begin", 2],
    ["dataset write", 3],
    ["commit", 4]
  ] as const)("hard-tears down a %s hang under the same destination deadline", async (_stage, hangingCall) => {
    let queryCall = 0;
    let rejectLate: ((error: Error) => void) | undefined;
    postgres.query.mockImplementation(async () => {
      queryCall += 1;
      if (queryCall === hangingCall) {
        return new Promise<never>((_resolve, reject) => {
          rejectLate = reject;
        });
      }
      return { rows: [] };
    });

    const outcome = writePostgresWarehouseBatch({
      destinationId: "whdst_1",
      connectionUrl: "postgres://writer@warehouse.example/analytics",
      batch: batch(),
      outboundPolicy: publicOnlyPolicy,
      timeouts: { ...warehouseTimeouts, totalTimeoutMs: 20 }
    });

    await expect(outcome).rejects.toThrow("warehouse_destination_timeout");
    expect(postgres.end).toHaveBeenCalledOnce();
    expect((pgHarness.config?.stream as () => import("node:net").Socket)().destroyed).toBe(true);
    rejectLate?.(new Error("password=late-stage-secret"));
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("preserves a stable primary write error when rollback and end both expose secrets", async () => {
    postgres.query.mockImplementation(async (statement) => {
      if (typeof statement === "string" && statement.includes("insert into sigmon_telemetry_export")) {
        throw new Error("password=write-secret");
      }
      if (statement === "rollback") throw new Error("password=rollback-secret");
      return { rows: [] };
    });
    postgres.end.mockRejectedValueOnce(new Error("password=end-secret"));

    await expect(writePostgresWarehouseBatch({
      destinationId: "whdst_1",
      connectionUrl: "postgres://writer:url-secret@warehouse.example/analytics",
      batch: batch(),
      outboundPolicy: publicOnlyPolicy,
      timeouts: warehouseTimeouts
    })).rejects.toThrow(/^warehouse_write_failed$/);
    expect(postgres.query).toHaveBeenCalledWith("rollback");
    expect(postgres.end).toHaveBeenCalledOnce();
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
      connectionUrl: "postgres://writer@warehouse.example/analytics",
      batch: selected,
      outboundPolicy: publicOnlyPolicy,
      timeouts: warehouseTimeouts
    } as never);

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
      connectionUrl: "postgres://writer@warehouse.example/analytics",
      batch: batch(),
      outboundPolicy: publicOnlyPolicy,
      timeouts: warehouseTimeouts
    } as never)).rejects.toThrow("warehouse_write_failed");

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
