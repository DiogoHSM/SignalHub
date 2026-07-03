import type { Selectable } from "kysely";
import { sql } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type {
  MessageCampaignActorType,
  MessageCampaignChannelType,
  MessageCampaignEventType,
  MessageCampaignEventsTable,
  MessageCampaignOptOutsTable,
  MessageCampaignsTable,
  MessageCampaignStatus
} from "../schema.js";
import type { ApmWindow } from "./telemetry-query.js";

type MessageCampaignRow = Selectable<MessageCampaignsTable>;
type MessageCampaignEventRow = Selectable<MessageCampaignEventsTable>;
type MessageCampaignOptOutRow = Selectable<MessageCampaignOptOutsTable>;

export type {
  MessageCampaignActorType,
  MessageCampaignChannelType,
  MessageCampaignEventType,
  MessageCampaignStatus
};

export interface MessageCampaignRecord {
  id: string;
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description: string | null;
  status: MessageCampaignStatus;
  channelType: MessageCampaignChannelType;
  notificationChannelId: string | null;
  segmentId: string | null;
  conversionEvent: string | null;
  subject: string | null;
  body: string;
  ctaUrl: string | null;
  consentCategory: string;
  privacyNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface CreateMessageCampaignInput {
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description?: string | null;
  status?: MessageCampaignStatus;
  channelType?: MessageCampaignChannelType;
  notificationChannelId?: string | null;
  segmentId?: string | null;
  conversionEvent?: string | null;
  subject?: string | null;
  body: string;
  ctaUrl?: string | null;
  consentCategory?: string;
  privacyNote?: string | null;
}

export type UpdateMessageCampaignInput = Partial<
  Pick<
    CreateMessageCampaignInput,
    | "name"
    | "description"
    | "status"
    | "channelType"
    | "notificationChannelId"
    | "segmentId"
    | "conversionEvent"
    | "subject"
    | "body"
    | "ctaUrl"
    | "consentCategory"
    | "privacyNote"
  >
>;

export interface MessageCampaignEventRecord {
  id: string;
  campaignId: string;
  projectId: string;
  environmentId: string;
  type: MessageCampaignEventType;
  actorType: MessageCampaignActorType;
  actorId: string | null;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  release: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
  occurredAt: Date;
  receivedAt: Date;
}

export interface RecordMessageCampaignEventInput {
  id?: string;
  campaignId: string;
  projectId: string;
  environmentId: string;
  type: MessageCampaignEventType;
  actorType?: MessageCampaignActorType;
  actorId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  traceId?: string | null;
  release?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  receivedAt?: Date;
}

export interface MessageCampaignOptOutRecord {
  id: string;
  projectId: string;
  environmentId: string;
  campaignId: string | null;
  actorType: MessageCampaignActorType;
  actorId: string;
  category: string;
  reason: string | null;
  createdAt: Date;
}

export interface UpsertMessageCampaignOptOutInput {
  projectId: string;
  environmentId: string;
  campaignId?: string | null;
  actorType: MessageCampaignActorType;
  actorId: string;
  category?: string;
  reason?: string | null;
}

export interface MessageCampaignResultsInput {
  campaignId: string;
  projectId: string;
  environmentId: string;
  window?: ApmWindow;
  now?: Date;
  limit?: number;
}

export interface MessageCampaignResults {
  campaign: MessageCampaignRecord;
  window: ApmWindow;
  totals: {
    queued: number;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    converted: number;
    failed: number;
    optedOut: number;
    uniqueActors: number;
  };
  rates: {
    deliveryRate: number;
    openRate: number;
    clickRate: number;
    conversionRate: number;
    optOutRate: number;
  };
  recentEvents: MessageCampaignEventRecord[];
  optOuts: MessageCampaignOptOutRecord[];
}

function normalizeText(value: string | undefined | null, fallback: string, max = 240): string {
  const trimmed = value?.trim() ?? "";
  return (trimmed || fallback).slice(0, max);
}

function normalizeNullableText(value: string | undefined | null, max = 512): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.slice(0, max) : null;
}

function normalizeKey(value: string, fallback = "campaign"): string {
  return normalizeText(value, fallback, 80).replace(/\s+/g, "_").toLowerCase();
}

function normalizeStatus(value: MessageCampaignStatus | undefined): MessageCampaignStatus {
  return value === "active" || value === "paused" || value === "archived" ? value : "draft";
}

function normalizeChannelType(value: MessageCampaignChannelType | undefined): MessageCampaignChannelType {
  return value === "email" || value === "webhook" ? value : "in_app";
}

function normalizeActorType(value: MessageCampaignActorType | undefined): MessageCampaignActorType {
  return value === "user" || value === "tenant" || value === "session" ? value : "anonymous";
}

function normalizeEventType(value: MessageCampaignEventType): MessageCampaignEventType {
  return value === "queued" ||
    value === "sent" ||
    value === "delivered" ||
    value === "opened" ||
    value === "clicked" ||
    value === "converted" ||
    value === "failed" ||
    value === "opted_out"
    ? value
    : "queued";
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

function rate(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 10;
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function toCampaign(row: MessageCampaignRow): MessageCampaignRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    channelType: row.channel_type,
    notificationChannelId: row.notification_channel_id,
    segmentId: row.segment_id,
    conversionEvent: row.conversion_event,
    subject: row.subject,
    body: row.body,
    ctaUrl: row.cta_url,
    consentCategory: row.consent_category,
    privacyNote: row.privacy_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

function toEvent(row: MessageCampaignEventRow): MessageCampaignEventRecord {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    type: row.type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    sessionId: row.session_id,
    traceId: row.trace_id,
    release: row.release,
    source: row.source,
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {},
    occurredAt: row.occurred_at,
    receivedAt: row.received_at
  };
}

function toOptOut(row: MessageCampaignOptOutRow): MessageCampaignOptOutRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    campaignId: row.campaign_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    category: row.category,
    reason: row.reason,
    createdAt: row.created_at
  };
}

function normalizeCampaignInput(input: CreateMessageCampaignInput | (UpdateMessageCampaignInput & { channelType?: MessageCampaignChannelType })) {
  const channelType = normalizeChannelType(input.channelType);
  const notificationChannelId = channelType === "in_app" ? null : normalizeNullableText(input.notificationChannelId, 120);
  if (channelType !== "in_app" && !notificationChannelId) {
    throw new Error("message_campaign_requires_notification_channel");
  }
  return {
    channelType,
    notificationChannelId,
    segmentId: normalizeNullableText(input.segmentId, 120),
    conversionEvent: normalizeNullableText(input.conversionEvent, 160),
    subject: normalizeNullableText(input.subject, 240),
    body: normalizeText(input.body, "Campaign message", 4000),
    ctaUrl: normalizeNullableText(input.ctaUrl, 1024),
    consentCategory: normalizeText(input.consentCategory, "product", 80),
    privacyNote: normalizeNullableText(input.privacyNote, 512)
  };
}

export async function createMessageCampaign(db: Db, input: CreateMessageCampaignInput): Promise<MessageCampaignRecord> {
  const normalized = normalizeCampaignInput(input);
  const row = await db
    .insertInto("message_campaigns")
    .values({
      id: createId("cmp"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      key: normalizeKey(input.key),
      name: normalizeText(input.name, input.key),
      description: normalizeNullableText(input.description),
      status: normalizeStatus(input.status),
      channel_type: normalized.channelType,
      notification_channel_id: normalized.notificationChannelId,
      segment_id: normalized.segmentId,
      conversion_event: normalized.conversionEvent,
      subject: normalized.subject,
      body: normalized.body,
      cta_url: normalized.ctaUrl,
      consent_category: normalized.consentCategory,
      privacy_note: normalized.privacyNote
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toCampaign(row);
}

export async function listMessageCampaigns(db: Db, input: { projectId: string; environmentId: string }): Promise<MessageCampaignRecord[]> {
  const rows = await db
    .selectFrom("message_campaigns")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .orderBy("updated_at", "desc")
    .execute();
  return rows.map(toCampaign);
}

export async function getMessageCampaign(
  db: Db,
  input: { id: string; projectId: string; environmentId: string }
): Promise<MessageCampaignRecord | undefined> {
  const row = await db
    .selectFrom("message_campaigns")
    .selectAll()
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  return row ? toCampaign(row) : undefined;
}

export async function updateMessageCampaign(
  db: Db,
  input: { id: string; projectId: string; environmentId: string; patch: UpdateMessageCampaignInput }
): Promise<MessageCampaignRecord | undefined> {
  const existing = await getMessageCampaign(db, input);
  if (!existing) return undefined;
  const merged = normalizeCampaignInput({
    channelType: input.patch.channelType ?? existing.channelType,
    notificationChannelId: input.patch.notificationChannelId ?? existing.notificationChannelId,
    segmentId: input.patch.segmentId ?? existing.segmentId,
    conversionEvent: input.patch.conversionEvent ?? existing.conversionEvent,
    subject: input.patch.subject ?? existing.subject,
    body: input.patch.body ?? existing.body,
    ctaUrl: input.patch.ctaUrl ?? existing.ctaUrl,
    consentCategory: input.patch.consentCategory ?? existing.consentCategory,
    privacyNote: input.patch.privacyNote ?? existing.privacyNote
  });
  const row = await db
    .updateTable("message_campaigns")
    .set({
      ...(input.patch.name !== undefined ? { name: normalizeText(input.patch.name, existing.name) } : {}),
      ...(input.patch.description !== undefined ? { description: normalizeNullableText(input.patch.description) } : {}),
      ...(input.patch.status !== undefined ? { status: normalizeStatus(input.patch.status) } : {}),
      channel_type: merged.channelType,
      notification_channel_id: merged.notificationChannelId,
      segment_id: merged.segmentId,
      conversion_event: merged.conversionEvent,
      subject: merged.subject,
      body: merged.body,
      cta_url: merged.ctaUrl,
      consent_category: merged.consentCategory,
      privacy_note: merged.privacyNote,
      updated_at: new Date()
    })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();
  return row ? toCampaign(row) : undefined;
}

export async function archiveMessageCampaign(db: Db, input: { id: string; projectId: string; environmentId: string }): Promise<void> {
  await db
    .updateTable("message_campaigns")
    .set({ status: "archived", archived_at: new Date(), updated_at: new Date() })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .execute();
}

export async function recordMessageCampaignEvent(
  db: Db,
  input: RecordMessageCampaignEventInput
): Promise<MessageCampaignEventRecord> {
  const occurredAt = input.occurredAt ?? new Date();
  const row = await db
    .insertInto("message_campaign_events")
    .values({
      id: input.id ?? createId("cme"),
      campaign_id: input.campaignId,
      project_id: input.projectId,
      environment_id: input.environmentId,
      type: normalizeEventType(input.type),
      actor_type: normalizeActorType(input.actorType),
      actor_id: normalizeNullableText(input.actorId, 256),
      tenant_id: normalizeNullableText(input.tenantId, 256),
      user_id: normalizeNullableText(input.userId, 256),
      session_id: normalizeNullableText(input.sessionId, 256),
      trace_id: normalizeNullableText(input.traceId, 256),
      release: normalizeNullableText(input.release, 160),
      source: normalizeNullableText(input.source, 120),
      metadata: sql`${JSON.stringify(input.metadata ?? {})}::jsonb`,
      occurred_at: occurredAt,
      received_at: input.receivedAt ?? occurredAt
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toEvent(row);
}

export async function upsertMessageCampaignOptOut(db: Db, input: UpsertMessageCampaignOptOutInput): Promise<MessageCampaignOptOutRecord> {
  const category = normalizeText(input.category, "product", 80);
  const campaignId = input.campaignId ?? null;
  const actorType = normalizeActorType(input.actorType);
  const actorId = normalizeText(input.actorId, "anonymous", 256);
  const existing = await db
    .selectFrom("message_campaign_opt_outs")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("actor_type", "=", actorType)
    .where("actor_id", "=", actorId)
    .where(sql`lower(category)`, "=", category.toLowerCase())
    .where((eb) => campaignId === null ? eb("campaign_id", "is", null) : eb("campaign_id", "=", campaignId))
    .executeTakeFirst();

  if (existing) {
    const row = await db
      .updateTable("message_campaign_opt_outs")
      .set({ reason: normalizeNullableText(input.reason, 512), created_at: new Date() })
      .where("id", "=", existing.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toOptOut(row);
  }

  const row = await db
    .insertInto("message_campaign_opt_outs")
    .values({
      id: createId("cmo"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      campaign_id: campaignId,
      actor_type: actorType,
      actor_id: actorId,
      category,
      reason: normalizeNullableText(input.reason, 512)
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toOptOut(row);
}

export async function getMessageCampaignResults(
  db: Db,
  input: MessageCampaignResultsInput
): Promise<MessageCampaignResults | undefined> {
  const campaign = await getMessageCampaign(db, {
    id: input.campaignId,
    projectId: input.projectId,
    environmentId: input.environmentId
  });
  if (!campaign) return undefined;
  const { window, from, to } = resolveWindow(input.window, input.now ?? new Date());
  const aggregateResult = await sql<{
    queued: unknown;
    sent: unknown;
    delivered: unknown;
    opened: unknown;
    clicked: unknown;
    converted: unknown;
    failed: unknown;
    opted_out: unknown;
    unique_actors: unknown;
  }>`
    select
      count(*) filter (where type = 'queued') as queued,
      count(*) filter (where type = 'sent') as sent,
      count(*) filter (where type = 'delivered') as delivered,
      count(*) filter (where type = 'opened') as opened,
      count(*) filter (where type = 'clicked') as clicked,
      count(*) filter (where type = 'converted') as converted,
      count(*) filter (where type = 'failed') as failed,
      count(*) filter (where type = 'opted_out') as opted_out,
      count(distinct actor_type || ':' || coalesce(actor_id, tenant_id, user_id, session_id, 'anonymous')) as unique_actors
    from message_campaign_events
    where campaign_id = ${input.campaignId}
      and project_id = ${input.projectId}
      and environment_id = ${input.environmentId}
      and occurred_at >= ${from}
      and occurred_at <= ${to}
  `.execute(db);
  const totalsRow = aggregateResult.rows[0];
  const totals = {
    queued: toNumber(totalsRow?.queued),
    sent: toNumber(totalsRow?.sent),
    delivered: toNumber(totalsRow?.delivered),
    opened: toNumber(totalsRow?.opened),
    clicked: toNumber(totalsRow?.clicked),
    converted: toNumber(totalsRow?.converted),
    failed: toNumber(totalsRow?.failed),
    optedOut: toNumber(totalsRow?.opted_out),
    uniqueActors: toNumber(totalsRow?.unique_actors)
  };
  const recentRows = await db
    .selectFrom("message_campaign_events")
    .selectAll()
    .where("campaign_id", "=", input.campaignId)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("occurred_at", ">=", from)
    .where("occurred_at", "<=", to)
    .orderBy("occurred_at", "desc")
    .orderBy("received_at", "desc")
    .limit(input.limit ?? 25)
    .execute();
  const optOutRows = await db
    .selectFrom("message_campaign_opt_outs")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where((eb) => eb.or([eb("campaign_id", "=", input.campaignId), eb("campaign_id", "is", null)]))
    .orderBy("created_at", "desc")
    .limit(input.limit ?? 25)
    .execute();

  return {
    campaign,
    window,
    totals,
    rates: {
      deliveryRate: rate(totals.delivered, totals.sent || totals.queued),
      openRate: rate(totals.opened, totals.delivered),
      clickRate: rate(totals.clicked, totals.delivered),
      conversionRate: rate(totals.converted, totals.delivered),
      optOutRate: rate(totals.optedOut, totals.delivered)
    },
    recentEvents: recentRows.map(toEvent),
    optOuts: optOutRows.map(toOptOut)
  };
}
