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

    expect(content.match(/actions\/setup-node@v4/g)).toHaveLength(4);
    expect(content.match(/node-version: 22/g)).toHaveLength(4);
    expect(content.match(/corepack enable/g)).toHaveLength(4);
    expect(content.match(/corepack prepare pnpm@9\.15\.4 --activate/g)).toHaveLength(4);
    expect(content.match(/pnpm install --frozen-lockfile/g)).toHaveLength(4);
  });

  it("keeps tests, build, compose config, and smoke as separate jobs", () => {
    const content = workflow();

    expectIncludesAll(content, [
      "test:",
      "build:",
      "compose-config:",
      "smoke-compose:",
      "run: pnpm test",
      "run: pnpm build",
      "run: docker compose config --quiet",
      "run: pnpm smoke:compose --project-name signalhub_ci_smoke"
    ]);
  });

  it("collects best-effort smoke diagnostics only when the smoke job fails", () => {
    const content = workflow();

    expectIncludesAll(content, [
      "if: failure()",
      "docker compose -p signalhub_ci_smoke ps -a || true",
      "docker compose -p signalhub_ci_smoke logs --no-color || true",
      "docker system df || true"
    ]);
  });
});
