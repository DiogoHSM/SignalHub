# Authentication, Sessions, and Secret Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unrevocable signed cookies with opaque database sessions, bound login abuse/Argon2 work, and encrypt privileged integration credentials at rest.

**Architecture:** Add repository-owned sessions and a Redis-backed login guard, then move authentication orchestration out of ad-hoc `main.ts` helpers. Add a small AES-256-GCM secret box with current/previous key rotation and migrate warehouse/webhook secrets through encrypted columns plus a restartable command.

**Tech Stack:** TypeScript, Fastify, PostgreSQL/Kysely, Redis/ioredis, Node crypto AES-256-GCM, Argon2id, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-auth-sessions-secret-storage-design.md`

## Global Constraints

- Session cookies contain only a random 32-byte opaque token; the database stores only SHA-256 hashes.
- Logout, password change, and user archival revoke sessions transactionally.
- Missing/passwordless and password-backed accounts each perform one Argon2 verification and return the same `401 invalid_credentials` contract.
- Login passwords are bounded to 1,024 UTF-8 bytes before Argon2.
- Privileged secrets use AES-256-GCM with table/row/field associated data and current/previous key rotation.
- Existing plaintext is cleared only after verified encryption; privileged work refuses to run while legacy plaintext remains.
- Peppered SHA-256 remains the API-key strategy and is documented as an explicit decision.

---

### Task 1: Session schema and repository

**Files:**
- Create: `packages/db/migrations/0049_auth_sessions.sql`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/repositories/auth-sessions.ts`
- Create: `packages/db/test/auth-sessions.test.ts`

**Interfaces:**
- Produces: `createAuthSession`, `findActiveSessionUser`, `revokeAuthSession`, `revokeUserSessions`, `pruneExpiredAuthSessions`.
- Consumes: `Db`, user lifecycle columns, repository id generation conventions.

- [ ] **Step 1: Write failing repository tests**

```ts
it("finds only an unexpired unrevoked session for an active user", async () => {
  const tokenHash = "a".repeat(64);
  await createAuthSession(db, { userId, tokenHash, expiresAt: future, now });
  expect((await findActiveSessionUser(db, { tokenHash, now }))?.id).toBe(userId);
  await revokeAuthSession(db, { tokenHash, now });
  expect(await findActiveSessionUser(db, { tokenHash, now })).toBeUndefined();
});

it("rejects a session when its user is archived", async () => {
  await createAuthSession(db, { userId, tokenHash, expiresAt: future, now });
  await archiveUserFixture(db, userId, now);
  expect(await findActiveSessionUser(db, { tokenHash, now })).toBeUndefined();
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/db/test/auth-sessions.test.ts`

Expected: FAIL because the migration and repository do not exist.

- [ ] **Step 3: Add the table and repository**

Migration shape:

```sql
create table auth_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now()
);
create index auth_sessions_user_active_idx on auth_sessions(user_id, expires_at) where revoked_at is null;
```

`findActiveSessionUser` joins `users`, requires both `revoked_at is null` and `users.archived_at is null`, and touches `last_seen_at` only when older than 15 minutes.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm vitest run packages/db/test/auth-sessions.test.ts`

Expected: PASS for active, expired, revoked, and archived-user cases.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0049_auth_sessions.sql packages/db/src/schema.ts packages/db/src/repositories/auth-sessions.ts packages/db/test/auth-sessions.test.ts
git commit -m "feat(auth): persist revocable sessions"
```

### Task 2: Opaque cookie sessions and lifecycle revocation

**Files:**
- Create: `apps/api/src/auth/session-service.ts`
- Create: `apps/api/src/auth/session-service.test.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/test/auth.test.ts`
- Modify: `packages/db/src/repositories/users.ts`
- Modify: `packages/db/test/repositories.test.ts`
- Modify: `apps/api/test/admin.test.ts`

**Interfaces:**
- Consumes: Task 1 repository functions and existing cookie name/options.
- Produces: `createOpaqueSession`, `authenticateOpaqueSession`, `revokeCurrentSession`; transactional user update/archive revocation.

- [ ] **Step 1: Write failing copied-token lifecycle tests**

```ts
it("rejects a copied cookie after logout", async () => {
  const cookie = await loginAndReadCookie(app);
  expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).statusCode).toBe(200);
  await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
  expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).statusCode).toBe(401);
});
```

Add sibling tests for password change, user archival, expiry, malformed token, and a legacy `payload.signature` cookie.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/api/test/auth.test.ts apps/api/test/admin.test.ts`

Expected: copied tokens remain valid after logout/password/archive.

- [ ] **Step 3: Implement the session service**

```ts
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
```

The service creates a DB row before setting the cookie, hashes cookie input before lookup, and revokes before clearing. Delete the signed-payload helpers from `main.ts`.

- [ ] **Step 4: Revoke in user transactions**

Change `updateUserAsAdmin` so a supplied new password updates the user and revokes sessions in the same transaction. Change `archiveUserAsAdmin` to archive and revoke in its existing invariant-protected transaction.

- [ ] **Step 5: Verify GREEN and OAuth compatibility**

Run: `pnpm vitest run apps/api/src/auth/session-service.test.ts apps/api/test/auth.test.ts apps/api/test/admin.test.ts packages/db/test/repositories.test.ts`

Expected: all lifecycle tests PASS; password and Google OAuth login still set the existing cookie name/options.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/session-service.ts apps/api/src/auth/session-service.test.ts apps/api/src/main.ts apps/api/src/routes/auth.ts apps/api/test/auth.test.ts packages/db/src/repositories/users.ts packages/db/test/repositories.test.ts apps/api/test/admin.test.ts
git commit -m "fix(auth): revoke opaque sessions on lifecycle changes"
```

### Task 3: Login abuse and Argon2 admission control

**Files:**
- Create: `apps/api/src/auth/login-guard.ts`
- Create: `apps/api/src/auth/login-guard.test.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/test/auth.test.ts`
- Modify: `packages/telemetry/src/auth.ts`
- Modify: `packages/telemetry/test/auth.test.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/test/config.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `LoginGuard.checkSource`, `checkAccount`, `recordFailure`, `recordSuccess`, `Argon2Semaphore.run`.
- Consumes: API Redis client, normalized email, trusted `request.ip`, injected clock/delay for tests.

- [ ] **Step 1: Write failing route tests**

```ts
it("performs one password verification for an absent account", async () => {
  await app.inject({ method: "POST", url: "/auth/login", payload: credentials("missing@example.com") });
  expect(verifyPasswordSpy).toHaveBeenCalledTimes(1);
  expect(verifyPasswordSpy.mock.calls[0]?.[0]).toBe(DUMMY_PASSWORD_HASH);
});

it("rejects a password larger than 1024 UTF-8 bytes before verification", async () => {
  const response = await app.inject({ method: "POST", url: "/auth/login", payload: credentials("a".repeat(1025)) });
  expect(response.statusCode).toBe(400);
  expect(verifyPasswordSpy).not.toHaveBeenCalled();
});
```

Add source quota, normalized-email HMAC quota, Redis-unavailable `503`, progressive-delay, and max-concurrency tests.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/api/test/auth.test.ts apps/api/src/auth/login-guard.test.ts packages/telemetry/test/auth.test.ts`

Expected: FAIL because absent accounts skip Argon2 and no login guard exists.

- [ ] **Step 3: Implement the guard**

Use Redis `INCR` plus first-write `PEXPIRE` for HMAC account keys and the Fastify login route's existing rate-limit store for source keys. Hash normalized email with `createHmac("sha256", sessionSecret)` before Redis. Implement a FIFO semaphore:

```ts
export class Argon2Semaphore {
  constructor(private readonly limit: number) {}
  run<T>(operation: () => Promise<T>): Promise<T>;
}
```

Always release a permit in `finally`. Config defaults: source 10/min, account 8/15min, Argon2 concurrency 4, progressive delay capped at 2 seconds.

- [ ] **Step 4: Equalize credential work**

Export a valid constant `DUMMY_PASSWORD_HASH` and always call `verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, submittedPassword)`. Only an active user with a real hash and successful result logs in.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm vitest run apps/api/test/auth.test.ts apps/api/src/auth/login-guard.test.ts packages/telemetry/test/auth.test.ts packages/config/test/config.test.ts`

Expected: PASS without real sleeps; route body/status are identical across missing, OAuth-only, and wrong-password accounts.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/login-guard.ts apps/api/src/auth/login-guard.test.ts apps/api/src/routes/auth.ts apps/api/src/main.ts apps/api/test/auth.test.ts packages/telemetry/src/auth.ts packages/telemetry/test/auth.test.ts packages/config/src/index.ts packages/config/test/config.test.ts .env.example
git commit -m "fix(auth): bound login guessing and argon2 work"
```

### Task 4: Versioned AES-GCM secret box and config

**Files:**
- Create: `packages/config/src/secret-box.ts`
- Create: `packages/config/test/secret-box.test.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/test/config.test.ts`
- Modify: `.env.example`
- Modify: `.claude/docs/SECRETS.md`

**Interfaces:**
- Produces: `SecretBox.encrypt(plaintext, context)`, `decrypt(ciphertext, context)`, `needsRotation(ciphertext)`.
- Consumes: `DATA_ENCRYPTION_KEY`, optional `DATA_ENCRYPTION_KEY_PREVIOUS`.

- [ ] **Step 1: Write failing known-answer and tamper tests**

```ts
const context = { table: "warehouse_destinations", rowId: "wh_1", field: "connection_url" };
const encrypted = box.encrypt("postgres://secret", context);
expect(encrypted).not.toContain("postgres");
expect(box.decrypt(encrypted, context)).toBe("postgres://secret");
expect(() => box.decrypt(encrypted, { ...context, rowId: "wh_2" })).toThrow("secret_authentication_failed");
```

Test a previous-key ciphertext and a modified tag.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/config/test/secret-box.test.ts packages/config/test/config.test.ts`

Expected: FAIL because the helper/config values do not exist.

- [ ] **Step 3: Implement the envelope**

Use `aes-256-gcm`, a random 12-byte nonce, 16-byte tag, and canonical AAD `${table}\0${rowId}\0${field}`. Serialize as `v1.<keyId>.<nonce>.<tag>.<ciphertext>` with base64url components. Derive `keyId` from the first 12 hex characters of SHA-256(key), never from the plaintext.

Require a valid current key in production and reject equal current/previous keys.

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run packages/config/test/secret-box.test.ts packages/config/test/config.test.ts`

```bash
git add packages/config/src/secret-box.ts packages/config/test/secret-box.test.ts packages/config/src/index.ts packages/config/test/config.test.ts .env.example .claude/docs/SECRETS.md
git commit -m "feat(security): add rotatable encrypted secret storage"
```

### Task 5: Encrypt warehouse and notification credentials

**Files:**
- Create: `packages/db/migrations/0050_encrypted_integration_secrets.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/repositories/warehouse-exports.ts`
- Modify: `packages/db/test/warehouse-exports.test.ts`
- Modify: `packages/db/src/repositories/alerts.ts`
- Modify: `packages/db/test/alert-evaluation.test.ts`
- Modify: `packages/db/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/worker/src/main.ts`
- Create: `scripts/migrate-integration-secrets.ts`
- Create: `scripts/migrate-integration-secrets.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 4 `SecretBox`, exported from `@sigmon/config`, and current repository create/update/list functions.
- Produces: encrypted columns, worker-only decrypted records, `pnpm secrets:migrate`.

- [ ] **Step 1: Write failing repository tests**

Assert that create/update rows contain `connection_url_encrypted` or `secret_header_value_encrypted`, plaintext columns are null, admin list responses omit secrets, and worker list calls decrypt only when passed a `SecretBox`.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/db/test/warehouse-exports.test.ts packages/db/test/alert-evaluation.test.ts`

Expected: plaintext columns still contain the submitted secrets.

- [ ] **Step 3: Add additive encrypted columns and repository boundaries**

Migration adds nullable encrypted columns without deleting plaintext. Add `@sigmon/config: "workspace:*"` to `@sigmon/db`, refresh the lockfile with `pnpm install --lockfile-only`, and import `SecretBox` from the package entrypoint. Create/update encrypt before write and set plaintext null. Privileged list functions throw `legacy_plaintext_secret_present` if encrypted data is absent but plaintext remains; they do not silently read plaintext.

- [ ] **Step 4: Build the restartable migration test-first**

```ts
export async function migrateIntegrationSecrets(input: {
  kind: "warehouse" | "notification";
  batchSize: number;
  loadBatch: (afterId: string | null, limit: number) => Promise<LegacySecretRow[]>;
  persistEncrypted: (row: LegacySecretRow, ciphertext: string) => Promise<void>;
  box: SecretBox;
}): Promise<{ migrated: number; rotated: number }>;
```

Each row transaction encrypts, decrypt-verifies, writes encrypted data, and clears plaintext. Test interruption/restart, previous-key rotation, tamper failure, and count-only output.

- [ ] **Step 5: Wire API/worker and verify**

Run: `pnpm vitest run packages/db/test/warehouse-exports.test.ts packages/db/test/alert-evaluation.test.ts apps/worker/test/warehouse-exports.test.ts apps/worker/test/backups.test.ts scripts/migrate-integration-secrets.test.ts`

Expected: PASS; ordinary webhook and warehouse controls receive the original decrypted secret only at execution.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/0050_encrypted_integration_secrets.sql packages/db/src/schema.ts packages/db/src/repositories/warehouse-exports.ts packages/db/test/warehouse-exports.test.ts packages/db/src/repositories/alerts.ts packages/db/test/alert-evaluation.test.ts packages/db/package.json pnpm-lock.yaml apps/api/src/main.ts apps/worker/src/main.ts scripts/migrate-integration-secrets.ts scripts/migrate-integration-secrets.test.ts package.json
git commit -m "fix(security): encrypt privileged integration credentials"
```

### Task 6: Decisions, documentation, and slice verification

**Files:**
- Modify: `.claude/docs/DECISIONS.md`
- Modify: `docs/SELF-HOSTING.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: upgrade, login-throttle, session invalidation, migration, and rotation runbooks.

- [ ] **Step 1: Record final decisions**

Document opaque DB sessions, Redis account throttling, AES-GCM env keyring, and the decision to keep peppered SHA-256 for generated API keys.

- [ ] **Step 2: Run security triggers and legitimate controls**

Run: `pnpm vitest run apps/api/test/auth.test.ts apps/api/test/admin.test.ts apps/api/src/auth packages/db/test/auth-sessions.test.ts packages/db/test/warehouse-exports.test.ts packages/telemetry/test/auth.test.ts packages/config/test/secret-box.test.ts scripts/migrate-integration-secrets.test.ts`

Expected: PASS for copied-token rejection, equalized missing-account work, quotas, encryption tamper detection, migration, normal login/OAuth, and normal integrations.

- [ ] **Step 3: Run owning-package builds**

Run: `pnpm --filter @sigmon/config build`

Run: `pnpm --filter @sigmon/db build`

Run: `pnpm --filter @sigmon/api build`

Run: `pnpm --filter @sigmon/worker build`

Expected: exit 0 for each.

- [ ] **Step 4: Commit documentation**

```bash
git add .claude/docs/DECISIONS.md docs/SELF-HOSTING.md README.md
git commit -m "docs(security): document sessions and secret rotation"
```
