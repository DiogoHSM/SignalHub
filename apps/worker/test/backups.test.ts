import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  createBackupFilename,
  pruneLocalBackups,
  runBackupOnce,
  startBackupScheduler
} from "../src/backups.js";

describe("createBackupFilename", () => {
  it("uses a UTC timestamp and no secrets", () => {
    expect(createBackupFilename(new Date("2026-05-06T12:34:56.000Z"))).toBe("signalhub-20260506T123456Z.dump");
  });
});

describe("runBackupOnce", () => {
  it("creates a local backup, uploads to S3 when enabled, records success, and prunes old local files", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "signalhub-backups-"));
    const oldFile = join(localDir, "signalhub-old.dump");
    await writeFile(oldFile, "old");
    await utimes(oldFile, new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-01T00:00:00.000Z"));

    const recordBackupRun = vi.fn(async (input) => input);
    const upload = vi.fn(async () => ({ bucket: "bucket", key: "prod/signalhub/signalhub-20260506T120000Z.dump" }));

    try {
      const result = await runBackupOnce({
        now: () => new Date("2026-05-06T12:00:00.000Z"),
        trigger: "scheduled",
        config: {
          enabled: true,
          intervalHours: 24,
          localDir,
          retentionDays: 14,
          databaseUrl: "postgres://user:pass@localhost:5432/signalhub",
          s3: {
            enabled: true,
            endpoint: "https://example.r2.cloudflarestorage.com",
            region: "auto",
            bucket: "bucket",
            accessKeyId: "access",
            secretAccessKey: "secret",
            prefix: "prod/signalhub"
          }
        },
        withLock: async (run) => ({ locked: true, result: await run() }),
        dumpDatabase: async (input) => {
          await writeFile(input.outputPath, "backup-content");
        },
        uploadBackup: upload,
        recordBackupRun
      });

      expect(result).toEqual({ ran: true, skipped: false });
      expect(await readFile(join(localDir, "signalhub-20260506T120000Z.dump"), "utf8")).toBe("backup-content");
      await expect(stat(oldFile)).rejects.toThrow();
      expect(upload).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: join(localDir, "signalhub-20260506T120000Z.dump"),
          key: "prod/signalhub/signalhub-20260506T120000Z.dump"
        })
      );
      expect(recordBackupRun).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "success",
          trigger: "scheduled",
          sizeBytes: 14,
          s3Bucket: "bucket",
          s3Key: "prod/signalhub/signalhub-20260506T120000Z.dump",
          errorMessage: null
        })
      );
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it("records a sanitized failed run when pg_dump fails", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "signalhub-backups-"));
    const recordBackupRun = vi.fn(async (input) => input);

    try {
      await expect(
        runBackupOnce({
          now: () => new Date("2026-05-06T12:00:00.000Z"),
          trigger: "manual",
          config: {
            enabled: true,
            intervalHours: 24,
            localDir,
            retentionDays: 14,
            databaseUrl: "postgres://user:password@localhost:5432/signalhub",
            s3: { enabled: false, endpoint: "", region: "auto", bucket: "", accessKeyId: "", secretAccessKey: "", prefix: "signalhub" }
          },
          withLock: async (run) => ({ locked: true, result: await run() }),
          dumpDatabase: async () => {
            throw new Error("pg_dump failed password=secret");
          },
          recordBackupRun
        })
      ).resolves.toEqual({ ran: true, skipped: false });

      expect(recordBackupRun).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          trigger: "manual",
          errorMessage: "pg_dump failed password=[REDACTED]"
        })
      );
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it("skips when another worker holds the backup lock", async () => {
    const recordBackupRun = vi.fn();
    const result = await runBackupOnce({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      trigger: "scheduled",
      config: {
        enabled: true,
        intervalHours: 24,
        localDir: "/tmp/backups",
        retentionDays: 14,
        databaseUrl: "postgres://user:pass@localhost:5432/signalhub",
        s3: { enabled: false, endpoint: "", region: "auto", bucket: "", accessKeyId: "", secretAccessKey: "", prefix: "signalhub" }
      },
      withLock: async () => ({ locked: false }),
      dumpDatabase: vi.fn(),
      recordBackupRun
    });

    expect(result).toEqual({ ran: false, skipped: true });
    expect(recordBackupRun).not.toHaveBeenCalled();
  });
});

describe("startBackupScheduler", () => {
  it("runs once after startup and prevents overlapping runs", async () => {
    const callbacks: Array<() => void> = [];
    let resolveRun!: () => void;
    const activeRun = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    const runOnce = vi.fn(() => activeRun);
    const stop = startBackupScheduler({
      intervalHours: 1,
      runOnce,
      setTimeoutFn: (callback) => {
        callbacks.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      setIntervalFn: (callback) => {
        callbacks.push(callback);
        return 2 as unknown as ReturnType<typeof setInterval>;
      },
      clearTimeoutFn: vi.fn(),
      clearIntervalFn: vi.fn()
    });

    callbacks[0]();
    callbacks[1]();
    expect(runOnce).toHaveBeenCalledTimes(1);
    resolveRun();
    await stop();
  });
});
