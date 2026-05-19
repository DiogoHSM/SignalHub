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
      "run: pnpm smoke:compose --project-name signalhub_ci_smoke"
    ]);
  });

  it("collects best-effort smoke diagnostics only when the smoke job fails", () => {
    const content = workflow();

    expectIncludesAll(jobBlock(content, "smoke-compose"), [
      "if: failure()",
      "docker compose -p signalhub_ci_smoke ps -a || true",
      "docker compose -p signalhub_ci_smoke logs --no-color || true",
      "docker system df || true"
    ]);
  });
});
