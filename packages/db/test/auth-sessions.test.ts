import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import {
  createAuthSession,
  findActiveSessionUser,
  pruneExpiredAuthSessions,
  revokeAuthSession,
  revokeUserSessions
} from "../src/repositories/auth-sessions.js";
import { createUser } from "../src/repositories/users.js";
import { createTestDb } from "./test-db.js";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
let db: Db;
let userNumber = 0;

const now = new Date("2026-09-01T12:00:00.000Z");
const future = new Date("2026-09-02T12:00:00.000Z");

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("sigmon")
    .withUsername("sigmon")
    .withPassword("sigmon")
    .start();
  db = createTestDb(container.getConnectionUri());
  await migrate(db);
}, 60_000);

beforeEach(async () => {
  await db.deleteFrom("auth_sessions").execute();
});

afterAll(async () => {
  await db?.destroy();
  await container?.stop();
}, 30_000);

async function createUserFixture() {
  userNumber += 1;
  return createUser(db, {
    email: `auth-session-${userNumber}@example.com`,
    passwordHash: "password-hash",
    isAdmin: false
  });
}

async function archiveUserFixture(userId: string, archivedAt: Date): Promise<void> {
  await db.updateTable("users").set({ archived_at: archivedAt }).where("id", "=", userId).execute();
}

async function sessionLastSeenAt(tokenHash: string): Promise<Date> {
  return db
    .selectFrom("auth_sessions")
    .select("last_seen_at")
    .where("token_hash", "=", tokenHash)
    .executeTakeFirstOrThrow()
    .then((row) => row.last_seen_at);
}

describe("auth session repository", () => {
  it("finds only an unexpired unrevoked session for an active user", async () => {
    const user = await createUserFixture();
    const tokenHash = "a".repeat(64);
    await createAuthSession(db, { userId: user.id, tokenHash, expiresAt: future, now });

    expect((await findActiveSessionUser(db, { tokenHash, now }))?.id).toBe(user.id);

    await revokeAuthSession(db, { tokenHash, now });
    await expect(findActiveSessionUser(db, { tokenHash, now })).resolves.toBeUndefined();
  });

  it("rejects an expired session", async () => {
    const user = await createUserFixture();
    const tokenHash = "b".repeat(64);
    await createAuthSession(db, { userId: user.id, tokenHash, expiresAt: now, now });

    await expect(findActiveSessionUser(db, { tokenHash, now })).resolves.toBeUndefined();
  });

  it("rejects a session when its user is archived", async () => {
    const user = await createUserFixture();
    const tokenHash = "c".repeat(64);
    await createAuthSession(db, { userId: user.id, tokenHash, expiresAt: future, now });
    await archiveUserFixture(user.id, now);

    await expect(findActiveSessionUser(db, { tokenHash, now })).resolves.toBeUndefined();
  });

  it("enforces unique token hashes", async () => {
    const firstUser = await createUserFixture();
    const secondUser = await createUserFixture();
    const tokenHash = "d".repeat(64);
    await createAuthSession(db, { userId: firstUser.id, tokenHash, expiresAt: future, now });

    await expect(createAuthSession(db, { userId: secondUser.id, tokenHash, expiresAt: future, now })).rejects.toThrow();
  });

  it("revokes every session for a user", async () => {
    const user = await createUserFixture();
    const firstTokenHash = "e".repeat(64);
    const secondTokenHash = "f".repeat(64);
    await createAuthSession(db, { userId: user.id, tokenHash: firstTokenHash, expiresAt: future, now });
    await createAuthSession(db, { userId: user.id, tokenHash: secondTokenHash, expiresAt: future, now });

    await revokeUserSessions(db, { userId: user.id, now });

    await expect(findActiveSessionUser(db, { tokenHash: firstTokenHash, now })).resolves.toBeUndefined();
    await expect(findActiveSessionUser(db, { tokenHash: secondTokenHash, now })).resolves.toBeUndefined();
  });

  it("prunes expired sessions without removing active sessions", async () => {
    const user = await createUserFixture();
    const expiredTokenHash = "0".repeat(64);
    const activeTokenHash = "1".repeat(64);
    await createAuthSession(db, {
      userId: user.id,
      tokenHash: expiredTokenHash,
      expiresAt: new Date(now.getTime() - 1),
      now
    });
    await createAuthSession(db, { userId: user.id, tokenHash: activeTokenHash, expiresAt: future, now });

    await expect(pruneExpiredAuthSessions(db, { now })).resolves.toBe(1);
    await expect(findActiveSessionUser(db, { tokenHash: activeTokenHash, now })).resolves.toMatchObject({ id: user.id });
  });

  it("updates last seen only after fifteen minutes", async () => {
    const user = await createUserFixture();
    const tokenHash = "2".repeat(64);
    await createAuthSession(db, { userId: user.id, tokenHash, expiresAt: future, now });

    await findActiveSessionUser(db, { tokenHash, now: new Date(now.getTime() + 15 * 60 * 1000) });
    expect(await sessionLastSeenAt(tokenHash)).toEqual(now);

    const afterThreshold = new Date(now.getTime() + 15 * 60 * 1000 + 1);
    await findActiveSessionUser(db, { tokenHash, now: afterThreshold });
    expect(await sessionLastSeenAt(tokenHash)).toEqual(afterThreshold);
  });
});
