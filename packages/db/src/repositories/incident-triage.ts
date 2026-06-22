import { sql } from "kysely";
import type { Kysely, Selectable, Transaction } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Database, TriageNotesTable } from "../schema.js";
import { toGroup } from "./error-groups.js";
import type { ErrorGroupRecord, ErrorGroupRow } from "./error-groups.js";

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
  | { kind: "group_not_found" }
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

// ── assignIncident ─────────────────────────────────────────────────────────────

export async function assignIncident(
  db: DbExecutor,
  input: { errorGroupId: string; assignedToUserId: string | null; projectId: string; environmentId: string }
): Promise<AssignIncidentResult> {
  const existingGroup = await (db as Kysely<Database>)
    .selectFrom("error_groups")
    .select("id")
    .where("id", "=", input.errorGroupId)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .executeTakeFirst();

  if (!existingGroup) {
    return { ok: false, error: { kind: "group_not_found" } };
  }

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
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .returningAll()
    .executeTakeFirstOrThrow() as ErrorGroupRow;

  return { ok: true, group: toGroup(row) };
}

// ── addTriageNote ──────────────────────────────────────────────────────────────

export type AddTriageNoteResult =
  | { ok: true; note: TriageNoteRecord }
  | { ok: false; error: "group_not_found" };

export async function addTriageNote(
  db: DbExecutor,
  input: {
    errorGroupId: string;
    authorUserId: string | null;
    authorEmail: string;
    body: string;
    projectId: string;
    environmentId: string;
  }
): Promise<AddTriageNoteResult> {
  const existingGroup = await (db as Kysely<Database>)
    .selectFrom("error_groups")
    .select("id")
    .where("id", "=", input.errorGroupId)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .executeTakeFirst();

  if (!existingGroup) {
    return { ok: false, error: "group_not_found" };
  }

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

  return { ok: true, note: toTriageNote(row) };
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
  input: { errorGroupId: string; until: Date | null; projectId: string; environmentId: string }
): Promise<ErrorGroupRecord | null> {
  const row = await (db as Kysely<Database>)
    .updateTable("error_groups")
    .set({
      silenced_until: input.until,
      updated_at: new Date()
    })
    .where("id", "=", input.errorGroupId)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .returningAll()
    .executeTakeFirst();

  return row ? toGroup(row as ErrorGroupRow) : null;
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
