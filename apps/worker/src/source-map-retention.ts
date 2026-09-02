import type { SourceMapArtifactRecord } from "@sigmon/db/repositories/source-maps.js";
import {
  openSourceMapStorageSession,
  type SourceMapStorageSession
} from "../../api/src/source-maps/storage-root.js";

export type SourceMapRetentionDeletedCounts = {
  sourceMapArtifacts: number;
  sourceMapFiles: number;
};

export type SourceMapRetentionResult = SourceMapRetentionDeletedCounts & { skipped: boolean };

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
  withStorageLock: <T>(
    run: () => Promise<T>
  ) => Promise<{ locked: false } | { locked: true; result: T }>;
  listExpiredArtifacts: (input: {
    cutoff: Date;
    batchSize: number;
  }) => Promise<SourceMapArtifactRecord[]>;
  softDeleteArtifact: (id: string) => Promise<SourceMapArtifactRecord | null>;
  storage?: SourceMapStorageSession;
  nodeEnv?: string;
};

export async function deleteExpiredSourceMapArtifacts(
  runtime: SourceMapRetentionRuntime
): Promise<SourceMapRetentionResult> {
  let storage: SourceMapStorageSession;
  let ownsStorage = false;
  try {
    storage = runtime.storage ?? await openSourceMapStorageSession({
      localDir: runtime.localDir,
      mode: "require",
      nodeEnv: runtime.nodeEnv ?? process.env.NODE_ENV ?? "production"
    });
    ownsStorage = runtime.storage === undefined;
    await storage.assertAuthority();
  } catch (error) {
    throw new SourceMapRetentionError(
      "source_map_storage_unavailable",
      { sourceMapArtifacts: 0, sourceMapFiles: 0 },
      error
    );
  }

  try {
    const locked = await runtime.withStorageLock(async () => {
      try {
        await storage.assertAuthority();
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

      for (const artifact of artifacts) {
        try {
          if (await storage.deleteArtifact(artifact.storagePath)) sourceMapFiles += 1;
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
    });
    if (!locked.locked) return { sourceMapArtifacts: 0, sourceMapFiles: 0, skipped: true };
    return { ...locked.result, skipped: false };
  } finally {
    if (ownsStorage) await storage.close();
  }
}
