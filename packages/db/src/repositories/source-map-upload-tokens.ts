import type { Selectable } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { SourceMapUploadTokensTable } from "../schema.js";

type SourceMapUploadTokenRow = Selectable<SourceMapUploadTokensTable>;

export type SourceMapUploadTokenRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  prefix: string;
  hash: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export type SourceMapUploadTokenScope = {
  projectId: string;
  environmentId: string;
};

export type CreateSourceMapUploadTokenRecordInput = SourceMapUploadTokenScope & {
  name: string;
  prefix: string;
  hash: string;
};

function toSourceMapUploadToken(row: SourceMapUploadTokenRow): SourceMapUploadTokenRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    name: row.name,
    prefix: row.prefix,
    hash: row.hash,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at
  };
}

async function hasActiveSourceMapUploadTokenScope(db: Db, scope: SourceMapUploadTokenScope): Promise<boolean> {
  const activeScope = await db
    .selectFrom("projects")
    .innerJoin("environments", "environments.project_id", "projects.id")
    .select("environments.id")
    .where("projects.id", "=", scope.projectId)
    .where("environments.id", "=", scope.environmentId)
    .where("projects.archived_at", "is", null)
    .where("environments.archived_at", "is", null)
    .executeTakeFirst();

  return Boolean(activeScope);
}

export async function createSourceMapUploadTokenRecord(
  db: Db,
  input: CreateSourceMapUploadTokenRecordInput
): Promise<SourceMapUploadTokenRecord> {
  if (!(await hasActiveSourceMapUploadTokenScope(db, input))) {
    throw new Error("active_source_map_upload_token_scope_not_found");
  }

  const row = await db
    .insertInto("source_map_upload_tokens")
    .values({
      id: createId("smtok"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      name: input.name,
      prefix: input.prefix,
      hash: input.hash
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toSourceMapUploadToken(row);
}

export async function listSourceMapUploadTokens(
  db: Db,
  scope: SourceMapUploadTokenScope
): Promise<SourceMapUploadTokenRecord[]> {
  if (!(await hasActiveSourceMapUploadTokenScope(db, scope))) {
    return [];
  }

  const rows = await db
    .selectFrom("source_map_upload_tokens")
    .selectAll()
    .where("project_id", "=", scope.projectId)
    .where("environment_id", "=", scope.environmentId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();

  return rows.map(toSourceMapUploadToken);
}

export async function findSourceMapUploadTokenByPrefix(
  db: Db,
  prefix: string
): Promise<SourceMapUploadTokenRecord | undefined> {
  const row = await db
    .selectFrom("source_map_upload_tokens")
    .innerJoin("projects", "projects.id", "source_map_upload_tokens.project_id")
    .innerJoin("environments", (join) =>
      join
        .onRef("environments.project_id", "=", "source_map_upload_tokens.project_id")
        .onRef("environments.id", "=", "source_map_upload_tokens.environment_id")
    )
    .selectAll("source_map_upload_tokens")
    .where("source_map_upload_tokens.prefix", "=", prefix)
    .where("source_map_upload_tokens.revoked_at", "is", null)
    .where("projects.archived_at", "is", null)
    .where("environments.archived_at", "is", null)
    .executeTakeFirst();

  return row ? toSourceMapUploadToken(row) : undefined;
}

export async function updateSourceMapUploadTokenLastUsed(db: Db, id: string): Promise<void> {
  await db
    .updateTable("source_map_upload_tokens")
    .set({ last_used_at: new Date() })
    .where("id", "=", id)
    .where("revoked_at", "is", null)
    .execute();
}

export async function updateSourceMapUploadToken(
  db: Db,
  input: SourceMapUploadTokenScope & { id: string; name?: string }
): Promise<SourceMapUploadTokenRecord | undefined> {
  if (!(await hasActiveSourceMapUploadTokenScope(db, input))) {
    return undefined;
  }

  const row = await db
    .updateTable("source_map_upload_tokens")
    .set({
      ...(input.name !== undefined ? { name: input.name } : {})
    })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("revoked_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toSourceMapUploadToken(row) : undefined;
}

export async function revokeSourceMapUploadToken(
  db: Db,
  input: SourceMapUploadTokenScope & { id: string }
): Promise<void> {
  if (!(await hasActiveSourceMapUploadTokenScope(db, input))) {
    return;
  }

  await db
    .updateTable("source_map_upload_tokens")
    .set({ revoked_at: new Date() })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("revoked_at", "is", null)
    .execute();
}
