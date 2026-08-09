import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { createTestDb } from "./test-db.js";
import { getApmEndpoints, getEventAggregates, listEvents } from "../src/repositories/telemetry-query.js";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;

const from = new Date("2026-06-24T00:00:00Z");
const to = new Date("2026-06-25T00:00:00Z");
const at = new Date("2026-06-24T12:00:00Z");

describe("aggregate semantics", () => {
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

  // ---------------------------------------------------------------------------
  // pending is not a failure
  //
  // tracePayloadSchema and spanPayloadSchema default status to 'pending', and
  // the SDK's one-shot trace()/span() send that default. Counting "not success"
  // as failure therefore reported every un-finalized trace as an error.
  // ---------------------------------------------------------------------------

  it("does not count pending traces as errors in APM endpoint rollups", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const scope = { projectId: "prj_pending", environmentId: "env_pending" };
      await seedScope(db, scope.projectId, scope.environmentId);

      for (const [id, status] of [
        ["t_ok", "success"],
        ["t_pending", "pending"],
        ["t_err", "error"]
      ] as const) {
        await sql`
          insert into traces (id, project_id, environment_id, trace_id, timestamp, received_at, name, status, started_at, duration_ms)
          values (
            ${id}, ${scope.projectId}, ${scope.environmentId}, ${id},
            ${at}, ${at}, 'POST /checkout', ${status}, ${at}, 100
          )
        `.execute(db);
      }

      const result = await getApmEndpoints(db, { ...scope, window: "24h", now: to });
      const endpoint = result.endpoints.find((e) => e.name === "POST /checkout");
      expect(endpoint?.requests).toBe(3);
      expect(endpoint?.errors).toBe(1);
      expect(result.totals.errors).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // aggregates honour the same filters as the list beneath them
  // ---------------------------------------------------------------------------

  it("applies the event name filter to aggregates, matching the list", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const scope = { projectId: "prj_agg", environmentId: "env_agg" };
      await seedScope(db, scope.projectId, scope.environmentId);

      for (const [id, name] of [
        ["e1", "checkout.started"],
        ["e2", "checkout.started"],
        ["e3", "page.viewed"]
      ] as const) {
        await sql`
          insert into events (id, project_id, environment_id, timestamp, received_at, name)
          values (${id}, ${scope.projectId}, ${scope.environmentId}, ${at}, ${at}, ${name})
        `.execute(db);
      }

      const filters = { ...scope, from, to, eventName: "checkout.started" };
      const list = await listEvents(db, filters as never);
      const aggregates = await getEventAggregates(db, filters as never);

      expect(list.data).toHaveLength(2);
      expect(aggregates.total).toBe(2);
    });
  });

  it("applies the event id filter to aggregates, matching the list", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const scope = { projectId: "prj_agg_id", environmentId: "env_agg_id" };
      await seedScope(db, scope.projectId, scope.environmentId);

      for (const id of ["eid1", "eid2"]) {
        await sql`
          insert into events (id, project_id, environment_id, timestamp, received_at, name)
          values (${id}, ${scope.projectId}, ${scope.environmentId}, ${at}, ${at}, 'page.viewed')
        `.execute(db);
      }

      const filters = { ...scope, from, to, eventId: "eid1" };
      const list = await listEvents(db, filters as never);
      const aggregates = await getEventAggregates(db, filters as never);

      expect(list.data).toHaveLength(1);
      expect(aggregates.total).toBe(1);
    });
  });
});
