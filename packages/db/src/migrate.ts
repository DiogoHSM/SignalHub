import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "kysely";
import type { Db } from "./client.js";

const migrations = [
  { name: "0001_initial.sql", url: new URL("../migrations/0001_initial.sql", import.meta.url) },
  { name: "0002_operational_safety.sql", url: new URL("../migrations/0002_operational_safety.sql", import.meta.url) },
  { name: "0003_simple_alerts.sql", url: new URL("../migrations/0003_simple_alerts.sql", import.meta.url) },
  { name: "0004_backup_runs.sql", url: new URL("../migrations/0004_backup_runs.sql", import.meta.url) },
  { name: "0005_error_groups.sql", url: new URL("../migrations/0005_error_groups.sql", import.meta.url) },
  { name: "0006_source_maps.sql", url: new URL("../migrations/0006_source_maps.sql", import.meta.url) },
  { name: "0007_breadcrumbs.sql", url: new URL("../migrations/0007_breadcrumbs.sql", import.meta.url) },
  { name: "0008_source_map_upload_tokens.sql", url: new URL("../migrations/0008_source_map_upload_tokens.sql", import.meta.url) },
  { name: "0009_source_map_retention.sql", url: new URL("../migrations/0009_source_map_retention.sql", import.meta.url) },
  { name: "0010_backup_checksums.sql", url: new URL("../migrations/0010_backup_checksums.sql", import.meta.url) },
  { name: "0011_error_group_priority.sql", url: new URL("../migrations/0011_error_group_priority.sql", import.meta.url) },
  { name: "0012_alerting_monitors.sql", url: new URL("../migrations/0012_alerting_monitors.sql", import.meta.url) },
  { name: "0013_identity_profiles.sql", url: new URL("../migrations/0013_identity_profiles.sql", import.meta.url) },
  { name: "0014_project_browser_origins.sql", url: new URL("../migrations/0014_project_browser_origins.sql", import.meta.url) },
  { name: "0015_incident_triage.sql", url: new URL("../migrations/0015_incident_triage.sql", import.meta.url) },
  { name: "0016_system_health_samples.sql", url: new URL("../migrations/0016_system_health_samples.sql", import.meta.url) },
  { name: "0017_query_pagination_indexes.sql", url: new URL("../migrations/0017_query_pagination_indexes.sql", import.meta.url) },
  { name: "0018_dead_letter_actions.sql", url: new URL("../migrations/0018_dead_letter_actions.sql", import.meta.url) },
  { name: "0019_dead_letter_retention.sql", url: new URL("../migrations/0019_dead_letter_retention.sql", import.meta.url) }
];

export async function migrate(db: Db): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(927380402913)`.execute(trx);

    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(trx);

    for (const migration of migrations) {
      const migrationSql = await readFile(migration.url, "utf8");
      const checksum = createHash("sha256").update(migrationSql).digest("hex");

      const existing = await trx
        .selectFrom("_migrations")
        .select(["name", "checksum"])
        .where("name", "=", migration.name)
        .executeTakeFirst();

      if (existing) {
        if (existing.checksum !== checksum) {
          throw new Error(`Migration ${migration.name} checksum mismatch`);
        }
        continue;
      }

      await sql.raw(migrationSql).execute(trx);

      await trx.insertInto("_migrations").values({ name: migration.name, checksum }).execute();
    }
  });
}
