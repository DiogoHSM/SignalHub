# Phase 6E SignalMonitor Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the project from SignalHub to SignalMonitor / sigmon.app across active code, packages, environment variables, Docker defaults, docs, tests, and handoff materials before hygiene and VPS deployment.

**Architecture:** Treat the rename as a mechanical contract backed by tests: first add a branding contract test that fails on old active identifiers, then perform the code/config/package rename, then polish operator docs and handoff memory. Historical phase docs may keep old names; active runtime and operator surfaces must use SignalMonitor, `sigmon`, `SIGMON_*`, and `@sigmon/*`.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, Docker Compose, GitHub CLI, existing docs under `.claude/docs`, versioned memory under `/Users/diogo/Developer/Github/claude-config`.

---

## Scope Check

This spec is broad but coherent: it is one repo-wide identity migration with no behavior changes. Keep Phase 6D hygiene fixes and Phase 6F VPS deployment out of this plan. If an old-name reference points at a security or deployment bug, leave the bug for 6D/6F and only rename the identifier.

## File Structure

- Create `scripts/branding-contract.test.ts`
  - Owns active-name regression tests. It scans active tracked files and fails if old SignalHub identifiers remain outside explicit historical/explanatory allowances.
- Modify `package.json`, `pnpm-lock.yaml`, package `package.json` files, `tsconfig.base.json`, `vitest.config.ts`
  - Own package names, workspace aliases, and lockfile metadata.
- Modify `apps/**`, `packages/**`, `scripts/**`, `.github/workflows/ci.yml`
  - Own active source, tests, smoke harness, doctor checks, CI smoke project names, and import aliases.
- Modify `.env.example`, `docker-compose.yml`, `Dockerfile` if needed
  - Own runtime env var names, Compose env-file variable, database/user/path defaults, and container-visible filesystem paths.
- Modify `README.md`, `CLAUDE.md`, `.claude/docs/*.md`, `docs/HTTP-INGESTION.md`
  - Own active operator docs, product identity, MicroERP validation context, planned `my.sigmon.app` deployment host, and next phase order.
- Modify `docs/superpowers/plans/2026-05-19-phase6e-signalmonitor-rename-implementation.md`
  - Track task completion and record grep/verification evidence.
- Modify `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`
  - Record Phase 6E completion and any repo/local-path rename follow-up.

## Old-Name Policy

Active runtime and operator surfaces must not use old names:

- `SignalHub`
- `Signal Hub`
- `signal-hub`
- `signalhub`
- `SIGNALHUB`

Allowed old-name references:

- historical files under `docs/superpowers/specs`, `docs/superpowers/plans`, and `docs/superpowers/runs`;
- external audit/review artifacts such as `audit.md` and `review/**`;
- explicit active-doc wording that says SignalMonitor was formerly developed as SignalHub.

## Task 1: Add Branding Contract Tests

**Files:**
- Create: `scripts/branding-contract.test.ts`

- [x] **Step 1: Write the failing branding contract test**

Create `scripts/branding-contract.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const oldIdentifierPatterns = [
  { label: "SignalHub", pattern: /\bSignalHub\b/g },
  { label: "Signal Hub", pattern: /\bSignal Hub\b/g },
  { label: "signal-hub", pattern: /\bsignal-hub\b/g },
  { label: "signalhub", pattern: /\bsignalhub\b/g },
  { label: "SIGNALHUB", pattern: /\bSIGNALHUB\b/g }
];

const activeFileExtensions = new Set([
  ".cjs",
  ".css",
  ".env",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml"
]);

const activeExtensionlessFiles = new Set(["Dockerfile", ".env.example", "README.md", "CLAUDE.md"]);

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function extensionOf(path: string): string {
  const slashIndex = path.lastIndexOf("/");
  const basename = slashIndex === -1 ? path : path.slice(slashIndex + 1);
  const dotIndex = basename.lastIndexOf(".");
  return dotIndex === -1 ? "" : basename.slice(dotIndex);
}

function isHistoricalOrExternal(path: string): boolean {
  return (
    path.startsWith("docs/superpowers/specs/") ||
    path.startsWith("docs/superpowers/plans/") ||
    path.startsWith("docs/superpowers/runs/") ||
    path.startsWith("review/") ||
    path === "audit.md"
  );
}

function isActiveTextFile(path: string): boolean {
  if (path === "scripts/branding-contract.test.ts") return false;
  if (isHistoricalOrExternal(path)) return false;
  if (activeExtensionlessFiles.has(path)) return true;
  return activeFileExtensions.has(extensionOf(path));
}

function stripAllowedOldNameMentions(content: string): string {
  return content
    .replace(/formerly developed as SignalHub/g, "formerly developed as OLD_PRODUCT_NAME")
    .replace(/formerly SignalHub/g, "formerly OLD_PRODUCT_NAME");
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("SignalMonitor branding contract", () => {
  it("keeps old SignalHub identifiers out of active tracked files", () => {
    const failures: string[] = [];

    for (const path of trackedFiles().filter(isActiveTextFile)) {
      const content = stripAllowedOldNameMentions(read(path));

      for (const { label, pattern } of oldIdentifierPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(content)) {
          failures.push(`${path} still contains ${label}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("uses the new public product identity in active operator docs", () => {
    expect(read("README.md")).toContain("# SignalMonitor");
    expect(read("README.md")).toContain("sigmon.app");
    expect(read("README.md")).toContain("my.sigmon.app");
    expect(read("CLAUDE.md")).toContain("SignalMonitor Project Context");
    expect(read(".claude/docs/PROJECT-SUMMARY.md")).toContain("SignalMonitor");
  });

  it("uses the new technical identifiers in runtime config", () => {
    expect(read("package.json")).toContain('"name": "sigmon"');
    expect(read("packages/sdk/package.json")).toContain('"name": "@sigmon/sdk"');
    expect(read("tsconfig.base.json")).toContain('"@sigmon/sdk"');
    expect(read(".env.example")).toContain("SIGMON_PUBLIC_ENDPOINT=");
    expect(read("docker-compose.yml")).toContain("SIGMON_ENV_FILE");
    expect(read("docker-compose.yml")).toContain("/var/lib/sigmon/source-maps");
  });

  it("uses the new smoke project names in local and CI smoke gates", () => {
    expect(read("scripts/smoke-compose/args.ts")).toContain("sigmon_smoke");
    expect(read("scripts/smoke-compose/args.ts")).toContain("SIGMON_SMOKE_PROJECT_NAME");
    expect(read(".github/workflows/ci.yml")).toContain("sigmon_ci_smoke");
    expect(read("scripts/ci-workflow.test.ts")).toContain("sigmon_ci_smoke");
  });
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```sh
PATH="/Users/diogo/.nvm/versions/node/v22.20.0/bin:$PATH" /Users/diogo/.nvm/versions/node/v22.20.0/bin/pnpm test scripts/branding-contract.test.ts
```

Expected: the command exits `1`. The first failure should list active files that still contain old SignalHub identifiers.

- [x] **Step 3: Commit the failing contract test**

Run:

```sh
git add scripts/branding-contract.test.ts
git commit -m "test: define signalmonitor branding contract"
```

## Task 2: Rename Packages, Imports, Config, And Runtime Identifiers

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/*/package.json`
- Modify: `packages/*/package.json`
- Modify: `tsconfig.base.json`
- Modify: `vitest.config.ts`
- Modify: `apps/**`
- Modify: `packages/**`
- Modify: `scripts/**`
- Modify: `.github/workflows/ci.yml`
- Modify: `.env.example`
- Modify: `docker-compose.yml`

- [x] **Step 1: Apply the active-file mechanical rename**

Run this script from the repository root:

```sh
node <<'NODE'
const { execFileSync } = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");

const replacements = [
  [/Signal Hub/g, "SignalMonitor"],
  [/SignalHub/g, "SignalMonitor"],
  [/SIGNALHUB/g, "SIGMON"],
  [/@signal-hub\//g, "@sigmon/"],
  [/signal-hub/g, "sigmon"],
  [/signalhub/g, "sigmon"]
];

const activeExtensions = new Set([
  ".cjs",
  ".css",
  ".env",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml"
]);

const activeExtensionless = new Set(["Dockerfile", ".env.example", "README.md", "CLAUDE.md"]);

function extensionOf(path) {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const dotIndex = basename.lastIndexOf(".");
  return dotIndex === -1 ? "" : basename.slice(dotIndex);
}

function shouldRewrite(path) {
  if (path.startsWith("docs/superpowers/specs/")) return false;
  if (path.startsWith("docs/superpowers/plans/")) return false;
  if (path.startsWith("docs/superpowers/runs/")) return false;
  if (path.startsWith("review/")) return false;
  if (path === "audit.md") return false;
  if (activeExtensionless.has(path)) return true;
  return activeExtensions.has(extensionOf(path));
}

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter(shouldRewrite);

for (const path of files) {
  let content = readFileSync(path, "utf8");
  const original = content;
  for (const [pattern, replacement] of replacements) {
    content = content.replace(pattern, replacement);
  }
  if (content !== original) {
    writeFileSync(path, content);
  }
}
NODE
```

Expected: active code/config/docs files are rewritten; historical `docs/superpowers/**`, `review/**`, and untracked `audit.md` are not rewritten.

- [x] **Step 2: Regenerate the pnpm lockfile metadata**

Run:

```sh
PATH="/Users/diogo/.nvm/versions/node/v22.20.0/bin:$PATH" /Users/diogo/.nvm/versions/node/v22.20.0/bin/pnpm install --lockfile-only
```

Expected: command exits `0`; `pnpm-lock.yaml` now refers to `sigmon` / `@sigmon/*` workspace packages.

- [x] **Step 3: Inspect package/import references**

Run:

```sh
rg -n "@signal-hub|signal-hub" package.json pnpm-lock.yaml tsconfig.base.json vitest.config.ts apps packages scripts
```

Expected: no output.

Then run:

```sh
rg -n "@sigmon|sigmon" package.json pnpm-lock.yaml tsconfig.base.json vitest.config.ts apps packages scripts | sed -n '1,120p'
```

Expected: output includes package names, import aliases, runtime paths, and smoke identifiers under the new names.

- [x] **Step 4: Run focused branding and workflow tests**

Run:

```sh
PATH="/Users/diogo/.nvm/versions/node/v22.20.0/bin:$PATH" /Users/diogo/.nvm/versions/node/v22.20.0/bin/pnpm test scripts/branding-contract.test.ts scripts/ci-workflow.test.ts scripts/smoke-compose.test.ts scripts/doctor.test.ts
```

Expected: all focused tests pass. If failures point at old names, update only the active file named by the failure.

- [x] **Step 5: Commit the mechanical rename**

Run:

```sh
git add package.json pnpm-lock.yaml tsconfig.base.json vitest.config.ts .github/workflows/ci.yml .env.example docker-compose.yml apps packages scripts
git commit -m "refactor: rename runtime identifiers to sigmon"
```

## Task 3: Polish Active Documentation And Product Identity

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/STACK.md`
- Modify: `.claude/docs/DEPLOYMENT.md`
- Modify: `.claude/docs/CONSTRAINTS.md`
- Modify: `.claude/docs/DECISIONS.md`
- Modify: `.claude/docs/SECRETS.md`
- Modify: `.claude/docs/INFRASTRUCTURE.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `docs/HTTP-INGESTION.md`
- Modify: `docs/superpowers/plans/2026-05-19-phase6e-signalmonitor-rename-implementation.md`

- [x] **Step 1: Update active project context**

In `CLAUDE.md`, ensure the opening section reads:

```markdown
# SignalMonitor Project Context

SignalMonitor is a self-hosted telemetry core for product analytics, errors, LLM calls, traces, and spans. It was formerly developed as SignalHub. Keep project-facing documentation in English.

- Current phase: Phase 6E SignalMonitor Rename.
```

In the Project Conventions list, ensure the package bullet uses:

```markdown
- The core runtime is a pnpm TypeScript workspace with `apps/api`, `apps/worker`, `@sigmon/sdk`, `@sigmon/cli`, and shared packages under `packages/*`.
```

- [x] **Step 2: Add MicroERP validation context to active docs**

In `.claude/docs/PROJECT-SUMMARY.md`, add this paragraph after the first summary paragraph:

```markdown
MicroERP is Diogo's personal project and the first real validation consumer for SignalMonitor. It is used to test whether SignalMonitor can credibly replace separate product analytics and error tracking vendors for a browser-facing application.
```

In `.claude/docs/CONSTRAINTS.md`, add this bullet near product/business constraints:

```markdown
- MicroERP is an internal personal validation project for SignalMonitor, not an external customer commitment.
```

- [x] **Step 3: Add deployment identity to active docs**

In `.claude/docs/DEPLOYMENT.md`, add this paragraph in the top deployment section:

```markdown
The planned first deployment hostname is `my.sigmon.app` on Diogo's shared EasyPanel VPS. Phase 6F will document the exact EasyPanel deployment, reverse proxy, TLS, volume, backup, and smoke-check steps.
```

In `README.md`, ensure the intro includes:

```markdown
The public brand/domain is `sigmon.app`; the planned self-hosted operator deployment is `my.sigmon.app`.
```

- [x] **Step 4: Update active examples and snippets**

Run:

```sh
rg -n "SignalHub|Signal Hub|signal-hub|signalhub|SIGNALHUB" README.md CLAUDE.md .claude/docs docs/HTTP-INGESTION.md
```

Expected: output is limited to exact "formerly SignalHub" wording. If any setup command, package name, env var, path, domain, or active instruction uses an old name, rewrite it to the new name.

- [x] **Step 5: Run the branding contract test**

Run:

```sh
PATH="/Users/diogo/.nvm/versions/node/v22.20.0/bin:$PATH" /Users/diogo/.nvm/versions/node/v22.20.0/bin/pnpm test scripts/branding-contract.test.ts
```

Expected: all tests pass.

- [x] **Step 6: Commit documentation polish**

Run:

```sh
git add README.md CLAUDE.md .claude/docs docs/HTTP-INGESTION.md docs/superpowers/plans/2026-05-19-phase6e-signalmonitor-rename-implementation.md
git commit -m "docs: rename project identity to signalmonitor"
```

## Task 4: Full Local Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-05-19-phase6e-signalmonitor-rename-implementation.md`

- [x] **Step 1: Run install verification**

Run:

```sh
PATH="/Users/diogo/.nvm/versions/node/v22.20.0/bin:$PATH" /Users/diogo/.nvm/versions/node/v22.20.0/bin/pnpm install --frozen-lockfile
```

Expected: command exits `0`.

- [x] **Step 2: Run full test suite**

Run:

```sh
PATH="/Users/diogo/.nvm/versions/node/v22.20.0/bin:$PATH" /Users/diogo/.nvm/versions/node/v22.20.0/bin/pnpm test
```

Expected: all test files and tests pass.

- [x] **Step 3: Run build**

Run:

```sh
PATH="/Users/diogo/.nvm/versions/node/v22.20.0/bin:$PATH" /Users/diogo/.nvm/versions/node/v22.20.0/bin/pnpm build
```

Expected: recursive workspace build exits `0`.

- [x] **Step 4: Validate Docker Compose config**

Run:

```sh
docker compose config --quiet
```

Expected: command exits `0`.

- [x] **Step 5: Run renamed smoke harness**

Run:

```sh
PATH="/Users/diogo/.nvm/versions/node/v22.20.0/bin:$PATH" /Users/diogo/.nvm/versions/node/v22.20.0/bin/pnpm smoke:compose
```

Expected: command exits `0`, prints `Failed: 0`, uses default Compose project `sigmon_smoke`, and cleans up smoke resources.

- [x] **Step 6: Confirm smoke cleanup**

Run:

```sh
docker ps -a --filter name=sigmon_smoke --format '{{.Names}} {{.Status}}'
docker volume ls --format '{{.Name}}' | rg '^sigmon_smoke_'
```

Expected: the container command prints nothing. The volume command prints nothing and may exit `1`.

- [x] **Step 7: Run old-name and new-name grep evidence**

Run:

```sh
rg -n "SignalHub|Signal Hub|signal-hub|signalhub|SIGNALHUB" README.md CLAUDE.md .claude/docs docs/HTTP-INGESTION.md package.json pnpm-lock.yaml tsconfig.base.json vitest.config.ts .env.example docker-compose.yml .github apps packages scripts
```

Expected: no output except explicit "formerly SignalHub" wording in active docs.

Run:

```sh
rg -n "SignalMonitor|sigmon|SIGMON|@sigmon" README.md CLAUDE.md .claude/docs docs/HTTP-INGESTION.md package.json pnpm-lock.yaml tsconfig.base.json vitest.config.ts .env.example docker-compose.yml .github apps packages scripts | sed -n '1,160p'
```

Expected: output shows the new brand, env vars, package names, paths, smoke names, and docs.

- [x] **Step 8: Record local verification notes**

Add this section before Task 5:

```markdown
## Local Verification Notes

- `pnpm install --frozen-lockfile`: passed with exit code 0.
- `pnpm test`: passed with N test files and N tests.
- `pnpm build`: passed with exit code 0.
- `docker compose config --quiet`: passed with exit code 0 and no output.
- `pnpm smoke:compose`: passed with Compose project `sigmon_smoke`, N passed, N warnings, and 0 failed.
- Smoke cleanup: `docker ps -a --filter name=sigmon_smoke --format '{{.Names}} {{.Status}}'` printed nothing; `docker volume ls --format '{{.Name}}' | rg '^sigmon_smoke_'` printed nothing and exited 1.
- Old-name grep: no active old-name references remained except explicit `formerly SignalHub` wording.
- New-name grep: representative evidence that active surfaces use SignalMonitor/sigmon.
```

Replace the `N` counts with exact observed values before committing.

- [x] **Step 9: Commit local verification evidence**

Run:

```sh
git add docs/superpowers/plans/2026-05-19-phase6e-signalmonitor-rename-implementation.md
git commit -m "docs: record phase 6e rename verification"
```

If the verification notes are already accurate and no file changed, do not create an empty commit.

## Local Verification Notes

Recorded on 2026-05-19 from branch `codex/phase6e-signalmonitor-rename` at head `c2378bb`.

- `PATH="/Users/diogo/.nvm/versions/node/v22.20.0/bin:$PATH" /Users/diogo/.nvm/versions/node/v22.20.0/bin/pnpm install --frozen-lockfile`: exited `0`; output reported the lockfile was up to date and dependencies were already up to date.
- `PATH="/Users/diogo/.nvm/versions/node/v22.20.0/bin:$PATH" /Users/diogo/.nvm/versions/node/v22.20.0/bin/pnpm test`: exited `1`. Result: `2 failed | 54 passed (56)` test files, `1 failed | 684 passed | 90 skipped (775)` tests. The failures were local Docker/Testcontainers Postgres startup failures, also seen during the pre-rename baseline check in this session: `packages/db/test/repositories.test.ts` failed during the `repositories` suite with `(HTTP code 409) container stopped/paused`, and `apps/api/test/e2e.test.ts` failed with `Health check failed: unhealthy` while starting `postgres:16-alpine`.
- `PATH="/Users/diogo/.nvm/versions/node/v22.20.0/bin:$PATH" /Users/diogo/.nvm/versions/node/v22.20.0/bin/pnpm build`: exited `0`; recursive workspace build completed, including the console Vite production build.
- `docker compose config --quiet`: exited `0` with no output.
- `PATH="/Users/diogo/.nvm/versions/node/v22.20.0/bin:$PATH" /Users/diogo/.nvm/versions/node/v22.20.0/bin/pnpm smoke:compose`: exited `1`. The smoke harness used Compose project `sigmon_smoke`; summary reported `Passed: 4`, `Warnings: 0`, `Failed: 1`. Failure occurred during `docker compose -p sigmon_smoke --env-file ... run --rm api pnpm seed:admin` because dependencies failed to start: `sigmon_smoke-redis-1 exited (1)`, and Postgres/Redis dependency checks failed.
- Smoke cleanup inspection: `docker ps -a --filter name=sigmon_smoke --format '{{.Names}} {{.Status}}'` exited `0` and printed nothing. `docker volume ls --format '{{.Name}}' | rg 'sigmon_smoke|signalhub_smoke'` exited `1` and printed nothing, so no matching smoke volumes remained.
- Old-name grep: `rg "signal-hub|signalhub|SIGNALHUB|@signal-hub|SignalHub|Signal Hub" package.json pnpm-lock.yaml apps packages scripts .github .env.example docker-compose.yml tsconfig.base.json vitest.config.ts README.md CLAUDE.md .claude/docs docs/HTTP-INGESTION.md Dockerfile PRD.md` exited `0`; matches were limited to the branding contract test and explicit explanatory wording that SignalMonitor was formerly developed as SignalHub in `CLAUDE.md`, `.claude/docs/DECISIONS.md`, and `.claude/docs/PROJECT-SUMMARY.md`.
- New-name grep: `rg "@sigmon|sigmon|SIGMON|SignalMonitor" package.json pnpm-lock.yaml apps packages scripts .github .env.example docker-compose.yml tsconfig.base.json vitest.config.ts README.md CLAUDE.md .claude/docs docs/HTTP-INGESTION.md Dockerfile PRD.md | head -n 80` exited `0` and showed representative active usage of `@sigmon/*`, `sigmon`, `SIGMON_*`, and `SignalMonitor` across `package.json`, `pnpm-lock.yaml`, `tsconfig.base.json`, `CLAUDE.md`, `README.md`, and `vitest.config.ts`.

Full local verification is not green on 2026-05-19 because `pnpm test` and `pnpm smoke:compose` exited non-zero. These are observed local Docker/Testcontainers startup failures, also seen during the pre-rename baseline check in this session; they are recorded here without Phase 6D/infra remediation.

## Task 5: GitHub PR Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-05-19-phase6e-signalmonitor-rename-implementation.md`

- [x] **Step 1: Push the branch and open a draft PR**

Run:

```sh
git branch --show-current
git push -u origin "$(git branch --show-current)"
```

Expected: the Phase 6E branch is pushed.

Open a draft PR to `main` with title:

```text
[codex] Rename SignalHub to SignalMonitor
```

The PR body should mention:

- full rename to SignalMonitor / `sigmon.app`;
- package scope change to `@sigmon/*`;
- env var change to `SIGMON_*`;
- Docker/database/path/smoke rename to `sigmon`;
- local verification results;
- no hygiene or VPS deployment changes in this phase.

- [x] **Step 2: Watch PR checks**

Run:

```sh
/opt/homebrew/bin/gh pr checks --watch
```

Expected: the PR reports `Test`, `Build`, `Docker Compose config`, and `Compose smoke` passing under the renamed CI workflow.

- [x] **Step 3: Record PR evidence**

Run:

```sh
/opt/homebrew/bin/gh pr view --json url,headRefName,baseRefName,headRefOid,isDraft,state,statusCheckRollup
git rev-parse --short HEAD
```

Add this section before Task 6:

```markdown
## GitHub PR Evidence

- Draft PR: paste the pull request URL returned by `/opt/homebrew/bin/gh pr view`.
- Branch: paste the `headRefName` and `baseRefName` returned by `/opt/homebrew/bin/gh pr view`.
- Head commit: paste the short SHA from `git rev-parse --short HEAD` and the long `headRefOid` returned by `/opt/homebrew/bin/gh pr view`.
- Checks: paste the observed statuses for `Test`, `Build`, `Docker Compose config`, and `Compose smoke`.
- Notes: paste the exact GitHub workflow naming/indexing limitation if one appeared; otherwise write `none`.
```

Do not commit this section until every bullet contains observed command output rather than instructional text.

- [x] **Step 4: Commit PR evidence**

Run:

```sh
git add docs/superpowers/plans/2026-05-19-phase6e-signalmonitor-rename-implementation.md
git commit -m "docs: record phase 6e pr evidence"
git push
```

If committing evidence triggers another docs-only CI run, wait for the latest PR head checks and report the live result in the handoff.

## GitHub PR Evidence

Recorded on 2026-05-19 at 14:15:07 -03 from branch `codex/phase6e-signalmonitor-rename`.

- Worktree and head before push: `git status -sb` exited `0` with `## codex/phase6e-signalmonitor-rename`; `git log --oneline --max-count=6` showed head `389f866 docs: record phase 6e rename verification` followed by Task 1-3 rename commits.
- Branch push: `git push -u origin codex/phase6e-signalmonitor-rename` exited `0`, created `origin/codex/phase6e-signalmonitor-rename`, and set the local branch to track the remote branch.
- Draft PR: `/opt/homebrew/bin/gh pr create --draft --base main --head codex/phase6e-signalmonitor-rename --title '[codex] Rename SignalHub to SignalMonitor' ...` returned `https://github.com/DiogoHSM/SignalHub/pull/5`.
- PR metadata: `/opt/homebrew/bin/gh pr view 5 --json number,url,headRefName,baseRefName,headRefOid,isDraft,state,statusCheckRollup` exited `0` and returned PR `#5`, URL `https://github.com/DiogoHSM/SignalHub/pull/5`, draft `true`, state `OPEN`, head `codex/phase6e-signalmonitor-rename`, base `main`, and head commit `389f866535d1e3457da7d4047eef4c149230333a`.
- Local short head: `git rev-parse --short HEAD` exited `0` and returned `389f866`.
- Check watch: `/opt/homebrew/bin/gh pr checks 5 --watch` exited `0` after reporting `Build`, `Compose smoke`, `Docker Compose config`, and `Test` as `pass`.
- Final check snapshot before evidence commit: `/opt/homebrew/bin/gh pr checks 5` exited `0` and reported `Build pass 38s`, `Compose smoke pass 1m10s`, `Docker Compose config pass 19s`, and `Test pass 46s`.
- Notes: none.

## Task 6: Completion Memory And Repo Rename Handoff

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/plans/2026-05-19-phase6e-signalmonitor-rename-implementation.md`
- Modify: `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`

- [x] **Step 1: Complete active docs phase status**

In `CLAUDE.md`, ensure:

```markdown
- Current phase: Phase 6E SignalMonitor Rename.
```

In the plan, check off completed Task 1 through Task 6 steps that have actually been completed.

- [x] **Step 2: Update versioned memory**

Append to `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`:

```markdown
- Completed Phase 6E SignalMonitor Rename on commit from `git rev-parse --short HEAD`.
- Renamed active product identity from SignalHub to SignalMonitor, with `sigmon.app` as the public brand and `my.sigmon.app` as the planned deployment host.
- Renamed active package scope to `@sigmon/*`, root package to `sigmon`, env vars to `SIGMON_*`, and Docker/database/path/smoke defaults to `sigmon`.
- Documented MicroERP as Diogo's personal validation project for SignalMonitor.
- Verification: local checks and PR CI passed.
- Next planned phases: Phase 6D 0.1.1 critical hygiene, then Phase 6F EasyPanel VPS deployment.
- Post-merge repository rename target: GitHub repository `DiogoHSM/sigmon`; local directory rename optional after remote rename.
```

Replace the phrase `from git rev-parse --short HEAD` with the actual short commit hash before committing memory.

- [x] **Step 3: Commit final SignalMonitor docs**

Run in the SignalMonitor repository:

```sh
git add CLAUDE.md docs/superpowers/plans/2026-05-19-phase6e-signalmonitor-rename-implementation.md
git commit -m "docs: complete phase 6e signalmonitor rename"
git push
```

If neither file changed, do not create an empty commit.

- [x] **Step 4: Commit memory**

Run in `/Users/diogo/Developer/Github/claude-config`:

```sh
git add projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
git commit -m "memory: record SignalMonitor rename completion"
git push
```

Do not stage unrelated config repo files such as `home/CLAUDE.md`, `settings.json`, or other project memory directories.

- [x] **Step 5: Post-merge GitHub repository rename**

After the Phase 6E PR is merged into `main`, run:

```sh
/opt/homebrew/bin/gh api -X PATCH repos/DiogoHSM/SignalHub -f name=sigmon
git remote set-url origin https://github.com/DiogoHSM/sigmon
git fetch --quiet
git status -sb
```

Expected: GitHub repository becomes `DiogoHSM/sigmon`, local `origin` points to `https://github.com/DiogoHSM/sigmon`, and `main` is synced.

If GitHub refuses the rename because `sigmon` already exists, stop and report the exact error. Do not choose a different repository name without user approval.

- [ ] **Step 6: Optional local directory rename**

If the user wants the local folder renamed after the remote rename, run from `/Users/diogo/Developer/Github` after all shells using the old path are closed:

```sh
mv SignalHub sigmon
```

Then update versioned memory with the new local path slug on the next session. Do not rename the local folder in the middle of an active implementation run.

- [x] **Step 7: Final handoff**

Report:

- final commit list;
- local verification outcomes;
- PR CI status;
- old-name grep status;
- smoke cleanup status;
- config memory commit;
- repository rename status;
- whether local directory rename was performed or deferred;
- unresolved follow-ups for Phase 6D and Phase 6F.

## Task 6 Handoff Notes

- `CLAUDE.md` still records `- Current phase: Phase 6E SignalMonitor Rename.`
- Completion memory has been updated in the versioned config repo for the current Phase 6E branch head.
- PR #5 was merged into `main` as `bb5e26e`.
- GitHub repository rename was completed after merge: `DiogoHSM/SignalHub` is now `DiogoHSM/sigmon`.
- Local `origin` now points to `https://github.com/DiogoHSM/sigmon`; `main` is synced at `bb5e26e`.
- Local directory rename was deferred. The current working directory remains `/Users/diogo/Developer/Github/SignalHub`; optional local rename can happen after shells using the old path are closed.
