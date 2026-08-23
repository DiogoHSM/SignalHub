import type { Selectable } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { ReadTokensTable } from "../schema.js";

type ReadTokenRow = Selectable<ReadTokensTable>;

export type ReadTokenRecord = {
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

export type ReadTokenScope = {
  projectId: string;
  environmentId: string;
};

export type CreateReadTokenRecordInput = ReadTokenScope & {
  name: string;
  prefix: string;
  hash: string;
};

function toReadToken(row: ReadTokenRow): ReadTokenRecord {
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

async function hasActiveReadTokenScope(db: Db, scope: ReadTokenScope): Promise<boolean> {
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

export async function createReadTokenRecord(
  db: Db,
  input: CreateReadTokenRecordInput
): Promise<ReadTokenRecord> {
  if (!(await hasActiveReadTokenScope(db, input))) {
    throw new Error("active_read_token_scope_not_found");
  }

  const row = await db
    .insertInto("read_tokens")
    .values({
      id: createId("rdtok"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      name: input.name,
      prefix: input.prefix,
      hash: input.hash
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toReadToken(row);
}

export async function listReadTokens(db: Db, scope: ReadTokenScope): Promise<ReadTokenRecord[]> {
  if (!(await hasActiveReadTokenScope(db, scope))) {
    return [];
  }

  const rows = await db
    .selectFrom("read_tokens")
    .selectAll()
    .where("project_id", "=", scope.projectId)
    .where("environment_id", "=", scope.environmentId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();

  return rows.map(toReadToken);
}

export async function findReadTokenByPrefix(db: Db, prefix: string): Promise<ReadTokenRecord | undefined> {
  const row = await db
    .selectFrom("read_tokens")
    .innerJoin("projects", "projects.id", "read_tokens.project_id")
    .innerJoin("environments", (join) =>
      join
        .onRef("environments.project_id", "=", "read_tokens.project_id")
        .onRef("environments.id", "=", "read_tokens.environment_id")
    )
    .selectAll("read_tokens")
    .where("read_tokens.prefix", "=", prefix)
    .where("read_tokens.revoked_at", "is", null)
    .where("projects.archived_at", "is", null)
    .where("environments.archived_at", "is", null)
    .executeTakeFirst();

  return row ? toReadToken(row) : undefined;
}

export async function updateReadTokenLastUsed(db: Db, id: string): Promise<void> {
  await db
    .updateTable("read_tokens")
    .set({ last_used_at: new Date() })
    .where("id", "=", id)
    .where("revoked_at", "is", null)
    .execute();
}

export async function updateReadToken(
  db: Db,
  input: ReadTokenScope & { id: string; name?: string }
): Promise<ReadTokenRecord | undefined> {
  if (!(await hasActiveReadTokenScope(db, input))) {
    return undefined;
  }

  const row = await db
    .updateTable("read_tokens")
    .set({
      ...(input.name !== undefined ? { name: input.name } : {})
    })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("revoked_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toReadToken(row) : undefined;
}

export async function revokeReadToken(db: Db, input: ReadTokenScope & { id: string }): Promise<void> {
  if (!(await hasActiveReadTokenScope(db, input))) {
    return;
  }

  await db
    .updateTable("read_tokens")
    .set({ revoked_at: new Date() })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("revoked_at", "is", null)
    .execute();
}
