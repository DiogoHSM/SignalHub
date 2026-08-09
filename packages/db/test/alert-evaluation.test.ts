import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { createTestDb } from "./test-db.js";
import { evaluateAlertRule } from "../src/repositories/alerts.js";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;

const windowStart = new Date("2026-06-24T11:00:00Z");
const windowEnd = new Date("2026-06-24T12:00:00Z");

describe("evaluateAlertRule", () => {
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
    const db = createTestDb(container.getConnectionUri());
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

  async function seedTrace(
    db: Db,
    scope: { projectId: string; environmentId: string },
    input: { id: string; traceId: string; name: string; at: Date }
  ): Promise<void> {
    await sql`
      insert into traces (id, project_id, environment_id, trace_id, timestamp, received_at, name, status, started_at)
      values (
        ${input.id}, ${scope.projectId}, ${scope.environmentId}, ${input.traceId},
        ${input.at}, ${input.at}, ${input.name}, 'success', ${input.at}
      )
    `.execute(db);
  }

  async function seedError(
    db: Db,
    scope: { projectId: string; environmentId: string },
    input: { id: string; traceId: string | null; severity: string; at: Date }
  ): Promise<void> {
    await sql`
      insert into errors (id, project_id, environment_id, trace_id, timestamp, received_at, message, severity)
      values (
        ${input.id}, ${scope.projectId}, ${scope.environmentId}, ${input.traceId},
        ${input.at}, ${input.at}, 'boom', ${input.severity}
      )
    `.execute(db);
  }

  // ---------------------------------------------------------------------------
  // routePattern scoping
  //
  // trace_p95_latency and error_rate already scope by route. error_count and
  // critical_errors did not, so a rule scoped to one route fired on every
  // error in the environment — while getTopErrorGroupId, called in the same
  // evaluation, *did* apply the route filter. The count and the attributed
  // group disagreed with each other.
  // ---------------------------------------------------------------------------

  it("error_count counts only errors on the scoped route", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const scope = { projectId: "prj_ec", environmentId: "env_ec" };
      await seedScope(db, scope.projectId, scope.environmentId);
      const at = new Date("2026-06-24T11:30:00Z");

      await seedTrace(db, scope, { id: "t_checkout", traceId: "trace_checkout", name: "POST /checkout", at });
      await seedTrace(db, scope, { id: "t_health", traceId: "trace_health", name: "GET /health", at });
      await seedError(db, scope, { id: "e_checkout", traceId: "trace_checkout", severity: "error", at });
      await seedError(db, scope, { id: "e_health_1", traceId: "trace_health", severity: "error", at });
      await seedError(db, scope, { id: "e_health_2", traceId: "trace_health", severity: "error", at });

      const scoped = await evaluateAlertRule(db, {
        ...scope,
        type: "error_count",
        windowStart,
        windowEnd,
        routePattern: "POST /checkout"
      });
      expect(scoped.observedValue).toBe("1");

      const unscoped = await evaluateAlertRule(db, {
        ...scope,
        type: "error_count",
        windowStart,
        windowEnd
      });
      expect(unscoped.observedValue).toBe("3");
    });
  });

  it("critical_errors counts only critical errors on the scoped route", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const scope = { projectId: "prj_ce", environmentId: "env_ce" };
      await seedScope(db, scope.projectId, scope.environmentId);
      const at = new Date("2026-06-24T11:30:00Z");

      await seedTrace(db, scope, { id: "t_pay", traceId: "trace_pay", name: "POST /pay", at });
      await seedTrace(db, scope, { id: "t_ping", traceId: "trace_ping", name: "GET /ping", at });
      await seedError(db, scope, { id: "e_pay", traceId: "trace_pay", severity: "critical", at });
      await seedError(db, scope, { id: "e_ping", traceId: "trace_ping", severity: "fatal", at });
      // Same route, but not critical — must stay out of the count.
      await seedError(db, scope, { id: "e_pay_warn", traceId: "trace_pay", severity: "error", at });

      const scoped = await evaluateAlertRule(db, {
        ...scope,
        type: "critical_errors",
        windowStart,
        windowEnd,
        routePattern: "POST /pay"
      });
      expect(scoped.observedValue).toBe("1");

      const unscoped = await evaluateAlertRule(db, {
        ...scope,
        type: "critical_errors",
        windowStart,
        windowEnd
      });
      expect(unscoped.observedValue).toBe("2");
    });
  });

  it("error_count does not double-count when a trace id maps to several trace names", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const scope = { projectId: "prj_fanout", environmentId: "env_fanout" };
      await seedScope(db, scope.projectId, scope.environmentId);
      const at = new Date("2026-06-24T11:30:00Z");

      // One trace id, two rows with the same name: a join would fan out and
      // report 2 for a single error.
      await seedTrace(db, scope, { id: "t_a", traceId: "trace_dup", name: "POST /checkout", at });
      await seedTrace(db, scope, { id: "t_b", traceId: "trace_dup", name: "POST /checkout", at });
      await seedError(db, scope, { id: "e_dup", traceId: "trace_dup", severity: "error", at });

      const result = await evaluateAlertRule(db, {
        ...scope,
        type: "error_count",
        windowStart,
        windowEnd,
        routePattern: "POST /checkout"
      });
      expect(result.observedValue).toBe("1");
    });
  });

  // ---------------------------------------------------------------------------
  // dead_letter_count window
  //
  // The count ignored windowStart/windowEnd entirely, so the rule latched on
  // permanently after the first dead letter ever recorded.
  // ---------------------------------------------------------------------------

  it("dead_letter_count counts only jobs inside the evaluation window", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const scope = { projectId: "prj_dlq", environmentId: "env_dlq" };
      await seedScope(db, scope.projectId, scope.environmentId);

      const inside = new Date("2026-06-24T11:30:00Z");
      const before = new Date("2026-06-20T09:00:00Z");

      for (const [id, createdAt] of [
        ["dlq_old", before],
        ["dlq_recent", inside]
      ] as const) {
        await sql`
          insert into dead_letter_jobs (id, project_id, environment_id, queue_name, job_name, payload, error_message, created_at)
          values (${id}, ${scope.projectId}, ${scope.environmentId}, 'telemetry', 'persist', '{}'::jsonb, 'boom', ${createdAt})
        `.execute(db);
      }

      const result = await evaluateAlertRule(db, {
        ...scope,
        type: "dead_letter_count",
        windowStart,
        windowEnd
      });
      expect(result.observedValue).toBe("1");
    });
  });
});
