# Dependency Security and SDK Package Integrity Design

**Linear:** PER-516, PER-517, PER-518  
**Related:** PER-514

## Goal

Remove the dated baseline set of 66 dependency advisories without suppressions, make the SDK build and pack paths hermetic, and add CI contracts that detect future dependency and package-integrity regressions. The reproducible baseline is `docs/superpowers/evidence/2026-09-02-pnpm-audit-baseline.json`: commit, pnpm version, advisory ID, GHSA, package, installed version, scope, severity, and patched range are recorded there.

## Non-goals

- Publishing a new SDK release.
- Changing the SDK public API or application data model.
- Opportunistic dependency modernization unrelated to a validated advisory.
- Ignoring advisories or treating registry failures as success.

## User and operator behavior

End-user behavior does not change. Maintainers gain three guarantees:

1. CI rejects any known dependency advisory after a frozen install.
2. Every SDK pack or publish rebuilds from an empty `dist` tree.
3. A failed SDK build cannot be mistaken for a fresh, packable artifact.

## Dependency contracts

The production remediation starts with the narrow patched direct versions identified by the audit: Fastify 5.12.1, `@fastify/static` 10.1.3, Kysely 0.28.17, Nano ID 5.1.16, and Nodemailer 9.1.1. The development remediation starts with Vitest 3.2.7, Vite 6.4.3, jsdom 26.1.0, Testcontainers 12.1.0, and `@testcontainers/postgresql` 12.1.0.

Parent upgrades and targeted lockfile re-resolution are preferred. A transitive override is acceptable only when the post-update audit proves that no released compatible parent resolves the advisory, the override stays within the parent's declared range or has explicit compatibility evidence, and a regression test covers the affected path. No GHSA ignore list is added.

## SDK artifact contract

The SDK exposes one cross-platform build entry point. It removes `dist` and a dedicated staging directory, performs both TypeScript passes into staging, and promotes staging to `dist` only after both succeed. Any failure removes staging and `dist`, including TypeScript output emitted before a nonzero exit. `prepack` invokes that same build so `npm pack` and `npm publish` cannot reuse stale output. `prepublishOnly` is removed to avoid a second lifecycle build.

The packed-consumer smoke test inspects the tarball manifest, rejects unexpected stale sentinel files and any runtime import of private workspace packages, installs the tarball into a clean temporary consumer, and exercises the authoritative URL sanitizer and normal client entry point.

## CI and update contracts

PER-514's immutable action pins, exact npm 11.19.1, and job-scoped OIDC remain required. Dependabot covers both `github-actions` and the pnpm workspace (`npm` ecosystem) on a controlled weekly schedule. A dedicated CI audit job uses a Node 22 release satisfying Testcontainers' `>=22.22` development floor, Corepack, pnpm 9.15.4, and a frozen install before running `pnpm audit`. Registry errors remain failures.

## Data, API, safety, and privacy

No application data is created, read, updated, or deleted by this change. No API contract changes are intended. No long-lived npm token is introduced. OIDC stays limited to the publish job, release builds disable package-manager caching, and the work does not publish or deploy anything.

## Acceptance criteria

- `pnpm audit --prod` exits 0.
- `pnpm audit` exits 0 with no ignored GHSA.
- A successful repeated SDK build removes a pre-existing sentinel from `dist`.
- A forced second-pass failure cannot be followed by a successful direct pack without a fresh successful rebuild.
- `npm pack --dry-run --json` and the clean-consumer smoke prove the expected package contents.
- Full tests, builds, frozen install, Compose validation, and workflow contracts pass.
- All external GitHub Actions are full-SHA pinned with release comments; OIDC remains job-scoped.
- The final frozen-install and audits are also executed with pnpm 9.15.4; the pnpm 11.19.0 baseline capture is provenance, not a compatibility substitute.

## Rollout and verification

Land independently reviewed commits for immutable Actions, SDK artifact integrity, production dependencies, development dependencies, and the audit gate. Re-run the dated baseline audit after each dependency slice. A newly published advisory is added to the evidence and applicable Linear issue, classified by scope, and remediated before the zero-advisory gate; it is not mislabeled as drift in an old finding. Before handoff, run the repository's full verification matrix, inspect the final packed tarball, parse workflow YAML independently, and fetch the remote. The first live CI run and next manual SDK publish are post-merge observations; this branch does not publish.
