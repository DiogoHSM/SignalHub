import { sql } from "kysely";
import type { Kysely, Selectable, Transaction } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Database, TriageNotesTable } from "../schema.js";
import type { ErrorGroupRecord } from "./error-groups.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

// ── Types ──────────────────────────────────────────────────────────────────────

export type TriageNoteRecord = {
  id: string;
  errorGroupId: string;
  authorUserId: string | null;
  authorEmail: string;
  body: string;
  createdAt: Date;
};

export type AssignIncidentError =
  | { kind: "user_not_found" }
  | { kind: "user_archived" };

export type AssignIncidentResult =
  | { ok: true; group: ErrorGroupRecord }
  | { ok: false; error: AssignIncidentError };

export type MttrResult = {
  mttrMs: number | null;
  resolvedCount: number;
};

// ── Mappers ────────────────────────────────────────────────────────────────────

function toTriageNote(row: Selectable<TriageNotesTable>): TriageNoteRecord {
  return {
    id: row.id,
    errorGroupId: row.error_group_id,
    authorUserId: row.author_user_id,
    authorEmail: row.author_email,
    body: row.body,
    createdAt: row.created_at
  };
}

function toGroupFromRow(row: {
  id: string;
  project_id: string;
  environment_id: string;
  grouping_fingerprint: string;
  message: string;
  type: string | null;
  top_stack_frame: string | null;
  severity: string;
  status: "open" | "investigating" | "resolved" | "ignored";
  priority: "urgent" | "high" | "normal" | "low" | null;
  first_seen_at: Date;
  last_seen_at: Date;
  last_regressed_at: Date | null;
  occurrence_count: number;
  affected_users_count: number;
  affected_tenants_count: number;
  latest_error_id: string | null;
  latest_release: string | null;
  resolved_at: Date | null;
  ignored_at: Date | null;
  assigned_to_user_id: string | null;
  silenced_until: Date | null;
  incident_number: string | null;
  created_at: Date;
  updated_at: Date;
}): ErrorGroupRecord {
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
    silencedUntil: row.silenced_until,
    incidentNumber: row.incident_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ── assignIncident ─────────────────────────────────────────────────────────────

export async function assignIncident(
  db: DbExecutor,
  input: { errorGroupId: string; assignedToUserId: string | null }
): Promise<AssignIncidentResult> {
  if (input.assignedToUserId !== null) {
    const user = await (db as Kysely<Database>)
      .selectFrom("users")
      .select(["id", "archived_at"])
      .where("id", "=", input.assignedToUserId)
      .executeTakeFirst();

    if (!user) {
      return { ok: false, error: { kind: "user_not_found" } };
    }
    if (user.archived_at !== null) {
      return { ok: false, error: { kind: "user_archived" } };
    }
  }

  const row = await (db as Kysely<Database>)
    .updateTable("error_groups")
    .set({
      assigned_to_user_id: input.assignedToUserId,
      updated_at: new Date()
    })
    .where("id", "=", input.errorGroupId)
    .returningAll()
    .executeTakeFirst();

  if (!row) {
    return { ok: false, error: { kind: "user_not_found" } };
  }

  return { ok: true, group: toGroupFromRow(row) };
}

// ── addTriageNote ──────────────────────────────────────────────────────────────

export async function addTriageNote(
  db: DbExecutor,
  input: {
    errorGroupId: string;
    authorUserId: string | null;
    authorEmail: string;
    body: string;
  }
): Promise<TriageNoteRecord> {
  const row = await (db as Kysely<Database>)
    .insertInto("triage_notes")
    .values({
      id: createId("note"),
      error_group_id: input.errorGroupId,
      author_user_id: input.authorUserId,
      author_email: input.authorEmail,
      body: input.body
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toTriageNote(row);
}

// ── listTriageNotes ────────────────────────────────────────────────────────────

export async function listTriageNotes(
  db: DbExecutor,
  errorGroupId: string
): Promise<TriageNoteRecord[]> {
  const rows = await (db as Kysely<Database>)
    .selectFrom("triage_notes")
    .selectAll()
    .where("error_group_id", "=", errorGroupId)
    .orderBy("created_at", "asc")
    .execute();

  return rows.map(toTriageNote);
}

// ── silenceIncident ────────────────────────────────────────────────────────────

export async function silenceIncident(
  db: DbExecutor,
  input: { errorGroupId: string; until: Date | null }
): Promise<ErrorGroupRecord | null> {
  const row = await (db as Kysely<Database>)
    .updateTable("error_groups")
    .set({
      silenced_until: input.until,
      updated_at: new Date()
    })
    .where("id", "=", input.errorGroupId)
    .returningAll()
    .executeTakeFirst();

  return row ? toGroupFromRow(row) : null;
}

// ── getIncidentMttr ────────────────────────────────────────────────────────────

export async function getIncidentMttr(
  db: DbExecutor,
  input: { projectId: string; environmentId: string; windowDays: number }
): Promise<MttrResult> {
  const result = await sql<{ mttr_ms: string | null; resolved_count: string }>`
    SELECT
      avg(extract(epoch from resolved_at - first_seen_at) * 1000)::text AS mttr_ms,
      count(*)::text AS resolved_count
    FROM error_groups
    WHERE project_id = ${input.projectId}
      AND environment_id = ${input.environmentId}
      AND status = 'resolved'
      AND resolved_at IS NOT NULL
      AND resolved_at >= now() - (${input.windowDays} * interval '1 day')
  `.execute(db as Kysely<Database>);

  const row = result.rows[0];
  if (!row) {
    return { mttrMs: null, resolvedCount: 0 };
  }

  const resolvedCount = parseInt(row.resolved_count, 10);
  const mttrMs = row.mttr_ms !== null ? parseFloat(row.mttr_ms) : null;

  return {
    mttrMs: resolvedCount === 0 ? null : mttrMs,
    resolvedCount
  };
}
