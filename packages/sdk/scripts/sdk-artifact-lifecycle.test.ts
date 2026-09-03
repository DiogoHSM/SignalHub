import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageDir, "../..");
const temporaryRoots: string[] = [];

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function run(command: string, args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill(), 120_000);
    let settled = false;
    function finish(result: CommandResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult(result);
    }
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ status: null, stdout, stderr: `${stderr}\n${String(error)}` }));
    child.on("close", (status) => {
      finish({ status, stdout, stderr });
    });
  });
}

function runNpm(args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<CommandResult> {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const commandArgs = process.platform === "win32" ? ["/d", "/c", "npm", ...args] : args;
  return run(command, commandArgs, cwd, {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_ignore_scripts: "false",
      ...extraEnv
  });
}

function runNode(script: string, cwd: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<CommandResult> {
  return run(process.execPath, [script], cwd, extraEnv);
}

function expectSuccess(result: CommandResult): void {
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

function createIsolatedPackage(): { root: string; sdk: string } {
  const root = mkdtempSync(join(repositoryRoot, ".superpowers", "sdk-artifact-test-"));
  const sdk = join(root, "packages", "sdk");
  const telemetry = join(root, "packages", "telemetry", "src");
  temporaryRoots.push(root);

  mkdirSync(sdk, { recursive: true });
  for (const name of [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "package.json",
    "tsconfig.build.json",
    "tsconfig.json",
    "tsconfig.url-sanitization.json"
  ]) {
    cpSync(join(packageDir, name), join(sdk, name));
  }
  cpSync(join(packageDir, "src"), join(sdk, "src"), { recursive: true });
  cpSync(join(packageDir, "scripts"), join(sdk, "scripts"), { recursive: true });

  cpSync(join(repositoryRoot, "packages", "telemetry", "src"), telemetry, { recursive: true });
  cpSync(
    join(repositoryRoot, "packages", "telemetry", "package.json"),
    join(root, "packages", "telemetry", "package.json")
  );
  const scopeDir = join(sdk, "node_modules", "@sigmon");
  mkdirSync(scopeDir, { recursive: true });
  symlinkSync(
    join(root, "packages", "telemetry"),
    join(scopeDir, "telemetry"),
    process.platform === "win32" ? "junction" : "dir"
  );
  cpSync(join(repositoryRoot, "tsconfig.base.json"), join(root, "tsconfig.base.json"));
  return { root, sdk };
}

function packageFilePaths(packOutput: string): string[] {
  const parsed = JSON.parse(packOutput) as Array<{ files: Array<{ path: string }> }>;
  return parsed[0]?.files.map((file) => file.path) ?? [];
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe.sequential("SDK artifact lifecycle", () => {
  it("captures a failed executable launch as diagnostics", async () => {
    const result = await run(join(repositoryRoot, "missing-sdk-artifact-executable"), [], repositoryRoot);

    expect(result.status).toBeNull();
    expect(result.stderr).toMatch(/ENOENT|not found/i);
  });

  it("removes files left in dist by a previous successful build", async () => {
    const { sdk } = createIsolatedPackage();
    const sentinel = join(sdk, "dist", "obsolete-from-previous-build.js");
    mkdirSync(dirname(sentinel), { recursive: true });
    writeFileSync(sentinel, "throw new Error('stale artifact');\n");

    const result = await runNpm(["run", "build"], sdk);

    expectSuccess(result);
    expect(existsSync(sentinel)).toBe(false);
    expect(existsSync(join(sdk, "dist", "index.js"))).toBe(true);
    expect(existsSync(join(sdk, "dist", "index.d.ts"))).toBe(true);
  }, 120_000);

  it("runs the clean build lifecycle before a direct dry-run pack", async () => {
    const { sdk } = createIsolatedPackage();
    expectSuccess(await runNpm(["run", "build"], sdk));
    const sentinel = join(sdk, "dist", "obsolete-from-previous-build.js");
    writeFileSync(sentinel, "throw new Error('stale artifact');\n");

    const result = await runNpm(["pack", "--dry-run", "--json"], sdk);

    expectSuccess(result);
    const files = packageFilePaths(result.stdout);
    expect(files).toContain("dist/index.js");
    expect(files).toContain("dist/index.d.ts");
    expect(files).not.toContain("dist/obsolete-from-previous-build.js");
    expect(existsSync(sentinel)).toBe(false);
  }, 120_000);

  it("removes partial artifacts after the second compiler pass fails and requires a fresh pack build", async () => {
    const { sdk } = createIsolatedPackage();
    expectSuccess(await runNpm(["run", "build"], sdk));
    const urlConfigPath = join(sdk, "tsconfig.url-sanitization.json");
    const validUrlConfig = readFileSync(urlConfigPath, "utf8");
    writeFileSync(
      urlConfigPath,
      JSON.stringify({
        extends: "../../tsconfig.base.json",
        compilerOptions: { rootDir: "../telemetry/src", outDir: "dist" },
        files: ["../telemetry/src/missing-second-pass-input.ts"]
      })
    );

    const failedBuild = await runNpm(["run", "build"], sdk);

    expect(failedBuild.status, `${failedBuild.stdout}\n${failedBuild.stderr}`).not.toBe(0);
    expect(existsSync(join(sdk, "dist"))).toBe(false);
    expect(existsSync(join(sdk, ".dist-staging"))).toBe(false);

    const failedPack = await runNpm(["pack", "--dry-run", "--json"], sdk);
    expect(failedPack.status, `${failedPack.stdout}\n${failedPack.stderr}`).not.toBe(0);
    expect(existsSync(join(sdk, "dist"))).toBe(false);
    expect(existsSync(join(sdk, ".dist-staging"))).toBe(false);

    writeFileSync(urlConfigPath, validUrlConfig);
    const recoveredPack = await runNpm(["pack", "--dry-run", "--json"], sdk);
    expectSuccess(recoveredPack);
    expect(packageFilePaths(recoveredPack.stdout)).toContain("dist/index.js");
  }, 120_000);

  it("rejects a stale sentinel in the pack manifest before consumer installation", async () => {
    const { sdk } = createIsolatedPackage();
    const manifestPath = join(sdk, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { scripts: Record<string, string> };
    delete manifest.scripts.prepack;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expectSuccess(await runNpm(["run", "build"], sdk));
    writeFileSync(join(sdk, "dist", "obsolete-from-previous-build.js"), "export const stale = true;\n");

    const result = await runNode(join("scripts", "smoke-packed-consumer.mjs"), sdk, {
      npm_config_registry: "http://127.0.0.1:1",
      npm_config_fetch_retries: "0",
      npm_config_fetch_timeout: "1000"
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "packed SDK contains stale artifact dist/obsolete-from-previous-build.js"
    );
  }, 120_000);

  it("rejects an aliased private workspace runtime dependency before consumer installation", async () => {
    const { sdk } = createIsolatedPackage();
    const manifestPath = join(sdk, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      dependencies: Record<string, string>;
    };
    manifest.dependencies["runtime-alias"] = "npm:@sigmon/private-runtime@1.0.0";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = await runNode(join("scripts", "smoke-packed-consumer.mjs"), sdk, {
      npm_config_registry: "http://127.0.0.1:1",
      npm_config_fetch_retries: "0",
      npm_config_fetch_timeout: "1000"
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "packed SDK retains private runtime dependency runtime-alias -> npm:@sigmon/private-runtime@1.0.0 in dependencies"
    );
  }, 120_000);

  it("rejects private workspace imports in packed JavaScript before consumer installation", async () => {
    const { sdk } = createIsolatedPackage();
    mkdirSync(join(sdk, "src", "internal"), { recursive: true });
    writeFileSync(
      join(sdk, "src", "internal", "private-runtime-probe.ts"),
      'import "@sigmon/private-runtime";\nexport const privateRuntimeProbe = true;\n'
    );
    writeFileSync(
      join(sdk, "src", "index.ts"),
      `${readFileSync(join(sdk, "src", "index.ts"), "utf8")}\nexport { privateRuntimeProbe } from "./internal/private-runtime-probe.js";\n`
    );

    const result = await runNode(join("scripts", "smoke-packed-consumer.mjs"), sdk, {
      npm_config_registry: "http://127.0.0.1:1",
      npm_config_fetch_retries: "0",
      npm_config_fetch_timeout: "1000"
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "packed SDK JavaScript retains a runtime import of private @sigmon/private-runtime"
    );
  }, 120_000);

  it.each([
    ["comment-separated static import", 'import /* preserved comment */ "@sigmon/comment-static";', "@sigmon/comment-static"],
    [
      "dynamic import attributes",
      'export const probe = () => import("@sigmon/import-attributes", { with: { type: "json" } });',
      "@sigmon/import-attributes"
    ],
    [
      "dynamic import with a literal template",
      "export const probe = () => import(`@sigmon/template-import`);",
      "@sigmon/template-import"
    ],
    [
      "comment-separated require",
      'export const probe = require /* preserved comment */("@sigmon/comment-require");',
      "@sigmon/comment-require"
    ],
    [
      "require with a literal template",
      "export const probe = require(`@sigmon/template-require`);",
      "@sigmon/template-require"
    ],
    [
      "parenthesized require",
      'export const probe = (require)("@sigmon/parenthesized-require");',
      "@sigmon/parenthesized-require"
    ],
    [
      "comma-expression require",
      'export const probe = (0, require)("@sigmon/comma-require");',
      "@sigmon/comma-require"
    ],
    [
      "direct module.require",
      'export const probe = module.require("@sigmon/module-require");',
      "@sigmon/module-require"
    ]
  ])("rejects %s", async (_form, statement, expectedSpecifier) => {
    const { sdk } = createIsolatedPackage();
    const manifestPath = join(sdk, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { scripts: Record<string, string> };
    delete manifest.scripts.prepack;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expectSuccess(await runNpm(["run", "build"], sdk));
    const packedIndexPath = join(sdk, "dist", "index.js");
    writeFileSync(packedIndexPath, `${readFileSync(packedIndexPath, "utf8")}\n${statement}\n`);

    const result = await runNode(join("scripts", "smoke-packed-consumer.mjs"), sdk, {
      npm_config_registry: "http://127.0.0.1:1",
      npm_config_fetch_retries: "0",
      npm_config_fetch_timeout: "1000"
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      `packed SDK JavaScript retains a runtime import of private ${expectedSpecifier}`
    );
  }, 120_000);

  it("allows private import text that appears only in comments and ordinary strings", async () => {
    const { sdk } = createIsolatedPackage();
    const manifestPath = join(sdk, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { scripts: Record<string, string> };
    delete manifest.scripts.prepack;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expectSuccess(await runNpm(["run", "build"], sdk));
    const packedIndexPath = join(sdk, "dist", "index.js");
    writeFileSync(
      packedIndexPath,
      `${readFileSync(packedIndexPath, "utf8")}
// import("@sigmon/comment-only")
const importDocumentation = 'import("@sigmon/string-only")';
const requireDocumentation = \`require("@sigmon/template-text-only")\`;
void importDocumentation;
void requireDocumentation;
`
    );

    const result = await runNode(join("scripts", "smoke-packed-consumer.mjs"), sdk);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("packed SDK clean-consumer smoke passed");
  }, 120_000);
});
