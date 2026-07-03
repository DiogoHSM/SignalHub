import type { Selectable } from "kysely";
import { sql } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { AnalyticsSegmentsTable } from "../schema.js";
import type { ApmWindow } from "./telemetry-query.js";

type AnalyticsSegmentRow = Selectable<AnalyticsSegmentsTable>;

export type AnalyticsSegmentActorType = "user" | "tenant";

export interface AnalyticsSegmentDefinition {
  window?: ApmWindow;
  eventName?: string;
  propertyName?: string;
  propertyValue?: string;
}

export interface AnalyticsSegmentRecord {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  description: string | null;
  actorType: AnalyticsSegmentActorType;
  definition: AnalyticsSegmentDefinition;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface AnalyticsSegmentPreviewActor {
  actorId: string;
  lastSeenAt: string;
}

export interface AnalyticsSegmentPreview {
  segmentId: string;
  actorType: AnalyticsSegmentActorType;
  window: ApmWindow;
  actors: number;
  samples: AnalyticsSegmentPreviewActor[];
}

export interface CreateAnalyticsSegmentInput {
  projectId: string;
  environmentId: string;
  name: string;
  description?: string | null;
  actorType: AnalyticsSegmentActorType;
  definition: AnalyticsSegmentDefinition;
}

export type UpdateAnalyticsSegmentInput = Partial<
  Pick<CreateAnalyticsSegmentInput, "name" | "description" | "actorType" | "definition">
>;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

function normalizeDefinition(definition: AnalyticsSegmentDefinition): AnalyticsSegmentDefinition {
  const next: AnalyticsSegmentDefinition = {};
  if (definition.window === "24h" || definition.window === "7d" || definition.window === "30d") {
    next.window = definition.window;
  }
  const eventName = definition.eventName?.trim();
  const propertyName = definition.propertyName?.trim();
  const propertyValue = definition.propertyValue?.trim();
  if (eventName) next.eventName = eventName;
  if (propertyName) next.propertyName = propertyName;
  if (propertyValue) next.propertyValue = propertyValue;
  return next;
}

function parseDefinition(value: unknown): AnalyticsSegmentDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return normalizeDefinition(value as AnalyticsSegmentDefinition);
}

function toSegment(row: AnalyticsSegmentRow): AnalyticsSegmentRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    name: row.name,
    description: row.description,
    actorType: row.actor_type,
    definition: parseDefinition(row.definition),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

export async function createAnalyticsSegment(db: Db, input: CreateAnalyticsSegmentInput): Promise<AnalyticsSegmentRecord> {
  const row = await db
    .insertInto("analytics_segments")
    .values({
      id: createId("seg"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      name: input.name,
      description: input.description ?? null,
      actor_type: input.actorType,
      definition: normalizeDefinition(input.definition)
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toSegment(row);
}

export async function listAnalyticsSegments(
  db: Db,
  input: { projectId: string; environmentId: string }
): Promise<AnalyticsSegmentRecord[]> {
  const rows = await db
    .selectFrom("analytics_segments")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .orderBy("created_at", "asc")
    .execute();

  return rows.map(toSegment);
}

export async function getAnalyticsSegment(
  db: Db,
  input: { id: string; projectId: string; environmentId: string }
): Promise<AnalyticsSegmentRecord | undefined> {
  const row = await db
    .selectFrom("analytics_segments")
    .selectAll()
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .executeTakeFirst();

  return row ? toSegment(row) : undefined;
}

export async function updateAnalyticsSegment(
  db: Db,
  id: string,
  input: UpdateAnalyticsSegmentInput
): Promise<AnalyticsSegmentRecord | undefined> {
  const row = await db
    .updateTable("analytics_segments")
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.actorType !== undefined ? { actor_type: input.actorType } : {}),
      ...(input.definition !== undefined ? { definition: normalizeDefinition(input.definition) } : {}),
      updated_at: new Date()
    })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toSegment(row) : undefined;
}

export async function archiveAnalyticsSegment(db: Db, id: string): Promise<void> {
  await db
    .updateTable("analytics_segments")
    .set({ archived_at: new Date(), updated_at: new Date() })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .execute();
}

export async function getAnalyticsSegmentActorIds(
  db: Db,
  segment: AnalyticsSegmentRecord,
  now = new Date()
): Promise<string[]> {
  const actorColumn = segment.actorType === "tenant" ? sql<string>`tenant_id` : sql<string>`user_id`;
  const { from, to } = resolveWindow(segment.definition.window, now);
  let query = db
    .selectFrom("events")
    .select(actorColumn.as("actor_id"))
    .where("project_id", "=", segment.projectId)
    .where("environment_id", "=", segment.environmentId)
    .where("timestamp", ">=", from)
    .where("timestamp", "<", to)
    .where(actorColumn, "is not", null)
    .groupBy(actorColumn);

  if (segment.definition.eventName) {
    query = query.where("name", "=", segment.definition.eventName);
  }
  if (segment.definition.propertyName) {
    query = query.where(sql<string>`properties ->> ${segment.definition.propertyName}`, "is not", null);
    if (segment.definition.propertyValue) {
      query = query.where(sql<string>`properties ->> ${segment.definition.propertyName}`, "=", segment.definition.propertyValue);
    }
  }

  const rows = await query.execute();
  return rows.map((row) => row.actor_id).filter((actorId): actorId is string => Boolean(actorId));
}

export async function previewAnalyticsSegment(
  db: Db,
  segment: AnalyticsSegmentRecord,
  input: { limit?: number; now?: Date } = {}
): Promise<AnalyticsSegmentPreview> {
  const actorColumn = segment.actorType === "tenant" ? sql<string>`tenant_id` : sql<string>`user_id`;
  const { window, from, to } = resolveWindow(segment.definition.window, input.now ?? new Date());
  const limit = Math.min(50, Math.max(1, Math.trunc(input.limit ?? 10)));
  let query = db
    .selectFrom("events")
    .select([actorColumn.as("actor_id"), sql<Date>`max(timestamp)`.as("last_seen_at")])
    .where("project_id", "=", segment.projectId)
    .where("environment_id", "=", segment.environmentId)
    .where("timestamp", ">=", from)
    .where("timestamp", "<", to)
    .where(actorColumn, "is not", null)
    .groupBy(actorColumn)
    .orderBy(sql`max(timestamp)`, "desc")
    .limit(limit);

  if (segment.definition.eventName) {
    query = query.where("name", "=", segment.definition.eventName);
  }
  if (segment.definition.propertyName) {
    query = query.where(sql<string>`properties ->> ${segment.definition.propertyName}`, "is not", null);
    if (segment.definition.propertyValue) {
      query = query.where(sql<string>`properties ->> ${segment.definition.propertyName}`, "=", segment.definition.propertyValue);
    }
  }

  const [countRows, sampleRows] = await Promise.all([
    getAnalyticsSegmentActorIds(db, segment, input.now).then((actors) => actors.length),
    query.execute()
  ]);

  return {
    segmentId: segment.id,
    actorType: segment.actorType,
    window,
    actors: countRows,
    samples: sampleRows.map((row) => ({
      actorId: row.actor_id,
      lastSeenAt: toIso(row.last_seen_at)
    }))
  };
}
