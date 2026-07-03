import type { Selectable } from "kysely";
import { sql } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { FeedbackItemsTable, FeedbackItemStatus, FeedbackWidgetSettingsTable } from "../schema.js";

type FeedbackSettingsRow = Selectable<FeedbackWidgetSettingsTable>;
type FeedbackItemRow = Selectable<FeedbackItemsTable>;

export type FeedbackStatus = FeedbackItemStatus;

export interface FeedbackWidgetSettings {
  projectId: string;
  environmentId: string;
  enabled: boolean;
  title: string;
  prompt: string;
  placeholder: string;
  buttonLabel: string;
  accentColor: string;
  allowScreenshot: boolean;
  privacyNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertFeedbackWidgetSettingsInput {
  projectId: string;
  environmentId: string;
  enabled?: boolean;
  title?: string | null;
  prompt?: string | null;
  placeholder?: string | null;
  buttonLabel?: string | null;
  accentColor?: string | null;
  allowScreenshot?: boolean;
  privacyNote?: string | null;
}

export interface FeedbackItemRecord {
  id: string;
  projectId: string;
  environmentId: string;
  status: FeedbackStatus;
  message: string;
  category: string | null;
  pageUrl: string | null;
  path: string | null;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  release: string | null;
  source: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  submittedAt: Date;
  receivedAt: Date;
  updatedAt: Date;
}

export interface RecordFeedbackItemInput {
  id?: string;
  projectId: string;
  environmentId: string;
  message: string;
  category?: string | null;
  pageUrl?: string | null;
  path?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  traceId?: string | null;
  release?: string | null;
  source?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  submittedAt?: Date;
  receivedAt?: Date;
}

const DEFAULT_SETTINGS = {
  enabled: false,
  title: "Send feedback",
  prompt: "Tell us what happened or what could be better.",
  placeholder: "Write your feedback...",
  buttonLabel: "Feedback",
  accentColor: "#66e38a",
  allowScreenshot: false,
  privacyNote: null
};

function normalizeText(value: string | undefined | null, fallback: string, max = 240): string {
  const trimmed = value?.trim() ?? "";
  return (trimmed || fallback).slice(0, max);
}

function nullableText(value: string | undefined | null, max = 1_000): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.slice(0, max) : null;
}

function normalizeColor(value: string | undefined | null): string {
  const trimmed = value?.trim() ?? "";
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : DEFAULT_SETTINGS.accentColor;
}

function normalizeStatus(status: FeedbackStatus | undefined): FeedbackStatus {
  return status === "reviewed" || status === "archived" ? status : "open";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toSettings(row: FeedbackSettingsRow): FeedbackWidgetSettings {
  return {
    projectId: row.project_id,
    environmentId: row.environment_id,
    enabled: row.enabled,
    title: row.title,
    prompt: row.prompt,
    placeholder: row.placeholder,
    buttonLabel: row.button_label,
    accentColor: row.accent_color,
    allowScreenshot: row.allow_screenshot,
    privacyNote: row.privacy_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function defaultSettings(projectId: string, environmentId: string): FeedbackWidgetSettings {
  const now = new Date(0);
  return {
    projectId,
    environmentId,
    ...DEFAULT_SETTINGS,
    createdAt: now,
    updatedAt: now
  };
}

function toFeedbackItem(row: FeedbackItemRow): FeedbackItemRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    status: row.status,
    message: row.message,
    category: row.category,
    pageUrl: row.page_url,
    path: row.path,
    tenantId: row.tenant_id,
    userId: row.user_id,
    sessionId: row.session_id,
    traceId: row.trace_id,
    release: row.release,
    source: row.source,
    userAgent: row.user_agent,
    metadata: asObject(row.metadata),
    submittedAt: row.submitted_at,
    receivedAt: row.received_at,
    updatedAt: row.updated_at
  };
}

export async function getFeedbackWidgetSettings(
  db: Db,
  input: { projectId: string; environmentId: string }
): Promise<FeedbackWidgetSettings> {
  const row = await db
    .selectFrom("feedback_widget_settings")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .executeTakeFirst();

  return row ? toSettings(row) : defaultSettings(input.projectId, input.environmentId);
}

export async function upsertFeedbackWidgetSettings(
  db: Db,
  input: UpsertFeedbackWidgetSettingsInput
): Promise<FeedbackWidgetSettings> {
  const now = new Date();
  const values = {
    project_id: input.projectId,
    environment_id: input.environmentId,
    enabled: input.enabled ?? DEFAULT_SETTINGS.enabled,
    title: normalizeText(input.title, DEFAULT_SETTINGS.title),
    prompt: normalizeText(input.prompt, DEFAULT_SETTINGS.prompt, 500),
    placeholder: normalizeText(input.placeholder, DEFAULT_SETTINGS.placeholder, 240),
    button_label: normalizeText(input.buttonLabel, DEFAULT_SETTINGS.buttonLabel, 80),
    accent_color: normalizeColor(input.accentColor),
    allow_screenshot: input.allowScreenshot ?? DEFAULT_SETTINGS.allowScreenshot,
    privacy_note: nullableText(input.privacyNote, 1_000),
    updated_at: now
  };

  const row = await db
    .insertInto("feedback_widget_settings")
    .values({
      ...values,
      created_at: now
    })
    .onConflict((oc) =>
      oc.columns(["project_id", "environment_id"]).doUpdateSet({
        enabled: values.enabled,
        title: values.title,
        prompt: values.prompt,
        placeholder: values.placeholder,
        button_label: values.button_label,
        accent_color: values.accent_color,
        allow_screenshot: values.allow_screenshot,
        privacy_note: values.privacy_note,
        updated_at: values.updated_at
      })
    )
    .returningAll()
    .executeTakeFirstOrThrow();

  return toSettings(row);
}

export async function recordFeedbackItem(db: Db, input: RecordFeedbackItemInput): Promise<FeedbackItemRecord> {
  const now = new Date();
  const row = await db
    .insertInto("feedback_items")
    .values({
      id: input.id ?? createId("fbk"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      status: "open",
      message: normalizeText(input.message, "Feedback", 4_000),
      category: nullableText(input.category, 120),
      page_url: nullableText(input.pageUrl, 2_000),
      path: nullableText(input.path, 1_000),
      tenant_id: nullableText(input.tenantId, 256),
      user_id: nullableText(input.userId, 256),
      session_id: nullableText(input.sessionId, 256),
      trace_id: nullableText(input.traceId, 256),
      release: nullableText(input.release, 256),
      source: nullableText(input.source, 256),
      user_agent: nullableText(input.userAgent, 500),
      metadata: sql`${JSON.stringify(input.metadata ?? {})}::jsonb`,
      submitted_at: input.submittedAt ?? now,
      received_at: input.receivedAt ?? now,
      updated_at: now
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .returningAll()
    .executeTakeFirst();

  if (row) return toFeedbackItem(row);

  const existing = await db.selectFrom("feedback_items").selectAll().where("id", "=", input.id ?? "").executeTakeFirstOrThrow();
  return toFeedbackItem(existing);
}

export async function listFeedbackItems(
  db: Db,
  input: { projectId: string; environmentId: string; status?: FeedbackStatus; limit?: number }
): Promise<FeedbackItemRecord[]> {
  const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 50)));
  let query = db
    .selectFrom("feedback_items")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId);

  if (input.status) {
    query = query.where("status", "=", normalizeStatus(input.status));
  }

  const rows = await query.orderBy("submitted_at", "desc").limit(limit).execute();
  return rows.map(toFeedbackItem);
}

export async function updateFeedbackItemStatus(
  db: Db,
  input: { id: string; projectId: string; environmentId: string; status: FeedbackStatus }
): Promise<FeedbackItemRecord | undefined> {
  const row = await db
    .updateTable("feedback_items")
    .set({ status: normalizeStatus(input.status), updated_at: new Date() })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .returningAll()
    .executeTakeFirst();

  return row ? toFeedbackItem(row) : undefined;
}
