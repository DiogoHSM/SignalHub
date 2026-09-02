import { describe, expect, it, vi } from "vitest";
import {
  createMaintenanceWorkerForRole,
  handleMaintenanceJob,
  handleMaintenanceQueueJob
} from "../src/maintenance-worker.js";

const backupJob = {
  kind: "backup.create" as const,
  requestedBy: "usr_1",
  requestedAt: "2026-09-01T12:34:01.000Z"
};

describe("maintenance worker", () => {
  it("runs a valid manual backup once through the retry-aware shared runtime", async () => {
    const runBackupOnce = vi.fn(async () => ({ ran: true, skipped: false }));

    await handleMaintenanceJob(backupJob, { runBackupOnce });

    expect(runBackupOnce).toHaveBeenCalledTimes(1);
    expect(runBackupOnce).toHaveBeenCalledWith({ trigger: "manual", throwOnFailure: true });
  });

  it("lets advisory-lock skips complete normally", async () => {
    const runBackupOnce = vi.fn(async () => ({ ran: false, skipped: true }));

    await expect(handleMaintenanceJob(backupJob, { runBackupOnce })).resolves.toBeUndefined();
    expect(runBackupOnce).toHaveBeenCalledTimes(1);
  });

  it("normalizes runtime failures before BullMQ records them", async () => {
    const runBackupOnce = vi.fn(async () => {
      throw new Error("pg_dump failed password=secret");
    });

    await expect(handleMaintenanceJob(backupJob, { runBackupOnce })).rejects.toThrow(/^backup_failed$/);
  });

  it("rejects a queue job whose BullMQ name disagrees with its payload kind", async () => {
    const runBackupOnce = vi.fn();

    await expect(
      handleMaintenanceQueueJob({ name: "backup.delete", data: backupJob }, { runBackupOnce })
    ).rejects.toThrow("invalid_maintenance_job");
    expect(runBackupOnce).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { ...backupJob, kind: "backup.delete" },
    { ...backupJob, requestedBy: "" },
    { ...backupJob, requestedAt: "yesterday" },
    { ...backupJob, email: "admin@example.com" }
  ])("rejects unknown or tampered job data %#", async (data) => {
    const runBackupOnce = vi.fn();

    await expect(handleMaintenanceJob(data, { runBackupOnce })).rejects.toThrow("invalid_maintenance_job");
    expect(runBackupOnce).not.toHaveBeenCalled();
  });

  it.each(["scheduler", "all"] as const)("constructs one consumer for the %s role even when schedules are disabled", async (role) => {
    const order: string[] = [];
    let processor: ((job: { name: string; data: unknown }) => Promise<void>) | undefined;
    const connection = { quit: vi.fn(async () => order.push("connection")) };
    const worker = { close: vi.fn(async () => order.push("worker")) };
    const createConnection = vi.fn(() => connection);
    const createWorker = vi.fn((_name, handler, options) => {
      processor = handler;
      expect(options).toMatchObject({ connection, concurrency: 1 });
      return worker;
    });
    const runBackupOnce = vi.fn(async () => ({ ran: true, skipped: false }));

    const runtime = createMaintenanceWorkerForRole({
      role,
      redisUrl: "redis://redis:6379",
      backupsEnabled: false,
      runBackupOnce,
      createConnection: createConnection as never,
      createWorker: createWorker as never
    });

    expect(runtime).not.toBeNull();
    expect(createConnection).toHaveBeenCalledWith(
      "redis://redis:6379",
      expect.objectContaining({ maxRetriesPerRequest: null })
    );
    expect(createWorker).toHaveBeenCalledTimes(1);
    await processor?.({ name: "backup.create", data: backupJob });
    expect(runBackupOnce).toHaveBeenCalledTimes(1);
    await runtime?.close();
    expect(order).toEqual(["worker", "connection"]);
  });

  it("does not construct a maintenance consumer for the queue-only role", () => {
    const createConnection = vi.fn();
    const createWorker = vi.fn();

    const runtime = createMaintenanceWorkerForRole({
      role: "queue",
      redisUrl: "redis://redis:6379",
      backupsEnabled: true,
      runBackupOnce: vi.fn(),
      createConnection: createConnection as never,
      createWorker: createWorker as never
    });

    expect(runtime).toBeNull();
    expect(createConnection).not.toHaveBeenCalled();
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("closes the Redis connection even when Worker shutdown fails", async () => {
    const order: string[] = [];
    const connection = { quit: vi.fn(async () => order.push("connection")) };
    const runtime = createMaintenanceWorkerForRole({
      role: "scheduler",
      redisUrl: "redis://redis:6379",
      backupsEnabled: true,
      runBackupOnce: vi.fn(),
      createConnection: (() => connection) as never,
      createWorker: (() => ({
        close: async () => {
          order.push("worker");
          throw new Error("worker close failed");
        }
      })) as never
    });

    await expect(runtime?.close()).rejects.toThrow("worker close failed");
    expect(order).toEqual(["worker", "connection"]);
  });
});
