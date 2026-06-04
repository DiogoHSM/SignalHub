import type { Selectable } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { ApiKeysTable, EnvironmentsTable, ProjectBrowserOriginsTable, ProjectsTable } from "../schema.js";

type ProjectRow = Selectable<ProjectsTable>;
type ProjectBrowserOriginRow = Selectable<ProjectBrowserOriginsTable>;
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

export interface ProjectBrowserOrigin {
  id: string;
  projectId: string;
  origin: string;
  createdAt: Date;
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

function normalizeBrowserOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("invalid_browser_origin");
  }

  return parsed.origin;
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

function toProjectBrowserOrigin(row: ProjectBrowserOriginRow): ProjectBrowserOrigin {
  return {
    id: row.id,
    projectId: row.project_id,
    origin: row.origin,
    createdAt: row.created_at,
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

export async function listProjects(db: Db): Promise<Project[]> {
  const rows = await db
    .selectFrom("projects")
    .selectAll()
    .where("archived_at", "is", null)
    .orderBy("created_at", "asc")
    .execute();

  return rows.map(toProject);
}

export async function getProject(db: Db, id: string): Promise<Project | undefined> {
  const row = await db
    .selectFrom("projects")
    .selectAll()
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .executeTakeFirst();

  return row ? toProject(row) : undefined;
}

export async function updateProject(db: Db, id: string, input: { name?: string }): Promise<Project | undefined> {
  const row = await db
    .updateTable("projects")
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      updated_at: new Date()
    })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toProject(row) : undefined;
}

export async function archiveProject(db: Db, id: string): Promise<void> {
  const now = new Date();
  await db
    .updateTable("projects")
    .set({ archived_at: now, updated_at: now })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .execute();
}

export async function createProjectBrowserOrigin(
  db: Db,
  input: { projectId: string; origin: string }
): Promise<ProjectBrowserOrigin> {
  const activeProject = await db
    .selectFrom("projects")
    .select("id")
    .where("id", "=", input.projectId)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  if (!activeProject) {
    throw new Error("active_project_not_found");
  }

  const origin = normalizeBrowserOrigin(input.origin);
  const existing = await db
    .selectFrom("project_browser_origins")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("origin", "=", origin)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  if (existing) {
    return toProjectBrowserOrigin(existing);
  }

  const row = await db
    .insertInto("project_browser_origins")
    .values({
      id: createId("borg"),
      project_id: input.projectId,
      origin
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toProjectBrowserOrigin(row);
}

export async function listProjectBrowserOrigins(db: Db, projectId: string): Promise<ProjectBrowserOrigin[]> {
  const rows = await db
    .selectFrom("project_browser_origins")
    .innerJoin("projects", "projects.id", "project_browser_origins.project_id")
    .selectAll("project_browser_origins")
    .where("project_browser_origins.project_id", "=", projectId)
    .where("project_browser_origins.archived_at", "is", null)
    .where("projects.archived_at", "is", null)
    .orderBy("project_browser_origins.created_at", "asc")
    .execute();

  return rows.map(toProjectBrowserOrigin);
}

export async function archiveProjectBrowserOrigin(db: Db, id: string): Promise<void> {
  await db
    .updateTable("project_browser_origins")
    .set({ archived_at: new Date() })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .execute();
}

export async function isBrowserOriginAllowed(db: Db, origin: string): Promise<boolean> {
  const normalizedOrigin = normalizeBrowserOrigin(origin);
  const row = await db
    .selectFrom("project_browser_origins")
    .innerJoin("projects", "projects.id", "project_browser_origins.project_id")
    .select("project_browser_origins.id")
    .where("project_browser_origins.origin", "=", normalizedOrigin)
    .where("project_browser_origins.archived_at", "is", null)
    .where("projects.archived_at", "is", null)
    .executeTakeFirst();

  return row !== undefined;
}

export async function createEnvironment(
  db: Db,
  input: { projectId: string; name: string }
): Promise<Environment> {
  const activeProject = await db
    .selectFrom("projects")
    .select("id")
    .where("id", "=", input.projectId)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  if (!activeProject) {
    throw new Error("active_project_not_found");
  }

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

export async function listEnvironments(db: Db, projectId: string): Promise<Environment[]> {
  const rows = await db
    .selectFrom("environments")
    .selectAll()
    .where("project_id", "=", projectId)
    .where("archived_at", "is", null)
    .orderBy("created_at", "asc")
    .execute();

  return rows.map(toEnvironment);
}

export async function updateEnvironment(db: Db, id: string, input: { name?: string }): Promise<Environment | undefined> {
  const row = await db
    .updateTable("environments")
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      updated_at: new Date()
    })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toEnvironment(row) : undefined;
}

export async function archiveEnvironment(db: Db, id: string): Promise<void> {
  const now = new Date();
  await db
    .updateTable("environments")
    .set({ archived_at: now, updated_at: now })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .execute();
}

export async function createApiKeyRecord(
  db: Db,
  input: { projectId: string; environmentId: string; name: string; prefix: string; hash: string }
): Promise<ApiKeyRecord> {
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
    throw new Error("active_api_key_scope_not_found");
  }

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

export async function listApiKeys(db: Db, projectId: string): Promise<ApiKeyRecord[]> {
  const rows = await db
    .selectFrom("api_keys")
    .selectAll()
    .where("project_id", "=", projectId)
    .orderBy("created_at", "asc")
    .execute();

  return rows.map(toApiKeyRecord);
}

export async function updateApiKeyRecord(
  db: Db,
  id: string,
  input: { name?: string }
): Promise<ApiKeyRecord | undefined> {
  const row = await db
    .updateTable("api_keys")
    .set({
      ...(input.name !== undefined ? { name: input.name } : {})
    })
    .where("id", "=", id)
    .where("revoked_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toApiKeyRecord(row) : undefined;
}

export async function findApiKeyByPrefix(db: Db, prefix: string): Promise<ApiKeyRecord | undefined> {
  const row = await db
    .selectFrom("api_keys")
    .innerJoin("projects", "projects.id", "api_keys.project_id")
    .innerJoin("environments", (join) =>
      join
        .onRef("environments.project_id", "=", "api_keys.project_id")
        .onRef("environments.id", "=", "api_keys.environment_id")
    )
    .selectAll("api_keys")
    .where("api_keys.prefix", "=", prefix)
    .where("api_keys.revoked_at", "is", null)
    .where("projects.archived_at", "is", null)
    .where("environments.archived_at", "is", null)
    .executeTakeFirst();

  return row ? toApiKeyRecord(row) : undefined;
}

export async function revokeApiKey(db: Db, id: string): Promise<void> {
  await db
    .updateTable("api_keys")
    .set({ revoked_at: new Date() })
    .where("id", "=", id)
    .where("revoked_at", "is", null)
    .execute();
}
