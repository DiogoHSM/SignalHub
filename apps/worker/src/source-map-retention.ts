import { rm } from "node:fs/promises";
import type { SourceMapArtifactRecord } from "@sigmon/db/repositories/source-maps.js";
import {
  assertSourceMapStorageRoot,
  resolveSourceMapArtifactPath
} from "../../api/src/source-maps/storage-root.js";

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

async function deleteSourceMapFileIfPresent(
  canonicalRoot: string,
  storagePath: string,
  removeFile: (resolvedPath: string) => Promise<void>
): Promise<boolean> {
  const resolvedStoragePath = await resolveSourceMapArtifactPath(canonicalRoot, storagePath, { allowMissing: true });
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
  let canonicalRoot: string;
  try {
    canonicalRoot = await assertSourceMapStorageRoot(runtime.localDir, "require");
  } catch (error) {
    throw new SourceMapRetentionError(
      "source_map_storage_unavailable",
      { sourceMapArtifacts: 0, sourceMapFiles: 0 },
      error
    );
  }

  const cutoff = new Date(runtime.now.getTime() - runtime.retentionDays * 24 * 60 * 60 * 1000);
  const artifacts = await runtime.listExpiredArtifacts({ cutoff, batchSize: runtime.batchSize });
  let sourceMapArtifacts = 0;
  let sourceMapFiles = 0;
  const removeFile = runtime.removeFile ?? ((resolvedPath: string) => rm(resolvedPath, { force: false }));

  for (const artifact of artifacts) {
    try {
      if (await deleteSourceMapFileIfPresent(canonicalRoot, artifact.storagePath, removeFile)) {
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
