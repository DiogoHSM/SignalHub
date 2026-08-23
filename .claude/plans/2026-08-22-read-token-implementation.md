# Read Token Implementation Plan (PER-478)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/query/*` a non-human, read-only, project/environment-scoped, revocable credential so an agent can read telemetry without a human session.

**Architecture:** A `read_tokens` table structurally mirroring `source_map_upload_tokens`, a bearer fallback inside the single auth chokepoint of `query.ts`, four admin routes mirroring `/admin/source-map-upload-tokens`, and a Project Settings section mirroring `ArtifactsSection`. Nothing about existing session auth changes.

**Tech Stack:** TypeScript, pnpm workspace, Fastify, Kysely/Postgres, Zod, Vitest, React (console v2).

**Spec:** `.claude/plans/2026-08-22-mcp-sigmon-design.md`

## Global Constraints

- Secret prefix is `shread_`, matching the `sh_` / `shsmap_` convention in `packages/telemetry/src/api-keys.ts`. The stored `prefix` column is `secret.slice(0, 16)`.
- Row id prefix is `rdtok`, via `createId("rdtok")`.
- The secret is one-time: returned only from `POST /admin/read-tokens`, never from any GET, never re-derivable.
- Hashing reuses `hashApiKey`/`verifyApiKey` with the existing `apiKeyPepper`. Do not introduce a second hashing scheme.
- Every new route in `apps/api` needs an entry in `apps/api/src/openapi.ts`; `apps/api/test/openapi-coverage.test.ts` fails naming any route that lacks one. Derive params and responses from the handler, never from the route name.
- Console mutations go through `runMutation()`.
- No test may assert the shape of a query plan (PER-475).
- Verification gate before considering the work done: `pnpm test`, `pnpm build`, `pnpm --filter @sigmon/sdk build`, `docker compose config`.

---

### Task 1: `read_tokens` table and repository

**Files:**
- Create: `packages/db/migrations/0047_read_tokens.sql`
- Modify: `packages/db/src/schema.ts` (add `ReadTokensTable` type and register it on the database interface next to `source_map_upload_tokens`, line ~1073)
- Create: `packages/db/src/repositories/read-tokens.ts`
- Modify: `packages/db/src/index.ts` (export the new repository, following how `source-map-upload-tokens.ts` is exported)
- Test: `packages/db/test/repositories.test.ts` (append a `describe("read tokens")` block; find the existing `source map upload tokens` block and mirror it)

**Interfaces:**
- Consumes: nothing.
- Produces: `ReadTokenRecord` (`{ id, projectId, environmentId, name, prefix, hash, createdAt: Date, lastUsedAt: Date | null, revokedAt: Date | null }`), `ReadTokenScope` (`{ projectId, environmentId }`), and the functions `createReadTokenRecord(db, input)`, `listReadTokens(db, scope)`, `findReadTokenByPrefix(db, prefix)`, `updateReadTokenLastUsed(db, id)`, `updateReadToken(db, input)`, `revokeReadToken(db, input)`.

- [ ] **Step 1: Write the migration**

Create `packages/db/migrations/0047_read_tokens.sql`:

```sql
CREATE TABLE IF NOT EXISTS read_tokens (
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

CREATE INDEX IF NOT EXISTS read_tokens_scope_created_idx
  ON read_tokens(project_id, environment_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS read_tokens_active_prefix_idx
  ON read_tokens(prefix)
  WHERE revoked_at IS NULL;
```

- [ ] **Step 2: Add the schema type**

In `packages/db/src/schema.ts`, add next to `SourceMapUploadTokensTable`:

```ts
export type ReadTokensTable = {
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

and register it on the database interface beside `source_map_upload_tokens`:

```ts
  read_tokens: ReadTokensTable;
```

- [ ] **Step 3: Write the failing repository tests**

Open `packages/db/test/repositories.test.ts`, find the existing `source map upload tokens` describe block, and append a sibling block. Use whatever helper that block uses to create a project/environment — do not invent one.

```ts
describe("read tokens", () => {
  it("creates a token inside an active scope and lists it", async () => {
    await withDb(async (db) => {
      const scope = await seedProjectEnvironment(db);
      const created = await createReadTokenRecord(db, {
        ...scope,
        name: "mcp",
        prefix: "shread_abc12345",
        hash: "deadbeef",
      });

      expect(created.name).toBe("mcp");
      expect(created.revokedAt).toBeNull();
      expect(created.lastUsedAt).toBeNull();

      const listed = await listReadTokens(db, scope);
      expect(listed.map((token) => token.id)).toEqual([created.id]);
    });
  });

  it("refuses to create a token in an archived scope", async () => {
    await withDb(async (db) => {
      const scope = await seedProjectEnvironment(db);
      await db
        .updateTable("environments")
        .set({ archived_at: new Date() })
        .where("id", "=", scope.environmentId)
        .execute();

      await expect(
        createReadTokenRecord(db, { ...scope, name: "mcp", prefix: "shread_abc12345", hash: "deadbeef" })
      ).rejects.toThrow("active_read_token_scope_not_found");
    });
  });

  it("finds an active token by prefix and skips revoked ones", async () => {
    await withDb(async (db) => {
      const scope = await seedProjectEnvironment(db);
      const created = await createReadTokenRecord(db, {
        ...scope,
        name: "mcp",
        prefix: "shread_abc12345",
        hash: "deadbeef",
      });

      expect((await findReadTokenByPrefix(db, "shread_abc12345"))?.id).toBe(created.id);

      await revokeReadToken(db, { ...scope, id: created.id });
      expect(await findReadTokenByPrefix(db, "shread_abc12345")).toBeUndefined();
    });
  });

  it("stamps last_used_at only while the token is active", async () => {
    await withDb(async (db) => {
      const scope = await seedProjectEnvironment(db);
      const created = await createReadTokenRecord(db, {
        ...scope,
        name: "mcp",
        prefix: "shread_abc12345",
        hash: "deadbeef",
      });

      await updateReadTokenLastUsed(db, created.id);
      const [used] = await listReadTokens(db, scope);
      expect(used.lastUsedAt).not.toBeNull();

      await revokeReadToken(db, { ...scope, id: created.id });
      const before = (await listReadTokens(db, scope))[0].lastUsedAt;
      await updateReadTokenLastUsed(db, created.id);
      const after = (await listReadTokens(db, scope))[0].lastUsedAt;
      expect(after).toEqual(before);
    });
  });

  it("renames a token without rotating its secret material", async () => {
    await withDb(async (db) => {
      const scope = await seedProjectEnvironment(db);
      const created = await createReadTokenRecord(db, {
        ...scope,
        name: "mcp",
        prefix: "shread_abc12345",
        hash: "deadbeef",
      });

      const renamed = await updateReadToken(db, { ...scope, id: created.id, name: "claude-desktop" });
      expect(renamed?.name).toBe("claude-desktop");
      expect(renamed?.prefix).toBe(created.prefix);
      expect(renamed?.hash).toBe(created.hash);
    });
  });
});
```

Replace `seedProjectEnvironment` with the helper the neighbouring block actually uses, and add the imports for the six repository functions to the file's import list.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm vitest run packages/db/test/repositories.test.ts -t "read tokens"`
Expected: FAIL — the module `../src/repositories/read-tokens.js` does not exist.

- [ ] **Step 5: Write the repository**

Create `packages/db/src/repositories/read-tokens.ts` as a structural copy of `source-map-upload-tokens.ts`, renaming the entity and the table. The scope guard must stay — it is what keeps reads out of archived scopes (PER-474):

```ts
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
```

Then export it from `packages/db/src/index.ts` the same way `source-map-upload-tokens.ts` is exported.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db/test/repositories.test.ts -t "read tokens"`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/db/migrations/0047_read_tokens.sql packages/db/src/schema.ts packages/db/src/repositories/read-tokens.ts packages/db/src/index.ts packages/db/test/repositories.test.ts
git commit -m "feat(db): add scoped revocable read tokens (PER-478)"
```

---

### Task 2: `createReadToken` secret generator

**Files:**
- Modify: `packages/telemetry/src/api-keys.ts`
- Test: `packages/telemetry/test/api-keys.test.ts`

**Interfaces:**
- Consumes: `CreatedApiKey` from Task 1's unchanged neighbours (already exported by this file).
- Produces: `createReadToken(): CreatedApiKey` — secret `shread_<40 chars>`, prefix `secret.slice(0, 16)`.

- [ ] **Step 1: Write the failing test**

Append to `packages/telemetry/test/api-keys.test.ts`:

```ts
describe("createReadToken", () => {
  it("mints a prefixed secret whose stored prefix is its first 16 characters", () => {
    const token = createReadToken();

    expect(token.secret.startsWith("shread_")).toBe(true);
    expect(token.secret).toHaveLength(47);
    expect(token.prefix).toBe(token.secret.slice(0, 16));
  });

  it("mints a distinct secret each call", () => {
    expect(createReadToken().secret).not.toBe(createReadToken().secret);
  });

  it("verifies its own secret against the stored hash and rejects a neighbour", async () => {
    const token = createReadToken();
    const hash = await hashApiKey(token.secret, "pepper");

    expect(await verifyApiKey(hash, token.secret, "pepper")).toBe(true);
    expect(await verifyApiKey(hash, createReadToken().secret, "pepper")).toBe(false);
  });
});
```

Add `createReadToken` to the file's existing import from `../src/api-keys.js`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/telemetry/test/api-keys.test.ts -t "createReadToken"`
Expected: FAIL — `createReadToken is not a function`.

- [ ] **Step 3: Write the implementation**

In `packages/telemetry/src/api-keys.ts`, add the alphabet beside the existing two and the factory beside `createSourceMapUploadToken`:

```ts
const readTokenId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 40);
```

```ts
export function createReadToken(): CreatedApiKey {
  const secret = `shread_${readTokenId()}`;
  return {
    secret,
    prefix: secret.slice(0, 16)
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/telemetry/test/api-keys.test.ts -t "createReadToken"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry/src/api-keys.ts packages/telemetry/test/api-keys.test.ts
git commit -m "feat(telemetry): mint shread_ read token secrets (PER-478)"
```

---

### Task 3: Admin routes for read tokens

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/openapi.ts`
- Test: `apps/api/test/admin.test.ts`

**Interfaces:**
- Consumes: `createReadToken()` from Task 2; `ReadTokenRecord` shape from Task 1.
- Produces: `ReadTokenResponse` and `ReadTokenAdministrationDependencies` exported from `admin.ts`, plus the `readTokens` and `createReadToken` fields on `AdminRouteOptions`. Task 4 wires them; Task 7 consumes the HTTP surface.

- [ ] **Step 1: Write the failing route tests**

Append to `apps/api/test/admin.test.ts`, mirroring the existing source-map-upload-token block's harness (it builds the app with fake dependencies — reuse that builder, do not create a second one):

```ts
describe("read token administration", () => {
  it("returns the secret exactly once, on create", async () => {
    const app = await buildAdminTestApp({
      readTokens: fakeReadTokenRepository(),
      createReadToken: () => ({ secret: "shread_testsecret", prefix: "shread_testsec" }),
      apiKeyPepper: "pepper",
    });

    const created = await app.inject({
      method: "POST",
      url: "/admin/read-tokens",
      headers: adminHeaders,
      payload: { projectId: "prj_1", environmentId: "env_1", name: "mcp" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().token.secret).toBe("shread_testsecret");

    const listed = await app.inject({
      method: "GET",
      url: "/admin/read-tokens?project_id=prj_1&environment_id=env_1",
      headers: adminHeaders,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().tokens[0]).not.toHaveProperty("secret");
    expect(listed.json().tokens[0]).not.toHaveProperty("hash");
  });

  it("rejects an anonymous caller", async () => {
    const app = await buildAdminTestApp({ readTokens: fakeReadTokenRepository() });
    const response = await app.inject({
      method: "GET",
      url: "/admin/read-tokens?project_id=prj_1&environment_id=env_1",
    });
    expect(response.statusCode).toBe(401);
  });

  it("answers 404 when the scope is archived or missing", async () => {
    const app = await buildAdminTestApp({
      readTokens: {
        ...fakeReadTokenRepository(),
        create: async () => {
          throw new Error("active_read_token_scope_not_found");
        },
      },
      createReadToken: () => ({ secret: "shread_testsecret", prefix: "shread_testsec" }),
      apiKeyPepper: "pepper",
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/read-tokens",
      headers: adminHeaders,
      payload: { projectId: "prj_gone", environmentId: "env_gone", name: "mcp" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("read_token_scope_not_found");
  });

  it("renames and revokes within the scope", async () => {
    const repository = fakeReadTokenRepository();
    const app = await buildAdminTestApp({ readTokens: repository, apiKeyPepper: "pepper" });

    const renamed = await app.inject({
      method: "PATCH",
      url: "/admin/read-tokens/rdtok_1?project_id=prj_1&environment_id=env_1",
      headers: adminHeaders,
      payload: { name: "claude-desktop" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().token.name).toBe("claude-desktop");

    const revoked = await app.inject({
      method: "DELETE",
      url: "/admin/read-tokens/rdtok_1?project_id=prj_1&environment_id=env_1",
      headers: adminHeaders,
    });
    expect(revoked.statusCode).toBe(204);
  });
});
```

Write `fakeReadTokenRepository()` in the same file as a small in-memory object satisfying `ReadTokenAdministrationDependencies`, seeded with one token whose id is `rdtok_1`, project `prj_1`, environment `env_1`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/api/test/admin.test.ts -t "read token administration"`
Expected: FAIL — all four routes return 404, since they are not registered.

- [ ] **Step 3: Add the types, schemas and redactor**

In `apps/api/src/routes/admin.ts`, beside the source-map-upload-token equivalents:

```ts
export type ReadTokenResponse = {
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

export type ReadTokenAdministrationDependencies = {
  list?: (scope: { projectId: string; environmentId: string }) => Promise<ReadTokenResponse[]>;
  create?: (input: {
    projectId: string;
    environmentId: string;
    name: string;
    prefix: string;
    hash: string;
  }) => Promise<ReadTokenResponse>;
  update?: (
    input: { id: string; projectId: string; environmentId: string } & UpdateReadTokenInput
  ) => Promise<ReadTokenResponse | null | undefined>;
  revoke?: (input: { id: string; projectId: string; environmentId: string }) => Promise<void>;
};
```

Add to `AdminRouteOptions`:

```ts
  readTokens?: ReadTokenAdministrationDependencies;
  createReadToken?: () => { secret: string; prefix: string };
```

Schemas beside `createSourceMapUploadTokenSchema`:

```ts
const readTokenScopeQuerySchema = z.object({
  project_id: z.string().trim().min(1),
  environment_id: z.string().trim().min(1)
});

const createReadTokenSchema = z.object({
  projectId: z.string().trim().min(1),
  environmentId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(256)
});

const updateReadTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(256).optional()
  })
  .refine((input) => Object.keys(input).length > 0, { message: "at_least_one_field_required" });
```

```ts
type UpdateReadTokenInput = z.infer<typeof updateReadTokenSchema>;

function redactReadToken(token: ReadTokenResponse): Omit<ReadTokenResponse, "hash"> {
  return {
    id: token.id,
    projectId: token.projectId,
    environmentId: token.environmentId,
    name: token.name,
    prefix: token.prefix,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    revokedAt: token.revokedAt
  };
}
```

- [ ] **Step 4: Register the four routes**

Directly after the `/admin/source-map-upload-tokens` block (`admin.ts:3814-3931`), add the same four handlers with the read-token names. Keep every guard: `requireAdmin` first, `501` when the repository is absent, `400` on a schema miss, `404` on `active_read_token_scope_not_found`, and the secret only on the `201`.

```ts
  app.get("/admin/read-tokens", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.readTokens?.list) {
      return reply.status(501).send({ error: "read_tokens_repository_unavailable" });
    }

    const parsed = readTokenScopeQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_read_token_request" });
    }

    const tokens = await options.readTokens.list({
      projectId: parsed.data.project_id,
      environmentId: parsed.data.environment_id
    });

    return reply.send({ tokens: tokens.map(redactReadToken) });
  });

  app.post("/admin/read-tokens", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.readTokens?.create) {
      return reply.status(501).send({ error: "read_tokens_repository_unavailable" });
    }

    const parsed = createReadTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_read_token_request" });
    }

    const generatedToken = options.createReadToken?.() ?? createReadToken();
    const hash = await hashAdminApiKeySecret(generatedToken.secret, options);
    if (!hash) {
      return reply.status(501).send({ error: "read_token_hashing_unavailable" });
    }

    let token: ReadTokenResponse;
    try {
      token = await options.readTokens.create({
        projectId: parsed.data.projectId,
        environmentId: parsed.data.environmentId,
        name: parsed.data.name,
        prefix: generatedToken.prefix,
        hash
      });
    } catch (error) {
      if (isKnownAdminResourceError(error, "active_read_token_scope_not_found")) {
        return reply.status(404).send({ error: "read_token_scope_not_found" });
      }
      throw error;
    }

    return reply.status(201).send({
      token: {
        ...redactReadToken(token),
        secret: generatedToken.secret
      }
    });
  });

  app.patch("/admin/read-tokens/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.readTokens?.update) {
      return reply.status(501).send({ error: "read_tokens_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    const query = readTokenScopeQuerySchema.safeParse(request.query);
    const parsed = updateReadTokenSchema.safeParse(request.body);
    if (!params.success || !query.success || !parsed.success) {
      return reply.status(400).send({ error: "invalid_read_token_request" });
    }

    const token = await options.readTokens.update({
      id: params.data.id,
      projectId: query.data.project_id,
      environmentId: query.data.environment_id,
      ...parsed.data
    });
    if (!token) {
      return reply.status(404).send({ error: "read_token_not_found" });
    }

    return reply.send({ token: redactReadToken(token) });
  });

  app.delete("/admin/read-tokens/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, options.auth);
    if (!admin) {
      return reply;
    }

    if (!options.readTokens?.revoke) {
      return reply.status(501).send({ error: "read_tokens_repository_unavailable" });
    }

    const params = idParamsSchema.safeParse(request.params);
    const query = readTokenScopeQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({ error: "invalid_read_token_request" });
    }

    await options.readTokens.revoke({
      id: params.data.id,
      projectId: query.data.project_id,
      environmentId: query.data.environment_id
    });

    return reply.status(204).send();
  });
```

Import `createReadToken` from `@sigmon/telemetry` alongside the existing `createSourceMapUploadToken` import.

- [ ] **Step 5: Run the route tests to verify they pass**

Run: `pnpm vitest run apps/api/test/admin.test.ts -t "read token administration"`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the OpenAPI coverage test to see it name the new routes**

Run: `pnpm vitest run apps/api/test/openapi-coverage.test.ts`
Expected: FAIL, naming `GET /admin/read-tokens`, `POST /admin/read-tokens`, `PATCH /admin/read-tokens/:id`, `DELETE /admin/read-tokens/:id`.

- [ ] **Step 7: Document the four routes in the OpenAPI spec**

In `apps/api/src/openapi.ts`, find the `/admin/source-map-upload-tokens` entries and add the read-token equivalents next to them. Derive each parameter and response from the handler you just wrote, not from the route name: the scope query parameters are `project_id` and `environment_id`; the create body is `{ projectId, environmentId, name }`; the `201` response carries `token` with `secret` and **no** `hash`; the `200` responses carry `token`/`tokens` with neither `secret` nor `hash`; document `400`, `401`, `404`, `501`, and `204` on delete.

- [ ] **Step 8: Run the coverage test to verify it passes**

Run: `pnpm vitest run apps/api/test/openapi-coverage.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/openapi.ts apps/api/test/admin.test.ts
git commit -m "feat(api): administer read tokens from the console (PER-478)"
```

---

### Task 4: Runtime wiring

**Files:**
- Modify: `apps/api/src/main.ts` (the options object around lines 1004-1041)
- Modify: `apps/api/src/app.ts` (thread `readTokens`, `createReadToken` and the new `verifyReadToken` through to the admin and query registrations)
- Test: `apps/api/test/startup-shutdown.test.ts` (only if that suite asserts the shape of the options object; otherwise no test file changes — Task 5 exercises the verifier)

**Interfaces:**
- Consumes: the repository functions from Task 1, the generator from Task 2, `ReadTokenAdministrationDependencies` from Task 3.
- Produces: `verifyReadToken(secret) => Promise<{ id, projectId, environmentId } | null>` on the query route options. Task 5 consumes it.

- [ ] **Step 1: Wire the admin repository**

In `apps/api/src/main.ts`, beside the existing `sourceMapUploadTokens` block:

```ts
  readTokens: {
    list: (scope) => listReadTokens(db, scope),
    create: (input) => createReadTokenRecord(db, input),
    update: (input) => updateReadToken(db, input),
    revoke: (input) => revokeReadToken(db, input)
  },
```

- [ ] **Step 2: Wire the verifier**

Still in `main.ts`, inside the `query` options object, add — mirroring `sourceMapUploads.verifyToken` exactly, including the `slice(0, 16)` that must match the prefix length from Task 2:

```ts
    verifyReadToken: async (secret: string) => {
      const token = await findReadTokenByPrefix(db, secret.slice(0, 16));
      if (!token) {
        return null;
      }

      const valid = await verifyApiKey(token.hash, secret, config.apiKeyPepper);
      if (!valid) {
        return null;
      }

      await updateReadTokenLastUsed(db, token.id);
      return {
        id: token.id,
        projectId: token.projectId,
        environmentId: token.environmentId
      };
    },
```

Add the four repository imports to the file's `@sigmon/db` import.

- [ ] **Step 3: Thread the options through `app.ts`**

In `apps/api/src/app.ts`, add `readTokens` and `createReadToken` to the object passed to `registerAdminRoutes`, and pass the `query` options through to `registerQueryRoutes` unchanged — `verifyReadToken` rides inside `options.query`, so no new parameter is needed at the `app.ts` level beyond the type widening.

- [ ] **Step 4: Verify the app still builds and boots**

Run: `pnpm --filter @sigmon/api lint && pnpm vitest run apps/api/test/startup-shutdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/main.ts apps/api/src/app.ts
git commit -m "feat(api): wire the read token repository and verifier (PER-478)"
```

---

### Task 5: Bearer principal on the query read path

**Files:**
- Create: `apps/api/src/routes/bearer.ts` (move `parseBearerToken` here)
- Modify: `apps/api/src/routes/source-map-uploads.ts:17` (import instead of redefining)
- Modify: `apps/api/src/routes/query.ts` (`requireHumanUser` at line 1687 becomes `requireQueryPrincipal`; the ~30 call sites keep working through a thin `requireHumanUser`-shaped wrapper only where a handler genuinely needs the user object)
- Test: `apps/api/test/query.test.ts`

**Interfaces:**
- Consumes: `verifyReadToken` from Task 4.
- Produces: `QueryPrincipal` union and `requireQueryPrincipal(request, reply, options)`. Task 6 consumes both.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/query.test.ts`, reusing that file's existing app builder:

```ts
describe("read token principal", () => {
  it("serves a read route to a valid bearer token", async () => {
    const app = await buildQueryTestApp({
      verifyReadToken: async (secret: string) =>
        secret === "shread_good" ? { id: "rdtok_1", projectId: "prj_1", environmentId: "env_1" } : null,
      query: { listEvents: async () => ({ data: [] }) },
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1",
      headers: { authorization: "Bearer shread_good" },
    });

    expect(response.statusCode).toBe(200);
  });

  it("rejects an unknown bearer token", async () => {
    const app = await buildQueryTestApp({ verifyReadToken: async () => null });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1",
      headers: { authorization: "Bearer shread_bad" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("unauthenticated");
  });

  it("overrides the requested scope with the token scope", async () => {
    let seen: { projectId?: string; environmentId?: string } = {};
    const app = await buildQueryTestApp({
      verifyReadToken: async () => ({ id: "rdtok_1", projectId: "prj_mine", environmentId: "env_mine" }),
      query: {
        listEvents: async (filters) => {
          seen = { projectId: filters.projectId, environmentId: filters.environmentId };
          return { data: [] };
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_someone_else&environment_id=env_someone_else",
      headers: { authorization: "Bearer shread_good" },
    });

    expect(response.statusCode).toBe(200);
    expect(seen).toEqual({ projectId: "prj_mine", environmentId: "env_mine" });
  });

  it("leaves cookie session behaviour untouched", async () => {
    const app = await buildQueryTestApp({
      auth: { findSessionUser: async () => ({ id: "usr_1", email: "a@b.c" }) },
      verifyReadToken: async () => null,
      query: { listEvents: async () => ({ data: [] }) },
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1",
      headers: { cookie: sessionCookie },
    });

    expect(response.statusCode).toBe(200);
  });
});
```

Adapt `buildQueryTestApp`, `sessionCookie` and the `query` dependency names to whatever that suite already uses.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/api/test/query.test.ts -t "read token principal"`
Expected: FAIL — bearer requests return 401 because only the cookie path exists.

- [ ] **Step 3: Extract the bearer parser**

Create `apps/api/src/routes/bearer.ts`:

```ts
import type { FastifyRequest } from "fastify";

export function parseBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string") {
    return undefined;
  }

  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1];
}
```

Delete the local copy in `source-map-uploads.ts` and import from `./bearer.js`.

- [ ] **Step 4: Add the principal to the query guard**

In `apps/api/src/routes/query.ts`, add to `QueryRouteOptions`:

```ts
  verifyReadToken?: (secret: string) => Promise<{ id: string; projectId: string; environmentId: string } | null | undefined>;
```

and replace `requireHumanUser` with:

```ts
export type QueryPrincipal =
  | { kind: "user"; user: AuthenticatedUser }
  | { kind: "read-token"; tokenId: string; projectId: string; environmentId: string };

async function requireQueryPrincipal(
  request: FastifyRequest,
  reply: FastifyReply,
  options: QueryRouteOptions
): Promise<QueryPrincipal | undefined> {
  const user = await options.auth?.findSessionUser(
    request as Parameters<AuthDependencies["findSessionUser"]>[0]
  );
  if (user) {
    setCurrentUser(request, user);
    return { kind: "user", user };
  }

  const secret = parseBearerToken(request);
  if (secret && options.verifyReadToken) {
    const token = await options.verifyReadToken(secret);
    if (token) {
      setCurrentUser(request, null);
      return {
        kind: "read-token",
        tokenId: token.id,
        projectId: token.projectId,
        environmentId: token.environmentId
      };
    }
  }

  setCurrentUser(request, null);
  reply.status(401).send({ error: "unauthenticated" });
  return undefined;
}
```

- [ ] **Step 5: Make the token scope override the requested scope**

Find where the handlers build `QueryFilters` from the query string (the `optionalNonEmpty`/`filters` construction around `query.ts:544`). After the filters are parsed and before the repository call, apply:

```ts
function applyPrincipalScope(filters: QueryFilters, principal: QueryPrincipal): QueryFilters {
  if (principal.kind !== "read-token") {
    return filters;
  }

  return { ...filters, projectId: principal.projectId, environmentId: principal.environmentId };
}
```

Call it in `handleListRoute`, `handleAggregateRoute` and every other shared handler that reaches a repository, immediately after the filters are built. Overriding — not validating — is the point: a mismatch must become the token's own scope, never an empty result the caller reads as "nothing happened".

- [ ] **Step 6: Update the call sites**

Replace each `const user = await requireHumanUser(request, reply, options.auth)` with `const principal = await requireQueryPrincipal(request, reply, options)`. Where the handler used `user` for authorship (notes, external issues), keep it working by reading `principal.kind === "user" ? principal.user : undefined` — Task 6 makes those paths unreachable for tokens anyway.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api/test/query.test.ts`
Expected: PASS — the four new tests plus the entire existing suite, unchanged.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/bearer.ts apps/api/src/routes/query.ts apps/api/src/routes/source-map-uploads.ts apps/api/test/query.test.ts
git commit -m "feat(api): accept scoped read tokens on query reads (PER-478)"
```

---

### Task 6: Refuse read tokens on the six query mutations

**Files:**
- Modify: `apps/api/src/routes/query.ts`
- Test: `apps/api/test/query.test.ts`

**Interfaces:**
- Consumes: `QueryPrincipal` and `requireQueryPrincipal` from Task 5.
- Produces: nothing new; closes the write surface.

- [ ] **Step 1: Write the failing tests**

One test per mutation. A loop keeps them honest and makes the next added mutation obvious:

```ts
describe("read tokens are refused on query mutations", () => {
  const mutations = [
    { method: "PATCH" as const, url: "/query/feedback/fb_1", payload: { status: "reviewed" } },
    { method: "PATCH" as const, url: "/query/error-groups/grp_1", payload: { status: "resolved" } },
    { method: "POST" as const, url: "/query/incidents/error-groups/grp_1/notes", payload: { body: "x" } },
    { method: "POST" as const, url: "/query/incidents/error-groups/grp_1/external-issues", payload: {} },
    { method: "POST" as const, url: "/query/incidents/error-groups/grp_1/external-issues/draft", payload: {} },
    { method: "POST" as const, url: "/query/incidents/error-groups/grp_1/silence", payload: { minutes: 30 } },
  ];

  for (const mutation of mutations) {
    it(`refuses ${mutation.method} ${mutation.url}`, async () => {
      const app = await buildQueryTestApp({
        verifyReadToken: async () => ({ id: "rdtok_1", projectId: "prj_1", environmentId: "env_1" }),
      });

      const response = await app.inject({
        method: mutation.method,
        url: `${mutation.url}?project_id=prj_1&environment_id=env_1`,
        headers: { authorization: "Bearer shread_good" },
        payload: mutation.payload,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe("read_token_is_read_only");
    });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/api/test/query.test.ts -t "refused on query mutations"`
Expected: FAIL — the mutations accept the token and answer 200/404 instead of 403.

- [ ] **Step 3: Add the refusal helper**

In `query.ts`:

```ts
function refuseReadToken(reply: FastifyReply, principal: QueryPrincipal): boolean {
  if (principal.kind !== "read-token") {
    return false;
  }

  reply.status(403).send({ error: "read_token_is_read_only" });
  return true;
}
```

- [ ] **Step 4: Call it in each of the six mutation handlers**

In every mutation handler, immediately after obtaining the principal:

```ts
    const principal = await requireQueryPrincipal(request, reply, options);
    if (!principal || refuseReadToken(reply, principal)) {
      return reply;
    }
```

The six handlers are those behind `PATCH /query/feedback/:id`, `PATCH /query/error-groups/:id`, `POST /query/incidents/error-groups/:id/notes`, `POST /query/incidents/error-groups/:id/external-issues`, `POST /query/incidents/error-groups/:id/external-issues/draft`, and `POST /query/incidents/error-groups/:id/silence`. Put the check in the handler, never in a path allowlist — an allowlist of strings goes stale silently the day someone adds a route, and its test keeps passing.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api/test/query.test.ts`
Expected: PASS — six new tests plus the whole existing suite.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/query.ts apps/api/test/query.test.ts
git commit -m "feat(api): refuse read tokens on every query mutation (PER-478)"
```

---

### Task 7: Read tokens section in Project Settings

**Files:**
- Create: `apps/console/src/v2/screens/useReadTokens.ts`
- Create: `apps/console/src/v2/screens/ReadTokensSection.tsx`
- Create: `apps/console/src/v2/screens/ReadTokensSection.test.tsx`
- Create: `apps/console/src/v2/screens/useReadTokens.test.ts`
- Modify: `apps/console/src/api/client.ts` (four methods) and `apps/console/src/api/types.ts` (a `ReadToken` type)
- Modify: whichever Project Settings screen composes its sections, adding `ReadTokensSection` beside the existing ones

**Interfaces:**
- Consumes: the HTTP surface from Task 3.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the API client methods and type**

`ReadToken` in `types.ts` mirrors `SourceMapUploadToken` minus nothing: `{ id, projectId, environmentId, name, prefix, createdAt, lastUsedAt, revokedAt }`. There is no `secret` field on the list type — the secret exists only on the create response, so type the create method's return as `ReadToken & { secret: string }`.

Add `listReadTokens`, `createReadToken`, `renameReadToken`, `revokeReadToken` to the client, copying the source-map-upload-token methods' shape including how they pass `project_id`/`environment_id`.

- [ ] **Step 2: Write the failing hook test**

`apps/console/src/v2/screens/useReadTokens.test.ts` — mirror `useArtifacts.test.ts`'s harness:

```ts
it("surfaces the created secret once and clears it on demand", async () => {
  const client = fakeClient({
    createReadToken: async () => ({ ...tokenFixture, secret: "shread_visible_once" }),
  });
  const ctx = fakeCtx();
  const { result } = renderHook(() => useReadTokens({ client, ctx, projectId: "prj_1", environmentId: "env_1" }));

  await act(async () => {
    await result.current.createToken("mcp");
  });

  expect(ctx.onSecretCreated).toHaveBeenCalledWith("shread_visible_once");
});

it("never reads a secret back from the list", async () => {
  const client = fakeClient({ listReadTokens: async () => [tokenFixture] });
  const ctx = fakeCtx();
  const { result } = renderHook(() => useReadTokens({ client, ctx, projectId: "prj_1", environmentId: "env_1" }));

  await waitFor(() => expect(result.current.status).toBe("ok"));
  expect(JSON.stringify(result.current.data)).not.toContain("shread_");
});
```

- [ ] **Step 3: Run the hook test to verify it fails**

Run: `pnpm --filter @sigmon/console test -- useReadTokens`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Write the hook**

Model `useReadTokens.ts` on `useArtifacts.ts`, but hand the one-time secret **up** rather than holding it: call `ctx.onSecretCreated(created.secret)` and read it back from `ctx.createdSecret`. `ConsoleShellV2` remounts each screen via `key={seq}`, so a secret held in screen or hook state dies on the reload that follows the mutation — that is exactly the PER-467 failure, and `UI-UX.md` records the rule. Every mutation goes through `runMutation()`.

Note for the reviewer: `useArtifacts.ts` still holds its own `latestSecret` in hook state. It survives today only because that hook reloads itself rather than calling `ctx.reload`. Do not copy that half — and do not fix it in this task either; it is a separate finding.

- [ ] **Step 5: Run the hook test to verify it passes**

Run: `pnpm --filter @sigmon/console test -- useReadTokens`
Expected: PASS.

- [ ] **Step 6: Write the failing section test**

`ReadTokensSection.test.tsx` renders the section with a fake ctx and asserts: the token list shows `prefix`, name, created and last-used labels, and a revoked badge; the secret panel appears when `ctx.createdSecret` is set and disappears when cleared; the create form is disabled while busy.

- [ ] **Step 7: Write the section**

Model `ReadTokensSection.tsx` on the token half of `ArtifactsSection.tsx`, reusing `SecretField`, `ConfirmButton`, `EmptyHint` and `Icon` from `../../components/ui/v2`. Copy must say the secret is shown once and cannot be recovered, and must name what the token can do: read-only, this project and environment only.

- [ ] **Step 8: Mount it in Project Settings**

Add `<ReadTokensSection ctx={ctx} />` to the Project Settings screen beside the existing sections.

- [ ] **Step 9: Run the console gates**

Run: `pnpm --filter @sigmon/console test && pnpm --filter @sigmon/console lint`
Expected: PASS both. The lint step is `tsc` — vitest strips types, so a type error only surfaces here.

- [ ] **Step 10: Commit**

```bash
git add apps/console/src
git commit -m "feat(console): manage read tokens from Project Settings (PER-478)"
```

---

### Task 8: Documentation and guardrails

**Files:**
- Modify: `.claude/docs/DECISIONS.md`, `.claude/docs/CONSTRAINTS.md`, `.claude/docs/ARCHITECTURE.md`, `.claude/docs/UI-UX.md`, `.claude/docs/PROJECT-SUMMARY.md`, `.claude/GUARDRAILS.md`, `CLAUDE.md`

- [ ] **Step 1: Write the ADR**

Add to `.claude/docs/DECISIONS.md`, dated the day the work lands, covering two decisions and their rejected alternatives: a **new credential type** rather than reusing the session cookie (the cookie is stateless for 7 days with no revocation — PER-473 — and reuse would have put an admin password in a local agent config), and **overriding** the requested scope rather than validating it (validating returns an empty list that a caller reads as "no data", while overriding makes the scope a fact).

- [ ] **Step 2: Add the constraints**

Add to `.claude/docs/CONSTRAINTS.md`:

```
- Read tokens are read-only. Every mutation handler under `/query/*` must refuse a read-token principal explicitly; the refusal lives in the handler, never in a path allowlist.
- A read token's project and environment override the requested scope. Query parameters are not validated against the token — they are replaced by it.
- Read token secrets are shown once, on creation. No route may return one afterwards, and no console screen may hold one below the shell remount boundary.
```

- [ ] **Step 3: Add the guardrail rows**

Add to the table in `.claude/GUARDRAILS.md`:

```
| Guard de `/query/*` (`requireQueryPrincipal`) | `CONSTRAINTS.md`, `DECISIONS.md` | principal de read token só passa em leitura; escopo do token sobrescreve o da query string, nunca é validado contra ela |
| Mutação nova em `apps/api/src/routes/query.ts` | `CONSTRAINTS.md` | todo handler de mutação precisa recusar read token explicitamente — não existe allowlist de path que faça isso por você |
```

Bump `Última revisão`.

- [ ] **Step 4: Update the surface docs**

`ARCHITECTURE.md`: read tokens as the non-human read path into `/query/*`. `UI-UX.md`: the Read tokens section and its one-time secret copy. `PROJECT-SUMMARY.md`: add the capability line. `CLAUDE.md`: one convention line stating read tokens are read-only and scope-overriding.

- [ ] **Step 5: Run the full gate**

```bash
pnpm test
pnpm build
pnpm --filter @sigmon/sdk build
docker compose config
```

Expected: all green. `pnpm test` currently has one pre-existing failure in `packages/db/test/repositories.test.ts` (the GIN plan assertion, PER-475) — confirm that is the only failure and that it is unrelated to this work.

- [ ] **Step 6: Commit**

```bash
git add .claude CLAUDE.md
git commit -m "docs: record the read token decision and its guardrails (PER-478)"
```

---

## Self-review

**Spec coverage:** table and repository → Task 1 · secret generator → Task 2 · admin routes and OpenAPI → Task 3 · runtime wiring → Task 4 · guard and scope override → Task 5 · mutation refusal → Task 6 · console section and the one-time secret rule → Task 7 · ADR, constraints, guardrails → Task 8. The spec's phase 2 (`@sigmon/mcp`) is deliberately out of this plan and gets its own.

**Corrections against the spec:** the spec wrote the secret prefix as `smr_`; the repo's convention is `sh_` / `shsmap_`, so this plan uses `shread_` and the spec should be amended to match.

**Type consistency:** `ReadTokenRecord` (db) → `ReadTokenResponse` (api) → `ReadToken` (console) are three deliberate names for three layers, matching how the source-map upload token is named at each layer. `verifyReadToken` returns `{ id, projectId, environmentId }` in Task 4 and is consumed with those exact fields in Task 5. `prefix` is `slice(0, 16)` in Task 2 and looked up with the same `slice(0, 16)` in Task 4.
