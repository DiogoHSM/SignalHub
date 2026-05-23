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
    expect(createBackupFilename(new Date("2026-05-06T12:34:56.000Z"))).toBe("sigmon-20260506T123456Z.dump");
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
    const databaseUrl = "postgres://user:pa%24%24@localhost:5433/sigmon";
    childProcessMock.spawn.mockImplementation(() => createSuccessfulChildProcess());

    await restoreBackup({
      databaseUrl,
      filePath: "/tmp/sigmon.dump"
    });

    const [command, args, options] = childProcessMock.spawn.mock.calls[0] ?? [];
    expect(command).toBe("pg_restore");
    expect(args).toEqual([
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      "sigmon",
      "--host",
      "localhost",
      "--port",
      "5433",
      "--username",
      "user",
      "--",
      "/tmp/sigmon.dump"
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
      "postgres://user:secret@db.example.com:5432/sigmon?sslmode=require&application_name=sigmon";
    childProcessMock.spawn.mockImplementation(() => createSuccessfulChildProcess());

    await restoreBackup({
      databaseUrl,
      filePath: "/tmp/sigmon.dump"
    });

    const [, args, options] = childProcessMock.spawn.mock.calls[0] ?? [];
    expect(args).not.toContain(databaseUrl);
    expect(args?.join(" ")).not.toContain("secret");
    expect(args).toContain("postgres://user@db.example.com:5432/sigmon?sslmode=require&application_name=sigmon");
    expect(args).toContain("--");
    expect(args?.slice(-2)).toEqual(["--", "/tmp/sigmon.dump"]);
    expect(options).toEqual(expect.objectContaining({ env: expect.objectContaining({ PGPASSWORD: "secret" }) }));
  });

  it("refuses restore when a checksum sidecar does not match before spawning pg_restore", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "sigmon-restore-"));
    const dumpPath = join(localDir, "sigmon.dump");
    await writeFile(dumpPath, "backup-content");
    await writeFile(`${dumpPath}.sha256`, `deadbeef  sigmon.dump\n`);

    try {
      await expect(
        restoreBackup({
          databaseUrl: "postgres://user:pass@localhost:5432/sigmon",
          filePath: dumpPath
        })
      ).rejects.toThrow("Backup checksum mismatch");
      expect(childProcessMock.spawn).not.toHaveBeenCalled();
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });
});

describe("createBackupS3Key", () => {
  it("trims leading and trailing slashes from prefixes", () => {
    expect(createBackupS3Key("/prod/sigmon/", "sigmon-20260506T123456Z.dump")).toBe(
      "prod/sigmon/sigmon-20260506T123456Z.dump"
    );
  });

  it("returns the filename when prefix is empty", () => {
    expect(createBackupS3Key("", "sigmon-20260506T123456Z.dump")).toBe("sigmon-20260506T123456Z.dump");
    expect(createBackupS3Key("///", "sigmon-20260506T123456Z.dump")).toBe("sigmon-20260506T123456Z.dump");
  });
});

describe("dumpPostgresDatabase", () => {
  it("runs pg_dump with explicit non-secret connection args and password in the environment", async () => {
    const execFileFn = vi.fn(
      async (_file: string, _args: string[], _options?: { env?: NodeJS.ProcessEnv }) => undefined
    );

    await dumpPostgresDatabase({
      databaseUrl: "postgres://user:pa%24%24@localhost:5433/sigmon",
      outputPath: "/tmp/sigmon.dump",
      execFileFn
    });

    const [command, args, options] = execFileFn.mock.calls[0] ?? [];
    expect(command).toBe("pg_dump");
    expect(args).toEqual([
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--file",
      "/tmp/sigmon.dump",
      "--dbname",
      "sigmon",
      "--host",
      "localhost",
      "--port",
      "5433",
      "--username",
      "user"
    ]);
    expect(args).not.toContain("postgres://user:pa%24%24@localhost:5433/sigmon");
    expect(options).toEqual(expect.objectContaining({ env: expect.objectContaining({ PGPASSWORD: "pa$$" }) }));
  });

  it("preserves non-secret database URL options without putting the password in argv", async () => {
    const execFileFn = vi.fn(
      async (_file: string, _args: string[], _options?: { env?: NodeJS.ProcessEnv }) => undefined
    );
    const databaseUrl =
      "postgres://user:secret@db.example.com:5432/sigmon?sslmode=require&application_name=sigmon";

    await dumpPostgresDatabase({
      databaseUrl,
      outputPath: "/tmp/sigmon.dump",
      execFileFn
    });

    const [, args, options] = execFileFn.mock.calls[0] ?? [];
    expect(args).not.toContain(databaseUrl);
    expect(args?.join(" ")).not.toContain("secret");
    expect(args).toContain("postgres://user@db.example.com:5432/sigmon?sslmode=require&application_name=sigmon");
    expect(args?.join(" ")).toContain("sslmode=require");
    expect(args?.join(" ")).toContain("application_name=sigmon");
    expect(options).toEqual(expect.objectContaining({ env: expect.objectContaining({ PGPASSWORD: "secret" }) }));
  });

  it("does not include the raw database URL in thrown pg_dump errors", async () => {
    const databaseUrl = "postgres://user:secret@localhost:5432/sigmon";
    const execFileFn = vi.fn(async () => {
      throw new Error(`Command failed: pg_dump ${databaseUrl}`);
    });

    await expect(
      dumpPostgresDatabase({
        databaseUrl,
        outputPath: "/tmp/sigmon.dump",
        execFileFn
      })
    ).rejects.toThrow("pg_dump failed");
    await expect(
      dumpPostgresDatabase({
        databaseUrl,
        outputPath: "/tmp/sigmon.dump",
        execFileFn
      })
    ).rejects.not.toThrow(databaseUrl);
  });
});

describe("uploadBackupToS3", () => {
  it("uses configured S3 client options and uploads the dump and checksum sidecar", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "sigmon-upload-"));
    const dumpPath = join(localDir, "sigmon.dump");
    const sidecarPath = `${dumpPath}.sha256`;
    const send = vi.fn(async (_command: { input: unknown }) => undefined);
    const createClient = vi.fn(() => ({ send }));
    const streams: Readable[] = [];
    const createReadStreamFn = vi.fn((path: string) => {
      const stream = Readable.from([path.endsWith(".sha256") ? "checksum  sigmon.dump\n" : "backup-content"]);
      streams.push(stream);
      return stream;
    });

    try {
      await writeFile(dumpPath, "backup-content");
      await writeFile(sidecarPath, "checksum  sigmon.dump\n");

      await uploadBackupToS3({
        filePath: dumpPath,
        key: "prod/sigmon/sigmon-20260506T120000Z.dump",
        s3: {
          enabled: true,
          endpoint: "https://example.r2.cloudflarestorage.com",
          region: "auto",
          bucket: "bucket",
          accessKeyId: "access",
          secretAccessKey: "secret",
          prefix: "prod/sigmon"
        },
        createClient,
        createReadStreamFn
      });
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }

    expect(createClient).toHaveBeenCalledWith({
      endpoint: "https://example.r2.cloudflarestorage.com",
      region: "auto",
      credentials: {
        accessKeyId: "access",
        secretAccessKey: "secret"
      },
      forcePathStyle: true
    });
    expect(createReadStreamFn).toHaveBeenCalledWith(dumpPath);
    expect(createReadStreamFn).toHaveBeenCalledWith(sidecarPath);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0].input).toEqual(
      expect.objectContaining({
        Bucket: "bucket",
        Key: "prod/sigmon/sigmon-20260506T120000Z.dump",
        ContentType: "application/octet-stream"
      })
    );
    expect(send.mock.calls[1]?.[0].input).toEqual(
      expect.objectContaining({
        Bucket: "bucket",
        Key: "prod/sigmon/sigmon-20260506T120000Z.dump.sha256",
        ContentType: "text/plain"
      })
    );
    expect(streams.every((stream) => stream.destroyed)).toBe(true);
  });

  it("fails S3 upload when the local checksum sidecar is missing", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "sigmon-upload-"));
    const dumpPath = join(localDir, "sigmon.dump");
    const send = vi.fn(async (_command: { input: unknown }) => undefined);

    try {
      await writeFile(dumpPath, "backup-content");

      await expect(
        uploadBackupToS3({
          filePath: dumpPath,
          key: "prod/sigmon/sigmon.dump",
          s3: {
            enabled: true,
            endpoint: "https://example.r2.cloudflarestorage.com",
            region: "auto",
            bucket: "bucket",
            accessKeyId: "access",
            secretAccessKey: "secret",
            prefix: "prod/sigmon"
          },
          createClient: () => ({ send })
        })
      ).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it("destroys backup streams when S3 upload fails", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "sigmon-upload-"));
    const dumpPath = join(localDir, "sigmon.dump");
    const streams: Readable[] = [];
    const send = vi.fn(async () => {
      throw new Error("s3 failed secret=hidden");
    });

    try {
      await writeFile(dumpPath, "backup-content");
      await writeFile(`${dumpPath}.sha256`, "checksum  sigmon.dump\n");

      await expect(
        uploadBackupToS3({
          filePath: dumpPath,
          key: "prod/sigmon/sigmon-20260506T120000Z.dump",
          s3: {
            enabled: true,
            endpoint: "https://example.r2.cloudflarestorage.com",
            region: "auto",
            bucket: "bucket",
            accessKeyId: "access",
            secretAccessKey: "secret",
            prefix: "prod/sigmon"
          },
          createClient: () => ({ send }),
          createReadStreamFn: (path) => {
            const stream = Readable.from([path.endsWith(".sha256") ? "checksum  sigmon.dump\n" : "backup-content"]);
            streams.push(stream);
            return stream;
          }
        })
      ).rejects.toThrow("s3 failed secret=hidden");

      expect(streams.every((stream) => stream.destroyed)).toBe(true);
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });
});

describe("pruneLocalBackups", () => {
  it("only deletes old SignalMonitor dump files", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "sigmon-backups-"));
    const oldBackup = join(localDir, "sigmon-20260401T000000Z.dump");
    const oldBackupSidecar = `${oldBackup}.sha256`;
    const freshBackup = join(localDir, "sigmon-fresh.dump");
    const manualBackup = join(localDir, "sigmon-manual.dump");
    const unrelatedDump = join(localDir, "other-old.dump");
    const unrelatedText = join(localDir, "sigmon-old.txt");

    try {
      await writeFile(oldBackup, "old");
      await writeFile(oldBackupSidecar, "old-checksum");
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
      await expect(stat(oldBackupSidecar)).rejects.toThrow();
      await expect(stat(freshBackup)).resolves.toBeTruthy();
      await expect(stat(manualBackup)).resolves.toBeTruthy();
      await expect(stat(unrelatedDump)).resolves.toBeTruthy();
      await expect(stat(unrelatedText)).resolves.toBeTruthy();
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it("ignores missing checksum sidecars when deleting old dump files", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "sigmon-backups-"));
    const oldBackup = join(localDir, "sigmon-20260401T000000Z.dump");

    try {
      await writeFile(oldBackup, "old");
      await utimes(oldBackup, new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-01T00:00:00.000Z"));

      await expect(
        pruneLocalBackups({
          localDir,
          retentionDays: 14,
          now: new Date("2026-05-06T12:00:00.000Z")
        })
      ).resolves.toBeUndefined();

      await expect(stat(oldBackup)).rejects.toThrow();
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });
});

describe("runBackupOnce", () => {
  it("creates a local backup, uploads to S3 when enabled, records success, and prunes old local files", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "sigmon-backups-"));
    const oldFile = join(localDir, "sigmon-20260401T000000Z.dump");
    const dumpPath = join(localDir, "sigmon-20260506T120000Z.dump");
    const expectedChecksum = "a92e0ec81286ff0f9ccf5982a22a83a0b70082446d5fd7af0eb9a3ceacd16c86";
    await writeFile(oldFile, "old");
    await utimes(oldFile, new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-01T00:00:00.000Z"));

    const recordBackupRun = vi.fn(async (input) => input);
    const upload = vi.fn(async () => ({ bucket: "bucket", key: "prod/sigmon/sigmon-20260506T120000Z.dump" }));

    try {
      const result = await runBackupOnce({
        now: () => new Date("2026-05-06T12:00:00.000Z"),
        trigger: "scheduled",
        config: {
          enabled: true,
          intervalHours: 24,
          localDir,
          retentionDays: 14,
          databaseUrl: "postgres://user:pass@localhost:5432/sigmon",
          s3: {
            enabled: true,
            endpoint: "https://example.r2.cloudflarestorage.com",
            region: "auto",
            bucket: "bucket",
            accessKeyId: "access",
            secretAccessKey: "secret",
            prefix: "prod/sigmon"
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
      expect(await readFile(dumpPath, "utf8")).toBe("backup-content");
      expect(await readFile(`${dumpPath}.sha256`, "utf8")).toBe(`${expectedChecksum}  sigmon-20260506T120000Z.dump\n`);
      await expect(stat(oldFile)).rejects.toThrow();
      expect(upload).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: dumpPath,
          key: "prod/sigmon/sigmon-20260506T120000Z.dump"
        })
      );
      expect(recordBackupRun).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "success",
          trigger: "scheduled",
          sizeBytes: 14,
          checksumSha256: expectedChecksum,
          s3Bucket: "bucket",
          s3Key: "prod/sigmon/sigmon-20260506T120000Z.dump",
          errorMessage: null
        })
      );
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it("records a sanitized failed run when S3 upload fails", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "sigmon-backups-"));
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
            databaseUrl: "postgres://user:password@localhost:5432/sigmon",
            s3: {
              enabled: true,
              endpoint: "https://example.r2.cloudflarestorage.com",
              region: "auto",
              bucket: "bucket",
              accessKeyId: "access",
              secretAccessKey: "secret",
              prefix: "prod/sigmon"
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
          checksumSha256: null,
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
    const localDir = await mkdtemp(join(tmpdir(), "sigmon-backups-"));
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
            databaseUrl: "postgres://user:password@localhost:5432/sigmon",
            s3: { enabled: false, endpoint: "", region: "auto", bucket: "", accessKeyId: "", secretAccessKey: "", prefix: "sigmon" }
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
          checksumSha256: null,
          errorMessage: "prune failed password=[REDACTED]"
        })
      );
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it("records a sanitized failed run when pg_dump fails", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "sigmon-backups-"));
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
            databaseUrl: "postgres://user:password@localhost:5432/sigmon",
            s3: { enabled: false, endpoint: "", region: "auto", bucket: "", accessKeyId: "", secretAccessKey: "", prefix: "sigmon" }
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
          checksumSha256: null,
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
        databaseUrl: "postgres://user:pass@localhost:5432/sigmon",
        s3: { enabled: false, endpoint: "", region: "auto", bucket: "", accessKeyId: "", secretAccessKey: "", prefix: "sigmon" }
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
