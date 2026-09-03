import { pathToFileURL } from "node:url";
import { loadConfig, OutboundPolicy } from "../packages/config/src/index.js";
import { createDb } from "../packages/db/src/client.js";
import { migrate } from "../packages/db/src/migrate.js";
import { recordBackupRun, withBackupLock } from "../packages/db/src/repositories/backups.js";
import { runBackupOnce } from "../apps/worker/src/backups.js";

export async function main(): Promise<void> {
  const config = loadConfig();
  const outboundPolicy = new OutboundPolicy({
    privateCidrs: config.outbound.privateCidrs,
    allowLoopback: config.outbound.allowLoopback,
    nodeEnv: config.nodeEnv
  });
  const db = createDb(config.databaseUrl);

  try {
    await migrate(db);

    const result = await runBackupOnce({
      now: () => new Date(),
      trigger: "manual",
      config: {
        ...config.backups,
        enabled: true,
        databaseUrl: config.databaseUrl
      },
      outboundPolicy,
      withLock: (run) => withBackupLock(db, run),
      recordBackupRun: (input) => recordBackupRun(db, input)
    });

    if (result.skipped) {
      console.log("Backup skipped because another backup is running");
    } else {
      console.log("Backup completed");
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
