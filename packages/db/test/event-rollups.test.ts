import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { createEnvironment, createProject } from "../src/repositories/admin.js";
import {
  EVENT_HOURLY_ROLLUP,
  getEventRollupWatermark,
  runEventHourlyRollupBackfill,
  setEventRollupWatermark,
  upsertEventHourlyRollup
} from "../src/repositories/event-rollups.js";
import { insertEvent } from "../src/repositories/telemetry-writes.js";
import { createTestDb } from "./test-db.js";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
let db: Db;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("sigmon")
    .withUsername("sigmon")
    .withPassword("sigmon")
    .start();
  db = createTestDb(container.getConnectionUri());
  await migrate(db);
}, 60_000);

afterAll(async () => {
  await db?.destroy();
  await container?.stop();
}, 30_000);

beforeEach(async () => {
  await sql`truncate table projects cascade`.execute(db);
});

async function createScope(name: string) {
  const project = await createProject(db, { name });
  const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
  return { projectId: project.id, environmentId: environment.id };
}

async function addEvent(input: {
  id: string;
  projectId: string;
  environmentId: string;
  timestamp: string;
  userId?: string;
  tenantId?: string;
  name?: string;
  properties?: Record<string, unknown>;
}) {
  await insertEvent(db, {
    id: input.id,
    projectId: input.projectId,
    environmentId: input.environmentId,
    timestamp: new Date(input.timestamp),
    receivedAt: new Date(input.timestamp),
    name: input.name ?? "checkout.completed",
    userId: input.userId,
    tenantId: input.tenantId,
    properties: input.properties ?? {}
  });
}

describe("event hourly rollups", () => {
  it("replaces an hour idempotently and includes exact actor and promoted-breakdown rows", async () => {
    const scope = await createScope("Hourly idempotency");
    await sql`
      insert into analytics_promoted_event_properties (
        id, project_id, environment_id, property_key, display_name
      )
      values ('prop_hourly_plan', ${scope.projectId}, ${scope.environmentId}, 'plan', 'Plan')
    `.execute(db);
    await addEvent({
      ...scope,
      id: "evt_hourly_1",
      timestamp: "2026-07-30T10:05:00.000Z",
      userId: "usr_1",
      properties: { plan: "free", ignored: "secret" }
    });
    await addEvent({
      ...scope,
      id: "evt_hourly_2",
      timestamp: "2026-07-30T10:25:00.000Z",
      userId: "usr_1",
      properties: { plan: "free" }
    });

    const window = {
      ...scope,
      from: new Date("2026-07-30T10:00:00.000Z"),
      to: new Date("2026-07-30T11:00:00.000Z")
    };
    await upsertEventHourlyRollup(db, window);
    await upsertEventHourlyRollup(db, window);

    await addEvent({
      ...scope,
      id: "evt_hourly_late",
      timestamp: "2026-07-30T10:45:00.000Z",
      tenantId: "ten_1",
      properties: { plan: "team" }
    });
    await upsertEventHourlyRollup(db, window);

    const rows = await sql<{
      breakdown_key: string | null;
      breakdown_value: string | null;
      actor_type: string | null;
      actor_id: string | null;
      events: string;
    }>`
      select
        nullif(breakdown_property, '') as breakdown_key,
        nullif(breakdown_value, '') as breakdown_value,
        nullif(actor_type, '') as actor_type,
        nullif(actor_id, '') as actor_id,
        event_count::text as events
      from event_rollup_hourly
      where project_id = ${scope.projectId}
        and environment_id = ${scope.environmentId}
        and bucket_start = ${window.from}
      order by
        event_rollup_hourly.breakdown_property,
        event_rollup_hourly.breakdown_value,
        event_rollup_hourly.actor_type,
        event_rollup_hourly.actor_id
    `.execute(db);

    expect(rows.rows).toEqual([
      { breakdown_key: null, breakdown_value: null, actor_type: null, actor_id: null, events: "3" },
      { breakdown_key: null, breakdown_value: null, actor_type: "tenant", actor_id: "ten_1", events: "1" },
      { breakdown_key: null, breakdown_value: null, actor_type: "user", actor_id: "usr_1", events: "2" },
      { breakdown_key: "plan", breakdown_value: "v:free", actor_type: null, actor_id: null, events: "2" },
      { breakdown_key: "plan", breakdown_value: "v:free", actor_type: "user", actor_id: "usr_1", events: "2" },
      { breakdown_key: "plan", breakdown_value: "v:team", actor_type: null, actor_id: null, events: "1" },
      { breakdown_key: "plan", breakdown_value: "v:team", actor_type: "tenant", actor_id: "ten_1", events: "1" }
    ]);
  });

  it("stores missing and empty promoted values as distinct rollup dimensions", async () => {
    const scope = await createScope("Hourly missing values");
    await sql`
      insert into analytics_promoted_event_properties (
        id, project_id, environment_id, property_key, display_name
      )
      values ('prop_hourly_empty_plan', ${scope.projectId}, ${scope.environmentId}, 'plan', 'Plan')
    `.execute(db);
    await addEvent({ ...scope, id: "evt_hourly_missing", timestamp: "2026-07-30T10:05:00.000Z", properties: {} });
    await addEvent({ ...scope, id: "evt_hourly_empty", timestamp: "2026-07-30T10:10:00.000Z", properties: { plan: "" } });

    const window = {
      ...scope,
      from: new Date("2026-07-30T10:00:00.000Z"),
      to: new Date("2026-07-30T11:00:00.000Z")
    };
    await upsertEventHourlyRollup(db, window);
    const result = await sql<{ breakdown_value: string; event_count: string }>`
      select breakdown_value, event_count::text
      from event_rollup_hourly
      where project_id = ${scope.projectId}
        and environment_id = ${scope.environmentId}
        and breakdown_property = 'plan'
        and actor_type = ''
      order by breakdown_value
    `.execute(db);

    expect(result.rows).toEqual([
      { breakdown_value: "m:", event_count: "1" },
      { breakdown_value: "v:", event_count: "1" }
    ]);
  });

  it("bounds old backfill, always refreshes the previous/current hour, and advances watermarks per scope", async () => {
    const first = await createScope("Hourly backfill A");
    const second = await createScope("Hourly backfill B");
    for (const [index, timestamp] of ["08:05", "09:05", "10:05", "11:05"] .entries()) {
      await addEvent({
        ...first,
        id: `evt_backfill_${index}`,
        timestamp: `2026-07-30T${timestamp}:00.000Z`,
        userId: "usr_backfill"
      });
    }
    await addEvent({
      ...second,
      id: "evt_other_scope",
      timestamp: "2026-07-30T11:10:00.000Z",
      userId: "usr_other"
    });

    const result = await runEventHourlyRollupBackfill(db, {
      now: new Date("2026-07-30T11:30:00.000Z"),
      lookbackHours: 3,
      maxBackfillHoursPerScope: 1
    });

    expect(result.scopesProcessed).toBe(2);
    expect(result.hoursProcessed).toBe(5); // A: 08 + refresh 10/11; B starts at 11 + refresh 10.
    expect(await getEventRollupWatermark(db, { ...first, rollup: EVENT_HOURLY_ROLLUP })).toEqual(
      new Date("2026-07-30T09:00:00.000Z")
    );
    expect(await getEventRollupWatermark(db, { ...second, rollup: EVENT_HOURLY_ROLLUP })).toEqual(
      new Date("2026-07-30T12:00:00.000Z")
    );

    await setEventRollupWatermark(db, {
      ...second,
      rollup: EVENT_HOURLY_ROLLUP,
      watermarkAt: new Date("2026-07-30T13:00:00.000Z")
    });
    expect(await getEventRollupWatermark(db, { ...first, rollup: EVENT_HOURLY_ROLLUP })).toEqual(
      new Date("2026-07-30T09:00:00.000Z")
    );
    expect(await getEventRollupWatermark(db, { ...second, rollup: EVENT_HOURLY_ROLLUP })).toEqual(
      new Date("2026-07-30T13:00:00.000Z")
    );
  });
});
