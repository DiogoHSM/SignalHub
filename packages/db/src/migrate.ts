import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "kysely";
import type { Db } from "./client.js";

const migrationName = "0001_initial.sql";
const migrationUrl = new URL("../migrations/0001_initial.sql", import.meta.url);

export async function migrate(db: Db): Promise<void> {
  const migrationSql = await readFile(migrationUrl, "utf8");
  const checksum = createHash("sha256").update(migrationSql).digest("hex");

  await db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(927380402913)`.execute(trx);

    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(trx);

    const existing = await trx
      .selectFrom("_migrations")
      .select(["name", "checksum"])
      .where("name", "=", migrationName)
      .executeTakeFirst();

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`Migration ${migrationName} checksum mismatch`);
      }
      return;
    }

    await sql.raw(migrationSql).execute(trx);

    await trx.insertInto("_migrations").values({ name: migrationName, checksum }).execute();
  });
}
