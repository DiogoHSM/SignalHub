import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { createProject, createEnvironment, createApiKeyRecord } from "../src/repositories/admin.js";
import { createUser, findUserByEmail } from "../src/repositories/users.js";
import { insertEvent, insertLlmCall } from "../src/repositories/telemetry-writes.js";
import { listEvents, getLlmAggregates } from "../src/repositories/telemetry-query.js";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;

describe("repositories", () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("signalhub")
      .withUsername("signalhub")
      .withPassword("signalhub")
      .start();
  }, 60_000);

  afterAll(async () => {
    await container?.stop();
  }, 30_000);

  it("creates admin resources and queries telemetry", async () => {
    const db = createDb(container.getConnectionUri());
    await migrate(db);

    const user = await createUser(db, {
      email: "admin@example.com",
      passwordHash: "hash",
      isAdmin: true
    });
    const foundUser = await findUserByEmail(db, "admin@example.com");
    expect(foundUser?.id).toBe(user.id);

    const project = await createProject(db, { name: "Demo API" });
    const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
    const apiKey = await createApiKeyRecord(db, {
      projectId: project.id,
      environmentId: environment.id,
      name: "prod key",
      prefix: "sh_abc123456",
      hash: "hash"
    });

    expect(apiKey.revokedAt).toBeNull();

    await insertEvent(db, {
      id: "evt_1",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-02T12:00:00.000Z"),
      receivedAt: new Date("2026-05-02T12:00:01.000Z"),
      name: "dashboard_created",
      tenantId: "tenant_1",
      userId: "user_1",
      sessionId: "session_1",
      traceId: "trace_1",
      source: "web",
      release: "1.0.0",
      metadata: { plan: "pro" },
      properties: { charts_count: 6 }
    });

    await insertLlmCall(db, {
      id: "llm_1",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: new Date("2026-05-02T12:00:00.000Z"),
      receivedAt: new Date("2026-05-02T12:00:01.000Z"),
      tenantId: "tenant_1",
      userId: "user_1",
      provider: "openai",
      model: "gpt-5.5",
      promptName: "generate_sql",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: "0.030000",
      status: "success"
    });

    const events = await listEvents(db, { projectId: project.id, environmentId: environment.id });
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("dashboard_created");

    const llm = await getLlmAggregates(db, { projectId: project.id, environmentId: environment.id });
    expect(llm.totalCalls).toBe(1);
    expect(llm.totalInputTokens).toBe(100);

    await db.destroy();
  });
});
