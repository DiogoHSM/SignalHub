import { GenericContainer, Wait } from "testcontainers";
import { afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { processTelemetryJob, type TelemetryWriter } from "@sigmon/worker";
import { createApiKey, hashApiKey, verifyApiKey as verifyTelemetryApiKey } from "@sigmon/telemetry/api-keys";
import { createDb, type Db } from "@sigmon/db";
import { migrate } from "@sigmon/db/migrate.js";
import {
  createApiKeyRecord,
  createEnvironment,
  createProject,
  findApiKeyByPrefix
} from "@sigmon/db/repositories/admin.js";
import { getEntityTenantDetail, listEntityTenants } from "@sigmon/db/repositories/entities-query.js";
import { getUserDetail, listUsersActivity } from "@sigmon/db/repositories/users-query.js";
import { listEvents } from "@sigmon/db/repositories/telemetry-query.js";
import {
  insertError,
  insertEvent,
  insertLlmCall,
  insertSpan,
  insertTrace
} from "@sigmon/db/repositories/telemetry-writes.js";
import { createTelemetryQueue, enqueueTelemetryJob } from "@sigmon/queues";

let postgresContainer: Awaited<ReturnType<GenericContainer["start"]>> | undefined;
let redisContainer: Awaited<ReturnType<GenericContainer["start"]>> | undefined;

const apiKeyPepper = "e2e-api-key-pepper";
const adminUser = { id: "usr_e2e_admin", email: "admin@example.com", isAdmin: true };

function telemetryWriter(db: Db): TelemetryWriter {
  return {
    insertEvent: (input) => insertEvent(db, input),
    insertError: (input) => insertError(db, input),
    insertLlmCall: (input) => insertLlmCall(db, input),
    insertTrace: (input) => insertTrace(db, input),
    insertSpan: (input) => insertSpan(db, input)
  };
}

describe("telemetry core e2e", () => {
  afterAll(async () => {
    await redisContainer?.stop();
    await postgresContainer?.stop();
  }, 30_000);

  it("ingests, processes, persists, and queries a sanitized event", async () => {
    postgresContainer = await new GenericContainer("postgres:16-alpine")
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
    redisContainer = await new GenericContainer("redis:7-alpine")
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
      .start();

    const databaseUrl = `postgres://sigmon:sigmon@${postgresContainer.getHost()}:${postgresContainer.getMappedPort(
      5432
    )}/sigmon`;
    const db = createDb(databaseUrl);
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
    const queue = createTelemetryQueue(redisUrl);
    let app: FastifyInstance | undefined;

    try {
      await migrate(db);

      const project = await createProject(db, { name: "E2E Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const createdApiKey = createApiKey();
      await createApiKeyRecord(db, {
        projectId: project.id,
        environmentId: environment.id,
        name: "E2E ingest",
        prefix: createdApiKey.prefix,
        hash: await hashApiKey(createdApiKey.secret, apiKeyPepper)
      });

      app = await buildApp({
        readiness: async () => ({ postgres: true, redis: true }),
        auth: {
          login: async () => adminUser,
          findSessionUser: async () => adminUser
        },
        ingestion: {
          verifyApiKey: async (secret) => {
            const apiKey = await findApiKeyByPrefix(db, secret.slice(0, 12));
            if (!apiKey || !(await verifyTelemetryApiKey(apiKey.hash, secret, apiKeyPepper))) {
              return null;
            }

            return {
              projectId: apiKey.projectId,
              environmentId: apiKey.environmentId
            };
          },
          enqueue: async (job) => {
            await enqueueTelemetryJob(queue, job);
          }
        },
        query: {
          listEvents: (filters) => listEvents(db, filters),
          listEntityTenants: (filters) => listEntityTenants(db, filters),
          getEntityTenantDetail: (tenantId, filters) => getEntityTenantDetail(db, tenantId, filters),
          listUsersActivity: (filters) => listUsersActivity(db, filters),
          getUserDetail: (userId, filters) => getUserDetail(db, userId, filters)
        }
      });

      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/events",
        headers: { authorization: `Bearer ${createdApiKey.secret}` },
        payload: {
          timestamp: "2026-05-02T12:00:00.000Z",
          tenant_id: "tenant_e2e",
          user_id: "user_e2e",
          session_id: "session_e2e",
          trace_id: "trace_e2e",
          source: "e2e-test",
          release: "1.0.0",
          metadata: {
            authorization: "Bearer should-not-persist",
            region: "us-east-1"
          },
          name: "checkout.completed",
          properties: {
            plan: "pro",
            password: "should-not-persist",
            nested: {
              access_token: "should-not-persist"
            }
          }
        }
      });

      expect(ingestResponse.statusCode).toBe(202);
      const ingestedEventId = ingestResponse.json<{ id: string }>().id;

      const queuedJobs = await queue.getWaiting();
      expect(queuedJobs).toHaveLength(1);
      expect(queuedJobs[0].data).toMatchObject({
        kind: "event",
        id: ingestedEventId,
        projectId: project.id,
        environmentId: environment.id
      });

      await processTelemetryJob(queuedJobs[0].data, telemetryWriter(db));
      await queuedJobs[0].remove();

      const queryResponse = await app.inject({
        method: "GET",
        url: `/query/events?project_id=${project.id}&environment_id=${environment.id}&limit=1`
      });

      expect(queryResponse.statusCode).toBe(200);
      expect(queryResponse.json()).toEqual({
        data: [
          expect.objectContaining({
            id: ingestedEventId,
            projectId: project.id,
            environmentId: environment.id,
            tenantId: "tenant_e2e",
            userId: "user_e2e",
            sessionId: "session_e2e",
            traceId: "trace_e2e",
            source: "e2e-test",
            release: "1.0.0",
            name: "checkout.completed",
            metadata: {
              authorization: "[REDACTED]",
              region: "us-east-1"
            },
            properties: {
              plan: "pro",
              password: "[REDACTED]",
              nested: {
                access_token: "[REDACTED]"
              }
            }
          })
        ]
      });
    } finally {
      await app?.close();
      try {
        await queue.obliterate({ force: true });
      } finally {
        await queue.close();
      }
      await db.destroy();
    }
  }, 90_000);
});
