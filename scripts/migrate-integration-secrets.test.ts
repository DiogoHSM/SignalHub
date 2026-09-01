import { SecretBox } from "@sigmon/config";
import { sql } from "kysely";
import { GenericContainer, Wait } from "testcontainers";
import { describe, expect, it, vi } from "vitest";
import {
  migrateDatabaseIntegrationSecrets,
  migrateIntegrationSecrets,
  safeMigrationErrorCode,
  type LegacySecretRow
} from "./migrate-integration-secrets.js";
import { createTestDb } from "../packages/db/test/test-db.js";
import { migrate } from "../packages/db/src/migrate.js";
import { createEnvironment, createProject } from "../packages/db/src/repositories/admin.js";

const oldKey = Buffer.alloc(32, 21).toString("base64");
const currentKey = Buffer.alloc(32, 22).toString("base64");

function context(kind: "warehouse" | "notification", id: string) {
  return kind === "warehouse"
    ? { table: "warehouse_destinations", rowId: id, field: "connection_url" }
    : { table: "notification_channels", rowId: id, field: "secret_header_value" };
}

function loadFrom(rows: Map<string, LegacySecretRow>, calls: Array<string | null>) {
  return async (afterId: string | null, limit: number) => {
    calls.push(afterId);
    return [...rows.values()]
      .filter((row) => afterId === null || row.id > afterId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, limit);
  };
}

describe("migrateIntegrationSecrets", () => {
  it("never exposes an arbitrary error message as command output", () => {
    expect(safeMigrationErrorCode(new Error("syntheticsecretvalue"))).toBe("secret_migration_failed");
    expect(safeMigrationErrorCode(new Error("secret_authentication_failed"))).toBe("secret_authentication_failed");
  });

  it("migrates legacy rows in deterministic bounded batches and reports counts only", async () => {
    const box = new SecretBox({ currentKey });
    const rows = new Map<string, LegacySecretRow>([
      ["wh_02", { id: "wh_02", plaintext: "synthetic-two", ciphertext: null }],
      ["wh_01", { id: "wh_01", plaintext: "synthetic-one", ciphertext: null }],
      ["wh_03", { id: "wh_03", plaintext: null, ciphertext: box.encrypt("synthetic-current", context("warehouse", "wh_03")) }]
    ]);
    const calls: Array<string | null> = [];
    const persisted: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = await migrateIntegrationSecrets({
        kind: "warehouse",
        batchSize: 2,
        loadBatch: loadFrom(rows, calls),
        persistEncrypted: async (row, ciphertext) => {
          persisted.push(row.id);
          rows.set(row.id, { id: row.id, plaintext: null, ciphertext });
        },
        box
      });

      expect(result).toEqual({ migrated: 2, rotated: 0 });
      expect(calls).toEqual([null, "wh_02"]);
      expect(persisted).toEqual(["wh_01", "wh_02"]);
      expect(box.decrypt(rows.get("wh_01")!.ciphertext!, context("warehouse", "wh_01"))).toBe("synthetic-one");
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("restarts after interruption without rewriting already-current rows", async () => {
    const box = new SecretBox({ currentKey });
    const rows = new Map<string, LegacySecretRow>([
      ["chn_01", { id: "chn_01", plaintext: "synthetic-first", ciphertext: null }],
      ["chn_02", { id: "chn_02", plaintext: "synthetic-second", ciphertext: null }]
    ]);
    let failSecond = true;
    const persistEncrypted = async (row: LegacySecretRow, ciphertext: string) => {
      if (row.id === "chn_02" && failSecond) throw new Error("synthetic_persist_failure");
      rows.set(row.id, { id: row.id, plaintext: null, ciphertext });
    };

    await expect(migrateIntegrationSecrets({
      kind: "notification",
      batchSize: 2,
      loadBatch: loadFrom(rows, []),
      persistEncrypted,
      box
    })).rejects.toThrow("synthetic_persist_failure");
    expect(rows.get("chn_01")?.plaintext).toBeNull();
    expect(rows.get("chn_02")?.plaintext).toBe("synthetic-second");

    const firstCiphertext = rows.get("chn_01")?.ciphertext;
    failSecond = false;
    await expect(migrateIntegrationSecrets({
      kind: "notification",
      batchSize: 1,
      loadBatch: loadFrom(rows, []),
      persistEncrypted,
      box
    })).resolves.toEqual({ migrated: 1, rotated: 0 });
    expect(rows.get("chn_01")?.ciphertext).toBe(firstCiphertext);
    expect(rows.get("chn_02")?.plaintext).toBeNull();
  });

  it("rewraps previous-key rows and skips current-key rows idempotently", async () => {
    const previousBox = new SecretBox({ currentKey: oldKey });
    const box = new SecretBox({ currentKey, previousKey: oldKey });
    const previousCiphertext = previousBox.encrypt("synthetic-rotated", context("notification", "chn_old"));
    const currentCiphertext = box.encrypt("synthetic-current", context("notification", "chn_current"));
    const rows = new Map<string, LegacySecretRow>([
      ["chn_current", { id: "chn_current", plaintext: null, ciphertext: currentCiphertext }],
      ["chn_old", { id: "chn_old", plaintext: null, ciphertext: previousCiphertext }]
    ]);
    const persisted: string[] = [];

    const result = await migrateIntegrationSecrets({
      kind: "notification",
      batchSize: 10,
      loadBatch: loadFrom(rows, []),
      persistEncrypted: async (row, ciphertext) => {
        persisted.push(row.id);
        rows.set(row.id, { id: row.id, plaintext: null, ciphertext });
      },
      box
    });

    expect(result).toEqual({ migrated: 0, rotated: 1 });
    expect(persisted).toEqual(["chn_old"]);
    expect(rows.get("chn_current")?.ciphertext).toBe(currentCiphertext);
    expect(rows.get("chn_old")?.ciphertext).not.toBe(previousCiphertext);
    expect(box.needsRotation(rows.get("chn_old")!.ciphertext!)).toBe(false);
  });

  it("verifies encryption before persistence and stops on tampered current ciphertext", async () => {
    const box = new SecretBox({ currentKey });
    const persistEncrypted = vi.fn(async () => undefined);
    const brokenBox = {
      encrypt: () => "synthetic-invalid-envelope",
      decrypt: () => "synthetic-mismatch",
      needsRotation: () => false
    } as unknown as SecretBox;

    await expect(migrateIntegrationSecrets({
      kind: "warehouse",
      batchSize: 1,
      loadBatch: async () => [{ id: "wh_verify", plaintext: "synthetic-original", ciphertext: null }],
      persistEncrypted,
      box: brokenBox
    })).rejects.toThrow("secret_migration_verification_failed");
    expect(persistEncrypted).not.toHaveBeenCalled();

    const valid = box.encrypt("synthetic-tamper", context("warehouse", "wh_tamper"));
    const parts = valid.split(".");
    const tag = Buffer.from(parts[3]!, "base64url");
    tag[0] ^= 1;
    parts[3] = tag.toString("base64url");
    const tampered = parts.join(".");
    await expect(migrateIntegrationSecrets({
      kind: "warehouse",
      batchSize: 1,
      loadBatch: async (afterId) => afterId === null
        ? [{ id: "wh_tamper", plaintext: null, ciphertext: tampered }]
        : [],
      persistEncrypted,
      box
    })).rejects.toThrow("secret_authentication_failed");
    expect(persistEncrypted).not.toHaveBeenCalled();
  });

  it("rejects unordered batches before any row can be persisted", async () => {
    const persistEncrypted = vi.fn(async () => undefined);
    await expect(migrateIntegrationSecrets({
      kind: "warehouse",
      batchSize: 2,
      loadBatch: async () => [
        { id: "wh_02", plaintext: "synthetic-two", ciphertext: null },
        { id: "wh_01", plaintext: "synthetic-one", ciphertext: null }
      ],
      persistEncrypted,
      box: new SecretBox({ currentKey })
    })).rejects.toThrow("secret_migration_batch_order_invalid");
    expect(persistEncrypted).not.toHaveBeenCalled();
  });

  it("rolls back the plaintext clear when a database row update fails", async () => {
    const container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({
        POSTGRES_DB: "sigmon",
        POSTGRES_USER: "sigmon",
        POSTGRES_PASSWORD: "sigmon"
      })
      .withExposedPorts(5432)
      .withHealthCheck({
        test: ["CMD-SHELL", "pg_isready -U sigmon -d sigmon"],
        interval: 1_000,
        timeout: 5_000,
        retries: 30
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .start();
    const db = createTestDb(
      `postgres://sigmon:sigmon@${container.getHost()}:${container.getMappedPort(5432)}/sigmon`
    );
    try {
      await migrate(db);
      const project = await createProject(db, { name: "Synthetic migration project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      await sql`
        insert into warehouse_destinations (
          id, project_id, environment_id, name, destination_type, connection_url, datasets
        ) values (
          'wh_atomic', ${project.id}, ${environment.id}, 'Synthetic atomic', 'postgres',
          'postgres://synthetic-legacy.invalid/db', '[]'::jsonb
        )
      `.execute(db);
      await sql`
        create function reject_synthetic_secret_update() returns trigger language plpgsql as $$
        begin
          raise exception 'synthetic_update_rejected';
        end $$
      `.execute(db);
      await sql`
        create trigger reject_synthetic_secret_update
        before update on warehouse_destinations
        for each row when (new.connection_url_encrypted is not null)
        execute function reject_synthetic_secret_update()
      `.execute(db);

      await expect(migrateDatabaseIntegrationSecrets({
        db,
        kind: "warehouse",
        batchSize: 10,
        box: new SecretBox({ currentKey })
      })).rejects.toThrow("synthetic_update_rejected");

      const stored = await db
        .selectFrom("warehouse_destinations")
        .select(["connection_url", "connection_url_encrypted"])
        .where("id", "=", "wh_atomic")
        .executeTakeFirstOrThrow();
      expect(stored.connection_url).toBe("postgres://synthetic-legacy.invalid/db");
      expect(stored.connection_url_encrypted).toBeNull();
    } finally {
      await db.destroy();
      await container.stop();
    }
  }, 60_000);
});
