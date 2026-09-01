import { pathToFileURL } from "node:url";
import { sql } from "kysely";
import { loadConfig, SecretBox } from "../packages/config/src/index.js";
import { createDb, type Db } from "../packages/db/src/client.js";
import { migrate } from "../packages/db/src/migrate.js";

export type IntegrationSecretKind = "warehouse" | "notification";

export type LegacySecretRow = {
  id: string;
  plaintext: string | null;
  ciphertext: string | null;
};

type MigrationResult = { migrated: number; rotated: number };

function secretContext(kind: IntegrationSecretKind, rowId: string) {
  return kind === "warehouse"
    ? { table: "warehouse_destinations", rowId, field: "connection_url" }
    : { table: "notification_channels", rowId, field: "secret_header_value" };
}

function assertOrderedBatch(rows: LegacySecretRow[], afterId: string | null, batchSize: number): void {
  if (rows.length > batchSize) throw new Error("secret_migration_batch_size_invalid");
  let previousId = afterId;
  for (const row of rows) {
    if (!row.id || (previousId !== null && row.id <= previousId)) {
      throw new Error("secret_migration_batch_order_invalid");
    }
    previousId = row.id;
  }
}

export async function migrateIntegrationSecrets(input: {
  kind: IntegrationSecretKind;
  batchSize: number;
  loadBatch: (afterId: string | null, limit: number) => Promise<LegacySecretRow[]>;
  persistEncrypted: (row: LegacySecretRow, ciphertext: string) => Promise<void>;
  box: SecretBox;
}): Promise<MigrationResult> {
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 1_000) {
    throw new Error("secret_migration_batch_size_invalid");
  }

  let afterId: string | null = null;
  let migrated = 0;
  let rotated = 0;

  while (true) {
    const rows = await input.loadBatch(afterId, input.batchSize);
    assertOrderedBatch(rows, afterId, input.batchSize);
    if (rows.length === 0) break;

    for (const row of rows) {
      const context = secretContext(input.kind, row.id);
      if (row.plaintext !== null) {
        const ciphertext = input.box.encrypt(row.plaintext, context);
        if (input.box.decrypt(ciphertext, context) !== row.plaintext) {
          throw new Error("secret_migration_verification_failed");
        }
        await input.persistEncrypted(row, ciphertext);
        migrated += 1;
      } else if (row.ciphertext !== null) {
        const plaintext = input.box.decrypt(row.ciphertext, context);
        if (input.box.needsRotation(row.ciphertext)) {
          const ciphertext = input.box.encrypt(plaintext, context);
          if (input.box.decrypt(ciphertext, context) !== plaintext) {
            throw new Error("secret_migration_verification_failed");
          }
          await input.persistEncrypted(row, ciphertext);
          rotated += 1;
        }
      } else if (input.kind === "warehouse") {
        throw new Error("warehouse_connection_secret_missing");
      }
      afterId = row.id;
    }

    if (rows.length < input.batchSize) break;
  }

  return { migrated, rotated };
}

async function loadDatabaseBatch(
  db: Db,
  kind: IntegrationSecretKind,
  afterId: string | null,
  limit: number
): Promise<LegacySecretRow[]> {
  if (kind === "warehouse") {
    const result = await sql<LegacySecretRow>`
      select id, connection_url as plaintext, connection_url_encrypted as ciphertext
      from warehouse_destinations
      where (${afterId}::text is null or id > ${afterId})
      order by id asc
      limit ${limit}
    `.execute(db);
    return result.rows;
  }

  const result = await sql<LegacySecretRow>`
    select id, secret_header_value as plaintext, secret_header_value_encrypted as ciphertext
    from notification_channels
    where (${afterId}::text is null or id > ${afterId})
    order by id asc
    limit ${limit}
  `.execute(db);
  return result.rows;
}

async function persistDatabaseRow(
  db: Db,
  kind: IntegrationSecretKind,
  row: LegacySecretRow,
  ciphertext: string
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const current = kind === "warehouse"
      ? (await sql<LegacySecretRow>`
          select id, connection_url as plaintext, connection_url_encrypted as ciphertext
          from warehouse_destinations
          where id = ${row.id}
          for update
        `.execute(trx)).rows[0]
      : (await sql<LegacySecretRow>`
          select id, secret_header_value as plaintext, secret_header_value_encrypted as ciphertext
          from notification_channels
          where id = ${row.id}
          for update
        `.execute(trx)).rows[0];

    if (!current || current.plaintext !== row.plaintext || current.ciphertext !== row.ciphertext) {
      throw new Error("secret_migration_row_changed");
    }

    if (kind === "warehouse") {
      await sql`
        update warehouse_destinations
        set connection_url_encrypted = ${ciphertext}, connection_url = null
        where id = ${row.id}
      `.execute(trx);
    } else {
      await sql`
        update notification_channels
        set secret_header_value_encrypted = ${ciphertext}, secret_header_value = null
        where id = ${row.id}
      `.execute(trx);
    }
  });
}

export async function migrateDatabaseIntegrationSecrets(input: {
  db: Db;
  kind: IntegrationSecretKind;
  batchSize: number;
  box: SecretBox;
}): Promise<MigrationResult> {
  return migrateIntegrationSecrets({
    kind: input.kind,
    batchSize: input.batchSize,
    loadBatch: (afterId, limit) => loadDatabaseBatch(input.db, input.kind, afterId, limit),
    persistEncrypted: (row, ciphertext) => persistDatabaseRow(input.db, input.kind, row, ciphertext),
    box: input.box
  });
}

function parseCommandArgs(args: string[]): { kinds: IntegrationSecretKind[]; batchSize: number } {
  let kind: IntegrationSecretKind | "all" = "all";
  let batchSize = 100;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--kind") {
      const value = args[index + 1];
      if (value !== "warehouse" && value !== "notification" && value !== "all") {
        throw new Error("secret_migration_kind_invalid");
      }
      kind = value;
      index += 1;
    } else if (argument === "--batch-size") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 1_000) {
        throw new Error("secret_migration_batch_size_invalid");
      }
      batchSize = value;
      index += 1;
    } else {
      throw new Error("secret_migration_argument_invalid");
    }
  }
  return {
    kinds: kind === "all" ? ["warehouse", "notification"] : [kind],
    batchSize
  };
}

const safeMigrationErrorCodes = new Set([
  "data_encryption_key_required",
  "secret_authentication_failed",
  "secret_context_invalid",
  "secret_envelope_invalid",
  "secret_key_unknown",
  "secret_migration_argument_invalid",
  "secret_migration_batch_order_invalid",
  "secret_migration_batch_size_invalid",
  "secret_migration_kind_invalid",
  "secret_migration_row_changed",
  "secret_migration_verification_failed",
  "secret_plaintext_invalid",
  "secret_version_unsupported",
  "warehouse_connection_secret_missing"
]);

export function safeMigrationErrorCode(error: unknown): string {
  return error instanceof Error && safeMigrationErrorCodes.has(error.message)
    ? error.message
    : "secret_migration_failed";
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { kinds, batchSize } = parseCommandArgs(args);
  const config = loadConfig();
  if (!config.dataEncryption.currentKey) throw new Error("data_encryption_key_required");
  const box = new SecretBox({
    currentKey: config.dataEncryption.currentKey,
    previousKey: config.dataEncryption.previousKey
  });
  const db = createDb(config.databaseUrl);
  const total: MigrationResult = { migrated: 0, rotated: 0 };

  try {
    await migrate(db);
    for (const kind of kinds) {
      const result = await migrateDatabaseIntegrationSecrets({ db, kind, batchSize, box });
      total.migrated += result.migrated;
      total.rotated += result.rotated;
    }
  } finally {
    await db.destroy();
  }

  console.log(JSON.stringify(total));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ error: safeMigrationErrorCode(error) }));
    process.exitCode = 1;
  });
}
