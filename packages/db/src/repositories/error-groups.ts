import { createHash } from "node:crypto";
import type { Kysely, Selectable, Transaction } from "kysely";
import { sql } from "kysely";
import type { Db } from "../client.js";
import type { Database, ErrorGroupPriority as SchemaErrorGroupPriority, ErrorGroupsTable } from "../schema.js";

export type ErrorGroupStatus = "open" | "investigating" | "resolved" | "ignored";
export type ErrorGroupPriority = SchemaErrorGroupPriority;
export type ErrorGroupPriorityInput = ErrorGroupPriority | null;

export type ErrorGroupRow = Selectable<ErrorGroupsTable>;
type DbExecutor = Kysely<Database> | Transaction<Database>;

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
  priority: ErrorGroupPriority | null;
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
  assignedToUserId: string | null;
  assignedTo: { id: string; email: string } | null;
  silencedUntil: Date | null;
  incidentNumber: string | null;
  trend?: number[];
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
  cursor?: string;
};

type ErrorGroupCursorPayload = {
  projectId: string;
  environmentId: string;
  filterKey: string;
  regressionSort: number;
  severitySort: number;
  statusSort: number;
  lastSeenAt: string;
  id: string;
};

export type ErrorGroupPage = {
  data: ErrorGroupRecord[];
  cursor?: string;
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

type UpsertErrorGroupOptions = {
  reopenResolved?: boolean;
};

const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const longNumberPattern = /\b\d{5,}\b/g;
const browserStackFramePattern = /^(?:[^\s@]*@)?(?:https?:\/\/|file:\/\/|webpack:\/\/|\/).+:\d+:\d+$/;
const ERROR_GROUP_TREND_BUCKETS = 12;
const DEFAULT_ERROR_GROUP_TREND_WINDOW_MS = 24 * 60 * 60 * 1000;

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

export function toGroup(row: ErrorGroupRow): ErrorGroupRecord {
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
    priority: row.priority,
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
    assignedToUserId: row.assigned_to_user_id,
    assignedTo: null,
    silencedUntil: row.silenced_until,
    incidentNumber: row.incident_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function resolveTrendWindow(groups: ErrorGroupRecord[], filters: ErrorGroupFilters): { from: Date; to: Date } {
  const latestSeenAt = groups.reduce(
    (latest, group) => Math.max(latest, group.lastSeenAt.getTime()),
    0
  );
  const fallbackTo = new Date((latestSeenAt || Date.now()) + 1);
  const to = filters.to ?? fallbackTo;
  const from = filters.from ?? new Date(to.getTime() - DEFAULT_ERROR_GROUP_TREND_WINDOW_MS);

  if (to.getTime() > from.getTime()) {
    return { from, to };
  }

  return { from, to: new Date(from.getTime() + 1) };
}

async function attachErrorGroupTrends(
  db: Db,
  groups: ErrorGroupRecord[],
  filters: ErrorGroupFilters
): Promise<ErrorGroupRecord[]> {
  if (groups.length === 0) return groups;

  const groupIds = groups.map((group) => group.id);
  const { from, to } = resolveTrendWindow(groups, filters);
  const bucketMs = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / ERROR_GROUP_TREND_BUCKETS));
  const trends = new Map<string, number[]>(
    groupIds.map((groupId) => [groupId, Array(ERROR_GROUP_TREND_BUCKETS).fill(0) as number[]])
  );

  const rows = await db
    .selectFrom("errors")
    .select(["error_group_id", "timestamp"])
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId)
    .where("error_group_id", "in", groupIds)
    .where("timestamp", ">=", from)
    .where("timestamp", "<=", to)
    .execute();

  for (const row of rows) {
    if (row.error_group_id == null) continue;
    const trend = trends.get(row.error_group_id);
    if (!trend) continue;
    const offset = row.timestamp.getTime() - from.getTime();
    const index = Math.min(ERROR_GROUP_TREND_BUCKETS - 1, Math.max(0, Math.floor(offset / bucketMs)));
    trend[index] += 1;
  }

  return groups.map((group) => ({
    ...group,
    trend: trends.get(group.id) ?? Array(ERROR_GROUP_TREND_BUCKETS).fill(0)
  }));
}

async function attachErrorGroupAssignees(db: Db, groups: ErrorGroupRecord[]): Promise<ErrorGroupRecord[]> {
  const assignedUserIds = [
    ...new Set(
      groups
        .map((group) => group.assignedToUserId)
        .filter((userId): userId is string => userId != null)
    )
  ];

  if (assignedUserIds.length === 0) return groups;

  const rows = await db
    .selectFrom("users")
    .select(["id", "email"])
    .where("id", "in", assignedUserIds)
    .where("archived_at", "is", null)
    .execute();

  const usersById = new Map(rows.map((row) => [row.id, { id: row.id, email: row.email }]));

  return groups.map((group) => ({
    ...group,
    assignedTo: group.assignedToUserId ? usersById.get(group.assignedToUserId) ?? null : null
  }));
}

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 50;
  return Math.min(500, Math.max(1, Math.trunc(limit)));
}

function severitySortValue(severity: string): number {
  switch (severity) {
    case "fatal":
      return 0;
    case "critical":
      return 1;
    case "error":
      return 2;
    case "warning":
      return 3;
    case "info":
      return 4;
    case "debug":
      return 5;
    default:
      return 6;
  }
}

function statusSortValue(status: ErrorGroupStatus): number {
  switch (status) {
    case "open":
      return 0;
    case "investigating":
      return 1;
    default:
      return 2;
  }
}

function regressionSortValue(row: ErrorGroupRow): number {
  return row.status === "open" && row.last_regressed_at !== null ? 0 : 1;
}

function errorGroupCursorFilterKey(filters: ErrorGroupFilters): string {
  return JSON.stringify({
    status: filters.status ?? null,
    severity: filters.severity ?? null,
    fingerprint: filters.fingerprint ?? null,
    tenantId: filters.tenantId ?? null,
    userId: filters.userId ?? null,
    release: filters.release ?? null,
    from: filters.from?.toISOString() ?? null,
    to: filters.to?.toISOString() ?? null
  });
}

function encodeErrorGroupCursor(row: ErrorGroupRow, filters: ErrorGroupFilters): string {
  const payload: ErrorGroupCursorPayload = {
    projectId: filters.projectId,
    environmentId: filters.environmentId,
    filterKey: errorGroupCursorFilterKey(filters),
    regressionSort: regressionSortValue(row),
    severitySort: severitySortValue(row.severity),
    statusSort: statusSortValue(row.status),
    lastSeenAt: row.last_seen_at.toISOString(),
    id: row.id
  };

  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeErrorGroupCursor(cursor: string): ErrorGroupCursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid_cursor");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("invalid_cursor");
  }

  const payload = parsed as Partial<ErrorGroupCursorPayload>;
  const lastSeenAt = typeof payload.lastSeenAt === "string" ? new Date(payload.lastSeenAt) : null;
  if (
    typeof payload.projectId !== "string" ||
    typeof payload.environmentId !== "string" ||
    typeof payload.filterKey !== "string" ||
    typeof payload.regressionSort !== "number" ||
    typeof payload.severitySort !== "number" ||
    typeof payload.statusSort !== "number" ||
    typeof payload.id !== "string" ||
    lastSeenAt === null ||
    Number.isNaN(lastSeenAt.getTime())
  ) {
    throw new Error("invalid_cursor");
  }

  return payload as ErrorGroupCursorPayload;
}

const regressionSortSql = sql<number>`case when status = 'open' and last_regressed_at is not null then 0 else 1 end`;
const severitySortSql = sql<number>`case severity when 'fatal' then 0 when 'critical' then 1 when 'error' then 2 when 'warning' then 3 when 'info' then 4 when 'debug' then 5 else 6 end`;
const statusSortSql = sql<number>`case status when 'open' then 0 when 'investigating' then 1 else 2 end`;

export async function upsertErrorGroupForOccurrence(
  db: DbExecutor,
  input: UpsertErrorGroupInput,
  options: UpsertErrorGroupOptions = {}
): Promise<ErrorGroupingFingerprint & { groupId: string; incidentNumber: string | null }> {
  const grouping = buildErrorGroupingFingerprint(input);
  const reopenResolved = options.reopenResolved ?? true;
  const shouldReopenResolved = sql<boolean>`
    ${reopenResolved}
      and error_groups.status = 'resolved'
      and error_groups.resolved_at is not null
      and ${input.timestamp} > error_groups.resolved_at
  `;
  const inserted = await db
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
    .onConflict((oc) =>
      oc.columns(["project_id", "environment_id", "grouping_fingerprint"]).doUpdateSet({
        severity: sql<string>`
          case
            when case excluded.severity
              when 'fatal' then 5
              when 'critical' then 4
              when 'error' then 3
              when 'warning' then 2
              when 'info' then 1
              when 'debug' then 0
              else 0
            end > case error_groups.severity
              when 'fatal' then 5
              when 'critical' then 4
              when 'error' then 3
              when 'warning' then 2
              when 'info' then 1
              when 'debug' then 0
              else 0
            end
            then excluded.severity
            else error_groups.severity
          end
        `,
        status: sql<ErrorGroupStatus>`
          case
            when ${shouldReopenResolved} then 'open'
            else error_groups.status
          end
        `,
        last_seen_at: input.timestamp,
        last_regressed_at: sql<Date | null>`
          case
            when ${shouldReopenResolved} then ${input.timestamp}
            else error_groups.last_regressed_at
          end
        `,
        occurrence_count: sql<number>`error_groups.occurrence_count + 1`,
        latest_error_id: input.errorId,
        latest_release: sql<string | null>`coalesce(excluded.latest_release, error_groups.latest_release)`,
        resolved_at: sql<Date | null>`
          case
            when ${shouldReopenResolved} then null
            else error_groups.resolved_at
          end
        `,
        updated_at: new Date()
      })
    )
    .returning(["id", "incident_number"])
    .executeTakeFirstOrThrow();

  let incidentNumber = inserted.incident_number;

  if (incidentNumber === null) {
    const updated = await sql<{ incident_number: string }>`
      UPDATE error_groups
      SET incident_number = 'INC-' || lpad(nextval('incident_number_seq')::text, 4, '0')
      WHERE id = ${inserted.id} AND incident_number IS NULL
      RETURNING incident_number
    `.execute(db);
    incidentNumber = updated.rows[0]?.incident_number ?? null;
  }

  return { ...grouping, groupId: inserted.id, incidentNumber };
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
    .orderBy(regressionSortSql)
    .orderBy(severitySortSql)
    .orderBy(statusSortSql)
    .orderBy("last_seen_at", "desc")
    .orderBy("id", "desc")
    .limit(resolveLimit(filters.limit))
    .execute();

  const groups = await attachErrorGroupAssignees(db, rows.map(toGroup));
  return attachErrorGroupTrends(db, groups, filters);
}

export async function listErrorGroupsPage(db: Db, filters: ErrorGroupFilters): Promise<ErrorGroupPage> {
  const limit = resolveLimit(filters.limit);
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
  if (filters.cursor) {
    const cursor = decodeErrorGroupCursor(filters.cursor);
    if (
      cursor.projectId !== filters.projectId ||
      cursor.environmentId !== filters.environmentId ||
      cursor.filterKey !== errorGroupCursorFilterKey(filters)
    ) {
      throw new Error("invalid_cursor_scope");
    }

    const cursorLastSeenAt = new Date(cursor.lastSeenAt);
    query = query.where(sql<boolean>`(
      ${regressionSortSql} > ${cursor.regressionSort}
      or (
        ${regressionSortSql} = ${cursor.regressionSort}
        and ${severitySortSql} > ${cursor.severitySort}
      )
      or (
        ${regressionSortSql} = ${cursor.regressionSort}
        and ${severitySortSql} = ${cursor.severitySort}
        and ${statusSortSql} > ${cursor.statusSort}
      )
      or (
        ${regressionSortSql} = ${cursor.regressionSort}
        and ${severitySortSql} = ${cursor.severitySort}
        and ${statusSortSql} = ${cursor.statusSort}
        and last_seen_at < ${cursorLastSeenAt}
      )
      or (
        ${regressionSortSql} = ${cursor.regressionSort}
        and ${severitySortSql} = ${cursor.severitySort}
        and ${statusSortSql} = ${cursor.statusSort}
        and last_seen_at = ${cursorLastSeenAt}
        and id < ${cursor.id}
      )
    )`);
  }

  const rows = await query
    .orderBy(regressionSortSql)
    .orderBy(severitySortSql)
    .orderBy(statusSortSql)
    .orderBy("last_seen_at", "desc")
    .orderBy("id", "desc")
    .limit(limit + 1)
    .execute();

  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows.at(-1);
  const groups = await attachErrorGroupAssignees(db, pageRows.map(toGroup));

  return {
    data: await attachErrorGroupTrends(db, groups, filters),
    cursor: rows.length > limit && lastRow ? encodeErrorGroupCursor(lastRow, filters) : undefined
  };
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

export async function updateErrorGroupTriage(
  db: Db,
  input: {
    id: string;
    projectId: string;
    environmentId: string;
    status?: ErrorGroupStatus;
    priority?: ErrorGroupPriorityInput;
    now?: Date;
  }
): Promise<ErrorGroupRecord | null> {
  const patch: {
    status?: ErrorGroupStatus;
    priority?: ErrorGroupPriorityInput;
    resolved_at?: Date | null;
    ignored_at?: Date | null;
    updated_at: Date;
  } = { updated_at: input.now ?? new Date() };

  if (input.status !== undefined) {
    patch.status = input.status;
    patch.resolved_at = input.status === "resolved" ? patch.updated_at : null;
    patch.ignored_at = input.status === "ignored" ? patch.updated_at : null;
  }

  if ("priority" in input) {
    patch.priority = input.priority ?? null;
  }

  const row = await db
    .updateTable("error_groups")
    .set(patch)
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .returningAll()
    .executeTakeFirst();

  return row ? toGroup(row) : null;
}

export async function updateErrorGroupStatus(
  db: Db,
  input: { id: string; projectId: string; environmentId: string; status: ErrorGroupStatus; now?: Date }
): Promise<ErrorGroupRecord | null> {
  return updateErrorGroupTriage(db, input);
}

export async function refreshErrorGroupStats(db: DbExecutor, groupId: string): Promise<void> {
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
        (array_agg(id order by timestamp desc, received_at desc, id desc))[1] as latest_error_id,
        (array_agg(release order by timestamp desc, received_at desc, id desc) filter (where release is not null))[1] as latest_release
      from errors
      where error_group_id = ${groupId}
    ) stats
    where error_groups.id = ${groupId}
  `.execute(db);
}

export async function backfillErrorGroups(
  db: Db,
  input: { batchSize?: number } = {}
): Promise<{ processed: number; selected: number; batchSize: number }> {
  const batchSize = resolveLimit(input.batchSize ?? 100);
  const rows = await db
    .selectFrom("errors")
    .selectAll()
    .where("error_group_id", "is", null)
    .orderBy("timestamp", "asc")
    .limit(batchSize)
    .execute();

  let processed = 0;
  for (const row of rows) {
    await db.transaction().execute(async (trx) => {
      const currentRow = await trx
        .selectFrom("errors")
        .selectAll()
        .where("id", "=", row.id)
        .forUpdate()
        .executeTakeFirst();

      if (!currentRow || currentRow.error_group_id) return;

      const grouping = await upsertErrorGroupForOccurrence(
        trx,
        {
          projectId: currentRow.project_id,
          environmentId: currentRow.environment_id,
          message: currentRow.message,
          type: currentRow.type,
          severity: currentRow.severity,
          stack: currentRow.stack,
          fingerprint: currentRow.fingerprint,
          timestamp: currentRow.timestamp,
          userId: currentRow.user_id,
          tenantId: currentRow.tenant_id,
          release: currentRow.release,
          errorId: currentRow.id
        }
      );

      const updateResult = await trx
        .updateTable("errors")
        .set({ error_group_id: grouping.groupId, grouping_fingerprint: grouping.fingerprint })
        .where("id", "=", currentRow.id)
        .where("error_group_id", "is", null)
        .execute();

      if (updateResult[0]?.numUpdatedRows === 1n) {
        await refreshErrorGroupStats(trx, grouping.groupId);
        processed += 1;
      }
    });
  }

  return { processed, selected: rows.length, batchSize };
}
