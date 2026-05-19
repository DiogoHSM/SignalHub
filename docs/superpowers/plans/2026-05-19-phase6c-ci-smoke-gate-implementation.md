# Phase 6C CI Smoke Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions CI workflow that runs tests, build, Compose config validation, and the Phase 6B Compose smoke harness for pull requests and `main`.

**Architecture:** Add a single `.github/workflows/ci.yml` workflow with independent jobs for `test`, `build`, `compose-config`, and `smoke-compose`. Add a lightweight Vitest contract test that reads the workflow file and asserts the required triggers, setup steps, commands, and smoke diagnostics so future edits do not silently remove the CI gate.

**Tech Stack:** GitHub Actions, Node.js 22, Corepack, pnpm 9.15.4, Docker Compose, Vitest, existing `pnpm smoke:compose` runner.

---

## File Structure

- Create `.github/workflows/ci.yml`
  - Owns the GitHub Actions workflow for PR, `main` push, and manual CI runs.
- Create `scripts/ci-workflow.test.ts`
  - Owns repo-local workflow contract tests. It should not call GitHub; it only reads `.github/workflows/ci.yml` and checks for required CI structure.
- Modify `README.md`
  - Adds a short CI section after the Compose Smoke Harness docs.
- Modify `.claude/docs/DEPLOYMENT.md`
  - Documents CI release-readiness checks.
- Modify `.claude/docs/STACK.md`
  - Lists GitHub Actions as the CI runner.
- Modify `.claude/docs/CONSTRAINTS.md`
  - Clarifies that CI validates the Compose path but does not add new deployment targets.
- Modify `docs/superpowers/plans/2026-05-19-phase6c-ci-smoke-gate-implementation.md`
  - Check off steps during implementation and record final verification notes.
- Modify `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`
  - Record Phase 6C completion after the final PR/CI evidence exists.

## Task 1: Add Workflow Contract Tests

**Files:**
- Create: `scripts/ci-workflow.test.ts`

- [x] **Step 1: Write the failing workflow contract tests**

Create `scripts/ci-workflow.test.ts`:

```ts
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
      "run: pnpm smoke:compose --project-name signalhub_ci_smoke --preserve"
    ]);
  });

  it("collects best-effort smoke diagnostics only when the smoke job fails", () => {
    const content = workflow();

    expectIncludesAll(content, [
      "if: failure()",
      "docker compose -p signalhub_ci_smoke ps -a || true",
      "docker compose -p signalhub_ci_smoke logs --no-color || true",
      "docker system df || true",
      "docker compose -p signalhub_ci_smoke down -v || true"
    ]);
  });
});
```

- [x] **Step 2: Run the workflow contract tests and verify they fail**

Run:

```sh
pnpm exec vitest scripts/ci-workflow.test.ts --run
```

Expected: the command exits `1` because `.github/workflows/ci.yml` does not exist yet.

- [x] **Step 3: Commit the failing tests**

Run:

```sh
git add scripts/ci-workflow.test.ts
git commit -m "test: define ci workflow contract"
```

## Task 2: Add The GitHub Actions CI Workflow

**Files:**
- Create: `.github/workflows/ci.yml`
- Test: `scripts/ci-workflow.test.ts`

- [x] **Step 1: Add the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Enable Corepack
        run: corepack enable

      - name: Prepare pnpm
        run: corepack prepare pnpm@9.15.4 --activate

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests
        run: pnpm test

  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Enable Corepack
        run: corepack enable

      - name: Prepare pnpm
        run: corepack prepare pnpm@9.15.4 --activate

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run build
        run: pnpm build

  compose-config:
    name: Docker Compose config
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Enable Corepack
        run: corepack enable

      - name: Prepare pnpm
        run: corepack prepare pnpm@9.15.4 --activate

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Validate Docker Compose config
        run: docker compose config --quiet

  smoke-compose:
    name: Compose smoke
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Enable Corepack
        run: corepack enable

      - name: Prepare pnpm
        run: corepack prepare pnpm@9.15.4 --activate

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run Compose smoke harness
        run: pnpm smoke:compose --project-name signalhub_ci_smoke --preserve

      - name: Collect smoke diagnostics
        if: failure()
        run: |
          docker compose -p signalhub_ci_smoke ps -a || true
          docker compose -p signalhub_ci_smoke logs --no-color || true
          docker system df || true

      - name: Cleanup smoke resources
        if: always()
        run: docker compose -p signalhub_ci_smoke down -v || true
```

- [x] **Step 2: Run the workflow contract tests and verify they pass**

Run:

```sh
pnpm exec vitest scripts/ci-workflow.test.ts --run
```

Expected: the command exits `0` and reports 4 passing tests.

- [x] **Step 3: Run full tests**

Run:

```sh
pnpm test
```

Expected: all tests pass, including the new workflow contract test.

- [x] **Step 4: Commit the workflow**

Run:

```sh
git add .github/workflows/ci.yml scripts/ci-workflow.test.ts
git commit -m "ci: add compose smoke gate workflow"
```

## Task 3: Document The CI Gate

**Files:**
- Modify: `README.md`
- Modify: `.claude/docs/DEPLOYMENT.md`
- Modify: `.claude/docs/STACK.md`
- Modify: `.claude/docs/CONSTRAINTS.md`
- Modify: `docs/superpowers/plans/2026-05-19-phase6c-ci-smoke-gate-implementation.md`

- [x] **Step 1: Update README**

In `README.md`, add this section immediately after `## Compose Smoke Harness`:

```markdown
## Continuous Integration

Pull requests to `main` and pushes to `main` run the GitHub Actions CI gate. CI installs dependencies with the repo-pinned pnpm version, then runs tests, build, Docker Compose config validation, and the Compose smoke harness.

The smoke job runs `pnpm smoke:compose --project-name signalhub_ci_smoke --preserve` to validate the self-hosted Docker Compose install path in a clean GitHub-hosted runner. The workflow preserves resources long enough to collect failure diagnostics, then explicitly cleans them up with `docker compose -p signalhub_ci_smoke down -v || true`. The same `pnpm smoke:compose` command remains available for local release checks.
```

- [x] **Step 2: Update deployment docs**

In `.claude/docs/DEPLOYMENT.md`, add this section after the `## Doctor` section:

```markdown
## CI Gate

GitHub Actions runs the release-readiness baseline for pull requests to `main` and pushes to `main`: `pnpm test`, `pnpm build`, `docker compose config --quiet`, and `pnpm smoke:compose --project-name signalhub_ci_smoke --preserve`.

The CI smoke job validates the Docker Compose install path with generated local-only secrets. It preserves smoke resources long enough to collect failure diagnostics, then explicitly cleans them up with `docker compose -p signalhub_ci_smoke down -v || true`. It does not publish images, create releases, or deploy SignalHub.
```

- [x] **Step 3: Update stack docs**

In `.claude/docs/STACK.md`, add this section before `## Commands`:

```markdown
## CI

- GitHub Actions runs pull request and `main` branch checks on `ubuntu-latest`.
- CI uses Node.js 22, Corepack, pnpm 9.15.4, Docker Compose, Vitest, and the repo-native `pnpm smoke:compose` runner.
```

- [x] **Step 4: Update constraints docs**

In `.claude/docs/CONSTRAINTS.md`, add this bullet near the Docker Compose and smoke harness constraints:

```markdown
- GitHub Actions CI is a verification gate only; it does not publish images, create hosted environments, or expand the supported deployment surface beyond Docker Compose.
```

- [x] **Step 5: Run docs grep checks**

Run:

```sh
rg -n "Continuous Integration|CI Gate|GitHub Actions|signalhub_ci_smoke" README.md .claude/docs
```

Expected: output shows the README section and `.claude/docs` updates.

- [ ] **Step 6: Commit docs**

Run:

```sh
git add README.md .claude/docs/DEPLOYMENT.md .claude/docs/STACK.md .claude/docs/CONSTRAINTS.md docs/superpowers/plans/2026-05-19-phase6c-ci-smoke-gate-implementation.md
git commit -m "docs: document ci smoke gate"
```

## Task 4: Local Final Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-05-19-phase6c-ci-smoke-gate-implementation.md`

- [ ] **Step 1: Run full test suite**

Run:

```sh
pnpm test
```

Expected: all tests pass.

- [ ] **Step 2: Run build**

Run:

```sh
pnpm build
```

Expected: command exits `0`.

- [ ] **Step 3: Validate Compose config**

Run:

```sh
docker compose config --quiet
```

Expected: command exits `0`.

- [ ] **Step 4: Run local smoke harness**

Run:

```sh
pnpm smoke:compose
```

Expected: command exits `0`, prints `Failed: 0`, and cleans up smoke resources.

- [ ] **Step 5: Confirm smoke cleanup**

Run:

```sh
docker ps -a --filter name=signalhub_smoke --format '{{.Names}} {{.Status}}'
docker volume ls --format '{{.Name}}' | rg '^signalhub_smoke_'
```

Expected: the container command prints nothing. The volume command prints nothing and may exit `1`.

- [ ] **Step 6: Record final local verification notes**

Add this section at the bottom of `docs/superpowers/plans/2026-05-19-phase6c-ci-smoke-gate-implementation.md`:

```markdown
## Local Verification Notes

- `pnpm test`: passed.
- `pnpm build`: passed.
- `docker compose config --quiet`: passed.
- `pnpm smoke:compose`: passed.
- Smoke cleanup: no `signalhub_smoke` containers or volumes remained.
```

- [ ] **Step 7: Commit local verification notes**

Run:

```sh
git add docs/superpowers/plans/2026-05-19-phase6c-ci-smoke-gate-implementation.md
git commit -m "docs: record phase 6c local verification"
```

## Task 5: GitHub Workflow Verification And PR Evidence

**Files:**
- Modify: `docs/superpowers/plans/2026-05-19-phase6c-ci-smoke-gate-implementation.md`

- [ ] **Step 1: Verify workflow visibility locally through GitHub CLI**

After the branch is pushed, run:

```sh
gh workflow view CI
```

Expected: GitHub CLI shows the `CI` workflow. If GitHub has not indexed the workflow yet, record the exact error in the plan and retry after the PR is opened.

- [ ] **Step 2: Inspect PR checks**

After opening the Phase 6C PR, run:

```sh
gh pr checks --watch
```

Expected: the PR reports `test`, `build`, `compose-config`, and `smoke-compose` jobs. If no checks appear, record the exact output and inspect the workflow tab in GitHub.

- [ ] **Step 3: If CI fails, debug systematically before changing code**

Use `superpowers:systematic-debugging`.

Run:

```sh
gh run list --workflow CI --limit 5
gh run view --log-failed
```

Expected: logs identify the failing job and step. Do not change workflow or harness behavior until the root cause is understood.

- [ ] **Step 4: Record CI evidence**

First run:

```sh
gh pr view --json url,headRefName,baseRefName
git rev-parse --short HEAD
```

Then add a `## GitHub CI Evidence` section to the plan with:

- the URL returned by `gh pr view --json url,headRefName,baseRefName`;
- workflow name `CI`;
- observed checks `test`, `build`, `compose-config`, and `smoke-compose`;
- result status, including the short commit hash from `git rev-parse --short HEAD` if a CI fix was required.

- [ ] **Step 5: Commit CI evidence if it required plan updates**

Run:

```sh
git add docs/superpowers/plans/2026-05-19-phase6c-ci-smoke-gate-implementation.md
git commit -m "docs: record phase 6c ci evidence"
```

If the plan already contains accurate evidence and no files changed, do not create an empty commit.

## Task 6: Completion Memory And Handoff

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/plans/2026-05-19-phase6c-ci-smoke-gate-implementation.md`
- Modify: `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`

- [ ] **Step 1: Update CLAUDE.md**

If Phase 6C completes successfully, update the current phase line in `CLAUDE.md`:

```markdown
- Current phase: Phase 6C CI Smoke Gate.
```

Add this project convention if it is not already present:

```markdown
- Keep GitHub Actions CI focused on tests, build, Docker Compose config validation, and the Compose smoke gate until a dedicated release-management phase expands it.
```

- [ ] **Step 2: Complete the plan checklist**

Check off completed steps in `docs/superpowers/plans/2026-05-19-phase6c-ci-smoke-gate-implementation.md`.

- [ ] **Step 3: Commit final SignalHub docs**

Run:

```sh
git add CLAUDE.md docs/superpowers/plans/2026-05-19-phase6c-ci-smoke-gate-implementation.md
git commit -m "docs: complete phase 6c ci smoke gate"
```

If neither file changed, do not create an empty commit.

- [ ] **Step 4: Update versioned memory**

First run:

```sh
git rev-parse --short HEAD
```

Update `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md` with:

```markdown
- Completed Phase 6C CI Smoke Gate on SignalHub commit from `git rev-parse --short HEAD`.
- Added GitHub Actions CI for pull requests to `main`, pushes to `main`, and manual dispatch.
- CI runs `pnpm test`, `pnpm build`, `docker compose config --quiet`, and `pnpm smoke:compose --project-name signalhub_ci_smoke --preserve`, then cleans up smoke resources with `docker compose -p signalhub_ci_smoke down -v || true`.
- Final verification: local checks passed, and GitHub PR checks were observed or the no-run limitation was recorded with evidence.
```

- [ ] **Step 5: Commit memory**

Run in `/Users/diogo/Developer/Github/claude-config`:

```sh
git add projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
git commit -m "memory: record SignalHub phase 6c completion"
```

- [ ] **Step 6: Final handoff**

Report:

- final SignalHub commit list;
- local verification outcomes;
- GitHub workflow/PR check status;
- smoke cleanup status;
- unresolved follow-ups;
- whether SignalHub and config repo are ahead of origin.
