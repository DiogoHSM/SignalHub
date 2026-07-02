import { sql } from "kysely";

import type { Db } from "../client.js";

export const dataGovernanceRetentionCategories = [
  "events",
  "errors",
  "traces",
  "spans",
  "llmCalls",
  "profiles",
  "breadcrumbs",
  "webVitals",
  "clicks",
  "replays"
] as const;

export type DataGovernanceRetentionCategory = (typeof dataGovernanceRetentionCategories)[number];
export type DataGovernancePropertyRuleAction = "mask" | "block";
export type DataGovernancePropertyRuleTarget =
  | "metadata"
  | "event.properties"
  | "error.context"
  | "span.input"
  | "span.output"
  | "span.error"
  | "breadcrumb.data"
  | "replay.event.data"
  | "identity.traits";

export type DataGovernanceRetentionPolicy = Partial<Record<DataGovernanceRetentionCategory, number>>;

export type DataGovernancePropertyRule = {
  target: DataGovernancePropertyRuleTarget;
  path: string;
  action: DataGovernancePropertyRuleAction;
};

export type DataGovernancePolicy = {
  projectId: string;
  environmentId: string;
  retentionPolicy: DataGovernanceRetentionPolicy;
  propertyRules: DataGovernancePropertyRule[];
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertDataGovernancePolicyInput = {
  projectId: string;
  environmentId: string;
  retentionPolicy?: DataGovernanceRetentionPolicy;
  propertyRules?: DataGovernancePropertyRule[];
  updatedByUserId?: string | null;
};

const categorySet = new Set<string>(dataGovernanceRetentionCategories);
const targetSet = new Set<DataGovernancePropertyRuleTarget>([
  "metadata",
  "event.properties",
  "error.context",
  "span.input",
  "span.output",
  "span.error",
  "breadcrumb.data",
  "replay.event.data",
  "identity.traits"
]);
const actionSet = new Set<DataGovernancePropertyRuleAction>(["mask", "block"]);
const unsafePathParts = new Set(["__proto__", "prototype", "constructor"]);

function jsonb(value: unknown) {
  return sql<unknown>`${JSON.stringify(value)}::jsonb`;
}

function normalizeRetentionPolicy(value: unknown): DataGovernanceRetentionPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const policy: DataGovernanceRetentionPolicy = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!categorySet.has(key)) continue;
    const days = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (Number.isInteger(days) && days >= 1 && days <= 3650) {
      policy[key as DataGovernanceRetentionCategory] = days;
    }
  }
  return policy;
}

function normalizePropertyRules(value: unknown): DataGovernancePropertyRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rules: DataGovernancePropertyRule[] = [];
  for (const rule of value) {
    if (!rule || typeof rule !== "object") continue;
    const candidate = rule as { target?: unknown; path?: unknown; action?: unknown };
    if (
      typeof candidate.target !== "string" ||
      !targetSet.has(candidate.target as DataGovernancePropertyRuleTarget) ||
      typeof candidate.path !== "string" ||
      candidate.path.trim().length === 0 ||
      typeof candidate.action !== "string" ||
      !actionSet.has(candidate.action as DataGovernancePropertyRuleAction)
    ) {
      continue;
    }

    rules.push({
      target: candidate.target as DataGovernancePropertyRuleTarget,
      path: candidate.path.trim(),
      action: candidate.action as DataGovernancePropertyRuleAction
    });
  }
  return rules;
}

function toPolicy(row: {
  project_id: string;
  environment_id: string;
  retention_policy: unknown;
  property_rules: unknown;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}): DataGovernancePolicy {
  return {
    projectId: row.project_id,
    environmentId: row.environment_id,
    retentionPolicy: normalizeRetentionPolicy(row.retention_policy),
    propertyRules: normalizePropertyRules(row.property_rules),
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function emptyDataGovernancePolicy(input: { projectId: string; environmentId: string }): DataGovernancePolicy {
  const now = new Date(0);
  return {
    projectId: input.projectId,
    environmentId: input.environmentId,
    retentionPolicy: {},
    propertyRules: [],
    updatedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
}

export async function getDataGovernancePolicy(
  db: Db,
  input: { projectId: string; environmentId: string }
): Promise<DataGovernancePolicy> {
  const row = await db
    .selectFrom("data_governance_policies")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .executeTakeFirst();

  return row ? toPolicy(row) : emptyDataGovernancePolicy(input);
}

export async function upsertDataGovernancePolicy(
  db: Db,
  input: UpsertDataGovernancePolicyInput
): Promise<DataGovernancePolicy> {
  const retentionPolicy = normalizeRetentionPolicy(input.retentionPolicy ?? {});
  const propertyRules = normalizePropertyRules(input.propertyRules ?? []);
  const now = new Date();

  const row = await db
    .insertInto("data_governance_policies")
    .values({
      project_id: input.projectId,
      environment_id: input.environmentId,
      retention_policy: jsonb(retentionPolicy),
      property_rules: jsonb(propertyRules),
      updated_by_user_id: input.updatedByUserId ?? null,
      created_at: now,
      updated_at: now
    })
    .onConflict((oc) =>
      oc.columns(["project_id", "environment_id"]).doUpdateSet({
        retention_policy: jsonb(retentionPolicy),
        property_rules: jsonb(propertyRules),
        updated_by_user_id: input.updatedByUserId ?? null,
        updated_at: now
      })
    )
    .returningAll()
    .executeTakeFirstOrThrow();

  return toPolicy(row);
}

function cloneJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function pathParts(path: string): string[] {
  return path
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isSafePathPart(part: string): boolean {
  return !unsafePathParts.has(part);
}

function applyRule(root: Record<string, unknown>, rule: DataGovernancePropertyRule): void {
  const parts = pathParts(rule.path);
  if (parts.length === 0 || parts.some((part) => !isSafePathPart(part))) return;

  let cursor: Record<string, unknown> = root;
  for (const part of parts.slice(0, -1)) {
    if (!Object.prototype.hasOwnProperty.call(cursor, part)) {
      return;
    }
    const next = cursor[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return;
    }
    cursor = next as Record<string, unknown>;
  }

  const leaf = parts[parts.length - 1];
  if (!Object.prototype.hasOwnProperty.call(cursor, leaf)) {
    return;
  }

  if (rule.action === "block") {
    delete cursor[leaf];
    return;
  }
  cursor[leaf] = "[REDACTED]";
}

export function applyDataGovernanceRules(
  value: unknown,
  policy: Pick<DataGovernancePolicy, "propertyRules">,
  target: DataGovernancePropertyRuleTarget
): Record<string, unknown> {
  const governed = cloneJsonObject(value);
  for (const rule of policy.propertyRules) {
    if (rule.target === target) {
      applyRule(governed, rule);
    }
  }
  return governed;
}
