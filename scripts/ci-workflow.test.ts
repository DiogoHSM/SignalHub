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

  it("deploys only repository-built EasyPanel app services from main pushes", () => {
    const deployJob = jobBlock(workflow(), "deploy-easypanel");

    expectIncludesAll(deployJob, [
      "needs: [test, build, compose-config, smoke-compose]",
      "if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
      "EASYPANEL_API_DEPLOY_URL: ${{ secrets.EASYPANEL_API_DEPLOY_URL || secrets.EASYPANEL_DEPLOY_URL }}",
      "EASYPANEL_WORKER_DEPLOY_URL: ${{ secrets.EASYPANEL_WORKER_DEPLOY_URL }}",
      "EASYPANEL_SCHEDULER_DEPLOY_URL: ${{ secrets.EASYPANEL_SCHEDULER_DEPLOY_URL }}",
      "trigger_deploy \"API\" \"${EASYPANEL_API_DEPLOY_URL}\"",
      "trigger_deploy \"worker\" \"${EASYPANEL_WORKER_DEPLOY_URL}\"",
      "trigger_deploy \"scheduler\" \"${EASYPANEL_SCHEDULER_DEPLOY_URL}\"",
      "--retry-all-errors",
      "grep -qi \"Deploying\"",
      "deploy hook started but reset the connection after responding"
    ]);
    expect(deployJob).not.toContain("POSTGRES_DEPLOY_URL");
    expect(deployJob).not.toContain("REDIS_DEPLOY_URL");
  });
});
