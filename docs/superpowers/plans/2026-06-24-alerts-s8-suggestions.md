# Alerts S8 + Heuristic Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the stubbed v2 AlertsScreen into a fully wired surface — add heuristic suggestions endpoint and wire all existing mutation stubs. The channel Test button ships as a disabled affordance (test-send route is deferred to PER-364).

**Architecture:** Backend heuristics builder in `@sigmon/db`. Console adds `AlertSuggestionResponse` type + one new ApiClient method (`listAlertSuggestions`), extends the existing `useAlerts` hook with mutations and suggestions, and replaces every `pushToast` stub in AlertsScreen with real actions plus a new Suggestions card.

**Tech Stack:** Fastify (API route), Kysely + raw SQL (aggregations), Zod (route validation), React 19 + vitest/jsdom (console hook + screen tests). No new npm dependencies.

## Global Constraints

- Suggestions endpoint `GET /alerts/suggestions` is read-only, returns metadata only; human session guard.
- Admin session guard on all mutation routes.
- Deterministic heuristics — `now` injected as `Date`; no LLM.
- English UI; `.sh-v2` CSS scoping; no new npm dependencies → no lockfile change.
- `threshold` is always a decimal string.
- `notificationChannelId` is nullable on rules; one-click Create from suggestion omits it.
- New DOM test files require `// @vitest-environment jsdom` on line 1.
- Per-task commits use plain `git commit -m "feat(...): ..."` — NO Co-Authored-By or Claude-Session trailers.
- Channel test-send route (`POST /admin/notification-channels/:id/test`) is **deferred** to PER-364. The Test button ships as a disabled affordance only.
- DB heuristic tests use the real-Postgres `@testcontainers/postgresql` harness (same as `packages/db/test/repositories.test.ts`). They require Docker and run via `pnpm --filter @sigmon/db test`.

---

## Decomposition Deviation

None. Channel test-send is deferred (PER-364 follow-up) because implementing it correctly requires relocating `deliverNotification` / `deliverWebhook` / `deliverEmail` from the worker into a shared package and re-verifying worker hot paths — a cross-cutting refactor out of scope for this slice.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/db/src/repositories/alerts.ts` | Modify | Add `ERROR_COUNT_FLOOR`, `LATENCY_FLOOR_MS`, `LLM_COST_FLOOR_USD` constants + `AlertSuggestion` type + `buildAlertSuggestions()` function |
| `packages/db/test/alert-suggestions.test.ts` | Create | Real-Postgres testcontainers tests for all 4 heuristics |
| `apps/api/src/routes/alerts.ts` | Modify | Add `listAlertSuggestions?` to `AlertRouteDependencies`, add `GET /alerts/suggestions` handler |
| `apps/api/src/main.ts` | Modify | Wire `buildAlertSuggestions` |
| `apps/api/test/alerts.test.ts` | Modify | Add tests for `GET /alerts/suggestions` |
| `apps/console/src/api/types.ts` | Modify | Add `AlertSuggestionResponse` type |
| `apps/console/src/api/client.ts` | Modify | Add `AlertSuggestionApiClient` type + `listAlertSuggestions` method to `ApiClient` |
| `apps/console/src/v2/screens/useAlerts.ts` | Modify | Add suggestions to `AlertsVM`/`AlertsInput`, extend `UseAlertsResult` with actions, add `SuggestionRowVM` type, rewrite hook to expose all mutation actions |
| `apps/console/src/v2/screens/useAlerts.test.ts` | Modify | Add tests for new action methods and suggestions VM building |
| `apps/console/src/v2/screens/AlertsScreen.tsx` | Modify | Add Suggestions card, wire rule editor (create + edit), pause/resume, archive, channel panel (create + archive + disabled Test affordance) |
| `apps/console/src/v2/screens/AlertsScreen.test.tsx` | Modify | Add tests for Suggestions card, editor, channel panel interactions, disabled Test button |

---

## Task 1 — DB: `buildAlertSuggestions()` + exported constants

**Files:**
- Modify: `packages/db/src/repositories/alerts.ts` (after line 847, i.e., after `withAlertEvaluationLock`)
- Create: `packages/db/test/alert-suggestions.test.ts`

**Interfaces:**
- Consumes: `Db`, `AlertRuleType`, `AlertSeverity` from existing imports in `alerts.ts`; `sql` from kysely (already imported)
- Produces: `export const ERROR_COUNT_FLOOR`, `LATENCY_FLOOR_MS`, `LLM_COST_FLOOR_USD`; `export type AlertSuggestion`; `export async function buildAlertSuggestions(db, { projectId, environmentId, now }): Promise<AlertSuggestion[]>`

> **Note:** Tests in this task require Docker (same as `packages/db/test/repositories.test.ts`). Run with `pnpm --filter @sigmon/db test`.

### Steps

- [ ] **1.1 — Write failing tests**

  Create `packages/db/test/alert-suggestions.test.ts` beside `repositories.test.ts`:

  ```typescript
  import { PostgreSqlContainer } from "@testcontainers/postgresql";
  import { sql } from "kysely";
  import { afterAll, beforeAll, describe, expect, it } from "vitest";
  import { createDb } from "../src/client.js";
  import type { Db } from "../src/client.js";
  import { migrate } from "../src/migrate.js";
  import {
    ERROR_COUNT_FLOOR,
    LATENCY_FLOOR_MS,
    LLM_COST_FLOOR_USD,
    buildAlertSuggestions,
  } from "../src/repositories/alerts.js";

  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;

  describe("buildAlertSuggestions", () => {
    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("sigmon")
        .withUsername("sigmon")
        .withPassword("sigmon")
        .start();
    }, 60_000);

    afterAll(async () => {
      await container?.stop();
    }, 30_000);

    async function withDb<T>(run: (db: Db) => Promise<T>): Promise<T> {
      const db = createDb(container.getConnectionUri());
      try {
        return await run(db);
      } finally {
        await db.destroy();
      }
    }

    async function seedScope(db: Db, projectId: string, environmentId: string): Promise<void> {
      await sql`insert into projects (id, name) values (${projectId}, ${projectId}) on conflict (id) do nothing`.execute(db);
      await sql`
        insert into environments (id, project_id, name)
        values (${environmentId}, ${projectId}, 'production')
        on conflict (id) do nothing
      `.execute(db);
    }

    // ---------------------------------------------------------------------------
    // Exported constants
    // ---------------------------------------------------------------------------

    it("exports numeric floor constants with expected values", async () => {
      expect(typeof ERROR_COUNT_FLOOR).toBe("number");
      expect(typeof LATENCY_FLOOR_MS).toBe("number");
      expect(typeof LLM_COST_FLOOR_USD).toBe("number");
      expect(ERROR_COUNT_FLOOR).toBe(20);
      expect(LATENCY_FLOOR_MS).toBe(1000);
      expect(LLM_COST_FLOOR_USD).toBe(10);
    });

    // ---------------------------------------------------------------------------
    // Empty scope → []
    // ---------------------------------------------------------------------------

    it("returns [] when no telemetry data exists", async () => {
      await withDb(async (db) => {
        await migrate(db);
        await seedScope(db, "prj_empty", "env_empty");
        const now = new Date("2026-06-24T12:00:00Z");
        const result = await buildAlertSuggestions(db, {
          projectId: "prj_empty",
          environmentId: "env_empty",
          now,
        });
        expect(result).toEqual([]);
      });
    });

    // ---------------------------------------------------------------------------
    // critical_errors heuristic
    // ---------------------------------------------------------------------------

    it("critical_errors fires when a critical error exists in the 24h window", async () => {
      await withDb(async (db) => {
        await migrate(db);
        const projectId = "prj_ce1";
        const environmentId = "env_ce1";
        await seedScope(db, projectId, environmentId);
        const now = new Date("2026-06-24T12:00:00Z");
        // Insert a critical error 1 hour before now (within 24h window)
        await sql`
          insert into errors (id, project_id, environment_id, timestamp, received_at, message, severity)
          values (
            'err_ce1',
            ${projectId},
            ${environmentId},
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            'Something went very wrong',
            'critical'
          )
        `.execute(db);
        const suggestions = await buildAlertSuggestions(db, { projectId, environmentId, now });
        const s = suggestions.find((x) => x.type === "critical_errors");
        expect(s).toBeDefined();
        expect(s!.threshold).toBe("1");
        expect(s!.windowMinutes).toBe(60);
        expect(s!.severity).toBe("critical");
        expect(s!.cooldownMinutes).toBe(60);
      });
    });

    it("critical_errors does NOT fire when severity is 'error' (not critical/fatal)", async () => {
      await withDb(async (db) => {
        await migrate(db);
        const projectId = "prj_ce2";
        const environmentId = "env_ce2";
        await seedScope(db, projectId, environmentId);
        const now = new Date("2026-06-24T12:00:00Z");
        await sql`
          insert into errors (id, project_id, environment_id, timestamp, received_at, message, severity)
          values (
            'err_ce2',
            ${projectId},
            ${environmentId},
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            'Normal error',
            'error'
          )
        `.execute(db);
        const suggestions = await buildAlertSuggestions(db, { projectId, environmentId, now });
        expect(suggestions.find((x) => x.type === "critical_errors")).toBeUndefined();
      });
    });

    it("critical_errors does NOT fire when error timestamp is outside the 24h window", async () => {
      await withDb(async (db) => {
        await migrate(db);
        const projectId = "prj_ce3";
        const environmentId = "env_ce3";
        await seedScope(db, projectId, environmentId);
        const now = new Date("2026-06-24T12:00:00Z");
        // Error is 25 hours old — outside window
        await sql`
          insert into errors (id, project_id, environment_id, timestamp, received_at, message, severity)
          values (
            'err_ce3',
            ${projectId},
            ${environmentId},
            ${new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString()},
            ${new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString()},
            'Old critical error',
            'critical'
          )
        `.execute(db);
        const suggestions = await buildAlertSuggestions(db, { projectId, environmentId, now });
        expect(suggestions.find((x) => x.type === "critical_errors")).toBeUndefined();
      });
    });

    it("critical_errors is deduped when an active critical_errors rule exists", async () => {
      await withDb(async (db) => {
        await migrate(db);
        const projectId = "prj_ce4";
        const environmentId = "env_ce4";
        await seedScope(db, projectId, environmentId);
        const now = new Date("2026-06-24T12:00:00Z");
        await sql`
          insert into errors (id, project_id, environment_id, timestamp, received_at, message, severity)
          values (
            'err_ce4',
            ${projectId},
            ${environmentId},
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            'Critical error',
            'critical'
          )
        `.execute(db);
        // Seed an active critical_errors rule
        await sql`
          insert into alert_rules (id, project_id, environment_id, name, type, severity, window_minutes, threshold, cooldown_minutes, enabled)
          values (
            'rule_ce4',
            ${projectId},
            ${environmentId},
            'Existing critical errors rule',
            'critical_errors',
            'critical',
            60,
            '1',
            60,
            true
          )
        `.execute(db);
        const suggestions = await buildAlertSuggestions(db, { projectId, environmentId, now });
        expect(suggestions.find((x) => x.type === "critical_errors")).toBeUndefined();
      });
    });

    // ---------------------------------------------------------------------------
    // trace_p95_latency heuristic
    // ---------------------------------------------------------------------------

    it("trace_p95_latency fires when p95 >= LATENCY_FLOOR_MS and threshold = round(p95 * 1.2)", async () => {
      await withDb(async (db) => {
        await migrate(db);
        const projectId = "prj_p95_1";
        const environmentId = "env_p95_1";
        await seedScope(db, projectId, environmentId);
        const now = new Date("2026-06-24T12:00:00Z");
        // Insert 10 traces with duration_ms values so p95 >= 1000ms
        // p95 of [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000] = 1000
        for (let i = 0; i < 10; i++) {
          await sql`
            insert into traces (id, project_id, environment_id, name, status, timestamp, received_at, started_at, duration_ms)
            values (
              ${"tr_p95_1_" + i},
              ${projectId},
              ${environmentId},
              'GET /api/resource',
              'ok',
              ${new Date(now.getTime() - (i + 1) * 60 * 1000).toISOString()},
              ${new Date(now.getTime() - (i + 1) * 60 * 1000).toISOString()},
              ${new Date(now.getTime() - (i + 1) * 60 * 1000).toISOString()},
              ${1000}
            )
          `.execute(db);
        }
        const suggestions = await buildAlertSuggestions(db, { projectId, environmentId, now });
        const s = suggestions.find((x) => x.type === "trace_p95_latency");
        expect(s).toBeDefined();
        // round(1000 * 1.2) = 1200
        expect(s!.threshold).toBe("1200");
        expect(s!.windowMinutes).toBe(15);
        expect(s!.severity).toBe("warning");
      });
    });

    it("trace_p95_latency does NOT fire when p95 < LATENCY_FLOOR_MS", async () => {
      await withDb(async (db) => {
        await migrate(db);
        const projectId = "prj_p95_2";
        const environmentId = "env_p95_2";
        await seedScope(db, projectId, environmentId);
        const now = new Date("2026-06-24T12:00:00Z");
        // Insert traces with 500ms duration — well below floor
        for (let i = 0; i < 5; i++) {
          await sql`
            insert into traces (id, project_id, environment_id, name, status, timestamp, received_at, started_at, duration_ms)
            values (
              ${"tr_p95_2_" + i},
              ${projectId},
              ${environmentId},
              'GET /api/fast',
              'ok',
              ${new Date(now.getTime() - (i + 1) * 60 * 1000).toISOString()},
              ${new Date(now.getTime() - (i + 1) * 60 * 1000).toISOString()},
              ${new Date(now.getTime() - (i + 1) * 60 * 1000).toISOString()},
              ${500}
            )
          `.execute(db);
        }
        const suggestions = await buildAlertSuggestions(db, { projectId, environmentId, now });
        expect(suggestions.find((x) => x.type === "trace_p95_latency")).toBeUndefined();
      });
    });

    it("trace_p95_latency is deduped when an active rule of the same type exists", async () => {
      await withDb(async (db) => {
        await migrate(db);
        const projectId = "prj_p95_3";
        const environmentId = "env_p95_3";
        await seedScope(db, projectId, environmentId);
        const now = new Date("2026-06-24T12:00:00Z");
        for (let i = 0; i < 10; i++) {
          await sql`
            insert into traces (id, project_id, environment_id, name, status, timestamp, received_at, started_at, duration_ms)
            values (
              ${"tr_p95_3_" + i},
              ${projectId},
              ${environmentId},
              'GET /api/slow',
              'ok',
              ${new Date(now.getTime() - (i + 1) * 60 * 1000).toISOString()},
              ${new Date(now.getTime() - (i + 1) * 60 * 1000).toISOString()},
              ${new Date(now.getTime() - (i + 1) * 60 * 1000).toISOString()},
              ${2000}
            )
          `.execute(db);
        }
        await sql`
          insert into alert_rules (id, project_id, environment_id, name, type, severity, window_minutes, threshold, cooldown_minutes, enabled)
          values (
            'rule_p95_3',
            ${projectId},
            ${environmentId},
            'Existing p95 rule',
            'trace_p95_latency',
            'warning',
            15,
            '2400',
            60,
            true
          )
        `.execute(db);
        const suggestions = await buildAlertSuggestions(db, { projectId, environmentId, now });
        expect(suggestions.find((x) => x.type === "trace_p95_latency")).toBeUndefined();
      });
    });

    // ---------------------------------------------------------------------------
    // llm_cost heuristic
    // ---------------------------------------------------------------------------

    it("llm_cost fires when 24h spend >= LLM_COST_FLOOR_USD and threshold = round(cost * 1.25, 2)", async () => {
      await withDb(async (db) => {
        await migrate(db);
        const projectId = "prj_llm1";
        const environmentId = "env_llm1";
        await seedScope(db, projectId, environmentId);
        const now = new Date("2026-06-24T12:00:00Z");
        // Insert LLM calls totalling $10.00 (the floor)
        await sql`
          insert into llm_calls (id, project_id, environment_id, provider, model, status, timestamp, received_at, cost_usd)
          values (
            'llm_1',
            ${projectId},
            ${environmentId},
            'openai',
            'gpt-4o',
            'success',
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            '10.00'
          )
        `.execute(db);
        const suggestions = await buildAlertSuggestions(db, { projectId, environmentId, now });
        const s = suggestions.find((x) => x.type === "llm_cost");
        expect(s).toBeDefined();
        // round(10 * 1.25, 2) = 12.5
        expect(s!.threshold).toBe("12.5");
        expect(s!.windowMinutes).toBe(1440);
        expect(s!.severity).toBe("warning");
      });
    });

    it("llm_cost does NOT fire when 24h spend < LLM_COST_FLOOR_USD", async () => {
      await withDb(async (db) => {
        await migrate(db);
        const projectId = "prj_llm2";
        const environmentId = "env_llm2";
        await seedScope(db, projectId, environmentId);
        const now = new Date("2026-06-24T12:00:00Z");
        await sql`
          insert into llm_calls (id, project_id, environment_id, provider, model, status, timestamp, received_at, cost_usd)
          values (
            'llm_2',
            ${projectId},
            ${environmentId},
            'openai',
            'gpt-4o',
            'success',
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            '9.99'
          )
        `.execute(db);
        const suggestions = await buildAlertSuggestions(db, { projectId, environmentId, now });
        expect(suggestions.find((x) => x.type === "llm_cost")).toBeUndefined();
      });
    });

    it("llm_cost is deduped when an active llm_cost rule exists", async () => {
      await withDb(async (db) => {
        await migrate(db);
        const projectId = "prj_llm3";
        const environmentId = "env_llm3";
        await seedScope(db, projectId, environmentId);
        const now = new Date("2026-06-24T12:00:00Z");
        await sql`
          insert into llm_calls (id, project_id, environment_id, provider, model, status, timestamp, received_at, cost_usd)
          values (
            'llm_3',
            ${projectId},
            ${environmentId},
            'openai',
            'gpt-4o',
            'success',
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            '20.00'
          )
        `.execute(db);
        await sql`
          insert into alert_rules (id, project_id, environment_id, name, type, severity, window_minutes, threshold, cooldown_minutes, enabled)
          values (
            'rule_llm3',
            ${projectId},
            ${environmentId},
            'Existing LLM cost rule',
            'llm_cost',
            'warning',
            1440,
            '25',
            60,
            true
          )
        `.execute(db);
        const suggestions = await buildAlertSuggestions(db, { projectId, environmentId, now });
        expect(suggestions.find((x) => x.type === "llm_cost")).toBeUndefined();
      });
    });

    // ---------------------------------------------------------------------------
    // error_count (route-scoped) heuristic
    // ---------------------------------------------------------------------------

    it("error_count fires when peak 15-min error count >= ERROR_COUNT_FLOOR for a route", async () => {
      await withDb(async (db) => {
        await migrate(db);
        const projectId = "prj_ec1";
        const environmentId = "env_ec1";
        await seedScope(db, projectId, environmentId);
        const now = new Date("2026-06-24T12:00:00Z");
        // Insert a trace for the route
        await sql`
          insert into traces (id, project_id, environment_id, name, status, timestamp, received_at, started_at, trace_id, duration_ms)
          values (
            'tr_ec1',
            ${projectId},
            ${environmentId},
            'POST /api/checkout',
            'error',
            ${new Date(now.getTime() - 30 * 60 * 1000).toISOString()},
            ${new Date(now.getTime() - 30 * 60 * 1000).toISOString()},
            ${new Date(now.getTime() - 30 * 60 * 1000).toISOString()},
            'trace_ec1',
            ${100}
          )
        `.execute(db);
        // Insert ERROR_COUNT_FLOOR errors all in the same 15-min bucket, linked to the trace
        for (let i = 0; i < ERROR_COUNT_FLOOR; i++) {
          await sql`
            insert into errors (id, project_id, environment_id, timestamp, received_at, message, severity, trace_id)
            values (
              ${"err_ec1_" + i},
              ${projectId},
              ${environmentId},
              ${new Date(now.getTime() - 30 * 60 * 1000 + i * 1000).toISOString()},
              ${new Date(now.getTime() - 30 * 60 * 1000 + i * 1000).toISOString()},
              'Checkout error',
              'error',
              'trace_ec1'
            )
          `.execute(db);
        }
        const suggestions = await buildAlertSuggestions(db, { projectId, environmentId, now });
        const s = suggestions.find((x) => x.type === "error_count");
        expect(s).toBeDefined();
        expect(s!.routePattern).toBe("POST /api/checkout");
        // threshold = ceil(ERROR_COUNT_FLOOR * 1.5) = ceil(30) = 30
        expect(Number(s!.threshold)).toBe(Math.ceil(ERROR_COUNT_FLOOR * 1.5));
        expect(s!.windowMinutes).toBe(15);
        expect(s!.severity).toBe("warning");
      });
    });

    it("error_count does NOT fire when peak 15-min count < ERROR_COUNT_FLOOR", async () => {
      await withDb(async (db) => {
        await migrate(db);
        const projectId = "prj_ec2";
        const environmentId = "env_ec2";
        await seedScope(db, projectId, environmentId);
        const now = new Date("2026-06-24T12:00:00Z");
        await sql`
          insert into traces (id, project_id, environment_id, name, status, timestamp, received_at, started_at, trace_id, duration_ms)
          values (
            'tr_ec2',
            ${projectId},
            ${environmentId},
            'GET /api/users',
            'ok',
            ${new Date(now.getTime() - 30 * 60 * 1000).toISOString()},
            ${new Date(now.getTime() - 30 * 60 * 1000).toISOString()},
            ${new Date(now.getTime() - 30 * 60 * 1000).toISOString()},
            'trace_ec2',
            ${50}
          )
        `.execute(db);
        // Insert only ERROR_COUNT_FLOOR - 1 errors (below floor)
        for (let i = 0; i < ERROR_COUNT_FLOOR - 1; i++) {
          await sql`
            insert into errors (id, project_id, environment_id, timestamp, received_at, message, severity, trace_id)
            values (
              ${"err_ec2_" + i},
              ${projectId},
              ${environmentId},
              ${new Date(now.getTime() - 30 * 60 * 1000 + i * 1000).toISOString()},
              ${new Date(now.getTime() - 30 * 60 * 1000 + i * 1000).toISOString()},
              'User error',
              'error',
              'trace_ec2'
            )
          `.execute(db);
        }
        const suggestions = await buildAlertSuggestions(db, { projectId, environmentId, now });
        expect(suggestions.find((x) => x.type === "error_count")).toBeUndefined();
      });
    });

    // ---------------------------------------------------------------------------
    // Ordering
    // ---------------------------------------------------------------------------

    it("suggestions are returned in order: critical_errors, error_count, trace_p95_latency, llm_cost", async () => {
      await withDb(async (db) => {
        await migrate(db);
        const projectId = "prj_order";
        const environmentId = "env_order";
        await seedScope(db, projectId, environmentId);
        const now = new Date("2026-06-24T12:00:00Z");

        // Seed critical error
        await sql`
          insert into errors (id, project_id, environment_id, timestamp, received_at, message, severity)
          values (
            'err_order_crit',
            ${projectId},
            ${environmentId},
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            'Critical',
            'critical'
          )
        `.execute(db);

        // Seed slow traces for p95
        for (let i = 0; i < 10; i++) {
          await sql`
            insert into traces (id, project_id, environment_id, name, status, timestamp, received_at, started_at, duration_ms)
            values (
              ${"tr_order_" + i},
              ${projectId},
              ${environmentId},
              'GET /api/slow',
              'ok',
              ${new Date(now.getTime() - (i + 1) * 60 * 1000).toISOString()},
              ${new Date(now.getTime() - (i + 1) * 60 * 1000).toISOString()},
              ${new Date(now.getTime() - (i + 1) * 60 * 1000).toISOString()},
              ${1500}
            )
          `.execute(db);
        }

        // Seed LLM cost
        await sql`
          insert into llm_calls (id, project_id, environment_id, provider, model, status, timestamp, received_at, cost_usd)
          values (
            'llm_order',
            ${projectId},
            ${environmentId},
            'openai',
            'gpt-4o',
            'success',
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            ${new Date(now.getTime() - 60 * 60 * 1000).toISOString()},
            '15.00'
          )
        `.execute(db);

        const suggestions = await buildAlertSuggestions(db, { projectId, environmentId, now });
        const types = suggestions.map((s) => s.type);
        // error_count only fires if there are enough errors linked to a trace; not seeded here
        expect(types.indexOf("critical_errors")).toBeLessThan(types.indexOf("trace_p95_latency"));
        expect(types.indexOf("trace_p95_latency")).toBeLessThan(types.indexOf("llm_cost"));
      });
    });
  });
  ```

- [ ] **1.2 — Run test, expect FAIL**

  ```
  pnpm --filter @sigmon/db test
  ```
  Expected: compilation error or `buildAlertSuggestions is not exported`.

- [ ] **1.3 — Implement in `packages/db/src/repositories/alerts.ts`**

  Append after line 847 (after `withAlertEvaluationLock`):

  ```typescript
  // ---------------------------------------------------------------------------
  // Alert suggestion heuristics
  // ---------------------------------------------------------------------------

  export const ERROR_COUNT_FLOOR = 20;
  export const LATENCY_FLOOR_MS = 1000;
  export const LLM_COST_FLOOR_USD = 10;

  export type AlertSuggestion = {
    key: string;
    type: AlertRuleType;
    severity: AlertSeverity;
    title: string;
    sub: string;
    windowMinutes: number;
    threshold: string;
    routePattern?: string | null;
    minimumSampleSize?: number;
    rationale: string;
    cooldownMinutes: number;
  };

  export async function buildAlertSuggestions(
    db: AlertDb,
    input: { projectId: string; environmentId: string; now: Date }
  ): Promise<AlertSuggestion[]> {
    const { projectId, environmentId, now } = input;
    const window24hStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Load active (enabled, non-archived) rules for dedup check
    const activeRuleRows = await db
      .selectFrom("alert_rules")
      .select(["type", "route_pattern"])
      .where("project_id", "=", projectId)
      .where("environment_id", "=", environmentId)
      .where("enabled", "=", true)
      .where("archived_at", "is", null)
      .execute();

    const activeByType = new Map<string, Array<string | null>>();
    for (const row of activeRuleRows) {
      const existing = activeByType.get(row.type) ?? [];
      existing.push(row.route_pattern);
      activeByType.set(row.type, existing);
    }

    function hasActiveRule(type: AlertRuleType, routePattern?: string | null): boolean {
      const patterns = activeByType.get(type);
      if (!patterns || patterns.length === 0) return false;
      if (routePattern == null) return true; // any active rule of this type
      return patterns.includes(routePattern);
    }

    const suggestions: AlertSuggestion[] = [];

    // 1. critical_errors — fires when ≥1 critical/fatal error in 24h
    if (!hasActiveRule("critical_errors")) {
      const ceResult = await sql<{ value: string }>`
        select count(*)::text as value
        from errors
        where project_id = ${projectId}
          and environment_id = ${environmentId}
          and timestamp >= ${window24hStart}
          and timestamp < ${now}
          and severity in ('critical', 'fatal')
      `.execute(db);
      const ceCount = Number(ceResult.rows[0]?.value ?? "0");
      if (ceCount >= 1) {
        suggestions.push({
          key: "critical_errors",
          type: "critical_errors",
          severity: "critical",
          title: "Critical errors detected",
          sub: `${ceCount} critical/fatal error${ceCount === 1 ? "" : "s"} in the last 24h`,
          windowMinutes: 60,
          threshold: "1",
          cooldownMinutes: 60,
          rationale: `${ceCount} critical or fatal errors observed in the last 24 hours. A rule at threshold 1 will alert immediately on recurrence.`,
        });
      }
    }

    // 2. error_count (route-scoped) — busiest route's peak 15-min error count
    if (!hasActiveRule("error_count")) {
      const peakResult = await sql<{ name: string; cnt: string }>`
        with bucketed as (
          select
            t.name,
            date_trunc('hour', e.timestamp) + interval '15 min' * floor(extract(minute from e.timestamp) / 15) as bucket,
            count(*) as cnt
          from errors e
          join traces t on t.trace_id = e.trace_id
            and t.project_id = e.project_id
            and t.environment_id = e.environment_id
          where e.project_id = ${projectId}
            and e.environment_id = ${environmentId}
            and e.timestamp >= ${window24hStart}
            and e.timestamp < ${now}
            and t.name is not null
          group by t.name, bucket
        )
        select name, max(cnt)::text as cnt
        from bucketed
        group by name
        order by max(cnt) desc
        limit 1
      `.execute(db);

      const peakRow = peakResult.rows[0];
      if (peakRow) {
        const peak15 = Number(peakRow.cnt);
        if (peak15 >= ERROR_COUNT_FLOOR) {
          const threshold = Math.ceil(peak15 * 1.5);
          suggestions.push({
            key: `error_count:${peakRow.name}`,
            type: "error_count",
            severity: "warning",
            title: `High error rate on ${peakRow.name}`,
            sub: `Peak ${peak15} errors in 15 min on this route`,
            windowMinutes: 15,
            threshold: String(threshold),
            routePattern: peakRow.name,
            cooldownMinutes: 60,
            rationale: `Route "${peakRow.name}" had ${peak15} errors in a 15-minute window. Threshold set to ${threshold} (peak × 1.5, rounded up).`,
          });
        }
      }
    }

    // 3. trace_p95_latency — observed 24h p95 >= LATENCY_FLOOR_MS
    if (!hasActiveRule("trace_p95_latency")) {
      const p95Result = await sql<{ value: string | null }>`
        select case
          when count(*) = 0 then '0'
          else trim_scale(percentile_cont(0.95) within group (order by duration_ms)::numeric(18,6))::text
        end as value
        from traces
        where project_id = ${projectId}
          and environment_id = ${environmentId}
          and timestamp >= ${window24hStart}
          and timestamp < ${now}
          and duration_ms is not null
      `.execute(db);
      const p95 = Number(p95Result.rows[0]?.value ?? "0");
      if (p95 >= LATENCY_FLOOR_MS) {
        const threshold = String(Math.round(p95 * 1.2));
        suggestions.push({
          key: "trace_p95_latency",
          type: "trace_p95_latency",
          severity: "warning",
          title: "High p95 trace latency",
          sub: `24h p95: ${Math.round(p95)} ms`,
          windowMinutes: 15,
          threshold,
          cooldownMinutes: 60,
          rationale: `Observed 24h p95 latency of ${Math.round(p95)} ms exceeds ${LATENCY_FLOOR_MS} ms floor. Threshold set to ${threshold} ms (p95 × 1.2, rounded).`,
        });
      }
    }

    // 4. llm_cost — 24h LLM spend >= LLM_COST_FLOOR_USD
    if (!hasActiveRule("llm_cost")) {
      const costResult = await sql<{ value: string }>`
        select trim_scale(coalesce(sum(cost_usd), 0)::numeric(18,6))::text as value
        from llm_calls
        where project_id = ${projectId}
          and environment_id = ${environmentId}
          and timestamp >= ${window24hStart}
          and timestamp < ${now}
      `.execute(db);
      const cost24h = Number(costResult.rows[0]?.value ?? "0");
      if (cost24h >= LLM_COST_FLOOR_USD) {
        const rawThreshold = Math.round(cost24h * 1.25 * 100) / 100;
        const threshold = rawThreshold % 1 === 0 ? String(rawThreshold) : rawThreshold.toFixed(2).replace(/\.?0+$/, "");
        suggestions.push({
          key: "llm_cost",
          type: "llm_cost",
          severity: "warning",
          title: "LLM daily spend approaching limit",
          sub: `24h spend: $${cost24h.toFixed(2)}`,
          windowMinutes: 1440,
          threshold,
          cooldownMinutes: 60,
          rationale: `24-hour LLM spend of $${cost24h.toFixed(2)} exceeds $${LLM_COST_FLOOR_USD} floor. Daily-window threshold set to $${threshold} (spend × 1.25).`,
        });
      }
    }

    return suggestions;
  }
  ```

- [ ] **1.4 — Run tests, expect PASS**

  ```
  pnpm --filter @sigmon/db test
  ```
  Expected: all tests green.

- [ ] **1.5 — Commit**

  ```
  git add packages/db/src/repositories/alerts.ts packages/db/test/alert-suggestions.test.ts
  git commit -m "feat(db): add buildAlertSuggestions with 4 heuristics and exported floor constants"
  ```

---

## Task 2 — API: `GET /alerts/suggestions` route

**Files:**
- Modify: `apps/api/src/routes/alerts.ts`
- Modify: `apps/api/src/main.ts` (wire `buildAlertSuggestions`)
- Modify: `apps/api/test/alerts.test.ts`

**Interfaces:**
- Consumes: `AlertSuggestion` type from `@sigmon/db/repositories/alerts.js`
- Produces: `listAlertSuggestions?` in `AlertRouteDependencies`; `GET /alerts/suggestions` returns `{ suggestions: AlertSuggestion[] }`

### Steps

- [ ] **2.1 — Add failing test in `apps/api/test/alerts.test.ts`**

  Append to the existing `"alert history routes"` describe block:

  ```typescript
  it("returns alert suggestions for authenticated users", async () => {
    const receivedInputs: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: {
        listAlertSuggestions: async (input) => {
          receivedInputs.push(input);
          return [
            {
              key: "critical_errors",
              type: "critical_errors" as const,
              severity: "critical" as const,
              title: "Critical errors detected",
              sub: "3 critical errors in 24h",
              windowMinutes: 60,
              threshold: "1",
              cooldownMinutes: 60,
              rationale: "rationale text",
            },
          ];
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/alerts/suggestions?project_id=prj_1&environment_id=env_1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().suggestions).toHaveLength(1);
    expect(response.json().suggestions[0]).toMatchObject({
      type: "critical_errors",
      severity: "critical",
      threshold: "1",
    });
    expect(receivedInputs).toEqual([{ projectId: "prj_1", environmentId: "env_1" }]);
  });

  it("requires authentication for suggestions", async () => {
    app = await buildApp({
      readiness,
      auth: unauthenticatedAuth,
      alerts: { listAlertSuggestions: async () => [] },
    });
    const response = await app.inject({
      method: "GET",
      url: "/alerts/suggestions?project_id=prj_1&environment_id=env_1",
    });
    expect(response.statusCode).toBe(401);
  });

  it("returns 400 for suggestions with missing query params", async () => {
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: { listAlertSuggestions: async () => [] },
    });
    const response = await app.inject({
      method: "GET",
      url: "/alerts/suggestions",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_alert_suggestions_query" });
  });

  it("returns 501 when suggestions handler is unavailable", async () => {
    app = await buildApp({ readiness, auth: userAuth });
    const response = await app.inject({
      method: "GET",
      url: "/alerts/suggestions?project_id=prj_1&environment_id=env_1",
    });
    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "alerts_repository_unavailable" });
  });

  it("returns 503 when suggestions handler throws", async () => {
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: {
        listAlertSuggestions: async () => { throw new Error("db down"); },
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/alerts/suggestions?project_id=prj_1&environment_id=env_1",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "alerts_unavailable" });
  });
  ```

- [ ] **2.2 — Run test, expect FAIL**

  ```
  pnpm --filter @sigmon/api test
  ```

- [ ] **2.3 — Modify `apps/api/src/routes/alerts.ts`**

  a. Add `AlertSuggestion` to the imports at the top of `alerts.ts`:

  ```typescript
  import type { AlertSuggestion } from "@sigmon/db/repositories/alerts.js";
  ```

  b. Extend `AlertRouteDependencies`:

  Replace:
  ```typescript
  export type AlertRouteDependencies = {
    listAlertEvents?: (filters: AlertEventListFilters) => Promise<unknown[]>;
    getAlertEvent?: (id: string) => Promise<unknown | null | undefined>;
  };
  ```
  With:
  ```typescript
  export type AlertSuggestionsFilters = {
    projectId: string;
    environmentId: string;
  };

  export type AlertRouteDependencies = {
    listAlertEvents?: (filters: AlertEventListFilters) => Promise<unknown[]>;
    getAlertEvent?: (id: string) => Promise<unknown | null | undefined>;
    listAlertSuggestions?: (filters: AlertSuggestionsFilters) => Promise<AlertSuggestion[]>;
  };
  ```

  c. Add zod schema after the existing `alertEventParamsSchema`:

  ```typescript
  const alertSuggestionsQuerySchema = z.object({
    project_id: z.string().trim().min(1),
    environment_id: z.string().trim().min(1),
  });
  ```

  d. Add route inside `registerAlertRoutes`, after the existing `app.get("/alerts/events/:id", ...)` block:

  ```typescript
  app.get("/alerts/suggestions", async (request, reply) => {
    const authenticated = await requireHumanUser(request, reply, options.auth);
    if (!authenticated) {
      return reply;
    }

    if (!options.alerts?.listAlertSuggestions) {
      return reply.status(501).send({ error: "alerts_repository_unavailable" });
    }

    const parsed = alertSuggestionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_alert_suggestions_query" });
    }

    try {
      const suggestions = await options.alerts.listAlertSuggestions({
        projectId: parsed.data.project_id,
        environmentId: parsed.data.environment_id,
      });
      return reply.send({ suggestions });
    } catch {
      return reply.status(503).send({ error: "alerts_unavailable" });
    }
  });
  ```

- [ ] **2.4 — Wire in `apps/api/src/main.ts`**

  a. Add import near the other `@sigmon/db` alerts imports (around line 120):
  ```typescript
  import { buildAlertSuggestions } from "@sigmon/db/repositories/alerts.js";
  ```

  b. In the `alerts:` object passed to `buildApp` (around line 557), add:
  ```typescript
  listAlertSuggestions: (filters) =>
    buildAlertSuggestions(db, { ...filters, now: new Date() }),
  ```

- [ ] **2.5 — Update vitest alias if needed**

  Check `vitest.config.ts` line 32: `"@sigmon/db/": resolve(root, "packages/db/src/"),` — this already covers `@sigmon/db/repositories/alerts.js`. No change needed.

- [ ] **2.6 — Run tests, expect PASS**

  ```
  pnpm --filter @sigmon/api test
  ```

- [ ] **2.7 — Commit**

  ```
  git add apps/api/src/routes/alerts.ts apps/api/src/main.ts apps/api/test/alerts.test.ts
  git commit -m "feat(api): add GET /alerts/suggestions route with human-session guard"
  ```

---

## Task 3 — Console: types + ApiClient methods

**Files:**
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`

**Interfaces:**
- Produces: `AlertSuggestionResponse` type; `AlertSuggestionApiClient` type; `listAlertSuggestions` added to `ApiClient`

### Steps

- [ ] **3.1 — Add `AlertSuggestionResponse` to `apps/console/src/api/types.ts`**

  Append after the `AlertEventResponse` type (around line 1089):

  ```typescript
  export type AlertSuggestionResponse = {
    key: string;
    type: AlertRuleType;
    severity: AlertSeverity;
    title: string;
    sub: string;
    windowMinutes: number;
    threshold: string;
    routePattern?: string | null;
    minimumSampleSize?: number;
    rationale: string;
    cooldownMinutes: number;
  };
  ```

- [ ] **3.2 — Add `AlertSuggestionApiClient` type to `apps/console/src/api/client.ts`**

  a. Add import of `AlertSuggestionResponse` to the imports at the top of `client.ts`:

  In the existing types import block, add `AlertSuggestionResponse`.

  b. Add `AlertSuggestionApiClient` type after `AlertApiClient` (around line 146):

  ```typescript
  export type AlertSuggestionApiClient = {
    listAlertSuggestions: (query: { projectId: string; environmentId: string }) => Promise<{ suggestions: AlertSuggestionResponse[] }>;
  };
  ```

  c. Extend `ApiClient` type. Find the end of the `ApiClient` type definition (around line 266):

  Replace:
  ```typescript
  } & AlertApiClient &
    ErrorGroupApiClient &
    SessionTimelineApiClient &
    Partial<MonitorApiClient> &
    Partial<SourceMapApiClient>;
  ```
  With:
  ```typescript
  } & AlertApiClient &
    ErrorGroupApiClient &
    SessionTimelineApiClient &
    Partial<MonitorApiClient> &
    Partial<SourceMapApiClient> &
    Partial<AlertSuggestionApiClient>;
  ```

  d. Add path helper function near the existing `alertRuleListPath` and `alertEventListPath` helpers:

  ```typescript
  function alertSuggestionsPath(query: { projectId: string; environmentId: string }): string {
    return `/alerts/suggestions?project_id=${encodeURIComponent(query.projectId)}&environment_id=${encodeURIComponent(query.environmentId)}`;
  }
  ```

  e. Wire the new method into the `createApiClient` return object (after the `getAlertEvent` entry):

  ```typescript
  listAlertSuggestions: (query) =>
    request<{ suggestions: AlertSuggestionResponse[] }>(path(apiBasePath, alertSuggestionsPath(query))),
  ```

- [ ] **3.3 — Run TypeScript check**

  ```
  pnpm --filter @sigmon/console lint
  ```
  Expected: no errors.

- [ ] **3.4 — Commit**

  ```
  git add apps/console/src/api/types.ts apps/console/src/api/client.ts
  git commit -m "feat(console): add AlertSuggestionResponse type and listAlertSuggestions client method"
  ```

---

## Task 4 — Console: extend `useAlerts` hook with mutations + suggestions

**Files:**
- Modify: `apps/console/src/v2/screens/useAlerts.ts`
- Modify: `apps/console/src/v2/screens/useAlerts.test.ts`

**Interfaces:**
- Consumes: `ApiClient.listAlertSuggestions`, `createAlertRule`, `updateAlertRule`, `archiveAlertRule`, `createNotificationChannel`, `updateNotificationChannel`, `archiveNotificationChannel`
- Produces: extended `AlertsVM` with `suggestions: SuggestionRowVM[]`; extended `UseAlertsResult` with `busy`, `createRule`, `updateRule`, `archiveRule`, `createChannel`, `updateChannel`, `archiveChannel`, `createFromSuggestion` — all returning `Promise<boolean>`

### Steps

- [ ] **4.1 — Add failing tests to `apps/console/src/v2/screens/useAlerts.test.ts`**

  Append new describe blocks after the existing `useAlerts` describe:

  ```typescript
  // ---------------------------------------------------------------------------
  // Suggestion VM building
  // ---------------------------------------------------------------------------

  import type { AlertSuggestionResponse } from "../../api/types";

  function suggestion(over: Partial<AlertSuggestionResponse> = {}): AlertSuggestionResponse {
    return {
      key: "critical_errors",
      type: "critical_errors",
      severity: "critical",
      title: "Critical errors detected",
      sub: "3 in 24h",
      windowMinutes: 60,
      threshold: "1",
      cooldownMinutes: 60,
      rationale: "rationale",
      ...over,
    };
  }

  describe("buildAlertsVM — suggestions", () => {
    it("includes suggestions in the VM", () => {
      const vm = buildAlertsVM(
        { rules: [], events: [], channels: [], suggestions: [suggestion()] },
        NOW,
      );
      expect(vm.suggestions).toHaveLength(1);
      expect(vm.suggestions[0].key).toBe("critical_errors");
      expect(vm.suggestions[0].title).toBe("Critical errors detected");
      expect(vm.suggestions[0].severity).toBe("critical");
    });

    it("returns empty suggestions array when none provided", () => {
      const vm = buildAlertsVM({ rules: [], events: [], channels: [], suggestions: [] }, NOW);
      expect(vm.suggestions).toEqual([]);
    });
  });

  describe("useAlerts — mutation actions", () => {
    function makeFullClient() {
      return {
        listAlertRules: vi.fn().mockResolvedValue({ rules: [rule()] }),
        listAlertEvents: vi.fn().mockResolvedValue({ data: [event()] }),
        listNotificationChannels: vi.fn().mockResolvedValue({ channels: [webhookChannel] }),
        listAlertSuggestions: vi.fn().mockResolvedValue({ suggestions: [] }),
        createAlertRule: vi.fn().mockResolvedValue({ rule: rule() }),
        updateAlertRule: vi.fn().mockResolvedValue({ rule: rule() }),
        archiveAlertRule: vi.fn().mockResolvedValue(undefined),
        createNotificationChannel: vi.fn().mockResolvedValue({ channel: webhookChannel }),
        updateNotificationChannel: vi.fn().mockResolvedValue({ channel: webhookChannel }),
        archiveNotificationChannel: vi.fn().mockResolvedValue(undefined),
      };
    }

    it("createRule returns true on success and reloads", async () => {
      const client = makeFullClient();
      const { result } = renderHook(() =>
        useAlerts({ client, projectId: "p", environmentId: "e" }),
      );
      await waitFor(() => expect(result.current.status).toBe("ok"));
      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.createRule({
          name: "New rule",
          type: "critical_errors",
          severity: "critical",
          windowMinutes: 60,
          threshold: "1",
          cooldownMinutes: 60,
        });
      });
      expect(ok).toBe(true);
      expect(client.createAlertRule).toHaveBeenCalledOnce();
    });

    it("createRule returns false on error", async () => {
      const client = makeFullClient();
      client.createAlertRule = vi.fn().mockRejectedValue(new Error("boom"));
      const { result } = renderHook(() =>
        useAlerts({ client, projectId: "p", environmentId: "e" }),
      );
      await waitFor(() => expect(result.current.status).toBe("ok"));
      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.createRule({
          name: "x",
          type: "critical_errors",
          severity: "critical",
          windowMinutes: 5,
          threshold: "1",
          cooldownMinutes: 5,
        });
      });
      expect(ok).toBe(false);
    });

    it("createFromSuggestion calls createAlertRule without notificationChannelId", async () => {
      const client = makeFullClient();
      const { result } = renderHook(() =>
        useAlerts({ client, projectId: "p", environmentId: "e" }),
      );
      await waitFor(() => expect(result.current.status).toBe("ok"));
      await act(async () => {
        await result.current.createFromSuggestion(suggestion());
      });
      expect(client.createAlertRule).toHaveBeenCalledWith(
        expect.objectContaining({ type: "critical_errors", threshold: "1", notificationChannelId: undefined }),
      );
    });
  });
  ```

  Also add `act` to the import: `import { act, renderHook, waitFor } from "@testing-library/react";`

- [ ] **4.2 — Run test, expect FAIL**

  ```
  pnpm --filter @sigmon/console test
  ```

- [ ] **4.3 — Rewrite `apps/console/src/v2/screens/useAlerts.ts`**

  Full replacement (preserves all existing exports and adds new ones):

  ```typescript
  import { useCallback, useEffect, useRef, useState } from "react";
  import type { ApiClient } from "../../api/client";
  import type {
    AlertEventResponse,
    AlertRuleResponse,
    AlertSeverity,
    AlertSuggestionResponse,
    CreateAlertRuleInput,
    CreateNotificationChannelInput,
    NotificationChannelResponse,
    UpdateAlertRuleInput,
    UpdateNotificationChannelInput,
  } from "../../api/types";

  // ---------------------------------------------------------------------------
  // View-model types
  // ---------------------------------------------------------------------------

  export type SeverityTag = "critical" | "warn" | "";

  export type AlertRuleRowVM = {
    id: string;
    name: string;
    subLabel: string;
    severity: AlertSeverity;
    severityTag: SeverityTag;
    enabled: boolean;
    channelLabel: string;
    fires7d: number;
    // raw editable fields for inline editor
    type: AlertRuleResponse["type"];
    threshold: string;
    windowMinutes: number;
    cooldownMinutes: number;
    routePattern: string | null;
    minimumSampleSize: number;
    notificationChannelId: string | null;
  };

  export type ChannelRowVM = {
    id: string;
    name: string;
    icon: "webhook" | "mail";
    target: string;
    ok: boolean;
    type: "webhook" | "email";
    url: string | null;
    emailRecipients: string[];
    secretHeaderName: string | null;
    hasSecret: boolean;
  };

  export type SuggestionRowVM = {
    key: string;
    type: AlertRuleResponse["type"];
    severity: AlertSeverity;
    title: string;
    sub: string;
    windowMinutes: number;
    threshold: string;
    routePattern?: string | null;
    minimumSampleSize?: number;
    cooldownMinutes: number;
    rationale: string;
  };

  export type TimelineFireVM = { hourFraction: number; tone: "critical" | "warn" };
  export type TimelineDayVM = { label: string; fires: TimelineFireVM[] };

  export type AlertsHeaderVM = { activeRuleCount: number; fires7d: number };

  export type AlertsVM = {
    header: AlertsHeaderVM;
    rules: AlertRuleRowVM[];
    channels: ChannelRowVM[];
    timeline: TimelineDayVM[];
    suggestions: SuggestionRowVM[];
  };

  export type AlertsInput = {
    rules: AlertRuleResponse[];
    events: AlertEventResponse[];
    channels: NotificationChannelResponse[];
    suggestions: AlertSuggestionResponse[];
  };

  export type CreateRuleForm = {
    name: string;
    type: AlertRuleResponse["type"];
    severity: AlertSeverity;
    windowMinutes: number;
    threshold: string;
    cooldownMinutes: number;
    routePattern?: string | null;
    minimumSampleSize?: number;
    notificationChannelId?: string | null;
    enabled?: boolean;
  };

  export type UseAlertsResult = {
    data: AlertsVM | null;
    status: "loading" | "ok" | "error";
    busy: boolean;
    reload: () => void;
    createRule: (form: CreateRuleForm) => Promise<boolean>;
    updateRule: (id: string, input: UpdateAlertRuleInput) => Promise<boolean>;
    archiveRule: (id: string) => Promise<boolean>;
    createChannel: (input: CreateNotificationChannelInput) => Promise<boolean>;
    updateChannel: (id: string, input: UpdateNotificationChannelInput) => Promise<boolean>;
    archiveChannel: (id: string) => Promise<boolean>;
    createFromSuggestion: (s: AlertSuggestionResponse) => Promise<boolean>;
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const DAY_MS = 86_400_000;
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function severityToTag(sev: AlertSeverity): SeverityTag {
    if (sev === "critical") return "critical";
    if (sev === "warning") return "warn";
    return "";
  }

  function startOfUtcDay(ms: number): number {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  // ---------------------------------------------------------------------------
  // Pure VM builder
  // ---------------------------------------------------------------------------

  export function buildAlertsVM(input: AlertsInput, nowMs: number): AlertsVM {
    const { rules, events, channels, suggestions } = input;

    const channelName = new Map<string, string>();
    for (const c of channels) channelName.set(c.id, c.name);

    const sevenDaysAgo = nowMs - 7 * DAY_MS;
    const recentEvents = events.filter((e) => {
      const t = new Date(e.triggeredAt).getTime();
      return Number.isFinite(t) && t >= sevenDaysAgo && t <= nowMs;
    });

    const firesByRule = new Map<string, number>();
    for (const e of recentEvents) {
      if (e.ruleId) firesByRule.set(e.ruleId, (firesByRule.get(e.ruleId) ?? 0) + 1);
    }

    const ruleRows: AlertRuleRowVM[] = rules.map((r) => ({
      id: r.id,
      name: r.name,
      subLabel: `${r.type} · ${r.threshold} · ${r.windowMinutes}m`,
      severity: r.severity,
      severityTag: severityToTag(r.severity),
      enabled: r.enabled,
      channelLabel:
        (r.notificationChannelId && channelName.get(r.notificationChannelId)) || "Unassigned",
      fires7d: firesByRule.get(r.id) ?? 0,
      type: r.type,
      threshold: r.threshold,
      windowMinutes: r.windowMinutes,
      cooldownMinutes: r.cooldownMinutes,
      routePattern: r.routePattern,
      minimumSampleSize: r.minimumSampleSize,
      notificationChannelId: r.notificationChannelId,
    }));

    const channelRows: ChannelRowVM[] = channels.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.type === "webhook" ? "webhook" : "mail",
      target: c.type === "webhook" ? c.url : c.emailRecipients.join(", "),
      ok: c.enabled,
      type: c.type,
      url: c.type === "webhook" ? c.url : null,
      emailRecipients: c.type === "email" ? c.emailRecipients : [],
      secretHeaderName: c.type === "webhook" ? c.secretHeaderName : null,
      hasSecret: c.hasSecret,
    }));

    const startOfToday = startOfUtcDay(nowMs);
    const timeline: TimelineDayVM[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfToday - (6 - i) * DAY_MS);
      timeline.push({ label: `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`, fires: [] });
    }
    for (const e of recentEvents) {
      const t = new Date(e.triggeredAt).getTime();
      const dayIndex = 6 - Math.floor((startOfToday - startOfUtcDay(t)) / DAY_MS);
      if (dayIndex < 0 || dayIndex > 6) continue;
      const d = new Date(t);
      const hourFraction = (d.getUTCHours() + d.getUTCMinutes() / 60) / 24;
      timeline[dayIndex].fires.push({
        hourFraction,
        tone: e.severity === "critical" ? "critical" : "warn",
      });
    }

    const activeRuleCount = rules.filter((r) => r.enabled && r.archivedAt == null).length;

    const suggestionRows: SuggestionRowVM[] = suggestions.map((s) => ({
      key: s.key,
      type: s.type,
      severity: s.severity,
      title: s.title,
      sub: s.sub,
      windowMinutes: s.windowMinutes,
      threshold: s.threshold,
      routePattern: s.routePattern,
      minimumSampleSize: s.minimumSampleSize,
      cooldownMinutes: s.cooldownMinutes,
      rationale: s.rationale,
    }));

    return {
      header: { activeRuleCount, fires7d: recentEvents.length },
      rules: ruleRows,
      channels: channelRows,
      timeline,
      suggestions: suggestionRows,
    };
  }

  // ---------------------------------------------------------------------------
  // Hook
  // ---------------------------------------------------------------------------

  type UseAlertsArgs = {
    client: Pick<
      ApiClient,
      | "listAlertRules"
      | "listAlertEvents"
      | "listNotificationChannels"
      | "createAlertRule"
      | "updateAlertRule"
      | "archiveAlertRule"
      | "createNotificationChannel"
      | "updateNotificationChannel"
      | "archiveNotificationChannel"
    > & Partial<Pick<ApiClient, "listAlertSuggestions">>;
    projectId: string | undefined;
    environmentId: string | undefined;
  };

  export function useAlerts({ client, projectId, environmentId }: UseAlertsArgs): UseAlertsResult {
    const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
    const [data, setData] = useState<AlertsVM | null>(null);
    const [busy, setBusy] = useState(false);
    const [tick, setTick] = useState(0);
    const genRef = useRef(0);

    const reload = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
      if (!projectId || !environmentId) return;

      const gen = ++genRef.current;
      setStatus("loading");

      const nowMs = Date.now();

      const rulesFetch = client.listAlertRules({ projectId, environmentId });
      const eventsFetch = client.listAlertEvents({ projectId, environmentId, limit: 100 });
      const channelsFetch = client.listNotificationChannels();
      const suggestionsFetch = client.listAlertSuggestions
        ? client.listAlertSuggestions({ projectId, environmentId }).catch(() => ({ suggestions: [] as AlertSuggestionResponse[] }))
        : Promise.resolve({ suggestions: [] as AlertSuggestionResponse[] });

      Promise.all([rulesFetch, eventsFetch, channelsFetch, suggestionsFetch])
        .then(([rulesRes, eventsRes, channelsRes, suggestionsRes]) => {
          if (gen !== genRef.current) return;
          const vm = buildAlertsVM(
            {
              rules: rulesRes.rules,
              events: eventsRes.data,
              channels: channelsRes.channels,
              suggestions: suggestionsRes.suggestions,
            },
            nowMs,
          );
          setData(vm);
          setStatus("ok");
        })
        .catch((err) => {
          if (gen !== genRef.current) return;
          console.error(err);
          setData(null);
          setStatus("error");
        });

      return () => {
        ++genRef.current;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, environmentId, tick]);

    const run = useCallback(
      async (fn: () => Promise<void>): Promise<boolean> => {
        setBusy(true);
        try {
          await fn();
          reload();
          return true;
        } catch (err) {
          console.error(err);
          return false;
        } finally {
          setBusy(false);
        }
      },
      [reload],
    );

    const createRule = useCallback(
      (form: CreateRuleForm) =>
        run(async () => {
          if (!projectId || !environmentId) return;
          const input: CreateAlertRuleInput = {
            projectId,
            environmentId,
            name: form.name,
            type: form.type,
            severity: form.severity,
            windowMinutes: form.windowMinutes,
            threshold: form.threshold,
            cooldownMinutes: form.cooldownMinutes,
            routePattern: form.routePattern,
            minimumSampleSize: form.minimumSampleSize,
            notificationChannelId: form.notificationChannelId,
            enabled: form.enabled ?? true,
          };
          await client.createAlertRule(input);
        }),
      [client, environmentId, projectId, run],
    );

    const updateRule = useCallback(
      (id: string, input: UpdateAlertRuleInput) =>
        run(async () => {
          await client.updateAlertRule(id, input);
        }),
      [client, run],
    );

    const archiveRule = useCallback(
      (id: string) =>
        run(async () => {
          await client.archiveAlertRule(id);
        }),
      [client, run],
    );

    const createChannel = useCallback(
      (input: CreateNotificationChannelInput) =>
        run(async () => {
          await client.createNotificationChannel(input);
        }),
      [client, run],
    );

    const updateChannel = useCallback(
      (id: string, input: UpdateNotificationChannelInput) =>
        run(async () => {
          await client.updateNotificationChannel(id, input);
        }),
      [client, run],
    );

    const archiveChannel = useCallback(
      (id: string) =>
        run(async () => {
          await client.archiveNotificationChannel(id);
        }),
      [client, run],
    );

    const createFromSuggestion = useCallback(
      (s: AlertSuggestionResponse) =>
        run(async () => {
          if (!projectId || !environmentId) return;
          const input: CreateAlertRuleInput = {
            projectId,
            environmentId,
            name: s.title,
            type: s.type,
            severity: s.severity,
            windowMinutes: s.windowMinutes,
            threshold: s.threshold,
            cooldownMinutes: s.cooldownMinutes,
            routePattern: s.routePattern,
            minimumSampleSize: s.minimumSampleSize,
            enabled: true,
          };
          await client.createAlertRule(input);
        }),
      [client, environmentId, projectId, run],
    );

    return {
      data,
      status,
      busy,
      reload,
      createRule,
      updateRule,
      archiveRule,
      createChannel,
      updateChannel,
      archiveChannel,
      createFromSuggestion,
    };
  }
  ```

- [ ] **4.4 — Run tests, expect PASS**

  ```
  pnpm --filter @sigmon/console test
  ```

- [ ] **4.5 — Commit**

  ```
  git add apps/console/src/v2/screens/useAlerts.ts apps/console/src/v2/screens/useAlerts.test.ts
  git commit -m "feat(console): extend useAlerts hook with mutation actions and suggestions"
  ```

---

## Task 5 — Console: AlertsScreen Suggestions card + rule editor + pause/archive wiring

**Files:**
- Modify: `apps/console/src/v2/screens/AlertsScreen.tsx`
- Modify: `apps/console/src/v2/screens/AlertsScreen.test.tsx`

**Interfaces:**
- Consumes: `useAlerts` from `./useAlerts` — all existing exports plus new `SuggestionRowVM`, `createRule`, `updateRule`, `archiveRule`, `createFromSuggestion`, `busy`
- Consumes: `ConfirmButton` from `../../components/ui/v2`

### Steps

- [ ] **5.1 — Add failing tests to `apps/console/src/v2/screens/AlertsScreen.test.tsx`**

  Add to the existing `AlertsScreen` describe after the current last test:

  ```typescript
  import type { SuggestionRowVM } from "./useAlerts";

  // extend existing vm to include suggestions
  const vmWithSuggestions: AlertsVM = {
    ...vm,
    suggestions: [
      {
        key: "critical_errors",
        type: "critical_errors",
        severity: "critical",
        title: "Critical errors detected",
        sub: "3 in 24h",
        windowMinutes: 60,
        threshold: "1",
        cooldownMinutes: 60,
        rationale: "rationale text",
      } as SuggestionRowVM,
    ],
  };

  // Update mockUseAlerts to also return action stubs
  function mockUseAlertsWithActions(data: AlertsVM | null, status: "loading" | "ok" | "error" = "ok") {
    vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
      data,
      status,
      busy: false,
      reload: vi.fn(),
      createRule: vi.fn().mockResolvedValue(true),
      updateRule: vi.fn().mockResolvedValue(true),
      archiveRule: vi.fn().mockResolvedValue(true),
      createChannel: vi.fn().mockResolvedValue(true),
      updateChannel: vi.fn().mockResolvedValue(true),
      archiveChannel: vi.fn().mockResolvedValue(true),
      createFromSuggestion: vi.fn().mockResolvedValue(true),
    });
  }

  describe("AlertsScreen — Suggestions card", () => {
    it("renders suggestion title and Create button", () => {
      mockUseAlertsWithActions({ ...vmWithSuggestions, rules: [], channels: [] });
      render(<AlertsScreen ctx={makeCtx()} />);
      expect(screen.getByText("Critical errors detected")).toBeInTheDocument();
      expect(screen.getByText("3 in 24h")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
    });

    it("calls createFromSuggestion on Create click and toasts success", async () => {
      const spy = vi.fn().mockResolvedValue(true);
      vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
        data: { ...vmWithSuggestions, rules: [], channels: [] },
        status: "ok",
        busy: false,
        reload: vi.fn(),
        createRule: vi.fn().mockResolvedValue(true),
        updateRule: vi.fn().mockResolvedValue(true),
        archiveRule: vi.fn().mockResolvedValue(true),
        createChannel: vi.fn().mockResolvedValue(true),
        updateChannel: vi.fn().mockResolvedValue(true),
        archiveChannel: vi.fn().mockResolvedValue(true),
        createFromSuggestion: spy,
      });
      const ctx = makeCtx();
      render(<AlertsScreen ctx={ctx} />);
      await userEvent.click(screen.getByRole("button", { name: /create/i }));
      expect(spy).toHaveBeenCalledOnce();
      await waitFor(() => expect(ctx.pushToast).toHaveBeenCalledWith(expect.stringContaining("created")));
    });

    it("shows no suggestions card when suggestions are empty", () => {
      mockUseAlertsWithActions({ ...vm, suggestions: [] });
      render(<AlertsScreen ctx={makeCtx()} />);
      expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
    });
  });

  describe("AlertsScreen — pause/resume and archive", () => {
    it("pause button calls updateRule with enabled: false", async () => {
      const updateRule = vi.fn().mockResolvedValue(true);
      vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
        data: { ...vm, suggestions: [] },
        status: "ok",
        busy: false,
        reload: vi.fn(),
        createRule: vi.fn().mockResolvedValue(true),
        updateRule,
        archiveRule: vi.fn().mockResolvedValue(true),
        createChannel: vi.fn().mockResolvedValue(true),
        updateChannel: vi.fn().mockResolvedValue(true),
        archiveChannel: vi.fn().mockResolvedValue(true),
        createFromSuggestion: vi.fn().mockResolvedValue(true),
      });
      const ctx = makeCtx();
      render(<AlertsScreen ctx={ctx} />);
      // First rule row is "Critical errors in production" which is enabled
      const pauseButtons = screen.getAllByTitle("Pause");
      await userEvent.click(pauseButtons[0]);
      expect(updateRule).toHaveBeenCalledWith("r1", { enabled: false });
    });
  });
  ```

  Also add `import { waitFor } from "@testing-library/react";` to the imports.

- [ ] **5.2 — Run test, expect FAIL**

  ```
  pnpm --filter @sigmon/console test
  ```

- [ ] **5.3 — Rewrite `apps/console/src/v2/screens/AlertsScreen.tsx` (suggestions + rules portion)**

  Full replacement. This version wires suggestions, rule editor (create + edit), pause/resume, and archive. Channel panel is wired in Task 6.

  ```typescript
  import { useState } from "react";
  import { ConfirmButton, EmptyHint, Icon, PageHead, Segmented } from "../../components/ui/v2";
  import type { ScreenCtx } from "./registry";
  import { useAlerts } from "./useAlerts";
  import type {
    AlertRuleRowVM,
    ChannelRowVM,
    CreateRuleForm,
    SuggestionRowVM,
    TimelineDayVM,
  } from "./useAlerts";
  import type { AlertRuleResponse, CreateNotificationChannelInput } from "../../api/types";

  const RULE_GRID = "1.5fr 96px 90px 1fr 70px 84px";
  const FILTERS = ["All", "Active", "Paused"] as const;
  type RuleFilter = (typeof FILTERS)[number];

  // ---------------------------------------------------------------------------
  // FiresTimeline
  // ---------------------------------------------------------------------------

  function FiresTimeline({ timeline }: { timeline: TimelineDayVM[] }) {
    const total = timeline.reduce((n, d) => n + d.fires.length, 0);
    if (total === 0) {
      return (
        <p className="sh-faint" style={{ fontSize: 12, margin: 0 }}>
          No fires in the last 7 days
        </p>
      );
    }
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
        {timeline.map((day) => (
          <div key={day.label}>
            <div className="sh-faint sh-mono" style={{ fontSize: 10, marginBottom: 6 }}>
              {day.label}
            </div>
            <div
              style={{
                position: "relative",
                height: 60,
                background: "var(--bg-canvas)",
                borderRadius: 5,
                border: "1px solid var(--border-subtle)",
                overflow: "hidden",
              }}
            >
              {[6, 12, 18].map((h) => (
                <span
                  key={h}
                  style={{
                    position: "absolute",
                    left: `${(h / 24) * 100}%`,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: "var(--border-subtle)",
                  }}
                />
              ))}
              {day.fires.map((f, j) => (
                <span
                  key={j}
                  style={{
                    position: "absolute",
                    left: `${f.hourFraction * 100}%`,
                    top: 4,
                    bottom: 4,
                    width: 3,
                    borderRadius: 1,
                    background: f.tone === "critical" ? "var(--sev-critical)" : "var(--sev-warning)",
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Suggestions card
  // ---------------------------------------------------------------------------

  function SuggestionRow({
    row,
    onCreateFromSuggestion,
  }: {
    row: SuggestionRowVM;
    onCreateFromSuggestion: (row: SuggestionRowVM) => void;
  }) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>{row.title}</div>
          <div className="sh-faint sh-mono" style={{ fontSize: 10.5 }}>{row.sub}</div>
        </div>
        <button
          className="sh-btn primary"
          style={{ fontSize: 11, padding: "3px 10px" }}
          onClick={() => onCreateFromSuggestion(row)}
        >
          Create
        </button>
      </div>
    );
  }

  function SuggestionsCard({
    suggestions,
    onCreateFromSuggestion,
  }: {
    suggestions: SuggestionRowVM[];
    onCreateFromSuggestion: (row: SuggestionRowVM) => void;
  }) {
    if (suggestions.length === 0) return null;
    return (
      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">
            Suggestions
            <span
              className="sh-tag"
              style={{
                marginLeft: 8,
                background: "var(--violet-bg-subtle, #3b2f6e)",
                color: "var(--violet, #a78bfa)",
                borderColor: "transparent",
                fontSize: 9,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                verticalAlign: "middle",
              }}
            >
              AI
            </span>
          </h2>
        </div>
        <div className="sh-card__body flush">
          {suggestions.map((s) => (
            <SuggestionRow key={s.key} row={s} onCreateFromSuggestion={onCreateFromSuggestion} />
          ))}
          <p
            className="sh-faint"
            style={{ fontSize: 10.5, margin: "8px 16px 10px", lineHeight: 1.4 }}
          >
            Rules created without a channel still evaluate and record events. Attach a channel to
            enable delivery.
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Rule editor panel (create + inline edit)
  // ---------------------------------------------------------------------------

  type RuleEditorMode = "create" | { id: string; initial: CreateRuleForm };

  type RuleEditorProps = {
    mode: RuleEditorMode;
    channels: ChannelRowVM[];
    onSave: (form: CreateRuleForm) => void;
    onCancel: () => void;
    busy: boolean;
  };

  const RULE_TYPE_OPTIONS: AlertRuleResponse["type"][] = [
    "critical_errors",
    "error_count",
    "error_rate",
    "trace_p95_latency",
    "llm_cost",
  ];

  const ROUTE_PATTERN_TYPES = new Set<AlertRuleResponse["type"]>(["error_count", "error_rate", "trace_p95_latency"]);

  function RuleEditor({ mode, channels, onSave, onCancel, busy }: RuleEditorProps) {
    const initial: CreateRuleForm =
      mode === "create"
        ? {
            name: "",
            type: "critical_errors",
            severity: "warning",
            windowMinutes: 15,
            threshold: "1",
            cooldownMinutes: 60,
            routePattern: null,
            minimumSampleSize: undefined,
            notificationChannelId: null,
          }
        : mode.initial;

    const [form, setForm] = useState<CreateRuleForm>(initial);

    function set<K extends keyof CreateRuleForm>(key: K, value: CreateRuleForm[K]) {
      setForm((prev) => ({ ...prev, [key]: value }));
    }

    const thresholdValid = /^\d+(\.\d{1,6})?$/.test(form.threshold) && Number(form.threshold) > 0;

    return (
      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">{mode === "create" ? "New rule" : "Edit rule"}</h2>
          <button className="sh-btn ghost" style={{ padding: "4px 8px" }} onClick={onCancel}>
            Cancel
          </button>
        </div>
        <div className="sh-card__body" style={{ display: "grid", gap: 12, padding: 16 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">Name</span>
            <input
              className="sh-input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Rule name"
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="sh-eyebrow">Type</span>
              <select
                className="sh-select"
                value={form.type}
                onChange={(e) => set("type", e.target.value as AlertRuleResponse["type"])}
              >
                {RULE_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="sh-eyebrow">Severity</span>
              <select
                className="sh-select"
                value={form.severity}
                onChange={(e) => set("severity", e.target.value as CreateRuleForm["severity"])}
              >
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="critical">critical</option>
              </select>
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="sh-eyebrow">Window (min)</span>
              <input
                className="sh-input sh-mono"
                type="number"
                min={1}
                value={form.windowMinutes}
                onChange={(e) => set("windowMinutes", Number(e.target.value))}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="sh-eyebrow">Threshold</span>
              <input
                className="sh-input sh-mono"
                value={form.threshold}
                onChange={(e) => set("threshold", e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="sh-eyebrow">Cooldown (min)</span>
              <input
                className="sh-input sh-mono"
                type="number"
                min={1}
                value={form.cooldownMinutes}
                onChange={(e) => set("cooldownMinutes", Number(e.target.value))}
              />
            </label>
          </div>
          {ROUTE_PATTERN_TYPES.has(form.type) && (
            <label style={{ display: "grid", gap: 4 }}>
              <span className="sh-eyebrow">Route pattern</span>
              <input
                className="sh-input sh-mono"
                value={form.routePattern ?? ""}
                onChange={(e) => set("routePattern", e.target.value || null)}
                placeholder="GET /api/v1/endpoint (optional)"
              />
            </label>
          )}
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">Notification channel</span>
            <select
              className="sh-select"
              value={form.notificationChannelId ?? ""}
              onChange={(e) => set("notificationChannelId", e.target.value || null)}
            >
              <option value="">None</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              className="sh-btn primary"
              disabled={!form.name.trim() || !thresholdValid || busy}
              onClick={() => onSave(form)}
            >
              {mode === "create" ? "Create rule" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // AlertRuleRow
  // ---------------------------------------------------------------------------

  type AlertRuleRowProps = {
    row: AlertRuleRowVM;
    channels: ChannelRowVM[];
    onPauseResume: (id: string, enabled: boolean) => void;
    onArchive: (id: string) => void;
    onEditOpen: (row: AlertRuleRowVM) => void;
    busy: boolean;
  };

  function AlertRuleRow({ row, onPauseResume, onArchive, onEditOpen, busy }: AlertRuleRowProps) {
    return (
      <div className="sh-row alert-row" style={{ gridTemplateColumns: RULE_GRID }}>
        <div>
          <strong style={{ fontSize: 12.5 }}>{row.name}</strong>
          <div className="sh-faint sh-mono" style={{ fontSize: 11 }}>
            {row.subLabel}
          </div>
        </div>
        <span
          className={`sh-tag ${row.severityTag}`}
          style={{ textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}
        >
          {row.severity}
        </span>
        <span>
          <span
            className="sh-tag"
            style={{
              background: row.enabled ? "var(--accent-bg-subtle)" : "var(--bg-surface-3)",
              color: row.enabled ? "var(--accent)" : "var(--fg-muted)",
              borderColor: "transparent",
            }}
          >
            {row.enabled ? "● active" : "paused"}
          </span>
        </span>
        <span style={{ fontSize: 12 }}>{row.channelLabel}</span>
        <span
          className="sh-mono"
          style={{
            fontSize: 12,
            fontVariantNumeric: "tabular-nums",
            color: row.fires7d > 0 ? "var(--sev-critical)" : "var(--fg-muted)",
          }}
        >
          {row.fires7d}
        </span>
        <div className="alert-row__actions" style={{ display: "flex", gap: 4 }}>
          <button
            className="sh-iconbtn-sm"
            title="Edit rule"
            disabled={busy}
            onClick={() => onEditOpen(row)}
          >
            <Icon name="edit" size={13} />
          </button>
          <button
            className="sh-iconbtn-sm"
            title={row.enabled ? "Pause" : "Resume"}
            disabled={busy}
            onClick={() => onPauseResume(row.id, !row.enabled)}
          >
            <Icon name={row.enabled ? "clock" : "play"} size={13} />
          </button>
          <ConfirmButton
            label={<Icon name="archive" size={13} />}
            confirmLabel="Confirm"
            className="sh-iconbtn-sm"
            title="Archive rule"
            disabled={busy}
            onConfirm={() => onArchive(row.id)}
          />
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // ChannelRow — Test button is a disabled affordance (test-send deferred to PER-364)
  // ---------------------------------------------------------------------------

  type ChannelRowProps = {
    row: ChannelRowVM;
    onArchive: (id: string) => void;
    busy: boolean;
  };

  function ChannelRow({ row, onArchive, busy }: ChannelRowProps) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "11px 16px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <span style={{ color: row.ok ? "var(--accent)" : "var(--sev-warning)" }}>
          <Icon name={row.icon} size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5 }}>{row.name}</div>
          <div
            className="sh-faint sh-mono"
            style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {row.target}
          </div>
        </div>
        <button
          className="sh-tag mono"
          disabled
          title="Test send coming soon"
        >
          test
        </button>
        <ConfirmButton
          label={<Icon name="archive" size={12} />}
          confirmLabel="Archive"
          className="sh-iconbtn-sm"
          title="Archive channel"
          disabled={busy}
          onConfirm={() => onArchive(row.id)}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Channel editor panel (create)
  // ---------------------------------------------------------------------------

  type ChannelEditorProps = {
    onSave: (input: CreateNotificationChannelInput) => void;
    onCancel: () => void;
    busy: boolean;
  };

  type ChannelType = "webhook" | "email";

  function ChannelEditor({ onSave, onCancel, busy }: ChannelEditorProps) {
    const [channelType, setChannelType] = useState<ChannelType>("webhook");
    const [name, setName] = useState("");
    const [url, setUrl] = useState("");
    const [secretHeaderName, setSecretHeaderName] = useState("");
    const [secretHeaderValue, setSecretHeaderValue] = useState("");
    const [emailRecipients, setEmailRecipients] = useState("");

    function handleSave() {
      if (channelType === "webhook") {
        onSave({
          type: "webhook",
          name,
          url,
          secretHeaderName: secretHeaderName || null,
          secretHeaderValue: secretHeaderValue || null,
        });
      } else {
        const recipients = emailRecipients.split(",").map((e) => e.trim()).filter(Boolean);
        onSave({ type: "email", name, emailRecipients: recipients });
      }
    }

    const valid =
      name.trim().length > 0 &&
      (channelType === "webhook" ? url.trim().length > 0 : emailRecipients.trim().length > 0);

    return (
      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">New channel</h2>
          <button className="sh-btn ghost" style={{ padding: "4px 8px" }} onClick={onCancel}>
            Cancel
          </button>
        </div>
        <div className="sh-card__body" style={{ display: "grid", gap: 12, padding: 16 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Segmented
              options={["webhook", "email"]}
              value={channelType}
              onChange={(v) => setChannelType(v as ChannelType)}
            />
          </div>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">Name</span>
            <input className="sh-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Slack #incidents" />
          </label>
          {channelType === "webhook" ? (
            <>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="sh-eyebrow">Webhook URL</span>
                <input className="sh-input sh-mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="sh-eyebrow">Secret header name (optional)</span>
                <input className="sh-input sh-mono" value={secretHeaderName} onChange={(e) => setSecretHeaderName(e.target.value)} placeholder="X-Sigmon-Secret" />
              </label>
              {secretHeaderName && (
                <label style={{ display: "grid", gap: 4 }}>
                  <span className="sh-eyebrow">Secret header value</span>
                  <input className="sh-input sh-mono" type="password" value={secretHeaderValue} onChange={(e) => setSecretHeaderValue(e.target.value)} />
                </label>
              )}
            </>
          ) : (
            <label style={{ display: "grid", gap: 4 }}>
              <span className="sh-eyebrow">Recipients (comma-separated)</span>
              <input className="sh-input sh-mono" value={emailRecipients} onChange={(e) => setEmailRecipients(e.target.value)} placeholder="ops@example.com, sre@example.com" />
            </label>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="sh-btn primary" disabled={!valid || busy} onClick={handleSave}>
              Create channel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // AlertsScreen
  // ---------------------------------------------------------------------------

  export function AlertsScreen({ ctx }: { ctx: ScreenCtx }) {
    const [filter, setFilter] = useState<RuleFilter>("All");
    const [ruleEditor, setRuleEditor] = useState<"closed" | "create" | { id: string; initial: CreateRuleForm }>("closed");
    const [channelEditor, setChannelEditor] = useState(false);

    const projectId = ctx.project?.id;
    const environmentId = ctx.environment?.id;

    const {
      data,
      status,
      busy,
      createRule,
      updateRule,
      archiveRule,
      createChannel,
      archiveChannel,
      createFromSuggestion,
    } = useAlerts({ client: ctx.client, projectId, environmentId });

    if (!ctx.project || !ctx.environment) {
      return (
        <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
          <EmptyHint
            icon="bell"
            title="No project selected"
            sub="Select a project and environment to view alerts."
          />
        </div>
      );
    }

    if (status === "loading" && !data) {
      return (
        <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
          <EmptyHint icon="bell" title="Loading…" sub="Fetching alert rules and history." />
        </div>
      );
    }

    if (status === "error" || !data) {
      return (
        <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
          <EmptyHint icon="alert" title="Could not load alerts" sub="Check your connection or try again." />
        </div>
      );
    }

    const { header, rules, channels, timeline, suggestions } = data;
    const shownRules = rules.filter((r) =>
      filter === "All" ? true : filter === "Active" ? r.enabled : !r.enabled,
    );

    async function handleCreateRule(form: CreateRuleForm) {
      const ok = await createRule(form);
      if (ok) {
        setRuleEditor("closed");
        ctx.pushToast("Rule created");
      } else {
        ctx.pushToast("Failed to create rule");
      }
    }

    async function handleUpdateRule(id: string, form: CreateRuleForm) {
      const ok = await updateRule(id, {
        name: form.name,
        type: form.type,
        severity: form.severity,
        windowMinutes: form.windowMinutes,
        threshold: form.threshold,
        cooldownMinutes: form.cooldownMinutes,
        routePattern: form.routePattern,
        minimumSampleSize: form.minimumSampleSize,
        notificationChannelId: form.notificationChannelId,
      });
      if (ok) {
        setRuleEditor("closed");
        ctx.pushToast("Rule saved");
      } else {
        ctx.pushToast("Failed to save rule");
      }
    }

    async function handlePauseResume(id: string, enabled: boolean) {
      const ok = await updateRule(id, { enabled });
      if (!ok) ctx.pushToast(`Failed to ${enabled ? "resume" : "pause"} rule`);
    }

    async function handleArchiveRule(id: string) {
      const ok = await archiveRule(id);
      if (!ok) ctx.pushToast("Failed to archive rule");
    }

    async function handleCreateChannel(input: Parameters<typeof createChannel>[0]) {
      const ok = await createChannel(input);
      if (ok) {
        setChannelEditor(false);
        ctx.pushToast("Channel created");
      } else {
        ctx.pushToast("Failed to create channel");
      }
    }

    async function handleArchiveChannel(id: string) {
      const ok = await archiveChannel(id);
      if (!ok) ctx.pushToast("Failed to archive channel");
    }

    async function handleCreateFromSuggestion(row: SuggestionRowVM) {
      const ok = await createFromSuggestion({
        key: row.key,
        type: row.type,
        severity: row.severity,
        title: row.title,
        sub: row.sub,
        windowMinutes: row.windowMinutes,
        threshold: row.threshold,
        routePattern: row.routePattern,
        minimumSampleSize: row.minimumSampleSize,
        cooldownMinutes: row.cooldownMinutes,
        rationale: row.rationale,
      });
      ctx.pushToast(ok ? "Rule created from suggestion" : "Failed to create rule");
    }

    function openEditRule(row: AlertRuleRowVM) {
      setRuleEditor({
        id: row.id,
        initial: {
          name: row.name,
          type: row.type,
          severity: row.severity,
          windowMinutes: row.windowMinutes,
          threshold: row.threshold,
          cooldownMinutes: row.cooldownMinutes,
          routePattern: row.routePattern,
          minimumSampleSize: row.minimumSampleSize,
          notificationChannelId: row.notificationChannelId,
        },
      });
    }

    return (
      <>
        <PageHead
          title="Alerts"
          sub={`${header.activeRuleCount} active rules · ${header.fires7d} fires in the last 7 days`}
          actions={
            <>
              <button
                className="sh-btn"
                disabled={busy}
                onClick={() => setChannelEditor(true)}
              >
                <Icon name="webhook" size={13} />
                Channels
              </button>
              <button
                className="sh-btn primary"
                disabled={busy}
                onClick={() => setRuleEditor("create")}
              >
                <Icon name="plus" size={13} />
                New rule
              </button>
            </>
          }
        />

        {suggestions.length > 0 && (
          <SuggestionsCard suggestions={suggestions} onCreateFromSuggestion={handleCreateFromSuggestion} />
        )}

        {ruleEditor !== "closed" && (
          <RuleEditor
            mode={ruleEditor === "create" ? "create" : ruleEditor}
            channels={channels}
            busy={busy}
            onCancel={() => setRuleEditor("closed")}
            onSave={(form) => {
              if (ruleEditor === "create") {
                handleCreateRule(form);
              } else {
                handleUpdateRule(ruleEditor.id, form);
              }
            }}
          />
        )}

        {channelEditor && (
          <ChannelEditor
            busy={busy}
            onCancel={() => setChannelEditor(false)}
            onSave={handleCreateChannel}
          />
        )}

        <div className="sh-card">
          <div className="sh-card__head">
            <h2 className="sh-h2">Recent history</h2>
            <span className="sh-faint" style={{ fontSize: 11 }}>
              last 7 days
            </span>
          </div>
          <div className="sh-card__body">
            <FiresTimeline timeline={timeline} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
          <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="sh-card__head">
              <h2 className="sh-h2">Rules</h2>
              <Segmented options={[...FILTERS]} value={filter} onChange={(v) => setFilter(v as RuleFilter)} />
            </div>
            <div className="sh-row sh-row__head" style={{ gridTemplateColumns: RULE_GRID }}>
              <span>Rule</span>
              <span>Severity</span>
              <span>State</span>
              <span>Channel</span>
              <span>7d</span>
              <span>Actions</span>
            </div>
            <div style={{ overflow: "auto", flex: 1 }}>
              {shownRules.length === 0 ? (
                <EmptyHint icon="bell" title="No alert rules" sub="No rules match this filter." />
              ) : (
                shownRules.map((row) => (
                  <AlertRuleRow
                    key={row.id}
                    row={row}
                    channels={channels}
                    busy={busy}
                    onPauseResume={handlePauseResume}
                    onArchive={handleArchiveRule}
                    onEditOpen={openEditRule}
                  />
                ))
              )}
            </div>
          </div>

          <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="sh-card__head">
              <h2 className="sh-h2">Channels</h2>
              <button
                className="sh-btn ghost"
                style={{ padding: "4px 8px" }}
                disabled={busy}
                onClick={() => setChannelEditor(true)}
              >
                <Icon name="plus" size={13} />
              </button>
            </div>
            <div className="sh-card__body flush">
              {channels.length === 0 ? (
                <EmptyHint icon="webhook" title="No channels" sub="No notification channels configured." />
              ) : (
                channels.map((row) => (
                  <ChannelRow
                    key={row.id}
                    row={row}
                    busy={busy}
                    onArchive={handleArchiveChannel}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </>
    );
  }
  ```

- [ ] **5.4 — Run tests, expect PASS**

  ```
  pnpm --filter @sigmon/console test
  ```

  > **Note:** Existing tests that call `mockUseAlerts` (without actions) will need to be updated to include the new action stubs. Update those tests to use `mockUseAlertsWithActions` or add the missing fields to the existing mock shape.

- [ ] **5.5 — TypeScript check**

  ```
  pnpm --filter @sigmon/console lint
  ```

- [ ] **5.6 — Commit**

  ```
  git add apps/console/src/v2/screens/AlertsScreen.tsx apps/console/src/v2/screens/AlertsScreen.test.tsx
  git commit -m "feat(console): wire AlertsScreen — suggestions card, rule editor, pause/archive, channel panel with disabled Test affordance"
  ```

---

## Task 6 — Console: AlertsScreen channels panel tests

**Files:**
- Modify: `apps/console/src/v2/screens/AlertsScreen.test.tsx`

**Interfaces:**
- Consumes: `ChannelRow` (rendered inside `AlertsScreen`) — Test button is disabled with `title="Test send coming soon"`

### Steps

- [ ] **6.1 — Add failing channel-panel tests**

  Append to `AlertsScreen.test.tsx`:

  ```typescript
  describe("AlertsScreen — channels panel", () => {
    it("renders channel name and target", () => {
      mockUseAlertsWithActions(vm);
      render(<AlertsScreen ctx={makeCtx()} />);
      // vm includes a webhook channel "Slack #alerts"
      expect(screen.getByText("Slack #alerts")).toBeInTheDocument();
    });

    it("renders the Test button as disabled with a hint", () => {
      mockUseAlertsWithActions(vm);
      render(<AlertsScreen ctx={makeCtx()} />);
      const testBtn = screen.getByRole("button", { name: /test/i });
      expect(testBtn).toBeDisabled();
      expect(testBtn).toHaveAttribute("title", "Test send coming soon");
    });

    it("calls archiveChannel on archive confirm", async () => {
      const archiveChannel = vi.fn().mockResolvedValue(true);
      vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
        data: vm,
        status: "ok",
        busy: false,
        reload: vi.fn(),
        createRule: vi.fn().mockResolvedValue(true),
        updateRule: vi.fn().mockResolvedValue(true),
        archiveRule: vi.fn().mockResolvedValue(true),
        createChannel: vi.fn().mockResolvedValue(true),
        updateChannel: vi.fn().mockResolvedValue(true),
        archiveChannel,
        createFromSuggestion: vi.fn().mockResolvedValue(true),
      });
      render(<AlertsScreen ctx={makeCtx()} />);
      // Click the archive ConfirmButton — first click shows confirm, second confirms
      const archiveBtns = screen.getAllByTitle("Archive channel");
      await userEvent.click(archiveBtns[0]);
      const confirmBtn = screen.getByRole("button", { name: /archive/i });
      await userEvent.click(confirmBtn);
      expect(archiveChannel).toHaveBeenCalledWith(expect.any(String));
    });
  });
  ```

- [ ] **6.2 — Run test, expect PASS** (implementation already in place from Task 5)

  ```
  pnpm --filter @sigmon/console test
  ```

- [ ] **6.3 — Commit**

  ```
  git add apps/console/src/v2/screens/AlertsScreen.test.tsx
  git commit -m "test(console): add channel panel tests — disabled Test affordance + archive"
  ```

---

## Task 7 — Final verification gate

- [ ] **7.1 — Full test suite**

  ```
  pnpm test
  ```
  Expected: all tests pass.

- [ ] **7.2 — TypeScript build**

  ```
  pnpm build
  ```
  Expected: no errors across all packages.

- [ ] **7.3 — SDK build**

  ```
  pnpm --filter @sigmon/sdk build
  ```
  Expected: pass.

- [ ] **7.4 — Docker Compose config**

  ```
  docker compose config
  ```
  Expected: valid config, no errors.

- [ ] **7.5 — Commit if any fixups**

  Only if fixups were needed during verification:
  ```
  git add <changed files>
  git commit -m "fix(alerts): verification gate fixups"
  ```

---

## Key decisions recorded

1. **Channel test-send deferred**: `POST /admin/notification-channels/:id/test` and `testNotificationChannel` are deferred to PER-364. The channel Test button ships as a visible, disabled affordance (`disabled` + `title="Test send coming soon"`). No `testChannel` method in `useAlerts`.

2. **No new npm deps**: Suggestions use the same Kysely + raw SQL pattern as `evaluateAlertRule`. No analytics library, no LLM.

3. **`buildAlertSuggestions` test strategy**: Tests use the real-Postgres `@testcontainers/postgresql` harness (same pattern as `packages/db/test/repositories.test.ts`) — `PostgreSqlContainer`, `createDb(container.getConnectionUri())`, `migrate(db)`, seed via `sql\`insert into...\`.execute(db)`. This exercises real SQL including `percentile_cont`, `date_trunc`, and `trim_scale`. Requires Docker.

4. **`useAlerts` hook extension**: The existing `UseAlertsResult` type is extended (not replaced). `testChannel` removed — the channel panel renders the button disabled, no callback needed. Existing `buildAlertsVM` tests continue to pass by adding `suggestions: []` to the `AlertsInput` they pass — the function signature change is additive.

5. **AlertsScreen existing tests**: Tests that spy on `useAlerts` with the old shape (no action methods) must add dummy action stubs. Task 5 step 5.4 covers this.
