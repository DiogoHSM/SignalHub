import { loadConfig } from "../packages/config/src/index.js";
import { createDb } from "../packages/db/src/client.js";
import { migrate } from "../packages/db/src/migrate.js";
import { createUser, findUserByEmail } from "../packages/db/src/repositories/users.js";
import { hashPassword } from "../packages/telemetry/src/auth.js";

const config = loadConfig();
const db = createDb(config.databaseUrl);

try {
  await migrate(db);

  const existing = await findUserByEmail(db, config.bootstrapAdmin.email);
  if (existing) {
    console.log("Active bootstrap admin already exists");
  } else {
    const passwordHash = await hashPassword(config.bootstrapAdmin.password);
    await createUser(db, {
      email: config.bootstrapAdmin.email,
      passwordHash,
      isAdmin: true
    });
    console.log("Bootstrap admin created");
  }
} finally {
  await db.destroy();
}
