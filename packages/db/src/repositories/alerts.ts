import type { Selectable, Transaction } from "kysely";
import { sql } from "kysely";
import type { Db } from "../client.js";
import type {
  AlertEventsTable,
  AlertRulesTable,
  AlertRuleType,
  AlertSeverity,
  Database,
  NotificationChannelsTable,
  NotificationDeliveriesTable
} from "../schema.js";

export type AlertDb = Db | Transaction<Database>;

type NotificationChannelRow = Selectable<NotificationChannelsTable>;
type AlertRuleRow = Selectable<AlertRulesTable>;
type AlertEventRow = Selectable<AlertEventsTable>;
type NotificationDeliveryRow = Selectable<NotificationDeliveriesTable>;
type AlertEventWithDeliveryRow = AlertEventRow & { latest_delivery_status: "success" | "failed" | null };
type AlertEventEscalationRow = AlertEventWithDeliveryRow & {
  rule_notification_channel_id: string | null;
  rule_escalation_channel_id: string | null;
  rule_name: string | null;
  rule_type: AlertRuleType | null;
  rule_window_minutes: number | null;
};

const ALERT_EVALUATION_LOCK_ID = 927380402915;
const MAX_EMAIL_RECIPIENTS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WebhookLikeChannelType = "webhook" | "slack" | "discord";

export type NotificationChannelRecord =
  | {
      id: string;
      name: string;
      type: WebhookLikeChannelType;
      url: string;
      emailRecipients: [];
      secretHeaderName: string | null;
      secretHeaderValue: string | null;
      hasSecret: boolean;
      enabled: boolean;
      createdAt: Date;
      updatedAt: Date;
      archivedAt: Date | null;
    }
  | {
      id: string;
      name: string;
      type: "email";
      url: null;
      emailRecipients: string[];
      secretHeaderName: null;
      secretHeaderValue: null;
      hasSecret: false;
      enabled: boolean;
      createdAt: Date;
      updatedAt: Date;
      archivedAt: Date | null;
    };

export type CreateNotificationChannelInput =
  | {
      name: string;
      type: WebhookLikeChannelType;
      url: string;
      secretHeaderName?: string | null;
      secretHeaderValue?: string | null;
      enabled: boolean;
    }
  | {
      name: string;
      type: "email";
      emailRecipients: string[];
      enabled: boolean;
    };

export type UpdateNotificationChannelInput = {
  name?: string;
  type?: WebhookLikeChannelType | "email";
  url?: string | null;
  emailRecipients?: string[];
  secretHeaderName?: string | null;
  secretHeaderValue?: string | null;
  enabled?: boolean;
};

export type AlertRuleRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  notificationChannelId: string | null;
  escalationChannelId: string | null;
  name: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  windowMinutes: number;
  threshold: string;
  cooldownMinutes: number;
  escalationMinutes: number | null;
  routePattern: string | null;
  minimumSampleSize: number;
  enabled: boolean;
  lastEvaluatedAt: Date | null;
  lastTriggeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type AlertEventRecord = {
  id: string;
  ruleId: string | null;
  monitorId: string | null;
  projectId: string;
  environmentId: string;
  status: "triggered" | "acknowledged" | "snoozed" | "resolved";
  severity: AlertSeverity;
  triggeredAt: Date;
  windowStart: Date;
  windowEnd: Date;
  observedValue: string;
  threshold: string;
  message: string;
  metadata: unknown;
  acknowledgedAt: Date | null;
  acknowledgedByUserId: string | null;
  acknowledgedByEmail: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  resolvedByEmail: string | null;
  snoozedUntil: Date | null;
  triageNote: string | null;
  escalationDueAt: Date | null;
  escalatedAt: Date | null;
  createdAt: Date;
  latestDeliveryStatus: "success" | "failed" | null;
};

export type AlertEscalationRecord = AlertEventRecord & {
  ruleNotificationChannelId: string | null;
  ruleEscalationChannelId: string | null;
  ruleName: string | null;
  ruleType: AlertRuleType | null;
  ruleWindowMinutes: number | null;
};

export type NotificationDeliveryRecord = {
  id: string;
  alertEventId: string;
  notificationChannelId: string;
  status: "success" | "failed";
  attemptedAt: Date;
  responseStatus: number | null;
  errorMessage: string | null;
  createdAt: Date;
};

function normalizeNumeric(value: string | number): string {
  return String(value).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function normalizeEmailRecipients(recipients: string[]): string[] {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("email_recipients_required");
  }
  if (recipients.length > MAX_EMAIL_RECIPIENTS) {
    throw new Error("too_many_email_recipients");
  }

  const normalized = recipients.map((recipient) => recipient.trim().toLowerCase());
  const uniqueRecipients = new Set(normalized);

  if (
    normalized.some((recipient) => !EMAIL_PATTERN.test(recipient)) ||
    uniqueRecipients.size !== normalized.length
  ) {
    throw new Error("invalid_email_recipients");
  }

  return normalized;
}

function parseEmailRecipients(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((recipient) => typeof recipient !== "string")) {
    return [];
  }

  return value;
}

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

export function toNotificationChannel(row: NotificationChannelRow): NotificationChannelRecord {
  if (row.type === "email") {
    const emailRecipients = parseEmailRecipients(row.email_recipients);
    if (emailRecipients.length === 0) {
      throw new Error("invalid_email_notification_channel");
    }

    return {
      id: row.id,
      name: row.name,
      type: row.type,
      url: null,
      emailRecipients,
      secretHeaderName: null,
      secretHeaderValue: null,
      hasSecret: false,
      enabled: row.enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at
    };
  }

  if (row.url === null) {
    throw new Error("invalid_webhook_notification_channel");
  }

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    url: row.url,
    emailRecipients: [],
    secretHeaderName: row.secret_header_name,
    secretHeaderValue: row.secret_header_value,
    hasSecret: row.secret_header_value !== null,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

export function toAlertRule(row: AlertRuleRow): AlertRuleRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    notificationChannelId: row.notification_channel_id,
    escalationChannelId: row.escalation_channel_id,
    name: row.name,
    type: row.type,
    severity: row.severity,
    windowMinutes: row.window_minutes,
    threshold: normalizeNumeric(row.threshold),
    cooldownMinutes: row.cooldown_minutes,
    escalationMinutes: row.escalation_minutes,
    routePattern: row.route_pattern,
    minimumSampleSize: row.minimum_sample_size,
    enabled: row.enabled,
    lastEvaluatedAt: row.last_evaluated_at,
    lastTriggeredAt: row.last_triggered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

export function toAlertEvent(row: AlertEventWithDeliveryRow): AlertEventRecord {
  return {
    id: row.id,
    ruleId: row.rule_id,
    monitorId: row.monitor_id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    status: row.status,
    severity: row.severity,
    triggeredAt: row.triggered_at,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    observedValue: normalizeNumeric(row.observed_value),
    threshold: normalizeNumeric(row.threshold),
    message: row.message,
    metadata: row.metadata,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedByUserId: row.acknowledged_by_user_id,
    acknowledgedByEmail: row.acknowledged_by_email,
    resolvedAt: row.resolved_at,
    resolvedByUserId: row.resolved_by_user_id,
    resolvedByEmail: row.resolved_by_email,
    snoozedUntil: row.snoozed_until,
    triageNote: row.triage_note,
    escalationDueAt: row.escalation_due_at,
    escalatedAt: row.escalated_at,
    createdAt: row.created_at,
    latestDeliveryStatus: row.latest_delivery_status
  };
}

function toAlertEscalation(row: AlertEventEscalationRow): AlertEscalationRecord {
  return {
    ...toAlertEvent(row),
    ruleNotificationChannelId: row.rule_notification_channel_id,
    ruleEscalationChannelId: row.rule_escalation_channel_id,
    ruleName: row.rule_name,
    ruleType: row.rule_type,
    ruleWindowMinutes: row.rule_window_minutes
  };
}

function toNotificationDelivery(row: NotificationDeliveryRow): NotificationDeliveryRecord {
  return {
    id: row.id,
    alertEventId: row.alert_event_id,
    notificationChannelId: row.notification_channel_id,
    status: row.status,
    attemptedAt: row.attempted_at,
    responseStatus: row.response_status,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}

async function assertActiveAlertRuleScope(
  db: AlertDb,
  input: { projectId: string; environmentId: string }
): Promise<void> {
  const activeScope = await db
    .selectFrom("projects")
    .innerJoin("environments", "environments.project_id", "projects.id")
    .select("environments.id")
    .where("projects.id", "=", input.projectId)
    .where("environments.id", "=", input.environmentId)
    .where("projects.archived_at", "is", null)
    .where("environments.archived_at", "is", null)
    .executeTakeFirst();

  if (!activeScope) {
    throw new Error("active_alert_rule_scope_not_found");
  }
}

export async function createNotificationChannel(
  db: AlertDb,
  input: CreateNotificationChannelInput
): Promise<NotificationChannelRecord> {
  const row = await db
    .insertInto("notification_channels")
    .values(
      input.type === "email"
        ? {
            name: input.name,
            type: input.type,
            url: null,
            email_recipients: jsonb(normalizeEmailRecipients(input.emailRecipients)),
            secret_header_name: null,
            secret_header_value: null,
            enabled: input.enabled
          }
        : {
            name: input.name,
            type: input.type,
            url: input.url,
            email_recipients: jsonb([]),
            secret_header_name: input.secretHeaderName ?? null,
            secret_header_value: input.secretHeaderValue ?? null,
            enabled: input.enabled
          }
    )
    .returningAll()
    .executeTakeFirstOrThrow();

  return toNotificationChannel(row);
}

export async function listNotificationChannels(db: AlertDb): Promise<NotificationChannelRecord[]> {
  const rows = await db
    .selectFrom("notification_channels")
    .selectAll()
    .where("archived_at", "is", null)
    .orderBy("created_at", "asc")
    .execute();

  return rows.map(toNotificationChannel);
}

export async function getNotificationChannel(
  db: AlertDb,
  id: string
): Promise<NotificationChannelRecord | undefined> {
  const row = await db
    .selectFrom("notification_channels")
    .selectAll()
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .executeTakeFirst();

  return row ? toNotificationChannel(row) : undefined;
}

export async function updateNotificationChannel(
  db: AlertDb,
  id: string,
  input: UpdateNotificationChannelInput
): Promise<NotificationChannelRecord | undefined> {
  const current = await db
    .selectFrom("notification_channels")
    .selectAll()
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  if (!current) {
    return undefined;
  }

  const targetType = input.type ?? current.type;
  const targetIsWebhookLike = targetType !== "email";
  const emailRecipients =
    input.emailRecipients !== undefined ? normalizeEmailRecipients(input.emailRecipients) : undefined;
  if (input.type === "email" && emailRecipients === undefined) {
    throw new Error("email_recipients_required");
  }
  if (input.type !== undefined && input.type !== "email" && !input.url) {
    throw new Error("webhook_url_required");
  }
  if (
    targetType === "email" &&
    ((input.url !== undefined && input.url !== null) ||
      (input.secretHeaderName !== undefined && input.secretHeaderName !== null) ||
      (input.secretHeaderValue !== undefined && input.secretHeaderValue !== null))
  ) {
    throw new Error("invalid_email_notification_channel");
  }
  if (targetIsWebhookLike && input.url === null) {
    throw new Error("webhook_url_required");
  }
  if (targetIsWebhookLike && input.emailRecipients !== undefined) {
    throw new Error("invalid_webhook_notification_channel");
  }

  const row = await db
    .updateTable("notification_channels")
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(targetIsWebhookLike && input.url !== undefined ? { url: input.url } : {}),
      ...(targetType === "email" && emailRecipients !== undefined ? { email_recipients: jsonb(emailRecipients) } : {}),
      ...(targetIsWebhookLike && input.secretHeaderName !== undefined
        ? { secret_header_name: input.secretHeaderName }
        : {}),
      ...(targetIsWebhookLike && input.secretHeaderValue !== undefined
        ? { secret_header_value: input.secretHeaderValue }
        : {}),
      ...(targetIsWebhookLike ? { email_recipients: jsonb([]) } : {}),
      ...(targetType === "email"
        ? {
            url: null,
            secret_header_name: null,
            secret_header_value: null
          }
        : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updated_at: new Date()
    })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toNotificationChannel(row) : undefined;
}

export async function archiveNotificationChannel(db: AlertDb, id: string): Promise<void> {
  const now = new Date();
  await db
    .updateTable("notification_channels")
    .set({ archived_at: now, updated_at: now })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .execute();
}

export async function createAlertRule(
  db: AlertDb,
  input: {
    projectId: string;
    environmentId: string;
    notificationChannelId?: string | null;
    escalationChannelId?: string | null;
    name: string;
    type: AlertRuleType;
    severity: AlertSeverity;
    windowMinutes: number;
    threshold: string;
    cooldownMinutes: number;
    escalationMinutes?: number | null;
    routePattern?: string | null;
    minimumSampleSize?: number;
    enabled: boolean;
  }
): Promise<AlertRuleRecord> {
  await assertActiveAlertRuleScope(db, input);

  const row = await db
    .insertInto("alert_rules")
    .values({
      project_id: input.projectId,
      environment_id: input.environmentId,
      notification_channel_id: input.notificationChannelId ?? null,
      escalation_channel_id: input.escalationChannelId ?? null,
      name: input.name,
      type: input.type,
      severity: input.severity,
      window_minutes: input.windowMinutes,
      threshold: input.threshold,
      cooldown_minutes: input.cooldownMinutes,
      escalation_minutes: input.escalationMinutes ?? null,
      route_pattern: input.routePattern ?? null,
      minimum_sample_size: input.minimumSampleSize ?? 1,
      enabled: input.enabled
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toAlertRule(row);
}

export async function listAlertRules(
  db: AlertDb,
  filters: { projectId?: string; environmentId?: string } = {}
): Promise<AlertRuleRecord[]> {
  let query = db.selectFrom("alert_rules").selectAll().where("archived_at", "is", null);

  if (filters.projectId !== undefined) {
    query = query.where("project_id", "=", filters.projectId);
  }
  if (filters.environmentId !== undefined) {
    query = query.where("environment_id", "=", filters.environmentId);
  }

  const rows = await query.orderBy("created_at", "asc").execute();
  return rows.map(toAlertRule);
}

export async function listActiveAlertRules(db: AlertDb): Promise<AlertRuleRecord[]> {
  const rows = await db
    .selectFrom("alert_rules")
    .innerJoin("projects", "projects.id", "alert_rules.project_id")
    .innerJoin("environments", (join) =>
      join
        .onRef("environments.project_id", "=", "alert_rules.project_id")
        .onRef("environments.id", "=", "alert_rules.environment_id")
    )
    .selectAll("alert_rules")
    .where("alert_rules.enabled", "=", true)
    .where("alert_rules.archived_at", "is", null)
    .where("projects.archived_at", "is", null)
    .where("environments.archived_at", "is", null)
    .orderBy("created_at", "asc")
    .execute();

  return rows.map(toAlertRule);
}

export async function getAlertRule(db: AlertDb, id: string): Promise<AlertRuleRecord | undefined> {
  const row = await db
    .selectFrom("alert_rules")
    .selectAll()
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .executeTakeFirst();

  return row ? toAlertRule(row) : undefined;
}

export async function updateAlertRule(
  db: AlertDb,
  id: string,
  input: {
    projectId?: string;
    environmentId?: string;
    notificationChannelId?: string | null;
    escalationChannelId?: string | null;
    name?: string;
    type?: AlertRuleType;
    severity?: AlertSeverity;
    windowMinutes?: number;
    threshold?: string;
    cooldownMinutes?: number;
    escalationMinutes?: number | null;
    routePattern?: string | null;
    minimumSampleSize?: number;
    enabled?: boolean;
  }
): Promise<AlertRuleRecord | undefined> {
  if (input.projectId !== undefined || input.environmentId !== undefined) {
    const current = await db
      .selectFrom("alert_rules")
      .select(["project_id", "environment_id"])
      .where("id", "=", id)
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (!current) {
      return undefined;
    }

    await assertActiveAlertRuleScope(db, {
      projectId: input.projectId ?? current.project_id,
      environmentId: input.environmentId ?? current.environment_id
    });
  }

  const row = await db
    .updateTable("alert_rules")
    .set({
      ...(input.projectId !== undefined ? { project_id: input.projectId } : {}),
      ...(input.environmentId !== undefined ? { environment_id: input.environmentId } : {}),
      ...(input.notificationChannelId !== undefined
        ? { notification_channel_id: input.notificationChannelId }
        : {}),
      ...(input.escalationChannelId !== undefined
        ? { escalation_channel_id: input.escalationChannelId }
        : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.severity !== undefined ? { severity: input.severity } : {}),
      ...(input.windowMinutes !== undefined ? { window_minutes: input.windowMinutes } : {}),
      ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
      ...(input.cooldownMinutes !== undefined ? { cooldown_minutes: input.cooldownMinutes } : {}),
      ...(input.escalationMinutes !== undefined ? { escalation_minutes: input.escalationMinutes } : {}),
      ...(input.routePattern !== undefined ? { route_pattern: input.routePattern } : {}),
      ...(input.minimumSampleSize !== undefined ? { minimum_sample_size: input.minimumSampleSize } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updated_at: new Date()
    })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toAlertRule(row) : undefined;
}

export async function archiveAlertRule(db: AlertDb, id: string): Promise<void> {
  const now = new Date();
  await db
    .updateTable("alert_rules")
    .set({ archived_at: now, updated_at: now })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .execute();
}

export async function evaluateAlertRule(
  db: AlertDb,
  input: {
    projectId: string;
    environmentId: string;
    type: AlertRuleType;
    windowStart: Date;
    windowEnd: Date;
    routePattern?: string | null;
    minimumSampleSize?: number;
  }
): Promise<{ observedValue: string; errorGroupId?: string | null }> {
  const minimumSampleSize = input.minimumSampleSize ?? 1;

  if (input.type === "critical_errors") {
    const [row, errorGroupId] = await Promise.all([
      db
        .selectFrom("errors")
        .select(({ fn }) => fn.countAll<string>().as("value"))
        .where("project_id", "=", input.projectId)
        .where("environment_id", "=", input.environmentId)
        .where("timestamp", ">=", input.windowStart)
        .where("timestamp", "<", input.windowEnd)
        .where("severity", "in", ["critical", "fatal"])
        .executeTakeFirstOrThrow(),
      getTopErrorGroupId(db, input, { criticalOnly: true })
    ]);

    return { observedValue: normalizeNumeric(row.value ?? "0"), errorGroupId };
  }

  if (input.type === "error_count") {
    const [row, errorGroupId] = await Promise.all([
      db
        .selectFrom("errors")
        .select(({ fn }) => fn.countAll<string>().as("value"))
        .where("project_id", "=", input.projectId)
        .where("environment_id", "=", input.environmentId)
        .where("timestamp", ">=", input.windowStart)
        .where("timestamp", "<", input.windowEnd)
        .executeTakeFirstOrThrow(),
      getTopErrorGroupId(db, input)
    ]);

    return { observedValue: normalizeNumeric(row.value ?? "0"), errorGroupId };
  }

  if (input.type === "trace_p95_latency") {
    const result = await sql<{ value: string | null }>`
      with scoped_traces as (
        select duration_ms
        from traces
        where project_id = ${input.projectId}
          and environment_id = ${input.environmentId}
          and timestamp >= ${input.windowStart}
          and timestamp < ${input.windowEnd}
          and duration_ms is not null
          and (${input.routePattern ?? null}::text is null or name = ${input.routePattern ?? null})
      )
      select case
        when count(*) < ${minimumSampleSize} then '0'
        else trim_scale(percentile_cont(0.95) within group (order by duration_ms)::numeric(18, 6))::text
      end as value
      from scoped_traces
    `.execute(db);

    return { observedValue: result.rows[0]?.value ?? "0" };
  }

  if (input.type === "error_rate") {
    const [result, errorGroupId] = await Promise.all([
      sql<{ value: string }>`
      with scoped_traces as (
        select trace_id
        from traces
        where project_id = ${input.projectId}
          and environment_id = ${input.environmentId}
          and timestamp >= ${input.windowStart}
          and timestamp < ${input.windowEnd}
          and (${input.routePattern ?? null}::text is null or name = ${input.routePattern ?? null})
      ),
      denominator as (
        select count(*)::numeric as value
        from scoped_traces
      ),
      numerator as (
        select count(*)::numeric as value
        from errors
        where project_id = ${input.projectId}
          and environment_id = ${input.environmentId}
          and timestamp >= ${input.windowStart}
          and timestamp < ${input.windowEnd}
          and (
            ${input.routePattern ?? null}::text is null
            or exists (
              select 1
              from scoped_traces
              where scoped_traces.trace_id = errors.trace_id
            )
          )
      )
      select case
        when denominator.value = 0 or denominator.value < ${minimumSampleSize} then '0'
        else trim_scale(((numerator.value / denominator.value) * 100)::numeric(18, 6))::text
      end as value
      from numerator, denominator
    `.execute(db),
      getTopErrorGroupId(db, input)
    ]);

    return { observedValue: result.rows[0]?.value ?? "0", errorGroupId };
  }

  if (input.type === "llm_cost") {
    const result = await sql<{ value: string }>`
      select trim_scale(coalesce(sum(cost_usd), 0)::numeric(18, 6))::text as value
      from llm_calls
      where project_id = ${input.projectId}
        and environment_id = ${input.environmentId}
        and timestamp >= ${input.windowStart}
        and timestamp < ${input.windowEnd}
    `.execute(db);

    return { observedValue: result.rows[0]?.value ?? "0" };
  }

  if (input.type === "dead_letter_count") {
    const row = await db
      .selectFrom("dead_letter_jobs")
      .select(({ fn }) => fn.countAll<string>().as("value"))
      .where("project_id", "=", input.projectId)
      .where("environment_id", "=", input.environmentId)
      .executeTakeFirstOrThrow();

    return { observedValue: normalizeNumeric(row.value ?? "0") };
  }

  throw new Error(`unsupported_alert_rule_type:${input.type}`);
}

async function getTopErrorGroupId(
  db: AlertDb,
  input: {
    projectId: string;
    environmentId: string;
    windowStart: Date;
    windowEnd: Date;
    routePattern?: string | null;
  },
  options: { criticalOnly?: boolean } = {}
): Promise<string | null> {
  const result = await sql<{ error_group_id: string | null }>`
    with scoped_errors as (
      select errors.error_group_id, errors.timestamp
      from errors
      where errors.project_id = ${input.projectId}
        and errors.environment_id = ${input.environmentId}
        and errors.timestamp >= ${input.windowStart}
        and errors.timestamp < ${input.windowEnd}
        and errors.error_group_id is not null
        and (${options.criticalOnly === true}::boolean = false or errors.severity in ('critical', 'fatal'))
        and (
          ${input.routePattern ?? null}::text is null
          or exists (
            select 1
            from traces
            where traces.project_id = errors.project_id
              and traces.environment_id = errors.environment_id
              and traces.trace_id = errors.trace_id
              and traces.name = ${input.routePattern ?? null}
          )
        )
    )
    select error_group_id
    from scoped_errors
    group by error_group_id
    order by count(*) desc, max(timestamp) desc, error_group_id asc
    limit 1
  `.execute(db);

  return result.rows[0]?.error_group_id ?? null;
}

export async function isErrorGroupSilenced(
  db: AlertDb,
  input: { errorGroupId: string; now: Date }
): Promise<boolean> {
  const row = await db
    .selectFrom("error_groups")
    .select("id")
    .where("id", "=", input.errorGroupId)
    .where("silenced_until", ">", input.now)
    .executeTakeFirst();

  return row !== undefined;
}

export async function recordAlertEvent(
  db: AlertDb,
  input: {
    rule: AlertRuleRecord;
    triggeredAt: Date;
    windowStart: Date;
    windowEnd: Date;
    observedValue: string;
    message: string;
    metadata: unknown;
  }
): Promise<AlertEventRecord> {
  const row = await db
    .insertInto("alert_events")
    .values({
      rule_id: input.rule.id,
      monitor_id: null,
      project_id: input.rule.projectId,
      environment_id: input.rule.environmentId,
      status: "triggered",
      severity: input.rule.severity,
      triggered_at: input.triggeredAt,
      window_start: input.windowStart,
      window_end: input.windowEnd,
      observed_value: input.observedValue,
      threshold: input.rule.threshold,
      message: input.message,
      metadata: input.metadata,
      escalation_due_at:
        input.rule.escalationMinutes === null
          ? null
          : new Date(input.triggeredAt.getTime() + input.rule.escalationMinutes * 60 * 1000)
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toAlertEvent({ ...row, latest_delivery_status: null });
}

export async function recordNotificationDelivery(
  db: AlertDb,
  input: {
    alertEventId: string;
    notificationChannelId: string;
    status: "success" | "failed";
    attemptedAt: Date;
    responseStatus: number | null;
    errorMessage: string | null;
  }
): Promise<NotificationDeliveryRecord> {
  const row = await db
    .insertInto("notification_deliveries")
    .values({
      alert_event_id: input.alertEventId,
      notification_channel_id: input.notificationChannelId,
      status: input.status,
      attempted_at: input.attemptedAt,
      response_status: input.responseStatus,
      error_message: input.errorMessage
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toNotificationDelivery(row);
}

export async function updateAlertEventTriage(
  db: AlertDb,
  id: string,
  input: {
    status: AlertEventRecord["status"];
    actorUserId: string | null;
    actorEmail: string;
    now: Date;
    snoozedUntil?: Date | null;
    note?: string | null;
  }
): Promise<AlertEventRecord | undefined> {
  const note = input.note?.trim() || null;
  const row = await db
    .updateTable("alert_events")
    .set({
      status: input.status,
      triage_note: note,
      ...(input.status === "acknowledged"
        ? {
            acknowledged_at: input.now,
            acknowledged_by_user_id: input.actorUserId,
            acknowledged_by_email: input.actorEmail,
            snoozed_until: null
          }
        : {}),
      ...(input.status === "snoozed"
        ? {
            acknowledged_at: input.now,
            acknowledged_by_user_id: input.actorUserId,
            acknowledged_by_email: input.actorEmail,
            snoozed_until: input.snoozedUntil ?? null
          }
        : {}),
      ...(input.status === "resolved"
        ? {
            resolved_at: input.now,
            resolved_by_user_id: input.actorUserId,
            resolved_by_email: input.actorEmail,
            snoozed_until: null
          }
        : {}),
      ...(input.status === "triggered"
        ? {
            acknowledged_at: null,
            acknowledged_by_user_id: null,
            acknowledged_by_email: null,
            resolved_at: null,
            resolved_by_user_id: null,
            resolved_by_email: null,
            snoozed_until: null
          }
        : {})
    })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();

  return row ? toAlertEvent({ ...row, latest_delivery_status: null }) : undefined;
}

export async function listAlertEscalationsDue(
  db: AlertDb,
  input: { now: Date; limit?: number } = { now: new Date() }
): Promise<AlertEscalationRecord[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 250);
  const result = await sql<AlertEventEscalationRow>`
    select
      alert_events.*,
      latest_delivery.status as latest_delivery_status,
      alert_rules.notification_channel_id as rule_notification_channel_id,
      alert_rules.escalation_channel_id as rule_escalation_channel_id,
      alert_rules.name as rule_name,
      alert_rules.type as rule_type,
      alert_rules.window_minutes as rule_window_minutes
    from alert_events
    inner join alert_rules on alert_rules.id = alert_events.rule_id
    left join lateral (
      select status
      from notification_deliveries
      where notification_deliveries.alert_event_id = alert_events.id
      order by attempted_at desc, created_at desc
      limit 1
    ) latest_delivery on true
    where alert_events.escalation_due_at is not null
      and alert_events.escalation_due_at <= ${input.now}
      and alert_events.escalated_at is null
      and alert_events.status = 'triggered'
      and alert_rules.archived_at is null
    order by alert_events.escalation_due_at asc, alert_events.triggered_at asc
    limit ${limit}
  `.execute(db);

  return result.rows.map(toAlertEscalation);
}

export async function markAlertEventEscalated(
  db: AlertDb,
  id: string,
  escalatedAt: Date
): Promise<AlertEventRecord | undefined> {
  const row = await db
    .updateTable("alert_events")
    .set({ escalated_at: escalatedAt })
    .where("id", "=", id)
    .where("escalated_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toAlertEvent({ ...row, latest_delivery_status: null }) : undefined;
}

export async function updateAlertRuleEvaluation(
  db: AlertDb,
  input: { ruleId: string; evaluatedAt: Date; triggeredAt?: Date | null }
): Promise<AlertRuleRecord | undefined> {
  const row = await db
    .updateTable("alert_rules")
    .set({
      last_evaluated_at: input.evaluatedAt,
      ...(input.triggeredAt !== undefined ? { last_triggered_at: input.triggeredAt } : {}),
      updated_at: new Date()
    })
    .where("id", "=", input.ruleId)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toAlertRule(row) : undefined;
}

export async function listAlertEvents(
  db: AlertDb,
  input: { projectId?: string; environmentId?: string; limit?: number } = {}
): Promise<AlertEventRecord[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 250);
  const result = await sql<AlertEventWithDeliveryRow>`
    select alert_events.*, latest_delivery.status as latest_delivery_status
    from alert_events
    left join lateral (
      select status
      from notification_deliveries
      where notification_deliveries.alert_event_id = alert_events.id
      order by attempted_at desc, created_at desc
      limit 1
    ) latest_delivery on true
    where (${input.projectId ?? null}::text is null or alert_events.project_id = ${input.projectId ?? null})
      and (${input.environmentId ?? null}::text is null or alert_events.environment_id = ${input.environmentId ?? null})
    order by alert_events.triggered_at desc, alert_events.created_at desc
    limit ${limit}
  `.execute(db);

  return result.rows.map(toAlertEvent);
}

export async function getAlertEvent(db: AlertDb, id: string): Promise<AlertEventRecord | undefined> {
  const result = await sql<AlertEventWithDeliveryRow>`
    select alert_events.*, latest_delivery.status as latest_delivery_status
    from alert_events
    left join lateral (
      select status
      from notification_deliveries
      where notification_deliveries.alert_event_id = alert_events.id
      order by attempted_at desc, created_at desc
      limit 1
    ) latest_delivery on true
    where alert_events.id = ${id}
  `.execute(db);

  const row = result.rows[0];
  return row ? toAlertEvent(row) : undefined;
}

export async function withAlertEvaluationLock<T>(
  db: Db,
  run: (lockedDb: Transaction<Database>) => Promise<T>
): Promise<{ locked: false } | { locked: true; result: T }> {
  return db.transaction().execute(async (trx) => {
    const result = await sql<{ locked: boolean }>`
      select pg_try_advisory_xact_lock(${ALERT_EVALUATION_LOCK_ID}) as locked
    `.execute(trx);
    if (result.rows[0]?.locked !== true) {
      return { locked: false };
    }

    return { locked: true, result: await run(trx) };
  });
}

// ---------------------------------------------------------------------------
// Alert suggestion heuristics
// ---------------------------------------------------------------------------

export const ERROR_COUNT_FLOOR = 20;
export const LATENCY_FLOOR_MS = 1000;
export const LLM_COST_FLOOR_USD = 10;

export type AlertSuggestion = {
  key: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  title: string;
  sub: string;
  windowMinutes: number;
  threshold: string;
  routePattern?: string | null;
  minimumSampleSize?: number;
  rationale: string;
  cooldownMinutes: number;
};

export async function buildAlertSuggestions(
  db: AlertDb,
  input: { projectId: string; environmentId: string; now: Date }
): Promise<AlertSuggestion[]> {
  const { projectId, environmentId, now } = input;
  const window24hStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Load active (enabled, non-archived) rules for dedup check
  const activeRuleRows = await db
    .selectFrom("alert_rules")
    .select(["type", "route_pattern"])
    .where("project_id", "=", projectId)
    .where("environment_id", "=", environmentId)
    .where("enabled", "=", true)
    .where("archived_at", "is", null)
    .execute();

  const activeByType = new Map<string, Array<string | null>>();
  for (const row of activeRuleRows) {
    const existing = activeByType.get(row.type) ?? [];
    existing.push(row.route_pattern);
    activeByType.set(row.type, existing);
  }

  function hasActiveRule(type: AlertRuleType, routePattern?: string | null): boolean {
    const patterns = activeByType.get(type);
    if (!patterns || patterns.length === 0) return false;
    if (routePattern == null) return true; // any active rule of this type
    return patterns.includes(routePattern);
  }

  const suggestions: AlertSuggestion[] = [];

  // 1. critical_errors — fires when ≥1 critical/fatal error in 24h
  if (!hasActiveRule("critical_errors")) {
    const ceResult = await sql<{ value: string }>`
      select count(*)::text as value
      from errors
      where project_id = ${projectId}
        and environment_id = ${environmentId}
        and timestamp >= ${window24hStart}
        and timestamp < ${now}
        and severity in ('critical', 'fatal')
    `.execute(db);
    const ceCount = Number(ceResult.rows[0]?.value ?? "0");
    if (ceCount >= 1) {
      suggestions.push({
        key: "critical_errors",
        type: "critical_errors",
        severity: "critical",
        title: "Critical errors detected",
        sub: `${ceCount} critical/fatal error${ceCount === 1 ? "" : "s"} in the last 24h`,
        windowMinutes: 60,
        threshold: "1",
        cooldownMinutes: 60,
        rationale: `${ceCount} critical or fatal errors observed in the last 24 hours. A rule at threshold 1 will alert immediately on recurrence.`,
      });
    }
  }

  // 2. error_count (route-scoped) — busiest route's peak 15-min error count
  if (!hasActiveRule("error_count")) {
    const peakResult = await sql<{ name: string; cnt: string }>`
      with bucketed as (
        select
          t.name,
          date_trunc('hour', e.timestamp) + interval '15 min' * floor(extract(minute from e.timestamp) / 15) as bucket,
          count(*) as cnt
        from errors e
        join traces t on t.trace_id = e.trace_id
          and t.project_id = e.project_id
          and t.environment_id = e.environment_id
        where e.project_id = ${projectId}
          and e.environment_id = ${environmentId}
          and e.timestamp >= ${window24hStart}
          and e.timestamp < ${now}
          and t.name is not null
        group by t.name, bucket
      )
      select name, max(cnt)::text as cnt
      from bucketed
      group by name
      order by max(cnt) desc
      limit 1
    `.execute(db);

    const peakRow = peakResult.rows[0];
    if (peakRow) {
      const peak15 = Number(peakRow.cnt);
      if (peak15 >= ERROR_COUNT_FLOOR) {
        const threshold = Math.ceil(peak15 * 1.5);
        suggestions.push({
          key: `error_count:${peakRow.name}`,
          type: "error_count",
          severity: "warning",
          title: `High error rate on ${peakRow.name}`,
          sub: `Peak ${peak15} errors in 15 min on this route`,
          windowMinutes: 15,
          threshold: String(threshold),
          routePattern: peakRow.name,
          cooldownMinutes: 60,
          rationale: `Route "${peakRow.name}" had ${peak15} errors in a 15-minute window. Threshold set to ${threshold} (peak × 1.5, rounded up).`,
        });
      }
    }
  }

  // 3. trace_p95_latency — observed 24h p95 >= LATENCY_FLOOR_MS
  if (!hasActiveRule("trace_p95_latency")) {
    const p95Result = await sql<{ value: string | null }>`
      select case
        when count(*) = 0 then '0'
        else trim_scale(percentile_cont(0.95) within group (order by duration_ms)::numeric(18,6))::text
      end as value
      from traces
      where project_id = ${projectId}
        and environment_id = ${environmentId}
        and timestamp >= ${window24hStart}
        and timestamp < ${now}
        and duration_ms is not null
    `.execute(db);
    const p95 = Number(p95Result.rows[0]?.value ?? "0");
    if (p95 >= LATENCY_FLOOR_MS) {
      const threshold = String(Math.round(p95 * 1.2));
      suggestions.push({
        key: "trace_p95_latency",
        type: "trace_p95_latency",
        severity: "warning",
        title: "High p95 trace latency",
        sub: `24h p95: ${Math.round(p95)} ms`,
        windowMinutes: 15,
        threshold,
        cooldownMinutes: 60,
        rationale: `Observed 24h p95 latency of ${Math.round(p95)} ms exceeds ${LATENCY_FLOOR_MS} ms floor. Threshold set to ${threshold} ms (p95 × 1.2, rounded).`,
      });
    }
  }

  // 4. llm_cost — 24h LLM spend >= LLM_COST_FLOOR_USD
  if (!hasActiveRule("llm_cost")) {
    const costResult = await sql<{ value: string }>`
      select trim_scale(coalesce(sum(cost_usd), 0)::numeric(18,6))::text as value
      from llm_calls
      where project_id = ${projectId}
        and environment_id = ${environmentId}
        and timestamp >= ${window24hStart}
        and timestamp < ${now}
    `.execute(db);
    const cost24h = Number(costResult.rows[0]?.value ?? "0");
    if (cost24h >= LLM_COST_FLOOR_USD) {
      const rawThreshold = Math.round(cost24h * 1.25 * 100) / 100;
      const threshold = rawThreshold % 1 === 0 ? String(rawThreshold) : rawThreshold.toFixed(2).replace(/\.?0+$/, "");
      suggestions.push({
        key: "llm_cost",
        type: "llm_cost",
        severity: "warning",
        title: "LLM daily spend approaching limit",
        sub: `24h spend: $${cost24h.toFixed(2)}`,
        windowMinutes: 1440,
        threshold,
        cooldownMinutes: 60,
        rationale: `24-hour LLM spend of $${cost24h.toFixed(2)} exceeds $${LLM_COST_FLOOR_USD} floor. Daily-window threshold set to $${threshold} (spend × 1.25).`,
      });
    }
  }

  return suggestions;
}
