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
