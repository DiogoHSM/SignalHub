import { SecretBox } from "@sigmon/config";
import { sql } from "kysely";
import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  migrateDatabaseIntegrationSecrets,
  migrateIntegrationSecrets,
  processDatabaseIntegrationSecretRow,
  safeMigrationErrorCode,
  type MigrationCandidate,
  type MigrationRowResult
} from "./migrate-integration-secrets.js";
import { createTestDb } from "../packages/db/test/test-db.js";
import { migrate } from "../packages/db/src/migrate.js";
import type { Db } from "../packages/db/src/client.js";
import { createEnvironment, createProject } from "../packages/db/src/repositories/admin.js";

const previousKey = Buffer.alloc(32, 7).toString("base64");
const currentKey = Buffer.alloc(32, 9).toString("base64");
const previousBox = new SecretBox({ currentKey: previousKey });
const box = new SecretBox({ currentKey, previousKey });

function warehouseContext(id: string) {
  return { table: "warehouse_destinations", rowId: id, field: "connection_url" };
}

let container: Awaited<ReturnType<GenericContainer["start"]>>;
let db: Db;
let projectId: string;
let environmentId: string;

beforeAll(async () => {
  container = await new GenericContainer("postgres:16-alpine")
    .withEnvironment({
      POSTGRES_DB: "sigmon",
      POSTGRES_PASSWORD: "sigmon",
      POSTGRES_USER: "sigmon"
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections", 2))
    .start();
  db = createTestDb(`postgresql://sigmon:sigmon@${container.getHost()}:${container.getMappedPort(5432)}/sigmon`);
  await migrate(db);
  const project = await createProject(db, { name: "secret-migration-tests" });
  projectId = project.id;
  const environment = await createEnvironment(db, { projectId, name: "test" });
  environmentId = environment.id;
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  await container?.stop();
});

async function seedWarehouseRow(input: {
  id: string;
  plaintext?: string | null;
  ciphertext?: string | null;
  preview?: string | null;
}): Promise<void> {
  await db.deleteFrom("warehouse_destinations").where("id", "=", input.id).execute();
  await db
    .insertInto("warehouse_destinations")
    .values({
      id: input.id,
      project_id: projectId,
      environment_id: environmentId,
      name: input.id,
      destination_type: "postgres",
      connection_url: input.plaintext ?? null,
      connection_url_encrypted: input.ciphertext ?? null,
      connection_url_preview: input.preview ?? null,
      datasets: JSON.stringify(["traces"]),
      enabled: true
    })
    .execute();
}

function loadCandidates(ids: string[], calls: Array<string | null>) {
  return async (afterId: string | null, limit: number): Promise<MigrationCandidate[]> => {
    calls.push(afterId);
    return ids.filter((id) => afterId === null || id > afterId).slice(0, limit).map((id) => ({ id }));
  };
}

describe("integration secret migration", () => {
  it("returns stable safe error codes without reflecting exception messages", () => {
    expect(safeMigrationErrorCode(new Error("synthetic-sensitive-marker"))).toBe("secret_migration_failed");
    expect(safeMigrationErrorCode(new Error("data_encryption_key_required"))).toBe("data_encryption_key_required");
    expect(safeMigrationErrorCode(new Error("secret_key_unknown"))).toBe("secret_key_unknown");
  });

  it("processes deterministic bounded candidate batches without emitting secret material", async () => {
    const calls: Array<string | null> = [];
    const processed: string[] = [];
    const actions = new Map<string, MigrationRowResult>([
      ["wh_01", "migrated"],
      ["wh_02", "migrated"],
      ["wh_03", "current"]
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await migrateIntegrationSecrets({
      batchSize: 2,
      loadBatch: loadCandidates(["wh_01", "wh_02", "wh_03"], calls),
      processRow: async (row) => {
        processed.push(row.id);
        return actions.get(row.id) ?? "missing";
      }
    });

    expect(result).toEqual({ migrated: 2, rotated: 0 });
    expect(calls).toEqual([null, "wh_02"]);
    expect(processed).toEqual(["wh_01", "wh_02", "wh_03"]);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("can resume after an interrupted batch without re-encrypting current rows", async () => {
    const states = new Map<string, "legacy" | "current">([
      ["wh_01", "legacy"],
      ["wh_02", "legacy"]
    ]);
    let shouldInterrupt = true;
    const processRow = async ({ id }: MigrationCandidate): Promise<MigrationRowResult> => {
      if (id === "wh_02" && shouldInterrupt) {
        shouldInterrupt = false;
        throw new Error("synthetic_interruption");
      }
      if (states.get(id) === "current") {
        return "current";
      }
      states.set(id, "current");
      return "migrated";
    };

    await expect(
      migrateIntegrationSecrets({
        batchSize: 2,
        loadBatch: loadCandidates(["wh_01", "wh_02"], []),
        processRow
      })
    ).rejects.toThrow("synthetic_interruption");

    await expect(
      migrateIntegrationSecrets({
        batchSize: 2,
        loadBatch: loadCandidates(["wh_01", "wh_02"], []),
        processRow
      })
    ).resolves.toEqual({ migrated: 1, rotated: 0 });
    expect(states).toEqual(new Map([
      ["wh_01", "current"],
      ["wh_02", "current"]
    ]));
  });

  it("rejects non-deterministic candidate batches before processing rows", async () => {
    const processRow = vi.fn(async (): Promise<MigrationRowResult> => "migrated");

    await expect(
      migrateIntegrationSecrets({
        batchSize: 10,
        loadBatch: async () => [{ id: "wh_02" }, { id: "wh_01" }],
        processRow
      })
    ).rejects.toThrow("secret_migration_batch_order_invalid");
    expect(processRow).not.toHaveBeenCalled();
  });

  it("observes a concurrent legacy change before locking instead of using a stale current snapshot", async () => {
    const id = "wh_concurrent_legacy";
    const original = "postgres://synthetic:original@db.invalid/warehouse";
    const concurrent = "postgres://synthetic:concurrent@db.invalid/warehouse";
    await seedWarehouseRow({ id, ciphertext: box.encrypt(original, warehouseContext(id)) });
    let mutated = false;

    const result = await migrateDatabaseIntegrationSecrets({
      db,
      kind: "warehouse",
      batchSize: 10,
      box,
      loadBatch: async () => {
        if (!mutated) {
          mutated = true;
          await db
            .updateTable("warehouse_destinations")
            .set({ connection_url: concurrent, connection_url_encrypted: null, connection_url_preview: null })
            .where("id", "=", id)
            .execute();
        }
        return mutated ? [{ id }] : [];
      }
    });

    const row = await db
      .selectFrom("warehouse_destinations")
      .select(["connection_url", "connection_url_encrypted"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(result).toEqual({ migrated: 1, rotated: 0 });
    expect(row.connection_url).toBeNull();
    expect(box.decrypt(row.connection_url_encrypted!, warehouseContext(id))).toBe(concurrent);
  });

  it("observes a concurrent previous-key change before locking and rotates it", async () => {
    const id = "wh_concurrent_previous";
    const concurrent = "postgres://synthetic:previous@db.invalid/warehouse";
    await seedWarehouseRow({ id, plaintext: "postgres://synthetic:legacy@db.invalid/warehouse" });
    let calls = 0;

    const result = await migrateDatabaseIntegrationSecrets({
      db,
      kind: "warehouse",
      batchSize: 10,
      box,
      loadBatch: async () => {
        calls += 1;
        if (calls === 1) {
          await db
            .updateTable("warehouse_destinations")
            .set({
              connection_url: null,
              connection_url_encrypted: previousBox.encrypt(concurrent, warehouseContext(id)),
              connection_url_preview: null
            })
            .where("id", "=", id)
            .execute();
          return [{ id }];
        }
        return [];
      }
    });

    const row = await db
      .selectFrom("warehouse_destinations")
      .select(["connection_url", "connection_url_encrypted"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(result).toEqual({ migrated: 0, rotated: 1 });
    expect(row.connection_url).toBeNull();
    expect(box.decrypt(row.connection_url_encrypted!, warehouseContext(id))).toBe(concurrent);
    expect(box.needsRotation(row.connection_url_encrypted!)).toBe(false);
  });

  it("revalidates a concurrent current-key change under lock and reports a true zero", async () => {
    const id = "wh_concurrent_current";
    const concurrent = "postgres://synthetic:current@db.invalid/warehouse";
    const currentCiphertext = box.encrypt(concurrent, warehouseContext(id));
    await seedWarehouseRow({ id, plaintext: "postgres://synthetic:legacy@db.invalid/warehouse" });
    let calls = 0;

    const result = await migrateDatabaseIntegrationSecrets({
      db,
      kind: "warehouse",
      batchSize: 10,
      box,
      loadBatch: async () => {
        calls += 1;
        if (calls === 1) {
          await db
            .updateTable("warehouse_destinations")
            .set({ connection_url: null, connection_url_encrypted: currentCiphertext, connection_url_preview: "postgres://***@db.invalid/warehouse" })
            .where("id", "=", id)
            .execute();
          return [{ id }];
        }
        return [];
      }
    });

    const row = await db
      .selectFrom("warehouse_destinations")
      .select(["connection_url", "connection_url_encrypted"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(result).toEqual({ migrated: 0, rotated: 0 });
    expect(row.connection_url).toBeNull();
    expect(row.connection_url_encrypted).toBe(currentCiphertext);
  });

  it("rolls back and preserves the locked row when authentication fails", async () => {
    const id = "wh_tampered";
    const tampered = `${box.encrypt("postgres://synthetic:tamper@db.invalid/warehouse", warehouseContext(id))}x`;
    await seedWarehouseRow({ id, ciphertext: tampered, preview: "postgres://***@db.invalid/warehouse" });

    await expect(processDatabaseIntegrationSecretRow({ db, kind: "warehouse", rowId: id, box })).rejects.toThrow();

    const row = await db
      .selectFrom("warehouse_destinations")
      .select(["connection_url", "connection_url_encrypted", "connection_url_preview"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      connection_url: null,
      connection_url_encrypted: tampered,
      connection_url_preview: "postgres://***@db.invalid/warehouse"
    });
  });

  it("rolls back plaintext clearing if the encrypted write fails", async () => {
    const id = "wh_rollback";
    const plaintext = "postgres://synthetic:rollback@db.invalid/warehouse";
    await seedWarehouseRow({ id, plaintext });
    await sql.raw(`
      CREATE OR REPLACE FUNCTION reject_synthetic_ciphertext() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = '${id}' AND NEW.connection_url_encrypted IS NOT NULL THEN
          RAISE EXCEPTION 'synthetic_write_rejected';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_synthetic_ciphertext
      BEFORE UPDATE ON warehouse_destinations
      FOR EACH ROW EXECUTE FUNCTION reject_synthetic_ciphertext();
    `).execute(db);

    try {
      await expect(processDatabaseIntegrationSecretRow({ db, kind: "warehouse", rowId: id, box })).rejects.toThrow();
      const row = await db
        .selectFrom("warehouse_destinations")
        .select(["connection_url", "connection_url_encrypted"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ connection_url: plaintext, connection_url_encrypted: null });
    } finally {
      await sql.raw("DROP TRIGGER IF EXISTS reject_synthetic_ciphertext ON warehouse_destinations").execute(db);
      await sql.raw("DROP FUNCTION IF EXISTS reject_synthetic_ciphertext()").execute(db);
    }
  });
});
