import { loadConfig } from "../packages/config/src/index.js";
import { createDb } from "../packages/db/src/client.js";
import { migrate } from "../packages/db/src/migrate.js";

const config = loadConfig();
const db = createDb(config.databaseUrl);

try {
  await migrate(db);
  console.log("Database migrations applied");
} finally {
  await db.destroy();
}
