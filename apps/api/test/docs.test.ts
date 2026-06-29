import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("API docs", () => {
  async function createApp() {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      nodeEnv: "production"
    });
    return app;
  }

  it("serves an OpenAPI 3.1 document", async () => {
    const server = await createApp();

    const response = await server.inject({ method: "GET", url: "/openapi.json" });
    const spec = response.json();

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("SignalMonitor API");
    expect(spec.info.description).toContain("@sigmon/sdk");
    expect(spec.info.description).toContain("NEXT_PUBLIC_SIGMON_BROWSER_KEY");
    expect(spec.info.description).toContain("POST /v1/identify/user");
    expect(spec.servers).toEqual([{ url: "https://my.sigmon.app", description: "Production" }]);
    expect(spec.externalDocs).toEqual({ description: "Raw OpenAPI document", url: "/openapi.json" });
  });

  it("documents the public ingestion paths and auth schemes", async () => {
    const server = await createApp();

    const response = await server.inject({ method: "GET", url: "/openapi.json" });
    const spec = response.json();

    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        "/health",
        "/ready",
        "/v1/events",
        "/v1/errors",
        "/v1/breadcrumbs",
        "/v1/llm",
        "/v1/traces",
        "/v1/spans",
        "/v1/identify/user",
        "/v1/identify/tenant",
        "/v1/source-maps",
        "/v1/heartbeats/{id}",
        "/auth/login",
        "/admin/projects",
        "/admin/monitors",
        "/admin/monitors/{id}/checks",
        "/admin/dead-letter-jobs",
        "/admin/dead-letter-jobs/{id}",
        "/admin/dead-letter-jobs/{id}/actions",
        "/admin/dead-letter-jobs/{id}/replay",
        "/query/events",
        "/system/health"
      ])
    );
    expect(spec.components.securitySchemes).toMatchObject({
      ingestionApiKey: { type: "http", scheme: "bearer" },
      heartbeatSecret: { type: "http", scheme: "bearer" },
      sourceMapUploadToken: { type: "http", scheme: "bearer" },
      sessionCookie: { type: "apiKey", in: "cookie", name: "__Host-sigmon_session" }
    });
    expect(spec.paths["/v1/events"].post.security).toEqual([{ ingestionApiKey: [] }]);
    expect(spec.paths["/v1/identify/user"].post.security).toEqual([{ ingestionApiKey: [] }]);
    expect(spec.paths["/v1/identify/tenant"].post.security).toEqual([{ ingestionApiKey: [] }]);
    expect(Object.keys(spec.paths["/v1/identify/user"].post.responses)).toEqual(["202", "400", "401", "503"]);
    expect(Object.keys(spec.paths["/v1/identify/tenant"].post.responses)).toEqual(["202", "400", "401", "503"]);
    expect(spec.paths["/v1/heartbeats/{id}"].post.security).toEqual([{ heartbeatSecret: [] }]);
    expect(spec.paths["/v1/source-maps"].post.security).toEqual([{ sourceMapUploadToken: [] }]);
    expect(spec.paths["/admin/dead-letter-jobs"].get.security).toEqual([{ sessionCookie: [] }]);
    expect(spec.paths["/admin/dead-letter-jobs/{id}"].get.security).toEqual([{ sessionCookie: [] }]);
    expect(spec.paths["/admin/dead-letter-jobs/{id}"].delete.security).toEqual([{ sessionCookie: [] }]);
    expect(spec.paths["/admin/dead-letter-jobs/{id}/actions"].get.security).toEqual([{ sessionCookie: [] }]);
    expect(spec.paths["/admin/dead-letter-jobs/{id}/replay"].post.security).toEqual([{ sessionCookie: [] }]);
    expect(spec.paths["/admin/dead-letter-jobs"].get.parameters.map((parameter: { name: string }) => parameter.name)).toEqual([
      "limit",
      "cursor",
      "queue_name",
      "job_name",
      "error",
      "created_from",
      "created_to",
      "status"
    ]);
    expect(spec.paths["/admin/monitors/{id}/checks"].get.parameters.map((parameter: { name: string }) => parameter.name)).toEqual([
      "id",
      "project_id",
      "environment_id",
      "limit",
      "cursor"
    ]);
    expect(
      spec.paths["/admin/monitors/{id}/checks"].get.parameters.filter((parameter: { required?: boolean }) => parameter.required)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", in: "path" }),
        expect.objectContaining({ name: "project_id", in: "query" }),
        expect.objectContaining({ name: "environment_id", in: "query" })
      ])
    );
    expect(spec.paths["/query/events"].get.security).toEqual([{ sessionCookie: [] }]);
    expect(spec.components.schemas.EventPayload.description).toContain("tenant");
    expect(spec.components.schemas.ErrorPayload.properties.stack.description).toContain("Source maps");
    expect(spec.components.schemas.DeadLetterJob.properties.payload.description).toContain("sanitized");
    expect(spec.components.schemas.DeadLetterJob.properties.projectId.type).toEqual(["string", "null"]);
    expect(spec.components.schemas.DeadLetterJob.properties.environmentId.type).toEqual(["string", "null"]);
    expect(spec.components.schemas.DeadLetterJobAction.properties.action.enum).toEqual(["deleted", "replayed", "expired"]);
    expect(spec.components.schemas.UserIdentifyPayload.description).toContain("last_seen_at");
    expect(spec.components.schemas.TenantIdentifyPayload.properties.traits.examples[0]).toMatchObject({
      name: "MicroERP",
      operation_mode: "production"
    });
  });

  it("redirects /docs to the Scalar docs page", async () => {
    const server = await createApp();

    const response = await server.inject({ method: "GET", url: "/docs" });

    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe("/docs/");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves public Scalar docs HTML", async () => {
    const server = await createApp();

    const response = await server.inject({ method: "GET", url: "/docs/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("SignalMonitor API Reference");
    expect(response.body).toContain("/openapi.json");
    expect(response.headers["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("redirects /sdk to the public SDK guide", async () => {
    const server = await createApp();

    const response = await server.inject({ method: "GET", url: "/sdk" });

    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe("/sdk/");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves public SDK documentation HTML", async () => {
    const server = await createApp();

    const response = await server.inject({ method: "GET", url: "/sdk/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("SignalMonitor SDK");
    expect(response.body).toContain("@sigmon/sdk");
    expect(response.body).toContain("NEXT_PUBLIC_SIGMON_BROWSER_KEY");
    expect(response.body).toContain("withSignalMonitorRoute");
    expect(response.body).toContain("identifyTenant");
    expect(response.body).toContain("Experiments and A/B tests");
    expect(response.body).toContain("checkout.exposed");
    expect(response.body).toContain("source-maps:upload");
    expect(response.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});
