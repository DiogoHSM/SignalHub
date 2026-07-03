import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { createTestDb } from "./test-db.js";
import { createEnvironment, createProject } from "../src/repositories/admin.js";
import { insertError, insertEvent, insertLlmCall, insertTrace } from "../src/repositories/telemetry-writes.js";
import {
  archiveWarehouseDestination,
  createWarehouseDestination,
  listWarehouseDestinations,
  listWarehouseExportRuns,
  recordWarehouseExportRun,
  selectWarehouseExportBatch,
  updateWarehouseDestinationCursor,
  updateWarehouseDestination
} from "../src/repositories/warehouse-exports.js";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
let db: Db;

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
      connectionUrl: "postgres://writer:secret@warehouse.internal:5432/analytics",
      datasets: ["events", "errors"],
      batchSize: 250,
      enabled: true
    });

    expect(destination.connectionUrlPreview).toBe("postgres://writer:***@warehouse.internal:5432/analytics");
    expect(destination.connectionUrl).toBeUndefined();
    expect(destination.datasets).toEqual(["events", "errors"]);
    expect(destination.cursor).toEqual({});

    const listed = await listWarehouseDestinations(db, { projectId: project.id, environmentId: environment.id });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.connectionUrlPreview).toBe(destination.connectionUrlPreview);

    const updated = await updateWarehouseDestination(db, {
      id: destination.id,
      projectId: project.id,
      environmentId: environment.id,
      name: "Warehouse prod",
      datasets: ["events", "traces", "llmCalls"],
      batchSize: 100,
      enabled: false
    });
    expect(updated?.name).toBe("Warehouse prod");
    expect(updated?.datasets).toEqual(["events", "traces", "llmCalls"]);
    expect(updated?.enabled).toBe(false);

    await archiveWarehouseDestination(db, {
      id: destination.id,
      projectId: project.id,
      environmentId: environment.id
    });
    await expect(listWarehouseDestinations(db, { projectId: project.id, environmentId: environment.id })).resolves.toEqual([]);
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
    });

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

    const nextDestination = (await listWarehouseDestinations(db, { projectId: project.id, environmentId: environment.id }))[0];
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
});
