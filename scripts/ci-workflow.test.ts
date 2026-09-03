import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isAlias, isScalar, LineCounter, parse, parseDocument, visit } from "yaml";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const workflowPath = join(repoRoot, ".github", "workflows", "ci.yml");
const publishSdkWorkflowPath = join(repoRoot, ".github", "workflows", "publish-sdk.yml");
const dependabotPath = join(repoRoot, ".github", "dependabot.yml");
const actionRuntimeDocs = [
  join(repoRoot, "README.md"),
  join(repoRoot, ".claude", "docs", "DEPLOYMENT.md")
];

type ActionReference = {
  file: string;
  line: number;
  source: string;
  value: string;
};

function filesRecursively(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(path) : [path];
  });
}

function actionManifestPaths(): string[] {
  const workflows = readdirSync(join(repoRoot, ".github", "workflows"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => join(repoRoot, ".github", "workflows", entry.name));
  const localActions = filesRecursively(join(repoRoot, ".github", "actions"))
    .filter((path) => /^action\.ya?ml$/i.test(basename(path)));
  return [...workflows, ...localActions].sort();
}

function actionReferencesInSource(content: string, path: string): ActionReference[] {
  const lineCounter = new LineCounter();
  const document = parseDocument(content, { lineCounter });
  if (document.errors.length > 0) throw document.errors[0];

  const results: ActionReference[] = [];
  const lines = content.split(/\r?\n/);
  visit(document, {
    Pair(_key, pair) {
      if (resolvedYamlNodeValue(pair.key, document) !== "uses") return;
      const value = resolvedYamlNodeValue(pair.value, document);
      const line = pair.value?.range ? lineCounter.linePos(pair.value.range[0]).line : 1;
      results.push({
        file: path,
        line,
        source: lines[line - 1] ?? "",
        value: typeof value === "string" ? value : ""
      });
    }
  });
  return results;
}

function actionReferences(path: string): ActionReference[] {
  return actionReferencesInSource(readFileSync(path, "utf8"), path);
}

function isLocalAction(value: string): boolean {
  if (!value.startsWith("./") && !value.startsWith("$/.github/")) return false;
  return !value.includes("\\") && !value.includes("@") && !value.includes("${{") &&
    !value.split("/").includes("..");
}

function hasReleaseComment(reference: ActionReference): boolean {
  return /\s+#\s+v\d+(?:\.\d+){0,2}\s*$/.test(reference.source);
}

function isRepositoryShaPin(reference: ActionReference): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[0-9a-f]{40}$/.test(reference.value) &&
    hasReleaseComment(reference);
}

function isDockerDigestPin(value: string): boolean {
  return /^docker:\/\/[A-Za-z0-9][A-Za-z0-9._/:~-]*@sha256:[0-9a-f]{64}$/.test(value);
}

function resolvedYamlNodeValue(node: unknown, document: ReturnType<typeof parseDocument>): unknown {
  const resolved = isAlias(node) ? node.resolve(document) : node;
  return isScalar(resolved) ? resolved.value : resolved;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function permissionSummaryInSource(content: string): { oidcWrites: number; hasWriteAll: boolean } {
  const root = asRecord(parse(content));
  const jobs = asRecord(root?.jobs);
  const permissionScopes = [
    root?.permissions,
    ...Object.values(jobs ?? {}).map((job) => asRecord(job)?.permissions)
  ];
  let oidcWrites = 0;
  let hasWriteAll = false;

  for (const scope of permissionScopes) {
    if (scope === "write-all") hasWriteAll = true;
    if (asRecord(scope)?.["id-token"] === "write") oidcWrites += 1;
  }

  return { oidcWrites, hasWriteAll };
}

function setupNodeCacheDisabledInSource(content: string): boolean {
  const root = asRecord(parse(content));
  const jobs = asRecord(root?.jobs);
  const publishJob = asRecord(jobs?.["publish-sdk"]);
  const steps = Array.isArray(publishJob?.steps) ? publishJob.steps : [];
  const setupNodeSteps = steps
    .map(asRecord)
    .filter((step) => typeof step?.uses === "string" && step.uses.startsWith("actions/setup-node@"));

  return setupNodeSteps.length > 0 && setupNodeSteps.every((step) => {
    const inputs = asRecord(step?.with);
    return inputs?.["package-manager-cache"] === false;
  });
}

function installedNpmVersionsInSource(content: string): string[] {
  const versions = [...content.matchAll(/\bnpm@([^\s;|&]*)/g)].map((match) => {
    const value = match[1];
    return value.length >= 2 && value[0] === value.at(-1) && /["']/.test(value[0])
      ? value.slice(1, -1)
      : value;
  });
  const installAliases = "install|i|add|in|ins|inst|insta|instal|isnt|isnta|isntal|isntall";
  const installCommand = new RegExp(`\\bnpm\\s+(?:${installAliases})\\b([^\\r\\n;&|]*)`, "g");
  for (const match of content.matchAll(installCommand)) {
    if (/(?:^|\s)["']?npm["']?(?=\s|$)/.test(match[1])) versions.push("<unversioned>");
  }
  return versions;
}

function workflow(): string {
  return readFileSync(workflowPath, "utf8");
}

function publishSdkWorkflow(): string {
  return readFileSync(publishSdkWorkflowPath, "utf8");
}

function dependabot(): string {
  return existsSync(dependabotPath) ? readFileSync(dependabotPath, "utf8") : "";
}

function expectIncludesAll(value: string, snippets: string[]) {
  for (const snippet of snippets) {
    expect(value).toContain(snippet);
  }
}

function jobBlock(content: string, jobName: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);

  expect(start, `expected job "${jobName}" to exist`).toBeGreaterThanOrEqual(0);

  const end = lines.findIndex(
    (line, index) => index > start && /^  [\w-]+:$/.test(line)
  );

  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

describe("immutable workflow dependencies", () => {
  it("pins every external action to an immutable digest and keeps repository release context", () => {
    const references = actionManifestPaths().flatMap(actionReferences);
    const invalid = references
      .filter((reference) => !isLocalAction(reference.value))
      .filter((reference) => !isRepositoryShaPin(reference) && !isDockerDigestPin(reference.value))
      .map(({ file, line, value }) => `<repo>/${file.replace(repoRoot, "").replaceAll("\\", "/")}:${line} ${value}`);

    expect(invalid).toEqual([]);
  });

  it("recognizes block, quoted, spaced, flow, local, and Docker uses forms", () => {
    const fixture = [
      "- uses: owner/action@v1",
      "- 'uses' : 'owner/quoted@main'",
      "- { name: Inline, uses: owner/flow@branch }",
      "- uses: ./.github/actions/local",
      "- uses: $/.github/actions/shared",
      `- uses: docker://example/image@sha256:${"a".repeat(64)}`,
      "- uses:"
    ].join("\n");
    const references = actionReferencesInSource(fixture, "fixture.yml");

    expect(references.map(({ value }) => value)).toEqual([
      "owner/action@v1",
      "owner/quoted@main",
      "owner/flow@branch",
      "./.github/actions/local",
      "$/.github/actions/shared",
      `docker://example/image@sha256:${"a".repeat(64)}`,
      ""
    ]);
    expect(references.filter(({ value }) => !isLocalAction(value) && !isDockerDigestPin(value)))
      .toHaveLength(4);
  });

  it("recognizes YAML-decoded and aliased uses keys", () => {
    const fixture = [
      "action-key: &action-key uses",
      "steps:",
      '  - "u\\u0073es": owner/unicode@main',
      "  - ? uses",
      "    : owner/explicit@main",
      "  - ? *action-key",
      "    : owner/alias@main"
    ].join("\n");

    expect(actionReferencesInSource(fixture, "fixture.yml").map(({ value }) => value)).toEqual([
      "owner/unicode@main",
      "owner/explicit@main",
      "owner/alias@main"
    ]);
  });

  it("binds checkout and setup-node pins to the reviewed upstream releases", () => {
    const references = actionManifestPaths().flatMap(actionReferences);
    for (const reference of references.filter(({ value }) => value.startsWith("actions/checkout@"))) {
      expect(reference.value).toBe("actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803");
      expect(reference.source).toMatch(/# v6\.1\.0\s*$/);
    }
    for (const reference of references.filter(({ value }) => value.startsWith("actions/setup-node@"))) {
      expect(reference.value).toBe("actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38");
      expect(reference.source).toMatch(/# v6\.5\.0\s*$/);
    }
  });

  it("grants OIDC only to the publish-sdk job and never through write-all", () => {
    const manifests = actionManifestPaths().map((path) => ({ path, content: readFileSync(path, "utf8") }));
    const publishContent = publishSdkWorkflow();
    const summaries = manifests.map(({ content }) => permissionSummaryInSource(content));
    const publish = asRecord(parse(publishContent));
    const workflowPermissions = asRecord(publish?.permissions);
    const publishPermissions = asRecord(asRecord(asRecord(publish?.jobs)?.["publish-sdk"])?.permissions);

    expect(summaries.some(({ hasWriteAll }) => hasWriteAll)).toBe(false);
    expect(summaries.reduce((sum, { oidcWrites }) => sum + oidcWrites, 0)).toBe(1);
    expect(workflowPermissions?.["id-token"]).toBeUndefined();
    expect(publishPermissions).toMatchObject({ contents: "read", "id-token": "write" });
  });

  it("interprets escaped and aliased permission values as YAML does", () => {
    const fixture = [
      "permissions:",
      '  "\\u0069d-token": write',
      "jobs:",
      "  unsafe:",
      "    permissions: &all write-all"
    ].join("\n");

    expect(permissionSummaryInSource(fixture)).toEqual({ oidcWrites: 1, hasWriteAll: true });
  });

  it("counts permissions for every resolved job alias", () => {
    const fixture = [
      "jobs:",
      "  publish-sdk: &publish",
      "    permissions: { contents: read, id-token: write }",
      "    runs-on: ubuntu-latest",
      "    steps: []",
      "  attacker: *publish"
    ].join("\n");

    expect(permissionSummaryInSource(fixture)).toEqual({ oidcWrites: 2, hasWriteAll: false });
  });

  it("disables automatic package-manager caching in the publish setup-node step", () => {
    expect(setupNodeCacheDisabledInSource(publishSdkWorkflow())).toBe(true);
  });

  it("does not treat a comment as a disabled setup-node package-manager cache", () => {
    const fixture = [
      "jobs:",
      "  publish-sdk:",
      "    steps:",
      "      - name: Set up Node.js",
      "        uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0",
      "        # package-manager-cache: false"
    ].join("\n");

    expect(setupNodeCacheDisabledInSource(fixture)).toBe(false);
  });

  it("installs only the reviewed exact npm CLI before publishing", () => {
    const installedVersions = installedNpmVersionsInSource(publishSdkWorkflow());

    expect(installedVersions).toEqual(["11.19.1"]);
  });

  it("rejects npm install aliases that select an unreviewed version", () => {
    const fixture = [
      "if false; then npm install -g npm@11.19.1; fi",
      "npm i -g npm@latest"
    ].join("\n");

    expect(installedNpmVersionsInSource(fixture)).toEqual(["11.19.1", "latest"]);
  });

  it("rejects an unversioned npm self-install that implicitly selects latest", () => {
    const fixture = [
      "if false; then",
      "  npm install -g npm@11.19.1",
      "fi",
      "npm i -g npm"
    ].join("\n");

    expect(installedNpmVersionsInSource(fixture)).toEqual(["11.19.1", "<unversioned>"]);
  });

  it("configures weekly reviewed GitHub Actions dependency updates", () => {
    const config = asRecord(parse(dependabot()));
    const updates = Array.isArray(config?.updates) ? config.updates.map(asRecord) : [];
    const update = updates.find((candidate) => candidate?.["package-ecosystem"] === "github-actions");

    expect(config?.version).toBe(2);
    expect(update).toMatchObject({
      directory: "/",
      schedule: { interval: "weekly" },
      "open-pull-requests-limit": 5,
      "commit-message": { prefix: "chore(actions)" }
    });
  });

  it("documents reviewed action releases without recommending mutable executable refs", () => {
    for (const path of actionRuntimeDocs) {
      const content = readFileSync(path, "utf8");
      expect(content).not.toMatch(/actions\/(?:checkout|setup-node)@(?![0-9a-f]{40}\b)[^\s`)]+/);
      expectIncludesAll(content, [
        "actions/checkout v6.1.0",
        "d23441a48e516b6c34aea4fa41551a30e30af803",
        "actions/setup-node v6.5.0",
        "249970729cb0ef3589644e2896645e5dc5ba9c38"
      ]);
    }
  });
});

describe("GitHub Actions CI workflow", () => {
  it("runs automatically on pull requests and pushes to main, and still on demand", () => {
    const content = workflow();

    expectIncludesAll(content, [
      "name: CI",
      "pull_request:",
      "push:",
      "branches: [main]",
      "workflow_dispatch:"
    ]);
  });

  it("cancels a superseded in-flight run for the same ref", () => {
    const content = workflow();

    expectIncludesAll(content, [
      "concurrency:",
      "group: ci-${{ github.ref }}",
      "cancel-in-progress: true"
    ]);
  });

  it("uses read-only repository contents permissions", () => {
    const content = workflow();

    expectIncludesAll(content, ["permissions:", "  contents: read"]);
    expect(content.indexOf("permissions:")).toBeLessThan(
      content.indexOf("jobs:")
    );
  });

  it("uses Node 24 actions, Node 22 app runtime, Corepack, and frozen pnpm installs in every build job", () => {
    const content = workflow();

    for (const jobName of ["test", "build", "compose-config", "smoke-compose"]) {
      expectIncludesAll(jobBlock(content, jobName), [
        "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.1.0",
        "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0",
        "node-version: 22",
        "corepack enable",
        "corepack prepare pnpm@9.15.4 --activate",
        "pnpm install --frozen-lockfile"
      ]);
    }
  });

  it("keeps tests, build, compose config, and smoke as separate jobs", () => {
    const content = workflow();

    expectIncludesAll(jobBlock(content, "test"), ["run: pnpm test"]);
    expectIncludesAll(jobBlock(content, "build"), ["run: pnpm build"]);
    expectIncludesAll(jobBlock(content, "compose-config"), [
      "run: docker compose config --quiet"
    ]);
    expectIncludesAll(jobBlock(content, "smoke-compose"), [
      "run: pnpm smoke:compose --project-name sigmon_ci_smoke --preserve"
    ]);
  });

  it("collects best-effort smoke diagnostics only when the smoke job fails", () => {
    const content = workflow();

    expectIncludesAll(jobBlock(content, "smoke-compose"), [
      "- name: Collect smoke diagnostics",
      "if: failure()",
      "docker compose -p sigmon_ci_smoke ps -a || true",
      "docker compose -p sigmon_ci_smoke logs --no-color || true",
      "docker system df || true"
    ]);

    for (const jobName of ["test", "build", "compose-config"]) {
      expect(jobBlock(content, jobName)).not.toContain(
        "- name: Collect smoke diagnostics"
      );
    }
  });

  it("always cleans up preserved smoke resources after diagnostics", () => {
    const content = workflow();
    const smokeJob = jobBlock(content, "smoke-compose");

    expectIncludesAll(smokeJob, [
      "- name: Cleanup smoke resources",
      "if: always()",
      "run: docker compose -p sigmon_ci_smoke down -v || true"
    ]);
    expect(smokeJob.indexOf("- name: Collect smoke diagnostics")).toBeLessThan(
      smokeJob.indexOf("- name: Cleanup smoke resources")
    );
  });

  // This guard carries more weight now that CI fires on every push to main: a deploy
  // job added here would silently become auto-deploy, which ADR 2026-07-26 forbids.
  //
  // The job list is asserted exhaustively rather than by blocklist. A blocklist only
  // catches the copy-paste vectors (restoring the old EasyPanel job, lifting the
  // sibling project's Coolify one) and walks straight past a job written from
  // scratch — `deploy:` with a neutrally named secret is the obvious thing someone
  // would write. The named-string checks below stay as a message-quality layer:
  // they fail with a recognizable term instead of a bare list diff.
  it("has no hosted deploy job — deploys stay manual through Coolify", () => {
    const content = workflow();

    // Slice from `jobs:` first — the same pattern also matches trigger keys like
    // `pull_request:` and `workflow_dispatch:` under `on:`.
    const jobsSection = content.slice(content.indexOf("\njobs:\n"));
    const jobNames = jobsSection
      .split("\n")
      .filter((line) => /^ {2}[\w-]+:$/.test(line))
      .map((line) => line.trim().slice(0, -1));

    expect(jobNames).toEqual(["test", "build", "compose-config", "smoke-compose"]);

    expect(content).not.toContain("deploy-easypanel:");
    expect(content).not.toContain("EASYPANEL");
    expect(content).not.toContain("COOLIFY");
    expect(content).not.toContain("api/v1/deploy");
  });

  it("publishes the SDK package to public npm only on manual dispatch with Trusted Publishing", () => {
    const content = publishSdkWorkflow();

    expect(content).not.toContain("release:");
    expectIncludesAll(content, [
      "name: Publish SDK",
      "workflow_dispatch:",
      "id-token: write",
      "node-version: 24",
      "registry-url: https://registry.npmjs.org",
      "pnpm --filter @sigmon/sdk build",
      "working-directory: packages/sdk",
      "npm publish --access public"
    ]);
    expect(content).not.toContain("EASYPANEL");
    expect(content).not.toContain("NPM_TOKEN");
  });

  // npm Trusted Publishing (OIDC) requires npm >= 11.5.1. The workflow only pins
  // Node 24, not npm, so a runner image whose bundled npm predates that floor
  // would either fail publish outright or fall back to a token-based flow that
  // the registry now rejects for this package. Upgrading npm before publish,
  // and failing fast with a readable message if that upgrade somehow lands
  // below the floor, turns a cryptic OIDC error into a diagnosable one.
  it("upgrades npm and verifies the Trusted Publishing floor before publishing", () => {
    const content = publishSdkWorkflow();

    expectIncludesAll(content, [
      "Ensure npm supports Trusted Publishing",
      "npm install -g npm@11.19.1",
      "11.5.1"
    ]);

    const upgradeStepIndex = content.indexOf("Ensure npm supports Trusted Publishing");
    const publishStepIndex = content.indexOf("npm publish --access public");

    expect(upgradeStepIndex).toBeGreaterThan(-1);
    expect(upgradeStepIndex).toBeLessThan(publishStepIndex);
  });
});
