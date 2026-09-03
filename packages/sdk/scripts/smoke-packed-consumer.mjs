import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const smokeDir = mkdtempSync(join(tmpdir(), "sigmon-sdk-packed-consumer-"));
const require = createRequire(import.meta.url);
const typescript = require("typescript");

function run(args, cwd) {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/c", "npm", ...args]
    : args;
  return execFileSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function listTypeScriptSources(directory, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listTypeScriptSources(join(directory, entry.name), relativePath));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(relativePath);
    }
  }
  return files;
}

function moduleSpecifierText(expression) {
  let current = expression;
  while (typescript.isParenthesizedExpression(current)) current = current.expression;
  return typescript.isStringLiteralLike(current) ? current.text : undefined;
}

function normalizeCallTarget(expression) {
  let current = expression;
  while (true) {
    if (typescript.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (typescript.isCommaListExpression(current)) {
      current = current.elements[current.elements.length - 1];
      continue;
    }
    if (
      typescript.isBinaryExpression(current) &&
      current.operatorToken.kind === typescript.SyntaxKind.CommaToken
    ) {
      current = current.right;
      continue;
    }
    return current;
  }
}

function isRequireCallTarget(expression) {
  const target = normalizeCallTarget(expression);
  return (
    (typescript.isIdentifier(target) && target.text === "require") ||
    (typescript.isPropertyAccessExpression(target) && target.name.text === "require")
  );
}

function findPrivateRuntimeImport(source, filename) {
  const sourceFile = typescript.createSourceFile(
    filename,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.JS
  );
  let privateImport;

  const visit = (node) => {
    if (privateImport) return;
    let specifier;
    if (
      (typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      specifier = moduleSpecifierText(node.moduleSpecifier);
    } else if (typescript.isCallExpression(node)) {
      const isDynamicImport =
        normalizeCallTarget(node.expression).kind === typescript.SyntaxKind.ImportKeyword;
      const isRequire = isRequireCallTarget(node.expression);
      if ((isDynamicImport || isRequire) && node.arguments[0]) {
        specifier = moduleSpecifierText(node.arguments[0]);
      }
    }

    if (specifier?.startsWith("@sigmon/")) {
      privateImport = specifier;
      return;
    }
    typescript.forEachChild(node, visit);
  };

  visit(sourceFile);
  return privateImport;
}

function assertPackedArtifact(packOutput, tarball) {
  const packFiles = packOutput[0]?.files?.map((file) => file.path).sort();
  if (!packFiles) {
    throw new Error("npm pack did not return a package file manifest");
  }

  const expectedFiles = ["CHANGELOG.md", "LICENSE", "README.md", "package.json"];
  for (const sourceFile of listTypeScriptSources(join(packageDir, "src"))) {
    const basename = sourceFile.slice(0, -3);
    expectedFiles.push(`dist/${basename}.d.ts`, `dist/${basename}.js`, `dist/${basename}.js.map`);
  }
  expectedFiles.sort();

  const unexpectedFiles = packFiles.filter((file) => !expectedFiles.includes(file));
  if (unexpectedFiles.includes("dist/obsolete-from-previous-build.js")) {
    throw new Error("packed SDK contains stale artifact dist/obsolete-from-previous-build.js");
  }
  if (unexpectedFiles.length > 0) {
    throw new Error(`packed SDK contains unexpected files: ${unexpectedFiles.join(", ")}`);
  }
  const missingFiles = expectedFiles.filter((file) => !packFiles.includes(file));
  if (missingFiles.length > 0) {
    throw new Error(`packed SDK is missing expected files: ${missingFiles.join(", ")}`);
  }

  const inspectionDir = join(smokeDir, "packed");
  mkdirSync(inspectionDir, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", inspectionDir], { stdio: ["ignore", "pipe", "pipe"] });
  const packedRoot = join(inspectionDir, "package");
  const manifest = JSON.parse(readFileSync(join(packedRoot, "package.json"), "utf8"));

  const runtimeDependencySections = ["dependencies", "optionalDependencies", "peerDependencies"];
  for (const section of runtimeDependencySections) {
    for (const [dependency, specifier] of Object.entries(manifest[section] ?? {})) {
      const aliasedPrivateDependency =
        typeof specifier === "string" && /^(?:npm:)?@sigmon\//.test(specifier);
      if (dependency.startsWith("@sigmon/") || aliasedPrivateDependency) {
        throw new Error(
          `packed SDK retains private runtime dependency ${dependency} -> ${String(specifier)} in ${section}`
        );
      }
    }
  }

  const exportedTargets = [manifest.main, manifest.types];
  const collectExportTargets = (value) => {
    if (typeof value === "string") {
      exportedTargets.push(value);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const nested of Object.values(value)) collectExportTargets(nested);
  };
  collectExportTargets(manifest.exports);
  for (const target of new Set(exportedTargets.filter((value) => typeof value === "string"))) {
    const normalizedTarget = target.replace(/^\.\//, "");
    if (!packFiles.includes(normalizedTarget)) {
      throw new Error(`packed SDK manifest target is missing: ${target}`);
    }
  }

  for (const file of packFiles.filter((path) => path.startsWith("dist/") && path.endsWith(".js"))) {
    const source = readFileSync(join(packedRoot, file), "utf8");
    const privateImport = findPrivateRuntimeImport(source, file);
    if (privateImport) {
      throw new Error(`packed SDK JavaScript retains a runtime import of private ${privateImport}`);
    }
  }

  return manifest;
}

try {
  const packOutput = JSON.parse(run(["pack", "--json", "--pack-destination", smokeDir], packageDir));
  const tarball = join(smokeDir, packOutput[0].filename);
  const manifest = assertPackedArtifact(packOutput, tarball);
  const consumerDir = join(smokeDir, "consumer");
  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify({ name: "sigmon-sdk-packed-consumer", private: true, type: "module" }),
  );

  run(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], consumerDir);

  const installedManifest = JSON.parse(
    readFileSync(join(consumerDir, "node_modules", "@sigmon", "sdk", "package.json"), "utf8")
  );
  if (installedManifest.name !== manifest.name || installedManifest.version !== manifest.version) {
    throw new Error("installed SDK manifest does not match the inspected tarball");
  }

  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { createFeedbackSignal, createSignalMonitorClient } from "@sigmon/sdk";
       const signal = createFeedbackSignal({
         message: "packed consumer",
         pageUrl: "https://app.test/reset?token=secret#fragment"
       });
       if (signal.payload.page_url !== "https://app.test/reset?token=%5BREDACTED%5D") {
         throw new Error("packed SDK did not execute authoritative URL sanitization");
       }
       const client = createSignalMonitorClient({
         endpoint: "https://ingest.test",
         apiKey: "sh_test_packed",
         fetch: async () => new Response(null, { status: 202 })
       });
       if (typeof client.feedback !== "function") throw new Error("normal SDK client path did not load");`,
    ],
    { cwd: consumerDir, stdio: "inherit" },
  );

  console.log("packed SDK clean-consumer smoke passed");
} finally {
  if (process.env.SIGMON_KEEP_PACKED_SMOKE !== "1") {
    rmSync(smokeDir, { recursive: true, force: true });
  } else {
    console.log(`packed SDK smoke directory retained at ${smokeDir}`);
  }
}
