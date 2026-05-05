import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedBootstrapAdmin } from "../../../scripts/seed-admin.js";
import { createDb } from "../src/client.js";
import type { Db } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { insertDeadLetterJob } from "../src/repositories/dead-letter.js";
import {
  archiveEnvironment,
  archiveProject,
  createApiKeyRecord,
  createEnvironment,
  createProject,
  findApiKeyByPrefix,
  getProject,
  listApiKeys,
  listEnvironments,
  listProjects,
  revokeApiKey,
  updateEnvironment,
  updateProject
} from "../src/repositories/admin.js";
import {
  archiveUser,
  createUser,
  findUserByEmail,
  findUserByGoogleSubject,
  findUserById,
  linkGoogleSubject,
  listUsers,
  updateUser
} from "../src/repositories/users.js";
import { insertError, insertEvent, insertLlmCall, insertSpan, insertTrace } from "../src/repositories/telemetry-writes.js";
import {
  getErrorAggregates,
  getEventAggregates,
  getLlmAggregates,
  getTraceAggregates,
  listErrors,
  listEvents,
  listLlmCalls,
  listTraceSpans,
  listTraces
} from "../src/repositories/telemetry-query.js";

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

  it("inserts dead letter jobs with sanitized details", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const job = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "event",
        payload: { metadata: { authorization: "[REDACTED]" } },
        errorMessage: "authorization: [REDACTED]"
      });

      expect(job).toMatchObject({
        id: expect.stringMatching(/^dlj_/),
        queueName: "telemetry",
        jobName: "event",
        payload: { metadata: { authorization: "[REDACTED]" } },
        errorMessage: "authorization: [REDACTED]",
        createdAt: expect.any(Date)
      });
    });
  });

  it("supports runtime admin resource and user management helpers", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const user = await createUser(db, {
        email: "runtime-user@example.com",
        passwordHash: "hash",
        isAdmin: false
      });
      await expect(findUserById(db, user.id)).resolves.toMatchObject({ id: user.id });
      await expect(listUsers(db)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: user.id })]));
      await expect(updateUser(db, user.id, { email: "Runtime-Renamed@example.com", isAdmin: true })).resolves.toMatchObject({
        id: user.id,
        email: "runtime-renamed@example.com",
        isAdmin: true
      });
      await archiveUser(db, user.id);
      await expect(findUserById(db, user.id)).resolves.toBeUndefined();

      const project = await createProject(db, { name: "Runtime Project" });
      await expect(listProjects(db)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: project.id })]));
      await expect(getProject(db, project.id)).resolves.toMatchObject({ id: project.id });
      await expect(updateProject(db, project.id, { name: "Runtime Project Updated" })).resolves.toMatchObject({
        id: project.id,
        name: "Runtime Project Updated"
      });

      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      await expect(listEnvironments(db, project.id)).resolves.toEqual([expect.objectContaining({ id: environment.id })]);
      await expect(updateEnvironment(db, environment.id, { name: "staging" })).resolves.toMatchObject({
        id: environment.id,
        name: "staging"
      });

      const apiKey = await createApiKeyRecord(db, {
        projectId: project.id,
        environmentId: environment.id,
        name: "runtime key",
        prefix: "sh_runtime12",
        hash: "runtime-hash"
      });
      await expect(listApiKeys(db, project.id)).resolves.toEqual([expect.objectContaining({ id: apiKey.id })]);
      await expect(findApiKeyByPrefix(db, "sh_runtime12")).resolves.toMatchObject({ id: apiKey.id });

      const archivedProject = await createProject(db, { name: "Archived Key Project" });
      const archivedProjectEnvironment = await createEnvironment(db, {
        projectId: archivedProject.id,
        name: "production"
      });
      await createApiKeyRecord(db, {
        projectId: archivedProject.id,
        environmentId: archivedProjectEnvironment.id,
        name: "archived project key",
        prefix: "sh_archproj1",
        hash: "archived-project-hash"
      });
      await archiveProject(db, archivedProject.id);
      await expect(findApiKeyByPrefix(db, "sh_archproj1")).resolves.toBeUndefined();

      const archivedEnvironment = await createEnvironment(db, { projectId: project.id, name: "archived-env" });
      await createApiKeyRecord(db, {
        projectId: project.id,
        environmentId: archivedEnvironment.id,
        name: "archived environment key",
        prefix: "sh_archenv12",
        hash: "archived-environment-hash"
      });
      await archiveEnvironment(db, archivedEnvironment.id);
      await expect(findApiKeyByPrefix(db, "sh_archenv12")).resolves.toBeUndefined();

      await revokeApiKey(db, apiKey.id);
      await expect(findApiKeyByPrefix(db, "sh_runtime12")).resolves.toBeUndefined();

      await archiveEnvironment(db, environment.id);
      await expect(listEnvironments(db, project.id)).resolves.toEqual([]);
      await archiveProject(db, project.id);
      await expect(getProject(db, project.id)).resolves.toBeUndefined();
    });
  });

  it("rejects new environments and API keys under archived scopes", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Active Scope Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const archivedProject = await createProject(db, { name: "Archived Scope Project" });
      const archivedProjectEnvironment = await createEnvironment(db, {
        projectId: archivedProject.id,
        name: "production"
      });

      await archiveProject(db, archivedProject.id);
      await expect(createEnvironment(db, { projectId: archivedProject.id, name: "staging" })).rejects.toThrow(
        "active_project_not_found"
      );
      await expect(
        createApiKeyRecord(db, {
          projectId: archivedProject.id,
          environmentId: archivedProjectEnvironment.id,
          name: "archived project key",
          prefix: "sh_rejectp1",
          hash: "hash"
        })
      ).rejects.toThrow("active_api_key_scope_not_found");

      const archivedEnvironment = await createEnvironment(db, { projectId: project.id, name: "archived" });
      await archiveEnvironment(db, archivedEnvironment.id);
      await expect(
        createApiKeyRecord(db, {
          projectId: project.id,
          environmentId: archivedEnvironment.id,
          name: "archived environment key",
          prefix: "sh_rejecte1",
          hash: "hash"
        })
      ).rejects.toThrow("active_api_key_scope_not_found");

      await expect(
        createApiKeyRecord(db, {
          projectId: archivedProject.id,
          environmentId: environment.id,
          name: "cross project key",
          prefix: "sh_rejectx1",
          hash: "hash"
        })
      ).rejects.toThrow("active_api_key_scope_not_found");
    });
  });

  it("supports runtime telemetry list and aggregate helpers", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Runtime Telemetry" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_runtime",
        userId: "user_runtime",
        sessionId: "session_runtime",
        traceId: "trace_runtime",
        timestamp: new Date("2026-05-02T12:00:00.000Z"),
        receivedAt: new Date("2026-05-02T12:00:01.000Z")
      };

      await insertEvent(db, { ...base, id: "evt_runtime", name: "runtime.event" });
      await insertError(db, { ...base, id: "err_runtime", message: "Runtime failed", severity: "error" });
      await insertLlmCall(db, {
        ...base,
        id: "llm_runtime",
        provider: "openai",
        model: "gpt-5",
        inputTokens: 3,
        outputTokens: 4,
        costUsd: "0.010000",
        status: "success"
      });
      await insertTrace(db, {
        ...base,
        id: "trc_runtime",
        name: "runtime trace",
        status: "ok",
        startedAt: new Date("2026-05-02T12:00:00.000Z"),
        durationMs: 20
      });
      await insertSpan(db, {
        ...base,
        id: "spn_runtime",
        traceId: "trace_runtime",
        name: "runtime span",
        status: "ok",
        startedAt: new Date("2026-05-02T12:00:00.000Z"),
        durationMs: 10
      });

      const filters = { projectId: project.id, environmentId: environment.id, traceId: "trace_runtime" };
      await expect(listEvents(db, filters)).resolves.toEqual([expect.objectContaining({ id: "evt_runtime" })]);
      await expect(listErrors(db, filters)).resolves.toEqual([expect.objectContaining({ id: "err_runtime" })]);
      await expect(listLlmCalls(db, filters)).resolves.toEqual([expect.objectContaining({ id: "llm_runtime" })]);
      await expect(listTraces(db, filters)).resolves.toEqual([expect.objectContaining({ id: "trc_runtime" })]);
      await expect(listTraceSpans(db, filters)).resolves.toEqual([expect.objectContaining({ id: "spn_runtime" })]);
      await expect(getEventAggregates(db, filters)).resolves.toMatchObject({ total: 1 });
      await expect(getErrorAggregates(db, filters)).resolves.toMatchObject({ total: 1, open: 1 });
      await expect(getLlmAggregates(db, filters)).resolves.toMatchObject({ totalCalls: 1, totalInputTokens: 3 });
      await expect(getTraceAggregates(db, filters)).resolves.toMatchObject({ total: 1, averageDurationMs: 20 });
    });
  });

  it("filters LLM calls and aggregates by exact LLM fields", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "LLM Filters" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_llm",
        userId: "user_llm",
        sessionId: "session_llm",
        traceId: "trace_llm",
        timestamp: new Date("2026-05-05T12:00:00.000Z"),
        receivedAt: new Date("2026-05-05T12:00:01.000Z")
      };

      await insertLlmCall(db, {
        ...base,
        id: "llm_match",
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: "0.250000",
        latencyMs: 1200,
        status: "success"
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_other_model",
        provider: "openai",
        model: "gpt-4",
        promptName: "generate_sql",
        inputTokens: 100,
        outputTokens: 200,
        costUsd: "2.500000",
        latencyMs: 2200,
        status: "success"
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_other_status",
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        inputTokens: 5,
        outputTokens: 6,
        costUsd: "0.050000",
        latencyMs: 800,
        status: "error"
      });

      const filters = {
        projectId: project.id,
        environmentId: environment.id,
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        status: "success"
      };

      await expect(listLlmCalls(db, filters)).resolves.toEqual([expect.objectContaining({ id: "llm_match" })]);
      await expect(getLlmAggregates(db, filters)).resolves.toMatchObject({
        totalCalls: 1,
        totalInputTokens: 10,
        totalOutputTokens: 20,
        totalCostUsd: "0.250000"
      });
    });
  });

  it("filters events by exact event name", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Named Events API" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-04T12:00:00.000Z"),
        receivedAt: new Date("2026-05-04T12:00:01.000Z")
      };

      await insertEvent(db, { ...base, id: "evt_named_1", name: "checkout.started" });
      await insertEvent(db, { ...base, id: "evt_named_2", name: "checkout.completed" });

      await expect(
        listEvents(db, { projectId: project.id, environmentId: environment.id, eventName: "checkout.started" })
      ).resolves.toEqual([expect.objectContaining({ id: "evt_named_1", name: "checkout.started" })]);
    });
  });

  it("filters errors by exact severity status and fingerprint", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Filtered Errors API" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-04T12:00:00.000Z"),
        receivedAt: new Date("2026-05-04T12:00:01.000Z")
      };

      await insertError(db, {
        ...base,
        id: "err_filtered_1",
        message: "Checkout fetch failed",
        severity: "critical",
        status: "open",
        fingerprint: "fp_checkout_fetch"
      });
      await insertError(db, {
        ...base,
        id: "err_filtered_2",
        message: "Checkout fetch failed",
        severity: "warning",
        status: "open",
        fingerprint: "fp_checkout_fetch"
      });
      await insertError(db, {
        ...base,
        id: "err_filtered_3",
        message: "Checkout fetch failed",
        severity: "critical",
        status: "resolved",
        fingerprint: "fp_checkout_fetch"
      });
      await insertError(db, {
        ...base,
        id: "err_filtered_4",
        message: "Other error",
        severity: "critical",
        status: "open",
        fingerprint: "fp_other"
      });

      await expect(
        listErrors(db, {
          projectId: project.id,
          environmentId: environment.id,
          severity: "critical",
          status: "open",
          fingerprint: "fp_checkout_fetch"
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "err_filtered_1",
          severity: "critical",
          status: "open",
          fingerprint: "fp_checkout_fetch"
        })
      ]);
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

  it("finds active users inserted directly with mixed-case email", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`
        INSERT INTO users (id, email, password_hash, is_admin)
        VALUES ('usr_direct_mixed_case', 'DirectMixed@Example.com', 'hash', true)
      `.execute(db);

      await expect(findUserByEmail(db, "directmixed@example.com")).resolves.toMatchObject({
        id: "usr_direct_mixed_case"
      });
    });
  });

  it("links and finds users by Google subject", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const user = await createUser(db, {
        email: "google-user@example.com",
        passwordHash: "hash",
        isAdmin: false
      });

      await expect(linkGoogleSubject(db, user.id, "google-subject-1")).resolves.toMatchObject({
        id: user.id,
        googleSubject: "google-subject-1"
      });
      await expect(findUserByGoogleSubject(db, "google-subject-1")).resolves.toMatchObject({
        id: user.id,
        email: "google-user@example.com"
      });

      await archiveUser(db, user.id);
      await expect(findUserByGoogleSubject(db, "google-subject-1")).resolves.toBeUndefined();
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

  it("rejects bootstrap admin seeding for direct mixed-case non-admin users", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`
        INSERT INTO users (id, email, password_hash, is_admin)
        VALUES ('usr_bootstrap_mixed_non_admin', 'BootstrapMixed@Example.com', 'hash', false)
      `.execute(db);

      await expect(
        seedBootstrapAdmin(db, {
          email: "bootstrapmixed@example.com",
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

  it("bounds event listing by default and explicit limits", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Bounded Events API" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      for (let index = 0; index < 55; index += 1) {
        await insertEvent(db, {
          id: `evt_bounded_${index}`,
          projectId: project.id,
          environmentId: environment.id,
          timestamp: new Date(Date.UTC(2026, 4, 2, 12, index, 0)),
          receivedAt: new Date(Date.UTC(2026, 4, 2, 12, index, 1)),
          name: "bounded_event"
        });
      }

      const defaultEvents = await listEvents(db, { projectId: project.id, environmentId: environment.id });
      expect(defaultEvents).toHaveLength(50);

      const limitedEvents = await listEvents(db, { projectId: project.id, environmentId: environment.id, limit: 2 });
      expect(limitedEvents).toHaveLength(2);
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
