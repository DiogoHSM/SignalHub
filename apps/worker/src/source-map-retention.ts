import { lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";
import type { SourceMapArtifactRecord } from "@signal-hub/db/repositories/source-maps.js";

export type SourceMapRetentionDeletedCounts = {
  sourceMapArtifacts: number;
  sourceMapFiles: number;
};

export class SourceMapRetentionError extends Error {
  readonly deleted: SourceMapRetentionDeletedCounts;

  constructor(message: string, deleted: SourceMapRetentionDeletedCounts, cause?: unknown) {
    super(message, cause ? { cause } : undefined);
    this.name = "SourceMapRetentionError";
    this.deleted = deleted;
  }
}

type SourceMapRetentionRuntime = {
  localDir: string;
  now: Date;
  retentionDays: number;
  batchSize: number;
  listExpiredArtifacts: (input: {
    cutoff: Date;
    batchSize: number;
  }) => Promise<SourceMapArtifactRecord[]>;
  softDeleteArtifact: (id: string) => Promise<SourceMapArtifactRecord | null>;
  removeFile?: (resolvedPath: string) => Promise<void>;
};

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function assertInsideLocalDir(localDir: string, storagePath: string): void {
  const relativePath = path.relative(localDir, storagePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("source_map_storage_path_invalid");
  }
}

async function assertMissingStoragePathInsideLocalDir(localDir: string, storagePath: string): Promise<void> {
  const missingSegments: string[] = [];
  let currentPath = storagePath;

  for (;;) {
    try {
      const realExistingPath = await realpath(currentPath);
      assertInsideLocalDir(localDir, path.join(realExistingPath, ...missingSegments.reverse()));
      return;
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        throw error;
      }
      missingSegments.push(path.basename(currentPath));
      currentPath = parentPath;
    }
  }
}

async function resolveStoragePath(localDir: string, storagePath: string): Promise<string | null> {
  const resolvedLocalDir = await realpath(localDir);
  const resolvedStoragePath = path.resolve(storagePath);

  try {
    const targetStats = await lstat(resolvedStoragePath);
    if (targetStats.isSymbolicLink()) {
      throw new Error("source_map_storage_path_invalid");
    }
    const realStoragePath = await realpath(resolvedStoragePath);
    assertInsideLocalDir(resolvedLocalDir, realStoragePath);
    return realStoragePath;
  } catch (error) {
    if (isEnoent(error)) {
      await assertMissingStoragePathInsideLocalDir(resolvedLocalDir, resolvedStoragePath);
      return null;
    }
    throw error;
  }
}

async function deleteSourceMapFileIfPresent(
  localDir: string,
  storagePath: string,
  removeFile: (resolvedPath: string) => Promise<void>
): Promise<boolean> {
  const resolvedStoragePath = await resolveStoragePath(localDir, storagePath);
  if (!resolvedStoragePath) return false;
  try {
    await removeFile(resolvedStoragePath);
  } catch (error) {
    if (isEnoent(error)) {
      return false;
    }
    throw error;
  }
  return true;
}

export async function deleteExpiredSourceMapArtifacts(
  runtime: SourceMapRetentionRuntime
): Promise<SourceMapRetentionDeletedCounts> {
  const cutoff = new Date(runtime.now.getTime() - runtime.retentionDays * 24 * 60 * 60 * 1000);
  const artifacts = await runtime.listExpiredArtifacts({ cutoff, batchSize: runtime.batchSize });
  let sourceMapArtifacts = 0;
  let sourceMapFiles = 0;
  const removeFile = runtime.removeFile ?? ((resolvedPath: string) => rm(resolvedPath, { force: false }));

  for (const artifact of artifacts) {
    try {
      if (await deleteSourceMapFileIfPresent(runtime.localDir, artifact.storagePath, removeFile)) {
        sourceMapFiles += 1;
      }
      const deleted = await runtime.softDeleteArtifact(artifact.id);
      if (deleted) sourceMapArtifacts += 1;
    } catch (error) {
      throw new SourceMapRetentionError(error instanceof Error ? error.message : String(error), {
        sourceMapArtifacts,
        sourceMapFiles
      }, error);
    }
  }

  return { sourceMapArtifacts, sourceMapFiles };
}
