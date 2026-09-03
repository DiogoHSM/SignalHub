# Audit Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for code tasks and superpowers:executing-plans for operator tasks. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge/deploy the reviewed audit fixes, publish SDK 0.2.1, and safely remove unused task artifacts.

**Architecture:** Complete the existing dependency plan first. Prepare a patch SDK release, then pass final branch gates before GitHub publication. Deploy the three Coolify applications through a coordinated data migration, verify live behavior, and only then clean resources proven unused.

**Tech Stack:** pnpm 9.15.4, Node 22/24, GitHub Actions/OIDC, Coolify, PostgreSQL, Redis, Docker.

**Spec:** `docs/superpowers/specs/2026-09-03-audit-release-design.md`

## Global Constraints

- Preserve Node 22 application CI (Testcontainers requires >=22.22), Node 24 publishing, pnpm 9.15.4 and job-scoped npm OIDC.
- No deploy before final reviews, zero-advisory audits, frozen install, full tests/build, packed SDK smoke, Compose smoke and workflow verification.
- Never print credentials or copy browser session material. Secure encryption-key escrow and a verified backup are mandatory before migration.
- No volume deletion, broad Docker prune, unrelated project cleanup, or destructive rollback.
- User merge/deploy/publish authority supersedes the old dependency plan's no-release boundary only after its checks/reviews pass. Implementation workers still must not perform external release actions.

### Task 1: Prepare SDK 0.2.1 release metadata

**Files:** Modify `packages/sdk/package.json`, `packages/sdk/CHANGELOG.md`, and `pnpm-lock.yaml` only if the version changes lock metadata. Test existing SDK tests and `packages/sdk/scripts/sdk-artifact-lifecycle.test.ts`.

**Interfaces:** Consumes reviewed SDK privacy/dependency/artifact fixes and clean dependency graph. Produces an unpublished 0.2.1 package with unchanged exports for the release workflow.

- [ ] Compare `sdk-v0.2.0..HEAD` SDK exports and public behavior; confirm patch compatibility.
- [ ] Change package version from `0.2.0` to `0.2.1` with apply_patch. Prepend this changelog entry, refining only to match verified code:

```markdown
## 0.2.1

### Fixed

- Apply URL privacy sanitization consistently to captured browser context.
- Rebuild packages from clean staged output and reject stale or private-workspace runtime artifacts.
- Update vulnerable runtime dependencies without changing public exports.
```

- [ ] Run exact-pnpm frozen install, SDK tests/build and `pnpm smoke:sdk-packed`; inspect pack manifest version/exports. Verify changelog statements against diff. No publish in this task.
- [ ] Commit `chore(sdk): prepare 0.2.1 release` and obtain task-scoped independent review.

### Task 2: Final gates and GitHub release source

**Files:** Read `.github/workflows/ci.yml`, `.github/workflows/publish-sdk.yml`, all audit plans and verification evidence. Record redacted release evidence in `docs/superpowers/evidence/2026-09-03-audit-release.md`.

**Interfaces:** Consumes approved Task 1 and existing dependency-plan Tasks 1–6. Produces a full reviewed merge SHA and green applicable CI for production/npm.

- [ ] Finish the dependency plan and run fresh cumulative code/security review; fix all required findings.
- [ ] On intended committed source run exact-pnpm frozen install, both audits, full tests/build, SDK pack smoke, `docker compose config --quiet`, doctor and `pnpm smoke:compose` in isolated test environment. Retain exact commands/counts/results.
- [ ] Fetch `origin`; inspect main ancestry and user changes. Fast-forward safely, never stash/reset user work. Push the audited branch, create/reuse its PR and merge only after required checks pass. Do not bypass branch protection.
- [ ] Fetch again, record merged SHA, and verify applicable CI for that source. Keep npm publication manual.

### Task 3: Prepare and perform coordinated production rollout

**Files:** Read `.claude/docs/DEPLOYMENT.md`, `SELF-HOSTING.md`, `.env.example`, `Dockerfile`, `scripts/migrate-integration-secrets.ts`; record only non-secret operational evidence in the release evidence file.

**Interfaces:** Consumes merged SHA and user-provisioned runtime secrets. Produces same-SHA healthy API/worker/scheduler with encrypted integration data and preserved storage.

- [ ] Through signed-in Chrome Coolify inspect exact API/worker/scheduler mounts, config and Docker identities. Inspect host CPU/memory/disk read-only. Verify all required keys by presence/shape without emitting values.
- [ ] Resolve missing durable storage before container replacement: inventory source-map/backup paths, copy existing data to owned durable locations with checksums and preserve originals. Confirm same authoritative source-map root across services. Any ambiguous ownership blocks migration.
- [ ] Validate default Dockerfile runtime without SYS_ADMIN/FUSE/unconfined AppArmor or entrypoint overrides on an isolated release container with test data; check health/ready and graceful stop. Apply minimal production options only after this succeeds and the release is ready.
- [ ] Obtain user confirmation of encryption-key escrow. Create and verify pre-migration Postgres backup through the configured production backup path; retain checksum/location and source-map preservation evidence. Record old deployed SHA and exact rollback artifacts.
- [ ] Prepare one-off new-image migration runtime on the existing app network with shared production env/key and no public route. Do not improvise if this cannot be done securely.
- [ ] Stop API, queue worker and scheduler, confirming no old writers remain. Run `pnpm db:migrate`, then `pnpm secrets:migrate --kind all --batch-size 100` twice. Require the second pass to report migrated=0 and rotated=0; leave writers stopped on failure and diagnose before proceeding.
- [ ] Deploy API first, verify `/health` version equals merged SHA and `/ready` passes. Deploy queue worker then scheduler sequentially while observing host load. Do not redeploy Postgres/Redis.
- [ ] Verify fresh authentication, capability-scoped ingestion/identify, worker heartbeat, controlled integration delivery/export, backup, and shared storage. Do not call deployment complete from health alone.

### Task 4: Publish and verify npm SDK

**Files:** Read `packages/sdk/package.json`, `packages/sdk/CHANGELOG.md`, `.github/workflows/publish-sdk.yml`; append publication evidence.

**Interfaces:** Consumes merged/CI-approved source containing 0.2.1; produces immutable npm 0.2.1 and GitHub sdk-v0.2.1 release.

- [ ] Confirm npm 0.2.1 and Git tag `sdk-v0.2.1` do not already exist. If either exists, verify identity and do not overwrite.
- [ ] Create GitHub release/tag `sdk-v0.2.1` targeting the full merged SHA with verified changelog notes.
- [ ] Dispatch `Publish SDK` on the immutable release tag, observe result, and verify job-scoped OIDC/provenance. No local npm token fallback.
- [ ] Verify registry version, tarball integrity/exports and provenance; run clean-consumer validation of the published artifact. A failed/uncertain publish is inspected before any retry.

### Task 5: Final safe cleanup and handoff

**Files:** Read git worktree/branch inventories and local/remote Docker inventories; append cleanup evidence.

**Interfaces:** Consumes verified app/npm release and retained recovery artifacts. Produces synchronized main plus an exact cleanup report.

- [ ] Fetch and safely synchronize local main. List local/remote branches and linked worktrees; remove only merged, task-owned, clean orphans. Preserve user untracked files and all unmerged work.
- [ ] Inspect local and remote Docker images/containers/build cache. Match ownership and references, preserve active images and required rollback images. Delete only exact unused task-owned IDs; never run volume/system prune.
- [ ] Validate exact absolute paths before removing task scratch/worktrees. Preserve operational evidence and recovery references before deleting plan scratch.
- [ ] Fetch once more, verify production/npm source identity and repository status. Report what was removed, retained, recoverable by rebuild/pull, and any unmet acceptance checks. Only update Linear statuses when explicitly authorized and all issue-specific evidence exists.

## Self-review

Spec requirements map to Tasks 1 (patch metadata), 2 (gates/source), 3 (data/storage/secrets/deploy), 4 (npm) and 5 (cleanup). Tasks 1/2/4 share version and immutable SHA; Tasks 2/3/4 share approved source; Tasks 3/5 share preserved data and rollback artifacts. Exact command/runtime requirements agree. Operational steps deliberately discover live IDs before mutations rather than embed unverified commands.
