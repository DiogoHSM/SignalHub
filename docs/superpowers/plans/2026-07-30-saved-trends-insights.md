# Saved Trends And Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add saved, interactive event trends with count or unique-actor metrics, optional promoted-property breakdowns, and reusable dashboard widgets.

**Architecture:** Persist insight definitions and promoted-property metadata in PostgreSQL. Query recent or filtered data directly from `events`, while an hourly rollup provides the fast path for unfiltered count trends; saved dashboards reference insight IDs instead of copying fixed overview widgets. API routes expose CRUD and preview execution, and the v2 Analytics workspace owns the builder, result chart, and saved-insight library.

**Tech Stack:** PostgreSQL 16, Kysely, Fastify, React 19, TypeScript, Vitest.

## Global Constraints

- Every query must be scoped by `project_id` and `environment_id`.
- Breakdown keys must exist in the project's promoted-property allowlist.
- Buckets are UTC and must include empty intervals.
- Unique actors use the first available stable identity in order: `user_id`, `tenant_id`, `session_id`, `trace_id`.
- Property names are validated identifiers; never interpolate unvalidated SQL identifiers.
- Existing dashboards and event aggregate clients remain backward compatible.

---

### Task 1: Persistence And Query Engine

**Files:**
- Create: `packages/db/migrations/0046_analytics_insights.sql`
- Create: `packages/db/src/repositories/analytics-insights.ts`
- Create: `packages/db/test/analytics-insights.test.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/src/repositories/analytics-dashboards.ts`

**Interfaces:**
- Produces `AnalyticsInsightRecord`, `PromotedEventProperty`, `create/list/get/update/archiveAnalyticsInsight`, `promote/archive/listEventProperty`, and `queryEventTrend`.
- `queryEventTrend` accepts `{ projectId, environmentId, from, to, bucket, metric, eventName?, breakdownProperty?, filters? }` and returns `{ buckets, series }` with zero-filled UTC buckets.
- Dashboard widget type adds `insight` with `options.insightId`.

- [x] Write repository tests for scope isolation, CRUD normalization, promoted-property enforcement, count, unique actors, breakdown, filters, and empty buckets.
- [x] Run `pnpm vitest run packages/db/test/analytics-insights.test.ts` and verify failure.
- [x] Add migration/schema/repository implementation using parameterized JSONB extraction (`properties ->> ${key}`) after identifier validation.
- [x] Run repository tests and `pnpm --filter @sigmon/db build`.

### Task 2: Hourly Rollup Worker

**Files:**
- Modify: `packages/db/migrations/0046_analytics_insights.sql`
- Modify: `packages/db/src/repositories/event-rollups.ts`
- Modify: `packages/db/test/event-rollups.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/test/telemetry-worker.test.ts`

**Interfaces:**
- Produces `EVENT_HOURLY_ROLLUP`, `upsertEventHourlyRollup`, and per-scope watermark updates.
- Rollup rows contain scope, UTC hour, event name, optional promoted breakdown key/value, count, and actor tuple data sufficient for exact hourly unique counts.

- [x] Write failing tests for idempotent hourly upsert, late-event refresh, scope watermarks, and scheduler invocation.
- [x] Implement bounded backfill and refresh the current/previous hour under the existing event-rollup advisory lock.
- [x] Run DB and worker focused tests and builds.

### Task 3: Admin And Query API

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/routes/query.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/test/admin.test.ts`
- Modify: `apps/api/test/query.test.ts`
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Modify: `apps/console/src/api/client.test.ts`

**Interfaces:**
- Admin CRUD: `/admin/analytics/insights` and `/admin/analytics/promoted-properties`.
- Preview/query: `/query/analytics/trends` accepts explicit definition or `insight_id`.
- `/query/aggregates/events` forwards `event_name`.

- [x] Write failing route/client tests for validation, authorization, scope isolation, capability errors, and event-name forwarding.
- [x] Implement routes and dependency wiring with structured 400/404/501 responses.
- [x] Add typed client methods and run API/client tests plus builds.

### Task 4: Analytics Trends Workspace

**Files:**
- Create: `apps/console/src/v2/screens/analytics/TrendsTab.tsx`
- Create: `apps/console/src/v2/screens/analytics/TrendsTab.test.tsx`
- Create: `apps/console/src/v2/screens/analytics/useTrends.ts`
- Create: `apps/console/src/v2/screens/analytics/useTrends.test.ts`
- Modify: `apps/console/src/v2/screens/AnalyticsScreen.tsx`
- Modify: `apps/console/src/v2/screens/AnalyticsScreen.test.tsx`
- Modify: `apps/console/src/styles.css`

**Interfaces:**
- Builder fields: event, metric, time window, bucket, property filters, promoted breakdown.
- Actions: preview, save, rename, duplicate, archive, and add saved insight to a dashboard.

- [x] Write failing hook/component tests for scope reset, stale-response guards, validation, preview, CRUD, and empty/error states.
- [x] Implement a compact operational builder and accessible time-series visualization using existing v2 chart primitives.
- [x] Run focused console tests, lint, and build.

### Task 5: Dashboard Integration, Docs, And Verification

**Files:**
- Modify: dashboard v2 screen/hook files discovered by `rg "AnalyticsDashboard" apps/console/src/v2`
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `apps/api/src/openapi.ts` or the repository's current OpenAPI registration modules

**Interfaces:**
- Dashboard insight widgets resolve the referenced saved definition and render the same trend result.

- [x] Add dashboard insight-widget tests and implement selection/rendering.
- [x] Document routes, data model, rollup consistency, limits, and UI workflow.
- [x] Run `pnpm test`, all package builds, `git diff --check`, and a focused independent review.
