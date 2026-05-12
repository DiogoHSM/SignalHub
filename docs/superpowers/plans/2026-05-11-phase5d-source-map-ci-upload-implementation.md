# Phase 5D Source Map CI Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dedicated source-map upload tokens, a CI upload API, a repo-local CLI uploader, and Artifacts UI token management.

**Architecture:** Source-map upload tokens are a separate credential type scoped to one project/environment and hashed with the existing API key pepper strategy. Admin-session routes create/list/revoke tokens, while `POST /v1/source-maps` authenticates only upload tokens and reuses the existing source-map parser/storage path with token attribution. A new `packages/cli` command wraps the CI multipart upload flow.

**Tech Stack:** TypeScript, Fastify, Zod, Kysely/Postgres, React/Vite, Node 22 `fetch`/`FormData`/`Blob`, Vitest, pnpm.

---

## File Structure

- `packages/db/migrations/0008_source_map_upload_tokens.sql`: creates `source_map_upload_tokens`, adds token attribution to `source_map_artifacts`, and adds related indexes/constraints.
- `packages/db/src/migrate.ts`: registers migration 0008.
- `packages/db/src/schema.ts`: adds `SourceMapUploadTokensTable`, nullable `uploaded_by_token_id`, and nullable `uploaded_by_user_id`.
- `packages/db/src/repositories/source-map-upload-tokens.ts`: token CRUD, prefix lookup, last-used update, redaction-safe mapping.
- `packages/db/src/repositories/source-maps.ts`: updates artifact input/output attribution to allow user or token uploaders.
- `packages/telemetry/src/api-keys.ts`: adds source-map token generation helper while keeping hash/verify helpers shared.
- `apps/api/src/routes/source-map-uploads.ts`: new token-authenticated CI upload route.
- `apps/api/src/routes/admin.ts`: admin routes for source-map upload token list/create/revoke and shared upload request parsing types.
- `apps/api/src/source-maps/storage.ts`: accepts source-map upload attribution instead of only `uploadedByUserId`.
- `apps/api/src/app.ts`: registers source-map CI upload routes.
- `apps/api/src/main.ts`: wires token repositories, token verification, and CI upload dependencies.
- `apps/console/src/api/types.ts`: adds source-map upload token response types.
- `apps/console/src/api/client.ts`: adds list/create/revoke token methods.
- `apps/console/src/components/ArtifactsPanel.tsx`: adds compact token management section.
- `apps/console/src/components/ArtifactsPanel.test.tsx`: covers token list/create/revoke and scope reset.
- `packages/cli/package.json`: new CLI workspace package.
- `packages/cli/tsconfig.json`: CLI TypeScript config.
- `packages/cli/src/index.ts`: binary entrypoint.
- `packages/cli/src/source-maps.ts`: argument parsing, validation, upload request, and redacted output.
- `packages/cli/test/source-maps.test.ts`: CLI command behavior tests.
- Docs: `README.md`, `.claude/docs/ARCHITECTURE.md`, `.claude/docs/PROJECT-SUMMARY.md`, `.claude/docs/SECRETS.md`, `.claude/docs/UI-UX.md`, `.claude/docs/STACK.md`, and `CLAUDE.md`.

## Task 1: Source Map Upload Token Schema

**Files:**
- Create: `packages/db/migrations/0008_source_map_upload_tokens.sql`
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/src/schema.ts`
- Test: `packages/db/test/repositories.test.ts`

- [x] **Step 1: Write failing migration test**

Add to `packages/db/test/repositories.test.ts`:

```ts
it("runs source map upload token migrations", async () => {
  await sql`select id, prefix, hash, last_used_at, revoked_at from source_map_upload_tokens limit 0`.execute(db);
  await sql`select uploaded_by_user_id, uploaded_by_token_id from source_map_artifacts limit 0`.execute(db);
});
```

- [x] **Step 2: Run migration test to verify failure**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts -t "runs source map upload token migrations"
```

Expected: fails because `source_map_upload_tokens` does not exist.

- [x] **Step 3: Add migration 0008**

Create `packages/db/migrations/0008_source_map_upload_tokens.sql`:

```sql
CREATE TABLE IF NOT EXISTS source_map_upload_tokens (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id text NOT NULL,
  name text NOT NULL,
  prefix text NOT NULL UNIQUE,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS source_map_upload_tokens_scope_created_idx
  ON source_map_upload_tokens(project_id, environment_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS source_map_upload_tokens_active_prefix_idx
  ON source_map_upload_tokens(prefix)
  WHERE revoked_at IS NULL;

ALTER TABLE source_map_artifacts
  ADD COLUMN IF NOT EXISTS uploaded_by_token_id text REFERENCES source_map_upload_tokens(id) ON DELETE SET NULL;

ALTER TABLE source_map_artifacts
  ALTER COLUMN uploaded_by_user_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_map_artifacts_one_uploader_check'
  ) THEN
    ALTER TABLE source_map_artifacts
      ADD CONSTRAINT source_map_artifacts_one_uploader_check
      CHECK (
        (uploaded_by_user_id IS NOT NULL AND uploaded_by_token_id IS NULL)
        OR (uploaded_by_user_id IS NULL AND uploaded_by_token_id IS NOT NULL)
      );
  END IF;
END $$;
```

- [x] **Step 4: Register migration**

Modify `packages/db/src/migrate.ts`:

```ts
const migrations = [
  { name: "0007_breadcrumbs.sql", url: new URL("../migrations/0007_breadcrumbs.sql", import.meta.url) },
  { name: "0008_source_map_upload_tokens.sql", url: new URL("../migrations/0008_source_map_upload_tokens.sql", import.meta.url) }
];
```

Keep the existing migration array order and add 0008 after 0007.

- [x] **Step 5: Update DB schema types**

Modify `packages/db/src/schema.ts`:

```ts
export type SourceMapUploadTokensTable = {
  id: string;
  project_id: string;
  environment_id: string;
  name: string;
  prefix: string;
  hash: string;
  created_at: Timestamp;
  last_used_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
};
```

Update `SourceMapArtifactsTable`:

```ts
uploaded_by_user_id: string | null;
uploaded_by_token_id: string | null;
```

Add to `Database`:

```ts
source_map_upload_tokens: SourceMapUploadTokensTable;
```

- [x] **Step 6: Run migration test to verify pass**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts -t "runs source map upload token migrations"
```

Expected: pass.

- [x] **Step 7: Keep DB checkpoint buildable**

Pull the minimal source-map repository attribution type/mapping update forward from Task 3 so `@signal-hub/db` remains buildable after nullable source-map attribution is introduced:

```ts
uploadedByUserId: string | null;
uploadedByTokenId: string | null;
```

Add focused tests for token scope integrity, artifact attribution constraints, and token-attributed artifacts.

- [x] **Step 8: Commit**

```bash
git add packages/db/migrations/0008_source_map_upload_tokens.sql packages/db/src/migrate.ts packages/db/src/schema.ts packages/db/src/repositories/source-maps.ts packages/db/test/repositories.test.ts
git commit -m "feat: add source map upload token schema"
```

## Task 2: Token Repository and Secret Helpers

**Files:**
- Create: `packages/db/src/repositories/source-map-upload-tokens.ts`
- Modify: `packages/telemetry/src/api-keys.ts`
- Modify: `packages/db/test/repositories.test.ts`
- Test: `packages/telemetry/test/api-keys.test.ts`

- [x] **Step 1: Write failing source-map token secret tests**

Add to `packages/telemetry/test/api-keys.test.ts`:

```ts
import { createSourceMapUploadToken } from "../src/api-keys.js";

it("creates distinguishable source map upload token secrets", () => {
  const token = createSourceMapUploadToken();

  expect(token.secret).toMatch(/^shsmap_[0-9a-zA-Z]+$/);
  expect(token.prefix).toBe(token.secret.slice(0, 16));
});
```

- [x] **Step 2: Write failing repository tests**

Add imports to `packages/db/test/repositories.test.ts`:

```ts
import {
  createSourceMapUploadTokenRecord,
  findSourceMapUploadTokenByPrefix,
  listSourceMapUploadTokens,
  revokeSourceMapUploadToken,
  updateSourceMapUploadTokenLastUsed
} from "../src/repositories/source-map-upload-tokens.js";
```

Add tests:

```ts
it("creates lists finds uses and revokes source map upload tokens", async () => {
  const token = await createSourceMapUploadTokenRecord(db, {
    projectId: "prj_test",
    environmentId: "env_test",
    name: "GitHub Actions",
    prefix: "shsmap_test",
    hash: "hash_test"
  });

  expect(token.id).toMatch(/^smtok_/);
  expect(token.name).toBe("GitHub Actions");
  expect(token.revokedAt).toBeNull();

  const listed = await listSourceMapUploadTokens(db, { projectId: "prj_test", environmentId: "env_test" });
  expect(listed.map((item) => item.id)).toContain(token.id);

  const found = await findSourceMapUploadTokenByPrefix(db, "shsmap_test");
  expect(found?.id).toBe(token.id);

  await updateSourceMapUploadTokenLastUsed(db, token.id);
  const used = await findSourceMapUploadTokenByPrefix(db, "shsmap_test");
  expect(used?.lastUsedAt).toBeInstanceOf(Date);

  await revokeSourceMapUploadToken(db, {
    id: token.id,
    projectId: "prj_test",
    environmentId: "env_test"
  });

  const afterRevoke = await findSourceMapUploadTokenByPrefix(db, "shsmap_test");
  expect(afterRevoke).toBeUndefined();
});

it("rejects source map upload tokens for inactive or mismatched scopes", async () => {
  await expect(
    createSourceMapUploadTokenRecord(db, {
      projectId: "missing_project",
      environmentId: "env_test",
      name: "Bad token",
      prefix: "shsmap_bad",
      hash: "hash_bad"
    })
  ).rejects.toThrow("active_source_map_upload_token_scope_not_found");
});
```

Use existing test fixture ids for an active project/environment. If the file uses different canonical ids, use those exact ids instead of `prj_test` and `env_test`.

- [x] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm exec vitest run packages/telemetry/test/api-keys.test.ts packages/db/test/repositories.test.ts -t "source map upload token|source map upload token secrets"
```

Expected: fails because helper and repository do not exist.

- [x] **Step 4: Add source-map token secret helper**

Modify `packages/telemetry/src/api-keys.ts`:

```ts
const sourceMapUploadTokenId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 40);

export function createSourceMapUploadToken(): CreatedApiKey {
  const secret = `shsmap_${sourceMapUploadTokenId()}`;
  return {
    secret,
    prefix: secret.slice(0, 16)
  };
}
```

Keep `hashApiKey` and `verifyApiKey` unchanged so token hashing continues using the existing pepper strategy.

- [x] **Step 5: Add repository**

Create `packages/db/src/repositories/source-map-upload-tokens.ts`:

```ts
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

export async function createSourceMapUploadTokenRecord(
  db: Db,
  input: CreateSourceMapUploadTokenRecordInput
): Promise<SourceMapUploadTokenRecord> {
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

export async function revokeSourceMapUploadToken(
  db: Db,
  input: SourceMapUploadTokenScope & { id: string }
): Promise<void> {
  await db
    .updateTable("source_map_upload_tokens")
    .set({ revoked_at: new Date() })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("revoked_at", "is", null)
    .execute();
}
```

- [x] **Step 6: Run tests**

Run:

```bash
pnpm exec vitest run packages/telemetry/test/api-keys.test.ts packages/db/test/repositories.test.ts -t "source map upload token|source map upload token secrets"
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add packages/telemetry/src/api-keys.ts packages/telemetry/test/api-keys.test.ts packages/db/src/repositories/source-map-upload-tokens.ts packages/db/test/repositories.test.ts
git commit -m "feat: add source map upload token repository"
```

## Task 3: Source Map Artifact Token Attribution

**Files:**
- Modify: `packages/db/src/repositories/source-maps.ts`
- Modify: `apps/api/src/source-maps/storage.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Test: `packages/db/test/repositories.test.ts`
- Test: `apps/api/test/admin.test.ts`

- [x] **Step 1: Write failing attribution repository test**

Completed in Task 1 to keep `@signal-hub/db` buildable after nullable artifact attribution was introduced.

Add to `packages/db/test/repositories.test.ts` after source-map artifact tests:

```ts
it("persists source map artifacts uploaded by tokens", async () => {
  const token = await createSourceMapUploadTokenRecord(db, {
    projectId: "prj_test",
    environmentId: "env_test",
    name: "CI",
    prefix: "shsmap_attr",
    hash: "hash_attr"
  });

  const artifact = await createSourceMapArtifact(db, {
    projectId: "prj_test",
    environmentId: "env_test",
    release: "web@1.2.3",
    minifiedFile: "assets/app.js",
    originalFilename: "app.js.map",
    contentType: "application/json",
    byteSize: 42,
    sha256: "a".repeat(64),
    storagePath: "/tmp/source-maps/app.js.map",
    uploadedByTokenId: token.id
  });

  expect(artifact.uploadedByUserId).toBeNull();
  expect(artifact.uploadedByTokenId).toBe(token.id);
});
```

- [x] **Step 2: Run attribution test to verify failure**

Completed in Task 1.

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts -t "uploaded by tokens"
```

Expected: fails because `uploadedByTokenId` is not supported.

- [x] **Step 3: Update source-map repository types**

Completed in Task 1 as a build-restoring quality fix.

Modify `packages/db/src/repositories/source-maps.ts`.

Update `SourceMapArtifactRecord`:

```ts
uploadedByUserId: string | null;
uploadedByTokenId: string | null;
```

Update create input:

```ts
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
```

Update mapper and insert:

```ts
uploadedByUserId: row.uploaded_by_user_id,
uploadedByTokenId: row.uploaded_by_token_id
```

```ts
uploaded_by_user_id: input.uploadedByUserId ?? null,
uploaded_by_token_id: input.uploadedByTokenId ?? null
```

- [x] **Step 4: Update API upload input types**

Modify `apps/api/src/routes/admin.ts`.

Add:

```ts
export type SourceMapUploadAttribution =
  | { uploadedByUserId: string; uploadedByTokenId?: never }
  | { uploadedByUserId?: never; uploadedByTokenId: string };
```

Update `SourceMapUploadInput` and `SourceMapBundleUploadInput` to extend attribution instead of requiring `uploadedByUserId`:

```ts
export type SourceMapUploadInput = SourceMapUploadAttribution & {
  projectId: string;
  environmentId: string;
  release: string;
  minifiedFile?: string;
  originalFilename: string;
  contentType: string;
  content: Buffer;
};
```

Apply the same pattern to `SourceMapBundleUploadInput`.

Keep `parseSourceMapUploadRequest(request, uploadedByUserId)` returning user attribution for admin uploads.

- [x] **Step 5: Update storage service attribution**

Modify `apps/api/src/source-maps/storage.ts`:

```ts
const uploader =
  "uploadedByTokenId" in input.input
    ? { uploadedByTokenId: input.input.uploadedByTokenId }
    : { uploadedByUserId: input.input.uploadedByUserId };
```

Pass `...uploader` into every `createSourceMapArtifact` call.

- [x] **Step 6: Update admin tests for nullable token attribution**

In `apps/api/test/admin.test.ts`, update source-map artifact fixture helpers to include:

```ts
uploadedByUserId: "usr_admin",
uploadedByTokenId: null
```

Expected: existing admin tests still pass and preserve user attribution.

- [x] **Step 7: Run tests**

Run:

```bash
pnpm exec vitest run packages/db/test/repositories.test.ts apps/api/test/admin.test.ts
```

Expected: pass.

- [x] **Step 8: Commit**

```bash
git add packages/db/src/repositories/source-maps.ts packages/db/test/repositories.test.ts apps/api/src/source-maps/storage.ts apps/api/src/routes/admin.ts apps/api/test/admin.test.ts
git commit -m "feat: attribute source maps to upload tokens"
```

## Task 4: Admin Source Map Upload Token API

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/main.ts`
- Test: `apps/api/test/admin.test.ts`

- [x] **Step 1: Write failing admin API tests**

Add to `apps/api/test/admin.test.ts`:

```ts
it("creates source map upload tokens for admins and returns the secret once", async () => {
  const createToken = vi.fn().mockResolvedValue({
    id: "smtok_1",
    projectId: "prj_1",
    environmentId: "env_1",
    name: "GitHub Actions",
    prefix: "shsmap_test",
    hash: "hash",
    createdAt: new Date("2026-05-11T12:00:00.000Z"),
    lastUsedAt: null,
    revokedAt: null
  });
  const app = await buildTestApp({
    sourceMapUploadTokens: {
      create: createToken,
      list: vi.fn(),
      revoke: vi.fn()
    },
    createSourceMapUploadToken: () => ({ secret: "shsmap_test_secret", prefix: "shsmap_test" }),
    hashApiKeySecret: async () => "hash"
  });

  const response = await app.inject({
    method: "POST",
    url: "/admin/source-map-upload-tokens",
    cookies: adminCookie,
    payload: { projectId: "prj_1", environmentId: "env_1", name: "GitHub Actions" }
  });

  expect(response.statusCode).toBe(201);
  expect(response.json().token.secret).toBe("shsmap_test_secret");
  expect(response.json().token.hash).toBeUndefined();
  expect(createToken).toHaveBeenCalledWith({
    projectId: "prj_1",
    environmentId: "env_1",
    name: "GitHub Actions",
    prefix: "shsmap_test",
    hash: "hash"
  });
});

it("lists source map upload tokens without secrets or hashes", async () => {
  const app = await buildTestApp({
    sourceMapUploadTokens: {
      list: vi.fn().mockResolvedValue([
        {
          id: "smtok_1",
          projectId: "prj_1",
          environmentId: "env_1",
          name: "GitHub Actions",
          prefix: "shsmap_test",
          hash: "hash",
          createdAt: new Date("2026-05-11T12:00:00.000Z"),
          lastUsedAt: null,
          revokedAt: null
        }
      ]),
      create: vi.fn(),
      revoke: vi.fn()
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/admin/source-map-upload-tokens?project_id=prj_1&environment_id=env_1",
    cookies: adminCookie
  });

  expect(response.statusCode).toBe(200);
  expect(response.json().tokens[0].secret).toBeUndefined();
  expect(response.json().tokens[0].hash).toBeUndefined();
});

it("revokes source map upload tokens for admins", async () => {
  const revoke = vi.fn();
  const app = await buildTestApp({
    sourceMapUploadTokens: {
      list: vi.fn(),
      create: vi.fn(),
      revoke
    }
  });

  const response = await app.inject({
    method: "DELETE",
    url: "/admin/source-map-upload-tokens/smtok_1?project_id=prj_1&environment_id=env_1",
    cookies: adminCookie
  });

  expect(response.statusCode).toBe(204);
  expect(revoke).toHaveBeenCalledWith({ id: "smtok_1", projectId: "prj_1", environmentId: "env_1" });
});
```

Adjust the local test harness names (`buildTestApp`, `adminCookie`) to match existing `apps/api/test/admin.test.ts` helpers.

- [x] **Step 2: Run admin API tests to verify failure**

Run:

```bash
pnpm exec vitest run apps/api/test/admin.test.ts -t "source map upload tokens"
```

Expected: fails because admin routes and dependencies do not exist.

- [x] **Step 3: Add admin dependency types and redaction**

Modify `apps/api/src/routes/admin.ts`:

```ts
import { createSourceMapUploadToken, hashApiKey as hashTelemetryApiKey } from "@signal-hub/telemetry/api-keys";
```

Add types:

```ts
export type SourceMapUploadTokenResponse = {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  prefix: string;
  hash: string;
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
};

export type SourceMapUploadTokenAdministrationDependencies = {
  list?: (scope: { projectId: string; environmentId: string }) => Promise<SourceMapUploadTokenResponse[]>;
  create?: (input: { projectId: string; environmentId: string; name: string; prefix: string; hash: string }) => Promise<SourceMapUploadTokenResponse>;
  revoke?: (input: { id: string; projectId: string; environmentId: string }) => Promise<void>;
};
```

Add options:

```ts
sourceMapUploadTokens?: SourceMapUploadTokenAdministrationDependencies;
createSourceMapUploadToken?: () => { secret: string; prefix: string };
```

Add schemas:

```ts
const sourceMapUploadTokenScopeQuerySchema = z.object({
  project_id: z.string().trim().min(1),
  environment_id: z.string().trim().min(1)
});

const createSourceMapUploadTokenSchema = z.object({
  projectId: z.string().trim().min(1),
  environmentId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(256)
});
```

Add redaction:

```ts
function redactSourceMapUploadToken(token: SourceMapUploadTokenResponse): Omit<SourceMapUploadTokenResponse, "hash"> {
  const { hash: _hash, ...safeToken } = token;
  return safeToken;
}
```

- [x] **Step 4: Add admin routes**

In `registerAdminRoutes`, before `/admin/source-maps` routes, add:

```ts
app.get("/admin/source-map-upload-tokens", async (request, reply) => {
  const admin = await requireAdmin(request, reply, options.auth);
  if (!admin) return reply;

  if (!options.sourceMapUploadTokens?.list) {
    return reply.status(501).send({ error: "source_map_upload_tokens_repository_unavailable" });
  }

  const parsed = sourceMapUploadTokenScopeQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.status(400).send({ error: "invalid_source_map_upload_token_request" });
  }

  const tokens = await options.sourceMapUploadTokens.list({
    projectId: parsed.data.project_id,
    environmentId: parsed.data.environment_id
  });

  return reply.send({ tokens: tokens.map(redactSourceMapUploadToken) });
});

app.post("/admin/source-map-upload-tokens", async (request, reply) => {
  const admin = await requireAdmin(request, reply, options.auth);
  if (!admin) return reply;

  if (!options.sourceMapUploadTokens?.create) {
    return reply.status(501).send({ error: "source_map_upload_tokens_repository_unavailable" });
  }

  const parsed = createSourceMapUploadTokenSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "invalid_source_map_upload_token_request" });
  }

  const generatedToken = options.createSourceMapUploadToken?.() ?? createSourceMapUploadToken();
  const hash = await hashAdminApiKeySecret(generatedToken.secret, options);
  if (!hash) {
    return reply.status(501).send({ error: "source_map_upload_token_hashing_unavailable" });
  }

  try {
    const token = await options.sourceMapUploadTokens.create({
      projectId: parsed.data.projectId,
      environmentId: parsed.data.environmentId,
      name: parsed.data.name,
      prefix: generatedToken.prefix,
      hash
    });

    return reply.status(201).send({
      token: {
        ...redactSourceMapUploadToken(token),
        secret: generatedToken.secret
      }
    });
  } catch (error) {
    if (isKnownAdminResourceError(error, "active_source_map_upload_token_scope_not_found")) {
      return reply.status(404).send({ error: "source_map_upload_token_scope_not_found" });
    }
    throw error;
  }
});

app.delete("/admin/source-map-upload-tokens/:id", async (request, reply) => {
  const admin = await requireAdmin(request, reply, options.auth);
  if (!admin) return reply;

  if (!options.sourceMapUploadTokens?.revoke) {
    return reply.status(501).send({ error: "source_map_upload_tokens_repository_unavailable" });
  }

  const params = idParamsSchema.safeParse(request.params);
  const query = sourceMapUploadTokenScopeQuerySchema.safeParse(request.query);
  if (!params.success || !query.success) {
    return reply.status(400).send({ error: "invalid_source_map_upload_token_request" });
  }

  await options.sourceMapUploadTokens.revoke({
    id: params.data.id,
    projectId: query.data.project_id,
    environmentId: query.data.environment_id
  });

  return reply.status(204).send();
});
```

- [x] **Step 5: Wire app and main dependencies**

Modify `apps/api/src/app.ts` `BuildAppOptions`:

```ts
sourceMapUploadTokens?: SourceMapUploadTokenAdministrationDependencies;
createSourceMapUploadToken?: () => { secret: string; prefix: string };
```

Pass to `registerAdminRoutes`.

Modify `apps/api/src/main.ts` imports and `buildApp` options:

```ts
import {
  createSourceMapUploadTokenRecord,
  listSourceMapUploadTokens,
  revokeSourceMapUploadToken
} from "@signal-hub/db/repositories/source-map-upload-tokens.js";
```

```ts
sourceMapUploadTokens: {
  list: (scope) => listSourceMapUploadTokens(db, scope),
  create: (input) => createSourceMapUploadTokenRecord(db, input),
  revoke: (input) => revokeSourceMapUploadToken(db, input)
}
```

- [x] **Step 6: Run tests**

Run:

```bash
pnpm exec vitest run apps/api/test/admin.test.ts
pnpm --filter @signal-hub/api build
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/app.ts apps/api/src/main.ts apps/api/test/admin.test.ts
git commit -m "feat: add source map upload token admin api"
```

## Task 5: Token-Authenticated CI Source Map Upload API

**Files:**
- Create: `apps/api/src/routes/source-map-uploads.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/test/source-map-uploads.test.ts`

- [x] **Step 1: Export shared multipart parser and error helper**

Modify `apps/api/src/routes/admin.ts` exports:

```ts
export { parseSourceMapUploadRequest, sourceMapUploadErrorStatus };
```

Change `parseSourceMapUploadRequest` signature to accept attribution instead of only user id:

```ts
async function parseSourceMapUploadRequest(
  request: FastifyRequest,
  attribution: SourceMapUploadAttribution
): Promise<SourceMapUploadInput | SourceMapBundleUploadInput | undefined>
```

For admin call sites, pass:

```ts
{ uploadedByUserId: admin.id }
```

- [x] **Step 2: Write failing CI upload API tests**

Create `apps/api/test/source-map-uploads.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

function multipartBody(parts: Array<{ name: string; value?: string; filename?: string; contentType?: string; content?: Buffer }>) {
  const boundary = "----signalhub-test-boundary";
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.filename) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.contentType ?? "application/octet-stream"}\r\n\r\n`
        )
      );
      chunks.push(part.content ?? Buffer.alloc(0));
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value ?? ""}\r\n`));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` }
  };
}

function appWithUpload(overrides: Partial<Parameters<typeof buildApp>[0]> = {}) {
  return buildApp({
    readiness: async () => true,
    sourceMaps: {
      uploadMap: vi.fn().mockResolvedValue([
        {
          id: "smap_1",
          projectId: "prj_1",
          environmentId: "env_1",
          release: "web@1.2.3",
          minifiedFile: "assets/app.js",
          originalFilename: "app.js.map",
          contentType: "application/json",
          byteSize: 42,
          sha256: "a".repeat(64),
          storagePath: "/private/source-maps/app.js.map",
          uploadedByUserId: null,
          uploadedByTokenId: "smtok_1",
          createdAt: new Date("2026-05-11T12:00:00.000Z"),
          deletedAt: null
        }
      ]),
      uploadBundle: vi.fn(),
      maxUploadBytes: 1024 * 1024
    },
    sourceMapUploads: {
      verifyToken: vi.fn().mockResolvedValue({ id: "smtok_1", projectId: "prj_1", environmentId: "env_1" })
    },
    ...overrides
  });
}

describe("source map CI uploads", () => {
  it("uploads a single source map with a source map upload token", async () => {
    const app = await appWithUpload();
    const body = multipartBody([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "web@1.2.3" },
      { name: "minified_file", value: "assets/app.js" },
      { name: "file", filename: "app.js.map", contentType: "application/json", content: Buffer.from('{"version":3,"sources":[],"names":[],"mappings":"","file":"assets/app.js"}') }
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/source-maps",
      headers: { ...body.headers, authorization: "Bearer shsmap_valid" },
      payload: body.payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().artifacts[0].storagePath).toBeUndefined();
    expect(response.json().artifacts[0].uploadedByTokenId).toBeUndefined();
  });

  it("rejects source map uploads with project environment mismatch", async () => {
    const app = await appWithUpload();
    const body = multipartBody([
      { name: "project_id", value: "prj_2" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "web@1.2.3" },
      { name: "file", filename: "app.js.map", contentType: "application/json", content: Buffer.from("{}") }
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/source-maps",
      headers: { ...body.headers, authorization: "Bearer shsmap_valid" },
      payload: body.payload
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "source_map_upload_scope_mismatch" });
  });

  it("rejects invalid source map upload tokens", async () => {
    const app = await appWithUpload({
      sourceMapUploads: { verifyToken: vi.fn().mockResolvedValue(null) }
    });
    const body = multipartBody([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "web@1.2.3" },
      { name: "file", filename: "app.js.map", contentType: "application/json", content: Buffer.from("{}") }
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/source-maps",
      headers: { ...body.headers, authorization: "Bearer bad" },
      payload: body.payload
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_source_map_upload_token" });
  });
});
```

- [x] **Step 3: Run API tests to verify failure**

Run:

```bash
pnpm exec vitest run apps/api/test/source-map-uploads.test.ts
```

Expected: fails because route dependencies and route do not exist.

- [x] **Step 4: Create source-map upload route**

Create `apps/api/src/routes/source-map-uploads.ts`:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SourceMapArtifactResponse, SourceMapBundleUploadInput, SourceMapUploadInput } from "./admin.js";
import { parseSourceMapUploadRequest, sourceMapUploadErrorStatus } from "./admin.js";

export type SourceMapUploadTokenScope = {
  id: string;
  projectId: string;
  environmentId: string;
};

export type SourceMapUploadRouteDependencies = {
  verifyToken?: (secret: string) => Promise<SourceMapUploadTokenScope | null | undefined>;
  uploadMap?: (input: SourceMapUploadInput) => Promise<SourceMapArtifactResponse[]>;
  uploadBundle?: (input: SourceMapBundleUploadInput) => Promise<SourceMapArtifactResponse[]>;
};

function parseBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1];
}

async function requireUploadToken(
  request: FastifyRequest,
  reply: FastifyReply,
  sourceMapUploads: SourceMapUploadRouteDependencies | undefined
): Promise<SourceMapUploadTokenScope | undefined> {
  const secret = parseBearerToken(request);
  if (!secret) {
    reply.status(401).send({ error: "invalid_source_map_upload_token" });
    return undefined;
  }

  if (!sourceMapUploads?.verifyToken) {
    reply.status(503).send({ error: "source_map_uploads_unavailable" });
    return undefined;
  }

  const scope = await sourceMapUploads.verifyToken(secret);
  if (!scope) {
    reply.status(401).send({ error: "invalid_source_map_upload_token" });
    return undefined;
  }

  return scope;
}

function redactArtifact(artifact: SourceMapArtifactResponse) {
  const {
    storagePath: _storagePath,
    uploadedByUserId: _uploadedByUserId,
    uploadedByTokenId: _uploadedByTokenId,
    deletedAt: _deletedAt,
    contentType: _contentType,
    ...safeArtifact
  } = artifact as SourceMapArtifactResponse & { uploadedByTokenId?: string | null };
  return safeArtifact;
}

export function registerSourceMapUploadRoutes(
  app: FastifyInstance,
  sourceMapUploads?: SourceMapUploadRouteDependencies
): void {
  app.post("/v1/source-maps", async (request, reply) => {
    const token = await requireUploadToken(request, reply, sourceMapUploads);
    if (!token) return reply;

    let input: SourceMapUploadInput | SourceMapBundleUploadInput | undefined;
    try {
      input = await parseSourceMapUploadRequest(request, { uploadedByTokenId: token.id });
    } catch (error) {
      const status = sourceMapUploadErrorStatus(error);
      return reply.status(status ?? 400).send({ error: "invalid_source_map_request" });
    }

    if (!input) {
      return reply.status(400).send({ error: "invalid_source_map_request" });
    }

    if (input.projectId !== token.projectId || input.environmentId !== token.environmentId) {
      return reply.status(403).send({ error: "source_map_upload_scope_mismatch" });
    }

    try {
      if ("minifiedFile" in input) {
        if (!sourceMapUploads?.uploadMap) {
          return reply.status(503).send({ error: "source_map_uploads_unavailable" });
        }
        const artifacts = await sourceMapUploads.uploadMap(input);
        return reply.send({ artifacts: artifacts.map(redactArtifact) });
      }

      if (!sourceMapUploads?.uploadBundle) {
        return reply.status(503).send({ error: "source_map_uploads_unavailable" });
      }
      const artifacts = await sourceMapUploads.uploadBundle(input);
      return reply.send({ artifacts: artifacts.map(redactArtifact) });
    } catch (error) {
      const status = sourceMapUploadErrorStatus(error);
      if (status) {
        return reply.status(status).send({ error: "invalid_source_map_request" });
      }
      return reply.status(503).send({ error: "source_map_uploads_unavailable" });
    }
  });
}
```

- [x] **Step 5: Wire route and token verification**

Modify `apps/api/src/app.ts`:

```ts
import { registerSourceMapUploadRoutes, type SourceMapUploadRouteDependencies } from "./routes/source-map-uploads.js";
```

Add option:

```ts
sourceMapUploads?: SourceMapUploadRouteDependencies;
```

Register before ingestion or query routes:

```ts
registerSourceMapUploadRoutes(app, options.sourceMapUploads);
```

Modify `apps/api/src/main.ts` imports:

```ts
import {
  findSourceMapUploadTokenByPrefix,
  updateSourceMapUploadTokenLastUsed
} from "@signal-hub/db/repositories/source-map-upload-tokens.js";
```

Add to `buildApp` options:

```ts
sourceMapUploads: {
  verifyToken: async (secret) => {
    const prefix = secret.slice(0, 16);
    const token = await findSourceMapUploadTokenByPrefix(db, prefix);
    if (!token) return null;

    const valid = await verifyApiKey(token.hash, secret, config.apiKeyPepper);
    if (!valid) return null;

    await updateSourceMapUploadTokenLastUsed(db, token.id);
    return { id: token.id, projectId: token.projectId, environmentId: token.environmentId };
  },
  uploadMap: (input) =>
    uploadSingleSourceMap({
      db,
      localDir: config.sourceMaps.localDir,
      input
    }),
  uploadBundle: (input) =>
    uploadSourceMapBundle({
      db,
      localDir: config.sourceMaps.localDir,
      input
    })
}
```

- [x] **Step 6: Run API tests**

Run:

```bash
pnpm exec vitest run apps/api/test/source-map-uploads.test.ts apps/api/test/admin.test.ts apps/api/test/ingestion.test.ts
pnpm --filter @signal-hub/api build
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add apps/api/src/routes/source-map-uploads.ts apps/api/src/routes/admin.ts apps/api/src/app.ts apps/api/src/main.ts apps/api/test/source-map-uploads.test.ts
git commit -m "feat: add source map ci upload api"
```

## Task 6: CLI Package

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/source-maps.ts`
- Create: `packages/cli/test/source-maps.test.ts`
- Modify: `package.json`

- [x] **Step 1: Write failing CLI tests**

Create `packages/cli/test/source-maps.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSourceMapUploadCommand } from "../src/source-maps.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function tempFile(name: string, content = "{}") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "signalhub-cli-"));
  const file = path.join(dir, name);
  await writeFile(file, content);
  return file;
}

describe("source map upload command", () => {
  it("uploads a single source map with flags", async () => {
    const file = await tempFile("app.js.map", '{"version":3,"sources":[],"names":[],"mappings":"","file":"assets/app.js"}');
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ artifacts: [{ minifiedFile: "assets/app.js" }] })
    });
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const stdout: string[] = [];

    const exitCode = await runSourceMapUploadCommand(
      [
        "--endpoint",
        "https://signalhub.example.com",
        "--token",
        "shsmap_secret",
        "--project-id",
        "prj_1",
        "--environment-id",
        "env_1",
        "--release",
        "web@1.2.3",
        "--file",
        file,
        "--minified-file",
        "assets/app.js"
      ],
      { env: {}, stdout: (line) => stdout.push(line), stderr: () => undefined }
    );

    expect(exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledWith("https://signalhub.example.com/v1/source-maps", expect.objectContaining({ method: "POST" }));
    expect(stdout.join("\n")).toContain("Uploaded 1 source map artifact(s)");
  });

  it("uses environment fallbacks and uploads a bundle", async () => {
    const bundle = await tempFile("source-maps.zip", "zip");
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ artifacts: [{ minifiedFile: "assets/app.js" }, { minifiedFile: "assets/vendor.js" }] })
    });
    globalThis.fetch = fetch as typeof globalThis.fetch;

    const exitCode = await runSourceMapUploadCommand(["--bundle", bundle], {
      env: {
        SIGNALHUB_ENDPOINT: "https://signalhub.example.com/",
        SIGNALHUB_SOURCE_MAP_TOKEN: "shsmap_secret",
        SIGNALHUB_PROJECT_ID: "prj_1",
        SIGNALHUB_ENVIRONMENT_ID: "env_1",
        SIGNALHUB_RELEASE: "web@1.2.3"
      },
      stdout: () => undefined,
      stderr: () => undefined
    });

    expect(exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects missing required inputs without leaking token values", async () => {
    const stderr: string[] = [];
    const exitCode = await runSourceMapUploadCommand(["--token", "shsmap_super_secret"], {
      env: {},
      stdout: () => undefined,
      stderr: (line) => stderr.push(line)
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("Missing required option");
    expect(stderr.join("\n")).not.toContain("shsmap_super_secret");
  });

  it("rejects both file and bundle", async () => {
    const file = await tempFile("app.js.map");
    const bundle = await tempFile("source-maps.zip");
    const stderr: string[] = [];

    const exitCode = await runSourceMapUploadCommand(["--file", file, "--bundle", bundle], {
      env: {
        SIGNALHUB_ENDPOINT: "https://signalhub.example.com",
        SIGNALHUB_SOURCE_MAP_TOKEN: "shsmap_secret",
        SIGNALHUB_PROJECT_ID: "prj_1",
        SIGNALHUB_ENVIRONMENT_ID: "env_1",
        SIGNALHUB_RELEASE: "web@1.2.3"
      },
      stdout: () => undefined,
      stderr: (line) => stderr.push(line)
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("Provide exactly one of --file or --bundle");
  });
});
```

- [x] **Step 2: Run CLI tests to verify failure**

Run:

```bash
pnpm exec vitest run packages/cli/test/source-maps.test.ts
```

Expected: fails because package and module do not exist.

- [x] **Step 3: Add CLI package metadata**

Create `packages/cli/package.json`:

```json
{
  "name": "@signal-hub/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "signalhub": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

Create `packages/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "noEmit": false
  },
  "include": ["src/**/*.ts"]
}
```

Modify root `package.json` scripts:

```json
"source-maps:upload": "tsx packages/cli/src/index.ts sourcemaps upload"
```

- [x] **Step 4: Implement CLI command**

Create `packages/cli/src/source-maps.ts`:

```ts
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

type Io = {
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

type ParsedArgs = {
  endpoint?: string;
  token?: string;
  projectId?: string;
  environmentId?: string;
  release?: string;
  file?: string;
  bundle?: string;
  minifiedFile?: string;
};

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (!arg.startsWith("--")) continue;
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    index += 1;
    if (arg === "--endpoint") parsed.endpoint = value;
    else if (arg === "--token") parsed.token = value;
    else if (arg === "--project-id") parsed.projectId = value;
    else if (arg === "--environment-id") parsed.environmentId = value;
    else if (arg === "--release") parsed.release = value;
    else if (arg === "--file") parsed.file = value;
    else if (arg === "--bundle") parsed.bundle = value;
    else if (arg === "--minified-file") parsed.minifiedFile = value;
    else throw new Error(`Unknown option ${arg}`);
  }
  return parsed;
}

function withEnv(parsed: ParsedArgs, env: NodeJS.ProcessEnv): Required<Pick<ParsedArgs, "endpoint" | "token" | "projectId" | "environmentId" | "release">> & ParsedArgs {
  return {
    ...parsed,
    endpoint: parsed.endpoint ?? env.SIGNALHUB_ENDPOINT,
    token: parsed.token ?? env.SIGNALHUB_SOURCE_MAP_TOKEN,
    projectId: parsed.projectId ?? env.SIGNALHUB_PROJECT_ID,
    environmentId: parsed.environmentId ?? env.SIGNALHUB_ENVIRONMENT_ID,
    release: parsed.release ?? env.SIGNALHUB_RELEASE
  };
}

function uploadUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/v1/source-maps`;
}

async function assertRegularFile(filePath: string): Promise<void> {
  const stats = await stat(filePath);
  if (!stats.isFile()) {
    throw new Error(`Not a regular file: ${filePath}`);
  }
}

function validate(input: ParsedArgs): asserts input is ParsedArgs & {
  endpoint: string;
  token: string;
  projectId: string;
  environmentId: string;
  release: string;
} {
  const required: Array<[keyof ParsedArgs, string]> = [
    ["endpoint", "--endpoint or SIGNALHUB_ENDPOINT"],
    ["token", "--token or SIGNALHUB_SOURCE_MAP_TOKEN"],
    ["projectId", "--project-id or SIGNALHUB_PROJECT_ID"],
    ["environmentId", "--environment-id or SIGNALHUB_ENVIRONMENT_ID"],
    ["release", "--release or SIGNALHUB_RELEASE"]
  ];
  for (const [key, label] of required) {
    if (!input[key]) throw new Error(`Missing required option ${label}`);
  }
  if (Boolean(input.file) === Boolean(input.bundle)) {
    throw new Error("Provide exactly one of --file or --bundle");
  }
  if (input.bundle && input.minifiedFile) {
    throw new Error("--minified-file can only be used with --file");
  }
}

export async function runSourceMapUploadCommand(args: string[], io: Io): Promise<number> {
  try {
    const input = withEnv(parseArgs(args), io.env);
    validate(input);

    const uploadPath = input.file ?? input.bundle;
    if (!uploadPath) throw new Error("Provide exactly one of --file or --bundle");
    await assertRegularFile(uploadPath);

    const body = new FormData();
    body.set("project_id", input.projectId);
    body.set("environment_id", input.environmentId);
    body.set("release", input.release);
    if (input.minifiedFile) body.set("minified_file", input.minifiedFile);

    const content = await readFile(uploadPath);
    const field = input.file ? "file" : "bundle";
    const type = input.file ? "application/json" : "application/zip";
    body.set(field, new Blob([content], { type }), path.basename(uploadPath));

    const response = await fetch(uploadUrl(input.endpoint), {
      method: "POST",
      headers: { authorization: `Bearer ${input.token}` },
      body
    });

    if (!response.ok) {
      io.stderr(`Source map upload failed with HTTP ${response.status}.`);
      return 1;
    }

    const payload = (await response.json()) as { artifacts?: Array<{ minifiedFile?: string }> };
    const artifacts = payload.artifacts ?? [];
    io.stdout(`Uploaded ${artifacts.length} source map artifact(s) for release ${input.release}.`);
    for (const artifact of artifacts) {
      if (artifact.minifiedFile) io.stdout(`- ${artifact.minifiedFile}`);
    }
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : "Source map upload failed.");
    return 1;
  }
}
```

Create `packages/cli/src/index.ts`:

```ts
#!/usr/bin/env node
import { runSourceMapUploadCommand } from "./source-maps.js";

const [group, command, ...args] = process.argv.slice(2);

if (group === "sourcemaps" && command === "upload") {
  const exitCode = await runSourceMapUploadCommand(args, {
    env: process.env,
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line)
  });
  process.exitCode = exitCode;
} else {
  console.error("Usage: signalhub sourcemaps upload [options]");
  process.exitCode = 1;
}
```

- [x] **Step 5: Run CLI tests and build**

Run:

```bash
pnpm exec vitest run packages/cli/test/source-maps.test.ts
pnpm --filter @signal-hub/cli build
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add package.json packages/cli
git commit -m "feat: add source map upload cli"
```

## Task 7: Console API Client for Upload Tokens

**Files:**
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Modify: `apps/console/src/api/client.test.ts`

- [x] **Step 1: Write failing client tests**

Add to `apps/console/src/api/client.test.ts`:

```ts
it("lists source map upload tokens", async () => {
  const fetchMock = mockFetch({
    tokens: [
      {
        id: "smtok_1",
        projectId: "prj/1",
        environmentId: "env 1",
        name: "GitHub Actions",
        prefix: "shsmap_test",
        createdAt: "2026-05-11T12:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null
      }
    ]
  });
  const api = createApiClient("/api");

  await api.listSourceMapUploadTokens({ projectId: "prj/1", environmentId: "env 1" });

  expect(fetchMock).toHaveBeenCalledWith("/api/admin/source-map-upload-tokens?project_id=prj%2F1&environment_id=env+1", {
    credentials: "include"
  });
});

it("creates source map upload tokens", async () => {
  const fetchMock = mockFetch({
    token: {
      id: "smtok_1",
      projectId: "prj_1",
      environmentId: "env_1",
      name: "GitHub Actions",
      prefix: "shsmap_test",
      secret: "shsmap_secret",
      createdAt: "2026-05-11T12:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null
    }
  });
  const api = createApiClient("/api");

  await api.createSourceMapUploadToken({ projectId: "prj_1", environmentId: "env_1", name: "GitHub Actions" });

  expect(fetchMock).toHaveBeenCalledWith("/api/admin/source-map-upload-tokens", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "prj_1", environmentId: "env_1", name: "GitHub Actions" })
  });
});

it("revokes source map upload tokens", async () => {
  const fetchMock = mockFetch(undefined, { status: 204 });
  const api = createApiClient("/api");

  await api.revokeSourceMapUploadToken("smtok/1", { projectId: "prj/1", environmentId: "env 1" });

  expect(fetchMock).toHaveBeenCalledWith("/api/admin/source-map-upload-tokens/smtok%2F1?project_id=prj%2F1&environment_id=env+1", {
    method: "DELETE",
    credentials: "include"
  });
});
```

Use existing `mockFetch` helper shape in this test file.

- [x] **Step 2: Run client tests to verify failure**

Run:

```bash
pnpm exec vitest run apps/console/src/api/client.test.ts -t "source map upload tokens"
```

Expected: fails because client methods/types do not exist.

- [x] **Step 3: Add console types**

Modify `apps/console/src/api/types.ts`:

```ts
export type SourceMapUploadToken = {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type CreatedSourceMapUploadToken = SourceMapUploadToken & {
  secret: string;
};
```

- [x] **Step 4: Add client methods**

Modify `apps/console/src/api/client.ts` imports and `ApiClient`:

```ts
listSourceMapUploadTokens(query: SourceMapScopeQuery): Promise<{ tokens: SourceMapUploadToken[] }>;
createSourceMapUploadToken(input: { projectId: string; environmentId: string; name: string }): Promise<{ token: CreatedSourceMapUploadToken }>;
revokeSourceMapUploadToken(id: string, query: SourceMapScopeQuery): Promise<void>;
```

Add helper:

```ts
function sourceMapUploadTokenPath(query: SourceMapScopeQuery): string {
  const params = sourceMapScopeParams(query);
  return `/admin/source-map-upload-tokens?${params.toString()}`;
}

function sourceMapUploadTokenDetailPath(id: string, query: SourceMapScopeQuery): string {
  return `/admin/source-map-upload-tokens/${encodePathSegment(id)}?${sourceMapScopeParams(query).toString()}`;
}
```

Add implementation:

```ts
async listSourceMapUploadTokens(query) {
  return jsonRequest<{ tokens: SourceMapUploadToken[] }>(path(apiBasePath, sourceMapUploadTokenPath(query)));
},
async createSourceMapUploadToken(input) {
  return jsonRequest<{ token: CreatedSourceMapUploadToken }>(path(apiBasePath, "/admin/source-map-upload-tokens"), {
    method: "POST",
    body: JSON.stringify(input)
  });
},
async revokeSourceMapUploadToken(id, query) {
  await voidRequest(path(apiBasePath, sourceMapUploadTokenDetailPath(id, query)), { method: "DELETE" });
}
```

- [x] **Step 5: Add stubs in console tests**

Search for `createApiClient` or mock `ApiClient` objects in console tests:

```bash
rg -n "listSourceMaps|uploadSourceMap|ApiClient" apps/console/src -g '*.test.tsx' -g '*.test.ts'
```

Add `listSourceMapUploadTokens`, `createSourceMapUploadToken`, and `revokeSourceMapUploadToken` `vi.fn()` stubs anywhere a full `ApiClient` mock is constructed.

- [x] **Step 6: Run console client tests**

Run:

```bash
pnpm exec vitest run apps/console/src/api/client.test.ts
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts apps/console/src/**/*.test.tsx
git commit -m "feat: add source map upload token console client"
```

## Task 8: Artifacts Upload Token UI

**Files:**
- Modify: `apps/console/src/components/ArtifactsPanel.tsx`
- Modify: `apps/console/src/components/ArtifactsPanel.test.tsx`
- Modify: `apps/console/src/styles.css`

- [x] **Step 1: Write failing Artifacts UI tests**

Add to `apps/console/src/components/ArtifactsPanel.test.tsx`:

```tsx
it("loads source map upload tokens for the active project and environment", async () => {
  const client = makeClient({
    listSourceMaps: vi.fn().mockResolvedValue({ artifacts: [] }),
    listSourceMapUploadTokens: vi.fn().mockResolvedValue({
      tokens: [
        {
          id: "smtok_1",
          projectId: "prj_1",
          environmentId: "env_1",
          name: "GitHub Actions",
          prefix: "shsmap_test",
          createdAt: "2026-05-11T12:00:00.000Z",
          lastUsedAt: null,
          revokedAt: null
        }
      ]
    })
  });

  render(<ArtifactsPanel client={client} environmentId="env_1" projectId="prj_1" />);

  expect(await screen.findByText("Upload tokens")).toBeInTheDocument();
  expect(await screen.findByText("GitHub Actions")).toBeInTheDocument();
  expect(client.listSourceMapUploadTokens).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });
});

it("creates a source map upload token and shows its secret once", async () => {
  const client = makeClient({
    listSourceMaps: vi.fn().mockResolvedValue({ artifacts: [] }),
    listSourceMapUploadTokens: vi.fn().mockResolvedValue({ tokens: [] }),
    createSourceMapUploadToken: vi.fn().mockResolvedValue({
      token: {
        id: "smtok_1",
        projectId: "prj_1",
        environmentId: "env_1",
        name: "GitHub Actions",
        prefix: "shsmap_test",
        secret: "shsmap_secret",
        createdAt: "2026-05-11T12:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null
      }
    })
  });

  render(<ArtifactsPanel client={client} environmentId="env_1" projectId="prj_1" />);

  await userEvent.type(await screen.findByLabelText("Token name"), "GitHub Actions");
  await userEvent.click(screen.getByRole("button", { name: "Create token" }));

  expect(await screen.findByText("shsmap_secret")).toBeInTheDocument();
  expect(client.createSourceMapUploadToken).toHaveBeenCalledWith({
    projectId: "prj_1",
    environmentId: "env_1",
    name: "GitHub Actions"
  });
});

it("revokes source map upload tokens", async () => {
  const client = makeClient({
    listSourceMaps: vi.fn().mockResolvedValue({ artifacts: [] }),
    listSourceMapUploadTokens: vi.fn().mockResolvedValue({
      tokens: [
        {
          id: "smtok_1",
          projectId: "prj_1",
          environmentId: "env_1",
          name: "GitHub Actions",
          prefix: "shsmap_test",
          createdAt: "2026-05-11T12:00:00.000Z",
          lastUsedAt: null,
          revokedAt: null
        }
      ]
    }),
    revokeSourceMapUploadToken: vi.fn().mockResolvedValue(undefined)
  });

  render(<ArtifactsPanel client={client} environmentId="env_1" projectId="prj_1" />);

  await userEvent.click(await screen.findByRole("button", { name: "Revoke GitHub Actions" }));

  expect(client.revokeSourceMapUploadToken).toHaveBeenCalledWith("smtok_1", { projectId: "prj_1", environmentId: "env_1" });
});
```

- [x] **Step 2: Run Artifacts tests to verify failure**

Run:

```bash
pnpm exec vitest run apps/console/src/components/ArtifactsPanel.test.tsx
```

Expected: fails because token UI is missing.

- [x] **Step 3: Add token UI state and effects**

Modify `apps/console/src/components/ArtifactsPanel.tsx`.

Add state:

```ts
const [tokens, setTokens] = useState<SourceMapUploadToken[]>([]);
const [tokensState, setTokensState] = useState<"loading" | "ready" | "empty" | "unavailable">("loading");
const [tokenName, setTokenName] = useState("");
const [createdTokenSecret, setCreatedTokenSecret] = useState<string | null>(null);
const [isCreatingToken, setIsCreatingToken] = useState(false);
```

Add loader:

```ts
async function loadTokens() {
  setTokensState("loading");
  setCreatedTokenSecret(null);
  try {
    const response = await client.listSourceMapUploadTokens({ projectId, environmentId });
    setTokens(response.tokens);
    setTokensState(response.tokens.length > 0 ? "ready" : "empty");
  } catch {
    setTokens([]);
    setTokensState("unavailable");
  }
}
```

Call `loadTokens` in the same project/environment effect style used for source-map artifacts. Guard stale responses with a `cancelled` boolean.

- [x] **Step 4: Add create and revoke handlers**

Add:

```ts
async function createUploadToken(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const name = tokenName.trim();
  if (!name || isCreatingToken) return;

  setIsCreatingToken(true);
  try {
    const { token } = await client.createSourceMapUploadToken({ projectId, environmentId, name });
    setCreatedTokenSecret(token.secret);
    setTokens((current) => [token, ...current.filter((item) => item.id !== token.id)]);
    setTokensState("ready");
    setTokenName("");
  } finally {
    setIsCreatingToken(false);
  }
}

async function revokeUploadToken(token: SourceMapUploadToken) {
  await client.revokeSourceMapUploadToken(token.id, { projectId, environmentId });
  setTokens((current) => current.map((item) => (item.id === token.id ? { ...item, revokedAt: new Date().toISOString() } : item)));
}
```

- [x] **Step 5: Render Upload tokens section**

Add below the existing source-map upload/list UI:

```tsx
<section className="artifact-token-panel">
  <div className="panel-header">
    <h2>Upload tokens</h2>
  </div>
  <form aria-label="Create source map upload token" className="artifact-form" onSubmit={createUploadToken}>
    <label>
      Token name
      <input onChange={(event) => setTokenName(event.target.value)} value={tokenName} />
    </label>
    <button disabled={isCreatingToken || tokenName.trim().length === 0} type="submit">
      Create token
    </button>
  </form>
  {createdTokenSecret ? (
    <div className="status-box success">
      <strong>Copy this source map token now.</strong>
      <code>{createdTokenSecret}</code>
    </div>
  ) : null}
  {tokensState === "loading" ? <p className="muted-text">Loading upload tokens</p> : null}
  {tokensState === "unavailable" ? (
    <div className="status-box unavailable">
      <strong>Upload tokens unavailable</strong>
      <button onClick={loadTokens} type="button">
        Retry
      </button>
    </div>
  ) : null}
  {tokensState === "empty" ? <p className="muted-text">No upload tokens created.</p> : null}
  {tokens.length > 0 ? (
    <ul className="artifact-token-list">
      {tokens.map((token) => (
        <li className="artifact-token-list__item" key={token.id}>
          <div>
            <strong>{token.name}</strong>
            <p className="muted-text">{token.prefix}</p>
          </div>
          <span className={token.revokedAt ? "status-pill status-pill--neutral" : "status-pill status-pill--ok"}>
            {token.revokedAt ? "Revoked" : "Active"}
          </span>
          <button disabled={Boolean(token.revokedAt)} onClick={() => revokeUploadToken(token)} type="button">
            Revoke {token.name}
          </button>
        </li>
      ))}
    </ul>
  ) : null}
</section>
```

Use existing project style and avoid nested cards.

- [x] **Step 6: Add compact styles**

Add to `apps/console/src/styles.css`:

```css
.artifact-token-panel {
  border-top: 1px solid var(--border);
  margin-top: 1.25rem;
  padding-top: 1rem;
}

.artifact-token-list {
  display: grid;
  gap: 0.75rem;
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
}

.artifact-token-list__item {
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(0, 1fr) auto auto;
  padding: 0.75rem;
}
```

- [x] **Step 7: Run console tests and build**

Run:

```bash
pnpm exec vitest run apps/console/src/components/ArtifactsPanel.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: pass.

- [x] **Step 8: Commit**

```bash
git add apps/console/src/components/ArtifactsPanel.tsx apps/console/src/components/ArtifactsPanel.test.tsx apps/console/src/styles.css
git commit -m "feat: manage source map upload tokens"
```

## Task 9: Documentation and Memory

**Files:**
- Modify: `README.md`
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `.claude/docs/SECRETS.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/STACK.md`
- Modify: `CLAUDE.md`
- Modify external memory: `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`

- [x] **Step 1: Update README**

Add a `Source Map CI Uploads` section near `Source Maps`:

````md
## Source Map CI Uploads

Admins can create source-map upload tokens from the console `Artifacts` mode. These tokens are separate from browser ingestion API keys and are intended for CI systems only.

Generic shell example:

```sh
pnpm source-maps:upload -- \
  --endpoint https://signalhub.example.com \
  --token "$SIGNALHUB_SOURCE_MAP_TOKEN" \
  --project-id "$SIGNALHUB_PROJECT_ID" \
  --environment-id "$SIGNALHUB_ENVIRONMENT_ID" \
  --release "$GITHUB_SHA" \
  --bundle ./dist/source-maps.zip
```

GitHub Actions example:

```yaml
- name: Upload source maps
  run: |
    pnpm source-maps:upload -- \
      --endpoint "${{ secrets.SIGNALHUB_ENDPOINT }}" \
      --token "${{ secrets.SIGNALHUB_SOURCE_MAP_TOKEN }}" \
      --project-id "${{ secrets.SIGNALHUB_PROJECT_ID }}" \
      --environment-id "${{ secrets.SIGNALHUB_ENVIRONMENT_ID }}" \
      --release "${{ github.sha }}" \
      --bundle ./dist/source-maps.zip
```

Store upload tokens in CI secret storage. Do not expose them in browser bundles.
````

- [x] **Step 2: Update architecture docs**

Add to `.claude/docs/ARCHITECTURE.md`:

```md
Source-map CI uploads use dedicated `source_map_upload_tokens`, not ingestion API keys. Admins create and revoke these tokens from the Artifacts console. `POST /v1/source-maps` authenticates a token, enforces its project/environment scope, and writes artifacts through the existing local source-map storage service with token attribution.
```

- [x] **Step 3: Update secrets docs**

Add to `.claude/docs/SECRETS.md`:

```md
| `SIGNALHUB_SOURCE_MAP_TOKEN` | CI only | `shsmap_example` | Source-map upload token created from the Artifacts console. Store only in CI secret storage. |
```

Add operational rule:

```md
- Source-map upload tokens are separate from ingestion API keys. They should be stored only in CI secret storage and never shipped to browser clients.
```

- [x] **Step 4: Update project, stack, UI, and CLAUDE docs**

Update `.claude/docs/PROJECT-SUMMARY.md` current phase:

```md
Phase 5D: Source Map CI Uploads.
```

Add implemented capability:

```md
- Dedicated source-map upload tokens, CI upload API, CLI uploader, and Artifacts token management.
```

Update `.claude/docs/STACK.md` package layout:

```md
- `packages/cli`: Node-based SignalHub CLI, currently focused on source-map CI uploads.
```

Update `.claude/docs/UI-UX.md` Artifacts UX:

```md
- Artifacts includes compact source-map upload token management for the active project/environment. Token secrets are shown once after creation.
```

Update `CLAUDE.md`:

```md
- Current phase: Phase 5D Source Map CI Uploads.
```

- [x] **Step 5: Update memory**

Append to `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`:

```md
- Implemented Phase 5D Source Map CI Uploads: dedicated source-map upload tokens, token-authenticated `POST /v1/source-maps`, repo-local `@signal-hub/cli` uploader, and Artifacts token management. Upload tokens stay separate from browser ingestion API keys; object storage, GitHub Action wrapper, source-code viewer, and source-map retention remain deferred.
```

- [x] **Step 6: Commit SignalHub docs**

```bash
git add README.md .claude/docs/ARCHITECTURE.md .claude/docs/PROJECT-SUMMARY.md .claude/docs/SECRETS.md .claude/docs/UI-UX.md .claude/docs/STACK.md CLAUDE.md
git commit -m "docs: document source map ci uploads"
```

- [x] **Step 7: Commit memory**

```bash
cd /Users/diogo/Developer/Github/claude-config
git add projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
git commit -m "docs: update SignalHub phase 5D memory"
```

Preserve unrelated untracked memory directories.

## Task 10: Final Verification and Integration

**Files:**
- Modify: `docs/superpowers/plans/2026-05-11-phase5d-source-map-ci-upload-implementation.md`

- [x] **Step 1: Run full tests**

```bash
pnpm test
```

Expected: all test files pass with no unhandled errors.

- [x] **Step 2: Run full build**

```bash
pnpm build
```

Expected: all workspace builds pass, including `@signal-hub/cli`.

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
git add docs/superpowers/plans/2026-05-11-phase5d-source-map-ci-upload-implementation.md
git commit -m "docs: complete source map ci upload plan"
```

- [x] **Step 7: Merge and push**

From the main SignalHub checkout:

```bash
git fetch origin
git status -sb
git merge --no-ff feature/phase5d-source-map-ci-upload -m "merge: phase 5d source map ci uploads"
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

Clean up the completed worktree and local feature branch only after push succeeds.
