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
