import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type StoredArtifact = {
  storagePath: string;
  byteSize: number;
  sha256: string;
};

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "unknown";
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

export async function readSourceMapFile(storagePath: string): Promise<string> {
  return readFile(storagePath, "utf8");
}

export async function deleteSourceMapFile(storagePath: string): Promise<void> {
  await rm(storagePath, { force: false });
}
