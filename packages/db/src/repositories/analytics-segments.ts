import type { Selectable } from "kysely";
import { sql } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { AnalyticsSegmentsTable } from "../schema.js";
import type { ApmWindow } from "./telemetry-query.js";
import {
  compileSegmentDefinition,
  validateSegmentDefinition,
  type AnalyticsSegmentDefinitionV2,
  type SegmentEventLeaf
} from "./analytics-segment-compiler.js";

export {
  compileSegmentDefinition,
  validateSegmentDefinition,
  SegmentDefinitionError,
  type AnalyticsSegmentDefinitionV2,
  type SegmentNode,
  type SegmentEventLeaf,
  type SegmentTraitLeaf,
  type SegmentGroupNode,
  type SegmentOperator,
  type SegmentCompileScope
} from "./analytics-segment-compiler.js";

type AnalyticsSegmentRow = Selectable<AnalyticsSegmentsTable>;

export type AnalyticsSegmentActorType = "user" | "tenant";

export interface AnalyticsSegmentDefinitionV1 {
  window?: ApmWindow;
  eventName?: string;
  propertyName?: string;
  propertyValue?: string;
}

export type AnalyticsSegmentDefinition = AnalyticsSegmentDefinitionV1 | AnalyticsSegmentDefinitionV2;

function isV2Definition(definition: AnalyticsSegmentDefinition): definition is AnalyticsSegmentDefinitionV2 {
  return typeof definition === "object" && definition !== null && (definition as { version?: unknown }).version === 2;
}

function isValidWindow(window: unknown): window is ApmWindow {
  return window === "24h" || window === "7d" || window === "30d";
}

export function upgradeDefinition(definition: AnalyticsSegmentDefinition): AnalyticsSegmentDefinitionV2 {
  if (isV2Definition(definition)) {
    return definition;
  }

  const leaf: SegmentEventLeaf = { kind: "event" };
  if (definition.eventName) {
    leaf.eventName = definition.eventName;
  }
  if (definition.propertyName) {
    leaf.property = definition.propertyValue
      ? { name: definition.propertyName, operator: "eq", value: definition.propertyValue }
      : { name: definition.propertyName, operator: "exists" };
  }

  return { version: 2, window: definition.window, root: leaf };
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
  if (isV2Definition(definition)) {
    validateSegmentDefinition(definition);
    const window = isValidWindow(definition.window) ? definition.window : undefined;
    return { version: 2, window, root: definition.root };
  }

  const next: AnalyticsSegmentDefinitionV1 = {};
  if (isValidWindow(definition.window)) {
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

export function analyticsSegmentActorColumn(segment: AnalyticsSegmentRecord): "tenant_id" | "user_id" {
  return segment.actorType === "tenant" ? "tenant_id" : "user_id";
}

const EVENTS_ACTOR_REFS = { userRef: "events.user_id", tenantRef: "events.tenant_id" };

export function analyticsSegmentActorFilter(
  segment: AnalyticsSegmentRecord,
  refs: { userRef: string; tenantRef: string },
  now = new Date()
) {
  const definition = upgradeDefinition(segment.definition);
  const { from, to } = resolveWindow(definition.window, now);
  return compileSegmentDefinition(definition, {
    projectId: segment.projectId,
    environmentId: segment.environmentId,
    actorType: segment.actorType,
    from,
    to,
    userRef: refs.userRef,
    tenantRef: refs.tenantRef
  });
}

export function analyticsSegmentActorSubquery(db: Db, segment: AnalyticsSegmentRecord, now = new Date()) {
  const definition = upgradeDefinition(segment.definition);
  const { from, to } = resolveWindow(definition.window, now);
  const actorColumn = analyticsSegmentActorColumn(segment) === "tenant_id" ? sql<string>`tenant_id` : sql<string>`user_id`;
  const predicate = analyticsSegmentActorFilter(segment, EVENTS_ACTOR_REFS, now);

  return db
    .selectFrom("events")
    .select([actorColumn.as("actor_id"), sql<Date>`max(timestamp)`.as("last_seen_at")])
    .where("project_id", "=", segment.projectId)
    .where("environment_id", "=", segment.environmentId)
    .where("timestamp", ">=", from)
    .where("timestamp", "<", to)
    .where(actorColumn, "is not", null)
    .where(predicate)
    .groupBy(actorColumn);
}

export async function getAnalyticsSegmentActorIds(
  db: Db,
  segment: AnalyticsSegmentRecord,
  now = new Date()
): Promise<string[]> {
  const rows = await analyticsSegmentActorSubquery(db, segment, now).limit(50_000).execute();
  return rows.map((row) => row.actor_id).filter((actorId): actorId is string => Boolean(actorId));
}

export async function previewAnalyticsSegment(
  db: Db,
  segment: AnalyticsSegmentRecord,
  input: { limit?: number; now?: Date } = {}
): Promise<AnalyticsSegmentPreview> {
  const now = input.now ?? new Date();
  const definition = upgradeDefinition(segment.definition);
  const { window } = resolveWindow(definition.window, now);
  const limit = Math.min(50, Math.max(1, Math.trunc(input.limit ?? 10)));

  const sampleQuery = analyticsSegmentActorSubquery(db, segment, now).orderBy(sql`max(timestamp)`, "desc").limit(limit);
  const countQuery = db
    .selectFrom(analyticsSegmentActorSubquery(db, segment, now).as("actors"))
    .select(sql<string>`count(*)`.as("count"));

  const [countRow, sampleRows] = await Promise.all([countQuery.executeTakeFirst(), sampleQuery.execute()]);

  return {
    segmentId: segment.id,
    actorType: segment.actorType,
    window,
    actors: Number(countRow?.count ?? 0),
    samples: sampleRows.map((row) => ({
      actorId: row.actor_id,
      lastSeenAt: toIso(row.last_seen_at)
    }))
  };
}
