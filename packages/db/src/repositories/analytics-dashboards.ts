import type { Selectable } from "kysely";
import { sql } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { AnalyticsDashboardsTable } from "../schema.js";
import type { ApmWindow } from "./telemetry-query.js";

type AnalyticsDashboardRow = Selectable<AnalyticsDashboardsTable>;

export type AnalyticsDashboardCategory = "executive" | "operational" | "product";
export type AnalyticsDashboardWidgetType =
  | "metric.events"
  | "metric.errors"
  | "top.events"
  | "trend.events"
  | "trend.errors"
  | "insight";

export interface AnalyticsDashboardFilters {
  window?: ApmWindow;
  tenantId?: string;
  userId?: string;
  segmentId?: string;
}

export interface AnalyticsDashboardWidget {
  id: string;
  type: AnalyticsDashboardWidgetType;
  title: string;
  width: "half" | "full";
  options: Record<string, unknown>;
}

export type AnalyticsDashboardWidgetInput = Omit<AnalyticsDashboardWidget, "id"> & { id?: string };

export interface AnalyticsDashboardRecord {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  description: string | null;
  category: AnalyticsDashboardCategory;
  filters: AnalyticsDashboardFilters;
  widgets: AnalyticsDashboardWidget[];
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface CreateAnalyticsDashboardInput {
  projectId: string;
  environmentId: string;
  name: string;
  description?: string | null;
  category?: AnalyticsDashboardCategory;
  filters?: AnalyticsDashboardFilters;
  widgets: AnalyticsDashboardWidgetInput[];
}

export type UpdateAnalyticsDashboardInput = Partial<
  Pick<CreateAnalyticsDashboardInput, "name" | "description" | "category" | "filters" | "widgets">
>;

const allowedTypes = new Set<AnalyticsDashboardWidgetType>([
  "metric.events",
  "metric.errors",
  "top.events",
  "trend.events",
  "trend.errors",
  "insight"
]);

function normalizeText(value: string, fallback: string, max = 120): string {
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, max);
}

function normalizeFilters(filters: AnalyticsDashboardFilters | undefined): AnalyticsDashboardFilters {
  const next: AnalyticsDashboardFilters = {};
  if (filters?.window === "24h" || filters?.window === "7d" || filters?.window === "30d") {
    next.window = filters.window;
  }
  const tenantId = filters?.tenantId?.trim();
  const userId = filters?.userId?.trim();
  const segmentId = filters?.segmentId?.trim();
  if (tenantId) next.tenantId = tenantId;
  if (userId) next.userId = userId;
  if (segmentId) next.segmentId = segmentId;
  return next;
}

function normalizeWidget(value: AnalyticsDashboardWidgetInput, index: number): AnalyticsDashboardWidget {
  const type = allowedTypes.has(value.type) ? value.type : "metric.events";
  const id = value.id?.trim() || createId("wid");
  const title = normalizeText(value.title, type.replace(".", " "), 80);
  const width = value.width === "full" ? "full" : "half";
  return {
    id,
    type,
    title,
    width,
    options: value.options && typeof value.options === "object" && !Array.isArray(value.options) ? value.options : { order: index }
  };
}

export function normalizeDashboardWidgets(widgets: AnalyticsDashboardWidgetInput[]): AnalyticsDashboardWidget[] {
  return widgets.slice(0, 20).map(normalizeWidget);
}

function parseFilters(value: unknown): AnalyticsDashboardFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return normalizeFilters(value as AnalyticsDashboardFilters);
}

function parseWidgets(value: unknown): AnalyticsDashboardWidget[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return normalizeDashboardWidgets(value as AnalyticsDashboardWidget[]);
}

function toDashboard(row: AnalyticsDashboardRow): AnalyticsDashboardRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    name: row.name,
    description: row.description,
    category: row.category,
    filters: parseFilters(row.filters),
    widgets: parseWidgets(row.widgets),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

export async function createAnalyticsDashboard(db: Db, input: CreateAnalyticsDashboardInput): Promise<AnalyticsDashboardRecord> {
  const row = await db
    .insertInto("analytics_dashboards")
    .values({
      id: createId("dash"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      name: normalizeText(input.name, "Untitled dashboard"),
      description: input.description?.trim() || null,
      category: input.category ?? "operational",
      filters: sql`${JSON.stringify(normalizeFilters(input.filters))}::jsonb`,
      widgets: sql`${JSON.stringify(normalizeDashboardWidgets(input.widgets))}::jsonb`
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDashboard(row);
}

export async function listAnalyticsDashboards(
  db: Db,
  input: { projectId: string; environmentId: string }
): Promise<AnalyticsDashboardRecord[]> {
  const rows = await db
    .selectFrom("analytics_dashboards")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .orderBy("updated_at", "desc")
    .execute();

  return rows.map(toDashboard);
}

export async function getAnalyticsDashboard(
  db: Db,
  input: { id: string; projectId: string; environmentId: string }
): Promise<AnalyticsDashboardRecord | undefined> {
  const row = await db
    .selectFrom("analytics_dashboards")
    .selectAll()
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .executeTakeFirst();

  return row ? toDashboard(row) : undefined;
}

export async function updateAnalyticsDashboard(
  db: Db,
  input: { id: string; projectId: string; environmentId: string; patch: UpdateAnalyticsDashboardInput }
): Promise<AnalyticsDashboardRecord | undefined> {
  const row = await db
    .updateTable("analytics_dashboards")
    .set({
      ...(input.patch.name !== undefined ? { name: normalizeText(input.patch.name, "Untitled dashboard") } : {}),
      ...(input.patch.description !== undefined ? { description: input.patch.description?.trim() || null } : {}),
      ...(input.patch.category !== undefined ? { category: input.patch.category } : {}),
      ...(input.patch.filters !== undefined ? { filters: sql`${JSON.stringify(normalizeFilters(input.patch.filters))}::jsonb` } : {}),
      ...(input.patch.widgets !== undefined ? { widgets: sql`${JSON.stringify(normalizeDashboardWidgets(input.patch.widgets))}::jsonb` } : {}),
      updated_at: new Date()
    })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toDashboard(row) : undefined;
}

export async function archiveAnalyticsDashboard(
  db: Db,
  input: { id: string; projectId: string; environmentId: string }
): Promise<void> {
  await db
    .updateTable("analytics_dashboards")
    .set({ archived_at: new Date(), updated_at: new Date() })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .execute();
}
