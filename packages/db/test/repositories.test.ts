import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedBootstrapAdmin } from "../../../scripts/seed-admin.js";
import { createDb } from "../src/client.js";
import type { Db } from "../src/client.js";
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

  async function withDb<T>(run: (db: Db) => Promise<T>): Promise<T> {
    const db = createDb(container.getConnectionUri());
    try {
      return await run(db);
    } finally {
      await db.destroy();
    }
  }

  it("runs migrations idempotently", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await migrate(db);
    });
  });

  it("creates admin resources and queries telemetry", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const user = await createUser(db, {
        email: "Admin@Example.com",
        passwordHash: "hash",
        isAdmin: true
      });
      const foundUser = await findUserByEmail(db, "admin@example.com");
      expect(foundUser?.id).toBe(user.id);
      expect(foundUser?.email).toBe("admin@example.com");

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
    });
  });

  it("rejects telemetry whose environment belongs to another project", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const firstProject = await createProject(db, { name: "Cross Project A" });
      const secondProject = await createProject(db, { name: "Cross Project B" });
      await createEnvironment(db, { projectId: firstProject.id, name: "production" });
      const secondEnvironment = await createEnvironment(db, { projectId: secondProject.id, name: "production" });

      await expect(
        insertEvent(db, {
          id: "evt_cross_project",
          projectId: firstProject.id,
          environmentId: secondEnvironment.id,
          timestamp: new Date("2026-05-02T12:00:00.000Z"),
          receivedAt: new Date("2026-05-02T12:00:01.000Z"),
          name: "invalid_cross_project_event"
        })
      ).rejects.toThrow();
    });
  });

  it("does not find archived users by email", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const user = await createUser(db, {
        email: "archived@example.com",
        passwordHash: "hash",
        isAdmin: false
      });

      await db
        .updateTable("users")
        .set({ archived_at: new Date("2026-05-02T12:00:00.000Z") })
        .where("id", "=", user.id)
        .execute();

      await expect(findUserByEmail(db, "archived@example.com")).resolves.toBeUndefined();
      await expect(
        createUser(db, {
          email: "archived@example.com",
          passwordHash: "new-hash",
          isAdmin: false
        })
      ).resolves.toMatchObject({ email: "archived@example.com" });
    });
  });

  it("rejects duplicate active users with different email casing", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await createUser(db, {
        email: "Case-Dupe@Example.com",
        passwordHash: "hash",
        isAdmin: false
      });

      await expect(
        createUser(db, {
          email: "case-dupe@example.com",
          passwordHash: "hash",
          isAdmin: false
        })
      ).rejects.toThrow();
    });
  });

  it("rejects bootstrap admin seeding when active email belongs to a non-admin user", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await createUser(db, {
        email: "bootstrap@example.com",
        passwordHash: "hash",
        isAdmin: false
      });

      await expect(
        seedBootstrapAdmin(db, {
          email: "bootstrap@example.com",
          password: "unused"
        })
      ).rejects.toThrow("Bootstrap admin email already belongs to a non-admin user");
    });
  });

  it("rejects duplicate api key prefixes", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Duplicate Prefix API" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      await createApiKeyRecord(db, {
        projectId: project.id,
        environmentId: environment.id,
        name: "first key",
        prefix: "sh_duplicate",
        hash: "hash-1"
      });

      await expect(
        createApiKeyRecord(db, {
          projectId: project.id,
          environmentId: environment.id,
          name: "second key",
          prefix: "sh_duplicate",
          hash: "hash-2"
        })
      ).rejects.toThrow();
    });
  });

  it("detects migration checksum mismatches", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum text NOT NULL DEFAULT 'wrong'`.execute(db);
      await sql`UPDATE _migrations SET checksum = 'wrong' WHERE name = '0001_initial.sql'`.execute(db);

      await expect(migrate(db)).rejects.toThrow("Migration 0001_initial.sql checksum mismatch");
    });
  });
});
