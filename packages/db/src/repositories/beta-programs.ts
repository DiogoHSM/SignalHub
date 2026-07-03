import type { Selectable } from "kysely";
import { sql } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { BetaProgramActorType, BetaProgramParticipantsTable, BetaProgramsTable, BetaProgramParticipantStatus, BetaProgramStatus } from "../schema.js";
import type { ApmWindow } from "./telemetry-query.js";

type BetaProgramRow = Selectable<BetaProgramsTable>;
type BetaProgramParticipantRow = Selectable<BetaProgramParticipantsTable>;

export type { BetaProgramActorType, BetaProgramParticipantStatus, BetaProgramStatus };

export interface BetaProgramRecord {
  id: string;
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description: string | null;
  status: BetaProgramStatus;
  actorType: BetaProgramActorType;
  featureFlagId: string | null;
  featureFlagVariant: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface BetaProgramParticipantRecord {
  id: string;
  programId: string;
  projectId: string;
  environmentId: string;
  actorType: BetaProgramActorType;
  actorId: string;
  status: BetaProgramParticipantStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  removedAt: Date | null;
}

export interface BetaProgramAdoption {
  programId: string;
  window: ApmWindow;
  participants: number;
  activeParticipants: number;
  activeActorsWithEvents: number;
  events: number;
  adoptionRate: number;
  samples: Array<{ actorId: string; events: number; lastSeenAt: string }>;
}

export interface CreateBetaProgramInput {
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description?: string | null;
  status?: BetaProgramStatus;
  actorType?: BetaProgramActorType;
  featureFlagId?: string | null;
  featureFlagVariant?: string;
}

export type UpdateBetaProgramInput = Partial<
  Pick<CreateBetaProgramInput, "name" | "description" | "status" | "actorType" | "featureFlagId" | "featureFlagVariant">
>;

export interface AddBetaProgramParticipantInput {
  programId: string;
  projectId: string;
  environmentId: string;
  actorType: BetaProgramActorType;
  actorId: string;
  status?: BetaProgramParticipantStatus;
  notes?: string | null;
}

function normalizeText(value: string | undefined | null, fallback: string, max = 120): string {
  const trimmed = value?.trim() ?? "";
  return (trimmed || fallback).slice(0, max);
}

function normalizeKey(value: string, fallback = "beta_program"): string {
  return normalizeText(value, fallback, 80).replace(/\s+/g, "_").toLowerCase();
}

function normalizeStatus(value: BetaProgramStatus | undefined): BetaProgramStatus {
  return value === "active" || value === "paused" || value === "archived" ? value : "draft";
}

function normalizeParticipantStatus(value: BetaProgramParticipantStatus | undefined): BetaProgramParticipantStatus {
  return value === "invited" || value === "opted_out" || value === "removed" ? value : "active";
}

function normalizeActorType(value: BetaProgramActorType | undefined): BetaProgramActorType {
  return value === "tenant" ? "tenant" : "user";
}

function toProgram(row: BetaProgramRow): BetaProgramRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    actorType: row.actor_type,
    featureFlagId: row.feature_flag_id,
    featureFlagVariant: row.feature_flag_variant,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

function toParticipant(row: BetaProgramParticipantRow): BetaProgramParticipantRecord {
  return {
    id: row.id,
    programId: row.program_id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    removedAt: row.removed_at
  };
}

function resolveWindow(window: ApmWindow | undefined, now: Date): { window: ApmWindow; from: Date; to: Date } {
  const selected = window ?? "30d";
  const to = now;
  const from = new Date(to);
  if (selected === "24h") from.setUTCHours(from.getUTCHours() - 24);
  if (selected === "7d") from.setUTCDate(from.getUTCDate() - 7);
  if (selected === "30d") from.setUTCDate(from.getUTCDate() - 30);
  return { window: selected, from, to };
}

async function getProgram(db: Db, input: { id: string; projectId: string; environmentId: string }): Promise<BetaProgramRecord | undefined> {
  const row = await db
    .selectFrom("beta_programs")
    .selectAll()
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  return row ? toProgram(row) : undefined;
}

async function syncProgramFlagRules(db: Db, programId: string, projectId: string, environmentId: string): Promise<void> {
  const program = await getProgram(db, { id: programId, projectId, environmentId });
  if (!program?.featureFlagId) return;

  const [flag, participants] = await Promise.all([
    db
      .selectFrom("feature_flags")
      .selectAll()
      .where("id", "=", program.featureFlagId)
      .where("project_id", "=", projectId)
      .where("environment_id", "=", environmentId)
      .where("archived_at", "is", null)
      .executeTakeFirst(),
    listBetaProgramParticipants(db, { programId, projectId, environmentId })
  ]);
  if (!flag) return;

  const existingRules = Array.isArray(flag.rules) ? (flag.rules as Array<Record<string, unknown>>) : [];
  const preserved = existingRules.filter((rule) => typeof rule.id !== "string" || !rule.id.startsWith(`beta_${programId}_`));
  const betaRules = participants
    .filter((participant) => participant.status === "active")
    .map((participant) => ({
      id: `beta_${programId}_${participant.id}`,
      description: `${program.name} participant`,
      variant: program.featureFlagVariant,
      match: participant.actorType === "tenant" ? { tenantId: participant.actorId } : { userId: participant.actorId }
    }));

  await db
    .updateTable("feature_flags")
    .set({ rules: sql`${JSON.stringify([...preserved, ...betaRules])}::jsonb`, updated_at: new Date() })
    .where("id", "=", program.featureFlagId)
    .where("project_id", "=", projectId)
    .where("environment_id", "=", environmentId)
    .where("archived_at", "is", null)
    .execute();
}

async function removeProgramFlagRules(db: Db, program: BetaProgramRecord): Promise<void> {
  if (!program.featureFlagId) return;

  const flag = await db
    .selectFrom("feature_flags")
    .selectAll()
    .where("id", "=", program.featureFlagId)
    .where("project_id", "=", program.projectId)
    .where("environment_id", "=", program.environmentId)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  if (!flag) return;

  const existingRules = Array.isArray(flag.rules) ? (flag.rules as Array<Record<string, unknown>>) : [];
  const preserved = existingRules.filter((rule) => typeof rule.id !== "string" || !rule.id.startsWith(`beta_${program.id}_`));
  await db
    .updateTable("feature_flags")
    .set({ rules: sql`${JSON.stringify(preserved)}::jsonb`, updated_at: new Date() })
    .where("id", "=", program.featureFlagId)
    .where("project_id", "=", program.projectId)
    .where("environment_id", "=", program.environmentId)
    .where("archived_at", "is", null)
    .execute();
}

export async function createBetaProgram(db: Db, input: CreateBetaProgramInput): Promise<BetaProgramRecord> {
  const row = await db
    .insertInto("beta_programs")
    .values({
      id: createId("beta"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      key: normalizeKey(input.key),
      name: normalizeText(input.name, input.key),
      description: input.description?.trim() || null,
      status: normalizeStatus(input.status),
      actor_type: normalizeActorType(input.actorType),
      feature_flag_id: input.featureFlagId ?? null,
      feature_flag_variant: normalizeKey(input.featureFlagVariant ?? "on", "on")
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toProgram(row);
}

export async function listBetaPrograms(db: Db, input: { projectId: string; environmentId: string }): Promise<BetaProgramRecord[]> {
  const rows = await db
    .selectFrom("beta_programs")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .orderBy("updated_at", "desc")
    .execute();
  return rows.map(toProgram);
}

export async function updateBetaProgram(
  db: Db,
  input: { id: string; projectId: string; environmentId: string; patch: UpdateBetaProgramInput }
): Promise<BetaProgramRecord | undefined> {
  const row = await db
    .updateTable("beta_programs")
    .set({
      ...(input.patch.name !== undefined ? { name: normalizeText(input.patch.name, "Untitled beta program") } : {}),
      ...(input.patch.description !== undefined ? { description: input.patch.description?.trim() || null } : {}),
      ...(input.patch.status !== undefined ? { status: normalizeStatus(input.patch.status) } : {}),
      ...(input.patch.actorType !== undefined ? { actor_type: normalizeActorType(input.patch.actorType) } : {}),
      ...(input.patch.featureFlagId !== undefined ? { feature_flag_id: input.patch.featureFlagId } : {}),
      ...(input.patch.featureFlagVariant !== undefined ? { feature_flag_variant: normalizeKey(input.patch.featureFlagVariant, "on") } : {}),
      updated_at: new Date()
    })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();
  await syncProgramFlagRules(db, input.id, input.projectId, input.environmentId);
  return row ? toProgram(row) : undefined;
}

export async function archiveBetaProgram(db: Db, input: { id: string; projectId: string; environmentId: string }): Promise<void> {
  const program = await getProgram(db, input);
  await db
    .updateTable("beta_programs")
    .set({ archived_at: new Date(), updated_at: new Date() })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .execute();
  if (program) await removeProgramFlagRules(db, program);
}

export async function addBetaProgramParticipant(db: Db, input: AddBetaProgramParticipantInput): Promise<BetaProgramParticipantRecord> {
  const row = await db
    .insertInto("beta_program_participants")
    .values({
      id: createId("betap"),
      program_id: input.programId,
      project_id: input.projectId,
      environment_id: input.environmentId,
      actor_type: normalizeActorType(input.actorType),
      actor_id: normalizeText(input.actorId, "actor", 256),
      status: normalizeParticipantStatus(input.status),
      notes: input.notes?.trim() || null
    })
    .onConflict((oc) =>
      oc.columns(["program_id", "actor_type", "actor_id"]).where("removed_at", "is", null).doUpdateSet({
        status: normalizeParticipantStatus(input.status),
        notes: input.notes?.trim() || null,
        updated_at: new Date()
      })
    )
    .returningAll()
    .executeTakeFirstOrThrow();
  await syncProgramFlagRules(db, input.programId, input.projectId, input.environmentId);
  return toParticipant(row);
}

export async function listBetaProgramParticipants(
  db: Db,
  input: { programId: string; projectId: string; environmentId: string }
): Promise<BetaProgramParticipantRecord[]> {
  const rows = await db
    .selectFrom("beta_program_participants")
    .selectAll()
    .where("program_id", "=", input.programId)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("removed_at", "is", null)
    .orderBy("updated_at", "desc")
    .execute();
  return rows.map(toParticipant);
}

export async function removeBetaProgramParticipant(
  db: Db,
  input: { programId: string; projectId: string; environmentId: string; participantId: string }
): Promise<void> {
  await db
    .updateTable("beta_program_participants")
    .set({ status: "removed", removed_at: new Date(), updated_at: new Date() })
    .where("id", "=", input.participantId)
    .where("program_id", "=", input.programId)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("removed_at", "is", null)
    .execute();
  await syncProgramFlagRules(db, input.programId, input.projectId, input.environmentId);
}

export async function getBetaProgramAdoption(
  db: Db,
  input: { programId: string; projectId: string; environmentId: string; window?: ApmWindow; now?: Date; limit?: number }
): Promise<BetaProgramAdoption> {
  const program = await getProgram(db, { id: input.programId, projectId: input.projectId, environmentId: input.environmentId });
  const window = resolveWindow(input.window, input.now ?? new Date());
  const participants = await listBetaProgramParticipants(db, input);
  const active = participants.filter((participant) => participant.status === "active");
  if (!program || active.length === 0) {
    return {
      programId: input.programId,
      window: window.window,
      participants: participants.length,
      activeParticipants: active.length,
      activeActorsWithEvents: 0,
      events: 0,
      adoptionRate: 0,
      samples: []
    };
  }

  const actorIds = active.map((participant) => participant.actorId);
  const limit = Math.min(50, Math.max(1, Math.trunc(input.limit ?? 10)));
  const baseQuery = db
    .selectFrom("events")
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("timestamp", ">=", window.from)
    .where("timestamp", "<", window.to);
  const rows =
    program.actorType === "tenant"
      ? await baseQuery
          .select(["tenant_id as actor_id", sql<number>`count(*)::int`.as("events"), sql<Date>`max(timestamp)`.as("last_seen_at")])
          .where("tenant_id", "in", actorIds)
          .groupBy("tenant_id")
          .orderBy(sql`count(*)`, "desc")
          .limit(limit)
          .execute()
      : await baseQuery
          .select(["user_id as actor_id", sql<number>`count(*)::int`.as("events"), sql<Date>`max(timestamp)`.as("last_seen_at")])
          .where("user_id", "in", actorIds)
          .groupBy("user_id")
          .orderBy(sql`count(*)`, "desc")
          .limit(limit)
          .execute();

  const events = rows.reduce((total, row) => total + Number(row.events), 0);
  const activeActorsWithEvents = rows.length;
  return {
    programId: input.programId,
    window: window.window,
    participants: participants.length,
    activeParticipants: active.length,
    activeActorsWithEvents,
    events,
    adoptionRate: active.length === 0 ? 0 : Math.round((activeActorsWithEvents / active.length) * 1000) / 10,
    samples: rows
      .filter((row): row is typeof row & { actor_id: string } => Boolean(row.actor_id))
      .map((row) => ({ actorId: row.actor_id, events: Number(row.events), lastSeenAt: new Date(row.last_seen_at).toISOString() }))
  };
}
