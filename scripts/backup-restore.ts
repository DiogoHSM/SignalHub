import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../packages/config/src/index.js";

export function parseRestoreArgs(argv: string[]): { filePath: string } {
  const args = argv.slice(2);
  const filePath = args.find((arg) => arg !== "--yes");

  if (!filePath) {
    throw new Error("Usage: pnpm backup:restore -- <file> --yes");
  }

  if (!args.includes("--yes")) {
    throw new Error("Restore requires --yes");
  }

  return { filePath };
}

export async function restoreBackup(input: { databaseUrl: string; filePath: string }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pg_restore",
      [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        input.databaseUrl,
        input.filePath
      ],
      { stdio: ["ignore", "inherit", "pipe"] }
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
