import type { Selectable } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { ApiKeysTable, EnvironmentsTable, ProjectsTable } from "../schema.js";

type ProjectRow = Selectable<ProjectsTable>;
type EnvironmentRow = Selectable<EnvironmentsTable>;
type ApiKeyRow = Selectable<ApiKeysTable>;

export interface Project {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface ApiKeyRecord {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  prefix: string;
  hash: string;
  createdAt: Date;
  revokedAt: Date | null;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

function toEnvironment(row: EnvironmentRow): Environment {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

function toApiKeyRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    name: row.name,
    prefix: row.prefix,
    hash: row.hash,
    createdAt: row.created_at,
    revokedAt: row.revoked_at
  };
}

export async function createProject(db: Db, input: { name: string }): Promise<Project> {
  const row = await db
    .insertInto("projects")
    .values({ id: createId("prj"), name: input.name })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toProject(row);
}

export async function createEnvironment(
  db: Db,
  input: { projectId: string; name: string }
): Promise<Environment> {
  const row = await db
    .insertInto("environments")
    .values({
      id: createId("env"),
      project_id: input.projectId,
      name: input.name
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toEnvironment(row);
}

export async function createApiKeyRecord(
  db: Db,
  input: { projectId: string; environmentId: string; name: string; prefix: string; hash: string }
): Promise<ApiKeyRecord> {
  const row = await db
    .insertInto("api_keys")
    .values({
      id: createId("key"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      name: input.name,
      prefix: input.prefix,
      hash: input.hash
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toApiKeyRecord(row);
}
