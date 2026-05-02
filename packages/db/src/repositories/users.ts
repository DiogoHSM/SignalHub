import { sql } from "kysely";
import type { Selectable, Transaction } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { Database, UsersTable } from "../schema.js";

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
