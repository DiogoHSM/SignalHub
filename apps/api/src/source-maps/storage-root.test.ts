import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import { deleteSourceMapArtifact, getSourceMapArtifact } from "@sigmon/db/repositories/source-maps.js";
import {
  SOURCE_MAP_STORAGE_MARKER_CONTENT,
  SOURCE_MAP_STORAGE_MARKER_NAME,
  assertSourceMapStorageRoot,
  listenAfterSourceMapStorage,
  openSourceMapStorageSession,
  type SourceMapStorageSession
} from "./storage-root.js";
import { deleteSourceMapArtifactAndFile, storeSourceMapFile, uploadSourceMapBundle } from "./storage.js";

vi.mock("@sigmon/db/repositories/source-maps.js", () => ({
  createSourceMapArtifact: vi.fn(),
  deleteSourceMapArtifact: vi.fn(),
  getSourceMapArtifact: vi.fn()
}));

async function tempPath(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), "sigmon-storage-root-parent-"));
  return path.join(parent, "source-maps");
}

describe("assertSourceMapStorageRoot", () => {
  it("creates an absent root and exact marker without broad permissions", async () => {
    const localDir = await tempPath();
    try {
      await expect(assertSourceMapStorageRoot(localDir, "create")).resolves.toBe(await realpath(localDir));

      const markerPath = path.join(localDir, SOURCE_MAP_STORAGE_MARKER_NAME);
      expect(await readFile(markerPath)).toEqual(Buffer.from(SOURCE_MAP_STORAGE_MARKER_CONTENT));
      expect((await lstat(markerPath)).isFile()).toBe(true);
      if (process.platform !== "win32") {
        expect((await lstat(markerPath)).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
    }
  });

  it("never creates or repairs storage in require mode", async () => {
    const localDir = await tempPath();
    try {
      await expect(assertSourceMapStorageRoot(localDir, "require")).rejects.toThrow("source_map_storage_unavailable");
      await expect(access(localDir)).rejects.toMatchObject({ code: "ENOENT" });

      await mkdir(localDir);
      await writeFile(path.join(localDir, SOURCE_MAP_STORAGE_MARKER_NAME), "partial");
      await expect(assertSourceMapStorageRoot(localDir, "require")).rejects.toThrow("source_map_storage_unavailable");
      expect(await readFile(path.join(localDir, SOURCE_MAP_STORAGE_MARKER_NAME), "utf8")).toBe("partial");
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
    }
  });

  it("rejects file roots and wrong, partial, directory, or symlink markers without overwriting them", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "sigmon-storage-root-invalid-"));
    const fileRoot = path.join(parent, "root-file");
    const localDir = path.join(parent, "source-maps");
    const outsideMarker = path.join(parent, "outside-marker");
    try {
      await writeFile(fileRoot, "not-a-directory");
      await expect(assertSourceMapStorageRoot(fileRoot, "create")).rejects.toThrow("source_map_storage_unavailable");

      await mkdir(localDir);
      const markerPath = path.join(localDir, SOURCE_MAP_STORAGE_MARKER_NAME);
      for (const content of ["wrong\n", "sigmon-source-map-storage-v1"]) {
        await rm(markerPath, { recursive: true, force: true });
        await writeFile(markerPath, content);
        await expect(assertSourceMapStorageRoot(localDir, "create")).rejects.toThrow("source_map_storage_unavailable");
        expect(await readFile(markerPath, "utf8")).toBe(content);
      }

      await rm(markerPath, { force: true });
      await mkdir(markerPath);
      await expect(assertSourceMapStorageRoot(localDir, "create")).rejects.toThrow("source_map_storage_unavailable");

      await rm(markerPath, { recursive: true, force: true });
      await writeFile(outsideMarker, SOURCE_MAP_STORAGE_MARKER_CONTENT);
      await symlink(outsideMarker, markerPath);
      await expect(assertSourceMapStorageRoot(localDir, "require")).rejects.toThrow("source_map_storage_unavailable");
      expect(await readFile(outsideMarker, "utf8")).toBe(SOURCE_MAP_STORAGE_MARKER_CONTENT);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("rejects an unreadable marker", async () => {
    const localDir = await tempPath();
    try {
      await assertSourceMapStorageRoot(localDir, "create");
      const markerPath = path.join(localDir, SOURCE_MAP_STORAGE_MARKER_NAME);
      await chmod(markerPath, 0);
      await expect(assertSourceMapStorageRoot(localDir, "require")).rejects.toThrow("source_map_storage_unavailable");
      await chmod(markerPath, 0o600);
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
    }
  });

  it("handles concurrent create-mode initializers without replacing the marker", async () => {
    const localDir = await tempPath();
    try {
      const roots = await Promise.all(Array.from({ length: 128 }, () => assertSourceMapStorageRoot(localDir, "create")));
      expect(new Set(roots).size).toBe(1);
      expect(await readFile(path.join(localDir, SOURCE_MAP_STORAGE_MARKER_NAME), "utf8")).toBe(
        SOURCE_MAP_STORAGE_MARKER_CONTENT
      );
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
    }
  });

  it("syncs the containing directory after marker publication and temporary-name cleanup", async () => {
    const localDir = await tempPath();
    const syncs: Array<{ directory: string; entries: string[] }> = [];
    try {
      await assertSourceMapStorageRoot(localDir, "create", {
        syncDirectory: async (directory) => {
          syncs.push({ directory, entries: (await readdir(directory)).sort() });
        }
      });

      const canonicalRoot = await realpath(localDir);
      expect(syncs).toHaveLength(2);
      expect(syncs.map((entry) => entry.directory)).toEqual([canonicalRoot, canonicalRoot]);
      expect(syncs[0].entries).toContain(SOURCE_MAP_STORAGE_MARKER_NAME);
      expect(syncs[0].entries.some((entry) => entry.endsWith(".tmp"))).toBe(true);
      expect(syncs[1].entries).toEqual([SOURCE_MAP_STORAGE_MARKER_NAME]);
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
    }
  });

  it("does not mask a publication sync failure and still removes its temporary name", async () => {
    const localDir = await tempPath();
    let calls = 0;
    const publicationError = new Error("directory_sync_failed");
    try {
      let error: (Error & { cause?: unknown }) | undefined;
      try {
        await assertSourceMapStorageRoot(localDir, "create", {
          syncDirectory: async () => {
            calls += 1;
            if (calls === 1) throw publicationError;
            throw new Error("cleanup_sync_failed");
          }
        });
      } catch (caught) {
        error = caught as Error & { cause?: unknown };
      }
      expect(error).toMatchObject({ message: "source_map_storage_unavailable" });
      expect(error?.cause).toBe(publicationError);
      expect((await readdir(localDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
      expect(calls).toBe(2);
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
    }
  });

  it("propagates a temporary-name cleanup sync failure after successful publication", async () => {
    const localDir = await tempPath();
    let calls = 0;
    try {
      await expect(
        assertSourceMapStorageRoot(localDir, "create", {
          syncDirectory: async () => {
            calls += 1;
            if (calls === 2) throw new Error("cleanup_sync_failed");
          }
        })
      ).rejects.toThrow("source_map_storage_unavailable");
      expect(await readFile(path.join(localDir, SOURCE_MAP_STORAGE_MARKER_NAME), "utf8")).toBe(
        SOURCE_MAP_STORAGE_MARKER_CONTENT
      );
      expect((await readdir(localDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
      expect(calls).toBe(2);
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
    }
  });

  it("accepts a symlinked root only when its canonical target and marker validate", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "sigmon-storage-target-"));
    const link = path.join(tmpdir(), `sigmon-storage-link-${process.pid}-${Date.now()}`);
    try {
      await assertSourceMapStorageRoot(target, "create");
      await symlink(target, link, "dir");
      await expect(assertSourceMapStorageRoot(link, "require")).resolves.toBe(await realpath(target));
    } finally {
      await rm(link, { force: true });
      await rm(target, { recursive: true, force: true });
    }
  });
});

describe("SourceMapStorageSession", () => {
  it("rejects non-Linux production storage before exposing a filesystem capability", async () => {
    const localDir = await tempPath();
    try {
      await assertSourceMapStorageRoot(localDir, "create");
      await expect(
        openSourceMapStorageSession({ localDir, mode: "require", nodeEnv: "production", platform: "win32" })
      ).rejects.toThrow("source_map_storage_unsupported_platform");
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
    }
  });

  it("fails closed when a Linux root descriptor cannot be addressed through procfs", async () => {
    const localDir = await tempPath();
    try {
      await assertSourceMapStorageRoot(localDir, "create");
      await expect(
        openSourceMapStorageSession({
          localDir,
          mode: "require",
          nodeEnv: "production",
          platform: "linux",
          procFdRoot: path.join(localDir, "missing-proc-fd")
        })
      ).rejects.toThrow("source_map_storage_capability_unavailable");
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "linux")("keeps legacy reads and deletes bound after an intermediate replacement", async () => {
    const localDir = await tempPath();
    const outside = await mkdtemp(path.join(tmpdir(), "sigmon-session-outside-"));
    try {
      await assertSourceMapStorageRoot(localDir, "create");
      const legacyDir = path.join(localDir, "prj", "env", "rel");
      await mkdir(legacyDir, { recursive: true });
      const legacyFile = path.join(legacyDir, "artifact.map");
      await writeFile(legacyFile, "inside");
      await mkdir(path.join(outside, "env", "rel"), { recursive: true });
      const outsideFile = path.join(outside, "env", "rel", "artifact.map");
      await writeFile(outsideFile, "outside");
      const session = await openSourceMapStorageSession({ localDir, mode: "require", nodeEnv: "test" });
      try {
        const moved = path.join(localDir, "moved-prj");
        let swapped = false;
        const swap = async () => {
          if (swapped) return;
          swapped = true;
          await rename(path.join(localDir, "prj"), moved);
          await symlink(outside, path.join(localDir, "prj"), "dir");
        };

        await expect(session.readArtifact(legacyFile, { afterParentPinned: swap })).resolves.toEqual(Buffer.from("inside"));
        await rm(path.join(localDir, "prj"), { force: true });
        await rename(moved, path.join(localDir, "prj"));
        swapped = false;
        await expect(session.deleteArtifact(legacyFile, { afterParentPinned: swap })).resolves.toBe(true);
        await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside");
      } finally {
        await session.close();
      }
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "linux")("removes a flat create through the pinned root when the configured name is replaced", async () => {
    const localDir = await tempPath();
    const outside = await mkdtemp(path.join(tmpdir(), "sigmon-session-outside-"));
    try {
      await assertSourceMapStorageRoot(localDir, "create");
      const session = await openSourceMapStorageSession({ localDir, mode: "require", nodeEnv: "test" });
      const moved = `${localDir}-moved`;
      try {
        await expect(
          session.createArtifact("123e4567-e89b-42d3-a456-426614174000.map", Buffer.from("inside"), {
            afterCreateBeforeRootCheck: async () => {
              await rename(localDir, moved);
              await symlink(outside, localDir, "dir");
            }
          })
        ).rejects.toThrow("source_map_storage_unavailable");
        await expect(access(path.join(moved, "123e4567-e89b-42d3-a456-426614174000.map"))).rejects.toMatchObject({ code: "ENOENT" });
        expect(await readdir(outside)).toEqual([]);
      } finally {
        await session.close();
        await rm(localDir, { force: true });
        await rename(moved, localDir);
      }
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects nested legacy paths on non-Linux without reading or deleting their replacement target", async () => {
    const localDir = await tempPath();
    try {
      await assertSourceMapStorageRoot(localDir, "create");
      const nestedDir = path.join(localDir, "prj", "env");
      await mkdir(nestedDir, { recursive: true });
      const nestedFile = path.join(nestedDir, "artifact.map");
      await writeFile(nestedFile, "inside");
      const session = await openSourceMapStorageSession({
        localDir,
        mode: "require",
        nodeEnv: "test",
        platform: "win32"
      });
      try {
        await expect(session.readArtifact(nestedFile)).rejects.toThrow("source_map_storage_path_invalid");
        await expect(session.deleteArtifact(nestedFile)).rejects.toThrow("source_map_storage_path_invalid");
        await expect(readFile(nestedFile, "utf8")).resolves.toBe("inside");
      } finally {
        await session.close();
      }
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
    }
  });
});

describe("source-map startup and upload storage boundary", () => {
  it("initializes storage before listening and never listens after initialization failure", async () => {
    const calls: string[] = [];
    await listenAfterSourceMapStorage({
      localDir: "/source-maps",
      initialize: async () => {
        calls.push("initialized");
      },
      listen: async () => {
        calls.push("listening");
        return "ready";
      }
    });
    expect(calls).toEqual(["initialized", "listening"]);

    const listen = vi.fn(async () => "unexpected");
    await expect(
      listenAfterSourceMapStorage({
        localDir: "/source-maps",
        initialize: async () => {
          throw new Error("storage unavailable");
        },
        listen
      })
    ).rejects.toThrow("storage unavailable");
    expect(listen).not.toHaveBeenCalled();
  });

  it("stores new uploads in the flat v2 layout without traversing legacy intermediate entries", async () => {
    const localDir = await tempPath();
    const outside = await mkdtemp(path.join(tmpdir(), "sigmon-storage-outside-"));
    try {
      await assertSourceMapStorageRoot(localDir, "create");
      const storage = await openSourceMapStorageSession({ localDir, mode: "require", nodeEnv: "test" });
      await symlink(outside, path.join(localDir, "prj_1"), "dir");
      try {
        const first = await storeSourceMapFile({
          storage,
          projectId: "prj_1",
          environmentId: "env_1",
          release: "release_1",
          artifactId: "123e4567-e89b-42d3-a456-426614174000",
          content: Buffer.from("escaped")
        });
        expect(path.dirname(first.storagePath)).toBe(await realpath(localDir));
        expect(await readFile(first.storagePath, "utf8")).toBe("escaped");
        expect(await readdir(outside)).toEqual([]);

        await rm(path.join(localDir, "prj_1"), { force: true });
        await writeFile(path.join(localDir, "prj_1"), "special");
        const second = await storeSourceMapFile({
          storage,
          projectId: "prj_1",
          environmentId: "env_1",
          release: "release_1",
          artifactId: "123e4567-e89b-42d3-a456-426614174001",
          content: Buffer.from("blocked")
        });
        expect(path.dirname(second.storagePath)).toBe(await realpath(localDir));
      } finally {
        await storage.close();
      }
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("does not overwrite an existing final artifact", async () => {
    const localDir = await tempPath();
    try {
      await assertSourceMapStorageRoot(localDir, "create");
      const storage = await openSourceMapStorageSession({ localDir, mode: "require", nodeEnv: "test" });
      const artifactPath = path.join(await realpath(localDir), "123e4567-e89b-42d3-a456-426614174000.map");
      await writeFile(artifactPath, "original");

      try {
        await expect(
          storeSourceMapFile({
            storage,
            projectId: "prj_1",
            environmentId: "env_1",
            release: "release_1",
            artifactId: "123e4567-e89b-42d3-a456-426614174000",
            content: Buffer.from("replacement")
          })
        ).rejects.toMatchObject({ code: "EEXIST" });
        expect(await readFile(artifactPath, "utf8")).toBe("original");
      } finally {
        await storage.close();
      }
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "linux")("cleans bundle files through the pinned root after the configured root is replaced", async () => {
    const localDir = await tempPath();
    const outside = await mkdtemp(path.join(tmpdir(), "sigmon-storage-outside-"));
    const moved = `${localDir}-moved`;
    let storage: SourceMapStorageSession | undefined;
    try {
      await assertSourceMapStorageRoot(localDir, "create");
      storage = await openSourceMapStorageSession({ localDir, mode: "require", nodeEnv: "test" });
      const map = (file: string) => Buffer.from(JSON.stringify({ version: 3, file, sources: [], names: [], mappings: "" }));
      const db = {
        transaction: () => ({
          execute: async () => {
            await rename(localDir, moved);
            await symlink(outside, localDir, "dir");
            throw new Error("db_down");
          }
        })
      };

      await expect(uploadSourceMapBundle({
        db: db as never,
        storage,
        input: {
          projectId: "prj_1",
          environmentId: "env_1",
          release: "release_1",
          uploadedByUserId: "usr_1",
          originalFilename: "maps.zip",
          contentType: "application/zip",
          content: Buffer.from(zipSync({ "one.js.map": map("one.js"), "two.js.map": map("two.js") }))
        }
      })).rejects.toThrow("db_down");

      expect((await readdir(moved)).filter((name) => name.endsWith(".map"))).toEqual([]);
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await storage?.close();
      await rm(localDir, { force: true });
      try { await rename(moved, localDir); } catch { /* root was not moved */ }
      await rm(path.dirname(localDir), { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "linux")("keeps admin legacy deletion bound after an intermediate replacement", async () => {
    const localDir = await tempPath();
    const outside = await mkdtemp(path.join(tmpdir(), "sigmon-storage-outside-"));
    let storage: SourceMapStorageSession | undefined;
    try {
      await assertSourceMapStorageRoot(localDir, "create");
      const legacyParent = path.join(localDir, "prj_1");
      const movedParent = path.join(localDir, "moved-prj_1");
      const legacyFile = path.join(legacyParent, "env_1", "release_1", "artifact.map");
      const outsideFile = path.join(outside, "env_1", "release_1", "artifact.map");
      await mkdir(path.dirname(legacyFile), { recursive: true });
      await writeFile(legacyFile, "inside");
      await mkdir(path.dirname(outsideFile), { recursive: true });
      await writeFile(outsideFile, "outside");
      storage = await openSourceMapStorageSession({
        localDir,
        mode: "require",
        nodeEnv: "test",
        hooks: {
          afterParentPinned: async () => {
            await rename(legacyParent, movedParent);
            await symlink(outside, legacyParent, "dir");
          }
        }
      });
      vi.mocked(getSourceMapArtifact).mockResolvedValueOnce({
        id: "smap_1", projectId: "prj_1", environmentId: "env_1", release: "release_1",
        minifiedFile: "app.js", originalFilename: "app.js.map", contentType: "application/json",
        byteSize: 6, sha256: "sha", storagePath: legacyFile, uploadedByUserId: "usr_1",
        uploadedByTokenId: null, createdAt: new Date(), deletedAt: null
      });

      await deleteSourceMapArtifactAndFile({
        db: {} as never,
        storage,
        input: { id: "smap_1", projectId: "prj_1", environmentId: "env_1" }
      });

      await expect(readFile(path.join(movedParent, "env_1", "release_1", "artifact.map"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside");
      expect(deleteSourceMapArtifact).toHaveBeenCalledWith({}, { id: "smap_1", projectId: "prj_1", environmentId: "env_1" });
    } finally {
      await storage?.close();
      await rm(path.dirname(localDir), { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
