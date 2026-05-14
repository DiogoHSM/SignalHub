import { lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";
import type { SourceMapArtifactRecord } from "@signal-hub/db/repositories/source-maps.js";

export type SourceMapRetentionDeletedCounts = {
  sourceMapArtifacts: number;
  sourceMapFiles: number;
};

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
};

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
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      const realStorageParent = await realpath(path.dirname(resolvedStoragePath));
      assertInsideLocalDir(resolvedLocalDir, path.join(realStorageParent, path.basename(resolvedStoragePath)));
      return null;
    }
    throw error;
  }
}

async function deleteSourceMapFileIfPresent(localDir: string, storagePath: string): Promise<boolean> {
  const resolvedStoragePath = await resolveStoragePath(localDir, storagePath);
  if (!resolvedStoragePath) return false;
  await rm(resolvedStoragePath, { force: false });
  return true;
}

export async function deleteExpiredSourceMapArtifacts(
  runtime: SourceMapRetentionRuntime
): Promise<SourceMapRetentionDeletedCounts> {
  const cutoff = new Date(runtime.now.getTime() - runtime.retentionDays * 24 * 60 * 60 * 1000);
  const artifacts = await runtime.listExpiredArtifacts({ cutoff, batchSize: runtime.batchSize });
  let sourceMapArtifacts = 0;
  let sourceMapFiles = 0;

  for (const artifact of artifacts) {
    if (await deleteSourceMapFileIfPresent(runtime.localDir, artifact.storagePath)) {
      sourceMapFiles += 1;
    }
    const deleted = await runtime.softDeleteArtifact(artifact.id);
    if (deleted) sourceMapArtifacts += 1;
  }

  return { sourceMapArtifacts, sourceMapFiles };
}
