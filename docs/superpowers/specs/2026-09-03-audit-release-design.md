# Audit release and safe cleanup design

## Goal and authority

Publish the reviewed audit remediation to GitHub and production, publish `@sigmon/sdk` 0.2.1, then clean proven-unused task resources. The user explicitly authorized merge/push, VPS application deployment, and an SDK release when impacted. These operations remain conditional on all audit checks and reviews passing.

## Non-goals

No new product feature, database/Redis replacement, credential disclosure, broad Docker pruning, volume deletion, unrelated project cleanup, or automatic destructive rollback. Do not close Linear issues without their live acceptance evidence.

## User behavior and data changes

The current UI remains the selected design. Existing human sessions expire and require login. Browser keys cannot use server-only identify endpoints; server clients need separately scoped server keys. Schema migrations 0048–0051 and integration-secret conversion change production data. Conversion is mandatory with all API/worker/scheduler writers stopped, and is restartable. Old application images are not a safe rollback against converted records.

## Contracts

- Preserve Node 22 application CI (Testcontainers requires >=22.22), Node 24 publishing, pnpm 9.15.4 and job-scoped npm OIDC.
- SDK 0.2.1 changes only patch-level privacy, dependency and artifact-integrity fixes; no export shape changes.
- One base64-encoded 32-byte `DATA_ENCRYPTION_KEY` is securely escrowed and shared by API, queue worker, scheduler and migration runtime. Never print credentials or copy browser session material.
- Production deploy order: verified backup and configuration → stop all three writers → `pnpm db:migrate` → `pnpm secrets:migrate --kind all --batch-size 100` twice, second result zero → API → queue worker → scheduler.
- Preserve and verify source-map and backup files before container replacement. Configure durable shared storage only after exact existing paths, ownership and mounts are known.
- Remove unsupported privileged API Docker options only after the default non-root/tini runtime passes isolated validation. This is an operational hardening finding, distinct from sealed code-scan findings.

## Safety constraints

No deploy before final reviews, zero-advisory audits, frozen install, full tests/build, packed SDK smoke, Compose smoke and workflow verification. Build one production application at a time and observe host load/memory. A verified pre-migration Postgres backup and corresponding key escrow are mandatory. Restoration requires a separate decision because it can lose newer data. Never remove active images, rollback images still needed, environment artifacts, or volumes. Preserve unrelated Pinima resources and user work.

## Acceptance and verification

GitHub `main` contains the reviewed commit and applicable CI is green. Production `/health` reports the full intended SHA and `/ready` confirms Postgres/Redis. Fresh login, browser ingestion, server identify, workers, secret-backed integration, backup and shared-storage checks pass. npm reports 0.2.1 with expected exports/tarball and provenance, and a clean consumer can install/use it. Cleanup has an exact before/after inventory and recovery description. Unmet gates are reported as pending, never completed.

## Current preflight

Chrome Coolify access is available. No production mutation has occurred. API has no `DATA_ENCRYPTION_KEY` variable and its Persistent Storage page reports no storage; both require resolution before deployment. Source baseline is 24b065b2a4cfa99365cbec8565e6dcd9f0674196. Detailed read-only evidence resides in the active dependency plan's release-preflight report; no secrets belong in committed evidence.
