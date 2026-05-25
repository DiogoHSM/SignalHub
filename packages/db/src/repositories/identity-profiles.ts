import { sql } from "kysely";
import { sanitizeValue } from "@sigmon/telemetry/sanitization";
import type { Db } from "../client.js";

export interface IdentifyUserProfileInput {
  projectId: string;
  environmentId: string;
  userId: string;
  tenantId?: string | null;
  traits: unknown;
  timestamp: Date;
}

export interface IdentifyTenantProfileInput {
  projectId: string;
  environmentId: string;
  tenantId: string;
  traits: unknown;
  timestamp: Date;
}

export type TouchUserProfileInput = Omit<IdentifyUserProfileInput, "traits">;
export type TouchTenantProfileInput = Omit<IdentifyTenantProfileInput, "traits">;

function objectTraits(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return sanitizeValue(value) as Record<string, unknown>;
}

export async function identifyUserProfile(db: Db, input: IdentifyUserProfileInput): Promise<void> {
  await db
    .insertInto("user_profiles")
    .values({
      project_id: input.projectId,
      environment_id: input.environmentId,
      user_id: input.userId,
      tenant_id: input.tenantId ?? null,
      traits: objectTraits(input.traits),
      first_seen_at: input.timestamp,
      last_seen_at: input.timestamp,
      updated_at: input.timestamp
    })
    .onConflict((oc) =>
      oc.columns(["project_id", "environment_id", "user_id"]).doUpdateSet({
        tenant_id: sql<string | null>`coalesce(excluded.tenant_id, user_profiles.tenant_id)`,
        traits: sql<unknown>`excluded.traits`,
        last_seen_at: sql<Date>`greatest(user_profiles.last_seen_at, excluded.last_seen_at)`,
        updated_at: input.timestamp
      })
    )
    .execute();
}

export async function identifyTenantProfile(db: Db, input: IdentifyTenantProfileInput): Promise<void> {
  await db
    .insertInto("tenant_profiles")
    .values({
      project_id: input.projectId,
      environment_id: input.environmentId,
      tenant_id: input.tenantId,
      traits: objectTraits(input.traits),
      first_seen_at: input.timestamp,
      last_seen_at: input.timestamp,
      updated_at: input.timestamp
    })
    .onConflict((oc) =>
      oc.columns(["project_id", "environment_id", "tenant_id"]).doUpdateSet({
        traits: sql<unknown>`excluded.traits`,
        last_seen_at: sql<Date>`greatest(tenant_profiles.last_seen_at, excluded.last_seen_at)`,
        updated_at: input.timestamp
      })
    )
    .execute();
}

export async function touchUserProfileLastSeen(db: Db, input: TouchUserProfileInput): Promise<void> {
  await db
    .insertInto("user_profiles")
    .values({
      project_id: input.projectId,
      environment_id: input.environmentId,
      user_id: input.userId,
      tenant_id: input.tenantId ?? null,
      traits: {},
      first_seen_at: input.timestamp,
      last_seen_at: input.timestamp,
      updated_at: input.timestamp
    })
    .onConflict((oc) =>
      oc.columns(["project_id", "environment_id", "user_id"]).doUpdateSet({
        tenant_id: sql<string | null>`coalesce(excluded.tenant_id, user_profiles.tenant_id)`,
        last_seen_at: sql<Date>`greatest(user_profiles.last_seen_at, excluded.last_seen_at)`,
        updated_at: input.timestamp
      })
    )
    .execute();
}

export async function touchTenantProfileLastSeen(db: Db, input: TouchTenantProfileInput): Promise<void> {
  await db
    .insertInto("tenant_profiles")
    .values({
      project_id: input.projectId,
      environment_id: input.environmentId,
      tenant_id: input.tenantId,
      traits: {},
      first_seen_at: input.timestamp,
      last_seen_at: input.timestamp,
      updated_at: input.timestamp
    })
    .onConflict((oc) =>
      oc.columns(["project_id", "environment_id", "tenant_id"]).doUpdateSet({
        last_seen_at: sql<Date>`greatest(tenant_profiles.last_seen_at, excluded.last_seen_at)`,
        updated_at: input.timestamp
      })
    )
    .execute();
}
