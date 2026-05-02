import { pathToFileURL } from "node:url";
import { sql } from "kysely";
import { loadConfig } from "../packages/config/src/index.js";
import { createDb } from "../packages/db/src/client.js";
import type { Db } from "../packages/db/src/client.js";
import { migrate } from "../packages/db/src/migrate.js";
import { createUser, findUserByEmail } from "../packages/db/src/repositories/users.js";
import { hashPassword } from "../packages/telemetry/src/auth.js";

export interface BootstrapAdminInput {
  email: string;
  password: string;
}

export async function seedBootstrapAdmin(db: Db, input: BootstrapAdminInput): Promise<"exists" | "created"> {
  return db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(927380402914)`.execute(trx);

    const existing = await findUserByEmail(trx, input.email);
    if (existing) {
      if (!existing.isAdmin) {
        throw new Error("Bootstrap admin email already belongs to a non-admin user");
      }
      return "exists";
    }

    const passwordHash = await hashPassword(input.password);
    await createUser(trx, {
      email: input.email,
      passwordHash,
      isAdmin: true
    });

    return "created";
  });
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);

  try {
    await migrate(db);

    const result = await seedBootstrapAdmin(db, config.bootstrapAdmin);
    if (result === "exists") {
      console.log("Active bootstrap admin already exists");
    } else {
      console.log("Bootstrap admin created");
    }
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exitCode = 1;
  }
}
