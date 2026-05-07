import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBackupS3Key,
  createBackupFilename,
  dumpPostgresDatabase,
  pruneLocalBackups,
  runBackupOnce,
  startBackupScheduler,
  uploadBackupToS3
} from "../src/backups.js";
import { parseRestoreArgs, restoreBackup } from "../../../scripts/backup-restore.js";
import type { BackupRunInput, BackupRuntimeConfig, BackupS3Config } from "../src/backups.js";

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn()
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: childProcessMock.spawn
}));

function createSuccessfulChildProcess(): EventEmitter & { stderr: EventEmitter } {
  const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
  child.stderr = new EventEmitter();
  queueMicrotask(() => child.emit("close", 0));
  return child;
}

describe("createBackupFilename", () => {
  it("uses a UTC timestamp and no secrets", () => {
    expect(createBackupFilename(new Date("2026-05-06T12:34:56.000Z"))).toBe("signalhub-20260506T123456Z.dump");
  });
});

describe("parseRestoreArgs", () => {
  it("requires a file path and explicit --yes", () => {
    expect(() => parseRestoreArgs(["node", "backup-restore.ts"])).toThrow(
      "Usage: pnpm backup:restore -- <file> --yes"
    );
    expect(() => parseRestoreArgs(["node", "backup-restore.ts", "backup.dump"])).toThrow("Restore requires --yes");
    expect(() => parseRestoreArgs(["node", "backup-restore.ts", "--", "backup.dump"])).toThrow(
      "Restore requires --yes"
    );
    expect(parseRestoreArgs(["node", "backup-restore.ts", "backup.dump", "--yes"])).toEqual({
      filePath: "backup.dump"
    });
    expect(parseRestoreArgs(["node", "backup-restore.ts", "--", "backup.dump", "--yes"])).toEqual({
      filePath: "backup.dump"
    });
  });

  it("rejects ambiguous positional file paths", () => {
    expect(() =>
      parseRestoreArgs(["node", "backup-restore.ts", "backup-a.dump", "backup-b.dump", "--yes"])
    ).toThrow("Restore accepts exactly one file path");
  });

  it("rejects unknown and dash-prefixed restore options", () => {
    expect(() => parseRestoreArgs(["node", "backup-restore.ts", "backup.dump", "--force", "--yes"])).toThrow(
      "Unknown restore option: --force"
    );
    expect(() => parseRestoreArgs(["node", "backup-restore.ts", "-backup.dump", "--yes"])).toThrow(
      "Unknown restore option: -backup.dump"
    );
  });
});

describe("restoreBackup", () => {
  beforeEach(() => {
    childProcessMock.spawn.mockReset();
  });

  it("passes password through PGPASSWORD and non-secret connection args", async () => {
    const databaseUrl = "postgres://user:pa%24%24@localhost:5433/signalhub";
    childProcessMock.spawn.mockReturnValue(createSuccessfulChildProcess());

    await restoreBackup({
      databaseUrl,
      filePath: "/tmp/signalhub.dump"
    });

    const [command, args, options] = childProcessMock.spawn.mock.calls[0] ?? [];
    expect(command).toBe("pg_restore");
    expect(args).toEqual([
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      "signalhub",
      "--host",
      "localhost",
      "--port",
      "5433",
      "--username",
      "user",
      "--",
      "/tmp/signalhub.dump"
    ]);
    expect(args).not.toContain(databaseUrl);
    expect(args?.join(" ")).not.toContain("pa%24%24");
    expect(args?.join(" ")).not.toContain("pa$$");
    expect(options).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({ PGPASSWORD: "pa$$" }),
        stdio: ["ignore", "inherit", "pipe"]
      })
    );
  });

  it("preserves non-secret database URL options without putting the password in argv", async () => {
    const databaseUrl =
      "postgres://user:secret@db.example.com:5432/signalhub?sslmode=require&application_name=signalhub";
    childProcessMock.spawn.mockReturnValue(createSuccessfulChildProcess());

    await restoreBackup({
      databaseUrl,
      filePath: "/tmp/signalhub.dump"
    });

    const [, args, options] = childProcessMock.spawn.mock.calls[0] ?? [];
    expect(args).not.toContain(databaseUrl);
    expect(args?.join(" ")).not.toContain("secret");
    expect(args).toContain("postgres://user@db.example.com:5432/signalhub?sslmode=require&application_name=signalhub");
    expect(args).toContain("--");
    expect(args?.slice(-2)).toEqual(["--", "/tmp/signalhub.dump"]);
    expect(options).toEqual(expect.objectContaining({ env: expect.objectContaining({ PGPASSWORD: "secret" }) }));
  });
});

describe("createBackupS3Key", () => {
  it("trims leading and trailing slashes from prefixes", () => {
    expect(createBackupS3Key("/prod/signalhub/", "signalhub-20260506T123456Z.dump")).toBe(
      "prod/signalhub/signalhub-20260506T123456Z.dump"
    );
  });

  it("returns the filename when prefix is empty", () => {
    expect(createBackupS3Key("", "signalhub-20260506T123456Z.dump")).toBe("signalhub-20260506T123456Z.dump");
    expect(createBackupS3Key("///", "signalhub-20260506T123456Z.dump")).toBe("signalhub-20260506T123456Z.dump");
  });
});

describe("dumpPostgresDatabase", () => {
  it("runs pg_dump with explicit non-secret connection args and password in the environment", async () => {
    const execFileFn = vi.fn(
      async (_file: string, _args: string[], _options?: { env?: NodeJS.ProcessEnv }) => undefined
    );

    await dumpPostgresDatabase({
      databaseUrl: "postgres://user:pa%24%24@localhost:5433/signalhub",
      outputPath: "/tmp/signalhub.dump",
      execFileFn
    });

    const [command, args, options] = execFileFn.mock.calls[0] ?? [];
    expect(command).toBe("pg_dump");
    expect(args).toEqual([
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--file",
      "/tmp/signalhub.dump",
      "--dbname",
      "signalhub",
      "--host",
      "localhost",
      "--port",
      "5433",
      "--username",
      "user"
    ]);
    expect(args).not.toContain("postgres://user:pa%24%24@localhost:5433/signalhub");
    expect(options).toEqual(expect.objectContaining({ env: expect.objectContaining({ PGPASSWORD: "pa$$" }) }));
  });

  it("preserves non-secret database URL options without putting the password in argv", async () => {
    const execFileFn = vi.fn(
      async (_file: string, _args: string[], _options?: { env?: NodeJS.ProcessEnv }) => undefined
    );
    const databaseUrl =
      "postgres://user:secret@db.example.com:5432/signalhub?sslmode=require&application_name=signalhub";

    await dumpPostgresDatabase({
      databaseUrl,
      outputPath: "/tmp/signalhub.dump",
      execFileFn
    });

    const [, args, options] = execFileFn.mock.calls[0] ?? [];
    expect(args).not.toContain(databaseUrl);
    expect(args?.join(" ")).not.toContain("secret");
    expect(args).toContain("postgres://user@db.example.com:5432/signalhub?sslmode=require&application_name=signalhub");
    expect(args?.join(" ")).toContain("sslmode=require");
    expect(args?.join(" ")).toContain("application_name=signalhub");
    expect(options).toEqual(expect.objectContaining({ env: expect.objectContaining({ PGPASSWORD: "secret" }) }));
  });

  it("does not include the raw database URL in thrown pg_dump errors", async () => {
    const databaseUrl = "postgres://user:secret@localhost:5432/signalhub";
    const execFileFn = vi.fn(async () => {
      throw new Error(`Command failed: pg_dump ${databaseUrl}`);
    });

    await expect(
      dumpPostgresDatabase({
        databaseUrl,
        outputPath: "/tmp/signalhub.dump",
        execFileFn
      })
    ).rejects.toThrow("pg_dump failed");
    await expect(
      dumpPostgresDatabase({
        databaseUrl,
        outputPath: "/tmp/signalhub.dump",
        execFileFn
      })
    ).rejects.not.toThrow(databaseUrl);
  });
});

describe("uploadBackupToS3", () => {
  it("uses configured S3 client options and uploads as an octet stream", async () => {
    const send = vi.fn(async (_command: { input: unknown }) => undefined);
    const createClient = vi.fn(() => ({ send }));

    await uploadBackupToS3({
      filePath: "/tmp/signalhub.dump",
      key: "prod/signalhub/signalhub-20260506T120000Z.dump",
      s3: {
        enabled: true,
        endpoint: "https://example.r2.cloudflarestorage.com",
        region: "auto",
        bucket: "bucket",
        accessKeyId: "access",
        secretAccessKey: "secret",
        prefix: "prod/signalhub"
      },
      createClient
    });

    expect(createClient).toHaveBeenCalledWith({
      endpoint: "https://example.r2.cloudflarestorage.com",
      region: "auto",
      credentials: {
        accessKeyId: "access",
        secretAccessKey: "secret"
      },
      forcePathStyle: true
    });
    expect(send).toHaveBeenCalledTimes(1);
    const sentCommand = send.mock.calls[0]?.[0];
    expect(sentCommand?.input).toEqual(
      expect.objectContaining({
        Bucket: "bucket",
        Key: "prod/signalhub/signalhub-20260506T120000Z.dump",
        ContentType: "application/octet-stream"
      })
    );
  });

  it("destroys the backup stream when S3 upload fails", async () => {
    const stream = Readable.from(["backup-content"]);
    const destroy = vi.spyOn(stream, "destroy");
    const send = vi.fn(async () => {
      throw new Error("s3 failed secret=hidden");
    });

    await expect(
      uploadBackupToS3({
        filePath: "/tmp/signalhub.dump",
        key: "prod/signalhub/signalhub-20260506T120000Z.dump",
        s3: {
          enabled: true,
          endpoint: "https://example.r2.cloudflarestorage.com",
          region: "auto",
          bucket: "bucket",
          accessKeyId: "access",
          secretAccessKey: "secret",
          prefix: "prod/signalhub"
        },
        createClient: () => ({ send }),
        createReadStreamFn: () => stream
      })
    ).rejects.toThrow("s3 failed secret=hidden");

    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe("pruneLocalBackups", () => {
  it("only deletes old SignalHub dump files", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "signalhub-backups-"));
    const oldBackup = join(localDir, "signalhub-20260401T000000Z.dump");
    const freshBackup = join(localDir, "signalhub-fresh.dump");
    const manualBackup = join(localDir, "signalhub-manual.dump");
    const unrelatedDump = join(localDir, "other-old.dump");
    const unrelatedText = join(localDir, "signalhub-old.txt");

    try {
      await writeFile(oldBackup, "old");
      await writeFile(freshBackup, "fresh");
      await writeFile(manualBackup, "manual");
      await writeFile(unrelatedDump, "other");
      await writeFile(unrelatedText, "text");
      await utimes(oldBackup, new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-01T00:00:00.000Z"));
      await utimes(manualBackup, new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-01T00:00:00.000Z"));
      await utimes(unrelatedDump, new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-01T00:00:00.000Z"));
      await utimes(unrelatedText, new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-01T00:00:00.000Z"));

      await pruneLocalBackups({
        localDir,
        retentionDays: 14,
        now: new Date("2026-05-06T12:00:00.000Z")
      });

      await expect(stat(oldBackup)).rejects.toThrow();
      await expect(stat(freshBackup)).resolves.toBeTruthy();
      await expect(stat(manualBackup)).resolves.toBeTruthy();
      await expect(stat(unrelatedDump)).resolves.toBeTruthy();
      await expect(stat(unrelatedText)).resolves.toBeTruthy();
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });
});

describe("runBackupOnce", () => {
  it("creates a local backup, uploads to S3 when enabled, records success, and prunes old local files", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "signalhub-backups-"));
    const oldFile = join(localDir, "signalhub-20260401T000000Z.dump");
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

  it("records a sanitized failed run when S3 upload fails", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "signalhub-backups-"));
    const recordBackupRun = vi.fn(async (input) => input);

    try {
      await expect(
        runBackupOnce({
          now: () => new Date("2026-05-06T12:00:00.000Z"),
          trigger: "scheduled",
          config: {
            enabled: true,
            intervalHours: 24,
            localDir,
            retentionDays: 14,
            databaseUrl: "postgres://user:password@localhost:5432/signalhub",
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
          uploadBackup: async () => {
            throw new Error("S3 upload failed secret=hidden");
          },
          recordBackupRun
        })
      ).resolves.toEqual({ ran: true, skipped: false });

      expect(recordBackupRun).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          trigger: "scheduled",
          sizeBytes: null,
          s3Bucket: null,
          s3Key: null,
          errorMessage: "S3 upload failed secret=[REDACTED]"
        })
      );
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it("records a sanitized failed run when pruning fails", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "signalhub-backups-"));
    const recordBackupRun = vi.fn(async (input) => input);

    try {
      await expect(
        runBackupOnce({
          now: () => new Date("2026-05-06T12:00:00.000Z"),
          trigger: "scheduled",
          config: {
            enabled: true,
            intervalHours: 24,
            localDir,
            retentionDays: 14,
            databaseUrl: "postgres://user:password@localhost:5432/signalhub",
            s3: { enabled: false, endpoint: "", region: "auto", bucket: "", accessKeyId: "", secretAccessKey: "", prefix: "signalhub" }
          },
          withLock: async (run) => ({ locked: true, result: await run() }),
          dumpDatabase: async (input) => {
            await writeFile(input.outputPath, "backup-content");
          },
          pruneBackups: async () => {
            throw new Error("prune failed password=hidden");
          },
          recordBackupRun
        })
      ).resolves.toEqual({ ran: true, skipped: false });

      expect(recordBackupRun).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          trigger: "scheduled",
          errorMessage: "prune failed password=[REDACTED]"
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
    const setTimeoutFn = vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    const setIntervalFn = vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return 2 as unknown as ReturnType<typeof setInterval>;
    });
    const stop = startBackupScheduler({
      intervalHours: 1,
      runOnce,
      setTimeoutFn,
      setIntervalFn,
      clearTimeoutFn: vi.fn(),
      clearIntervalFn: vi.fn()
    });

    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1000);
    callbacks[0]();
    callbacks[1]();
    expect(runOnce).toHaveBeenCalledTimes(1);
    resolveRun();
    await stop();
  });
});

type RequiredTypeExports = {
  s3: BackupS3Config;
  config: BackupRuntimeConfig;
  input: BackupRunInput;
};

const requiredTypeExports: RequiredTypeExports | null = null;
void requiredTypeExports;
