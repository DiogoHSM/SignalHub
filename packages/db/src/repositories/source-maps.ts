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

  const rows = await query.orderBy("created_at", "desc").orderBy("id", "desc").execute();
  return rows.map(toSourceMapArtifact);
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
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("release", "=", input.release)
    .where("minified_file", "=", input.minifiedFile)
    .where("deleted_at", "is", null)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
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
