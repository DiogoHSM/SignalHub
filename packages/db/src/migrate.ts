import { readFile } from "node:fs/promises";
import { sql } from "kysely";
import type { Db } from "./client.js";

const migrationName = "0001_initial.sql";
const migrationUrl = new URL("../migrations/0001_initial.sql", import.meta.url);

export async function migrate(db: Db): Promise<void> {
  const migrationSql = await readFile(migrationUrl, "utf8");

  await db.transaction().execute(async (trx) => {
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(trx);

    const existing = await trx
      .selectFrom("_migrations")
      .select("name")
      .where("name", "=", migrationName)
      .executeTakeFirst();

    if (existing) return;

    await sql.raw(migrationSql).execute(trx);

    await trx.insertInto("_migrations").values({ name: migrationName }).execute();
  });
}
