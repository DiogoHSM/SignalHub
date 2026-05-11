import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "@signal-hub/db";
import {
  createSourceMapArtifact,
  deleteSourceMapArtifact,
  type SourceMapArtifactRecord
} from "@signal-hub/db/repositories/source-maps.js";
import type { SourceMapBundleUploadInput, SourceMapUploadInput } from "../routes/admin.js";
import { extractSourceMapsFromZip, inferMinifiedFileFromMap, parseSourceMapJson } from "./parser.js";

export type StoredArtifact = {
  storagePath: string;
  byteSize: number;
  sha256: string;
};

type StoredArtifactPathInput = {
  localDir: string;
  storagePath: string;
};

function safeSegment(value: string): string {
  const segment = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
  return segment && !/^\.+$/.test(segment) ? segment : "unknown";
}

function assertInsideLocalDir(localDir: string, storagePath: string): void {
  const relativePath = path.relative(localDir, storagePath);

  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error("source_map_storage_path_invalid");
  }
}

async function validateStoragePath({ localDir, storagePath }: StoredArtifactPathInput): Promise<string> {
  const resolvedLocalDir = await realpath(localDir);
  const resolvedStoragePath = path.resolve(storagePath);
  assertInsideLocalDir(resolvedLocalDir, resolvedStoragePath);

  const targetStats = await lstat(resolvedStoragePath);
  if (targetStats.isSymbolicLink()) {
    throw new Error("source_map_storage_path_invalid");
  }

  const realStoragePath = await realpath(resolvedStoragePath);
  assertInsideLocalDir(resolvedLocalDir, realStoragePath);

  return realStoragePath;
}

export async function storeSourceMapFile(input: {
  localDir: string;
  projectId: string;
  environmentId: string;
  release: string;
  artifactId: string;
  content: Buffer;
}): Promise<StoredArtifact> {
  const directory = path.join(
    input.localDir,
    safeSegment(input.projectId),
    safeSegment(input.environmentId),
    safeSegment(input.release)
  );
  await mkdir(directory, { recursive: true });

  const storagePath = path.join(directory, `${safeSegment(input.artifactId)}.map`);
  await writeFile(storagePath, input.content, { flag: "wx" });

  return {
    storagePath,
    byteSize: input.content.byteLength,
    sha256: createHash("sha256").update(input.content).digest("hex")
  };
}

export async function readSourceMapFile(input: StoredArtifactPathInput): Promise<string> {
  return readFile(await validateStoragePath(input), "utf8");
}

export async function deleteSourceMapFile(input: StoredArtifactPathInput): Promise<void> {
  await rm(await validateStoragePath(input), { force: false });
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

async function cleanupStoredFiles(localDir: string, storagePaths: string[]): Promise<void> {
  await Promise.allSettled(storagePaths.map((storagePath) => deleteSourceMapFileIfPresent({ localDir, storagePath })));
}

export async function uploadSingleSourceMap(input: {
  db: Db;
  localDir: string;
  input: SourceMapUploadInput;
}): Promise<SourceMapArtifactRecord[]> {
  const map = parseSourceMapJson(input.input.content.toString("utf8"));
  const minifiedFile = input.input.minifiedFile || inferMinifiedFileFromMap(map);
  if (!minifiedFile) {
    throw new Error("source_map_file_missing");
  }

  const stored = await storeSourceMapFile({
    localDir: input.localDir,
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
      uploadedByUserId: input.input.uploadedByUserId
    });

    return [artifact];
  } catch (error) {
    await cleanupStoredFiles(input.localDir, [stored.storagePath]);
    throw error;
  }
}

export async function uploadSourceMapBundle(input: {
  db: Db;
  localDir: string;
  input: SourceMapBundleUploadInput;
}): Promise<SourceMapArtifactRecord[]> {
  const sourceMaps = extractSourceMapsFromZip(input.input.content);
  const artifacts: SourceMapArtifactRecord[] = [];
  const writtenStoragePaths: string[] = [];

  try {
    for (const sourceMap of sourceMaps) {
      const stored = await storeSourceMapFile({
        localDir: input.localDir,
        projectId: input.input.projectId,
        environmentId: input.input.environmentId,
        release: input.input.release,
        artifactId: randomUUID(),
        content: sourceMap.content
      });
      writtenStoragePaths.push(stored.storagePath);

      const artifact = await createSourceMapArtifact(input.db, {
        projectId: input.input.projectId,
        environmentId: input.input.environmentId,
        release: input.input.release,
        minifiedFile: sourceMap.minifiedFile,
        originalFilename: sourceMap.originalFilename,
        contentType: "application/json",
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        storagePath: stored.storagePath,
        uploadedByUserId: input.input.uploadedByUserId
      });
      artifacts.push(artifact);
    }
  } catch (error) {
    await cleanupStoredFiles(input.localDir, writtenStoragePaths);
    throw error;
  }

  return artifacts;
}

export async function deleteSourceMapArtifactAndFile(input: {
  db: Db;
  localDir: string;
  input: { id: string; projectId: string; environmentId: string };
}): Promise<void> {
  const artifact = await deleteSourceMapArtifact(input.db, input.input);
  if (!artifact) {
    return;
  }

  // Admin deletes are idempotent at the file layer: metadata is already soft-deleted, so a missing local file
  // should not make repeat cleanup fail.
  await deleteSourceMapFileIfPresent({
    localDir: input.localDir,
    storagePath: artifact.storagePath
  });
}
