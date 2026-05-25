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
    expect(spec.servers).toEqual([{ url: "https://my.sigmon.app", description: "Production" }]);
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
    expect(spec.paths["/query/events"].get.security).toEqual([{ sessionCookie: [] }]);
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
});
