import { GenericContainer, Wait } from "testcontainers";
import { afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { processTelemetryJob, type TelemetryWriter } from "@sigmon/worker";
import { createApiKey, hashApiKey, verifyApiKey as verifyTelemetryApiKey } from "@sigmon/telemetry/api-keys";
import { createDb, type Db } from "@sigmon/db";
import { migrate } from "@sigmon/db/migrate.js";
import {
  archiveEnvironment,
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
  insertBreadcrumb,
  insertLlmCall,
  insertSpan,
  insertTrace,
  insertWebVital
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
    insertSpan: (input) => insertSpan(db, input),
    insertWebVital: (input) => insertWebVital(db, input),
    insertBreadcrumb: (input) => insertBreadcrumb(db, input)
  };
}

describe("telemetry core e2e", () => {
  afterAll(async () => {
    await redisContainer?.stop();
    await postgresContainer?.stop();
  }, 30_000);

  it("ingests, processes, persists, scopes, and sanitizes all telemetry signal types", async () => {
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
      const previewEnvironment = await createEnvironment(db, { projectId: project.id, name: "preview" });
      const createdApiKey = createApiKey();
      const previewApiKey = createApiKey();
      await createApiKeyRecord(db, {
        projectId: project.id,
        environmentId: environment.id,
        name: "E2E ingest",
        prefix: createdApiKey.prefix,
        hash: await hashApiKey(createdApiKey.secret, apiKeyPepper)
      });
      await createApiKeyRecord(db, {
        projectId: project.id,
        environmentId: previewEnvironment.id,
        name: "E2E preview ingest",
        prefix: previewApiKey.prefix,
        hash: await hashApiKey(previewApiKey.secret, apiKeyPepper)
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

      const ingest = async (url: string, payload: Record<string, unknown>, secret = createdApiKey.secret): Promise<string> => {
        const response = await app!.inject({
          method: "POST",
          url,
          headers: { authorization: `Bearer ${secret}` },
          payload
        });

        expect(response.statusCode).toBe(202);
        return response.json<{ id: string }>().id;
      };

      const archivedProject = await createProject(db, { name: "Archived E2E Project" });
      const archivedEnvironment = await createEnvironment(db, {
        projectId: archivedProject.id,
        name: "production"
      });
      const archivedApiKey = createApiKey();
      await createApiKeyRecord(db, {
        projectId: archivedProject.id,
        environmentId: archivedEnvironment.id,
        name: "Archived E2E ingest",
        prefix: archivedApiKey.prefix,
        hash: await hashApiKey(archivedApiKey.secret, apiKeyPepper)
      });
      await archiveEnvironment(db, archivedEnvironment.id);
      const archivedResponse = await app.inject({
        method: "POST",
        url: "/v1/events",
        headers: { authorization: `Bearer ${archivedApiKey.secret}` },
        payload: {
          name: "archived.scope",
          timestamp: "2026-05-02T12:00:00.000Z"
        }
      });
      expect(archivedResponse.statusCode).toBe(401);
      expect(archivedResponse.json()).toMatchObject({
        error: "invalid_api_key",
        hint: expect.any(String)
      });

      const eventPayload = {
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
      };
      const ingestedEventId = await ingest("/v1/events", eventPayload);

      const queuedJobs = await queue.getWaiting();
      expect(queuedJobs).toHaveLength(1);
      expect(queuedJobs[0].data).toMatchObject({
        kind: "event",
        id: ingestedEventId,
        projectId: project.id,
        environmentId: environment.id
      });

      await processTelemetryJob(queuedJobs[0].data, telemetryWriter(db));
      await processTelemetryJob(queuedJobs[0].data, telemetryWriter(db));
      await queuedJobs[0].remove();

      const errorId = await ingest("/v1/errors", {
        ...eventPayload,
        message: "Checkout failed",
        type: "TypeError",
        severity: "error",
        stack: "TypeError: Checkout failed\n    at checkout (https://cdn.example.com/app.min.js:1:1)",
        context: {
          cpf: "123.456.789-09",
          credit_card: "4111111111111111",
          headers: { cookie: "session=secret" }
        }
      });
      const llmId = await ingest("/v1/llm", {
        ...eventPayload,
        provider: "openai",
        model: "gpt-5",
        prompt_name: "checkout_support",
        input_tokens: 12,
        output_tokens: 34,
        cost_usd: 0.0042,
        latency_ms: 321,
        status: "success",
        input_preview: "api_key: key_should_not_persist",
        output_preview: "safe summary"
      });
      const traceId = await ingest("/v1/traces", {
        ...eventPayload,
        name: "checkout request",
        status: "success",
        started_at: "2026-05-02T12:00:00.000Z",
        ended_at: "2026-05-02T12:00:00.125Z",
        duration_ms: 125
      });
      const spanId = await ingest("/v1/spans", {
        ...eventPayload,
        trace_id: traceId,
        name: "db.query",
        status: "success",
        started_at: "2026-05-02T12:00:00.010Z",
        ended_at: "2026-05-02T12:00:00.040Z",
        duration_ms: 30,
        input: { cpf: "123.456.789-09" },
        output: { credit_card: "4111111111111111" },
        error: { cookie: "session=secret" }
      });
      const webVitalId = await ingest("/v1/web-vitals", {
        ...eventPayload,
        name: "LCP",
        value: 1820.5,
        rating: "good",
        route: "/checkout",
        navigation_type: "navigate"
      });
      const breadcrumbId = await ingest("/v1/breadcrumbs", {
        ...eventPayload,
        type: "custom",
        category: "checkout",
        message: "authorization: Bearer should-not-persist",
        level: "info",
        data: { cookie: "session=secret", step: "payment" }
      });
      const previewEventId = await ingest(
        "/v1/events",
        {
          ...eventPayload,
          name: "preview.only",
          tenant_id: "tenant_preview",
          user_id: "user_preview"
        },
        previewApiKey.secret
      );

      const remainingJobs = await queue.getWaiting();
      expect(remainingJobs).toHaveLength(7);
      for (const job of remainingJobs) {
        await processTelemetryJob(job.data, telemetryWriter(db));
        await processTelemetryJob(job.data, telemetryWriter(db));
        await job.remove();
      }

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

      const previewQueryResponse = await app.inject({
        method: "GET",
        url: `/query/events?project_id=${project.id}&environment_id=${previewEnvironment.id}&limit=10`
      });

      expect(previewQueryResponse.statusCode).toBe(200);
      expect(previewQueryResponse.json()).toEqual({
        data: [
          expect.objectContaining({
            id: previewEventId,
            projectId: project.id,
            environmentId: previewEnvironment.id,
            name: "preview.only"
          })
        ]
      });

      const eventRows = await db.selectFrom("events").select(["id"]).where("id", "=", ingestedEventId).execute();
      expect(eventRows).toHaveLength(1);
      await expect(db.selectFrom("errors").select(["id"]).where("id", "=", errorId).execute()).resolves.toHaveLength(1);
      await expect(db.selectFrom("llm_calls").select(["id"]).where("id", "=", llmId).execute()).resolves.toHaveLength(1);
      await expect(db.selectFrom("traces").select(["id"]).where("id", "=", traceId).execute()).resolves.toHaveLength(1);
      await expect(db.selectFrom("spans").select(["id"]).where("id", "=", spanId).execute()).resolves.toHaveLength(1);
      await expect(db.selectFrom("web_vitals").select(["id"]).where("id", "=", webVitalId).execute()).resolves.toHaveLength(1);
      await expect(db.selectFrom("breadcrumbs").select(["id"]).where("id", "=", breadcrumbId).execute()).resolves.toHaveLength(1);

      const errorRow = await db
        .selectFrom("errors")
        .select(["project_id", "environment_id", "context"])
        .where("id", "=", errorId)
        .executeTakeFirstOrThrow();
      expect(errorRow).toMatchObject({ project_id: project.id, environment_id: environment.id });
      expect(errorRow.context).toEqual({
        cpf: "[REDACTED]",
        credit_card: "[REDACTED]",
        headers: { cookie: "[REDACTED]" }
      });

      const llmRow = await db
        .selectFrom("llm_calls")
        .select(["project_id", "environment_id", "input_preview", "output_preview"])
        .where("id", "=", llmId)
        .executeTakeFirstOrThrow();
      expect(llmRow).toMatchObject({
        project_id: project.id,
        environment_id: environment.id,
        input_preview: "api_key: [REDACTED]",
        output_preview: "safe summary"
      });

      const traceRow = await db
        .selectFrom("traces")
        .select(["project_id", "environment_id", "name", "duration_ms", "metadata"])
        .where("id", "=", traceId)
        .executeTakeFirstOrThrow();
      expect(traceRow).toMatchObject({
        project_id: project.id,
        environment_id: environment.id,
        name: "checkout request",
        duration_ms: 125,
        metadata: {
          authorization: "[REDACTED]",
          region: "us-east-1"
        }
      });

      const spanRow = await db
        .selectFrom("spans")
        .select(["project_id", "environment_id", "trace_id", "input", "output", "error"])
        .where("id", "=", spanId)
        .executeTakeFirstOrThrow();
      expect(spanRow).toMatchObject({
        project_id: project.id,
        environment_id: environment.id,
        trace_id: traceId,
        input: { cpf: "[REDACTED]" },
        output: { credit_card: "[REDACTED]" },
        error: { cookie: "[REDACTED]" }
      });

      const webVitalRow = await db
        .selectFrom("web_vitals")
        .select(["project_id", "environment_id", "name", "route", "navigation_type", "metadata"])
        .where("id", "=", webVitalId)
        .executeTakeFirstOrThrow();
      expect(webVitalRow).toMatchObject({
        project_id: project.id,
        environment_id: environment.id,
        name: "LCP",
        route: "/checkout",
        navigation_type: "navigate",
        metadata: {
          authorization: "[REDACTED]",
          region: "us-east-1"
        }
      });

      const breadcrumbRow = await db
        .selectFrom("breadcrumbs")
        .select(["project_id", "environment_id", "message", "data"])
        .where("id", "=", breadcrumbId)
        .executeTakeFirstOrThrow();
      expect(breadcrumbRow).toMatchObject({
        project_id: project.id,
        environment_id: environment.id,
        message: "authorization: [REDACTED]",
        data: { cookie: "[REDACTED]", step: "payment" }
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
