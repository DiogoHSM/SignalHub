import type { Selectable } from "kysely";
import { sql } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { ExperimentsTable } from "../schema.js";
import type { ApmWindow } from "./telemetry-query.js";

type ExperimentRow = Selectable<ExperimentsTable>;

export type ExperimentStatus = "draft" | "running" | "paused" | "completed" | "archived";
export type ExperimentActorType = "user" | "tenant" | "session";

export interface ExperimentVariant {
  key: string;
  name: string;
  weight: number;
}

export interface ExperimentPrimaryMetric {
  eventName: string;
  windowHours: number;
}

export interface ExperimentRecord {
  id: string;
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description: string | null;
  status: ExperimentStatus;
  actorType: ExperimentActorType;
  exposureEvent: string;
  conversionEvent: string;
  variants: ExperimentVariant[];
  primaryMetric: ExperimentPrimaryMetric;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface CreateExperimentInput {
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description?: string | null;
  status?: ExperimentStatus;
  actorType?: ExperimentActorType;
  exposureEvent?: string;
  conversionEvent: string;
  variants: ExperimentVariant[];
  primaryMetric: ExperimentPrimaryMetric;
}

export type UpdateExperimentInput = Partial<
  Pick<CreateExperimentInput, "name" | "description" | "status" | "actorType" | "exposureEvent" | "conversionEvent" | "variants" | "primaryMetric">
>;

export interface ExperimentResultsInput {
  experimentId: string;
  projectId: string;
  environmentId: string;
  window?: ApmWindow;
  now?: Date;
  limit?: number;
}

export interface ExperimentVariantResult {
  key: string;
  name: string;
  weight: number;
  exposures: number;
  conversions: number;
  conversionRate: number;
  liftPoints: number | null;
  sampleActors: string[];
}

export interface ExperimentResults {
  experiment: ExperimentRecord;
  window: ApmWindow;
  totals: {
    exposures: number;
    conversions: number;
    variants: number;
  };
  variants: ExperimentVariantResult[];
}

function normalizeText(value: string | undefined, fallback: string, max = 120): string {
  const trimmed = value?.trim() ?? "";
  return (trimmed || fallback).slice(0, max);
}

function normalizeKey(value: string, fallback = "experiment"): string {
  return normalizeText(value, fallback, 80).replace(/\s+/g, "_").toLowerCase();
}

function normalizeStatus(value: ExperimentStatus | undefined): ExperimentStatus {
  return value === "running" || value === "paused" || value === "completed" || value === "archived" ? value : "draft";
}

function normalizeActorType(value: ExperimentActorType | undefined): ExperimentActorType {
  return value === "tenant" || value === "session" ? value : "user";
}

function normalizeVariants(variants: ExperimentVariant[]): ExperimentVariant[] {
  const seen = new Set<string>();
  return variants
    .slice(0, 20)
    .map((variant, index) => ({
      key: normalizeKey(variant.key, `variant_${index + 1}`),
      name: normalizeText(variant.name, variant.key || `Variant ${index + 1}`, 80),
      weight: Math.max(0, Math.min(100, Math.trunc(variant.weight)))
    }))
    .filter((variant) => {
      if (seen.has(variant.key)) return false;
      seen.add(variant.key);
      return true;
    });
}

function normalizePrimaryMetric(metric: ExperimentPrimaryMetric): ExperimentPrimaryMetric {
  return {
    eventName: normalizeText(metric.eventName, "conversion", 120),
    windowHours: Math.max(1, Math.min(24 * 30, Math.trunc(metric.windowHours || 24)))
  };
}

function parseVariants(value: unknown): ExperimentVariant[] {
  return Array.isArray(value) ? normalizeVariants(value as ExperimentVariant[]) : [];
}

function parsePrimaryMetric(value: unknown, fallbackEvent: string): ExperimentPrimaryMetric {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { eventName: fallbackEvent, windowHours: 24 };
  }
  return normalizePrimaryMetric(value as ExperimentPrimaryMetric);
}

function toExperiment(row: ExperimentRow): ExperimentRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    actorType: row.actor_type,
    exposureEvent: row.exposure_event,
    conversionEvent: row.conversion_event,
    variants: parseVariants(row.variants),
    primaryMetric: parsePrimaryMetric(row.primary_metric, row.conversion_event),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
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

function percentage(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 10;
}

export function validateExperimentInput(input: Pick<CreateExperimentInput, "variants" | "conversionEvent" | "primaryMetric">): boolean {
  return normalizeVariants(input.variants).length >= 2 && Boolean(input.conversionEvent.trim()) && Boolean(input.primaryMetric.eventName.trim());
}

export async function createExperiment(db: Db, input: CreateExperimentInput): Promise<ExperimentRecord> {
  const variants = normalizeVariants(input.variants);
  if (variants.length < 2) {
    throw new Error("experiment_requires_two_variants");
  }

  const conversionEvent = normalizeText(input.conversionEvent, input.primaryMetric.eventName);
  const row = await db
    .insertInto("experiments")
    .values({
      id: createId("exp"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      key: normalizeKey(input.key),
      name: normalizeText(input.name, input.key),
      description: input.description?.trim() || null,
      status: normalizeStatus(input.status),
      actor_type: normalizeActorType(input.actorType),
      exposure_event: normalizeText(input.exposureEvent, "sigmon.experiment.exposed"),
      conversion_event: conversionEvent,
      variants: sql`${JSON.stringify(variants)}::jsonb`,
      primary_metric: sql`${JSON.stringify(normalizePrimaryMetric(input.primaryMetric))}::jsonb`
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toExperiment(row);
}

export async function listExperiments(db: Db, input: { projectId: string; environmentId: string }): Promise<ExperimentRecord[]> {
  const rows = await db
    .selectFrom("experiments")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .orderBy("updated_at", "desc")
    .execute();

  return rows.map(toExperiment);
}

export async function getExperiment(
  db: Db,
  input: { id: string; projectId: string; environmentId: string }
): Promise<ExperimentRecord | undefined> {
  const row = await db
    .selectFrom("experiments")
    .selectAll()
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .executeTakeFirst();

  return row ? toExperiment(row) : undefined;
}

export async function updateExperiment(
  db: Db,
  input: { id: string; projectId: string; environmentId: string; patch: UpdateExperimentInput }
): Promise<ExperimentRecord | undefined> {
  const row = await db
    .updateTable("experiments")
    .set({
      ...(input.patch.name !== undefined ? { name: normalizeText(input.patch.name, "Untitled experiment") } : {}),
      ...(input.patch.description !== undefined ? { description: input.patch.description?.trim() || null } : {}),
      ...(input.patch.status !== undefined ? { status: normalizeStatus(input.patch.status) } : {}),
      ...(input.patch.actorType !== undefined ? { actor_type: normalizeActorType(input.patch.actorType) } : {}),
      ...(input.patch.exposureEvent !== undefined ? { exposure_event: normalizeText(input.patch.exposureEvent, "sigmon.experiment.exposed") } : {}),
      ...(input.patch.conversionEvent !== undefined ? { conversion_event: normalizeText(input.patch.conversionEvent, "conversion") } : {}),
      ...(input.patch.variants !== undefined ? { variants: sql`${JSON.stringify(normalizeVariants(input.patch.variants))}::jsonb` } : {}),
      ...(input.patch.primaryMetric !== undefined ? { primary_metric: sql`${JSON.stringify(normalizePrimaryMetric(input.patch.primaryMetric))}::jsonb` } : {}),
      updated_at: new Date()
    })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toExperiment(row) : undefined;
}

export async function archiveExperiment(db: Db, input: { id: string; projectId: string; environmentId: string }): Promise<void> {
  await db
    .updateTable("experiments")
    .set({ archived_at: new Date(), updated_at: new Date(), status: "archived" })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .execute();
}

function actorColumn(actorType: ExperimentActorType) {
  if (actorType === "tenant") return sql<string>`tenant_id`;
  if (actorType === "session") return sql<string>`session_id`;
  return sql<string>`user_id`;
}

export async function getExperimentResults(db: Db, input: ExperimentResultsInput): Promise<ExperimentResults | null> {
  const experiment = await getExperiment(db, {
    id: input.experimentId,
    projectId: input.projectId,
    environmentId: input.environmentId
  });
  if (!experiment) return null;

  const { window, from, to } = resolveWindow(input.window, input.now ?? new Date());
  const actor = actorColumn(experiment.actorType);
  const limit = Math.max(1, Math.min(5000, Math.trunc(input.limit ?? 5000)));
  const rows = await db
    .selectFrom("events")
    .select([
      "id",
      "name",
      "timestamp",
      "properties",
      actor.as("actor_id"),
      sql<string | null>`properties ->> 'variant'`.as("variant"),
      sql<string | null>`properties ->> 'experiment_key'`.as("experiment_key")
    ])
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("timestamp", ">=", from)
    .where("timestamp", "<", to)
    .where("name", "in", [experiment.exposureEvent, experiment.conversionEvent])
    .where(actor, "is not", null)
    .where(sql<string>`properties ->> 'experiment_key'`, "=", experiment.key)
    .orderBy("timestamp", "asc")
    .limit(limit)
    .execute();

  const byVariant = new Map<string, { exposed: Set<string>; converted: Set<string>; samples: string[] }>();
  for (const variant of experiment.variants) {
    byVariant.set(variant.key, { exposed: new Set(), converted: new Set(), samples: [] });
  }

  for (const row of rows) {
    const variant = row.variant;
    const actorId = row.actor_id;
    if (!variant || !actorId || !byVariant.has(variant)) continue;
    const bucket = byVariant.get(variant)!;
    if (row.name === experiment.exposureEvent) {
      bucket.exposed.add(actorId);
      if (bucket.samples.length < 5) bucket.samples.push(actorId);
    }
    if (row.name === experiment.conversionEvent && bucket.exposed.has(actorId)) {
      bucket.converted.add(actorId);
    }
  }

  const results = experiment.variants.map((variant) => {
    const bucket = byVariant.get(variant.key)!;
    return {
      key: variant.key,
      name: variant.name,
      weight: variant.weight,
      exposures: bucket.exposed.size,
      conversions: bucket.converted.size,
      conversionRate: percentage(bucket.converted.size, bucket.exposed.size),
      liftPoints: null,
      sampleActors: bucket.samples
    };
  });
  const baselineRate = results[0]?.conversionRate ?? null;

  const variants = results.map((result, index) => ({
    ...result,
    liftPoints: index === 0 || baselineRate === null ? null : Math.round((result.conversionRate - baselineRate) * 10) / 10
  }));

  return {
    experiment,
    window,
    totals: {
      exposures: variants.reduce((sum, row) => sum + row.exposures, 0),
      conversions: variants.reduce((sum, row) => sum + row.conversions, 0),
      variants: variants.length
    },
    variants
  };
}
