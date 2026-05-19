import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/ci.yml";

function workflow(): string {
  return readFileSync(workflowPath, "utf8");
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
  it("runs for pull requests, main pushes, and manual dispatch", () => {
    const content = workflow();

    expectIncludesAll(content, [
      "name: CI",
      "pull_request:",
      "branches: [main]",
      "push:",
      "workflow_dispatch:"
    ]);
  });

  it("uses read-only repository contents permissions", () => {
    const content = workflow();

    expectIncludesAll(content, ["permissions:", "  contents: read"]);
    expect(content.indexOf("permissions:")).toBeLessThan(
      content.indexOf("jobs:")
    );
  });

  it("uses Node 22, Corepack, and frozen pnpm installs in every job", () => {
    const content = workflow();

    for (const jobName of ["test", "build", "compose-config", "smoke-compose"]) {
      expectIncludesAll(jobBlock(content, jobName), [
        "actions/setup-node@v4",
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
});
