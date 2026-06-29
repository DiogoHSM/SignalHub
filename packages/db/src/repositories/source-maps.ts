import type { Selectable, Transaction } from "kysely";
import { sql } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { Database, ErrorStackResolutionsTable, SourceMapArtifactsTable } from "../schema.js";

type SourceMapArtifactRow = Selectable<SourceMapArtifactsTable>;
type ErrorStackResolutionRow = Selectable<ErrorStackResolutionsTable>;
type SourceMapDb = Db | Transaction<Database>;

function isTransaction(db: SourceMapDb): db is Transaction<Database> {
  return db.isTransaction;
}

export type SourceMapArtifactRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  release: string;
  minifiedFile: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  storagePath: string;
  uploadedByUserId: string | null;
  uploadedByTokenId: string | null;
  createdAt: Date;
  deletedAt: Date | null;
};

export type ErrorStackResolutionRecord = {
  id: string;
  errorId: string;
  projectId: string;
  environmentId: string;
  release: string;
  sourceMapArtifactId: string;
  frameIndex: number;
  minifiedFile: string;
  minifiedLine: number;
  minifiedColumn: number;
  originalSource: string;
  originalLine: number;
  originalColumn: number;
  originalName: string | null;
  createdAt: Date;
};

export type SourceMapScope = {
  projectId: string;
  environmentId: string;
  release?: string;
  limit?: number;
  cursor?: string;
};

type SourceMapArtifactCursorPayload = {
  projectId: string;
  environmentId: string;
  release: string | null;
  createdAt: string;
  id: string;
};

export type SourceMapArtifactPage = {
  artifacts: SourceMapArtifactRecord[];
  cursor?: string;
};

type SourceMapArtifactUploader =
  | { uploadedByUserId: string; uploadedByTokenId?: never }
  | { uploadedByUserId?: never; uploadedByTokenId: string };

export type CreateSourceMapArtifactInput = SourceMapArtifactUploader & {
  projectId: string;
  environmentId: string;
  release: string;
  minifiedFile: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  storagePath: string;
};

export type ReplaceErrorStackResolutionsInput = {
  errorId: string;
  projectId: string;
  environmentId: string;
  release: string;
  frames: Array<{
    sourceMapArtifactId: string;
    frameIndex: number;
    minifiedFile: string;
    minifiedLine: number;
    minifiedColumn: number;
    originalSource: string;
    originalLine: number;
    originalColumn: number;
    originalName?: string | null;
  }>;
};

function toSourceMapArtifact(row: SourceMapArtifactRow): SourceMapArtifactRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    release: row.release,
    minifiedFile: row.minified_file,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    storagePath: row.storage_path,
    uploadedByUserId: row.uploaded_by_user_id,
    uploadedByTokenId: row.uploaded_by_token_id,
    createdAt: row.created_at,
    deletedAt: row.deleted_at
  };
}

function toErrorStackResolution(row: ErrorStackResolutionRow): ErrorStackResolutionRecord {
  return {
    id: row.id,
    errorId: row.error_id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    release: row.release,
    sourceMapArtifactId: row.source_map_artifact_id,
    frameIndex: row.frame_index,
    minifiedFile: row.minified_file,
    minifiedLine: row.minified_line,
    minifiedColumn: row.minified_column,
    originalSource: row.original_source,
    originalLine: row.original_line,
    originalColumn: row.original_column,
    originalName: row.original_name,
    createdAt: row.created_at
  };
}

function resolveListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 50;
  return Math.min(250, Math.max(1, Math.trunc(limit)));
}

function encodeSourceMapArtifactCursor(row: SourceMapArtifactRow, scope: SourceMapScope): string {
  const payload: SourceMapArtifactCursorPayload = {
    projectId: scope.projectId,
    environmentId: scope.environmentId,
    release: scope.release ?? null,
    createdAt: row.created_at.toISOString(),
    id: row.id
  };

  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeSourceMapArtifactCursor(cursor: string): SourceMapArtifactCursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid_cursor");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("invalid_cursor");
  }

  const payload = parsed as Partial<SourceMapArtifactCursorPayload>;
  const createdAt = typeof payload.createdAt === "string" ? new Date(payload.createdAt) : null;
  if (
    typeof payload.projectId !== "string" ||
    typeof payload.environmentId !== "string" ||
    (typeof payload.release !== "string" && payload.release !== null) ||
    typeof payload.id !== "string" ||
    createdAt === null ||
    Number.isNaN(createdAt.getTime())
  ) {
    throw new Error("invalid_cursor");
  }

  return payload as SourceMapArtifactCursorPayload;
}

export async function listSourceMapArtifacts(
  db: SourceMapDb,
  scope: SourceMapScope
): Promise<SourceMapArtifactRecord[]> {
  let query = db
    .selectFrom("source_map_artifacts")
    .selectAll()
    .where("project_id", "=", scope.projectId)
    .where("environment_id", "=", scope.environmentId)
    .where("deleted_at", "is", null);

  if (scope.release) query = query.where("release", "=", scope.release);

  if (scope.cursor) {
    const cursor = decodeSourceMapArtifactCursor(scope.cursor);
    if (
      cursor.projectId !== scope.projectId ||
      cursor.environmentId !== scope.environmentId ||
      cursor.release !== (scope.release ?? null)
    ) {
      throw new Error("invalid_cursor_scope");
    }

    const cursorCreatedAt = new Date(cursor.createdAt);
    query = query.where(sql<boolean>`(
      created_at < ${cursorCreatedAt}
      or (created_at = ${cursorCreatedAt} and id < ${cursor.id})
    )`);
  }

  const rows = await query.orderBy("created_at", "desc").orderBy("id", "desc").limit(resolveListLimit(scope.limit)).execute();
  return rows.map(toSourceMapArtifact);
}

export async function listSourceMapArtifactsPage(
  db: SourceMapDb,
  scope: SourceMapScope
): Promise<SourceMapArtifactPage> {
  const limit = resolveListLimit(scope.limit);
  let query = db
    .selectFrom("source_map_artifacts")
    .selectAll()
    .where("project_id", "=", scope.projectId)
    .where("environment_id", "=", scope.environmentId)
    .where("deleted_at", "is", null);

  if (scope.release) query = query.where("release", "=", scope.release);
  if (scope.cursor) {
    const cursor = decodeSourceMapArtifactCursor(scope.cursor);
    if (
      cursor.projectId !== scope.projectId ||
      cursor.environmentId !== scope.environmentId ||
      cursor.release !== (scope.release ?? null)
    ) {
      throw new Error("invalid_cursor_scope");
    }

    const cursorCreatedAt = new Date(cursor.createdAt);
    query = query.where(sql<boolean>`(
      created_at < ${cursorCreatedAt}
      or (created_at = ${cursorCreatedAt} and id < ${cursor.id})
    )`);
  }

  const rows = await query.orderBy("created_at", "desc").orderBy("id", "desc").limit(limit + 1).execute();
  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows.at(-1);

  return {
    artifacts: pageRows.map(toSourceMapArtifact),
    cursor: rows.length > limit && lastRow ? encodeSourceMapArtifactCursor(lastRow, scope) : undefined
  };
}

export async function listExpiredSourceMapArtifacts(
  db: SourceMapDb,
  input: { cutoff: Date; batchSize: number }
): Promise<SourceMapArtifactRecord[]> {
  const rows = await db
    .selectFrom("source_map_artifacts")
    .selectAll()
    .where("deleted_at", "is", null)
    .where("created_at", "<", input.cutoff)
    .orderBy("created_at", "asc")
    .orderBy("id", "asc")
    .limit(input.batchSize)
    .execute();

  return rows.map(toSourceMapArtifact);
}

export async function getSourceMapArtifact(
  db: SourceMapDb,
  input: { id: string; projectId: string; environmentId: string }
): Promise<SourceMapArtifactRecord | null> {
  const row = await db
    .selectFrom("source_map_artifacts")
    .selectAll()
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();

  return row ? toSourceMapArtifact(row) : null;
}

export async function findSourceMapArtifactForFrame(
  db: SourceMapDb,
  input: { projectId: string; environmentId: string; release: string; minifiedFile: string }
): Promise<SourceMapArtifactRecord | null> {
  const row = await db
    .selectFrom("source_map_artifacts")
    .innerJoin("projects", "projects.id", "source_map_artifacts.project_id")
    .innerJoin("environments", (join) =>
      join
        .onRef("environments.project_id", "=", "source_map_artifacts.project_id")
        .onRef("environments.id", "=", "source_map_artifacts.environment_id")
    )
    .selectAll("source_map_artifacts")
    .where("source_map_artifacts.project_id", "=", input.projectId)
    .where("source_map_artifacts.environment_id", "=", input.environmentId)
    .where("source_map_artifacts.release", "=", input.release)
    .where("source_map_artifacts.minified_file", "=", input.minifiedFile)
    .where("source_map_artifacts.deleted_at", "is", null)
    .where("projects.archived_at", "is", null)
    .where("environments.archived_at", "is", null)
    .orderBy("source_map_artifacts.created_at", "desc")
    .orderBy("source_map_artifacts.id", "desc")
    .executeTakeFirst();

  return row ? toSourceMapArtifact(row) : null;
}

export async function createSourceMapArtifact(
  db: SourceMapDb,
  input: CreateSourceMapArtifactInput
): Promise<SourceMapArtifactRecord> {
  const activeScope = await db
    .selectFrom("environments")
    .innerJoin("projects", "projects.id", "environments.project_id")
    .select("environments.id")
    .where("environments.id", "=", input.environmentId)
    .where("environments.project_id", "=", input.projectId)
    .where("environments.archived_at", "is", null)
    .where("projects.archived_at", "is", null)
    .executeTakeFirst();
  if (!activeScope) {
    throw new Error("active_source_map_scope_not_found");
  }

  const row = await db
    .insertInto("source_map_artifacts")
    .values({
      id: createId("smap"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      release: input.release,
      minified_file: input.minifiedFile,
      original_filename: input.originalFilename,
      content_type: input.contentType,
      byte_size: input.byteSize,
      sha256: input.sha256,
      storage_path: input.storagePath,
      uploaded_by_user_id: "uploadedByUserId" in input ? input.uploadedByUserId : null,
      uploaded_by_token_id: "uploadedByTokenId" in input ? input.uploadedByTokenId : null
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toSourceMapArtifact(row);
}

async function deleteCachedErrorStackResolutionsForArtifact(db: SourceMapDb, sourceMapArtifactId: string): Promise<void> {
  await sql`
    with affected_errors as (
      select distinct error_id
      from error_stack_resolutions
      where source_map_artifact_id = ${sourceMapArtifactId}
    )
    delete from error_stack_resolutions
    where error_id in (select error_id from affected_errors)
  `.execute(db);
}

export async function deleteSourceMapArtifact(
  db: Db,
  input: { id: string; projectId: string; environmentId: string }
): Promise<SourceMapArtifactRecord | null> {
  return db.transaction().execute(async (trx) => {
    const deleted = await trx
      .updateTable("source_map_artifacts")
      .set({ deleted_at: new Date() })
      .where("id", "=", input.id)
      .where("project_id", "=", input.projectId)
      .where("environment_id", "=", input.environmentId)
      .where("deleted_at", "is", null)
      .returningAll()
      .executeTakeFirst();

    if (!deleted) return null;

    await deleteCachedErrorStackResolutionsForArtifact(trx, deleted.id);

    return toSourceMapArtifact(deleted);
  });
}

export async function softDeleteSourceMapArtifactForRetention(
  db: SourceMapDb,
  id: string
): Promise<SourceMapArtifactRecord | null> {
  if (!isTransaction(db)) {
    return db.transaction().execute((trx) => softDeleteSourceMapArtifactForRetention(trx, id));
  }

  const deleted = await db
    .updateTable("source_map_artifacts")
    .set({ deleted_at: new Date() })
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  await deleteCachedErrorStackResolutionsForArtifact(db, id);

  return deleted ? toSourceMapArtifact(deleted) : null;
}

export async function getCachedErrorStackResolution(
  db: SourceMapDb,
  errorId: string
): Promise<ErrorStackResolutionRecord[]> {
  const rows = await db
    .selectFrom("error_stack_resolutions")
    .selectAll()
    .where("error_id", "=", errorId)
    .orderBy("frame_index", "asc")
    .execute();

  return rows.map(toErrorStackResolution);
}

export async function replaceErrorStackResolutions(
  db: Db,
  input: ReplaceErrorStackResolutionsInput
): Promise<ErrorStackResolutionRecord[]> {
  return db.transaction().execute(async (trx) => {
    const error = await trx
      .selectFrom("errors")
      .select(["id", "project_id", "environment_id", "release"])
      .where("id", "=", input.errorId)
      .executeTakeFirst();

    if (
      !error ||
      error.project_id !== input.projectId ||
      error.environment_id !== input.environmentId ||
      error.release !== input.release
    ) {
      throw new Error(`Error ${input.errorId} does not match source map scope`);
    }

    if (input.frames.length > 0) {
      const artifactIds = [...new Set(input.frames.map((frame) => frame.sourceMapArtifactId))];
      const artifacts = await trx
        .selectFrom("source_map_artifacts")
        .select(["id", "minified_file"])
        .where("id", "in", artifactIds)
        .where("project_id", "=", input.projectId)
        .where("environment_id", "=", input.environmentId)
        .where("release", "=", input.release)
        .where("deleted_at", "is", null)
        .forUpdate()
        .execute();
      const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));

      for (const frame of input.frames) {
        const artifact = artifactsById.get(frame.sourceMapArtifactId);
        if (!artifact || artifact.minified_file !== frame.minifiedFile) {
          throw new Error(`Frame ${frame.frameIndex} references an invalid source map artifact`);
        }
      }
    }

    await trx.deleteFrom("error_stack_resolutions").where("error_id", "=", input.errorId).execute();
    if (input.frames.length === 0) return [];

    const rows = await trx
      .insertInto("error_stack_resolutions")
      .values(
        input.frames.map((frame) => ({
          id: createId("esr"),
          error_id: input.errorId,
          project_id: input.projectId,
          environment_id: input.environmentId,
          release: input.release,
          source_map_artifact_id: frame.sourceMapArtifactId,
          frame_index: frame.frameIndex,
          minified_file: frame.minifiedFile,
          minified_line: frame.minifiedLine,
          minified_column: frame.minifiedColumn,
          original_source: frame.originalSource,
          original_line: frame.originalLine,
          original_column: frame.originalColumn,
          original_name: frame.originalName ?? null
        }))
      )
      .returningAll()
      .execute();

    return rows.map(toErrorStackResolution).sort((left, right) => left.frameIndex - right.frameIndex);
  });
}
