import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { SecretBox } from "@sigmon/config";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { createTestDb } from "./test-db.js";
import { createEnvironment, createProject } from "../src/repositories/admin.js";
import { identifyTenantProfile, identifyUserProfile } from "../src/repositories/identity-profiles.js";
import { insertError, insertEvent, insertLlmCall, insertTrace } from "../src/repositories/telemetry-writes.js";
import {
  archiveWarehouseDestination,
  createWarehouseDestination,
  getWarehouseDestination,
  listActiveWarehouseDestinations,
  listWarehouseDestinations,
  listWarehouseExportRuns,
  recordWarehouseExportRun,
  selectWarehouseExportBatch,
  updateWarehouseDestinationCursor,
  updateWarehouseDestination
} from "../src/repositories/warehouse-exports.js";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
let db: Db;
const box = new SecretBox({ currentKey: Buffer.alloc(32, 11).toString("base64") });

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("sigmon")
    .withUsername("sigmon")
    .withPassword("sigmon")
    .start();
  db = createTestDb(container.getConnectionUri());
  await migrate(db);
}, 60_000);

afterAll(async () => {
  await db?.destroy();
  await container?.stop();
}, 30_000);

async function createScope() {
  const project = await createProject(db, { name: `Warehouse ${Date.now()}` });
  const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
  return { project, environment };
}

describe("warehouse export repositories", () => {
  it("creates destinations, redacts connection urls, updates config, and archives them", async () => {
    const { project, environment } = await createScope();

    const destination = await createWarehouseDestination(db, {
      projectId: project.id,
      environmentId: environment.id,
      name: "Lakehouse",
      destinationType: "postgres",
      connectionUrl: "postgres://writer:secret@warehouse.internal:5432/analytics?sslmode=require&token=query-secret&api_key=key-secret&application_name=sigmon",
      datasets: ["events", "errors"],
      batchSize: 250,
      enabled: true
    }, box);

    const storedAfterCreate = await db
      .selectFrom("warehouse_destinations")
      .selectAll()
      .where("id", "=", destination.id)
      .executeTakeFirstOrThrow() as unknown as {
        connection_url: string | null;
        connection_url_encrypted?: string | null;
      };
    expect(storedAfterCreate.connection_url).toBeNull();
    expect(storedAfterCreate.connection_url_encrypted).toMatch(/^v1\./);

    expect(destination.connectionUrlPreview).toBe(
      "postgres://writer:***@warehouse.internal:5432/analytics?sslmode=require&token=***&api_key=***&application_name=sigmon",
    );
    expect(destination.connectionUrlPreview).not.toContain("secret");
    expect(destination.connectionUrl).toBeUndefined();
    expect(destination.datasets).toEqual(["events", "errors"]);
    expect(destination.cursor).toEqual({});

    const listed = await listWarehouseDestinations(db, {
      projectId: project.id,
      environmentId: environment.id,
      secretBox: box
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.connectionUrlPreview).toBe(destination.connectionUrlPreview);

    const encryptedBeforeOmittedSecretUpdate = storedAfterCreate.connection_url_encrypted;
    const updated = await updateWarehouseDestination(db, {
      id: destination.id,
      projectId: project.id,
      environmentId: environment.id,
      name: "Warehouse prod",
      datasets: ["events", "traces", "llmCalls"],
      batchSize: 100,
      enabled: false
    }, box);
    expect(updated?.name).toBe("Warehouse prod");
    expect(updated?.datasets).toEqual(["events", "traces", "llmCalls"]);
    expect(updated?.enabled).toBe(false);

    const storedAfterOmittedSecretUpdate = await db
      .selectFrom("warehouse_destinations")
      .selectAll()
      .where("id", "=", destination.id)
      .executeTakeFirstOrThrow() as { connection_url: string | null; connection_url_encrypted?: string | null };
    expect(storedAfterOmittedSecretUpdate.connection_url).toBeNull();
    expect(storedAfterOmittedSecretUpdate.connection_url_encrypted).toBe(encryptedBeforeOmittedSecretUpdate);

    await updateWarehouseDestination(db, {
      id: destination.id,
      projectId: project.id,
      environmentId: environment.id,
      connectionUrl: "postgres://synthetic-user:replacement@warehouse.invalid/analytics"
    }, box);
    const storedAfterSecretUpdate = await db
      .selectFrom("warehouse_destinations")
      .selectAll()
      .where("id", "=", destination.id)
      .executeTakeFirstOrThrow() as { connection_url: string | null; connection_url_encrypted?: string | null };
    expect(storedAfterSecretUpdate.connection_url).toBeNull();
    expect(storedAfterSecretUpdate.connection_url_encrypted).toMatch(/^v1\./);
    expect(storedAfterSecretUpdate.connection_url_encrypted).not.toBe(encryptedBeforeOmittedSecretUpdate);

    const privileged = await getWarehouseDestination(db, {
      id: destination.id,
      projectId: project.id,
      environmentId: environment.id,
      includeSecret: true,
      secretBox: box
    });
    expect(privileged?.connectionUrl).toBe("postgres://synthetic-user:replacement@warehouse.invalid/analytics");
    expect(privileged).not.toHaveProperty("connectionUrlEncrypted");

    await archiveWarehouseDestination(db, {
      id: destination.id,
      projectId: project.id,
      environmentId: environment.id
    });
    await expect(listWarehouseDestinations(db, {
      projectId: project.id,
      environmentId: environment.id,
      secretBox: box
    })).resolves.toEqual([]);
  });

  it("selects incremental batches and records auditable export runs", async () => {
    const { project, environment } = await createScope();
    const first = new Date("2026-01-01T00:00:00.000Z");
    const second = new Date("2026-01-01T00:05:00.000Z");

    await insertEvent(db, {
      id: "evt_wh_1",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: first,
      receivedAt: first,
      name: "checkout.started",
      properties: { plan: "team" }
    });
    await insertError(db, {
      id: "err_wh_1",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: second,
      receivedAt: second,
      message: "boom",
      severity: "error"
    });
    await insertTrace(db, {
      id: "trc_wh_1",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: second,
      receivedAt: second,
      name: "GET /api/health",
      status: "success",
      startedAt: second,
      durationMs: 42
    });
    await insertLlmCall(db, {
      id: "llm_wh_1",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: second,
      receivedAt: second,
      provider: "openai",
      model: "gpt-5",
      status: "success",
      inputTokens: 10,
      outputTokens: 20,
      costUsd: "0.001"
    });

    const destination = await createWarehouseDestination(db, {
      projectId: project.id,
      environmentId: environment.id,
      name: "Warehouse",
      destinationType: "postgres",
      connectionUrl: "postgres://writer:secret@warehouse.internal:5432/analytics",
      datasets: ["events", "errors", "traces", "llmCalls"],
      batchSize: 10,
      enabled: true
    }, box);

    const batch = await selectWarehouseExportBatch(db, destination, { now: new Date("2026-01-01T01:00:00.000Z") });
    expect(batch.rows.events.map((row) => row.id)).toEqual(["evt_wh_1"]);
    expect(batch.rows.errors.map((row) => row.id)).toEqual(["err_wh_1"]);
    expect(batch.rows.traces.map((row) => row.id)).toEqual(["trc_wh_1"]);
    expect(batch.rows.llmCalls.map((row) => row.id)).toEqual(["llm_wh_1"]);
    expect(batch.nextCursor.events).toEqual({ timestamp: first.toISOString(), id: "evt_wh_1" });
    expect(batch.nextCursor.errors).toEqual({ timestamp: second.toISOString(), id: "err_wh_1" });

    await updateWarehouseDestinationCursor(db, {
      id: destination.id,
      projectId: project.id,
      environmentId: environment.id,
      cursor: batch.nextCursor
    });

    const nextDestination = (await listWarehouseDestinations(db, {
      projectId: project.id,
      environmentId: environment.id,
      secretBox: box
    }))[0];
    const emptyBatch = await selectWarehouseExportBatch(db, nextDestination!, { now: new Date("2026-01-01T02:00:00.000Z") });
    expect(emptyBatch.rowCount).toBe(0);

    const run = await recordWarehouseExportRun(db, {
      destinationId: destination.id,
      projectId: project.id,
      environmentId: environment.id,
      trigger: "manual",
      status: "success",
      startedAt: first,
      finishedAt: second,
      cursorBefore: {},
      cursorAfter: batch.nextCursor,
      exported: batch.counts
    });
    expect(run.exported).toEqual({ events: 1, errors: 1, traces: 1, llmCalls: 1 });

    const runs = await listWarehouseExportRuns(db, {
      destinationId: destination.id,
      projectId: project.id,
      environmentId: environment.id
    });
    expect(runs.map((item) => item.id)).toEqual([run.id]);
  });

  it("exports identity profiles with scope-safe ids without skipping actors that share a timestamp", async () => {
    const { project, environment } = await createScope();
    const sharedTimestamp = new Date("2026-01-02T03:04:05.000Z");

    await identifyUserProfile(db, {
      projectId: project.id,
      environmentId: environment.id,
      userId: "user_a",
      tenantId: "tenant_a",
      traits: { email: "a@example.com", plan: "team" },
      timestamp: sharedTimestamp
    });
    await identifyUserProfile(db, {
      projectId: project.id,
      environmentId: environment.id,
      userId: "user_b",
      tenantId: "tenant_b",
      traits: { email: "b@example.com", plan: "enterprise" },
      timestamp: sharedTimestamp
    });
    await identifyTenantProfile(db, {
      projectId: project.id,
      environmentId: environment.id,
      tenantId: "tenant_a",
      traits: { name: "Tenant A", region: "br" },
      timestamp: sharedTimestamp
    });
    await identifyTenantProfile(db, {
      projectId: project.id,
      environmentId: environment.id,
      tenantId: "tenant_b",
      traits: { name: "Tenant B", region: "eu" },
      timestamp: sharedTimestamp
    });

    const destination = await createWarehouseDestination(db, {
      projectId: project.id,
      environmentId: environment.id,
      name: "Identity warehouse",
      destinationType: "postgres",
      connectionUrl: "postgres://writer:secret@warehouse.internal:5432/analytics",
      datasets: ["userProfiles", "tenantProfiles"],
      batchSize: 1,
      enabled: true
    }, box);

    const first = await selectWarehouseExportBatch(db, destination, { now: sharedTimestamp });
    expect(first.rows.userProfiles).toEqual([
      expect.objectContaining({
        id: `${project.id}:${environment.id}:user_a`,
        project_id: project.id,
        environment_id: environment.id,
        user_id: "user_a",
        tenant_id: "tenant_a",
        traits: { email: "a@example.com", plan: "team" },
        timestamp: sharedTimestamp
      })
    ]);
    expect(first.rows.tenantProfiles).toEqual([
      expect.objectContaining({
        id: `${project.id}:${environment.id}:tenant_a`,
        project_id: project.id,
        environment_id: environment.id,
        tenant_id: "tenant_a",
        traits: { name: "Tenant A", region: "br" },
        timestamp: sharedTimestamp
      })
    ]);
    expect(first.nextCursor.userProfiles).toEqual({ timestamp: sharedTimestamp.toISOString(), id: "user_a" });
    expect(first.nextCursor.tenantProfiles).toEqual({ timestamp: sharedTimestamp.toISOString(), id: "tenant_a" });

    const retry = await selectWarehouseExportBatch(db, destination, { now: sharedTimestamp });
    expect(retry.rows.userProfiles.map((row) => row.id)).toEqual(first.rows.userProfiles.map((row) => row.id));
    expect(retry.rows.tenantProfiles.map((row) => row.id)).toEqual(first.rows.tenantProfiles.map((row) => row.id));

    const second = await selectWarehouseExportBatch(
      db,
      { ...destination, cursor: first.nextCursor },
      { now: sharedTimestamp }
    );
    expect(second.rows.userProfiles.map((row) => row.user_id)).toEqual(["user_b"]);
    expect(second.rows.tenantProfiles.map((row) => row.tenant_id)).toEqual(["tenant_b"]);
    expect(second.nextCursor.userProfiles).toEqual({ timestamp: sharedTimestamp.toISOString(), id: "user_b" });
    expect(second.nextCursor.tenantProfiles).toEqual({ timestamp: sharedTimestamp.toISOString(), id: "tenant_b" });

    await identifyUserProfile(db, {
      projectId: project.id,
      environmentId: environment.id,
      userId: "user_a",
      tenantId: "tenant_a",
      traits: { plan: "updated-behind-active-cursor" },
      timestamp: new Date("2026-01-02T04:00:00.000Z")
    });

    const stillActive = await selectWarehouseExportBatch(
      db,
      { ...destination, cursor: first.nextCursor },
      { now: sharedTimestamp }
    );
    expect(stillActive.rows.userProfiles.map((row) => row.user_id)).toEqual(["user_b"]);
    expect(stillActive.rows.userProfiles).not.toEqual([
      expect.objectContaining({ user_id: "user_a", traits: expect.objectContaining({ plan: "updated-behind-active-cursor" }) })
    ]);

    const exhausted = await selectWarehouseExportBatch(
      db,
      { ...destination, cursor: second.nextCursor },
      { now: sharedTimestamp }
    );
    expect(exhausted.rowCount).toBe(0);
    expect(exhausted.rows.userProfiles).toEqual([]);
    expect(exhausted.rows.tenantProfiles).toEqual([]);
    expect(exhausted.nextCursor.userProfiles).toBeUndefined();
    expect(exhausted.nextCursor.tenantProfiles).toBeUndefined();

    const changedAfterCursor = await selectWarehouseExportBatch(
      db,
      { ...destination, cursor: exhausted.nextCursor },
      { now: sharedTimestamp }
    );
    expect(changedAfterCursor.rows.userProfiles).toEqual([
      expect.objectContaining({
        user_id: "user_a",
        traits: expect.objectContaining({ plan: "updated-behind-active-cursor" })
      })
    ]);
  });

  it("fails privileged warehouse reads closed without a valid encrypted secret", async () => {
    const { project, environment } = await createScope();
    const first = await createWarehouseDestination(db, {
      projectId: project.id,
      environmentId: environment.id,
      name: "Fail closed one",
      destinationType: "postgres",
      connectionUrl: "postgres://synthetic-one@warehouse.invalid/db",
      datasets: ["events"]
    }, box);
    const second = await createWarehouseDestination(db, {
      projectId: project.id,
      environmentId: environment.id,
      name: "Fail closed two",
      destinationType: "postgres",
      connectionUrl: "postgres://synthetic-two@warehouse.invalid/db",
      datasets: ["events"]
    }, box);

    await expect(listActiveWarehouseDestinations(db)).rejects.toThrow("secret_box_required");

    const firstRow = await db
      .selectFrom("warehouse_destinations")
      .selectAll()
      .where("id", "=", first.id)
      .executeTakeFirstOrThrow() as { connection_url_encrypted?: string | null };
    await sql`
      update warehouse_destinations
      set connection_url_encrypted = ${firstRow.connection_url_encrypted ?? null}
      where id = ${second.id}
    `.execute(db);
    await expect(listActiveWarehouseDestinations(db, box)).rejects.toThrow("secret_authentication_failed");

    await sql`
      update warehouse_destinations
      set connection_url = 'postgres://legacy.invalid/db', connection_url_encrypted = null
      where id = ${first.id}
    `.execute(db);
    await sql`update warehouse_destinations set archived_at = now() where id = ${second.id}`.execute(db);
    await expect(listActiveWarehouseDestinations(db, box)).rejects.toThrow("legacy_plaintext_secret_present");
  });

});
