import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/ci.yml";
const publishSdkWorkflowPath = ".github/workflows/publish-sdk.yml";

function workflow(): string {
  return readFileSync(workflowPath, "utf8");
}

function publishSdkWorkflow(): string {
  return readFileSync(publishSdkWorkflowPath, "utf8");
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
        "actions/checkout@v6",
        "actions/setup-node@v6",
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
});
