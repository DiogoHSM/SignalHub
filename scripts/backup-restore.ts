import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../packages/config/src/index.js";

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

  const spawnFn = input.spawnFn ?? spawn;
  const databaseUrl = new URL(input.databaseUrl);
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
  const username = decodeURIComponent(databaseUrl.username);
  const password = decodeURIComponent(databaseUrl.password);
  const sanitizedConnectionUrl = new URL(databaseUrl);
  sanitizedConnectionUrl.password = "";
  const databaseArgs = ["--dbname"];

  if (databaseUrl.search !== "") {
    databaseArgs.push(sanitizedConnectionUrl.toString());
  } else {
    databaseArgs.push(databaseName, "--host", databaseUrl.hostname);

    if (databaseUrl.port !== "") {
      databaseArgs.push("--port", databaseUrl.port);
    }

    if (username !== "") {
      databaseArgs.push("--username", username);
    }
  }

  const stdio: ["ignore", "inherit", "pipe"] = ["ignore", "inherit", "pipe"];
  const options: RestoreSpawnOptions =
    password === ""
      ? { stdio }
      : { stdio, env: { ...process.env, PGPASSWORD: password } };

  await new Promise<void>((resolve, reject) => {
    const child = spawnFn(
      "pg_restore",
      [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        ...databaseArgs,
        "--",
        input.filePath
      ],
      options
    );
    const stderrChunks: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(stderr || `pg_restore exited with code ${code}`));
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
