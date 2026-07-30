import { sql } from "kysely";
import type { Db } from "../client.js";

// Distinct advisory-lock id for the event rollup scheduler. Existing ids in use:
// 927380402913 (migrate.ts), 927380402914 (system.ts retention), 927380402915 (alerts.ts),
// 927380402916 (backups.ts), 927380402917 (monitors.ts), 927380402918 (warehouse-exports.ts).
const eventRollupAdvisoryLockId = 927380402919;

/**
 * `event_rollup_state` is scoped by (project_id, environment_id, rollup) so future per-scope
 * rollups (e.g. an hourly rollup in PER-442) can track independent watermarks. The daily actor
 * rollup here processes every project/environment in one pass per day, so it uses this sentinel
 * scope for its single global watermark row.
 */
export const EVENT_ROLLUP_GLOBAL_SCOPE = "*";
export const EVENT_ACTOR_DAILY_ROLLUP = "actor_daily";
export const EVENT_HOURLY_ROLLUP = "event_hourly";

const HOUR_MS = 60 * 60 * 1000;

function startOfUtcHour(value: Date): Date {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
      value.getUTCHours()
    )
  );
}

async function tryAcquireEventRollupSessionLock(db: Db): Promise<boolean> {
  const result = await sql<{ locked: boolean }>`
    select pg_try_advisory_lock(${eventRollupAdvisoryLockId}) as locked
  `.execute(db);
  return result.rows[0]?.locked === true;
}

async function releaseEventRollupSessionLock(db: Db): Promise<void> {
  await sql`select pg_advisory_unlock(${eventRollupAdvisoryLockId})`.execute(db);
}

// Session-scoped advisory lock (not transaction-scoped): the rollup job upserts one day at a time
// in short, independent statements rather than one long transaction, so the lock is held by a
// dedicated pooled connection for the run's duration while the guarded work uses the normal `db`.
export async function withEventRollupLock<T>(
  db: Db,
  run: () => Promise<T>
): Promise<{ locked: false } | { locked: true; result: T }> {
  return db.connection().execute(async (connectionDb) => {
    const locked = await tryAcquireEventRollupSessionLock(connectionDb);
    if (!locked) return { locked: false };

    try {
      return { locked: true, result: await run() };
    } finally {
      await releaseEventRollupSessionLock(connectionDb);
    }
  });
}

export async function upsertEventActorDaily(
  db: Db,
  input: { projectId?: string; environmentId?: string; from: Date; to: Date }
): Promise<number> {
  const result = await sql<{ upserted_count: string }>`
    with inserted as (
      insert into event_actor_daily
        (project_id, environment_id, day, actor_type, actor_id, event_name, events, updated_at)
      select
        project_id,
        environment_id,
        (timestamp at time zone 'UTC')::date,
        case
          when user_id is not null then 'user'
          when tenant_id is not null then 'tenant'
          when session_id is not null then 'session'
          else 'trace'
        end,
        coalesce(user_id, tenant_id, session_id, trace_id),
        name,
        count(*),
        now()
      from events
      where timestamp >= ${input.from}
        and timestamp < ${input.to}
        and coalesce(user_id, tenant_id, session_id, trace_id) is not null
        ${input.projectId !== undefined ? sql`and project_id = ${input.projectId}` : sql``}
        ${input.environmentId !== undefined ? sql`and environment_id = ${input.environmentId}` : sql``}
      group by 1, 2, 3, 4, 5, 6
      on conflict (project_id, environment_id, day, actor_type, actor_id, event_name)
      do update set events = excluded.events, updated_at = now()
      returning 1
    )
    select count(*)::text as upserted_count from inserted
  `.execute(db);

  return Number(result.rows[0]?.upserted_count ?? 0);
}

/**
 * Rebuilds one bounded UTC interval from raw events. Replacing the interval, instead of merely
 * incrementing counters, makes retries idempotent and lets the maintenance pass absorb events
 * that arrived after an earlier rollup.
 */
export async function upsertEventHourlyRollup(
  db: Db,
  input: { projectId: string; environmentId: string; from: Date; to: Date }
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    await sql`
      delete from event_rollup_hourly
      where project_id = ${input.projectId}
        and environment_id = ${input.environmentId}
        and bucket_start >= ${input.from}
        and bucket_start < ${input.to}
    `.execute(trx);

    const result = await sql<{ upserted_count: string }>`
      with base as materialized (
        select
          e.project_id,
          e.environment_id,
          date_trunc('hour', e.timestamp at time zone 'UTC') at time zone 'UTC' as bucket_start,
          e.name as event_name,
          case
            when e.user_id is not null then 'user'
            when e.tenant_id is not null then 'tenant'
            when e.session_id is not null then 'session'
            when e.trace_id is not null then 'trace'
            else null
          end as actor_type,
          coalesce(e.user_id, e.tenant_id, e.session_id, e.trace_id) as actor_id,
          e.properties
        from events e
        where e.project_id = ${input.projectId}
          and e.environment_id = ${input.environmentId}
          and e.timestamp >= ${input.from}
          and e.timestamp < ${input.to}
      ),
      promoted as materialized (
        select
          b.*,
          p.property_key as breakdown_property,
          case
            when b.properties ->> p.property_key is null then 'm:'
            else 'v:' || (b.properties ->> p.property_key)
          end as breakdown_value
        from base b
        join analytics_promoted_event_properties p
          on p.project_id = b.project_id
         and p.environment_id = b.environment_id
         and p.archived_at is null
      ),
      rollup_rows as (
        select
          project_id, environment_id, bucket_start, event_name,
          ''::text as breakdown_property, ''::text as breakdown_value,
          ''::text as actor_type, ''::text as actor_id,
          count(*)::bigint as event_count
        from base
        group by project_id, environment_id, bucket_start, event_name

        union all

        select
          project_id, environment_id, bucket_start, event_name,
          ''::text, ''::text, actor_type, actor_id,
          count(*)::bigint
        from base
        where actor_id is not null
        group by project_id, environment_id, bucket_start, event_name, actor_type, actor_id

        union all

        select
          project_id, environment_id, bucket_start, event_name,
          breakdown_property, breakdown_value,
          ''::text, ''::text,
          count(*)::bigint
        from promoted
        group by project_id, environment_id, bucket_start, event_name, breakdown_property, breakdown_value

        union all

        select
          project_id, environment_id, bucket_start, event_name,
          breakdown_property, breakdown_value, actor_type, actor_id,
          count(*)::bigint
        from promoted
        where actor_id is not null
        group by
          project_id, environment_id, bucket_start, event_name,
          breakdown_property, breakdown_value, actor_type, actor_id
      ),
      inserted as (
        insert into event_rollup_hourly (
          project_id, environment_id, bucket_start, event_name,
          breakdown_property, breakdown_value, actor_type, actor_id, event_count, updated_at
        )
        select
          project_id, environment_id, bucket_start, event_name,
          breakdown_property, breakdown_value, actor_type, actor_id, event_count, now()
        from rollup_rows
        returning 1
      )
      select count(*)::text as upserted_count from inserted
    `.execute(trx);

    return Number(result.rows[0]?.upserted_count ?? 0);
  });
}

export type EventHourlyRollupBackfillResult = {
  scopesProcessed: number;
  hoursProcessed: number;
  rowsUpserted: number;
};

/**
 * Advances each telemetry scope independently. Historical catch-up is bounded per scope, while
 * the current and previous UTC hours are always rebuilt to account for late delivery.
 *
 * The caller must hold `withEventRollupLock`; keeping lock ownership in the scheduler lets the
 * daily actor and hourly event rollups share one non-overlapping maintenance cycle.
 */
export async function runEventHourlyRollupBackfill(
  db: Db,
  input: { now: Date; lookbackHours: number; maxBackfillHoursPerScope: number }
): Promise<EventHourlyRollupBackfillResult> {
  const currentHour = startOfUtcHour(input.now);
  const targetEnd = new Date(currentHour.getTime() + HOUR_MS);
  const fallbackStart = new Date(
    currentHour.getTime() - Math.max(0, Math.trunc(input.lookbackHours)) * HOUR_MS
  );
  const maxBackfillHoursPerScope = Math.max(0, Math.trunc(input.maxBackfillHoursPerScope));
  const scopes = await sql<{
    project_id: string;
    environment_id: string;
    first_event_at: Date;
  }>`
    select project_id, environment_id, min(timestamp) as first_event_at
    from events
    where timestamp < ${targetEnd}
    group by project_id, environment_id
    order by project_id, environment_id
  `.execute(db);

  let hoursProcessed = 0;
  let rowsUpserted = 0;

  for (const scope of scopes.rows) {
    const firstEventHour = startOfUtcHour(scope.first_event_at);
    const initialStart = new Date(Math.max(fallbackStart.getTime(), firstEventHour.getTime()));
    const watermark = await getEventRollupWatermark(db, {
      projectId: scope.project_id,
      environmentId: scope.environment_id,
      rollup: EVENT_HOURLY_ROLLUP
    });
    let cursor = watermark ? startOfUtcHour(watermark) : initialStart;
    if (cursor.getTime() > targetEnd.getTime()) cursor = targetEnd;

    const processedHours = new Set<number>();
    const processHour = async (from: Date, force = false) => {
      if ((!force && from.getTime() < firstEventHour.getTime()) || from.getTime() >= targetEnd.getTime()) return;
      if (processedHours.has(from.getTime())) return;
      processedHours.add(from.getTime());
      rowsUpserted += await upsertEventHourlyRollup(db, {
        projectId: scope.project_id,
        environmentId: scope.environment_id,
        from,
        to: new Date(from.getTime() + HOUR_MS)
      });
      hoursProcessed += 1;
    };

    let backfillHours = 0;
    while (cursor.getTime() < targetEnd.getTime() && backfillHours < maxBackfillHoursPerScope) {
      await processHour(cursor);
      cursor = new Date(cursor.getTime() + HOUR_MS);
      backfillHours += 1;
    }

    await processHour(new Date(currentHour.getTime() - HOUR_MS), true);
    await processHour(currentHour, true);

    await setEventRollupWatermark(db, {
      projectId: scope.project_id,
      environmentId: scope.environment_id,
      rollup: EVENT_HOURLY_ROLLUP,
      watermarkAt: cursor
    });
  }

  return { scopesProcessed: scopes.rows.length, hoursProcessed, rowsUpserted };
}

export async function getEventRollupWatermark(
  db: Db,
  input: { projectId?: string; environmentId?: string; rollup: string }
): Promise<Date | null> {
  const row = await db
    .selectFrom("event_rollup_state")
    .select(["watermark_at"])
    .where("project_id", "=", input.projectId ?? EVENT_ROLLUP_GLOBAL_SCOPE)
    .where("environment_id", "=", input.environmentId ?? EVENT_ROLLUP_GLOBAL_SCOPE)
    .where("rollup", "=", input.rollup)
    .executeTakeFirst();

  return row ? row.watermark_at : null;
}

export async function setEventRollupWatermark(
  db: Db,
  input: { projectId?: string; environmentId?: string; rollup: string; watermarkAt: Date }
): Promise<void> {
  const projectId = input.projectId ?? EVENT_ROLLUP_GLOBAL_SCOPE;
  const environmentId = input.environmentId ?? EVENT_ROLLUP_GLOBAL_SCOPE;

  await db
    .insertInto("event_rollup_state")
    .values({
      project_id: projectId,
      environment_id: environmentId,
      rollup: input.rollup,
      watermark_at: input.watermarkAt,
      updated_at: input.watermarkAt
    })
    .onConflict((oc) =>
      oc.columns(["project_id", "environment_id", "rollup"]).doUpdateSet({
        watermark_at: input.watermarkAt,
        updated_at: input.watermarkAt
      })
    )
    .execute();
}
