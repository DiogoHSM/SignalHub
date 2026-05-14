# Phase 5E Source Map Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add worker-owned retention for local source-map artifacts so self-hosted installs do not grow source-map storage forever.

**Architecture:** Extend the existing retention scheduler and `retention_runs` model rather than creating a second source-map-specific scheduler. The worker will delete expired source-map artifacts in bounded batches, removing local files and metadata together, then report source-map policy and deleted counts through System health.

**Tech Stack:** TypeScript, pnpm workspaces, Kysely/Postgres migrations, Fastify system health, React console, Vitest.

---

## File Structure

- `packages/config/src/index.ts`: parse `SOURCE_MAPS_RETENTION_*` env config.
- `packages/config/test/config.test.ts`: verify defaults, overrides, and validation.
- `.env.example`: document new env vars.
- `packages/db/migrations/0009_source_map_retention.sql`: extend `retention_runs`.
- `packages/db/src/migrate.ts`: register migration 0009.
- `packages/db/src/schema.ts`: add source-map retention columns.
- `packages/db/src/repositories/system.ts`: extend retention policy/deleted types and run recording.
- `packages/db/src/repositories/source-maps.ts`: list expired artifacts and soft-delete artifacts by id.
- `packages/db/test/repositories.test.ts`: migration, retention run, and source-map retention repository coverage.
- `apps/worker/src/source-map-retention.ts`: safe local file cleanup plus metadata deletion orchestration.
- `apps/worker/src/retention.ts`: include source-map cleanup in a retention run.
- `apps/worker/src/main.ts`: wire source-map retention config and helper into the scheduler.
- `apps/worker/test/telemetry-worker.test.ts`: worker retention runtime tests.
- `apps/api/src/routes/system.ts`: extend API response types.
- `apps/api/src/system-health.ts`: serialize source-map retention policy/counts.
- `apps/api/src/main.ts`: include source-map retention policy in health dependencies.
- `apps/api/test/system.test.ts`: system health serialization tests.
- `apps/console/src/api/types.ts`: extend `SystemHealthResponse`.
- `apps/console/src/components/SystemHealthPanel.tsx`: render source-map policy and deleted counts in the Retention card.
- `apps/console/src/components/SystemHealthPanel.test.tsx`: console rendering tests.
- `README.md`, `.claude/docs/*`, `CLAUDE.md`, versioned memory: documentation and memory updates.

## Task 1: Source Map Retention Config and Schema

**Files:**
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/test/config.test.ts`
- Modify: `.env.example`
- Create: `packages/db/migrations/0009_source_map_retention.sql`
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [x] **Step 1: Write failing config tests**

Add tests to `packages/config/test/config.test.ts`:

```ts
it("loads source-map retention defaults", () => {
  const config = loadConfig(baseEnv());

  expect(config.sourceMaps.retention).toEqual({
    enabled: true,
    days: 180,
    batchSize: 100
  });
});

it("loads explicit source-map retention settings", () => {
  const config = loadConfig({
    ...baseEnv(),
    SOURCE_MAPS_RETENTION_ENABLED: "false",
    SOURCE_MAPS_RETENTION_DAYS: "45",
    SOURCE_MAPS_RETENTION_BATCH_SIZE: "25"
  });

  expect(config.sourceMaps.retention).toEqual({
    enabled: false,
    days: 45,
    batchSize: 25
  });
});

it.each(["SOURCE_MAPS_RETENTION_DAYS", "SOURCE_MAPS_RETENTION_BATCH_SIZE"] as const)(
  "rejects non-positive %s",
  (fieldName) => {
    expect(() => loadConfig({ ...baseEnv(), [fieldName]: "0" })).toThrow();
  }
);
```

- [x] **Step 2: Run config tests to verify failure**

Run:

```bash
pnpm exec vitest run packages/config/test/config.test.ts -t "source-map retention"
```

Expected: fails because `config.sourceMaps.retention` does not exist.

- [x] **Step 3: Add config parsing**

Modify `packages/config/src/index.ts`:

```ts
  SOURCE_MAPS_RETENTION_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SOURCE_MAPS_RETENTION_DAYS: optionalPositiveInteger(180),
  SOURCE_MAPS_RETENTION_BATCH_SIZE: optionalPositiveInteger(100),
```

Extend the returned `sourceMaps` object:

```ts
    sourceMaps: {
      localDir: parsed.SOURCE_MAPS_LOCAL_DIR,
      maxUploadMb: parsed.SOURCE_MAPS_MAX_UPLOAD_MB,
      retention: {
        enabled: parsed.SOURCE_MAPS_RETENTION_ENABLED,
        days: parsed.SOURCE_MAPS_RETENTION_DAYS,
        batchSize: parsed.SOURCE_MAPS_RETENTION_BATCH_SIZE
      }
    }
```

- [x] **Step 4: Add env examples**

Add to `.env.example` near existing source-map settings:

```dotenv
SOURCE_MAPS_RETENTION_ENABLED=true
SOURCE_MAPS_RETENTION_DAYS=180
SOURCE_MAPS_RETENTION_BATCH_SIZE=100
```

- [x] **Step 5: Write failing migration/schema tests**

Add to `packages/db/test/repositories.test.ts` in the migration smoke area:

```ts
it("has source-map retention columns on retention_runs", async () => {
  await withTestDb(async (db) => {
    await sql`
      select
        source_maps_enabled,
        source_maps_days,
        source_maps_batch_size,
        deleted_source_map_artifacts,
        deleted_source_map_files
      from retention_runs
      limit 0
    `.execute(db);
  });
});
```

- [x] **Step 6: Run DB migration test to verify failure**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts -t "source-map retention columns"
```

Expected: fails because the columns do not exist.

- [x] **Step 7: Add migration 0009**

Create `packages/db/migrations/0009_source_map_retention.sql`:

```sql
ALTER TABLE retention_runs
  ADD COLUMN IF NOT EXISTS source_maps_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source_maps_days integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS source_maps_batch_size integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS deleted_source_map_artifacts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted_source_map_files integer NOT NULL DEFAULT 0;

ALTER TABLE retention_runs
  ADD CONSTRAINT retention_runs_source_maps_days_positive CHECK (source_maps_days > 0),
  ADD CONSTRAINT retention_runs_source_maps_batch_size_positive CHECK (source_maps_batch_size > 0),
  ADD CONSTRAINT retention_runs_deleted_source_map_artifacts_nonnegative CHECK (deleted_source_map_artifacts >= 0),
  ADD CONSTRAINT retention_runs_deleted_source_map_files_nonnegative CHECK (deleted_source_map_files >= 0);

CREATE INDEX IF NOT EXISTS source_map_artifacts_retention_idx
  ON source_map_artifacts (created_at, id)
  WHERE deleted_at IS NULL;
```

If constraint names already exist in a local database, Postgres will raise on duplicate constraint names. This is acceptable for a new migration because it runs once and tests use fresh databases.

- [x] **Step 8: Register migration and schema columns**

Modify `packages/db/src/migrate.ts`:

```ts
  { name: "0008_source_map_upload_tokens.sql", url: new URL("../migrations/0008_source_map_upload_tokens.sql", import.meta.url) },
  { name: "0009_source_map_retention.sql", url: new URL("../migrations/0009_source_map_retention.sql", import.meta.url) }
```

Modify `RetentionRunsTable` in `packages/db/src/schema.ts`:

```ts
  source_maps_enabled: DefaultedBoolean;
  source_maps_days: DefaultedInteger;
  source_maps_batch_size: DefaultedInteger;
  deleted_source_map_artifacts: DefaultedInteger;
  deleted_source_map_files: DefaultedInteger;
```

- [x] **Step 9: Run config and DB tests**

Run:

```bash
pnpm exec vitest run packages/config/test/config.test.ts -t "source-map retention"
pnpm exec vitest run packages/db/test/repositories.test.ts -t "source-map retention columns"
pnpm --filter @signal-hub/config build
pnpm --filter @signal-hub/db build
```

Expected: pass.

- [x] **Step 10: Commit**

```bash
git add .env.example packages/config/src/index.ts packages/config/test/config.test.ts packages/db/migrations/0009_source_map_retention.sql packages/db/src/migrate.ts packages/db/src/schema.ts packages/db/test/repositories.test.ts
git commit -m "feat: add source map retention config schema"
```

## Task 2: Retention Run and Source Map Repository Helpers

**Files:**
- Modify: `packages/db/src/repositories/system.ts`
- Modify: `packages/db/src/repositories/source-maps.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [x] **Step 1: Write failing retention run test**

Add to `packages/db/test/repositories.test.ts` near existing retention run tests:

```ts
it("records source-map retention policy and deleted counts", async () => {
  await withTestDb(async (db) => {
    const startedAt = new Date("2026-05-13T10:00:00.000Z");
    const finishedAt = new Date("2026-05-13T10:00:05.000Z");

    const run = await recordRetentionRun(db, {
      startedAt,
      finishedAt,
      status: "success",
      deleted: {
        events: 1,
        errors: 2,
        traces: 3,
        spans: 4,
        llmCalls: 5,
        breadcrumbs: 6,
        sourceMapArtifacts: 7,
        sourceMapFiles: 7
      },
      policy: {
        eventsDays: 90,
        errorsDays: 180,
        tracesDays: 90,
        spansDays: 90,
        llmCallsDays: 180,
        breadcrumbsDays: 30,
        sourceMapsEnabled: true,
        sourceMapsDays: 180,
        sourceMapsBatchSize: 100
      }
    });

    await expect(getLastRetentionRun(db)).resolves.toEqual(run);
    expect(run.deleted.sourceMapArtifacts).toBe(7);
    expect(run.deleted.sourceMapFiles).toBe(7);
    expect(run.policy.sourceMapsEnabled).toBe(true);
    expect(run.policy.sourceMapsDays).toBe(180);
    expect(run.policy.sourceMapsBatchSize).toBe(100);
  });
});
```

- [x] **Step 2: Run retention run test to verify failure**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts -t "records source-map retention policy"
```

Expected: TypeScript or runtime failure because source-map retention fields are not handled.

- [x] **Step 3: Extend retention types and record mapping**

Modify `packages/db/src/repositories/system.ts`:

```ts
export type RetentionPolicy = {
  eventsDays: number;
  errorsDays: number;
  tracesDays: number;
  spansDays: number;
  llmCallsDays: number;
  breadcrumbsDays: number;
  sourceMapsEnabled: boolean;
  sourceMapsDays: number;
  sourceMapsBatchSize: number;
};

export type RetentionDeletedCounts = {
  events: number;
  errors: number;
  traces: number;
  spans: number;
  llmCalls: number;
  breadcrumbs: number;
  sourceMapArtifacts: number;
  sourceMapFiles: number;
};
```

Update `toRetentionRunRecord` deleted mapping:

```ts
    deleted: {
      events: row.deleted_events,
      errors: row.deleted_errors,
      traces: row.deleted_traces,
      spans: row.deleted_spans,
      llmCalls: row.deleted_llm_calls,
      breadcrumbs: row.deleted_breadcrumbs,
      sourceMapArtifacts: row.deleted_source_map_artifacts,
      sourceMapFiles: row.deleted_source_map_files
    },
```

Update policy mapping:

```ts
    policy: {
      eventsDays: row.events_days,
      errorsDays: row.errors_days,
      tracesDays: row.traces_days,
      spansDays: row.spans_days,
      llmCallsDays: row.llm_calls_days,
      breadcrumbsDays: row.breadcrumbs_days,
      sourceMapsEnabled: row.source_maps_enabled,
      sourceMapsDays: row.source_maps_days,
      sourceMapsBatchSize: row.source_maps_batch_size
    }
```

Update `recordRetentionRun` values:

```ts
      deleted_source_map_artifacts: input.deleted.sourceMapArtifacts,
      deleted_source_map_files: input.deleted.sourceMapFiles,
      source_maps_enabled: input.policy.sourceMapsEnabled,
      source_maps_days: input.policy.sourceMapsDays,
      source_maps_batch_size: input.policy.sourceMapsBatchSize
```

- [x] **Step 4: Write failing source-map repository tests**

Add `createUser` and `insertError` to existing imports in `packages/db/test/repositories.test.ts` if they are not already imported in the file. Then add:

```ts
it("lists expired source-map artifacts for retention in bounded order", async () => {
  await withTestDb(async (db) => {
    const project = await createProject(db, { name: "Source Map Retention Project" });
    const environment = await createEnvironment(db, { projectId: project.id, name: "Production" });
    const user = await createUser(db, {
      email: "sourcemaps-retention@example.com",
      passwordHash: "hash",
      isAdmin: true
    });
    const old = new Date("2026-01-01T00:00:00.000Z");
    const fresh = new Date("2026-05-13T00:00:00.000Z");

    await sql`
      insert into source_map_artifacts
        (id, project_id, environment_id, release, minified_file, original_filename, content_type, byte_size, sha256, storage_path, uploaded_by_user_id, created_at)
      values
        ('smap_old_1', ${project.id}, ${environment.id}, 'old', 'a.js', 'a.js.map', 'application/json', 1, 'sha1', '/tmp/a.map', ${user.id}, ${old}),
        ('smap_old_2', ${project.id}, ${environment.id}, 'old', 'b.js', 'b.js.map', 'application/json', 1, 'sha2', '/tmp/b.map', ${user.id}, ${old}),
        ('smap_fresh', ${project.id}, ${environment.id}, 'fresh', 'c.js', 'c.js.map', 'application/json', 1, 'sha3', '/tmp/c.map', ${user.id}, ${fresh})
    `.execute(db);

    const expired = await listExpiredSourceMapArtifacts(db, {
      cutoff: new Date("2026-02-01T00:00:00.000Z"),
      batchSize: 1
    });

    expect(expired).toEqual([expect.objectContaining({ id: "smap_old_1", storagePath: "/tmp/a.map" })]);
  });
});

it("soft-deletes a retained source-map artifact and cached resolutions", async () => {
  await withTestDb(async (db) => {
    const project = await createProject(db, { name: "Source Map Delete Project" });
    const environment = await createEnvironment(db, { projectId: project.id, name: "Production" });
    const user = await createUser(db, {
      email: "sourcemaps-delete@example.com",
      passwordHash: "hash",
      isAdmin: true
    });

    await insertError(db, {
      id: "err_source_map_delete",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
      receivedAt: new Date("2026-01-01T00:00:01.000Z"),
      message: "Source map delete cache",
      severity: "error",
      release: "web@1"
    });

    await sql`
      insert into source_map_artifacts
        (id, project_id, environment_id, release, minified_file, original_filename, content_type, byte_size, sha256, storage_path, uploaded_by_user_id)
      values
        ('smap_delete_1', ${project.id}, ${environment.id}, 'web@1', 'app.js', 'app.js.map', 'application/json', 1, 'sha1', '/tmp/app.map', ${user.id})
    `.execute(db);
    await sql`
      insert into error_stack_resolutions
        (id, error_id, project_id, environment_id, release, source_map_artifact_id, frame_index, minified_file, minified_line, minified_column, original_source, original_line, original_column)
      values
        ('esr_delete_1', 'err_source_map_delete', ${project.id}, ${environment.id}, 'web@1', 'smap_delete_1', 0, 'app.js', 1, 1, 'src/app.ts', 1, 1)
    `.execute(db);

    const deleted = await softDeleteSourceMapArtifactForRetention(db, "smap_delete_1");

    expect(deleted).toEqual(expect.objectContaining({ id: "smap_delete_1" }));
    await expect(getCachedErrorStackResolution(db, "err_source_map_delete")).resolves.toEqual([]);
    const remaining = await listExpiredSourceMapArtifacts(db, { cutoff: new Date("2030-01-01T00:00:00.000Z"), batchSize: 10 });
    expect(remaining).toEqual([]);
  });
});
```

- [x] **Step 5: Run source-map repository tests to verify failure**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts -t "source-map artifact"
```

Expected: fails because `listExpiredSourceMapArtifacts` and `softDeleteSourceMapArtifactForRetention` do not exist.

- [x] **Step 6: Implement source-map repository helpers**

Modify imports/exports in `packages/db/src/repositories/source-maps.ts` as needed, then add:

```ts
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

export async function softDeleteSourceMapArtifactForRetention(
  db: SourceMapDb,
  id: string
): Promise<SourceMapArtifactRecord | null> {
  const deleted = await db
    .updateTable("source_map_artifacts")
    .set({ deleted_at: new Date() })
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  if (!deleted) return null;

  await db.deleteFrom("error_stack_resolutions").where("source_map_artifact_id", "=", deleted.id).execute();

  return toSourceMapArtifact(deleted);
}
```

This helper intentionally accepts `SourceMapDb` so the worker can call it inside the existing retention transaction.

- [x] **Step 7: Run DB tests and build**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts -t "retention"
pnpm exec vitest run packages/db/test/repositories.test.ts -t "source-map artifact"
pnpm --filter @signal-hub/db build
```

Expected: pass.

- [x] **Step 8: Commit**

```bash
git add packages/db/src/repositories/system.ts packages/db/src/repositories/source-maps.ts packages/db/test/repositories.test.ts
git commit -m "feat: add source map retention repository helpers"
```

## Task 3: Worker Source Map Retention Cleanup

**Files:**
- Create: `apps/worker/src/source-map-retention.ts`
- Modify: `apps/worker/src/retention.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/test/telemetry-worker.test.ts`

- [x] **Step 1: Write failing worker cleanup tests**

Add imports to `apps/worker/test/telemetry-worker.test.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deleteExpiredSourceMapArtifacts } from "../src/source-map-retention.js";
```

Add tests:

```ts
describe("deleteExpiredSourceMapArtifacts", () => {
  it("deletes expired source-map files before metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "signalhub-sourcemaps-"));
    const filePath = path.join(root, "artifact.map");
    await writeFile(filePath, "{}");
    const calls: string[] = [];

    const result = await deleteExpiredSourceMapArtifacts({
      localDir: root,
      now: new Date("2026-05-13T00:00:00.000Z"),
      retentionDays: 30,
      batchSize: 10,
      listExpiredArtifacts: async () => [
        {
          id: "smap_1",
          projectId: "prj_1",
          environmentId: "env_1",
          release: "web@1",
          minifiedFile: "app.js",
          originalFilename: "app.js.map",
          contentType: "application/json",
          byteSize: 2,
          sha256: "sha",
          storagePath: filePath,
          uploadedByUserId: "usr_1",
          uploadedByTokenId: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          deletedAt: null
        }
      ],
      softDeleteArtifact: async (id) => {
        calls.push(id);
        return {
          id,
          projectId: "prj_1",
          environmentId: "env_1",
          release: "web@1",
          minifiedFile: "app.js",
          originalFilename: "app.js.map",
          contentType: "application/json",
          byteSize: 2,
          sha256: "sha",
          storagePath: filePath,
          uploadedByUserId: "usr_1",
          uploadedByTokenId: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          deletedAt: new Date("2026-05-13T00:00:00.000Z")
        };
      }
    });

    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls).toEqual(["smap_1"]);
    expect(result).toEqual({ sourceMapArtifacts: 1, sourceMapFiles: 1 });
  });

  it("tolerates missing source-map files and still removes metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "signalhub-sourcemaps-"));
    const filePath = path.join(root, "missing.map");
    const deletedIds: string[] = [];

    const result = await deleteExpiredSourceMapArtifacts({
      localDir: root,
      now: new Date("2026-05-13T00:00:00.000Z"),
      retentionDays: 30,
      batchSize: 10,
      listExpiredArtifacts: async () => [
        {
          id: "smap_missing",
          projectId: "prj_1",
          environmentId: "env_1",
          release: "web@1",
          minifiedFile: "app.js",
          originalFilename: "app.js.map",
          contentType: "application/json",
          byteSize: 2,
          sha256: "sha",
          storagePath: filePath,
          uploadedByUserId: "usr_1",
          uploadedByTokenId: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          deletedAt: null
        }
      ],
      softDeleteArtifact: async (id) => {
        deletedIds.push(id);
        return {
          id,
          projectId: "prj_1",
          environmentId: "env_1",
          release: "web@1",
          minifiedFile: "app.js",
          originalFilename: "app.js.map",
          contentType: "application/json",
          byteSize: 2,
          sha256: "sha",
          storagePath: filePath,
          uploadedByUserId: "usr_1",
          uploadedByTokenId: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          deletedAt: new Date("2026-05-13T00:00:00.000Z")
        };
      }
    });

    expect(deletedIds).toEqual(["smap_missing"]);
    expect(result).toEqual({ sourceMapArtifacts: 1, sourceMapFiles: 1 });
  });

  it("rejects source-map paths outside the local directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "signalhub-sourcemaps-"));
    const outside = path.join(tmpdir(), "outside-source-map.map");
    await writeFile(outside, "{}");

    await expect(
      deleteExpiredSourceMapArtifacts({
        localDir: root,
        now: new Date("2026-05-13T00:00:00.000Z"),
        retentionDays: 30,
        batchSize: 10,
        listExpiredArtifacts: async () => [
          {
            id: "smap_outside",
            projectId: "prj_1",
            environmentId: "env_1",
            release: "web@1",
            minifiedFile: "app.js",
            originalFilename: "app.js.map",
            contentType: "application/json",
            byteSize: 2,
            sha256: "sha",
            storagePath: outside,
            uploadedByUserId: "usr_1",
            uploadedByTokenId: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            deletedAt: null
          }
        ],
        softDeleteArtifact: async () => {
          throw new Error("metadata should not be deleted");
        }
      })
    ).rejects.toThrow("source_map_storage_path_invalid");
  });
});
```

If `mkdtemp` and `tmpdir` are not already imported in the file, add:

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
```

- [x] **Step 2: Run worker cleanup tests to verify failure**

Run:

```bash
pnpm exec vitest run apps/worker/test/telemetry-worker.test.ts -t "deleteExpiredSourceMapArtifacts"
```

Expected: fails because `apps/worker/src/source-map-retention.ts` does not exist.

- [x] **Step 3: Implement worker source-map retention helper**

Create `apps/worker/src/source-map-retention.ts`:

```ts
import { lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";
import type { SourceMapArtifactRecord } from "@signal-hub/db/repositories/source-maps.js";

export type SourceMapRetentionDeletedCounts = {
  sourceMapArtifacts: number;
  sourceMapFiles: number;
};

type SourceMapRetentionRuntime = {
  localDir: string;
  now: Date;
  retentionDays: number;
  batchSize: number;
  listExpiredArtifacts: (input: { cutoff: Date; batchSize: number }) => Promise<SourceMapArtifactRecord[]>;
  softDeleteArtifact: (id: string) => Promise<SourceMapArtifactRecord | null>;
};

function assertInsideLocalDir(localDir: string, storagePath: string): void {
  const relativePath = path.relative(localDir, storagePath);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error("source_map_storage_path_invalid");
  }
}

async function resolveStoragePath(localDir: string, storagePath: string): Promise<string | null> {
  const resolvedLocalDir = await realpath(localDir);
  const resolvedStoragePath = path.resolve(storagePath);
  assertInsideLocalDir(resolvedLocalDir, resolvedStoragePath);

  try {
    const targetStats = await lstat(resolvedStoragePath);
    if (targetStats.isSymbolicLink()) {
      throw new Error("source_map_storage_path_invalid");
    }
    const realStoragePath = await realpath(resolvedStoragePath);
    assertInsideLocalDir(resolvedLocalDir, realStoragePath);
    return realStoragePath;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function deleteSourceMapFileIfPresent(localDir: string, storagePath: string): Promise<boolean> {
  const resolvedStoragePath = await resolveStoragePath(localDir, storagePath);
  if (!resolvedStoragePath) return true;
  await rm(resolvedStoragePath, { force: false });
  return true;
}

export async function deleteExpiredSourceMapArtifacts(
  runtime: SourceMapRetentionRuntime
): Promise<SourceMapRetentionDeletedCounts> {
  const cutoff = new Date(runtime.now.getTime() - runtime.retentionDays * 24 * 60 * 60 * 1000);
  const artifacts = await runtime.listExpiredArtifacts({ cutoff, batchSize: runtime.batchSize });
  let sourceMapArtifacts = 0;
  let sourceMapFiles = 0;

  for (const artifact of artifacts) {
    if (await deleteSourceMapFileIfPresent(runtime.localDir, artifact.storagePath)) {
      sourceMapFiles += 1;
    }
    const deleted = await runtime.softDeleteArtifact(artifact.id);
    if (deleted) sourceMapArtifacts += 1;
  }

  return { sourceMapArtifacts, sourceMapFiles };
}
```

- [x] **Step 4: Write failing retention runtime tests**

Update `apps/worker/test/telemetry-worker.test.ts` existing `runRetentionOnce` tests so `deleted` includes source-map counts and `policy` includes source-map policy. Add a focused test:

```ts
it("records source-map deletion counts during retention", async () => {
  const result = await runRetentionOnce({
    now: () => new Date("2026-05-13T12:00:00.000Z"),
    policy: {
      eventsDays: 90,
      errorsDays: 180,
      tracesDays: 90,
      spansDays: 90,
      llmCallsDays: 180,
      breadcrumbsDays: 30,
      sourceMapsEnabled: true,
      sourceMapsDays: 180,
      sourceMapsBatchSize: 100
    },
    withLock: async (run) => ({
      locked: true,
      result: await run({
        deleteExpiredTelemetry: async () => ({
          events: 0,
          errors: 0,
          traces: 0,
          spans: 0,
          llmCalls: 0,
          breadcrumbs: 0,
          sourceMapArtifacts: 0,
          sourceMapFiles: 0
        }),
        deleteExpiredSourceMapArtifacts: async () => ({ sourceMapArtifacts: 2, sourceMapFiles: 2 })
      })
    }),
    recordRetentionRun: async (input) => {
      expect(input.deleted.sourceMapArtifacts).toBe(2);
      expect(input.deleted.sourceMapFiles).toBe(2);
    }
  });

  expect(result).toEqual({ ran: true, skipped: false });
});

it("skips source-map cleanup when source-map retention is disabled", async () => {
  let sourceMapCleanupCalled = false;

  await runRetentionOnce({
    now: () => new Date("2026-05-13T12:00:00.000Z"),
    policy: {
      eventsDays: 90,
      errorsDays: 180,
      tracesDays: 90,
      spansDays: 90,
      llmCallsDays: 180,
      breadcrumbsDays: 30,
      sourceMapsEnabled: false,
      sourceMapsDays: 180,
      sourceMapsBatchSize: 100
    },
    withLock: async (run) => ({
      locked: true,
      result: await run({
        deleteExpiredTelemetry: async () => ({
          events: 0,
          errors: 0,
          traces: 0,
          spans: 0,
          llmCalls: 0,
          breadcrumbs: 0,
          sourceMapArtifacts: 0,
          sourceMapFiles: 0
        }),
        deleteExpiredSourceMapArtifacts: async () => {
          sourceMapCleanupCalled = true;
          return { sourceMapArtifacts: 1, sourceMapFiles: 1 };
        }
      })
    }),
    recordRetentionRun: async (input) => {
      expect(input.deleted.sourceMapArtifacts).toBe(0);
      expect(input.deleted.sourceMapFiles).toBe(0);
    }
  });

  expect(sourceMapCleanupCalled).toBe(false);
});
```

- [x] **Step 5: Run retention runtime test to verify failure**

Run:

```bash
pnpm exec vitest run apps/worker/test/telemetry-worker.test.ts -t "source-map deletion counts"
```

Expected: fails because `deleteExpiredSourceMapArtifacts` is not part of `RetentionLockedRuntime`.

- [x] **Step 6: Extend retention runtime**

Modify `apps/worker/src/retention.ts`.

Update `zeroDeleted`:

```ts
const zeroDeleted: RetentionDeletedCounts = {
  events: 0,
  errors: 0,
  traces: 0,
  spans: 0,
  llmCalls: 0,
  breadcrumbs: 0,
  sourceMapArtifacts: 0,
  sourceMapFiles: 0
};
```

Update `RetentionLockedRuntime`:

```ts
export type RetentionLockedRuntime = {
  deleteExpiredTelemetry: () => Promise<RetentionDeletedCounts>;
  deleteExpiredSourceMapArtifacts: () => Promise<Pick<RetentionDeletedCounts, "sourceMapArtifacts" | "sourceMapFiles">>;
};
```

Update the lock run body:

```ts
    result = await runtime.withLock(async (lockedRuntime) => {
      const telemetryDeleted = await lockedRuntime.deleteExpiredTelemetry();
      if (!runtime.policy.sourceMapsEnabled) {
        return telemetryDeleted;
      }
      const sourceMapsDeleted = await lockedRuntime.deleteExpiredSourceMapArtifacts();
      return { ...telemetryDeleted, ...sourceMapsDeleted };
    });
```

- [x] **Step 7: Wire worker main**

Modify imports in `apps/worker/src/main.ts`:

```ts
import {
  listExpiredSourceMapArtifacts,
  softDeleteSourceMapArtifactForRetention
} from "@signal-hub/db/repositories/source-maps.js";
import { deleteExpiredSourceMapArtifacts } from "./source-map-retention.js";
```

Extend `retentionPolicy`:

```ts
  sourceMapsEnabled: config.sourceMaps.retention.enabled,
  sourceMapsDays: config.sourceMaps.retention.days,
  sourceMapsBatchSize: config.sourceMaps.retention.batchSize
```

Add the locked runtime method:

```ts
                deleteExpiredSourceMapArtifacts: () =>
                  deleteExpiredSourceMapArtifacts({
                    localDir: config.sourceMaps.localDir,
                    now: new Date(),
                    retentionDays: config.sourceMaps.retention.days,
                    batchSize: config.sourceMaps.retention.batchSize,
                    listExpiredArtifacts: (input) => listExpiredSourceMapArtifacts(lockedDb, input),
                    softDeleteArtifact: (id) => softDeleteSourceMapArtifactForRetention(lockedDb, id)
                  })
```

- [x] **Step 8: Run worker tests and build**

Run:

```bash
pnpm exec vitest run apps/worker/test/telemetry-worker.test.ts
pnpm --filter @signal-hub/worker build
```

Expected: pass.

- [x] **Step 9: Commit**

```bash
git add apps/worker/src/source-map-retention.ts apps/worker/src/retention.ts apps/worker/src/main.ts apps/worker/test/telemetry-worker.test.ts
git commit -m "feat: add worker source map retention cleanup"
```

## Task 4: System Health and Console Retention Display

**Files:**
- Modify: `apps/api/src/routes/system.ts`
- Modify: `apps/api/src/system-health.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/test/system.test.ts`
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/components/SystemHealthPanel.tsx`
- Modify: `apps/console/src/components/SystemHealthPanel.test.tsx`

- [x] **Step 1: Write failing API system health test**

Modify the default fixture in `apps/api/test/system.test.ts` so retention policy and deleted counts include:

```ts
sourceMapArtifacts: 2,
sourceMapFiles: 2
```

and policy includes:

```ts
sourceMapsEnabled: true,
sourceMapsDays: 180,
sourceMapsBatchSize: 100
```

Add assertions to the successful snapshot test:

```ts
expect(snapshot.retention.policy.sourceMapsEnabled).toBe(true);
expect(snapshot.retention.policy.sourceMapsDays).toBe(180);
expect(snapshot.retention.policy.sourceMapsBatchSize).toBe(100);
expect(snapshot.retention.lastRun?.deleted.sourceMapArtifacts).toBe(2);
expect(snapshot.retention.lastRun?.deleted.sourceMapFiles).toBe(2);
```

- [x] **Step 2: Run system test to verify failure**

Run:

```bash
pnpm exec vitest run apps/api/test/system.test.ts -t "system health"
```

Expected: fails until API types and serialization include source-map retention fields.

- [x] **Step 3: Extend API system types and serialization**

Modify `apps/api/src/routes/system.ts` deleted/policy types:

```ts
deleted: {
  events: number;
  errors: number;
  traces: number;
  spans: number;
  llmCalls: number;
  breadcrumbs: number;
  sourceMapArtifacts: number;
  sourceMapFiles: number;
};
policy: {
  eventsDays: number;
  errorsDays: number;
  tracesDays: number;
  spansDays: number;
  llmCallsDays: number;
  breadcrumbsDays: number;
  sourceMapsEnabled: boolean;
  sourceMapsDays: number;
  sourceMapsBatchSize: number;
};
```

Modify `apps/api/src/system-health.ts` local `RetentionDeletedCounts` type similarly.

Modify `apps/api/src/main.ts` retention policy:

```ts
  sourceMapsEnabled: config.sourceMaps.retention.enabled,
  sourceMapsDays: config.sourceMaps.retention.days,
  sourceMapsBatchSize: config.sourceMaps.retention.batchSize
```

- [x] **Step 4: Write failing console System panel test**

In `apps/console/src/components/SystemHealthPanel.test.tsx`, extend the health fixture with source-map policy and counts, then add:

```tsx
expect(await screen.findByText(/source maps 180d/i)).toBeInTheDocument();
expect(screen.getByText(/source maps 2 artifacts, 2 files/i)).toBeInTheDocument();
```

- [x] **Step 5: Run console System panel test to verify failure**

Run:

```bash
pnpm exec vitest run apps/console/src/components/SystemHealthPanel.test.tsx
```

Expected: fails because the UI does not render source-map retention policy/counts.

- [x] **Step 6: Extend console types and UI**

Modify `apps/console/src/api/types.ts` `SystemHealthResponse.retention.lastRun.deleted`:

```ts
sourceMapArtifacts: number;
sourceMapFiles: number;
```

Modify `SystemHealthResponse.retention.policy`:

```ts
sourceMapsEnabled: boolean;
sourceMapsDays: number;
sourceMapsBatchSize: number;
```

Modify `retentionPolicyLabels` in `apps/console/src/components/SystemHealthPanel.tsx`:

```ts
const retentionPolicyLabels: Array<[keyof SystemHealthResponse["retention"]["policy"], string]> = [
  ["eventsDays", "events"],
  ["errorsDays", "errors"],
  ["tracesDays", "traces"],
  ["spansDays", "spans"],
  ["llmCallsDays", "LLM calls"],
  ["breadcrumbsDays", "breadcrumbs"],
  ["sourceMapsDays", "source maps"]
];
```

Update deleted rendering to include source maps:

```tsx
events {health.retention.lastRun.deleted.events}, errors {health.retention.lastRun.deleted.errors}, traces{" "}
{health.retention.lastRun.deleted.traces}, spans {health.retention.lastRun.deleted.spans}, LLM calls{" "}
{health.retention.lastRun.deleted.llmCalls}, breadcrumbs {health.retention.lastRun.deleted.breadcrumbs}, source maps{" "}
{health.retention.lastRun.deleted.sourceMapArtifacts} artifacts, {health.retention.lastRun.deleted.sourceMapFiles} files
```

If the policy line gets too crowded, keep the same `span` wrapping pattern; CSS already allows wrapping in `dd`.

- [x] **Step 7: Run API and console tests/builds**

Run:

```bash
pnpm exec vitest run apps/api/test/system.test.ts
pnpm exec vitest run apps/console/src/components/SystemHealthPanel.test.tsx
pnpm --filter @signal-hub/api build
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [x] **Step 8: Commit**

```bash
git add apps/api/src/routes/system.ts apps/api/src/system-health.ts apps/api/src/main.ts apps/api/test/system.test.ts apps/console/src/api/types.ts apps/console/src/components/SystemHealthPanel.tsx apps/console/src/components/SystemHealthPanel.test.tsx
git commit -m "feat: surface source map retention health"
```

## Task 5: Documentation and Memory

**Files:**
- Modify: `README.md`
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `.claude/docs/SECRETS.md`
- Modify: `.claude/docs/DEPLOYMENT.md`
- Modify: `.claude/docs/INFRASTRUCTURE.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `CLAUDE.md`
- Modify external memory: `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`

- [x] **Step 1: Update README**

In `README.md` Source Maps / Operational Safety sections, add:

```md
Source-map retention is worker-owned and local-storage-only. When `RETENTION_ENABLED=true` and `SOURCE_MAPS_RETENTION_ENABLED=true`, the worker deletes source-map artifacts older than `SOURCE_MAPS_RETENTION_DAYS` in batches of `SOURCE_MAPS_RETENTION_BATCH_SIZE`. Cleanup removes local files, artifact metadata, and cached stack resolutions.
```

- [x] **Step 2: Update secrets docs**

Add to `.claude/docs/SECRETS.md`:

```md
| `SOURCE_MAPS_RETENTION_ENABLED` | No | `true` | Non-secret operational config. Enables worker cleanup of old local source-map artifacts when telemetry retention is enabled. |
| `SOURCE_MAPS_RETENTION_DAYS` | No | `180` | Non-secret operational config. Retention window for source-map artifacts by upload time. |
| `SOURCE_MAPS_RETENTION_BATCH_SIZE` | No | `100` | Non-secret operational config. Maximum source-map artifacts cleaned per retention run. |
```

Add operational rule:

```md
- Source-map retention deletes local source-map files, artifact metadata, and cached stack resolutions. It does not configure object-storage lifecycle policies.
```

- [x] **Step 3: Update deployment and infrastructure docs**

Add to `.claude/docs/DEPLOYMENT.md` Source Maps or Retention section:

```md
Source-map artifact retention is local-first and worker-owned. Set `SOURCE_MAPS_RETENTION_ENABLED`, `SOURCE_MAPS_RETENTION_DAYS`, and `SOURCE_MAPS_RETENTION_BATCH_SIZE` to control cleanup. The scheduler runs with telemetry retention; setting `RETENTION_ENABLED=false` disables scheduled source-map cleanup too.
```

Add to `.claude/docs/INFRASTRUCTURE.md`:

```md
The worker prunes local source-map artifacts according to `SOURCE_MAPS_RETENTION_*`. Cleanup operates only under `SOURCE_MAPS_LOCAL_DIR`; object storage for source maps remains deferred.
```

- [x] **Step 4: Update architecture, project, UI, and CLAUDE docs**

Update `.claude/docs/ARCHITECTURE.md` retention section:

```md
The worker also prunes local source-map artifacts when source-map retention is enabled. Source-map cleanup shares the retention advisory lock and `retention_runs` reporting path, and removes local files, artifact metadata, and cached stack resolutions.
```

Update `.claude/docs/PROJECT-SUMMARY.md` current phase:

```md
Phase 5E: Source Map Retention.
```

Add implemented capability:

```md
- Worker-owned source-map artifact retention for local files, metadata, and cached stack resolutions.
```

Remove source-map retention scheduling from out-of-scope.

Update `.claude/docs/UI-UX.md`:

```md
- System should show source-map retention policy and deleted counts inside the existing Retention card.
```

Update `CLAUDE.md`:

```md
- Current phase: Phase 5E Source Map Retention.
- Keep source-map retention worker-owned, env-configured, and local-storage-only until object storage is explicitly designed.
```

- [x] **Step 5: Update memory**

Append to `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`:

```md
- Implemented Phase 5E Source Map Retention: worker-owned cleanup of local source-map artifacts, cached stack resolutions, and metadata through the existing retention scheduler and `retention_runs` status path. Retention is global/env-configured; source-map object storage and source-code viewer remain deferred.
```

- [x] **Step 6: Commit SignalHub docs**

```bash
git add README.md .claude/docs/ARCHITECTURE.md .claude/docs/PROJECT-SUMMARY.md .claude/docs/SECRETS.md .claude/docs/DEPLOYMENT.md .claude/docs/INFRASTRUCTURE.md .claude/docs/UI-UX.md CLAUDE.md
git commit -m "docs: document source map retention"
```

- [x] **Step 7: Commit memory**

```bash
cd /Users/diogo/Developer/Github/claude-config
git add projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
git commit -m "docs: update SignalHub phase 5E memory"
```

Preserve unrelated untracked memory directories.

## Task 6: Final Verification and Integration

**Files:**
- Modify: `docs/superpowers/plans/2026-05-13-phase5e-source-map-retention-implementation.md`

- [x] **Step 1: Run full tests**

```bash
pnpm test
```

Expected: all test files pass with no unhandled errors.

- [x] **Step 2: Run full build**

```bash
pnpm build
```

Expected: all workspace builds pass.

- [x] **Step 3: Run Compose config verification**

```bash
docker compose config --quiet
```

Expected: exit code 0.

- [x] **Step 4: Run doctor**

If `.env` exists:

```bash
pnpm run doctor
```

If this is an isolated worktree without `.env`, create a temporary safe env:

```bash
perl -0pe 's#^SIGNALHUB_PUBLIC_ENDPOINT=.*#SIGNALHUB_PUBLIC_ENDPOINT=#mg' .env.example > /tmp/signalhub-doctor.env
pnpm run doctor -- --env-file /tmp/signalhub-doctor.env
```

Expected: exit code 0. Source-map directory warnings are acceptable if no local directory exists in the worktree.

- [x] **Step 5: Mark plan complete**

Update this plan file so completed verification and integration checkboxes are checked.

- [x] **Step 6: Commit plan completion**

```bash
git add docs/superpowers/plans/2026-05-13-phase5e-source-map-retention-implementation.md
git commit -m "docs: complete source map retention plan"
```

- [ ] **Step 7: Merge and push**

From the main SignalHub checkout:

```bash
git fetch origin
git status -sb
git merge --no-ff feature/phase5e-source-map-retention -m "merge: phase 5e source map retention"
pnpm test
pnpm build
docker compose config --quiet
git push origin main
```

Push memory if Task 5 committed it:

```bash
cd /Users/diogo/Developer/Github/claude-config
git push origin main
```

Clean up the completed worktree and local feature branch only after push succeeds.
