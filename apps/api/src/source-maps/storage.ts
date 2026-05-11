import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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
