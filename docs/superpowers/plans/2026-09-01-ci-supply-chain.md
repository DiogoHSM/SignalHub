# CI Dependency Immutability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin every third-party GitHub Action to a reviewed commit, constrain OIDC to SDK publishing, and automate controlled action-update proposals.

**Architecture:** Extend the existing workflow contract test before changing YAML, pin the current v6 releases to upstream commit SHAs, then add weekly Dependabot coverage for the GitHub Actions ecosystem.

**Tech Stack:** GitHub Actions YAML, Dependabot, TypeScript, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-01-ci-supply-chain-design.md`

## Global Constraints

- `actions/checkout` v6.1.0 is pinned to `d23441a48e516b6c34aea4fa41551a30e30af803`.
- `actions/setup-node` v6.5.0 is pinned to `249970729cb0ef3589644e2896645e5dc5ba9c38`.
- Every SHA retains its release in a trailing comment.
- OIDC `id-token: write` exists only on the `publish-sdk` job.
- CI triggers, Node versions, pnpm version, jobs, and manual publishing remain unchanged.
- Dependabot updates are weekly and reviewed through ordinary CI.

---

### Task 1: Strengthen workflow contract tests

**Files:**
- Modify: `scripts/ci-workflow.test.ts`

**Interfaces:**
- Produces: workflow scanner enforcing full SHA pins, release comments, OIDC scope, and Dependabot configuration.
- Consumes: `.github/workflows/*.yml` and `.github/dependabot.yml` as text/YAML fixtures.

- [ ] **Step 1: Write failing pin and permission assertions**

```ts
const externalUses = workflowLines
  .map((line, index) => ({ line, index: index + 1 }))
  .filter(({ line }) => /^\s*uses:\s*(?!\.\/)/.test(line));

it("pins every external action to a full SHA with a version comment", () => {
  for (const { line } of externalUses) {
    expect(line).toMatch(/uses:\s*[^@\s]+@[0-9a-f]{40}\s+#\s+v\d+(?:\.\d+){0,2}\s*$/);
  }
});

it("grants OIDC only inside the publish-sdk job", () => {
  expect(publishWorkflow).toMatch(/publish-sdk:[\s\S]*?permissions:[\s\S]*?id-token:\s*write/);
  expect(workflowLevelPermissions(publishWorkflow)).not.toContain("id-token: write");
});
```

Add a test requiring a weekly `github-actions` Dependabot entry at directory `/`.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run scripts/ci-workflow.test.ts`

Expected: FAIL because workflows use mutable `@v6`, publishing grants workflow-level OIDC, and Dependabot config is absent.

- [ ] **Step 3: Commit the red test separately**

```bash
git add scripts/ci-workflow.test.ts
git commit -m "test(ci): require immutable action dependencies"
```

### Task 2: Pin actions and constrain OIDC

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/publish-sdk.yml`

**Interfaces:**
- Consumes: Task 1 scanner and verified upstream tag resolutions.
- Produces: immutable checkout/setup-node execution and job-only OIDC.

- [ ] **Step 1: Replace every checkout/setup-node reference**

Use exactly:

```yaml
uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.1.0
```

and:

```yaml
uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0
```

Apply to every job in both workflow files.

- [ ] **Step 2: Move publish permissions to the job**

Keep workflow-level:

```yaml
permissions:
  contents: read
```

Add under `jobs.publish-sdk`:

```yaml
permissions:
  contents: read
  id-token: write
```

- [ ] **Step 3: Run the contract test**

Run: `pnpm vitest run scripts/ci-workflow.test.ts`

Expected: pin/OIDC assertions pass; Dependabot assertion still fails for the expected remaining reason.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/publish-sdk.yml
git commit -m "fix(ci): pin actions and scope oidc"
```

### Task 3: Add controlled action updates and verify

**Files:**
- Create: `.github/dependabot.yml`

**Interfaces:**
- Consumes: Task 1 Dependabot assertion.
- Produces: weekly GitHub Actions update PRs.

- [ ] **Step 1: Add the exact configuration**

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    commit-message:
      prefix: "chore(actions)"
```

- [ ] **Step 2: Verify GREEN**

Run: `pnpm vitest run scripts/ci-workflow.test.ts`

Expected: PASS.

Run: `pnpm test`

Run: `pnpm build`

Run: `docker compose config --quiet`

Expected: all commands exit 0.

- [ ] **Step 3: Recheck upstream bindings**

Run: `git ls-remote --tags https://github.com/actions/checkout.git refs/tags/v6.1.0`

Expected: `d23441a48e516b6c34aea4fa41551a30e30af803`.

Run: `git ls-remote --tags https://github.com/actions/setup-node.git refs/tags/v6.5.0`

Expected: `249970729cb0ef3589644e2896645e5dc5ba9c38`.

- [ ] **Step 4: Commit**

```bash
git add .github/dependabot.yml
git commit -m "chore(ci): enable action dependency updates"
```

- [ ] **Step 5: Post-merge observation**

After merge, inspect the first GitHub CI run and the next manual SDK publish run. PER-514 remains open until CI completes and the publish workflow renders with job-scoped OIDC.
