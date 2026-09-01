import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { User } from "./users.js";

const lastSeenIntervalMs = 15 * 60 * 1000;

export interface CreateAuthSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
}

export interface FindActiveSessionUserInput {
  tokenHash: string;
  now: Date;
}

export interface RevokeAuthSessionInput {
  tokenHash: string;
  now: Date;
}

export interface RevokeUserSessionsInput {
  userId: string;
  now: Date;
}

export interface PruneExpiredAuthSessionsInput {
  now: Date;
}

export async function createAuthSession(db: Db, input: CreateAuthSessionInput): Promise<void> {
  await db
    .insertInto("auth_sessions")
    .values({
      id: createId("asess"),
      user_id: input.userId,
      token_hash: input.tokenHash,
      created_at: input.now,
      expires_at: input.expiresAt,
      last_seen_at: input.now
    })
    .execute();
}

export async function findActiveSessionUser(db: Db, input: FindActiveSessionUserInput): Promise<User | undefined> {
  const row = await db
    .selectFrom("auth_sessions")
    .innerJoin("users", "users.id", "auth_sessions.user_id")
    .select([
      "users.id",
      "users.email",
      "users.password_hash",
      "users.google_subject",
      "users.is_admin",
      "users.created_at",
      "users.updated_at",
      "users.archived_at",
      "auth_sessions.id as session_id",
      "auth_sessions.last_seen_at"
    ])
    .where("auth_sessions.token_hash", "=", input.tokenHash)
    .where("auth_sessions.expires_at", ">", input.now)
    .where("auth_sessions.revoked_at", "is", null)
    .where("users.archived_at", "is", null)
    .executeTakeFirst();

  if (!row) return undefined;

  const lastSeenCutoff = new Date(input.now.getTime() - lastSeenIntervalMs);
  if (row.last_seen_at < lastSeenCutoff) {
    await db
      .updateTable("auth_sessions")
      .set({ last_seen_at: input.now })
      .where("id", "=", row.session_id)
      .where("last_seen_at", "<", lastSeenCutoff)
      .execute();
  }

  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    googleSubject: row.google_subject,
    isAdmin: row.is_admin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

export async function revokeAuthSession(db: Db, input: RevokeAuthSessionInput): Promise<void> {
  await db
    .updateTable("auth_sessions")
    .set({ revoked_at: input.now })
    .where("token_hash", "=", input.tokenHash)
    .where("revoked_at", "is", null)
    .execute();
}

export async function revokeUserSessions(db: Db, input: RevokeUserSessionsInput): Promise<void> {
  await db
    .updateTable("auth_sessions")
    .set({ revoked_at: input.now })
    .where("user_id", "=", input.userId)
    .where("revoked_at", "is", null)
    .execute();
}

export async function pruneExpiredAuthSessions(db: Db, input: PruneExpiredAuthSessionsInput): Promise<number> {
  const deleted = await db
    .deleteFrom("auth_sessions")
    .where("expires_at", "<=", input.now)
    .returning("id")
    .execute();
  return deleted.length;
}
