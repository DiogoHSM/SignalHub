# Phase 5B Source Maps and Release Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local source-map artifact upload, metadata storage, on-demand stack resolution, and console support for resolving frontend production error frames.

**Architecture:** Source maps are admin-uploaded artifacts scoped to project, environment, and release. The API stores files in a configured local directory, stores metadata and cached frame resolutions in Postgres, and resolves raw error stacks on demand through a source-map parser. The console adds an admin `Artifacts` mode for upload/list/delete and a source-map resolution section in raw error details.

**Tech Stack:** TypeScript, Fastify, `@fastify/multipart`, Kysely, Postgres, React, Vitest, `@jridgewell/trace-mapping`, `fflate`, Docker Compose.

---

## Scope Check

This plan implements only `docs/superpowers/specs/2026-05-10-phase5b-source-maps-design.md`.

Included:

- local source-map artifact storage,
- Postgres artifact and cached resolution metadata,
- admin-session authenticated `.map` and `.zip` uploads,
- strict project/environment/release matching,
- on-demand raw error stack resolution,
- cache invalidation on artifact deletion,
- console Artifacts mode,
- raw error detail resolution display,
- docs and memory updates.

Excluded:

- object storage for source maps,
- source-map CLI or CI uploader,
- ingestion API changes,
- ingestion API key artifact uploads,
- source code viewer or `sourcesContent` display,
- source-map retention scheduler,
- indexed source maps,
- cross-release guessing.

## File Structure

Create:

- `packages/db/migrations/0006_source_maps.sql` - source-map artifact and cached resolution tables.
- `packages/db/src/repositories/source-maps.ts` - artifact metadata repository, cached resolution repository, and DB row mappers.
- `apps/api/src/source-maps/storage.ts` - local artifact filesystem helpers and safe path generation.
- `apps/api/src/source-maps/parser.ts` - source-map JSON validation, minified-file inference, ZIP extraction, and browser stack-frame parsing helpers.
- `apps/api/src/source-maps/resolver.ts` - on-demand resolution orchestration using `@jridgewell/trace-mapping`.
- `apps/console/src/components/ArtifactsPanel.tsx` - upload/list/delete UI for source-map artifacts.
- `apps/console/src/components/ErrorSourceMapResolution.tsx` - raw error detail resolution section.

Modify:

- `package.json` / `pnpm-lock.yaml` - add dependencies.
- `.env.example` - source-map local directory and upload size config.
- `docker-compose.yml` - mount source-map volume into API.
- `packages/config/src/index.ts` - parse source-map config.
- `scripts/doctor.ts` - check configured source-map directory existence without creating it.
- `packages/db/src/migrate.ts` - register `0006_source_maps.sql`.
- `packages/db/src/schema.ts` - add source-map tables.
- `packages/db/test/repositories.test.ts` - migration and repository tests.
- `apps/api/src/app.ts` - register multipart support and source-map dependencies.
- `apps/api/src/main.ts` - wire source-map repository/storage/resolver dependencies.
- `apps/api/src/routes/admin.ts` - source-map list/upload/delete routes.
- `apps/api/src/routes/query.ts` - raw error source-map resolution route.
- `apps/api/test/admin.test.ts` - admin upload/list/delete route coverage.
- `apps/api/test/query.test.ts` - resolution endpoint coverage.
- `apps/console/src/api/types.ts` - artifact and resolution API types.
- `apps/console/src/api/client.ts` - artifact and resolution client methods, multipart request helper.
- `apps/console/src/api/client.test.ts` - client URL/body tests.
- `apps/console/src/components/ConsoleModeTabs.tsx` - add `Artifacts` top-level mode.
- `apps/console/src/components/ConsoleModeTabs.test.tsx` - mode tab expectations.
- `apps/console/src/components/ConsoleShell.tsx` - render `ArtifactsPanel`.
- `apps/console/src/components/ConsoleShell.test.tsx` - lazy Artifacts mode coverage.
- `apps/console/src/components/ErrorDetailDrawer.tsx` - render source-map resolution section.
- `apps/console/src/components/ErrorDetailDrawer.test.tsx` - resolved/unresolved display tests.
- `apps/console/src/styles.css` - artifact and resolution styles.
- `.claude/docs/*`, `README.md` - docs from the spec.

Do not modify:

- public ingestion route payload schemas,
- SDK ingestion methods,
- worker ingestion flow,
- alert evaluator behavior,
- backup S3 configuration.

## Task 1: Dependencies, Config, Compose, and Doctor

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/test/config.test.ts`
- Modify: `scripts/doctor.ts`
- Modify: `scripts/doctor.test.ts`

- [x] **Step 1: Add source-map dependencies**

Run:

```bash
pnpm add -w @fastify/multipart @jridgewell/trace-mapping fflate
```

Expected: `package.json` gains the three dependencies and `pnpm-lock.yaml` updates.

- [x] **Step 2: Add failing config tests**

In `packages/config/test/config.test.ts`, add:

```ts
it("loads source map storage config with defaults", () => {
  const config = loadConfig(baseEnv());

  expect(config.sourceMaps).toEqual({
    localDir: "/var/lib/signalhub/source-maps",
    maxUploadMb: 50
  });
});

it("loads custom source map storage config", () => {
  const config = loadConfig({
    ...baseEnv(),
    SOURCE_MAPS_LOCAL_DIR: "/tmp/signalhub-source-maps",
    SOURCE_MAPS_MAX_UPLOAD_MB: "12"
  });

  expect(config.sourceMaps).toEqual({
    localDir: "/tmp/signalhub-source-maps",
    maxUploadMb: 12
  });
});
```

- [x] **Step 3: Run config tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/config test -- config.test.ts
```

Expected: fail because `config.sourceMaps` does not exist.

- [x] **Step 4: Implement source-map config**

In `packages/config/src/index.ts`, add to `rawConfigSchema`:

```ts
SOURCE_MAPS_LOCAL_DIR: z.preprocess(emptyStringToUndefined, z.string().min(1).default("/var/lib/signalhub/source-maps")),
SOURCE_MAPS_MAX_UPLOAD_MB: optionalPositiveInteger(50),
```

In the returned object, add:

```ts
sourceMaps: {
  localDir: parsed.SOURCE_MAPS_LOCAL_DIR,
  maxUploadMb: parsed.SOURCE_MAPS_MAX_UPLOAD_MB
},
```

- [x] **Step 5: Update `.env.example`**

Add:

```dotenv
SOURCE_MAPS_LOCAL_DIR=/var/lib/signalhub/source-maps
SOURCE_MAPS_MAX_UPLOAD_MB=50
```

- [x] **Step 6: Update Compose volume**

In `docker-compose.yml`, add an API volume:

```yaml
    volumes:
      - source_map_data:/var/lib/signalhub/source-maps
```

Add the named volume:

```yaml
  source_map_data:
```

Expected: only the API needs this volume in Phase 5B because uploads and resolution are API-owned.

- [x] **Step 7: Add failing doctor tests**

In `scripts/doctor.test.ts`, add this test in the `doctor orchestration` describe block:

Add:

```ts
it("warns when source map directory is missing", async () => {
  const envContent = Object.entries({ ...validEnv, SOURCE_MAPS_LOCAL_DIR: "/missing/source-maps" })
    .map(([key, value]) => `${key}=${value ?? ""}`)
    .join("\n");
  const results = await buildDoctorResults({
    options: { compose: false, envFile: ".env" },
    fileExists: (path) => path === ".env",
    readFile: () => envContent,
    runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    fetchHealth: async () => ({ ok: true, status: 200 })
  });

  expect(results).toContainEqual(expect.objectContaining({
    status: "warn",
    message: "SOURCE_MAPS_LOCAL_DIR is missing or not writable"
  }));
});
```

- [x] **Step 8: Implement doctor directory warning**

In `scripts/doctor.ts`, add non-secret env parsing awareness for `SOURCE_MAPS_LOCAL_DIR`. The check should:

- skip blank values,
- warn if the path does not exist,
- never create the directory.

Use this message:

```ts
createResult("warn", "SOURCE_MAPS_LOCAL_DIR is missing or not writable")
```

- [x] **Step 9: Run focused tests**

Run:

```bash
pnpm --filter @signal-hub/config test -- config.test.ts
pnpm exec vitest run scripts/doctor.test.ts
docker compose config --quiet
```

Expected: all pass.

- [x] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example docker-compose.yml packages/config/src/index.ts packages/config/test/config.test.ts scripts/doctor.ts scripts/doctor.test.ts
git commit -m "feat: add source map storage config"
```

## Task 2: Source Map Schema and Repository

**Files:**

- Create: `packages/db/migrations/0006_source_maps.sql`
- Create: `packages/db/src/repositories/source-maps.ts`
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/src/schema.ts`
- Test: `packages/db/test/repositories.test.ts`

- [x] **Step 1: Add failing migration and repository tests**

In `packages/db/test/repositories.test.ts`, import:

```ts
import {
  createSourceMapArtifact,
  deleteSourceMapArtifact,
  listSourceMapArtifacts,
  replaceErrorStackResolutions,
  getCachedErrorStackResolution
} from "../src/repositories/source-maps.js";
```

Add tests:

```ts
it("runs source map migrations", async () => {
  await withDb(async (db) => {
    await migrate(db);

    await sql`select id, release, minified_file from source_map_artifacts limit 0`.execute(db);
    await sql`select error_id, frame_index, original_source from error_stack_resolutions limit 0`.execute(db);
  });
});

it("creates lists and soft deletes source map artifacts", async () => {
  await withDb(async (db) => {
    await migrate(db);
    await seedProjectEnvironment(db);
    const user = await seedAdminUser(db);

    const artifact = await createSourceMapArtifact(db, {
      projectId: "prj_1",
      environmentId: "env_1",
      release: "web@1.0.0",
      minifiedFile: "app.min.js",
      originalFilename: "app.min.js.map",
      contentType: "application/json",
      byteSize: 128,
      sha256: "abc123",
      storagePath: "/tmp/app.min.js.map",
      uploadedByUserId: user.id
    });

    expect(artifact.id).toMatch(/^smap_/);
    await expect(
      createSourceMapArtifact(db, {
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.0",
        minifiedFile: "app.min.js",
        originalFilename: "dupe.map",
        contentType: "application/json",
        byteSize: 10,
        sha256: "def456",
        storagePath: "/tmp/dupe.map",
        uploadedByUserId: user.id
      })
    ).rejects.toThrow();

    expect(await listSourceMapArtifacts(db, { projectId: "prj_1", environmentId: "env_1" })).toHaveLength(1);

    await deleteSourceMapArtifact(db, {
      id: artifact.id,
      projectId: "prj_1",
      environmentId: "env_1"
    });

    expect(await listSourceMapArtifacts(db, { projectId: "prj_1", environmentId: "env_1" })).toEqual([]);
  });
});

it("stores cached stack resolutions and clears them when an artifact is deleted", async () => {
  await withDb(async (db) => {
    await migrate(db);
    await seedProjectEnvironment(db);
    const user = await seedAdminUser(db);
    const artifact = await createSourceMapArtifact(db, {
      projectId: "prj_1",
      environmentId: "env_1",
      release: "web@1.0.0",
      minifiedFile: "app.min.js",
      originalFilename: "app.min.js.map",
      contentType: "application/json",
      byteSize: 128,
      sha256: "abc123",
      storagePath: "/tmp/app.min.js.map",
      uploadedByUserId: user.id
    });
    await insertErrorForTest(db, { id: "err_1", projectId: "prj_1", environmentId: "env_1", release: "web@1.0.0" });

    await replaceErrorStackResolutions(db, {
      errorId: "err_1",
      projectId: "prj_1",
      environmentId: "env_1",
      release: "web@1.0.0",
      frames: [{
        sourceMapArtifactId: artifact.id,
        frameIndex: 0,
        minifiedFile: "app.min.js",
        minifiedLine: 1,
        minifiedColumn: 42,
        originalSource: "src/app.ts",
        originalLine: 10,
        originalColumn: 3,
        originalName: "checkout"
      }]
    });

    expect(await getCachedErrorStackResolution(db, "err_1")).toHaveLength(1);
    await deleteSourceMapArtifact(db, { id: artifact.id, projectId: "prj_1", environmentId: "env_1" });
    expect(await getCachedErrorStackResolution(db, "err_1")).toEqual([]);
  });
});
```

Add these local helpers near `decodeUserCursorForTest` in `packages/db/test/repositories.test.ts`:

```ts
async function seedSourceMapScope(db: Db): Promise<void> {
  await sql`insert into projects (id, name) values ('prj_1', 'Source Map Project') on conflict (id) do nothing`.execute(db);
  await sql`
    insert into environments (id, project_id, name)
    values ('env_1', 'prj_1', 'Production')
    on conflict (id) do nothing
  `.execute(db);
}

async function seedSourceMapUser(db: Db): Promise<{ id: string }> {
  await sql`
    insert into users (id, email, password_hash, is_admin)
    values ('usr_source_maps', 'source-maps@example.com', 'hash', true)
    on conflict (id) do nothing
  `.execute(db);
  return { id: "usr_source_maps" };
}

async function insertSourceMapError(db: Db, input: { id: string; projectId: string; environmentId: string; release: string }): Promise<void> {
  await sql`
    insert into errors (
      id,
      project_id,
      environment_id,
      timestamp,
      received_at,
      message,
      severity,
      release,
      stack
    )
    values (
      ${input.id},
      ${input.projectId},
      ${input.environmentId},
      '2026-05-10T12:00:00.000Z',
      '2026-05-10T12:00:01.000Z',
      'Source mapped error',
      'error',
      ${input.release},
      'TypeError: failed'
    )
  `.execute(db);
}
```

Use these helper calls in the tests:

```ts
await seedSourceMapScope(db);
const user = await seedSourceMapUser(db);
await insertSourceMapError(db, { id: "err_1", projectId: "prj_1", environmentId: "env_1", release: "web@1.0.0" });
```

- [x] **Step 2: Run DB tests and verify failure**

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: fail because migration and repository do not exist.

- [x] **Step 3: Add migration**

Create `packages/db/migrations/0006_source_maps.sql`:

```sql
CREATE TABLE source_map_artifacts (
  id text PRIMARY KEY DEFAULT ('smap_' || encode(gen_random_bytes(12), 'hex')),
  project_id text NOT NULL,
  environment_id text NOT NULL,
  release text NOT NULL,
  minified_file text NOT NULL,
  original_filename text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  storage_path text NOT NULL,
  uploaded_by_user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id),
  CONSTRAINT source_map_artifacts_byte_size_check CHECK (byte_size > 0)
);

CREATE UNIQUE INDEX source_map_artifacts_active_unique_idx
  ON source_map_artifacts(project_id, environment_id, release, minified_file)
  WHERE deleted_at IS NULL;

CREATE INDEX source_map_artifacts_scope_release_idx
  ON source_map_artifacts(project_id, environment_id, release, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE error_stack_resolutions (
  id text PRIMARY KEY DEFAULT ('esr_' || encode(gen_random_bytes(12), 'hex')),
  error_id text NOT NULL REFERENCES errors(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  release text NOT NULL,
  source_map_artifact_id text NOT NULL REFERENCES source_map_artifacts(id),
  frame_index integer NOT NULL,
  minified_file text NOT NULL,
  minified_line integer NOT NULL,
  minified_column integer NOT NULL,
  original_source text NOT NULL,
  original_line integer NOT NULL,
  original_column integer NOT NULL,
  original_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id),
  CONSTRAINT error_stack_resolutions_frame_index_check CHECK (frame_index >= 0),
  CONSTRAINT error_stack_resolutions_minified_line_check CHECK (minified_line > 0),
  CONSTRAINT error_stack_resolutions_minified_column_check CHECK (minified_column >= 0),
  CONSTRAINT error_stack_resolutions_original_line_check CHECK (original_line > 0),
  CONSTRAINT error_stack_resolutions_original_column_check CHECK (original_column >= 0)
);

CREATE UNIQUE INDEX error_stack_resolutions_error_frame_idx
  ON error_stack_resolutions(error_id, frame_index);

CREATE INDEX error_stack_resolutions_artifact_idx
  ON error_stack_resolutions(source_map_artifact_id);
```

- [x] **Step 4: Register migration and schema**

In `packages/db/src/migrate.ts`, append:

```ts
{ name: "0006_source_maps.sql", url: new URL("../migrations/0006_source_maps.sql", import.meta.url) }
```

In `packages/db/src/schema.ts`, add table types matching the migration and add:

```ts
source_map_artifacts: SourceMapArtifactsTable;
error_stack_resolutions: ErrorStackResolutionsTable;
```

- [x] **Step 5: Implement repository**

Create `packages/db/src/repositories/source-maps.ts` with:

```ts
import type { Db } from "../db.js";

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
  uploadedByUserId: string;
  createdAt: Date;
  deletedAt: Date | null;
};

export type CreateSourceMapArtifactInput = Omit<SourceMapArtifactRecord, "id" | "createdAt" | "deletedAt">;
export type SourceMapArtifactScope = { projectId: string; environmentId: string; release?: string };
export type DeleteSourceMapArtifactInput = { id: string; projectId: string; environmentId: string };

export type ErrorStackResolutionFrame = {
  sourceMapArtifactId: string;
  frameIndex: number;
  minifiedFile: string;
  minifiedLine: number;
  minifiedColumn: number;
  originalSource: string;
  originalLine: number;
  originalColumn: number;
  originalName: string | null;
};

export type CachedErrorStackResolutionFrame = ErrorStackResolutionFrame & {
  id: string;
  errorId: string;
  projectId: string;
  environmentId: string;
  release: string;
  createdAt: Date;
};
```

Implement:

- `listSourceMapArtifacts(db, scope)`
- `getSourceMapArtifact(db, input)`
- `findSourceMapArtifactForFrame(db, input)`
- `createSourceMapArtifact(db, input)`
- `deleteSourceMapArtifact(db, input)`
- `getCachedErrorStackResolution(db, errorId)`
- `replaceErrorStackResolutions(db, input)`

Repository delete must run in a transaction:

1. fetch active artifact by id/scope,
2. delete `error_stack_resolutions` by `source_map_artifact_id`,
3. set `deleted_at = now()`,
4. return artifact metadata including `storagePath`.

- [x] **Step 6: Run DB tests**

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
pnpm --filter @signal-hub/db build
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add packages/db/migrations/0006_source_maps.sql packages/db/src/migrate.ts packages/db/src/schema.ts packages/db/src/repositories/source-maps.ts packages/db/test/repositories.test.ts
git commit -m "feat: add source map metadata storage"
```

## Task 3: Local Storage, ZIP Parsing, Stack Parsing, and Resolver

**Files:**

- Create: `apps/api/src/source-maps/storage.ts`
- Create: `apps/api/src/source-maps/parser.ts`
- Create: `apps/api/src/source-maps/resolver.ts`
- Test: `apps/api/test/query.test.ts`

- [x] **Step 1: Add failing parser and resolver tests**

In `apps/api/test/query.test.ts`, add imports for the helpers that this task creates:

Add tests near query helper tests:

```ts
it("parses browser stack frames for source map resolution", () => {
  expect(parseStackFrames([
    "TypeError: failed",
    "    at checkout (https://cdn.example.com/assets/app.abc123.js:10:1234)",
    "    at https://cdn.example.com/assets/vendor.js:2:45",
    "render@https://cdn.example.com/assets/chunk.js:3:9"
  ].join("\n"))).toEqual([
    { frameIndex: 0, functionName: "checkout", minifiedFile: "app.abc123.js", minifiedLine: 10, minifiedColumn: 1234 },
    { frameIndex: 1, functionName: null, minifiedFile: "vendor.js", minifiedLine: 2, minifiedColumn: 45 },
    { frameIndex: 2, functionName: "render", minifiedFile: "chunk.js", minifiedLine: 3, minifiedColumn: 9 }
  ]);
});

it("infers minified file from a source map file property", () => {
  expect(inferMinifiedFileFromMap({ version: 3, file: "assets/app.abc123.js", sources: [], names: [], mappings: "" })).toBe(
    "app.abc123.js"
  );
});

it("resolves a generated frame with a regular source map", async () => {
  const map = {
    version: 3,
    file: "app.min.js",
    sources: ["src/app.ts"],
    names: ["checkout"],
    mappings: "KAyCIA"
  };

  expect(resolveFrameWithSourceMap(JSON.stringify(map), {
    frameIndex: 0,
    functionName: "checkout",
    minifiedFile: "app.min.js",
    minifiedLine: 1,
    minifiedColumn: 5
  })).toEqual({
    frameIndex: 0,
    minifiedFile: "app.min.js",
    minifiedLine: 1,
    minifiedColumn: 5,
    originalSource: "src/app.ts",
    originalLine: 42,
    originalColumn: 4,
    originalName: "checkout"
  });
});
```

- [x] **Step 2: Run tests and verify failure**

```bash
pnpm exec vitest run apps/api/test/query.test.ts
```

Expected: fail because helper modules do not exist.

- [x] **Step 3: Implement local storage helpers**

Create `apps/api/src/source-maps/storage.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type StoredArtifact = {
  storagePath: string;
  byteSize: number;
  sha256: string;
};

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "unknown";
}

export async function storeSourceMapFile(input: {
  localDir: string;
  projectId: string;
  environmentId: string;
  release: string;
  artifactId: string;
  content: Buffer;
}): Promise<StoredArtifact> {
  const directory = path.join(input.localDir, safeSegment(input.projectId), safeSegment(input.environmentId), safeSegment(input.release));
  await mkdir(directory, { recursive: true });
  const storagePath = path.join(directory, `${safeSegment(input.artifactId)}.map`);
  await writeFile(storagePath, input.content, { flag: "wx" });
  return {
    storagePath,
    byteSize: input.content.byteLength,
    sha256: createHash("sha256").update(input.content).digest("hex")
  };
}

export async function readSourceMapFile(storagePath: string): Promise<string> {
  return readFile(storagePath, "utf8");
}

export async function deleteSourceMapFile(storagePath: string): Promise<void> {
  await rm(storagePath, { force: false });
}
```

- [x] **Step 4: Implement parser helpers**

Create `apps/api/src/source-maps/parser.ts`:

```ts
import { unzipSync } from "fflate";
import path from "node:path";

export type ParsedStackFrame = {
  frameIndex: number;
  functionName: string | null;
  minifiedFile: string;
  minifiedLine: number;
  minifiedColumn: number;
};

export type SourceMapJson = {
  version: number;
  file?: string;
  sources: string[];
  names: string[];
  mappings: string;
  sourcesContent?: string[];
  sections?: unknown;
};

export function parseSourceMapJson(content: string): SourceMapJson {
  const parsed = JSON.parse(content) as Partial<SourceMapJson>;
  if (parsed.version !== 3 || typeof parsed.mappings !== "string" || !Array.isArray(parsed.sources) || !Array.isArray(parsed.names)) {
    throw new Error("invalid_source_map");
  }
  if (parsed.sections) {
    throw new Error("indexed_source_maps_unsupported");
  }
  return parsed as SourceMapJson;
}

export function normalizeMinifiedFile(value: string): string {
  try {
    const url = new URL(value);
    return path.posix.basename(url.pathname);
  } catch {
    return path.posix.basename(value.replace(/\\/g, "/"));
  }
}

export function inferMinifiedFileFromMap(map: SourceMapJson): string | undefined {
  return map.file ? normalizeMinifiedFile(map.file) : undefined;
}

export function extractSourceMapsFromZip(content: Buffer): Array<{ originalFilename: string; content: Buffer; minifiedFile: string }> {
  const entries = unzipSync(new Uint8Array(content));
  const maps: Array<{ originalFilename: string; content: Buffer; minifiedFile: string }> = [];
  for (const [entryName, entryContent] of Object.entries(entries)) {
    if (!entryName.endsWith(".map")) continue;
    const originalFilename = normalizeMinifiedFile(entryName);
    const buffer = Buffer.from(entryContent);
    const map = parseSourceMapJson(buffer.toString("utf8"));
    const minifiedFile = inferMinifiedFileFromMap(map);
    if (!minifiedFile) throw new Error("source_map_file_missing");
    maps.push({ originalFilename, content: buffer, minifiedFile });
  }
  if (maps.length === 0) throw new Error("source_map_zip_empty");
  if (maps.length > 100) throw new Error("source_map_zip_too_many_entries");
  return maps;
}

export function parseStackFrames(stack: string): ParsedStackFrame[] {
  const frames: ParsedStackFrame[] = [];
  const lines = stack.split(/\r?\n/);
  for (const line of lines) {
    const chrome = line.match(/^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/);
    const firefox = line.match(/^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/);
    const match = chrome ?? firefox;
    if (!match) continue;
    const functionName = match[1]?.trim() || null;
    frames.push({
      frameIndex: frames.length,
      functionName,
      minifiedFile: normalizeMinifiedFile(match[2]),
      minifiedLine: Number(match[3]),
      minifiedColumn: Number(match[4])
    });
  }
  return frames;
}
```

- [x] **Step 5: Implement resolver helpers**

Create `apps/api/src/source-maps/resolver.ts`:

```ts
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import type { ParsedStackFrame } from "./parser.js";
import { parseSourceMapJson } from "./parser.js";

export type ResolvedStackFrame = {
  frameIndex: number;
  minifiedFile: string;
  minifiedLine: number;
  minifiedColumn: number;
  originalSource: string;
  originalLine: number;
  originalColumn: number;
  originalName: string | null;
};

export function resolveFrameWithSourceMap(sourceMapContent: string, frame: ParsedStackFrame): ResolvedStackFrame | undefined {
  const map = parseSourceMapJson(sourceMapContent);
  const traced = originalPositionFor(new TraceMap(map), {
    line: frame.minifiedLine,
    column: frame.minifiedColumn
  });

  if (!traced.source || traced.line === null || traced.column === null) return undefined;

  return {
    frameIndex: frame.frameIndex,
    minifiedFile: frame.minifiedFile,
    minifiedLine: frame.minifiedLine,
    minifiedColumn: frame.minifiedColumn,
    originalSource: traced.source,
    originalLine: traced.line,
    originalColumn: traced.column,
    originalName: traced.name ?? frame.functionName
  };
}
```

In a later task this module will also expose the DB-backed orchestration function.

- [x] **Step 6: Run focused tests**

```bash
pnpm exec vitest run apps/api/test/query.test.ts
pnpm --filter @signal-hub/api build
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add apps/api/src/source-maps/storage.ts apps/api/src/source-maps/parser.ts apps/api/src/source-maps/resolver.ts apps/api/test/query.test.ts
git commit -m "feat: add source map parsing helpers"
```

## Task 4: Admin Source Map API

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/test/admin.test.ts`

- [x] **Step 1: Add failing admin route tests**

In `apps/api/test/admin.test.ts`, extend the test dependency factory with a `sourceMaps` dependency object.

Add tests:

```ts
it("lists source map artifacts for admins", async () => {
  const app = await buildTestApp({
    sourceMaps: {
      list: vi.fn().mockResolvedValue([{ id: "smap_1", projectId: "prj_1", environmentId: "env_1", release: "web@1.0.0", minifiedFile: "app.min.js", originalFilename: "app.min.js.map", byteSize: 123, sha256: "abc", createdAt: new Date("2026-05-10T12:00:00.000Z"), uploadedByUserId: "usr_1" }])
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/admin/source-maps?project_id=prj_1&environment_id=env_1",
    cookies: adminCookies()
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ artifacts: [expect.objectContaining({ id: "smap_1", release: "web@1.0.0" })] });
});

it("rejects source map uploads for non-admin users", async () => {
  const app = await buildTestApp();
  const response = await app.inject({
    method: "POST",
    url: "/admin/source-maps",
    cookies: userCookies(),
    payload: {}
  });

  expect(response.statusCode).toBe(403);
});

it("deletes source map artifacts for admins", async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  const app = await buildTestApp({ sourceMaps: { remove } });

  const response = await app.inject({
    method: "DELETE",
    url: "/admin/source-maps/smap_1?project_id=prj_1&environment_id=env_1",
    cookies: adminCookies()
  });

  expect(response.statusCode).toBe(204);
  expect(remove).toHaveBeenCalledWith({ id: "smap_1", projectId: "prj_1", environmentId: "env_1" });
});
```

Add multipart upload coverage using `FormData`:

```ts
it("uploads a single source map for admins", async () => {
  const uploadMap = vi.fn().mockResolvedValue([{ id: "smap_1", release: "web@1.0.0", minifiedFile: "app.min.js" }]);
  const app = await buildTestApp({ sourceMaps: { uploadMap } });
  const form = new FormData();
  form.set("project_id", "prj_1");
  form.set("environment_id", "env_1");
  form.set("release", "web@1.0.0");
  form.set("minified_file", "app.min.js");
  form.set("file", new File(['{"version":3,"file":"app.min.js","sources":[],"names":[],"mappings":""}'], "app.min.js.map", { type: "application/json" }));

  const response = await app.inject({
    method: "POST",
    url: "/admin/source-maps",
    cookies: adminCookies(),
    payload: form
  });

  expect(response.statusCode).toBe(200);
  expect(uploadMap).toHaveBeenCalledWith(expect.objectContaining({
    projectId: "prj_1",
    environmentId: "env_1",
    release: "web@1.0.0",
    minifiedFile: "app.min.js"
  }));
});
```

- [x] **Step 2: Run admin tests and verify failure**

```bash
pnpm exec vitest run apps/api/test/admin.test.ts
```

Expected: fail because source-map admin dependencies and routes do not exist.

- [x] **Step 3: Register multipart**

In `apps/api/src/app.ts`, import and register:

```ts
import multipart from "@fastify/multipart";
```

After cookie registration:

```ts
await app.register(multipart, {
  limits: {
    fileSize: (options.sourceMaps?.maxUploadBytes ?? 50 * 1024 * 1024)
  }
});
```

Extend `BuildAppOptions`:

```ts
sourceMaps?: SourceMapRouteDependencies & { maxUploadBytes?: number };
```

- [x] **Step 4: Add admin dependency types and routes**

In `apps/api/src/routes/admin.ts`, add:

```ts
export type SourceMapAdministrationDependencies = {
  list?: (filters: { projectId: string; environmentId: string; release?: string }) => Promise<unknown[]>;
  uploadMap?: (input: SourceMapUploadInput) => Promise<unknown[]>;
  uploadBundle?: (input: SourceMapBundleUploadInput) => Promise<unknown[]>;
  remove?: (input: { id: string; projectId: string; environmentId: string }) => Promise<void>;
};
```

Extend `AdminRouteOptions` with `sourceMaps?: SourceMapAdministrationDependencies`.

Routes:

- `GET /admin/source-maps` parses `project_id`, `environment_id`, optional `release`; requires admin.
- `POST /admin/source-maps` parses multipart fields. If field `file` exists, call `uploadMap`; if field `bundle` exists, call `uploadBundle`.
- `DELETE /admin/source-maps/:id` parses `project_id`, `environment_id`; requires admin; calls `remove`.

Use existing auth helpers in `admin.ts` for admin checks and error responses. Return:

```ts
{ artifacts: uploadedArtifacts }
```

for upload/list, and 204 for delete.

- [x] **Step 5: Wire real dependencies in `main.ts`**

In `apps/api/src/main.ts`, import repository/storage/parser helpers and wire:

```ts
sourceMaps: {
  list: (filters) => listSourceMapArtifacts(db, filters),
  uploadMap: (input) => uploadSingleSourceMap({ db, localDir: config.sourceMaps.localDir, input }),
  uploadBundle: (input) => uploadSourceMapBundle({ db, localDir: config.sourceMaps.localDir, input }),
  remove: (input) => deleteSourceMapArtifactAndFile({ db, input })
},
maxUploadBytes: config.sourceMaps.maxUploadMb * 1024 * 1024
```

Implement `uploadSingleSourceMap`, `uploadSourceMapBundle`, and `deleteSourceMapArtifactAndFile` in `apps/api/src/source-maps/storage.ts`.

- [x] **Step 6: Run admin tests**

```bash
pnpm exec vitest run apps/api/test/admin.test.ts
pnpm --filter @signal-hub/api build
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/main.ts apps/api/src/routes/admin.ts apps/api/src/source-maps apps/api/test/admin.test.ts
git commit -m "feat: add source map admin api"
```

## Task 5: Source Map Resolution Query API

**Files:**

- Modify: `packages/db/src/repositories/telemetry-query.ts`
- Modify: `apps/api/src/source-maps/resolver.ts`
- Modify: `apps/api/src/routes/query.ts`
- Modify: `apps/api/src/main.ts`
- Test: `apps/api/test/query.test.ts`

- [x] **Step 1: Add failing query route tests**

In `apps/api/test/query.test.ts`, add:

```ts
it("returns unresolved source map status when an error has no release", async () => {
  const app = await buildQueryTestApp({
    query: {
      getErrorForSourceMapResolution: vi.fn().mockResolvedValue({
        id: "err_1",
        projectId: "prj_1",
        environmentId: "env_1",
        release: null,
        stack: "TypeError: failed"
      })
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/query/errors/err_1/source-map-resolution?project_id=prj_1&environment_id=env_1",
    cookies: userCookies()
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    data: {
      errorId: "err_1",
      release: null,
      status: "unresolved",
      frames: [],
      unresolvedFrameCount: 0
    }
  });
});

it("returns cached resolved source map frames", async () => {
  const resolveErrorStack = vi.fn().mockResolvedValue({
    errorId: "err_1",
    release: "web@1.0.0",
    status: "resolved",
    frames: [{
      frameIndex: 0,
      minifiedFile: "app.min.js",
      minifiedLine: 1,
      minifiedColumn: 5,
      originalSource: "src/app.ts",
      originalLine: 42,
      originalColumn: 4,
      originalName: "checkout",
      sourceMapArtifactId: "smap_1"
    }],
    unresolvedFrameCount: 0
  });
  const app = await buildQueryTestApp({ query: { resolveErrorStack } });

  const response = await app.inject({
    method: "GET",
    url: "/query/errors/err_1/source-map-resolution?project_id=prj_1&environment_id=env_1",
    cookies: userCookies()
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ data: expect.objectContaining({ status: "resolved" }) });
  expect(resolveErrorStack).toHaveBeenCalledWith({ errorId: "err_1", projectId: "prj_1", environmentId: "env_1" });
});
```

- [x] **Step 2: Run query tests and verify failure**

```bash
pnpm exec vitest run apps/api/test/query.test.ts
```

Expected: fail because route/dependency does not exist.

- [x] **Step 3: Add raw error lookup for resolution**

In `packages/db/src/repositories/telemetry-query.ts`, add:

```ts
export type ErrorForSourceMapResolution = {
  id: string;
  projectId: string;
  environmentId: string;
  release: string | null;
  stack: string | null;
};

export async function getErrorForSourceMapResolution(
  db: Db,
  input: { id: string; projectId: string; environmentId: string }
): Promise<ErrorForSourceMapResolution | null> {
  const row = await db
    .selectFrom("errors")
    .select(["id", "project_id", "environment_id", "release", "stack"])
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .executeTakeFirst();

  return row
    ? { id: row.id, projectId: row.project_id, environmentId: row.environment_id, release: row.release, stack: row.stack }
    : null;
}
```

- [x] **Step 4: Implement DB-backed resolver orchestration**

In `apps/api/src/source-maps/resolver.ts`, add:

```ts
export type ResolveErrorStackInput = { errorId: string; projectId: string; environmentId: string };
export type SourceMapResolutionStatus = "resolved" | "partially_resolved" | "unresolved" | "unavailable";
export type SourceMapResolutionResponse = {
  errorId: string;
  release: string | null;
  status: SourceMapResolutionStatus;
  frames: Array<ResolvedStackFrame & { sourceMapArtifactId: string }>;
  unresolvedFrameCount: number;
};
```

Implement `resolveErrorStack(input)` using injected dependencies:

1. fetch raw error by id/scope,
2. return `null` if not found,
3. return unresolved if no release or stack,
4. return cached frames if present,
5. parse frames,
6. find artifact for each frame by project/environment/release/minified file,
7. read map content,
8. call `resolveFrameWithSourceMap`,
9. cache resolved frames with `replaceErrorStackResolutions`,
10. return `resolved`, `partially_resolved`, or `unresolved`.

- [x] **Step 5: Add query route**

In `apps/api/src/routes/query.ts`, extend `QueryDependencies`:

```ts
resolveErrorStack?: (input: { errorId: string; projectId: string; environmentId: string }) => Promise<unknown | null>;
```

Add params schema:

```ts
const errorParamsSchema = z.object({ id: z.string().trim().min(1) });
```

Register:

```ts
app.get("/query/errors/:id/source-map-resolution", (request, reply) =>
  handleErrorSourceMapResolutionRoute(request, reply, options)
);
```

The handler must:

- require auth like other query routes,
- parse `project_id` and `environment_id`,
- call `resolveErrorStack`,
- return 404 if dependency returns `null`,
- return `{ data }` on success.

- [x] **Step 6: Wire `main.ts`**

Wire `resolveErrorStack` using DB repositories and local storage:

```ts
resolveErrorStack: (input) =>
  resolveErrorStack({
    ...input,
    db,
    getError: (filters) => getErrorForSourceMapResolution(db, filters),
    getCached: (errorId) => getCachedErrorStackResolution(db, errorId),
    findArtifact: (filters) => findSourceMapArtifactForFrame(db, filters),
    readArtifact: readSourceMapFile,
    replaceCache: (cacheInput) => replaceErrorStackResolutions(db, cacheInput)
  })
```

- [x] **Step 7: Run API tests**

```bash
pnpm exec vitest run apps/api/test/query.test.ts apps/api/test/admin.test.ts
pnpm --filter @signal-hub/api build
```

Expected: pass.

- [x] **Step 8: Commit**

```bash
git add packages/db/src/repositories/telemetry-query.ts apps/api/src/source-maps/resolver.ts apps/api/src/routes/query.ts apps/api/src/main.ts apps/api/test/query.test.ts
git commit -m "feat: resolve error stacks with source maps"
```

## Task 6: Console API Client

**Files:**

- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Modify: `apps/console/src/api/client.test.ts`

- [x] **Step 1: Add failing client tests**

In `apps/console/src/api/client.test.ts`, add:

```ts
it("lists source map artifacts with scoped filters", async () => {
  const fetch = vi.fn().mockResolvedValue(jsonResponse({ artifacts: [] }));
  global.fetch = fetch;

  await createApiClient("/api").listSourceMapArtifacts({
    projectId: "prj/1",
    environmentId: "env 1",
    release: "web@1.0.0"
  });

  expect(fetch).toHaveBeenCalledWith(
    "/api/admin/source-maps?project_id=prj%2F1&environment_id=env+1&release=web%401.0.0",
    expect.objectContaining({ method: "GET", credentials: "include" })
  );
});

it("requests source map resolution for an error", async () => {
  const fetch = vi.fn().mockResolvedValue(jsonResponse({ data: { errorId: "err_1", release: "web@1.0.0", status: "unresolved", frames: [], unresolvedFrameCount: 0 } }));
  global.fetch = fetch;

  await createApiClient("/api").getErrorSourceMapResolution("err/1", {
    projectId: "prj/1",
    environmentId: "env 1"
  });

  expect(fetch).toHaveBeenCalledWith(
    "/api/query/errors/err%2F1/source-map-resolution?project_id=prj%2F1&environment_id=env+1",
    expect.objectContaining({ method: "GET", credentials: "include" })
  );
});

it("uploads source map files with multipart form data", async () => {
  const fetch = vi.fn().mockResolvedValue(jsonResponse({ artifacts: [] }));
  global.fetch = fetch;
  const file = new File(["{}"], "app.min.js.map", { type: "application/json" });

  await createApiClient("/api").uploadSourceMap({
    projectId: "prj_1",
    environmentId: "env_1",
    release: "web@1.0.0",
    minifiedFile: "app.min.js",
    file
  });

  const [, options] = fetch.mock.calls[0];
  expect(fetch.mock.calls[0][0]).toBe("/api/admin/source-maps");
  expect(options.method).toBe("POST");
  expect(options.body).toBeInstanceOf(FormData);
  expect(options.headers).toEqual({ Accept: "application/json" });
});
```

- [x] **Step 2: Run client tests and verify failure**

```bash
pnpm exec vitest run apps/console/src/api/client.test.ts
```

Expected: fail because client methods/types do not exist.

- [x] **Step 3: Add console types**

In `apps/console/src/api/types.ts`, add:

```ts
export type SourceMapArtifact = {
  id: string;
  projectId: string;
  environmentId: string;
  release: string;
  minifiedFile: string;
  originalFilename: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
  uploadedByUserId: string;
};

export type SourceMapArtifactQuery = {
  projectId: string;
  environmentId: string;
  release?: string;
};

export type SourceMapResolutionFrame = {
  frameIndex: number;
  minifiedFile: string;
  minifiedLine: number;
  minifiedColumn: number;
  originalSource: string;
  originalLine: number;
  originalColumn: number;
  originalName: string | null;
  sourceMapArtifactId: string;
};

export type SourceMapResolution = {
  errorId: string;
  release: string | null;
  status: "resolved" | "partially_resolved" | "unresolved" | "unavailable";
  frames: SourceMapResolutionFrame[];
  unresolvedFrameCount: number;
};
```

- [x] **Step 4: Add multipart request helper and methods**

In `apps/console/src/api/client.ts`, add `multipartRequest<T>()` that sends:

```ts
headers: { Accept: "application/json" }
```

without setting `Content-Type`.

Add methods:

- `listSourceMapArtifacts(query)`
- `uploadSourceMap(input)`
- `uploadSourceMapBundle(input)`
- `deleteSourceMapArtifact(id, query)`
- `getErrorSourceMapResolution(id, query)`

- [x] **Step 5: Run client tests**

```bash
pnpm exec vitest run apps/console/src/api/client.test.ts
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts
git commit -m "feat: add source map console client"
```

## Task 7: Artifacts Console Mode

**Files:**

- Create: `apps/console/src/components/ArtifactsPanel.tsx`
- Modify: `apps/console/src/components/ConsoleModeTabs.tsx`
- Modify: `apps/console/src/components/ConsoleModeTabs.test.tsx`
- Modify: `apps/console/src/components/ConsoleShell.tsx`
- Modify: `apps/console/src/components/ConsoleShell.test.tsx`
- Modify: `apps/console/src/styles.css`

- [x] **Step 1: Add failing console tests**

In `apps/console/src/components/ConsoleModeTabs.test.tsx`, expect an `Artifacts` button.

In `apps/console/src/components/ConsoleShell.test.tsx`, add:

```tsx
it("loads source map artifacts only when Artifacts mode is opened", async () => {
  const listSourceMapArtifacts = vi.fn().mockResolvedValue({ artifacts: [] });
  const api = client({
    listSourceMapArtifacts,
    listProjects: vi.fn().mockResolvedValue({
      projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
    }),
    listEnvironments: vi.fn().mockResolvedValue({
      environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
    })
  });

  render(<ConsoleShell client={api} />);

  expect(await screen.findByText("Environment: Production")).toBeInTheDocument();
  expect(listSourceMapArtifacts).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Artifacts" }));

  expect(await screen.findByText("No source maps uploaded.")).toBeInTheDocument();
  expect(listSourceMapArtifacts).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });
});
```

Also add a focused `apps/console/src/components/ArtifactsPanel.test.tsx` with:

```tsx
it("uploads a source map file", async () => {
  const uploadSourceMap = vi.fn().mockResolvedValue({ artifacts: [] });
  const api = client({
    listSourceMapArtifacts: vi.fn().mockResolvedValue({ artifacts: [] }),
    uploadSourceMap
  });

  render(<ArtifactsPanel client={api} environmentId="env_1" projectId="prj_1" />);

  await screen.findByText("No source maps uploaded.");
  await userEvent.type(screen.getByLabelText("Release"), "web@1.0.0");
  await userEvent.type(screen.getByLabelText("Minified file"), "app.min.js");
  await userEvent.upload(screen.getByLabelText("Source map file"), new File(["{}"], "app.min.js.map", { type: "application/json" }));
  await userEvent.click(screen.getByRole("button", { name: "Upload map" }));

  expect(uploadSourceMap).toHaveBeenCalledWith(expect.objectContaining({
    projectId: "prj_1",
    environmentId: "env_1",
    release: "web@1.0.0",
    minifiedFile: "app.min.js"
  }));
});
```

- [x] **Step 2: Run tests and verify failure**

```bash
pnpm exec vitest run apps/console/src/components/ConsoleModeTabs.test.tsx apps/console/src/components/ConsoleShell.test.tsx
```

Expected: fail because Artifacts mode does not exist.

- [x] **Step 3: Add mode tab**

In `ConsoleModeTabs.tsx`, extend:

```ts
export type ConsoleMode = "setup" | "overview" | "investigate" | "alerts" | "artifacts" | "system";
```

Render an `Artifacts` button between `Alerts` and `System`.

- [x] **Step 4: Implement `ArtifactsPanel`**

Create `apps/console/src/components/ArtifactsPanel.tsx` with props:

```ts
type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
};
```

Behavior:

- if project/environment missing, show `Select a project and environment in Setup to manage artifacts.`,
- load artifacts lazily on mount and after upload/delete,
- release filter input,
- single map form: release, minified file, file input,
- bundle form: release, file input,
- table/list with release, minified file, filename, byte size, upload time, delete button,
- unavailable and retry state.

Use exact visible labels:

- `Release`
- `Minified file`
- `Source map file`
- `Source map bundle`
- `Upload map`
- `Upload bundle`
- `No source maps uploaded.`

- [x] **Step 5: Render mode in `ConsoleShell`**

Add:

```tsx
{activeMode === "artifacts" ? (
  <ArtifactsPanel client={client} environmentId={activeEnvironment?.id} projectId={activeProject?.id} />
) : null}
```

- [x] **Step 6: Add styles**

In `apps/console/src/styles.css`, add compact operational styles:

- `.artifacts-panel`
- `.artifact-upload-grid`
- `.artifact-list`
- `.artifact-row`
- `.artifact-meta`

Keep cards at existing radius conventions and ensure mobile stacking.

- [x] **Step 7: Run console tests**

```bash
pnpm exec vitest run apps/console/src/components/ConsoleModeTabs.test.tsx apps/console/src/components/ConsoleShell.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [x] **Step 8: Commit**

```bash
git add apps/console/src/components/ArtifactsPanel.tsx apps/console/src/components/ConsoleModeTabs.tsx apps/console/src/components/ConsoleModeTabs.test.tsx apps/console/src/components/ConsoleShell.tsx apps/console/src/components/ConsoleShell.test.tsx apps/console/src/styles.css
git commit -m "feat: add source map artifacts console"
```

## Task 8: Raw Error Detail Resolution UI

**Files:**

- Create: `apps/console/src/components/ErrorSourceMapResolution.tsx`
- Modify: `apps/console/src/components/ErrorDetailDrawer.tsx`
- Modify: `apps/console/src/components/ErrorDetailDrawer.test.tsx`
- Modify: `apps/console/src/components/ErrorInvestigationPanel.tsx`
- Modify: `apps/console/src/components/ErrorRawOccurrencesPanel.tsx`
- Modify: `apps/console/src/styles.css`

- [ ] **Step 1: Add failing error detail tests**

In `apps/console/src/components/ErrorDetailDrawer.test.tsx`, add:

```tsx
it("shows unresolved source map state without source content", () => {
  render(
    <ErrorDetailDrawer
      error={error({ id: "err_1", release: "web@1.0.0" })}
      sourceMapResolution={{ errorId: "err_1", release: "web@1.0.0", status: "unresolved", frames: [], unresolvedFrameCount: 2 }}
    />
  );

  expect(screen.getByText("Source map resolution")).toBeInTheDocument();
  expect(screen.getByText("Unresolved")).toBeInTheDocument();
  expect(screen.queryByText("function checkout()")).not.toBeInTheDocument();
});

it("shows resolved source map frame metadata", () => {
  render(
    <ErrorDetailDrawer
      error={error({ id: "err_1", release: "web@1.0.0" })}
      sourceMapResolution={{
        errorId: "err_1",
        release: "web@1.0.0",
        status: "resolved",
        frames: [{
          frameIndex: 0,
          minifiedFile: "app.min.js",
          minifiedLine: 1,
          minifiedColumn: 5,
          originalSource: "src/app.ts",
          originalLine: 42,
          originalColumn: 4,
          originalName: "checkout",
          sourceMapArtifactId: "smap_1"
        }],
        unresolvedFrameCount: 0
      }}
    />
  );

  expect(screen.getByText("Resolved")).toBeInTheDocument();
  expect(screen.getByText("src/app.ts:42:4")).toBeInTheDocument();
  expect(screen.getByText("checkout")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
pnpm exec vitest run apps/console/src/components/ErrorDetailDrawer.test.tsx
```

Expected: fail because source-map resolution props/component do not exist.

- [ ] **Step 3: Create resolution component**

Create `apps/console/src/components/ErrorSourceMapResolution.tsx`:

```tsx
import type { SourceMapResolution } from "../api/types";

type Props = {
  resolution?: SourceMapResolution;
  isLoading?: boolean;
};

function statusLabel(status: SourceMapResolution["status"]): string {
  if (status === "partially_resolved") return "Partially resolved";
  return status[0].toUpperCase() + status.slice(1);
}

export function ErrorSourceMapResolution({ resolution, isLoading }: Props) {
  if (isLoading) return <p className="muted-text">Resolving source map frames</p>;
  if (!resolution) return <p className="muted-text">Source map resolution unavailable.</p>;

  return (
    <section className="source-map-resolution">
      <div className="panel-header">
        <h3>Source map resolution</h3>
        <span className={`status-pill ${resolution.status}`}>{statusLabel(resolution.status)}</span>
      </div>
      {resolution.frames.length === 0 ? <p className="muted-text">No frames resolved for this error.</p> : null}
      {resolution.frames.map((frame) => (
        <div className="source-map-frame" key={frame.frameIndex}>
          <strong>{frame.originalSource}:{frame.originalLine}:{frame.originalColumn}</strong>
          <span>{frame.originalName ?? "anonymous"}</span>
          <code>{frame.minifiedFile}:{frame.minifiedLine}:{frame.minifiedColumn}</code>
        </div>
      ))}
      {resolution.unresolvedFrameCount > 0 ? <p className="muted-text">{resolution.unresolvedFrameCount} frame(s) unresolved.</p> : null}
    </section>
  );
}
```

- [ ] **Step 4: Pass resolution into detail drawer**

Update `ErrorDetailDrawer.tsx` props:

```ts
sourceMapResolution?: SourceMapResolution;
isResolvingSourceMap?: boolean;
```

Render `<ErrorSourceMapResolution />` below the raw stack block.

- [ ] **Step 5: Load resolution in raw occurrences panel**

In `ErrorRawOccurrencesPanel.tsx`, add state:

```ts
const [sourceMapResolution, setSourceMapResolution] = useState<SourceMapResolution | undefined>();
const [isResolvingSourceMap, setIsResolvingSourceMap] = useState(false);
```

When `selectedError` changes:

- clear existing resolution,
- skip if no selected error,
- call `client.getErrorSourceMapResolution(selectedError.id, { projectId, environmentId })`,
- set loading state,
- ignore stale responses with a cancellation flag.

Pass resolution/loading into `ErrorDetailDrawer`.

- [ ] **Step 6: Run focused console tests**

```bash
pnpm exec vitest run apps/console/src/components/ErrorDetailDrawer.test.tsx apps/console/src/components/ErrorInvestigationPanel.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/components/ErrorSourceMapResolution.tsx apps/console/src/components/ErrorDetailDrawer.tsx apps/console/src/components/ErrorDetailDrawer.test.tsx apps/console/src/components/ErrorRawOccurrencesPanel.tsx apps/console/src/components/ErrorInvestigationPanel.tsx apps/console/src/styles.css
git commit -m "feat: show source map resolution in errors"
```

## Task 9: Documentation and Memory

**Files:**

- Modify: `README.md`
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/DEPLOYMENT.md`
- Modify: `.claude/docs/INFRASTRUCTURE.md`
- Modify: `.claude/docs/SECRETS.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/DECISIONS.md`
- Modify: `docs/superpowers/plans/2026-05-10-phase5b-source-maps-implementation.md`
- Modify external memory: `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`

- [ ] **Step 1: Update project docs**

Document:

- `SOURCE_MAPS_LOCAL_DIR`,
- `SOURCE_MAPS_MAX_UPLOAD_MB`,
- Compose `source_map_data` volume,
- admin Artifacts mode,
- upload `.map` and `.zip`,
- strict release matching,
- no source-content display,
- local-first decision.

- [ ] **Step 2: Update memory**

Append a `2026-05-10` memory entry noting Phase 5B implementation, verification status, and any deferred items.

- [ ] **Step 3: Mark completed plan tasks**

Update this plan file checkboxes for completed tasks through Task 9.

- [ ] **Step 4: Commit SignalHub docs**

```bash
git add README.md .claude/docs docs/superpowers/plans/2026-05-10-phase5b-source-maps-implementation.md
git commit -m "docs: document source map workflow"
```

- [ ] **Step 5: Commit memory**

```bash
cd /Users/diogo/Developer/Github/claude-config
git add projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
git commit -m "docs: update SignalHub phase 5B memory"
```

## Task 10: Final Verification and Integration

**Files:**

- Modify: `docs/superpowers/plans/2026-05-10-phase5b-source-maps-implementation.md`

- [ ] **Step 1: Run full tests**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 2: Run full build**

```bash
pnpm build
```

Expected: all workspace builds pass.

- [ ] **Step 3: Run Compose config verification**

```bash
docker compose config --quiet
```

Expected: exit code 0.

- [ ] **Step 4: Run doctor safe local mode**

If `.env` is present:

```bash
pnpm run doctor
```

If this is an isolated worktree without `.env`, create a temporary safe env and run:

```bash
cp .env.example /tmp/signalhub-doctor.env
perl -0pi -e 's/change-me-to-a-long-random-secret/safe-local-session-secret-32-chars-0001/g; s/change-me-to-a-long-random-pepper/safe-local-api-key-pepper-32-chars-001/g; s/change-me-admin-password-32-chars-min/safe-local-admin-password-32-chars-1/g' /tmp/signalhub-doctor.env
mkdir -p /tmp/signalhub-source-maps
perl -0pi -e 's#SOURCE_MAPS_LOCAL_DIR=/var/lib/signalhub/source-maps#SOURCE_MAPS_LOCAL_DIR=/tmp/signalhub-source-maps#g' /tmp/signalhub-doctor.env
pnpm run doctor -- --env-file /tmp/signalhub-doctor.env
```

Expected: exit code 0. API reachability warnings are acceptable if no local API is running.

- [ ] **Step 5: Mark plan complete**

Update this plan file so completed verification and integration checkboxes are checked.

- [ ] **Step 6: Commit plan completion**

```bash
git add docs/superpowers/plans/2026-05-10-phase5b-source-maps-implementation.md
git commit -m "docs: complete source map plan"
```

- [ ] **Step 7: Merge and push**

From the main SignalHub checkout:

```bash
git fetch origin
git status -sb
git merge --no-ff feature/phase5b-source-maps -m "merge: phase 5b source maps"
pnpm test
pnpm build
docker compose config --quiet
git push origin main
```

Push memory if Task 9 committed it:

```bash
cd /Users/diogo/Developer/Github/claude-config
git push origin main
```

Clean up the completed worktree and branch only after push succeeds.
