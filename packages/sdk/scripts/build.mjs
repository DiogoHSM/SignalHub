import { spawnSync } from "node:child_process";
import { rmSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(packageDir, "dist");
const stagingDir = join(packageDir, ".dist-staging");
const require = createRequire(import.meta.url);

function removeBuildTrees() {
  const errors = [];
  for (const target of [stagingDir, distDir]) {
    try {
      rmSync(target, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Could not clean SDK build directories");
  }
}

function compile(configFile) {
  const typescriptCli = require.resolve("typescript/bin/tsc");
  const result = spawnSync(
    process.execPath,
    [typescriptCli, "-p", configFile, "--outDir", stagingDir],
    { cwd: packageDir, stdio: "inherit" }
  );

  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    throw new Error(`TypeScript ${configFile} build terminated by signal ${result.signal}`);
  }
  if (result.status !== 0) {
    throw new Error(`TypeScript ${configFile} build exited with status ${String(result.status)}`);
  }
}

try {
  removeBuildTrees();
  compile("tsconfig.build.json");
  compile("tsconfig.url-sanitization.json");
  renameSync(stagingDir, distDir);
} catch (error) {
  try {
    removeBuildTrees();
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      "SDK build failed and cleanup was incomplete",
      { cause: error }
    );
  }
  throw error;
}
