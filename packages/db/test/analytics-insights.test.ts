import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { createEnvironment, createProject } from "../src/repositories/admin.js";
import { normalizeDashboardWidgets } from "../src/repositories/analytics-dashboards.js";
import {
  EventPropertyInUseError,
  EventPropertyNotPromotedError,
  InvalidEventPropertyError,
  archiveAnalyticsInsight,
  archiveEventProperty,
  createAnalyticsInsight,
  getAnalyticsInsight,
  listAnalyticsInsight,
  listAnalyticsInsights,
  listEventProperties,
  listEventProperty,
  promoteEventProperty,
  queryEventTrend,
  updateAnalyticsInsight
} from "../src/repositories/analytics-insights.js";
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

async function createScope(label: string) {
  const project = await createProject(db, { name: `${label} ${Date.now()}` });
  const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
  return { projectId: project.id, environmentId: environment.id };
}

async function addEvent(
  scope: { projectId: string; environmentId: string },
  input: {
    id: string;
    at: string;
    name?: string;
    properties?: Record<string, unknown>;
    userId?: string;
    tenantId?: string;
    sessionId?: string;
    traceId?: string;
  }
) {
  const timestamp = new Date(input.at);
  await insertEvent(db, {
    ...scope,
    id: input.id,
    timestamp,
    receivedAt: timestamp,
    name: input.name ?? "checkout.completed",
    properties: input.properties ?? {},
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {})
  });
}

describe("analytics insights repository", () => {
  it("normalizes insight CRUD and isolates every operation by project and environment", async () => {
    const scope = await createScope("Insight CRUD");
    const otherScope = await createScope("Insight Other");

    const insight = await createAnalyticsInsight(db, {
      ...scope,
      name: "  Checkout by plan  ",
      description: "  Conversion volume  ",
      definition: {
        bucket: "hour",
        metric: "count",
        eventName: "  checkout.completed  ",
        filters: [{ property: " region ", operator: "eq", value: " eu " }]
      }
    });

    expect(insight).toMatchObject({
      ...scope,
      name: "Checkout by plan",
      description: "Conversion volume",
      definition: {
        bucket: "hour",
        metric: "count",
        eventName: "checkout.completed",
        filters: [{ property: "region", operator: "eq", value: "eu" }]
      },
      archivedAt: null
    });
    await expect(getAnalyticsInsight(db, { ...otherScope, id: insight.id })).resolves.toBeUndefined();
    await expect(listAnalyticsInsight(db, otherScope)).resolves.toEqual([]);
    await expect(listAnalyticsInsights(db, otherScope)).resolves.toEqual([]);
    await expect(updateAnalyticsInsight(db, { ...otherScope, id: insight.id, patch: { name: "Leaked" } })).resolves.toBeUndefined();

    const updated = await updateAnalyticsInsight(db, {
      ...scope,
      id: insight.id,
      patch: { name: "  Checkout trend ", description: "   " }
    });
    expect(updated).toMatchObject({ name: "Checkout trend", description: null });
    await expect(listAnalyticsInsight(db, scope)).resolves.toEqual([
      expect.objectContaining({ id: insight.id, name: "Checkout trend" })
    ]);

    await archiveAnalyticsInsight(db, { ...otherScope, id: insight.id });
    await expect(getAnalyticsInsight(db, { ...scope, id: insight.id })).resolves.toBeDefined();
    await archiveAnalyticsInsight(db, { ...scope, id: insight.id });
    await expect(getAnalyticsInsight(db, { ...scope, id: insight.id })).resolves.toBeUndefined();
  });

  it("promotes, lists, and archives property keys within one scope", async () => {
    const scope = await createScope("Promoted Properties");
    const otherScope = await createScope("Promoted Other");

    const promoted = await promoteEventProperty(db, {
      ...scope,
      property: " plan ",
      displayName: " Pricing plan "
    });
    expect(promoted).toMatchObject({
      ...scope,
      property: "plan",
      propertyName: "plan",
      displayName: "Pricing plan",
      indexStatus: "ready",
      indexName: expect.stringMatching(/^analytics_event_property_/),
      indexedAt: expect.any(Date),
      archivedAt: null
    });
    const index = await sql<{ indexdef: string }>`
      select indexdef
      from pg_indexes
      where schemaname = current_schema()
        and indexname = ${promoted.indexName}
    `.execute(db);
    expect(index.rows[0]?.indexdef).toContain("properties ->> 'plan'::text");
    expect(index.rows[0]?.indexdef).toContain(`project_id = '${scope.projectId}'::text`);
    expect(index.rows[0]?.indexdef).toContain(`environment_id = '${scope.environmentId}'::text`);
    await expect(listEventProperty(db, scope)).resolves.toEqual([
      expect.objectContaining({ id: promoted.id, property: "plan", indexStatus: "ready" })
    ]);
    await expect(listEventProperties(db, scope)).resolves.toHaveLength(1);
    await expect(listEventProperty(db, otherScope)).resolves.toEqual([]);

    await archiveEventProperty(db, { ...otherScope, id: promoted.id });
    await expect(listEventProperty(db, scope)).resolves.toHaveLength(1);
    await archiveEventProperty(db, { ...scope, id: promoted.id });
    await expect(listEventProperty(db, scope)).resolves.toEqual([]);
    const archivedIndex = await sql<{ present: boolean }>`
      select exists(
        select 1 from pg_indexes
        where schemaname = current_schema()
          and indexname = ${promoted.indexName}
      ) as present
    `.execute(db);
    expect(archivedIndex.rows[0]?.present).toBe(false);
  });

  it("rejects archiving a promoted property referenced by an active insight", async () => {
    const scope = await createScope("Promoted Property In Use");
    const promoted = await promoteEventProperty(db, { ...scope, property: "plan" });
    const insight = await createAnalyticsInsight(db, {
      ...scope,
      name: "Checkout by plan",
      definition: { bucket: "hour", metric: "count", breakdownProperty: "plan" }
    });

    await expect(archiveEventProperty(db, { ...scope, id: promoted.id })).rejects.toMatchObject({
      name: EventPropertyInUseError.name,
      message: "event_property_in_use",
      property: "plan"
    });
    await expect(listEventProperty(db, scope)).resolves.toHaveLength(1);

    await archiveAnalyticsInsight(db, { ...scope, id: insight.id });
    await expect(archiveEventProperty(db, { ...scope, id: promoted.id })).resolves.toBeUndefined();
  });

  it("serializes promotion and archive with the same advisory lock", async () => {
    const scope = await createScope("Promoted Property Lock");
    const promoted = await promoteEventProperty(db, { ...scope, property: "plan" });
    const lockKey = `analytics-property-index:${scope.projectId}:${scope.environmentId}:plan`;

    await db.connection().execute(async (lockDb) => {
      await sql`select pg_advisory_lock(hashtextextended(${lockKey}, 0))`.execute(lockDb);
      let settled = false;
      const archive = archiveEventProperty(db, { ...scope, id: promoted.id }).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(settled).toBe(false);
      await sql`select pg_advisory_unlock(hashtextextended(${lockKey}, 0))`.execute(lockDb);
      await archive;
    });

    await expect(listEventProperty(db, scope)).resolves.toEqual([]);
  });

  it("requires a promoted property for breakdowns and rejects invalid property identifiers", async () => {
    const scope = await createScope("Breakdown Guard");
    const baseQuery = {
      ...scope,
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-07-01T02:00:00.000Z"),
      bucket: "hour" as const,
      metric: "count" as const,
      breakdownProperty: "plan"
    };

    await expect(queryEventTrend(db, baseQuery)).rejects.toMatchObject({
      name: EventPropertyNotPromotedError.name,
      message: "breakdown_property_not_promoted"
    });
    await promoteEventProperty(db, { ...scope, property: "plan" });
    await expect(queryEventTrend(db, baseQuery)).resolves.toMatchObject({ buckets: expect.any(Array), series: expect.any(Array) });

    await expect(promoteEventProperty(db, { ...scope, property: "plan') OR true --" })).rejects.toMatchObject({
      name: InvalidEventPropertyError.name,
      message: "invalid_analytics_property"
    });
    await expect(
      queryEventTrend(db, {
        ...baseQuery,
        breakdownProperty: undefined,
        filters: [{ property: "region;drop table events", operator: "eq", value: "eu" }]
      })
    ).rejects.toMatchObject({ name: InvalidEventPropertyError.name, message: "invalid_analytics_property" });
  });

  it("returns zero-filled hourly counts with event, property-filter, breakdown, and scope isolation", async () => {
    const scope = await createScope("Trend Count");
    const otherScope = await createScope("Trend Count Other");
    await promoteEventProperty(db, { ...scope, property: "plan", displayName: "Plan" });

    await addEvent(scope, {
      id: `evt_trend_count_1_${Date.now()}`,
      at: "2026-07-02T00:10:00.000Z",
      properties: { plan: "team", region: "eu" }
    });
    await addEvent(scope, {
      id: `evt_trend_count_2_${Date.now()}`,
      at: "2026-07-02T00:20:00.000Z",
      properties: { plan: "team", region: "eu" }
    });
    await addEvent(scope, {
      id: `evt_trend_count_3_${Date.now()}`,
      at: "2026-07-02T02:05:00.000Z",
      properties: { plan: "free", region: "eu" }
    });
    await addEvent(scope, {
      id: `evt_trend_count_filtered_${Date.now()}`,
      at: "2026-07-02T00:30:00.000Z",
      properties: { plan: "team", region: "us" }
    });
    await addEvent(scope, {
      id: `evt_trend_count_name_${Date.now()}`,
      at: "2026-07-02T00:40:00.000Z",
      name: "checkout.started",
      properties: { plan: "team", region: "eu" }
    });
    await addEvent(otherScope, {
      id: `evt_trend_count_scope_${Date.now()}`,
      at: "2026-07-02T00:50:00.000Z",
      properties: { plan: "team", region: "eu" }
    });

    await expect(
      queryEventTrend(db, {
        ...scope,
        from: new Date("2026-07-02T00:15:00.000Z"),
        to: new Date("2026-07-02T04:00:00.000Z"),
        bucket: "hour",
        metric: "count",
        eventName: "checkout.completed",
        breakdownProperty: "plan",
        filters: [{ property: "region", operator: "eq", value: "eu" }]
      })
    ).resolves.toEqual({
      buckets: [
        "2026-07-02T00:00:00.000Z",
        "2026-07-02T01:00:00.000Z",
        "2026-07-02T02:00:00.000Z",
        "2026-07-02T03:00:00.000Z"
      ],
      series: [
        { key: "free", label: "free", values: [0, 0, 1, 0] },
        { key: "team", label: "team", values: [1, 0, 0, 0] }
      ]
    });
  });

  it("counts one stable actor per UTC bucket using user, tenant, session, then trace identity", async () => {
    const scope = await createScope("Trend Actors");
    const prefix = Date.now();
    await addEvent(scope, { id: `evt_actor_1_${prefix}`, at: "2026-07-03T23:50:00.000Z", userId: "user-1", tenantId: "tenant-a" });
    await addEvent(scope, { id: `evt_actor_2_${prefix}`, at: "2026-07-03T23:55:00.000Z", userId: "user-1", tenantId: "tenant-b" });
    await addEvent(scope, { id: `evt_actor_3_${prefix}`, at: "2026-07-03T23:56:00.000Z", tenantId: "tenant-a" });
    await addEvent(scope, { id: `evt_actor_4_${prefix}`, at: "2026-07-04T01:00:00.000Z", sessionId: "session-1" });
    await addEvent(scope, { id: `evt_actor_5_${prefix}`, at: "2026-07-04T01:05:00.000Z", traceId: "trace-1" });
    await addEvent(scope, { id: `evt_actor_anonymous_${prefix}`, at: "2026-07-04T01:10:00.000Z" });

    await expect(
      queryEventTrend(db, {
        ...scope,
        from: new Date("2026-07-03T12:00:00.000Z"),
        to: new Date("2026-07-06T00:00:00.000Z"),
        bucket: "day",
        metric: "unique_actors",
        eventName: "checkout.completed"
      })
    ).resolves.toEqual({
      buckets: ["2026-07-03T00:00:00.000Z", "2026-07-04T00:00:00.000Z", "2026-07-05T00:00:00.000Z"],
      series: [{ key: "all", label: "checkout.completed", values: [2, 2, 0] }]
    });
  });

  it("keeps UTC bucket boundaries when the database session uses another timezone", async () => {
    const scope = await createScope("Trend UTC");
    await addEvent(scope, {
      id: `evt_trend_utc_${Date.now()}`,
      at: "2026-07-04T00:30:00.000Z"
    });

    await db.connection().execute(async (connectionDb) => {
      await sql`set time zone 'Asia/Kathmandu'`.execute(connectionDb);
      try {
        await expect(
          queryEventTrend(connectionDb, {
            ...scope,
            from: new Date("2026-07-04T00:00:00.000Z"),
            to: new Date("2026-07-04T02:00:00.000Z"),
            bucket: "hour",
            metric: "count"
          })
        ).resolves.toEqual({
          buckets: ["2026-07-04T00:00:00.000Z", "2026-07-04T01:00:00.000Z"],
          series: [{ key: "all", label: "All events", values: [1, 0] }]
        });
      } finally {
        await sql`set time zone 'UTC'`.execute(connectionDb);
      }
    });
  });

  it("applies multiple exact property filters without requiring promoted filter properties", async () => {
    const scope = await createScope("Trend Filters");
    const prefix = Date.now();
    await addEvent(scope, {
      id: `evt_filter_1_${prefix}`,
      at: "2026-07-05T00:05:00.000Z",
      properties: { region: "eu", campaign: "summer" }
    });
    await addEvent(scope, {
      id: `evt_filter_2_${prefix}`,
      at: "2026-07-05T00:10:00.000Z",
      properties: { region: "us", campaign: "summer" }
    });
    await addEvent(scope, {
      id: `evt_filter_3_${prefix}`,
      at: "2026-07-05T00:15:00.000Z",
      properties: { region: "eu" }
    });

    const trend = await queryEventTrend(db, {
      ...scope,
      from: new Date("2026-07-05T00:00:00.000Z"),
      to: new Date("2026-07-05T02:00:00.000Z"),
      bucket: "hour",
      metric: "count",
      filters: [
        { property: "campaign", operator: "exists" },
        { property: "region", operator: "neq", value: "us" }
      ]
    });
    expect(trend.series).toEqual([{ key: "all", label: "All events", values: [1, 0] }]);
  });

  it("combines exact hourly rollups with a raw tail for count and unique actors", async () => {
    const scope = await createScope("Trend Hybrid");
    const prefix = Date.now();
    await promoteEventProperty(db, { ...scope, property: "plan" });
    await addEvent(scope, {
      id: `evt_hybrid_1_${prefix}`,
      at: "2026-07-06T00:05:00.000Z",
      userId: "user-1",
      properties: { plan: "free" }
    });
    await addEvent(scope, {
      id: `evt_hybrid_2_${prefix}`,
      at: "2026-07-06T00:10:00.000Z",
      userId: "user-1",
      properties: { plan: "free" }
    });
    await addEvent(scope, {
      id: `evt_hybrid_3_${prefix}`,
      at: "2026-07-06T00:20:00.000Z",
      tenantId: "tenant-1",
      properties: { plan: "team" }
    });
    await addEvent(scope, {
      id: `evt_hybrid_4_${prefix}`,
      at: "2026-07-06T01:05:00.000Z",
      userId: "user-1",
      properties: { plan: "free" }
    });
    const rollupTo = new Date("2026-07-06T02:00:00.000Z");
    await upsertEventHourlyRollup(db, {
      ...scope,
      from: new Date("2026-07-06T00:00:00.000Z"),
      to: rollupTo
    });
    await setEventRollupWatermark(db, { ...scope, rollup: EVENT_HOURLY_ROLLUP, watermarkAt: rollupTo });
    await sql`
      delete from events
      where project_id = ${scope.projectId}
        and environment_id = ${scope.environmentId}
        and timestamp < ${rollupTo}
    `.execute(db);
    await addEvent(scope, {
      id: `evt_hybrid_tail_${prefix}`,
      at: "2026-07-06T02:15:00.000Z",
      userId: "user-2",
      properties: { plan: "team" }
    });

    await expect(
      queryEventTrend(db, {
        ...scope,
        from: new Date("2026-07-06T00:00:00.000Z"),
        to: new Date("2026-07-06T03:00:00.000Z"),
        bucket: "hour",
        metric: "count",
        eventName: "checkout.completed",
        breakdownProperty: "plan"
      })
    ).resolves.toEqual({
      buckets: [
        "2026-07-06T00:00:00.000Z",
        "2026-07-06T01:00:00.000Z",
        "2026-07-06T02:00:00.000Z"
      ],
      series: [
        { key: "free", label: "free", values: [2, 1, 0] },
        { key: "team", label: "team", values: [1, 0, 1] }
      ]
    });

    const actors = await queryEventTrend(db, {
      ...scope,
      from: new Date("2026-07-06T00:00:00.000Z"),
      to: new Date("2026-07-07T00:00:00.000Z"),
      bucket: "day",
      metric: "unique_actors",
      eventName: "checkout.completed"
    });
    expect(actors.series).toEqual([{ key: "all", label: "checkout.completed", values: [3] }]);
  });

  it("rewinds an advanced rollup watermark when a property is promoted and backfills its history", async () => {
    const scope = await createScope("Late Property Promotion");
    const prefix = Date.now();
    await addEvent(scope, {
      id: `evt_late_promotion_${prefix}`,
      at: "2026-07-06T00:05:00.000Z",
      properties: { plan: "team" }
    });
    const advancedWatermark = new Date("2026-07-06T03:00:00.000Z");
    await upsertEventHourlyRollup(db, {
      ...scope,
      from: new Date("2026-07-06T00:00:00.000Z"),
      to: advancedWatermark
    });
    await setEventRollupWatermark(db, { ...scope, rollup: EVENT_HOURLY_ROLLUP, watermarkAt: advancedWatermark });

    await promoteEventProperty(db, { ...scope, property: "plan" });
    expect(await getEventRollupWatermark(db, { ...scope, rollup: EVENT_HOURLY_ROLLUP })).toEqual(
      new Date("2026-07-06T00:00:00.000Z")
    );

    const query = {
      ...scope,
      from: new Date("2026-07-06T00:00:00.000Z"),
      to: advancedWatermark,
      bucket: "hour" as const,
      metric: "count" as const,
      breakdownProperty: "plan"
    };
    await expect(queryEventTrend(db, query)).resolves.toEqual({
      buckets: [
        "2026-07-06T00:00:00.000Z",
        "2026-07-06T01:00:00.000Z",
        "2026-07-06T02:00:00.000Z"
      ],
      series: [{ key: "team", label: "team", values: [1, 0, 0] }]
    });

    await runEventHourlyRollupBackfill(db, {
      now: advancedWatermark,
      lookbackHours: 3,
      maxBackfillHoursPerScope: 3
    });
    await sql`
      delete from events
      where project_id = ${scope.projectId}
        and environment_id = ${scope.environmentId}
        and timestamp < ${advancedWatermark}
    `.execute(db);
    await expect(queryEventTrend(db, query)).resolves.toEqual({
      buckets: [
        "2026-07-06T00:00:00.000Z",
        "2026-07-06T01:00:00.000Z",
        "2026-07-06T02:00:00.000Z"
      ],
      series: [{ key: "team", label: "team", values: [1, 0, 0] }]
    });
  });

  it("creates a historical rollup watermark when a promoted scope has no state yet", async () => {
    const scope = await createScope("First Property Promotion");
    await addEvent(scope, {
      id: `evt_first_promotion_${Date.now()}`,
      at: "2026-07-05T04:25:00.000Z",
      properties: { plan: "starter" }
    });

    expect(await getEventRollupWatermark(db, { ...scope, rollup: EVENT_HOURLY_ROLLUP })).toBeNull();
    await promoteEventProperty(db, { ...scope, property: "plan" });

    expect(await getEventRollupWatermark(db, { ...scope, rollup: EVENT_HOURLY_ROLLUP })).toEqual(
      new Date("2026-07-05T04:00:00.000Z")
    );
  });

  it("preserves missing and empty breakdown values across rolled-up history", async () => {
    const scope = await createScope("Breakdown Empty Values");
    const prefix = Date.now();
    await promoteEventProperty(db, { ...scope, property: "plan" });
    await addEvent(scope, { id: `evt_missing_${prefix}`, at: "2026-07-06T00:05:00.000Z", properties: {} });
    await addEvent(scope, { id: `evt_empty_${prefix}`, at: "2026-07-06T00:10:00.000Z", properties: { plan: "" } });
    await addEvent(scope, { id: `evt_team_${prefix}`, at: "2026-07-06T00:15:00.000Z", properties: { plan: "team" } });
    const rollupTo = new Date("2026-07-06T01:00:00.000Z");
    await upsertEventHourlyRollup(db, { ...scope, from: new Date("2026-07-06T00:00:00.000Z"), to: rollupTo });
    await setEventRollupWatermark(db, { ...scope, rollup: EVENT_HOURLY_ROLLUP, watermarkAt: rollupTo });
    await sql`
      delete from events
      where project_id = ${scope.projectId}
        and environment_id = ${scope.environmentId}
    `.execute(db);

    await expect(
      queryEventTrend(db, {
        ...scope,
        from: new Date("2026-07-06T00:00:00.000Z"),
        to: rollupTo,
        bucket: "hour",
        metric: "count",
        breakdownProperty: "plan"
      })
    ).resolves.toEqual({
      buckets: ["2026-07-06T00:00:00.000Z"],
      series: [
        { key: "", label: "", values: [1] },
        { key: "(none)", label: "(none)", values: [1] },
        { key: "team", label: "team", values: [1] }
      ]
    });
  });

  it("caps breakdowns to the top 20 series with deterministic lexical tie-breaking", async () => {
    const scope = await createScope("Trend Series Cap");
    const prefix = Date.now();
    await promoteEventProperty(db, { ...scope, property: "plan" });
    for (let index = 0; index < 25; index += 1) {
      await addEvent(scope, {
        id: `evt_series_${prefix}_${index}`,
        at: "2026-07-07T00:05:00.000Z",
        properties: { plan: `value-${String(index).padStart(2, "0")}` }
      });
    }
    await addEvent(scope, {
      id: `evt_series_${prefix}_24_extra`,
      at: "2026-07-07T00:10:00.000Z",
      properties: { plan: "value-24" }
    });

    const trend = await queryEventTrend(db, {
      ...scope,
      from: new Date("2026-07-07T00:00:00.000Z"),
      to: new Date("2026-07-07T01:00:00.000Z"),
      bucket: "hour",
      metric: "count",
      breakdownProperty: "plan"
    });
    expect(trend.series).toHaveLength(20);
    expect(trend.series.map((series) => series.key)).toEqual([
      "value-24",
      ...Array.from({ length: 19 }, (_, index) => `value-${String(index).padStart(2, "0")}`)
    ]);
  });

  it("normalizes reusable insight dashboard widgets", () => {
    const widgets = normalizeDashboardWidgets([
      {
        type: "insight",
        title: "Activation trend",
        width: "full",
        options: { insightId: "ins_activation" }
      }
    ]);
    expect(widgets).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^wid_/),
        type: "insight",
        title: "Activation trend",
        width: "full",
        options: { insightId: "ins_activation" }
      })
    ]);
  });
});
