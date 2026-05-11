import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

function validateStoragePath({ localDir, storagePath }: StoredArtifactPathInput): string {
  const resolvedLocalDir = path.resolve(localDir);
  const resolvedStoragePath = path.resolve(storagePath);
  const relativePath = path.relative(resolvedLocalDir, resolvedStoragePath);

  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error("source_map_storage_path_invalid");
  }

  return resolvedStoragePath;
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
  return readFile(validateStoragePath(input), "utf8");
}

export async function deleteSourceMapFile(input: StoredArtifactPathInput): Promise<void> {
  await rm(validateStoragePath(input), { force: false });
}
