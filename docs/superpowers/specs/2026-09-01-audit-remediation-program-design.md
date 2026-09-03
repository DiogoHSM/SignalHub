# Audit Remediation Program Design

**Date:** 2026-09-01
**Linear:** PER-502
**Source revision:** `a266f0e375c3b491a778d588cfae2c958fb2fab0`

## Goal

Resolve every validated finding from the 2026-08-31 security, product-risk, and UI/UX audits through independently reviewable changes that preserve Sigmon's self-hosted operating model.

## Non-goals

- A SaaS organization or project-membership model.
- A wholesale console redesign.
- Kubernetes, Helm, or a new deployment platform.
- A new CI provider or automatic production deployment.
- Unrelated refactoring while audit work is in progress.

## Program structure

Implementation is split into seven subprojects. Each subproject gets its own implementation plan, test cycle, review, and merge boundary.

1. [Ingestion and privacy boundaries](2026-09-01-ingestion-privacy-boundaries-design.md) — PER-504 and PER-505.
2. [Authentication, sessions, and secret storage](2026-09-01-auth-sessions-secret-storage-design.md) — PER-473 and PER-506.
3. [Retention and archived-scope lifecycle](2026-09-01-retention-lifecycle-design.md) — PER-503.
4. [Rate limiting, proxy identity, and outbound security](2026-09-01-network-egress-design.md) — PER-507 and PER-508.
5. [Backup and source-map storage ownership](2026-09-01-operational-storage-design.md) — PER-509 and PER-510.
6. [Console accessibility, responsive scope, and style primitives](2026-09-01-console-accessibility-maintainability-design.md) — PER-511, PER-512, and PER-513.
7. [CI dependency immutability](2026-09-01-ci-supply-chain-design.md) — PER-514.

The order is dependency-first. Input boundaries land before consumers are changed; authentication storage lands before session revocation is enforced; network identity lands before login source quotas rely on it; accessibility and responsive behavior land before their visual rules are extracted into shared primitives.

## Program-wide invariants

- Existing untracked workspace files are user-owned and remain untouched.
- Every behavior change begins with a regression test that is observed failing for the expected reason.
- Database migrations are forward-only and preserve a documented upgrade path.
- Unsafe legacy state fails closed or requires an explicit migration; it is never silently reinterpreted as safe.
- Production defaults are conservative. Development exceptions are explicit, narrow, and tested.
- Security-sensitive values do not appear in logs, process arguments, database plaintext columns, backups, URLs, or default MCP responses.
- Destructive data-lifecycle work proves which rows and files survive, not only what is deleted.
- Each security patch receives a separate boundary investigation and a bypass/regression review before final verification.

## Rollout model

Each subproject may merge independently after focused and repository-level checks. Schema changes use additive migrations first, followed by application migration or backfill, then removal of obsolete plaintext state only after verification. Documentation and deployment examples ship in the same slice as the contract they describe.

Linear issues remain open until their exact acceptance criteria have fresh evidence. PER-502 closes only after all child issues and the two PER-473 bindings are verified.

## Verification

Every subproject runs its focused tests, owning package build/type checks, and the relevant malicious and legitimate controls. The final program gate runs `pnpm test`, `pnpm lint`, `pnpm build`, Compose configuration validation, the Compose smoke harness when Docker is available, and a final security diff review.
