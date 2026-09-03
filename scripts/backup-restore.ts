import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../packages/config/src/index.js";
import { buildLibpqSubprocess } from "../apps/worker/src/libpq-subprocess.js";

type RestoreSpawnOptions = { stdio: ["ignore", "inherit", "pipe"]; env?: NodeJS.ProcessEnv };
type RestoreChildProcess = ChildProcessByStdio<null, null, Readable>;
type RestoreSpawnFn = (
  command: string,
  args: string[],
  options: RestoreSpawnOptions
) => RestoreChildProcess;

export function parseRestoreArgs(argv: string[]): { filePath: string } {
  const args = argv.slice(2);
  const filePaths: string[] = [];
  let hasYes = false;

  for (const arg of args) {
    if (arg === "--yes") {
      hasYes = true;
    } else if (arg === "--") {
      continue;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown restore option: ${arg}`);
    } else {
      filePaths.push(arg);
    }
  }

  if (filePaths.length === 0) {
    throw new Error("Usage: pnpm backup:restore -- <file> --yes");
  }

  if (!hasYes) {
    throw new Error("Restore requires --yes");
  }

  if (filePaths.length !== 1) {
    throw new Error("Restore accepts exactly one file path");
  }

  return { filePath: filePaths[0] };
}

async function calculateFileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

export async function verifyBackupChecksum(filePath: string): Promise<void> {
  let sidecar: string;

  try {
    sidecar = await readFile(`${filePath}.sha256`, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  const expectedChecksum = sidecar.trim().split(/\s+/, 1)[0];
  const actualChecksum = await calculateFileSha256(filePath);

  if (!expectedChecksum || actualChecksum !== expectedChecksum) {
    throw new Error("Backup checksum mismatch");
  }
}

export async function restoreBackup(input: {
  databaseUrl: string;
  filePath: string;
  spawnFn?: RestoreSpawnFn;
}): Promise<void> {
  await verifyBackupChecksum(input.filePath);

  const spawnFn: RestoreSpawnFn = input.spawnFn ?? spawn;
  const connection = buildLibpqSubprocess(input.databaseUrl);

  const stdio: ["ignore", "inherit", "pipe"] = ["ignore", "inherit", "pipe"];
  const options: RestoreSpawnOptions = { stdio, env: connection.env };

  await new Promise<void>((resolve, reject) => {
    let child: RestoreChildProcess;
    try {
      child = spawnFn(
        "pg_restore",
        [
          "--clean",
          "--if-exists",
          "--no-owner",
          "--no-privileges",
          "--no-password",
          "--dbname",
          connection.argsConnection,
          "--",
          input.filePath
        ],
        options
      );
    } catch {
      reject(new Error("pg_restore failed"));
      return;
    }

    child.stderr.on("data", () => undefined);
    child.on("error", () => reject(new Error("pg_restore failed")));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error("pg_restore failed"));
    });
  });
}

export async function main(argv = process.argv): Promise<void> {
  const { filePath } = parseRestoreArgs(argv);
  const config = loadConfig();

  await restoreBackup({ databaseUrl: config.databaseUrl, filePath });
  console.log("Backup restored");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exitCode = 1;
  }
}
