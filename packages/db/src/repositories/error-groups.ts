import { createHash } from "node:crypto";
import type { Selectable } from "kysely";
import { sql } from "kysely";
import type { Db } from "../client.js";
import type { ErrorGroupsTable } from "../schema.js";

export type ErrorGroupStatus = "open" | "investigating" | "resolved" | "ignored";

type ErrorGroupRow = Selectable<ErrorGroupsTable>;

export type ErrorGroupingInput = {
  fingerprint?: string | null;
  message: string;
  type?: string | null;
  stack?: string | null;
};

export type ErrorGroupingFingerprint = {
  fingerprint: string;
  source: string;
  topStackFrame: string | null;
};

const severityRank: Record<string, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  critical: 4,
  fatal: 5
};

export type ErrorGroupRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  groupingFingerprint: string;
  message: string;
  type: string | null;
  topStackFrame: string | null;
  severity: string;
  status: ErrorGroupStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastRegressedAt: Date | null;
  occurrenceCount: number;
  affectedUsersCount: number;
  affectedTenantsCount: number;
  latestErrorId: string | null;
  latestRelease: string | null;
  resolvedAt: Date | null;
  ignoredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ErrorGroupFilters = {
  projectId: string;
  environmentId: string;
  status?: ErrorGroupStatus;
  severity?: string;
  fingerprint?: string;
  tenantId?: string;
  userId?: string;
  release?: string;
  from?: Date;
  to?: Date;
  limit?: number;
};

export type UpsertErrorGroupInput = {
  projectId: string;
  environmentId: string;
  message: string;
  type?: string | null;
  severity: string;
  stack?: string | null;
  fingerprint?: string | null;
  timestamp: Date;
  userId?: string | null;
  tenantId?: string | null;
  release?: string | null;
  errorId: string;
};

const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const longNumberPattern = /\b\d{5,}\b/g;
const browserStackFramePattern = /^(?:[^\s@]*@)?(?:https?:\/\/|file:\/\/|webpack:\/\/|\/).+:\d+:\d+$/;

export function normalizeErrorGroupingInput(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(uuidPattern, "{uuid}")
    .replace(longNumberPattern, "{number}")
    .replace(/\s+/g, " ");
}

export function extractTopStackFrame(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const frame = stack
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("at ") || browserStackFramePattern.test(line));
  return frame ?? null;
}

export function buildErrorGroupingFingerprint(input: ErrorGroupingInput): ErrorGroupingFingerprint {
  const explicit = input.fingerprint?.trim();
  const topStackFrame = extractTopStackFrame(input.stack);
  if (explicit) {
    return {
      fingerprint: explicit,
      source: `explicit:${explicit}`,
      topStackFrame
    };
  }

  const source = [
    normalizeErrorGroupingInput(input.type),
    normalizeErrorGroupingInput(input.message),
    normalizeErrorGroupingInput(topStackFrame)
  ].join("|");

  return {
    fingerprint: `fp_${createHash("sha256").update(source).digest("hex").slice(0, 32)}`,
    source,
    topStackFrame
  };
}

function toGroup(row: ErrorGroupRow): ErrorGroupRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    groupingFingerprint: row.grouping_fingerprint,
    message: row.message,
    type: row.type,
    topStackFrame: row.top_stack_frame,
    severity: row.severity,
    status: row.status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastRegressedAt: row.last_regressed_at,
    occurrenceCount: row.occurrence_count,
    affectedUsersCount: row.affected_users_count,
    affectedTenantsCount: row.affected_tenants_count,
    latestErrorId: row.latest_error_id,
    latestRelease: row.latest_release,
    resolvedAt: row.resolved_at,
    ignoredAt: row.ignored_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function strongerSeverity(current: string, next: string): string {
  return (severityRank[next] ?? 0) > (severityRank[current] ?? 0) ? next : current;
}

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 50;
  return Math.min(500, Math.max(1, Math.trunc(limit)));
}

export async function upsertErrorGroupForOccurrence(
  db: Db,
  input: UpsertErrorGroupInput
): Promise<ErrorGroupingFingerprint & { groupId: string }> {
  return db.transaction().execute(async (trx) => {
    const grouping = buildErrorGroupingFingerprint(input);
    const existing = await trx
      .selectFrom("error_groups")
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("environment_id", "=", input.environmentId)
      .where("grouping_fingerprint", "=", grouping.fingerprint)
      .executeTakeFirst();

    if (!existing) {
      const inserted = await trx
        .insertInto("error_groups")
        .values({
          project_id: input.projectId,
          environment_id: input.environmentId,
          grouping_fingerprint: grouping.fingerprint,
          message: input.message,
          type: input.type ?? null,
          top_stack_frame: grouping.topStackFrame,
          severity: input.severity,
          status: "open",
          first_seen_at: input.timestamp,
          last_seen_at: input.timestamp,
          occurrence_count: 1,
          affected_users_count: input.userId ? 1 : 0,
          affected_tenants_count: input.tenantId ? 1 : 0,
          latest_error_id: input.errorId,
          latest_release: input.release ?? null
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      return { ...grouping, groupId: inserted.id };
    }

    const wasResolved = existing.status === "resolved";
    await trx
      .updateTable("error_groups")
      .set({
        severity: strongerSeverity(existing.severity, input.severity),
        status: wasResolved ? "open" : existing.status,
        last_seen_at: input.timestamp,
        last_regressed_at: wasResolved ? input.timestamp : existing.last_regressed_at,
        occurrence_count: sql<number>`occurrence_count + 1`,
        latest_error_id: input.errorId,
        latest_release: input.release ?? existing.latest_release,
        resolved_at: wasResolved ? null : existing.resolved_at,
        updated_at: new Date()
      })
      .where("id", "=", existing.id)
      .execute();

    return { ...grouping, groupId: existing.id };
  });
}

export async function listErrorGroups(db: Db, filters: ErrorGroupFilters): Promise<ErrorGroupRecord[]> {
  let query = db
    .selectFrom("error_groups")
    .selectAll()
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId);

  if (filters.status) query = query.where("status", "=", filters.status);
  if (filters.severity) query = query.where("severity", "=", filters.severity);
  if (filters.fingerprint) query = query.where("grouping_fingerprint", "=", filters.fingerprint);
  if (filters.release) query = query.where("latest_release", "=", filters.release);
  if (filters.from) query = query.where("last_seen_at", ">=", filters.from);
  if (filters.to) query = query.where("last_seen_at", "<", filters.to);
  if (filters.tenantId) {
    query = query.where(
      sql<boolean>`exists (
        select 1 from errors
        where errors.error_group_id = error_groups.id
          and errors.tenant_id = ${filters.tenantId}
      )`
    );
  }
  if (filters.userId) {
    query = query.where(
      sql<boolean>`exists (
        select 1 from errors
        where errors.error_group_id = error_groups.id
          and errors.user_id = ${filters.userId}
      )`
    );
  }

  const rows = await query
    .orderBy(sql<number>`case when status = 'open' and last_regressed_at is not null then 0 else 1 end`)
    .orderBy(sql<number>`case severity when 'critical' then 0 when 'error' then 1 else 2 end`)
    .orderBy(sql<number>`case status when 'open' then 0 when 'investigating' then 1 else 2 end`)
    .orderBy("last_seen_at", "desc")
    .limit(resolveLimit(filters.limit))
    .execute();

  return rows.map(toGroup);
}

export async function getErrorGroup(
  db: Db,
  input: { id: string; projectId: string; environmentId: string }
): Promise<ErrorGroupRecord | null> {
  const row = await db
    .selectFrom("error_groups")
    .selectAll()
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .executeTakeFirst();

  return row ? toGroup(row) : null;
}

export async function updateErrorGroupStatus(
  db: Db,
  input: { id: string; projectId: string; environmentId: string; status: ErrorGroupStatus; now?: Date }
): Promise<ErrorGroupRecord | null> {
  const now = input.now ?? new Date();
  const row = await db
    .updateTable("error_groups")
    .set({
      status: input.status,
      resolved_at: input.status === "resolved" ? now : null,
      ignored_at: input.status === "ignored" ? now : null,
      updated_at: now
    })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .returningAll()
    .executeTakeFirst();

  return row ? toGroup(row) : null;
}

export async function refreshErrorGroupStats(db: Db, groupId: string): Promise<void> {
  await sql`
    update error_groups
    set
      occurrence_count = stats.occurrence_count,
      affected_users_count = stats.affected_users_count,
      affected_tenants_count = stats.affected_tenants_count,
      first_seen_at = stats.first_seen_at,
      last_seen_at = stats.last_seen_at,
      latest_error_id = stats.latest_error_id,
      latest_release = stats.latest_release,
      updated_at = now()
    from (
      select
        count(*)::int as occurrence_count,
        count(distinct user_id) filter (where user_id is not null)::int as affected_users_count,
        count(distinct tenant_id) filter (where tenant_id is not null)::int as affected_tenants_count,
        min(timestamp) as first_seen_at,
        max(timestamp) as last_seen_at,
        (array_agg(id order by timestamp desc, received_at desc))[1] as latest_error_id,
        (array_agg(release order by timestamp desc, received_at desc) filter (where release is not null))[1] as latest_release
      from errors
      where error_group_id = ${groupId}
    ) stats
    where error_groups.id = ${groupId}
  `.execute(db);
}

export async function backfillErrorGroups(db: Db, input: { batchSize?: number } = {}): Promise<{ processed: number }> {
  const rows = await db
    .selectFrom("errors")
    .selectAll()
    .where("error_group_id", "is", null)
    .orderBy("timestamp", "asc")
    .limit(resolveLimit(input.batchSize ?? 100))
    .execute();

  for (const row of rows) {
    const grouping = await upsertErrorGroupForOccurrence(db, {
      projectId: row.project_id,
      environmentId: row.environment_id,
      message: row.message,
      type: row.type,
      severity: row.severity,
      stack: row.stack,
      fingerprint: row.fingerprint,
      timestamp: row.timestamp,
      userId: row.user_id,
      tenantId: row.tenant_id,
      release: row.release,
      errorId: row.id
    });

    await db
      .updateTable("errors")
      .set({ error_group_id: grouping.groupId, grouping_fingerprint: grouping.fingerprint })
      .where("id", "=", row.id)
      .execute();

    await refreshErrorGroupStats(db, grouping.groupId);
  }

  return { processed: rows.length };
}
