import { mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  main,
  parseReconcileSourceMapsArgs,
  reconcileSourceMaps,
  safeReconciliationErrorCode,
  type ReconciliationDatabase,
  type ReconciliationMetadata,
  type ReconciliationStorage
} from "./reconcile-source-maps.js";
import {
  SOURCE_MAP_STORAGE_MARKER_CONTENT,
  SOURCE_MAP_STORAGE_MARKER_NAME,
  openSourceMapStorageSession
} from "../apps/api/src/source-maps/storage-root.js";

const batchSize = 100;

function metadata(id: string, storagePath = `/storage/${id}.map`): ReconciliationMetadata {
  return { id, storagePath };
}

function fakeDatabase(input: {
  metadata?: ReconciliationMetadata[];
  activePaths?: Set<string>;
  softDelete?: (candidate: ReconciliationMetadata) => Promise<boolean>;
} = {}): ReconciliationDatabase {
  const rows = [...(input.metadata ?? [])].sort((left, right) => left.id.localeCompare(right.id));
  return {
    listMetadataPage: async ({ afterId, batchSize: limit }) =>
      rows.filter((row) => afterId === null || row.id > afterId).slice(0, limit),
    findActiveStoragePaths: async (storagePaths) => {
      const activePaths = input.activePaths ?? new Set(rows.map((row) => row.storagePath));
      return [...new Set(rows
        .filter((row) => storagePaths.includes(row.storagePath) && activePaths.has(row.storagePath))
        .map((row) => row.storagePath))];
    },
    softDeleteMetadata: input.softDelete ?? (async () => true)
  };
}

function fakeStorage(input: {
  files?: Array<{ storagePath: string; modifiedAt: Date }>;
  existing?: Set<string>;
  inspect?: (storagePath: string) => Promise<{ exists: false } | { exists: true; modifiedAt: Date }>;
  remove?: (storagePath: string, cutoff: Date) => Promise<"deleted" | "missing" | "fresh">;
} = {}): ReconciliationStorage {
  const files = [...(input.files ?? [])].sort((left, right) => left.storagePath.localeCompare(right.storagePath));
  const existing = input.existing ?? new Set(files.map((file) => file.storagePath));
  return {
    assertAuthority: vi.fn(async () => undefined),
    inspectArtifact: input.inspect ?? (async (storagePath) => existing.has(storagePath)
      ? { exists: true, modifiedAt: new Date("2026-01-01T00:00:00.000Z") }
      : { exists: false }),
    listArtifactFilesPage: async ({ afterStoragePath, batchSize: limit }) =>
      files.filter((file) => afterStoragePath === null || file.storagePath > afterStoragePath).slice(0, limit),
    deleteArtifactIfOlderThan: input.remove ?? (async () => "deleted")
  };
}

function acquiredLock(database: ReconciliationDatabase) {
  return async <T>(run: (lockedDatabase: ReconciliationDatabase) => Promise<T>) => ({
    locked: true as const,
    result: await run(database)
  });
}

describe("source-map reconciliation", () => {
  it("accepts only no arguments or exactly one literal --apply", () => {
    expect(parseReconcileSourceMapsArgs([])).toEqual({ apply: false });
    expect(parseReconcileSourceMapsArgs(["--apply"])).toEqual({ apply: true });
    for (const args of [["--dry-run"], ["--apply", "--apply"], ["--apply", "extra"], ["--", "--apply"]]) {
      expect(() => parseReconcileSourceMapsArgs(args)).toThrow("source_map_reconciliation_argument_invalid");
    }
  });

  it("uses stable bounded pages and defaults to an exact no-mutation dry run", async () => {
    const metadataRows = Array.from({ length: 205 }, (_, index) => metadata(`smap_${String(index).padStart(3, "0")}`));
    const fileRows = metadataRows.slice(0, 204).map((row) => ({
      storagePath: row.storagePath,
      modifiedAt: new Date("2026-01-01T00:00:00.000Z")
    }));
    fileRows.push({ storagePath: "/storage/orphan.map", modifiedAt: new Date("2026-01-01T00:00:00.000Z") });
    const metadataCalls: Array<{ afterId: string | null; batchSize: number }> = [];
    const fileCalls: Array<{ afterStoragePath: string | null; batchSize: number }> = [];
    const database = fakeDatabase({ metadata: metadataRows });
    const storage = fakeStorage({ files: fileRows, existing: new Set(fileRows.map((row) => row.storagePath)) });
    const softDelete = vi.spyOn(database, "softDeleteMetadata");
    const remove = vi.spyOn(storage, "deleteArtifactIfOlderThan");
    const listMetadata = database.listMetadataPage;
    database.listMetadataPage = async (input) => {
      metadataCalls.push(input);
      return listMetadata(input);
    };
    const listFiles = storage.listArtifactFilesPage;
    storage.listArtifactFilesPage = async (input) => {
      fileCalls.push(input);
      return listFiles(input);
    };

    const result = await reconcileSourceMaps({
      apply: false,
      now: () => new Date("2026-06-01T12:00:00.000Z"),
      database,
      storage,
      withStorageLock: async () => {
        throw new Error("dry_run_must_not_lock");
      }
    });

    expect(result).toEqual({
      apply: false,
      metadataScanned: 205,
      filesScanned: 205,
      metadataWithoutFile: 1,
      filesWithoutMetadata: 1,
      metadataDeleted: 0,
      filesDeleted: 0,
      metadataIds: { withoutFile: ["smap_204"], deleted: [], truncated: false }
    });
    expect(metadataCalls).toEqual([
      { afterId: null, batchSize },
      { afterId: "smap_099", batchSize },
      { afterId: "smap_199", batchSize }
    ]);
    expect(fileCalls.every((call) => call.batchSize === batchSize)).toBe(true);
    expect(fileCalls.map((call) => call.afterStoragePath)).toEqual([null, "/storage/smap_098.map", "/storage/smap_198.map"]);
    expect(softDelete).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("validates every metadata locator before an apply lock or mutation", async () => {
    const database = fakeDatabase({
      metadata: [metadata("smap_001"), metadata("smap_002", "C:\\outside\\credential.map")]
    });
    const softDelete = vi.spyOn(database, "softDeleteMetadata");
    const withStorageLock = vi.fn(acquiredLock(database));
    const storage = fakeStorage({
      inspect: async (storagePath) => {
        if (storagePath.includes("outside")) throw new Error("source_map_storage_path_invalid");
        return { exists: false };
      }
    });

    await expect(reconcileSourceMaps({
      apply: true,
      now: () => new Date("2026-06-01T12:00:00.000Z"),
      database,
      storage,
      withStorageLock
    })).rejects.toThrow("source_map_storage_path_invalid");

    expect(withStorageLock).not.toHaveBeenCalled();
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("returns a stable error and performs no mutation when the apply lock is busy", async () => {
    const database = fakeDatabase({ metadata: [metadata("smap_missing")] });
    const storage = fakeStorage();
    const softDelete = vi.spyOn(database, "softDeleteMetadata");
    const remove = vi.spyOn(storage, "deleteArtifactIfOlderThan");

    await expect(reconcileSourceMaps({
      apply: true,
      now: () => new Date("2026-06-01T12:00:00.000Z"),
      database,
      storage,
      withStorageLock: async () => ({ locked: false })
    })).rejects.toThrow("source_map_reconciliation_lock_busy");

    expect(softDelete).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("replays under the lock so file appearance and concurrent soft-delete are idempotent", async () => {
    const rows = [metadata("smap_appeared"), metadata("smap_concurrent")];
    let replay = false;
    const database = fakeDatabase({
      metadata: rows,
      softDelete: async ({ id }) => id === "smap_concurrent" ? false : true
    });
    const storage = fakeStorage({
      inspect: async (storagePath) => replay && storagePath.endsWith("smap_appeared.map")
        ? { exists: true, modifiedAt: new Date("2026-06-01T11:59:59.000Z") }
        : { exists: false }
    });

    const result = await reconcileSourceMaps({
      apply: true,
      now: () => new Date("2026-06-01T12:00:00.000Z"),
      database,
      storage,
      withStorageLock: async (run) => {
        replay = true;
        return { locked: true, result: await run(database) };
      }
    });

    expect(result.metadataWithoutFile).toBe(2);
    expect(result.metadataDeleted).toBe(0);
    expect(result.metadataIds).toEqual({
      withoutFile: ["smap_appeared", "smap_concurrent"],
      deleted: [],
      truncated: false
    });
  });

  it("reasserts marker authority immediately before metadata mutation and still releases the lock", async () => {
    const row = metadata("smap_marker_removed");
    const softDeleteMetadata = vi.fn(async () => true);
    const database = fakeDatabase({ metadata: [row], softDelete: softDeleteMetadata });
    let replay = false;
    let markerValid = true;
    let released = false;
    const storage: ReconciliationStorage = {
      ...fakeStorage(),
      assertAuthority: async () => {
        if (!markerValid) throw new Error("source_map_storage_unavailable");
      },
      inspectArtifact: async () => {
        if (replay) markerValid = false;
        return { exists: false };
      }
    };

    await expect(reconcileSourceMaps({
      apply: true,
      now: () => new Date("2026-06-01T12:00:00.000Z"),
      database,
      storage,
      withStorageLock: async (run) => {
        replay = true;
        try {
          return { locked: true, result: await run(database) };
        } finally {
          released = true;
        }
      }
    })).rejects.toThrow("source_map_storage_unavailable");

    expect(softDeleteMetadata).not.toHaveBeenCalled();
    expect(released).toBe(true);
  });

  it("deletes only old orphan files and tolerates an idempotent disappearance", async () => {
    const oldPath = "/storage/old.map";
    const freshPath = "/storage/fresh.map";
    const gonePath = "/storage/gone.map";
    const removed: Array<{ storagePath: string; cutoff: Date }> = [];
    const files = [oldPath, freshPath, gonePath].map((storagePath) => ({
      storagePath,
      modifiedAt: new Date("2026-01-01T00:00:00.000Z")
    }));
    const database = fakeDatabase();
    const storage = fakeStorage({
      files,
      remove: async (storagePath, cutoff) => {
        removed.push({ storagePath, cutoff });
        if (storagePath === oldPath) return "deleted";
        if (storagePath === freshPath) return "fresh";
        return "missing";
      }
    });

    const result = await reconcileSourceMaps({
      apply: true,
      now: () => new Date("2026-06-01T12:00:00.000Z"),
      database,
      storage,
      withStorageLock: acquiredLock(database)
    });

    expect(result.filesWithoutMetadata).toBe(3);
    expect(result.filesDeleted).toBe(1);
    expect(removed).toHaveLength(3);
    expect(removed.every(({ cutoff }) => cutoff.toISOString() === "2026-06-01T11:00:00.000Z")).toBe(true);
  });

  it("caps metadata identifiers and never returns paths or file contents", async () => {
    const sensitivePath = "/storage/credential-secret.map";
    const rows = Array.from({ length: 105 }, (_, index) => metadata(`smap_${String(index).padStart(3, "0")}`, `${sensitivePath}-${index}`));
    const result = await reconcileSourceMaps({
      apply: false,
      now: () => new Date("2026-06-01T12:00:00.000Z"),
      database: fakeDatabase({ metadata: rows }),
      storage: fakeStorage(),
      withStorageLock: async () => ({ locked: false })
    });

    expect(result.metadataIds.withoutFile).toHaveLength(100);
    expect(result.metadataIds.truncated).toBe(true);
    expect(JSON.stringify(result)).not.toContain("credential-secret");
  });

  it("rejects an over-broad or duplicate membership result before materializing it into state", async () => {
    const orphanPath = "/storage/orphan.map";
    const database = fakeDatabase();
    database.findActiveStoragePaths = async () => Array.from({ length: 101 }, () => orphanPath);

    await expect(reconcileSourceMaps({
      apply: false,
      now: () => new Date("2026-06-01T12:00:00.000Z"),
      database,
      storage: fakeStorage({
        files: [{ storagePath: orphanPath, modifiedAt: new Date("2026-01-01T00:00:00.000Z") }]
      }),
      withStorageLock: async () => ({ locked: false })
    })).rejects.toThrow("source_map_reconciliation_membership_invalid");
  });
});

describe("reconciliation storage traversal and CLI lifecycle", () => {
  it("pages regular artifacts in stable order while skipping the marker, symlinks, and special entries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sigmon-reconcile-"));
    const outside = await mkdtemp(path.join(tmpdir(), "sigmon-reconcile-outside-"));
    const names = [
      "123e4567-e89b-42d3-a456-426614174003.map",
      "123e4567-e89b-42d3-a456-426614174001.map",
      "123e4567-e89b-42d3-a456-426614174002.map"
    ];
    try {
      await writeFile(path.join(root, SOURCE_MAP_STORAGE_MARKER_NAME), SOURCE_MAP_STORAGE_MARKER_CONTENT);
      for (const name of names) await writeFile(path.join(root, name), name);
      await writeFile(path.join(outside, "target.map"), "do-not-read");
      await symlink(path.join(outside, "target.map"), path.join(root, "123e4567-e89b-42d3-a456-426614174004.map"));
      await mkdir(path.join(root, "special.map"));
      const storage = await openSourceMapStorageSession({ localDir: root, mode: "require", nodeEnv: "test" });
      try {
        const first = await storage.listArtifactFilesPage({ afterStoragePath: null, batchSize: 2 });
        const second = await storage.listArtifactFilesPage({ afterStoragePath: first.at(-1)!.storagePath, batchSize: 2 });
        expect([...first, ...second].map((entry) => path.basename(entry.storagePath))).toEqual([...names].sort());
        expect(await readFile(path.join(outside, "target.map"), "utf8")).toBe("do-not-read");
      } finally {
        await storage.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("revalidates age immediately before deletion and protects a concurrently replaced fresh file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sigmon-reconcile-"));
    const fileName = "123e4567-e89b-42d3-a456-426614174000.map";
    const filePath = path.join(root, fileName);
    try {
      await writeFile(path.join(root, SOURCE_MAP_STORAGE_MARKER_NAME), SOURCE_MAP_STORAGE_MARKER_CONTENT);
      await writeFile(filePath, "old");
      await utimes(filePath, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
      const storage = await openSourceMapStorageSession({
        localDir: root,
        mode: "require",
        nodeEnv: "test",
        hooks: {
          beforeDeleteRevalidation: async () => {
            await rm(filePath);
            await writeFile(filePath, "fresh");
            await utimes(filePath, new Date("2026-06-01T11:30:00.000Z"), new Date("2026-06-01T11:30:00.000Z"));
          }
        }
      });
      try {
        await expect(storage.deleteArtifactIfOlderThan(filePath, new Date("2026-06-01T11:00:00.000Z"))).resolves.toBe("fresh");
        await expect(readFile(filePath, "utf8")).resolves.toBe("fresh");
      } finally {
        await storage.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the marker becomes absent, wrong, partial, or a symlink before orphan deletion", async () => {
    const mutations: Array<(markerPath: string, outsideMarker: string) => Promise<void>> = [
      async (markerPath) => rm(markerPath),
      async (markerPath) => writeFile(markerPath, "wrong\n"),
      async (markerPath) => writeFile(markerPath, "sigmon-source-map-storage-v1"),
      async (markerPath, outsideMarker) => {
        await rm(markerPath);
        await symlink(outsideMarker, markerPath);
      }
    ];

    for (const [index, mutateMarker] of mutations.entries()) {
      const root = await mkdtemp(path.join(tmpdir(), `sigmon-reconcile-marker-${index}-`));
      const outside = await mkdtemp(path.join(tmpdir(), `sigmon-reconcile-marker-outside-${index}-`));
      const markerPath = path.join(root, SOURCE_MAP_STORAGE_MARKER_NAME);
      const outsideMarker = path.join(outside, "marker");
      const filePath = path.join(root, "123e4567-e89b-42d3-a456-426614174000.map");
      try {
        await writeFile(markerPath, SOURCE_MAP_STORAGE_MARKER_CONTENT);
        await writeFile(outsideMarker, SOURCE_MAP_STORAGE_MARKER_CONTENT);
        await writeFile(filePath, "old");
        await utimes(filePath, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
        const storage = await openSourceMapStorageSession({
          localDir: root,
          mode: "require",
          nodeEnv: "test",
          hooks: { beforeDeleteRevalidation: () => mutateMarker(markerPath, outsideMarker) }
        });
        try {
          await expect(storage.deleteArtifactIfOlderThan(
            filePath,
            new Date("2026-06-01T11:00:00.000Z")
          )).rejects.toThrow("source_map_storage_unavailable");
          await expect(readFile(filePath, "utf8")).resolves.toBe("old");
        } finally {
          await storage.close();
        }
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    }
  });

  it("fails closed before metadata soft-delete for every marker mutation during inspection", async () => {
    const mutations: Array<(markerPath: string, outsideMarker: string) => Promise<void>> = [
      async (markerPath) => rm(markerPath),
      async (markerPath) => writeFile(markerPath, "wrong\n"),
      async (markerPath) => writeFile(markerPath, "sigmon-source-map-storage-v1"),
      async (markerPath, outsideMarker) => {
        await rm(markerPath);
        await symlink(outsideMarker, markerPath);
      }
    ];

    for (const [index, mutateMarker] of mutations.entries()) {
      const root = await mkdtemp(path.join(tmpdir(), `sigmon-reconcile-metadata-marker-${index}-`));
      const outside = await mkdtemp(path.join(tmpdir(), `sigmon-reconcile-metadata-outside-${index}-`));
      const markerPath = path.join(root, SOURCE_MAP_STORAGE_MARKER_NAME);
      const outsideMarker = path.join(outside, "marker");
      let storage: Awaited<ReturnType<typeof openSourceMapStorageSession>> | undefined;
      try {
        await writeFile(markerPath, SOURCE_MAP_STORAGE_MARKER_CONTENT);
        await writeFile(outsideMarker, SOURCE_MAP_STORAGE_MARKER_CONTENT);
        let inspections = 0;
        storage = await openSourceMapStorageSession({
          localDir: root,
          mode: "require",
          nodeEnv: "test",
          hooks: {
            afterParentPinned: async () => {
              inspections += 1;
              if (inspections === 2) await mutateMarker(markerPath, outsideMarker);
            }
          }
        });
        const softDeleteMetadata = vi.fn(async () => true);
        const database = fakeDatabase({
          metadata: [metadata(
            `smap_marker_${index}`,
            path.join(root, `123e4567-e89b-42d3-a456-42661417400${index}.map`)
          )],
          softDelete: softDeleteMetadata
        });
        let released = false;

        await expect(reconcileSourceMaps({
          apply: true,
          now: () => new Date("2026-06-01T12:00:00.000Z"),
          database,
          storage,
          withStorageLock: async (run) => {
            try {
              return { locked: true, result: await run(database) };
            } finally {
              released = true;
            }
          }
        })).rejects.toThrow("source_map_storage_unavailable");

        expect(softDeleteMetadata).not.toHaveBeenCalled();
        expect(released).toBe(true);
      } finally {
        await storage?.close();
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    }
  });

  it("deletes a regular orphan exactly at the one-hour grace boundary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sigmon-reconcile-"));
    const filePath = path.join(root, "123e4567-e89b-42d3-a456-426614174000.map");
    try {
      await writeFile(path.join(root, SOURCE_MAP_STORAGE_MARKER_NAME), SOURCE_MAP_STORAGE_MARKER_CONTENT);
      await writeFile(filePath, "old");
      const cutoff = new Date("2026-06-01T11:00:00.000Z");
      await utimes(filePath, cutoff, cutoff);
      const storage = await openSourceMapStorageSession({ localDir: root, mode: "require", nodeEnv: "test" });
      try {
        await expect(storage.deleteArtifactIfOlderThan(filePath, cutoff)).resolves.toBe("deleted");
        await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await storage.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "linux")("scans legacy files through pinned directories without following a symlink directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sigmon-reconcile-linux-"));
    const outside = await mkdtemp(path.join(tmpdir(), "sigmon-reconcile-linux-outside-"));
    const legacyPath = path.join(root, "project", "environment", "release", "artifact.map");
    try {
      await writeFile(path.join(root, SOURCE_MAP_STORAGE_MARKER_NAME), SOURCE_MAP_STORAGE_MARKER_CONTENT);
      await mkdir(path.dirname(legacyPath), { recursive: true });
      await writeFile(legacyPath, "legacy");
      await mkdir(path.join(outside, "environment", "release"), { recursive: true });
      await writeFile(path.join(outside, "environment", "release", "outside.map"), "outside");
      await symlink(outside, path.join(root, "linked"), "dir");
      const storage = await openSourceMapStorageSession({ localDir: root, mode: "require", nodeEnv: "test" });
      try {
        const files = await storage.listArtifactFilesPage({ afterStoragePath: null, batchSize: 100 });
        expect(files.map((file) => file.storagePath)).toEqual([legacyPath]);
        await expect(readFile(path.join(outside, "environment", "release", "outside.map"), "utf8")).resolves.toBe("outside");
      } finally {
        await storage.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("validates the marker before creating a database and destroys every created database on failure", async () => {
    const createDb = vi.fn(() => ({ destroy: vi.fn(async () => undefined) }));
    await expect(main([], {
      loadRuntimeConfig: () => ({ databaseUrl: "postgres://credential@invalid/db", localDir: "/invalid" }),
      openStorage: async () => { throw new Error("source_map_storage_unavailable"); },
      createDatabase: createDb
    })).rejects.toThrow("source_map_storage_unavailable");
    expect(createDb).not.toHaveBeenCalled();

    const destroy = vi.fn(async () => undefined);
    await expect(main([], {
      loadRuntimeConfig: () => ({ databaseUrl: "postgres://credential@invalid/db", localDir: "/valid" }),
      openStorage: async () => ({
        ...fakeStorage(),
        close: vi.fn(async () => undefined)
      }),
      createDatabase: () => ({ destroy }),
      createDatabaseRuntime: () => ({
        ...fakeDatabase(),
        listMetadataPage: async () => { throw new Error("synthetic_database_failure"); }
      }),
      withDatabaseStorageLock: async () => ({ locked: false })
    })).rejects.toThrow("synthetic_database_failure");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("does no setup for invalid arguments and closes storage and database after a successful dry run", async () => {
    const loadRuntimeConfig = vi.fn(() => ({ databaseUrl: "postgres://credential@invalid/db", localDir: "/valid" }));
    const close = vi.fn(async () => undefined);
    const destroy = vi.fn(async () => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await expect(main(["--apply", "--apply"], { loadRuntimeConfig })).rejects.toThrow(
        "source_map_reconciliation_argument_invalid"
      );
      expect(loadRuntimeConfig).not.toHaveBeenCalled();

      const result = await main([], {
        loadRuntimeConfig,
        openStorage: async () => ({ ...fakeStorage(), close }),
        createDatabase: () => ({ destroy }),
        createDatabaseRuntime: () => fakeDatabase(),
        withDatabaseStorageLock: async () => { throw new Error("dry_run_must_not_lock"); }
      });

      expect(result).toMatchObject({ apply: false, metadataScanned: 0, filesScanned: 0 });
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('"metadataScanned":0'));
    } finally {
      log.mockRestore();
    }
  });

  it("destroys the database after an apply lock-busy failure", async () => {
    const destroy = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    await expect(main(["--apply"], {
      loadRuntimeConfig: () => ({ databaseUrl: "postgres://credential@invalid/db", localDir: "/valid" }),
      openStorage: async () => ({ ...fakeStorage(), close }),
      createDatabase: () => ({ destroy }),
      createDatabaseRuntime: () => fakeDatabase(),
      withDatabaseStorageLock: async () => ({ locked: false })
    })).rejects.toThrow("source_map_reconciliation_lock_busy");
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not emit a success result before teardown succeeds", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await expect(main([], {
        loadRuntimeConfig: () => ({ databaseUrl: "postgres://credential@invalid/db", localDir: "/valid" }),
        openStorage: async () => ({ ...fakeStorage(), close: async () => undefined }),
        createDatabase: () => ({ destroy: async () => { throw new Error("synthetic_destroy_failure"); } }),
        createDatabaseRuntime: () => fakeDatabase(),
        withDatabaseStorageLock: async () => { throw new Error("dry_run_must_not_lock"); }
      })).rejects.toThrow("synthetic_destroy_failure");
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("maps unknown failures to a non-reflective error code", () => {
    expect(safeReconciliationErrorCode(new Error("postgres://user:secret@db.invalid/sigmon"))).toBe("source_map_reconciliation_failed");
    expect(safeReconciliationErrorCode(new Error("source_map_reconciliation_lock_busy"))).toBe("source_map_reconciliation_lock_busy");
  });
});
