import { createHash, randomUUID } from "node:crypto";
import type { Db } from "@sigmon/db";
import {
  createSourceMapArtifact,
  deleteSourceMapArtifact,
  getSourceMapArtifact,
  type SourceMapArtifactRecord
} from "@sigmon/db/repositories/source-maps.js";
import type {
  SourceMapBundleUploadInput,
  SourceMapUploadAttribution,
  SourceMapUploadInput
} from "../routes/admin.js";
import { extractSourceMapsFromZip, inferMinifiedFileFromMap, normalizeMinifiedFile, parseSourceMapJson } from "./parser.js";
import { type SourceMapStorageSession } from "./storage-root.js";

export type StoredArtifact = {
  storagePath: string;
  byteSize: number;
  sha256: string;
};

type StoredArtifactPathInput = {
  storage: SourceMapStorageSession;
  storagePath: string;
};

export async function storeSourceMapFile(input: {
  storage: SourceMapStorageSession;
  projectId: string;
  environmentId: string;
  release: string;
  artifactId: string;
  content: Buffer;
}): Promise<StoredArtifact> {
  const storagePath = await input.storage.createArtifact(`${input.artifactId}.map`, input.content);

  return {
    storagePath,
    byteSize: input.content.byteLength,
    sha256: createHash("sha256").update(input.content).digest("hex")
  };
}

export async function readSourceMapFile(input: StoredArtifactPathInput): Promise<string> {
  return (await input.storage.readArtifact(input.storagePath)).toString("utf8");
}

export async function deleteSourceMapFile(input: StoredArtifactPathInput): Promise<void> {
  if (!(await input.storage.deleteArtifact(input.storagePath))) {
    const error = new Error(`ENOENT: source map artifact not found, unlink '${input.storagePath}'`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }
}

async function deleteSourceMapFileIfPresent(input: StoredArtifactPathInput): Promise<void> {
  try {
    await deleteSourceMapFile(input);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function cleanupStoredFiles(storage: SourceMapStorageSession, storagePaths: string[]): Promise<void> {
  await Promise.all(storagePaths.map((storagePath) => storage.cleanupCreatedArtifact(storagePath)));
}

function assertUniqueMinifiedFiles(sourceMaps: Array<{ minifiedFile: string }>): void {
  const minifiedFiles = new Set<string>();
  for (const sourceMap of sourceMaps) {
    if (minifiedFiles.has(sourceMap.minifiedFile)) {
      throw new Error("source_map_duplicate_minified_file");
    }
    minifiedFiles.add(sourceMap.minifiedFile);
  }
}

function sourceMapArtifactUploader(input: SourceMapUploadInput | SourceMapBundleUploadInput): SourceMapUploadAttribution {
  if (typeof input.uploadedByTokenId === "string") {
    return { uploadedByTokenId: input.uploadedByTokenId };
  }

  if (typeof input.uploadedByUserId === "string") {
    return { uploadedByUserId: input.uploadedByUserId };
  }

  throw new Error("source_map_uploader_missing");
}

export async function uploadSingleSourceMap(input: {
  db: Db;
  storage: SourceMapStorageSession;
  input: SourceMapUploadInput;
}): Promise<SourceMapArtifactRecord[]> {
  const map = parseSourceMapJson(input.input.content.toString("utf8"));
  // Stack frames are normalized to a basename before lookup, so a caller-supplied
  // path like "assets/app.min.js" has to be normalized too or it never matches.
  const providedMinifiedFile = input.input.minifiedFile ? normalizeMinifiedFile(input.input.minifiedFile) : undefined;
  const minifiedFile = providedMinifiedFile || inferMinifiedFileFromMap(map);
  if (!minifiedFile) {
    throw new Error("source_map_file_missing");
  }

  const stored = await storeSourceMapFile({
    storage: input.storage,
    projectId: input.input.projectId,
    environmentId: input.input.environmentId,
    release: input.input.release,
    artifactId: randomUUID(),
    content: input.input.content
  });

  try {
    const artifact = await createSourceMapArtifact(input.db, {
      projectId: input.input.projectId,
      environmentId: input.input.environmentId,
      release: input.input.release,
      minifiedFile,
      originalFilename: input.input.originalFilename,
      contentType: input.input.contentType || "application/json",
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      storagePath: stored.storagePath,
      ...sourceMapArtifactUploader(input.input)
    });

    return [artifact];
  } catch (error) {
    await cleanupStoredFiles(input.storage, [stored.storagePath]);
    throw error;
  }
}

export async function uploadSourceMapBundle(input: {
  db: Db;
  storage: SourceMapStorageSession;
  input: SourceMapBundleUploadInput;
}): Promise<SourceMapArtifactRecord[]> {
  const sourceMaps = extractSourceMapsFromZip(input.input.content);
  assertUniqueMinifiedFiles(sourceMaps);

  const writtenStoragePaths: string[] = [];

  try {
    const storedMaps: Array<{
      sourceMap: {
        originalFilename: string;
        content: Buffer;
        minifiedFile: string;
      };
      stored: StoredArtifact;
    }> = [];
    for (const sourceMap of sourceMaps) {
      const stored = await storeSourceMapFile({
        storage: input.storage,
        projectId: input.input.projectId,
        environmentId: input.input.environmentId,
        release: input.input.release,
        artifactId: randomUUID(),
        content: sourceMap.content
      });
      writtenStoragePaths.push(stored.storagePath);
      storedMaps.push({ sourceMap, stored });
    }

    return await input.db.transaction().execute(async (trx) => {
      const artifacts: SourceMapArtifactRecord[] = [];
      for (const { sourceMap, stored } of storedMaps) {
        const artifact = await createSourceMapArtifact(trx, {
          projectId: input.input.projectId,
          environmentId: input.input.environmentId,
          release: input.input.release,
          minifiedFile: sourceMap.minifiedFile,
          originalFilename: sourceMap.originalFilename,
          contentType: "application/json",
          byteSize: stored.byteSize,
          sha256: stored.sha256,
          storagePath: stored.storagePath,
          ...sourceMapArtifactUploader(input.input)
        });
        artifacts.push(artifact);
      }

      return artifacts;
      });
  } catch (error) {
    await cleanupStoredFiles(input.storage, writtenStoragePaths);
    throw error;
  }
}

export async function deleteSourceMapArtifactAndFile(input: {
  db: Db;
  storage: SourceMapStorageSession;
  input: { id: string; projectId: string; environmentId: string };
}): Promise<void> {
  const artifact = await getSourceMapArtifact(input.db, input.input);
  if (!artifact) {
    return;
  }

  // Keep the DB row active if file deletion fails so the admin delete can be retried coherently.
  await deleteSourceMapFileIfPresent({
    storage: input.storage,
    storagePath: artifact.storagePath
  });

  await deleteSourceMapArtifact(input.db, input.input);
}
