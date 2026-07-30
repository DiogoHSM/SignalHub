# Surface Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish or deliberately expose existing production capabilities so every maintained API, configuration flag, and dataset has a tested product surface or an explicit public-contract rationale.

**Architecture:** Preserve public query APIs and connect them to the v2 console where they add operational value. Keep session replay inline for now but enforce a serialized payload budget at ingestion, and extend warehouse export through the existing cursor/destination model with batched writes. All UI work stays in the v2 shell and all server mutations remain project/environment scoped.

**Tech Stack:** React 18, TypeScript, Fastify, Zod, Kysely/PostgreSQL, Vitest.

---

### Task 1: Authentication And Configuration Completeness

**Files:**
- Modify: `apps/console/src/App.tsx`
- Modify: `apps/console/src/components/AuthGate.tsx`
- Modify: `apps/console/src/components/AuthGate.test.tsx`
- Modify: `.env.example`
- Modify: `.claude/docs/DEPLOYMENT.md`
- Modify: `.claude/docs/SECRETS.md`

- [x] Add tests proving the Google sign-in action appears only when `googleOAuthEnabled` is true and targets `${apiBasePath}/auth/google`.
- [x] Pass `googleOAuthEnabled` and `apiBasePath` from console configuration into `AuthGate` and render the conditional action using the existing auth visual language.
- [x] Add `WAREHOUSE_EXPORTS_ENABLED` and `WAREHOUSE_EXPORTS_INTERVAL_MINUTES` to `.env.example` and deployment documentation with worker ownership and defaults.
- [x] Run `pnpm exec vitest run apps/console/src/components/AuthGate.test.tsx packages/config/test/config.test.ts` and `pnpm --filter @sigmon/console lint`.

### Task 2: Existing API Capabilities In The Console

**Files:**
- Modify: `apps/console/src/api/client.ts`
- Modify: `apps/console/src/api/client.test.ts`
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/v2/screens/settings/ProjectSettingsSection.tsx`
- Modify: `apps/console/src/v2/screens/settings/ProjectSettingsSection.test.tsx`
- Modify: incident and fleet v2 hooks/components discovered with `rg "useFleet|Incident" apps/console/src/v2`
- Modify: `apps/api/src/openapi.ts`

- [x] Add typed client tests and methods for paginated error-group occurrences and fleet environments while retaining trace aggregates as a documented public API.
- [x] Add a project-scoped `Releases & code` settings surface for `upsertReleaseMetadata`, including repository/commit/release validation and mutation feedback.
- [x] Load fleet environments only after a project is expanded and expose paginated occurrences in incident history without duplicating the primary occurrence.
- [x] Document trace aggregates, error-group occurrences, and fleet-environment parameters/responses in OpenAPI.
- [x] Run focused API client, settings, fleet, and incident tests plus console lint/build.

### Task 3: Warehouse Identity Datasets

**Files:**
- Modify: `packages/db/src/repositories/warehouse-exports.ts`
- Modify: `packages/db/test/warehouse-exports.test.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/openapi.ts`
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/v2/screens/settings/ProjectSettingsSection.tsx`

- [x] Write repository tests for `userProfiles` and `tenantProfiles` using a bounded cyclic snapshot cursor and scope-safe source ids.
- [x] Extend warehouse dataset types, validation, UI selection, OpenAPI, and export queries with both identity profile datasets.
- [x] Verify retries are idempotent and a cursor never skips actors sharing the same timestamp or late profile updates.
- [x] Run DB repository, admin route, and project settings tests plus DB/API/console builds.

### Task 4: Batched Warehouse Writes

**Files:**
- Modify: `apps/worker/src/warehouse-exports.ts`
- Modify: `apps/worker/test/warehouse-exports.test.ts`

- [x] Add tests asserting one parameterized multi-row upsert per non-empty dataset batch, conflict updates, empty-batch no-op, and transaction rollback on failure.
- [x] Replace row-by-row inserts with one bounded multi-row statement per dataset while preserving destination schema qualification and idempotency keys.
- [x] Run `pnpm exec vitest run apps/worker/test/warehouse-exports.test.ts` and worker build/lint.

### Task 5: Session Replay Ingestion Budget

**Files:**
- Modify: `packages/telemetry/src/ingestion-schemas.ts`
- Modify: `packages/telemetry/test/ingestion-schemas.test.ts`
- Modify: replay ingestion route tests under `apps/api/test`
- Modify: `.claude/docs/ARCHITECTURE.md`

- [x] Add tests rejecting replay payloads above 64 KiB and event `data` exceeding the agreed depth/key limits while preserving the existing 300-event cap.
- [x] Implement deterministic serialized-size and nested-object validation shared by direct HTTP ingestion and SDK-shaped payloads.
- [x] Document why replay remains inline, its privacy constraints, size budget, and the future threshold for chunked storage.
- [x] Run telemetry and replay API tests plus telemetry/API builds.

### Task 6: Final Verification And Review

- [x] Run `pnpm test`, `pnpm build`, `pnpm lint`, and `git diff --check`.
- [x] Request an independent review covering scope isolation, API compatibility, warehouse cursor correctness, SQL parameterization, replay resource limits, and UI stale-response guards.
- [x] Update `.claude/docs/PROJECT-SUMMARY.md`, `.claude/docs/ARCHITECTURE.md`, `.claude/docs/UI-UX.md`, and Linear PER-445 with the final supported surfaces.
