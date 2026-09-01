import { sql } from "kysely";
import type { Selectable, Transaction } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { Database, UsersTable } from "../schema.js";
import { revokeUserSessions } from "./auth-sessions.js";

type UserRow = Selectable<UsersTable>;
type UserDb = Db | Transaction<Database>;

export interface User {
  id: string;
  email: string;
  passwordHash: string | null;
  googleSubject: string | null;
  isAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  isAdmin: boolean;
  googleSubject?: string;
}

export interface UpdateUserInput {
  email?: string;
  passwordHash?: string;
  isAdmin?: boolean;
}

export type AdminUserInvariantCode =
  | "cannot_demote_current_admin"
  | "cannot_archive_current_admin"
  | "last_active_admin"
  | "console_users_must_be_admins";

export class AdminUserInvariantError extends Error {
  readonly code: AdminUserInvariantCode;

  constructor(code: AdminUserInvariantCode) {
    super(code);
    this.name = "AdminUserInvariantError";
    this.code = code;
  }
}

export function assertAdminUserMutation(input: {
  action: "demote" | "archive";
  actorUserId: string;
  targetUserId: string;
  targetIsAdmin: boolean;
  activeAdminCount: number;
}): void {
  if (input.actorUserId === input.targetUserId) {
    throw new AdminUserInvariantError(
      input.action === "demote" ? "cannot_demote_current_admin" : "cannot_archive_current_admin"
    );
  }
  if (input.targetIsAdmin && input.activeAdminCount <= 1) {
    throw new AdminUserInvariantError("last_active_admin");
  }
  if (input.action === "demote") {
    throw new AdminUserInvariantError("console_users_must_be_admins");
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toUser(row: UserRow): User {
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

export async function createUser(db: UserDb, input: CreateUserInput): Promise<User> {
  const row = await db
    .insertInto("users")
    .values({
      id: createId("usr"),
      email: normalizeEmail(input.email),
      password_hash: input.passwordHash,
      google_subject: input.googleSubject ?? null,
      is_admin: input.isAdmin
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toUser(row);
}

export async function listUsers(db: UserDb): Promise<User[]> {
  const rows = await db
    .selectFrom("users")
    .selectAll()
    .where("archived_at", "is", null)
    .orderBy("created_at", "asc")
    .execute();

  return rows.map(toUser);
}

export async function findUserById(db: UserDb, id: string): Promise<User | undefined> {
  const row = await db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .executeTakeFirst();

  return row ? toUser(row) : undefined;
}

export async function findUserByEmail(db: UserDb, email: string): Promise<User | undefined> {
  const normalizedEmail = normalizeEmail(email);
  const row = await db
    .selectFrom("users")
    .selectAll()
    .where(sql<string>`lower(email)`, "=", normalizedEmail)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  return row ? toUser(row) : undefined;
}

export async function findUserByGoogleSubject(db: UserDb, googleSubject: string): Promise<User | undefined> {
  const row = await db
    .selectFrom("users")
    .selectAll()
    .where("google_subject", "=", googleSubject)
    .where("archived_at", "is", null)
    .executeTakeFirst();

  return row ? toUser(row) : undefined;
}

export async function updateUser(db: UserDb, id: string, input: UpdateUserInput): Promise<User | undefined> {
  const changes: {
    email?: string;
    password_hash?: string;
    is_admin?: boolean;
    updated_at: Date;
  } = {
    updated_at: new Date()
  };

  if (input.email !== undefined) changes.email = normalizeEmail(input.email);
  if (input.passwordHash !== undefined) changes.password_hash = input.passwordHash;
  if (input.isAdmin !== undefined) changes.is_admin = input.isAdmin;

  const row = await db
    .updateTable("users")
    .set(changes)
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toUser(row) : undefined;
}

export async function linkGoogleSubject(db: UserDb, id: string, googleSubject: string): Promise<User | undefined> {
  const row = await db
    .updateTable("users")
    .set({
      google_subject: googleSubject,
      updated_at: new Date()
    })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toUser(row) : undefined;
}

export async function archiveUser(db: UserDb, id: string): Promise<void> {
  const now = new Date();
  await db
    .updateTable("users")
    .set({ archived_at: now, updated_at: now })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .execute();
}

async function lockAdminMutationRows(db: Transaction<Database>, targetUserId: string) {
  await sql`select pg_advisory_xact_lock(824746109271)`.execute(db);
  const activeAdmins = await db
    .selectFrom("users")
    .select("id")
    .where("archived_at", "is", null)
    .where("is_admin", "=", true)
    .orderBy("id", "asc")
    .forUpdate()
    .execute();
  const target = await db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", targetUserId)
    .where("archived_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
  return { activeAdminCount: activeAdmins.length, target };
}

export async function updateUserAsAdmin(
  db: Db,
  actorUserId: string,
  id: string,
  input: UpdateUserInput
): Promise<User | undefined> {
  return db.transaction().execute(async (trx) => {
    const { activeAdminCount, target } = await lockAdminMutationRows(trx, id);
    if (!target) return undefined;
    if (input.isAdmin === false) {
      assertAdminUserMutation({
        action: "demote",
        actorUserId,
        targetUserId: id,
        targetIsAdmin: target.is_admin,
        activeAdminCount
      });
    }
    const user = await updateUser(trx, id, input);
    if (user && input.passwordHash !== undefined) {
      await revokeUserSessions(trx, { userId: id, now: new Date() });
    }
    return user;
  });
}

export async function archiveUserAsAdmin(db: Db, actorUserId: string, id: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const { activeAdminCount, target } = await lockAdminMutationRows(trx, id);
    if (!target) return;
    assertAdminUserMutation({
      action: "archive",
      actorUserId,
      targetUserId: id,
      targetIsAdmin: target.is_admin,
      activeAdminCount
    });
    await archiveUser(trx, id);
    await revokeUserSessions(trx, { userId: id, now: new Date() });
  });
}
