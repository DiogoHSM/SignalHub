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
