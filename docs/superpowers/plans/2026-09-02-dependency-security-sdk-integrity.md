# Dependency Security and SDK Package Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Security tasks also use `codex-security:fix-finding`; each candidate fix receives a fresh bypass-oriented review.

**Goal:** Complete PER-514, PER-516, PER-517, and PER-518 with immutable workflow dependencies, zero known package advisories, and hermetic SDK artifacts.

**Architecture:** First land the already-designed workflow immutability contract. Then harden SDK build/pack behavior. Upgrade production and development dependency graphs in separate reviewable commits, using the online audit as the failing security test and the existing behavior suites as compatibility gates. Add the CI audit gate only after the graph is clean.

**Tech Stack:** GitHub Actions, Dependabot, pnpm 9.15.4, npm trusted publishing, TypeScript, Vitest, Vite.

**Specs:**

- `docs/superpowers/specs/2026-09-01-ci-supply-chain-design.md`
- `docs/superpowers/specs/2026-09-02-dependency-security-sdk-integrity-design.md`

## Global constraints

- Do not publish, deploy, push, or change Linear status.
- Do not add `audit.ignore`, `--ignore`, or `--ignore-registry-errors`.
- Treat `docs/superpowers/evidence/2026-09-02-pnpm-audit-baseline.json` as the dated RED baseline. Add any newly published advisory to the evidence and Linear scope before remediating it.
- Prefer direct-parent upgrades over transitive overrides.
- Preserve Node 22 application CI, Node 24 npm publishing, pnpm 9.15.4, and OIDC trusted publishing.
- Every task ends with a clean tracked worktree, an atomic commit, and an independent review.

---

### Task 1: Complete immutable GitHub Actions and OIDC scope (PER-514)

Execute `docs/superpowers/plans/2026-09-01-ci-supply-chain.md` Tasks 1–3 with these refinements:

- Scan every `.github/workflows/*.yml` and `.yaml` file, not only the two current files.
- Pin checkout v6.1.0 to `d23441a48e516b6c34aea4fa41551a30e30af803`.
- Pin setup-node v6.5.0 to `249970729cb0ef3589644e2896645e5dc5ba9c38`.
- Add `package-manager-cache: false` to the publish setup-node step.
- Replace mutable `npm@latest` with reviewed exact npm 11.19.1 and add a contract rejecting ranges/latest.
- The Dependabot file may initially contain only `github-actions`; Task 5 adds the npm ecosystem entry.

Verification: `pnpm vitest run scripts/ci-workflow.test.ts`, independent YAML parse, upstream tag re-resolution, frozen install.

Commit sequence:

1. `test(ci): require immutable action dependencies`
2. `fix(ci): pin actions and scope oidc`
3. `chore(ci): enable action dependency updates`

### Task 2: Make SDK build and pack hermetic (PER-518)

**Files:**

- Modify: `packages/sdk/package.json`
- Create: `packages/sdk/scripts/build.mjs`
- Modify: `packages/sdk/scripts/smoke-packed-consumer.mjs`
- Create or modify: `packages/sdk/scripts/*.test.ts` for artifact/lifecycle contracts

- [ ] Write a failing test that creates `dist/obsolete-from-previous-build.js`, runs the SDK build, and proves the sentinel survives today.
- [ ] Write a failing lifecycle test proving direct `npm pack --dry-run --json` can package current `dist` without invoking a clean two-pass build.
- [ ] Add a Node build orchestrator that removes `dist`/staging, invokes both TypeScript configs with staging as `outDir`, promotes staging only on complete success, and removes both trees on any nonzero exit.
- [ ] Remove `prepublishOnly`, make `prepack` the single authoritative lifecycle build, and remove the redundant explicit build from `smoke:packed` so pack and publish invoke exactly one lifecycle build.
- [ ] Extend the smoke to inspect the pack manifest and packed JavaScript for stale files and private `@sigmon/*` runtime imports before clean-consumer installation.
- [ ] Add a forced second-pass failure probe in an isolated temporary copy; assert `dist` and staging are absent afterward and direct pack fails until sources are restored and a fresh `prepack` succeeds.

Verification:

```bash
pnpm vitest run packages/sdk/scripts/sdk-artifact-lifecycle.test.ts packages/sdk/src
pnpm --filter @sigmon/sdk build
pnpm --filter @sigmon/sdk smoke:packed
pnpm smoke:sdk-packed
pnpm vitest run scripts/ci-workflow.test.ts
```

Commit: `fix(sdk): make packed artifacts hermetic`

### Task 3: Remediate production dependency advisories (PER-516)

**Files:** root and affected workspace `package.json` files, `pnpm-lock.yaml`, focused compatibility tests only when an existing test does not cover the changed integration.

- [ ] Record RED against the dated evidence file: `pnpm audit --prod --json` includes the baseline's 23 production advisory IDs. Classify any new advisory separately.
- [ ] Upgrade Fastify to 5.12.1 across root/API/loadgen and `@fastify/static` to 10.1.3.
- [ ] Upgrade Kysely to 0.28.17 across root/API/worker/DB.
- [ ] Upgrade Nano ID to 5.1.16 across root/telemetry/SDK.
- [ ] Upgrade Nodemailer to 9.1.1 across root/worker and align types only if compilation requires it.
- [ ] Re-resolve the MCP/Express `qs` path to at least 6.16.0 without changing the MCP public API.
- [ ] Run `pnpm audit --prod` and resolve every remaining production advisory through the nearest compatible parent; use no ignore entries.
- [ ] Verify Fastify routes/static serving, proxy/schema behavior, mail transport safety, DB suites, telemetry/SDK ID behavior, full tests, and builds.

Verification includes `pnpm install --frozen-lockfile`, `pnpm audit --prod`, `pnpm test`, `pnpm build`, `pnpm smoke:sdk-packed`, and `docker compose config --quiet`.

Commit: `fix(deps): remediate production advisories`

### Task 4: Remediate development dependency advisories (PER-517)

**Files:** root and affected workspace `package.json` files, `pnpm-lock.yaml`, Vitest/Vite configs only when migration requires it.

- [ ] Record RED against the dated evidence file: after the production slice, full `pnpm audit --json` includes the baseline's 43 dev-only advisory IDs. Classify any new advisory separately.
- [ ] Upgrade Vitest to 3.2.7 across root and workspaces; preserve the current environments and worker/parallelism behavior.
- [ ] Upgrade console Vite to 6.4.3 and keep `@vitejs/plugin-react` on a release whose peer range includes it.
- [ ] Upgrade jsdom to 26.1.0 across root/console.
- [ ] Upgrade Testcontainers and `@testcontainers/postgresql` to 12.1.0 across root/queues/DB. Verify under Node >=22.22, including live PostgreSQL/queue integration; do not silently claim compatibility from this host's Node 25 run.
- [ ] Refresh the plugin-react/Babel/browserslist and remaining tool subgraphs through compatible direct parents.
- [ ] Run full `pnpm audit`; resolve every remaining low/moderate/high/critical advisory through parent updates or an evidence-backed narrow override. Do not suppress any GHSA.
- [ ] Run the full test suite and compare discovered/executed test-file counts with the pre-upgrade baseline so no suite silently disappears.

Verification includes focused console/Vite build, DB and queue integration tests, `pnpm test`, `pnpm build`, packed SDK smoke, and frozen install.

Commit: `fix(deps): remediate development advisories`

### Task 5: Add dependency update automation and the CI audit gate (PER-516/PER-517)

**Files:**

- Modify: `.github/dependabot.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/ci-workflow.test.ts`

- [ ] Write failing workflow-contract tests for a weekly root `npm` Dependabot entry and a dedicated `audit` job.
- [ ] Add the weekly `npm` ecosystem entry without removing the `github-actions` entry.
- [ ] Add an `audit` job using the already pinned checkout/setup-node actions, Node 22, Corepack, pnpm 9.15.4, frozen install, then `pnpm audit` with no registry-error bypass.
- [ ] Update the exhaustive CI job-name guard to include `audit` while retaining its no-deploy purpose.
- [ ] Confirm OIDC remains absent from CI and present only at `jobs.publish-sdk.permissions`.

Verification: workflow contract tests, independent YAML parse, `pnpm audit`, frozen install, full tests/build, Compose config.

The independent YAML parse command is the PyYAML command recorded in the PER-514 plan. The final frozen install and both audits must additionally run through exact pnpm 9.15.4 (CI Corepack and, locally where Corepack is absent, an exact-version isolated invocation such as `npx --yes pnpm@9.15.4`).

Commit: `ci: enforce dependency audit policy`

### Task 6: Final supply-chain and whole-program verification

- [ ] Run `pnpm install --frozen-lockfile`.
- [ ] Run `pnpm audit --prod` and `pnpm audit`; both must exit 0.
- [ ] Run `pnpm test`, `pnpm build`, `pnpm smoke:sdk-packed`, and `docker compose config --quiet`.
- [ ] Re-run workflow action-pin and OIDC scanners plus independent YAML parsing.
- [ ] Inspect `npm pack --dry-run --json` contents from a deliberately dirty pre-build `dist` and confirm the lifecycle removes the sentinel.
- [ ] Run a fresh security-diff review and a fresh cumulative code/release review; resolve every finding and obtain exact `Ruling: APPROVED` results.
- [ ] Fetch `origin`, verify branch/base relationships, inspect Docker resources, and report retained task volumes separately from unrelated resources.

Post-merge only: observe the first GitHub CI run and the next manual SDK publish. Do not close PER-514/PER-516/PER-517/PER-518 before the evidence required by their acceptance criteria exists.
