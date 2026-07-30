import { createHash } from "node:crypto";
import type { RawBuilder, Selectable } from "kysely";
import { sql } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { AnalyticsInsightsTable, AnalyticsPromotedEventPropertiesTable } from "../schema.js";

type AnalyticsInsightRow = Selectable<AnalyticsInsightsTable>;
type PromotedEventPropertyRow = Selectable<AnalyticsPromotedEventPropertiesTable>;

export type EventTrendBucket = "hour" | "day";
export type EventTrendMetric = "count" | "unique_actors";
export type EventTrendFilter =
  | { property: string; operator: "eq" | "neq"; value: string }
  | { property: string; operator: "exists" | "not_exists" };
export type EventTrendFilters = EventTrendFilter[] | Record<string, string>;

export interface AnalyticsInsightDefinition {
  bucket: EventTrendBucket;
  metric: EventTrendMetric;
  eventName?: string;
  breakdownProperty?: string;
  filters?: EventTrendFilters;
}

export interface AnalyticsInsightRecord {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  description: string | null;
  definition: AnalyticsInsightDefinition;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface PromotedEventProperty {
  id: string;
  projectId: string;
  environmentId: string;
  property: string;
  propertyName?: string;
  displayName: string;
  indexName: string | null;
  indexStatus: "pending" | "building" | "ready" | "failed";
  indexError: string | null;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface CreateAnalyticsInsightInput {
  projectId: string;
  environmentId: string;
  name: string;
  description?: string | null;
  definition: AnalyticsInsightDefinition;
}

export type UpdateAnalyticsInsightInput = Partial<Pick<CreateAnalyticsInsightInput, "name" | "description" | "definition">>;

export interface QueryEventTrendInput {
  projectId: string;
  environmentId: string;
  from: Date;
  to: Date;
  bucket: EventTrendBucket;
  metric: EventTrendMetric;
  eventName?: string;
  breakdownProperty?: string;
  filters?: EventTrendFilters;
}

export interface EventTrendSeries {
  key: string;
  label: string;
  values: number[];
}

export interface EventTrendResult {
  buckets: string[];
  series: EventTrendSeries[];
}

export class InvalidEventPropertyError extends Error {
  readonly property: string;

  constructor(property: string) {
    super("invalid_analytics_property");
    this.name = "InvalidEventPropertyError";
    this.property = property;
  }
}

export class EventPropertyNotPromotedError extends Error {
  readonly property: string;

  constructor(property: string) {
    super("breakdown_property_not_promoted");
    this.name = "EventPropertyNotPromotedError";
    this.property = property;
  }
}

export class EventPropertyInUseError extends Error {
  readonly property: string;

  constructor(property: string) {
    super("event_property_in_use");
    this.name = "EventPropertyInUseError";
    this.property = property;
  }
}

const PROPERTY_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_FILTERS = 12;
const MAX_BUCKETS = 10_000;
export const MAX_BREAKDOWN_SERIES = 20;

function normalizeText(value: string, fallback: string, max = 120): string {
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, max);
}

function normalizeProperty(value: string): string {
  const property = value.trim();
  if (!PROPERTY_PATTERN.test(property)) {
    throw new InvalidEventPropertyError(property);
  }
  return property;
}

function normalizeFilters(filters: EventTrendFilters | undefined): EventTrendFilter[] | undefined {
  if (!filters) return undefined;
  const values: EventTrendFilter[] = Array.isArray(filters)
    ? filters
    : Object.entries(filters).map(([property, value]) => ({ property, operator: "eq" as const, value }));
  if (values.length === 0) return undefined;
  return values.slice(0, MAX_FILTERS).map((filter) => {
    const property = normalizeProperty(filter.property);
    if (!("value" in filter)) {
      return { property, operator: filter.operator };
    }
    return { property, operator: filter.operator === "neq" ? "neq" : "eq", value: String(filter.value).trim() };
  });
}

function normalizeDefinition(definition: AnalyticsInsightDefinition): AnalyticsInsightDefinition {
  const eventName = definition.eventName?.trim();
  const breakdownProperty = definition.breakdownProperty ? normalizeProperty(definition.breakdownProperty) : undefined;
  const filters = normalizeFilters(definition.filters);
  return {
    bucket: definition.bucket === "day" ? "day" : "hour",
    metric: definition.metric === "unique_actors" ? "unique_actors" : "count",
    ...(eventName ? { eventName: eventName.slice(0, 200) } : {}),
    ...(breakdownProperty ? { breakdownProperty } : {}),
    ...(filters ? { filters } : {})
  };
}

function parseDefinition(value: unknown): AnalyticsInsightDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { bucket: "hour", metric: "count" };
  }
  return normalizeDefinition(value as AnalyticsInsightDefinition);
}

function toInsight(row: AnalyticsInsightRow): AnalyticsInsightRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    name: row.name,
    description: row.description,
    definition: parseDefinition(row.definition),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

function toPromotedProperty(row: PromotedEventPropertyRow): PromotedEventProperty {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    property: row.property_key,
    propertyName: row.property_key,
    displayName: row.display_name,
    indexName: row.index_name,
    indexStatus: row.index_status,
    indexError: row.index_error,
    indexedAt: row.indexed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

async function assertPromotedBreakdown(
  db: Db,
  input: { projectId: string; environmentId: string; breakdownProperty?: string }
): Promise<void> {
  if (!input.breakdownProperty) return;
  const property = normalizeProperty(input.breakdownProperty);
  const row = await db
    .selectFrom("analytics_promoted_event_properties")
    .select("id")
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("property_key", "=", property)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  if (!row) throw new EventPropertyNotPromotedError(property);
}

export async function createAnalyticsInsight(db: Db, input: CreateAnalyticsInsightInput): Promise<AnalyticsInsightRecord> {
  const definition = normalizeDefinition(input.definition);
  await assertPromotedBreakdown(db, { ...input, breakdownProperty: definition.breakdownProperty });
  const row = await db
    .insertInto("analytics_insights")
    .values({
      id: createId("ins"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      name: normalizeText(input.name, "Untitled insight"),
      description: input.description?.trim() || null,
      definition: sql`${JSON.stringify(definition)}::jsonb`
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toInsight(row);
}

export async function listAnalyticsInsight(
  db: Db,
  input: { projectId: string; environmentId: string }
): Promise<AnalyticsInsightRecord[]> {
  const rows = await db
    .selectFrom("analytics_insights")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .orderBy("updated_at", "desc")
    .execute();
  return rows.map(toInsight);
}

export async function getAnalyticsInsight(
  db: Db,
  input: { id: string; projectId: string; environmentId: string }
): Promise<AnalyticsInsightRecord | undefined> {
  const row = await db
    .selectFrom("analytics_insights")
    .selectAll()
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  return row ? toInsight(row) : undefined;
}

export async function updateAnalyticsInsight(
  db: Db,
  input: { id: string; projectId: string; environmentId: string; patch: UpdateAnalyticsInsightInput }
): Promise<AnalyticsInsightRecord | undefined> {
  const definition = input.patch.definition ? normalizeDefinition(input.patch.definition) : undefined;
  if (definition) {
    await assertPromotedBreakdown(db, { ...input, breakdownProperty: definition.breakdownProperty });
  }
  const row = await db
    .updateTable("analytics_insights")
    .set({
      ...(input.patch.name !== undefined ? { name: normalizeText(input.patch.name, "Untitled insight") } : {}),
      ...(input.patch.description !== undefined ? { description: input.patch.description?.trim() || null } : {}),
      ...(definition !== undefined ? { definition: sql`${JSON.stringify(definition)}::jsonb` } : {}),
      updated_at: new Date()
    })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();
  return row ? toInsight(row) : undefined;
}

export async function archiveAnalyticsInsight(
  db: Db,
  input: { id: string; projectId: string; environmentId: string }
): Promise<void> {
  await db
    .updateTable("analytics_insights")
    .set({ archived_at: new Date(), updated_at: new Date() })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .execute();
}

type PromoteEventPropertyInput = {
  projectId: string;
  environmentId: string;
  displayName?: string;
} & ({ property: string; propertyName?: string } | { property?: string; propertyName: string });

function propertyIndexName(input: { projectId: string; environmentId: string; property: string }): string {
  const digest = createHash("sha256")
    .update(`${input.projectId}\0${input.environmentId}\0${input.property}`)
    .digest("hex")
    .slice(0, 24);
  return `analytics_event_property_${digest}`;
}

function propertyIndexLockKey(input: { projectId: string; environmentId: string; property: string }): string {
  return `analytics-property-index:${input.projectId}:${input.environmentId}:${input.property}`;
}

async function rewindHourlyRollupForPromotion(
  db: Db,
  input: { projectId: string; environmentId: string }
): Promise<void> {
  const earliest = await sql<{ bucket_start: Date | null }>`
    select date_trunc('hour', min(timestamp) at time zone 'UTC') at time zone 'UTC' as bucket_start
    from events
    where project_id = ${input.projectId}
      and environment_id = ${input.environmentId}
  `.execute(db);
  const bucketStart = earliest.rows[0]?.bucket_start;
  if (!bucketStart) return;
  await sql`
    insert into event_rollup_state (project_id, environment_id, rollup, watermark_at, updated_at)
    values (${input.projectId}, ${input.environmentId}, 'event_hourly', ${bucketStart}, now())
    on conflict (project_id, environment_id, rollup) do update
    set watermark_at = least(event_rollup_state.watermark_at, excluded.watermark_at),
        updated_at = now()
  `.execute(db);
}

async function dropPropertyIndex(db: Db, indexName: string): Promise<void> {
  await sql`drop index concurrently if exists ${sql.id(indexName)}`.execute(db);
}

async function createPropertyIndex(
  db: Db,
  input: { indexName: string; projectId: string; environmentId: string; property: string }
): Promise<void> {
  await sql`
    create index concurrently if not exists ${sql.id(input.indexName)}
    on events ((${sql.ref("properties")} ->> ${sql.lit(input.property)}))
    where project_id = ${sql.lit(input.projectId)}
      and environment_id = ${sql.lit(input.environmentId)}
  `.execute(db);
}

export async function promoteEventProperty(
  db: Db,
  input: PromoteEventPropertyInput
): Promise<PromotedEventProperty> {
  const property = normalizeProperty(input.property ?? input.propertyName ?? "");
  const displayName = normalizeText(input.displayName ?? property, property, 80);
  const indexName = propertyIndexName({ ...input, property });
  const lockKey = propertyIndexLockKey({ ...input, property });

  return db.connection().execute(async (connectionDb) => {
    await sql`select pg_advisory_lock(hashtextextended(${lockKey}, 0))`.execute(connectionDb);
    try {
      let row = await connectionDb
        .selectFrom("analytics_promoted_event_properties")
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("environment_id", "=", input.environmentId)
        .where("property_key", "=", property)
        .where("archived_at", "is", null)
        .executeTakeFirst();

      if (!row) {
        row = await connectionDb
          .insertInto("analytics_promoted_event_properties")
          .values({
            id: createId("pep"),
            project_id: input.projectId,
            environment_id: input.environmentId,
            property_key: property,
            display_name: displayName,
            index_name: indexName,
            index_status: "pending"
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } else if (row.display_name !== displayName || row.index_name !== indexName) {
        row = await connectionDb
          .updateTable("analytics_promoted_event_properties")
          .set({ display_name: displayName, index_name: indexName, updated_at: new Date() })
          .where("id", "=", row.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      if (row.index_status === "ready") return toPromotedProperty(row);

      await connectionDb
        .updateTable("analytics_promoted_event_properties")
        .set({ index_status: "building", index_error: null, updated_at: new Date() })
        .where("id", "=", row.id)
        .execute();
      try {
        // A process can die while CREATE INDEX CONCURRENTLY leaves an invalid index behind.
        // Rebuilding every non-ready promotion makes retries self-healing before we mark it ready.
        await dropPropertyIndex(connectionDb, indexName);
        await createPropertyIndex(connectionDb, { indexName, projectId: input.projectId, environmentId: input.environmentId, property });
        const ready = await connectionDb
          .updateTable("analytics_promoted_event_properties")
          .set({ index_status: "ready", index_error: null, indexed_at: new Date(), updated_at: new Date() })
          .where("id", "=", row.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await rewindHourlyRollupForPromotion(connectionDb, input);
        return toPromotedProperty(ready);
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 1000) : "index_creation_failed";
        await connectionDb
          .updateTable("analytics_promoted_event_properties")
          .set({ index_status: "failed", index_error: message, updated_at: new Date() })
          .where("id", "=", row.id)
          .execute();
        throw error;
      }
    } finally {
      await sql`select pg_advisory_unlock(hashtextextended(${lockKey}, 0))`.execute(connectionDb);
    }
  });
}

export async function listEventProperty(
  db: Db,
  input: { projectId: string; environmentId: string }
): Promise<PromotedEventProperty[]> {
  const rows = await db
    .selectFrom("analytics_promoted_event_properties")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .orderBy("created_at", "asc")
    .execute();
  return rows.map(toPromotedProperty);
}

export async function archiveEventProperty(
  db: Db,
  input: { id: string; projectId: string; environmentId: string }
): Promise<void> {
  await db.connection().execute(async (connectionDb) => {
    const candidate = await connectionDb
      .selectFrom("analytics_promoted_event_properties")
      .select(["id", "property_key"])
      .where("id", "=", input.id)
      .where("project_id", "=", input.projectId)
      .where("environment_id", "=", input.environmentId)
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (!candidate) return;
    const lockKey = propertyIndexLockKey({ ...input, property: candidate.property_key });
    await sql`select pg_advisory_lock(hashtextextended(${lockKey}, 0))`.execute(connectionDb);
    try {
      const row = await connectionDb
        .selectFrom("analytics_promoted_event_properties")
        .select(["id", "property_key", "index_name"])
        .where("id", "=", input.id)
        .where("project_id", "=", input.projectId)
        .where("environment_id", "=", input.environmentId)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!row) return;
      const reference = await sql<{ id: string }>`
        select id
        from analytics_insights
        where project_id = ${input.projectId}
          and environment_id = ${input.environmentId}
          and archived_at is null
          and definition ->> 'breakdownProperty' = ${row.property_key}
        limit 1
      `.execute(connectionDb);
      if (reference.rows.length > 0) throw new EventPropertyInUseError(row.property_key);
      if (row.index_name) await dropPropertyIndex(connectionDb, row.index_name);
      await connectionDb
        .updateTable("analytics_promoted_event_properties")
        .set({ archived_at: new Date(), updated_at: new Date() })
        .where("id", "=", row.id)
        .execute();
    } finally {
      await sql`select pg_advisory_unlock(hashtextextended(${lockKey}, 0))`.execute(connectionDb);
    }
  });
}

export const listAnalyticsInsights = listAnalyticsInsight;
export const listEventProperties = listEventProperty;

function bucketStarts(from: Date, to: Date, bucket: EventTrendBucket): Date[] {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new RangeError("invalid_analytics_trend");
  }
  const cursor = new Date(from);
  if (bucket === "hour") {
    cursor.setUTCMinutes(0, 0, 0);
  } else {
    cursor.setUTCHours(0, 0, 0, 0);
  }
  const buckets: Date[] = [];
  while (cursor < to) {
    if (buckets.length >= MAX_BUCKETS) throw new RangeError("invalid_analytics_trend");
    buckets.push(new Date(cursor));
    if (bucket === "hour") cursor.setUTCHours(cursor.getUTCHours() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return buckets;
}

function filterCondition(filter: EventTrendFilter): RawBuilder<boolean> {
  const property = normalizeProperty(filter.property);
  if (filter.operator === "exists") return sql<boolean>`events.properties ? ${property}`;
  if (filter.operator === "not_exists") return sql<boolean>`not (events.properties ? ${property})`;
  if (!("value" in filter)) throw new InvalidEventPropertyError(property);
  const value = String(filter.value).trim();
  if (filter.operator === "neq") return sql<boolean>`events.properties ->> ${property} is distinct from ${value}`;
  return sql<boolean>`events.properties ->> ${property} = ${value}`;
}

type TrendAggregateRow = { bucket_start: Date | string; breakdown_value: string | null; value: string };

function utcBucketExpression(bucket: EventTrendBucket, value: RawBuilder<unknown>): RawBuilder<Date> {
  return bucket === "hour"
    ? sql<Date>`date_trunc('hour', ${value} at time zone 'UTC') at time zone 'UTC'`
    : sql<Date>`date_trunc('day', ${value} at time zone 'UTC') at time zone 'UTC'`;
}

function floorUtcBucket(value: Date, bucket: EventTrendBucket): Date {
  const result = new Date(value);
  if (bucket === "hour") result.setUTCMinutes(0, 0, 0);
  else result.setUTCHours(0, 0, 0, 0);
  return result;
}

function ceilUtcBucket(value: Date, bucket: EventTrendBucket): Date {
  const floor = floorUtcBucket(value, bucket);
  if (floor.getTime() === value.getTime()) return floor;
  if (bucket === "hour") floor.setUTCHours(floor.getUTCHours() + 1);
  else floor.setUTCDate(floor.getUTCDate() + 1);
  return floor;
}

async function queryRawTrend(
  db: Db,
  input: QueryEventTrendInput,
  breakdownProperty: string | undefined,
  filters: EventTrendFilter[]
): Promise<TrendAggregateRow[]> {
  const bucketExpression = utcBucketExpression(input.bucket, sql.ref("events.timestamp"));
  const breakdownExpression = breakdownProperty
    ? sql<string | null>`events.properties ->> ${breakdownProperty}`
    : sql<string | null>`null`;
  const valueExpression =
    input.metric === "unique_actors"
      ? sql<bigint>`count(distinct case
          when events.user_id is not null then 'user:' || events.user_id
          when events.tenant_id is not null then 'tenant:' || events.tenant_id
          when events.session_id is not null then 'session:' || events.session_id
          when events.trace_id is not null then 'trace:' || events.trace_id
        end)`
      : sql<bigint>`count(*)`;
  const conditions: RawBuilder<boolean>[] = [
    sql<boolean>`events.project_id = ${input.projectId}`,
    sql<boolean>`events.environment_id = ${input.environmentId}`,
    sql<boolean>`events.timestamp >= ${input.from}`,
    sql<boolean>`events.timestamp < ${input.to}`,
    ...(input.eventName?.trim() ? [sql<boolean>`events.name = ${input.eventName.trim()}`] : []),
    ...filters.map(filterCondition)
  ];
  const result = await sql<TrendAggregateRow>`
    with bucket_values as materialized (
      select
        ${bucketExpression} as bucket_start,
        ${breakdownExpression} as breakdown_value,
        ${valueExpression} as value
      from events
      where ${sql.join(conditions, sql` and `)}
      group by 1, 2
    ),
    top_series as materialized (
      select breakdown_value
      from bucket_values
      group by breakdown_value
      order by sum(value) desc, breakdown_value asc nulls first
      limit ${breakdownProperty ? MAX_BREAKDOWN_SERIES : 1}
    )
    select bucket_values.bucket_start, bucket_values.breakdown_value, bucket_values.value::text as value
    from bucket_values
    join top_series on top_series.breakdown_value is not distinct from bucket_values.breakdown_value
    order by bucket_values.bucket_start asc, bucket_values.breakdown_value asc nulls first
  `.execute(db);
  return result.rows;
}

async function queryHybridTrend(
  db: Db,
  input: QueryEventTrendInput,
  breakdownProperty: string | undefined,
  rollupFrom: Date,
  rollupTo: Date
): Promise<TrendAggregateRow[]> {
  const bucketExpression = utcBucketExpression(input.bucket, sql.ref("point_at"));
  const rollupBreakdown = breakdownProperty
    ? sql<string | null>`case
        when event_rollup_hourly.breakdown_value = 'm:' then null
        when left(event_rollup_hourly.breakdown_value, 2) = 'v:' then substring(event_rollup_hourly.breakdown_value from 3)
        else nullif(event_rollup_hourly.breakdown_value, '')
      end`
    : sql<string | null>`null`;
  const rawBreakdown = breakdownProperty
    ? sql<string>`events.properties ->> ${breakdownProperty}`
    : sql<string | null>`null`;
  const rollupBreakdownCondition = breakdownProperty
    ? sql<boolean>`event_rollup_hourly.breakdown_property = ${breakdownProperty}`
    : sql<boolean>`event_rollup_hourly.breakdown_property = ''`;
  const rollupEventCondition = input.eventName?.trim()
    ? sql<boolean>`event_rollup_hourly.event_name = ${input.eventName.trim()}`
    : sql<boolean>`true`;
  const rawEventCondition = input.eventName?.trim()
    ? sql<boolean>`events.name = ${input.eventName.trim()}`
    : sql<boolean>`true`;
  const rawRangeCondition = sql<boolean>`(
    (events.timestamp >= ${input.from} and events.timestamp < ${rollupFrom})
    or (events.timestamp >= ${rollupTo} and events.timestamp < ${input.to})
  )`;

  if (input.metric === "unique_actors") {
    const result = await sql<TrendAggregateRow>`
      with actor_points as (
        select
          event_rollup_hourly.bucket_start as point_at,
          ${rollupBreakdown} as breakdown_value,
          event_rollup_hourly.actor_type || ':' || event_rollup_hourly.actor_id as actor_key
        from event_rollup_hourly
        where event_rollup_hourly.project_id = ${input.projectId}
          and event_rollup_hourly.environment_id = ${input.environmentId}
          and event_rollup_hourly.bucket_start >= ${rollupFrom}
          and event_rollup_hourly.bucket_start < ${rollupTo}
          and event_rollup_hourly.actor_id <> ''
          and ${rollupBreakdownCondition}
          and ${rollupEventCondition}

        union all

        select
          events.timestamp,
          ${rawBreakdown},
          case
            when events.user_id is not null then 'user:' || events.user_id
            when events.tenant_id is not null then 'tenant:' || events.tenant_id
            when events.session_id is not null then 'session:' || events.session_id
            when events.trace_id is not null then 'trace:' || events.trace_id
          end
        from events
        where events.project_id = ${input.projectId}
          and events.environment_id = ${input.environmentId}
          and ${rawRangeCondition}
          and ${rawEventCondition}
      ),
      bucket_values as materialized (
        select
          ${bucketExpression} as bucket_start,
          breakdown_value,
          count(distinct actor_key) as value
        from actor_points
        where actor_key is not null
        group by 1, 2
      ),
      top_series as materialized (
        select breakdown_value
        from bucket_values
        group by breakdown_value
        order by sum(value) desc, breakdown_value asc nulls first
        limit ${breakdownProperty ? MAX_BREAKDOWN_SERIES : 1}
      )
      select
        bucket_values.bucket_start,
        bucket_values.breakdown_value,
        bucket_values.value::text as value
      from bucket_values
      join top_series on top_series.breakdown_value is not distinct from bucket_values.breakdown_value
      order by bucket_values.bucket_start asc, bucket_values.breakdown_value asc nulls first
    `.execute(db);
    return result.rows;
  }

  const result = await sql<TrendAggregateRow>`
    with count_points as (
      select
        event_rollup_hourly.bucket_start as point_at,
        ${rollupBreakdown} as breakdown_value,
        event_rollup_hourly.event_count as point_value
      from event_rollup_hourly
      where event_rollup_hourly.project_id = ${input.projectId}
        and event_rollup_hourly.environment_id = ${input.environmentId}
        and event_rollup_hourly.bucket_start >= ${rollupFrom}
        and event_rollup_hourly.bucket_start < ${rollupTo}
        and event_rollup_hourly.actor_type = ''
        and event_rollup_hourly.actor_id = ''
        and ${rollupBreakdownCondition}
        and ${rollupEventCondition}

      union all

      select events.timestamp, ${rawBreakdown}, 1::bigint
      from events
      where events.project_id = ${input.projectId}
        and events.environment_id = ${input.environmentId}
        and ${rawRangeCondition}
        and ${rawEventCondition}
    ),
    bucket_values as materialized (
      select
        ${bucketExpression} as bucket_start,
        breakdown_value,
        sum(point_value) as value
      from count_points
      group by 1, 2
    ),
    top_series as materialized (
      select breakdown_value
      from bucket_values
      group by breakdown_value
      order by sum(value) desc, breakdown_value asc nulls first
      limit ${breakdownProperty ? MAX_BREAKDOWN_SERIES : 1}
    )
    select
      bucket_values.bucket_start,
      bucket_values.breakdown_value,
      bucket_values.value::text as value
    from bucket_values
    join top_series on top_series.breakdown_value is not distinct from bucket_values.breakdown_value
    order by bucket_values.bucket_start asc, bucket_values.breakdown_value asc nulls first
  `.execute(db);
  return result.rows;
}

export async function queryEventTrend(db: Db, input: QueryEventTrendInput): Promise<EventTrendResult> {
  const buckets = bucketStarts(input.from, input.to, input.bucket);
  const breakdownProperty = input.breakdownProperty ? normalizeProperty(input.breakdownProperty) : undefined;
  const filters = normalizeFilters(input.filters) ?? [];
  await assertPromotedBreakdown(db, { ...input, breakdownProperty });
  let rows: TrendAggregateRow[];
  const watermark =
    filters.length === 0
      ? await db
          .selectFrom("event_rollup_state")
          .select("watermark_at")
          .where("project_id", "=", input.projectId)
          .where("environment_id", "=", input.environmentId)
          .where("rollup", "=", "event_hourly")
          .executeTakeFirst()
      : undefined;
  const rollupFrom = ceilUtcBucket(input.from, "hour");
  const rollupBoundary = new Date(Math.min(input.to.getTime(), watermark?.watermark_at.getTime() ?? input.from.getTime()));
  const rollupTo = floorUtcBucket(rollupBoundary, "hour");
  if (filters.length === 0 && rollupFrom < rollupTo) {
    rows = await queryHybridTrend(db, input, breakdownProperty, rollupFrom, rollupTo);
  } else {
    rows = await queryRawTrend(db, input, breakdownProperty, filters);
  }

  const bucketIndex = new Map(buckets.map((bucket, index) => [bucket.toISOString(), index]));
  const valuesBySeries = new Map<string, number[]>();
  for (const row of rows) {
    const bucket = new Date(row.bucket_start).toISOString();
    const index = bucketIndex.get(bucket);
    if (index === undefined) continue;
    const key = breakdownProperty ? row.breakdown_value ?? "(none)" : "all";
    const values = valuesBySeries.get(key) ?? Array.from({ length: buckets.length }, () => 0);
    values[index] = Number(row.value);
    valuesBySeries.set(key, values);
  }

  if (!breakdownProperty && !valuesBySeries.has("all")) {
    valuesBySeries.set("all", Array.from({ length: buckets.length }, () => 0));
  }

  return {
    buckets: buckets.map((bucket) => bucket.toISOString()),
    series: [...valuesBySeries.entries()]
      .sort(([leftKey, leftValues], [rightKey, rightValues]) => {
        const totalDifference = rightValues.reduce((sum, value) => sum + value, 0) - leftValues.reduce((sum, value) => sum + value, 0);
        return totalDifference || leftKey.localeCompare(rightKey);
      })
      .map(([key, values]) => ({
        key,
        label: key === "all" ? input.eventName?.trim() || "All events" : key,
        values
      }))
  };
}
