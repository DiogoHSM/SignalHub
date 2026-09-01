import { pathToFileURL } from "node:url";
import { loadConfig, SecretBox } from "@sigmon/config";
import { sql } from "kysely";
import { createDb, type Db } from "../packages/db/src/client.js";
import { migrate } from "../packages/db/src/migrate.js";
import { redactWarehouseConnectionUrl } from "../packages/db/src/repositories/warehouse-exports.js";

export type IntegrationSecretKind = "warehouse" | "notification";
export type MigrationCandidate = { id: string };
export type MigrationRowResult = "migrated" | "rotated" | "current" | "empty" | "missing";

type LockedSecretRow = {
  id: string;
  plaintext: string | null;
  ciphertext: string | null;
  preview: string | null;
};

type MigrationResult = { migrated: number; rotated: number };

function secretContext(kind: IntegrationSecretKind, rowId: string) {
  return kind === "warehouse"
    ? { table: "warehouse_destinations", rowId, field: "connection_url" }
    : { table: "notification_channels", rowId, field: "secret_header_value" };
}

function assertOrderedBatch(rows: MigrationCandidate[], afterId: string | null, batchSize: number): void {
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
  batchSize: number;
  loadBatch: (afterId: string | null, limit: number) => Promise<MigrationCandidate[]>;
  processRow: (row: MigrationCandidate) => Promise<MigrationRowResult>;
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
      const result = await input.processRow(row);
      if (result === "migrated") migrated += 1;
      if (result === "rotated") rotated += 1;
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
): Promise<MigrationCandidate[]> {
  const result = kind === "warehouse"
    ? await sql<MigrationCandidate>`
        select id
        from warehouse_destinations
        where (${afterId}::text is null or id > ${afterId})
        order by id asc
        limit ${limit}
      `.execute(db)
    : await sql<MigrationCandidate>`
        select id
        from notification_channels
        where (${afterId}::text is null or id > ${afterId})
        order by id asc
        limit ${limit}
      `.execute(db);
  return result.rows;
}

function verifiedCiphertext(box: SecretBox, plaintext: string, context: ReturnType<typeof secretContext>): string {
  const ciphertext = box.encrypt(plaintext, context);
  if (box.decrypt(ciphertext, context) !== plaintext) {
    throw new Error("secret_migration_verification_failed");
  }
  return ciphertext;
}

export async function processDatabaseIntegrationSecretRow(input: {
  db: Db;
  kind: IntegrationSecretKind;
  rowId: string;
  box: SecretBox;
}): Promise<MigrationRowResult> {
  return input.db.transaction().execute(async (trx) => {
    const locked = input.kind === "warehouse"
      ? (await sql<LockedSecretRow>`
          select id, connection_url as plaintext, connection_url_encrypted as ciphertext,
            connection_url_preview as preview
          from warehouse_destinations
          where id = ${input.rowId}
          for update
        `.execute(trx)).rows[0]
      : (await sql<LockedSecretRow>`
          select id, secret_header_value as plaintext, secret_header_value_encrypted as ciphertext,
            null::text as preview
          from notification_channels
          where id = ${input.rowId}
          for update
        `.execute(trx)).rows[0];

    if (!locked) return "missing";
    const context = secretContext(input.kind, locked.id);

    if (locked.plaintext !== null) {
      const ciphertext = verifiedCiphertext(input.box, locked.plaintext, context);
      if (input.kind === "warehouse") {
        await sql`
          update warehouse_destinations
          set connection_url_encrypted = ${ciphertext}, connection_url = null,
            connection_url_preview = ${redactWarehouseConnectionUrl(locked.plaintext)}
          where id = ${locked.id}
        `.execute(trx);
      } else {
        await sql`
          update notification_channels
          set secret_header_value_encrypted = ${ciphertext}, secret_header_value = null
          where id = ${locked.id}
        `.execute(trx);
      }
      return "migrated";
    }

    if (locked.ciphertext !== null) {
      const plaintext = input.box.decrypt(locked.ciphertext, context);
      if (input.box.needsRotation(locked.ciphertext)) {
        const ciphertext = verifiedCiphertext(input.box, plaintext, context);
        if (input.kind === "warehouse") {
          await sql`
            update warehouse_destinations
            set connection_url_encrypted = ${ciphertext}, connection_url = null,
              connection_url_preview = ${redactWarehouseConnectionUrl(plaintext)}
            where id = ${locked.id}
          `.execute(trx);
        } else {
          await sql`
            update notification_channels
            set secret_header_value_encrypted = ${ciphertext}, secret_header_value = null
            where id = ${locked.id}
          `.execute(trx);
        }
        return "rotated";
      }

      if (input.kind === "warehouse" && locked.preview === null) {
        await sql`
          update warehouse_destinations
          set connection_url_preview = ${redactWarehouseConnectionUrl(plaintext)}
          where id = ${locked.id}
        `.execute(trx);
      }
      return "current";
    }

    if (input.kind === "warehouse") throw new Error("warehouse_connection_secret_missing");
    return "empty";
  });
}

export async function migrateDatabaseIntegrationSecrets(input: {
  db: Db;
  kind: IntegrationSecretKind;
  batchSize: number;
  box: SecretBox;
  loadBatch?: (afterId: string | null, limit: number) => Promise<MigrationCandidate[]>;
}): Promise<MigrationResult> {
  return migrateIntegrationSecrets({
    batchSize: input.batchSize,
    loadBatch: input.loadBatch ?? ((afterId, limit) => loadDatabaseBatch(input.db, input.kind, afterId, limit)),
    processRow: ({ id }) => processDatabaseIntegrationSecretRow({
      db: input.db,
      kind: input.kind,
      rowId: id,
      box: input.box
    })
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
