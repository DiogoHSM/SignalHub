import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import path from "node:path";

export const SOURCE_MAP_STORAGE_MARKER_NAME = ".sigmon-source-map-storage";
export const SOURCE_MAP_STORAGE_MARKER_CONTENT = "sigmon-source-map-storage-v1\n";

export type SourceMapStorageRootMode = "create" | "require";

export class SourceMapStorageRootError extends Error {
  constructor(cause?: unknown) {
    super("source_map_storage_unavailable", cause === undefined ? undefined : { cause });
    this.name = "SourceMapStorageRootError";
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function unavailable(cause?: unknown): SourceMapStorageRootError {
  return cause instanceof SourceMapStorageRootError ? cause : new SourceMapStorageRootError(cause);
}

export function assertInsideSourceMapStorageRoot(canonicalRoot: string, candidatePath: string): void {
  const relativePath = path.relative(canonicalRoot, candidatePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("source_map_storage_path_invalid");
  }
}

export async function ensureSourceMapArtifactDirectory(
  canonicalRoot: string,
  segments: string[]
): Promise<string> {
  let currentPath = canonicalRoot;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    assertInsideSourceMapStorageRoot(canonicalRoot, currentPath);
    try {
      await mkdir(currentPath, { mode: 0o700 });
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) {
        throw error;
      }
    }

    const stats = await lstat(currentPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("source_map_storage_path_invalid");
    }
    const canonicalDirectory = await realpath(currentPath);
    assertInsideSourceMapStorageRoot(canonicalRoot, canonicalDirectory);
  }
  return currentPath;
}

export async function resolveSourceMapArtifactPath(
  canonicalRoot: string,
  storagePath: string,
  options: { allowMissing: boolean }
): Promise<string | null> {
  const candidatePath = path.resolve(storagePath);
  assertInsideSourceMapStorageRoot(canonicalRoot, candidatePath);
  const relativePath = path.relative(canonicalRoot, candidatePath);
  const segments = relativePath.split(path.sep).filter(Boolean);
  let currentPath = canonicalRoot;

  for (let index = 0; index < segments.length; index += 1) {
    currentPath = path.join(currentPath, segments[index]);
    let stats;
    try {
      stats = await lstat(currentPath);
    } catch (error) {
      if (options.allowMissing && isErrorCode(error, "ENOENT")) {
        return null;
      }
      throw error;
    }

    if (stats.isSymbolicLink()) {
      throw new Error("source_map_storage_path_invalid");
    }
    const finalSegment = index === segments.length - 1;
    if (finalSegment ? !stats.isFile() : !stats.isDirectory()) {
      throw new Error("source_map_storage_path_invalid");
    }
  }

  const canonicalArtifact = await realpath(candidatePath);
  assertInsideSourceMapStorageRoot(canonicalRoot, canonicalArtifact);
  return canonicalArtifact;
}

async function validateMarker(canonicalRoot: string): Promise<void> {
  const markerPath = path.join(canonicalRoot, SOURCE_MAP_STORAGE_MARKER_NAME);
  const before = await lstat(markerPath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw unavailable();
  }

  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(markerPath, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw unavailable();
    }

    const content = await handle.readFile();
    if (!content.equals(Buffer.from(SOURCE_MAP_STORAGE_MARKER_CONTENT))) {
      throw unavailable();
    }
  } finally {
    await handle.close();
  }
}

async function createMarkerExclusively(canonicalRoot: string): Promise<void> {
  const markerPath = path.join(canonicalRoot, SOURCE_MAP_STORAGE_MARKER_NAME);
  const tempPath = path.join(canonicalRoot, `${SOURCE_MAP_STORAGE_MARKER_NAME}.${randomUUID()}.tmp`);
  try {
    const handle = await open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(SOURCE_MAP_STORAGE_MARKER_CONTENT);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await link(tempPath, markerPath);
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) {
        throw error;
      }
    }
  } finally {
    await rm(tempPath, { force: true });
  }
}

export async function assertSourceMapStorageRoot(
  localDir: string,
  mode: SourceMapStorageRootMode
): Promise<string> {
  try {
    if (mode === "create") {
      await mkdir(localDir, { recursive: true, mode: 0o700 });
    }

    const rootStats = await lstat(localDir);
    if (!rootStats.isDirectory() && !rootStats.isSymbolicLink()) {
      throw unavailable();
    }

    const canonicalRoot = await realpath(localDir);
    const canonicalStats = await lstat(canonicalRoot);
    if (canonicalStats.isSymbolicLink() || !canonicalStats.isDirectory()) {
      throw unavailable();
    }

    if (mode === "create") {
      try {
        await validateMarker(canonicalRoot);
      } catch (error) {
        if (!isErrorCode((error as Error & { cause?: unknown }).cause, "ENOENT") && !isErrorCode(error, "ENOENT")) {
          throw error;
        }
        await createMarkerExclusively(canonicalRoot);
      }
    }

    await validateMarker(canonicalRoot);
    return canonicalRoot;
  } catch (error) {
    throw unavailable(error);
  }
}

export async function listenAfterSourceMapStorage<T>(input: {
  localDir: string;
  initialize?: (localDir: string, mode: SourceMapStorageRootMode) => Promise<unknown>;
  listen: () => Promise<T>;
}): Promise<T> {
  await (input.initialize ?? assertSourceMapStorageRoot)(input.localDir, "create");
  return input.listen();
}
