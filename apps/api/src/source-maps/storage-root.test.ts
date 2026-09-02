import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SOURCE_MAP_STORAGE_MARKER_CONTENT,
  SOURCE_MAP_STORAGE_MARKER_NAME,
  assertSourceMapStorageRoot,
  listenAfterSourceMapStorage
} from "./storage-root.js";
import { storeSourceMapFile } from "./storage.js";

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
      const roots = await Promise.all(Array.from({ length: 12 }, () => assertSourceMapStorageRoot(localDir, "create")));
      expect(new Set(roots).size).toBe(1);
      expect(await readFile(path.join(localDir, SOURCE_MAP_STORAGE_MARKER_NAME), "utf8")).toBe(
        SOURCE_MAP_STORAGE_MARKER_CONTENT
      );
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

  it("rejects symlink and special intermediate upload entries before exclusive file creation", async () => {
    const localDir = await tempPath();
    const outside = await mkdtemp(path.join(tmpdir(), "sigmon-storage-outside-"));
    try {
      await assertSourceMapStorageRoot(localDir, "create");
      await symlink(outside, path.join(localDir, "prj_1"), "dir");
      await expect(
        storeSourceMapFile({
          localDir,
          projectId: "prj_1",
          environmentId: "env_1",
          release: "release_1",
          artifactId: "smap_1",
          content: Buffer.from("escaped")
        })
      ).rejects.toThrow("source_map_storage_path_invalid");
      expect(await readdir(outside)).toEqual([]);

      await rm(path.join(localDir, "prj_1"), { force: true });
      await writeFile(path.join(localDir, "prj_1"), "special");
      await expect(
        storeSourceMapFile({
          localDir,
          projectId: "prj_1",
          environmentId: "env_1",
          release: "release_1",
          artifactId: "smap_2",
          content: Buffer.from("blocked")
        })
      ).rejects.toThrow("source_map_storage_path_invalid");
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("does not overwrite an existing final artifact", async () => {
    const localDir = await tempPath();
    try {
      await assertSourceMapStorageRoot(localDir, "create");
      const artifactDir = path.join(localDir, "prj_1", "env_1", "release_1");
      await mkdir(artifactDir, { recursive: true });
      const artifactPath = path.join(artifactDir, "smap_1.map");
      await writeFile(artifactPath, "original");

      await expect(
        storeSourceMapFile({
          localDir,
          projectId: "prj_1",
          environmentId: "env_1",
          release: "release_1",
          artifactId: "smap_1",
          content: Buffer.from("replacement")
        })
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(artifactPath, "utf8")).toBe("original");
    } finally {
      await rm(path.dirname(localDir), { recursive: true, force: true });
    }
  });
});
