import type { Selectable } from "kysely";
import { sql } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { FeatureFlagAuditTable, FeatureFlagsTable } from "../schema.js";

type FeatureFlagRow = Selectable<FeatureFlagsTable>;
type FeatureFlagAuditRow = Selectable<FeatureFlagAuditTable>;

export type FeatureFlagStatus = "draft" | "active" | "paused" | "archived";
export type FeatureFlagAuditAction = "created" | "updated" | "archived";
export type FeatureFlagValue = string | number | boolean | null;

export interface FeatureFlagVariant {
  key: string;
  value: FeatureFlagValue;
}

export interface FeatureFlagRuleMatch {
  userId?: string;
  tenantId?: string;
  sessionId?: string;
  traits?: Record<string, FeatureFlagValue>;
}

export type FeatureFlagRolloutStickiness = "user" | "tenant" | "session";

export interface FeatureFlagRollout {
  percentage: number;
  stickiness: FeatureFlagRolloutStickiness;
  salt?: string;
}

export interface FeatureFlagRule {
  id?: string;
  description?: string;
  variant: string;
  match: FeatureFlagRuleMatch;
  rollout?: FeatureFlagRollout;
}

export interface FeatureFlagRecord {
  id: string;
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description: string | null;
  status: FeatureFlagStatus;
  defaultVariant: string;
  variants: FeatureFlagVariant[];
  rules: FeatureFlagRule[];
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface FeatureFlagAuditRecord {
  id: string;
  featureFlagId: string;
  projectId: string;
  environmentId: string;
  action: FeatureFlagAuditAction;
  actorId: string | null;
  changes: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateFeatureFlagInput {
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description?: string | null;
  status?: FeatureFlagStatus;
  defaultVariant: string;
  variants: FeatureFlagVariant[];
  rules?: FeatureFlagRule[];
  actorId?: string | null;
}

export type UpdateFeatureFlagInput = Partial<
  Pick<CreateFeatureFlagInput, "name" | "description" | "status" | "defaultVariant" | "variants" | "rules">
>;

export interface FeatureFlagEvaluationSubject {
  userId?: string;
  tenantId?: string;
  sessionId?: string;
  traits?: Record<string, FeatureFlagValue>;
}

export interface FeatureFlagEvaluation {
  key: string;
  variant: string;
  value: FeatureFlagValue;
  matched: boolean;
  reason: "rule_match" | "default" | "missing" | "inactive";
  ruleId?: string;
}

function normalizeText(value: string | undefined | null, fallback: string, max = 120): string {
  const trimmed = value?.trim() ?? "";
  return (trimmed || fallback).slice(0, max);
}

function normalizeKey(value: string, fallback = "feature_flag"): string {
  return normalizeText(value, fallback, 80).replace(/\s+/g, "_").toLowerCase();
}

function normalizeStatus(value: FeatureFlagStatus | undefined): FeatureFlagStatus {
  return value === "active" || value === "paused" || value === "archived" ? value : "draft";
}

function normalizeVariantValue(value: unknown): FeatureFlagValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  return String(value);
}

function normalizeVariants(variants: FeatureFlagVariant[]): FeatureFlagVariant[] {
  const seen = new Set<string>();
  return variants
    .slice(0, 20)
    .map((variant, index) => ({
      key: normalizeKey(variant.key, `variant_${index + 1}`),
      value: normalizeVariantValue(variant.value)
    }))
    .filter((variant) => {
      if (seen.has(variant.key)) return false;
      seen.add(variant.key);
      return true;
    });
}

function normalizeRules(rules: FeatureFlagRule[] | undefined, variants: FeatureFlagVariant[]): FeatureFlagRule[] {
  const allowedVariants = new Set(variants.map((variant) => variant.key));
  return (rules ?? [])
    .slice(0, 50)
    .map((rule, index) => {
      const rollout = normalizeRollout(rule.rollout);
      return {
        id: rule.id ? normalizeKey(rule.id, `rule_${index + 1}`) : undefined,
        description: rule.description ? normalizeText(rule.description, "", 160) : undefined,
        variant: normalizeKey(rule.variant),
        match: normalizeMatch(rule.match),
        ...(rollout ? { rollout } : {})
      };
    })
    .filter((rule) => allowedVariants.has(rule.variant) && (hasMatch(rule.match) || Boolean(rule.rollout)));
}

function normalizeMatch(match: FeatureFlagRuleMatch | undefined): FeatureFlagRuleMatch {
  const next: FeatureFlagRuleMatch = {};
  if (match?.userId?.trim()) next.userId = match.userId.trim();
  if (match?.tenantId?.trim()) next.tenantId = match.tenantId.trim();
  if (match?.sessionId?.trim()) next.sessionId = match.sessionId.trim();
  if (match?.traits && typeof match.traits === "object") {
    const traits = Object.fromEntries(
      Object.entries(match.traits)
        .slice(0, 30)
        .map(([key, value]) => [normalizeText(key, "trait", 80), normalizeVariantValue(value)])
    );
    if (Object.keys(traits).length > 0) next.traits = traits;
  }
  return next;
}

function hasMatch(match: FeatureFlagRuleMatch): boolean {
  return Boolean(match.userId || match.tenantId || match.sessionId || (match.traits && Object.keys(match.traits).length > 0));
}

function normalizeRollout(rollout: FeatureFlagRollout | undefined): FeatureFlagRollout | undefined {
  if (!rollout || typeof rollout !== "object") return undefined;
  const percentage = Math.min(100, Math.max(0, Number(rollout.percentage)));
  if (!Number.isFinite(percentage) || percentage <= 0) return undefined;
  return {
    percentage: Math.round(percentage * 100) / 100,
    stickiness: rollout.stickiness === "tenant" || rollout.stickiness === "session" ? rollout.stickiness : "user",
    ...(rollout.salt?.trim() ? { salt: normalizeText(rollout.salt, "rollout", 120) } : {})
  };
}

function parseVariants(value: unknown): FeatureFlagVariant[] {
  return Array.isArray(value) ? normalizeVariants(value as FeatureFlagVariant[]) : [];
}

function parseRules(value: unknown, variants: FeatureFlagVariant[]): FeatureFlagRule[] {
  return Array.isArray(value) ? normalizeRules(value as FeatureFlagRule[], variants) : [];
}

function toFeatureFlag(row: FeatureFlagRow): FeatureFlagRecord {
  const variants = parseVariants(row.variants);
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    defaultVariant: row.default_variant,
    variants,
    rules: parseRules(row.rules, variants),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

function toAudit(row: FeatureFlagAuditRow): FeatureFlagAuditRecord {
  return {
    id: row.id,
    featureFlagId: row.feature_flag_id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    action: row.action,
    actorId: row.actor_id,
    changes: row.changes && typeof row.changes === "object" && !Array.isArray(row.changes) ? (row.changes as Record<string, unknown>) : {},
    createdAt: row.created_at
  };
}

function variantValue(flag: FeatureFlagRecord, variantKey: string): FeatureFlagValue {
  return flag.variants.find((variant) => variant.key === variantKey)?.value ?? null;
}

function ruleMatches(flagKey: string, rule: FeatureFlagRule, subject: FeatureFlagEvaluationSubject): boolean {
  if (rule.match.userId && rule.match.userId !== subject.userId) return false;
  if (rule.match.tenantId && rule.match.tenantId !== subject.tenantId) return false;
  if (rule.match.sessionId && rule.match.sessionId !== subject.sessionId) return false;
  if (rule.match.traits) {
    for (const [key, value] of Object.entries(rule.match.traits)) {
      if (subject.traits?.[key] !== value) return false;
    }
  }
  if (rule.rollout) {
    return rolloutMatches(flagKey, rule, subject);
  }
  return true;
}

function rolloutMatches(flagKey: string, rule: FeatureFlagRule, subject: FeatureFlagEvaluationSubject): boolean {
  if (!rule.rollout) return true;
  const stickyValue =
    rule.rollout.stickiness === "tenant" ? subject.tenantId : rule.rollout.stickiness === "session" ? subject.sessionId : subject.userId;
  if (!stickyValue) return false;
  const salt = rule.rollout.salt ?? `${flagKey}:${rule.id ?? rule.variant}`;
  const bucket = stableHash(`${salt}:${rule.rollout.stickiness}:${stickyValue}`) % 10000;
  return bucket < Math.round(rule.rollout.percentage * 100);
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function evaluateLoadedFlag(
  flag: FeatureFlagRecord | undefined,
  input: { key: string; subject?: FeatureFlagEvaluationSubject; fallbackVariant?: string }
): FeatureFlagEvaluation {
  const fallbackVariant = normalizeKey(input.fallbackVariant ?? "off");
  if (!flag) {
    return { key: normalizeKey(input.key), variant: fallbackVariant, value: null, matched: false, reason: "missing" };
  }
  if (flag.status !== "active") {
    return { key: flag.key, variant: fallbackVariant, value: variantValue(flag, fallbackVariant), matched: false, reason: "inactive" };
  }

  const subject = input.subject ?? {};
  const matchedRule = flag.rules.find((rule) => ruleMatches(flag.key, rule, subject));
  if (matchedRule) {
    return {
      key: flag.key,
      variant: matchedRule.variant,
      value: variantValue(flag, matchedRule.variant),
      matched: true,
      reason: "rule_match",
      ...(matchedRule.id ? { ruleId: matchedRule.id } : {})
    };
  }

  return {
    key: flag.key,
    variant: flag.defaultVariant,
    value: variantValue(flag, flag.defaultVariant),
    matched: false,
    reason: "default"
  };
}

async function recordAudit(
  db: Db,
  input: {
    featureFlagId: string;
    projectId: string;
    environmentId: string;
    action: FeatureFlagAuditAction;
    actorId?: string | null;
    changes?: Record<string, unknown>;
  }
): Promise<void> {
  await db
    .insertInto("feature_flag_audit")
    .values({
      id: createId("ffaud"),
      feature_flag_id: input.featureFlagId,
      project_id: input.projectId,
      environment_id: input.environmentId,
      action: input.action,
      actor_id: input.actorId ?? null,
      changes: sql`${JSON.stringify(input.changes ?? {})}::jsonb`
    })
    .execute();
}

export async function createFeatureFlag(db: Db, input: CreateFeatureFlagInput): Promise<FeatureFlagRecord> {
  const variants = normalizeVariants(input.variants);
  if (variants.length === 0) {
    throw new Error("feature_flag_requires_variant");
  }
  const defaultVariant = normalizeKey(input.defaultVariant, variants[0]?.key ?? "off");
  if (!variants.some((variant) => variant.key === defaultVariant)) {
    throw new Error("feature_flag_default_variant_missing");
  }
  const rules = normalizeRules(input.rules, variants);

  return db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto("feature_flags")
      .values({
        id: createId("flg"),
        project_id: input.projectId,
        environment_id: input.environmentId,
        key: normalizeKey(input.key),
        name: normalizeText(input.name, input.key),
        description: input.description?.trim() || null,
        status: normalizeStatus(input.status),
        default_variant: defaultVariant,
        variants: sql`${JSON.stringify(variants)}::jsonb`,
        rules: sql`${JSON.stringify(rules)}::jsonb`
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const flag = toFeatureFlag(row);
    await recordAudit(trx, {
      featureFlagId: flag.id,
      projectId: flag.projectId,
      environmentId: flag.environmentId,
      action: "created",
      actorId: input.actorId,
      changes: { key: flag.key, status: flag.status }
    });
    return flag;
  });
}

export async function listFeatureFlags(db: Db, input: { projectId: string; environmentId: string }): Promise<FeatureFlagRecord[]> {
  const rows = await db
    .selectFrom("feature_flags")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .orderBy("updated_at", "desc")
    .execute();
  return rows.map(toFeatureFlag);
}

export async function getFeatureFlag(
  db: Db,
  input: { id: string; projectId: string; environmentId: string }
): Promise<FeatureFlagRecord | undefined> {
  const row = await db
    .selectFrom("feature_flags")
    .selectAll()
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  return row ? toFeatureFlag(row) : undefined;
}

export async function getFeatureFlagByKey(
  db: Db,
  input: { key: string; projectId: string; environmentId: string }
): Promise<FeatureFlagRecord | undefined> {
  const row = await db
    .selectFrom("feature_flags")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("key", "=", normalizeKey(input.key))
    .where("archived_at", "is", null)
    .executeTakeFirst();
  return row ? toFeatureFlag(row) : undefined;
}

export async function updateFeatureFlag(
  db: Db,
  input: { id: string; projectId: string; environmentId: string; patch: UpdateFeatureFlagInput; actorId?: string | null }
): Promise<FeatureFlagRecord | undefined> {
  const current = await getFeatureFlag(db, input);
  if (!current) return undefined;
  const variants = input.patch.variants ? normalizeVariants(input.patch.variants) : current.variants;
  const defaultVariant = input.patch.defaultVariant ? normalizeKey(input.patch.defaultVariant) : current.defaultVariant;
  if (!variants.some((variant) => variant.key === defaultVariant)) {
    throw new Error("feature_flag_default_variant_missing");
  }
  const rules = input.patch.rules ? normalizeRules(input.patch.rules, variants) : current.rules;

  return db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable("feature_flags")
      .set({
        ...(input.patch.name !== undefined ? { name: normalizeText(input.patch.name, "Untitled flag") } : {}),
        ...(input.patch.description !== undefined ? { description: input.patch.description?.trim() || null } : {}),
        ...(input.patch.status !== undefined ? { status: normalizeStatus(input.patch.status) } : {}),
        ...(input.patch.defaultVariant !== undefined ? { default_variant: defaultVariant } : {}),
        ...(input.patch.variants !== undefined ? { variants: sql`${JSON.stringify(variants)}::jsonb` } : {}),
        ...(input.patch.rules !== undefined ? { rules: sql`${JSON.stringify(rules)}::jsonb` } : {}),
        updated_at: new Date()
      })
      .where("id", "=", input.id)
      .where("project_id", "=", input.projectId)
      .where("environment_id", "=", input.environmentId)
      .where("archived_at", "is", null)
      .returningAll()
      .executeTakeFirst();
    if (!row) return undefined;
    const flag = toFeatureFlag(row);
    await recordAudit(trx, {
      featureFlagId: flag.id,
      projectId: flag.projectId,
      environmentId: flag.environmentId,
      action: "updated",
      actorId: input.actorId,
      changes: input.patch as Record<string, unknown>
    });
    return flag;
  });
}

export async function archiveFeatureFlag(
  db: Db,
  input: { id: string; projectId: string; environmentId: string; actorId?: string | null }
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable("feature_flags")
      .set({ archived_at: new Date(), status: "archived", updated_at: new Date() })
      .where("id", "=", input.id)
      .where("project_id", "=", input.projectId)
      .where("environment_id", "=", input.environmentId)
      .where("archived_at", "is", null)
      .returningAll()
      .executeTakeFirst();
    if (!row) return;
    await recordAudit(trx, {
      featureFlagId: input.id,
      projectId: input.projectId,
      environmentId: input.environmentId,
      action: "archived",
      actorId: input.actorId,
      changes: { status: "archived" }
    });
  });
}

export async function listFeatureFlagAudit(
  db: Db,
  input: { featureFlagId: string; projectId: string; environmentId: string }
): Promise<FeatureFlagAuditRecord[]> {
  const rows = await db
    .selectFrom("feature_flag_audit")
    .selectAll()
    .where("feature_flag_id", "=", input.featureFlagId)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .orderBy("created_at", "asc")
    .execute();
  return rows.map(toAudit);
}

export async function evaluateFeatureFlag(
  db: Db,
  input: {
    projectId: string;
    environmentId: string;
    key: string;
    subject?: FeatureFlagEvaluationSubject;
    fallbackVariant?: string;
  }
): Promise<FeatureFlagEvaluation> {
  const flag = await getFeatureFlagByKey(db, input);
  return evaluateLoadedFlag(flag, input);
}

export async function evaluateFeatureFlagById(
  db: Db,
  input: {
    id: string;
    projectId: string;
    environmentId: string;
    subject?: FeatureFlagEvaluationSubject;
    fallbackVariant?: string;
  }
): Promise<FeatureFlagEvaluation> {
  const flag = await getFeatureFlag(db, input);
  return evaluateLoadedFlag(flag, { ...input, key: flag?.key ?? input.id });
}
