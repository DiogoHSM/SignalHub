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
        "/v1/clicks",
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
        "/admin/message-campaigns",
        "/admin/message-campaigns/{id}",
        "/admin/dead-letter-jobs",
        "/admin/dead-letter-jobs/{id}",
        "/admin/dead-letter-jobs/{id}/actions",
        "/admin/dead-letter-jobs/{id}/replay",
        "/query/events",
        "/query/fleet",
        "/query/fleet/projects/{id}/environments",
        "/query/error-groups/{id}/errors",
        "/query/aggregates/traces",
        "/query/events/click-map",
        "/query/message-campaigns/{id}/results",
        "/query/replays",
        "/query/aggregates/errors",
        "/query/aggregates/events",
        "/query/aggregates/llm",
        "/query/entities/tenants",
        "/query/entities/tenants/{tenantKey}",
        "/query/error-groups",
        "/query/errors/{id}/source-map-resolution",
        "/query/events/paths",
        "/query/incidents/error-groups/{id}",
        "/query/incidents/error-groups/{id}/notes",
        "/query/incidents/error-groups/{id}/silence",
        "/query/incidents/mttr",
        "/query/llm/by-prompt",
        "/query/llm/by-tenant",
        "/query/llm/cost-by-model",
        "/query/llm/summary",
        "/query/operations",
        "/query/sessions/{sessionId}/timeline",
        "/query/traces/{id}/spans",
        "/query/users",
        "/query/users/{userKey}",
        "/system/health",
        "/alerts/events",
        "/alerts/events/{id}",
        "/alerts/suggestions",
        "/alerts/events/{id}/triage",
        "/auth/google",
        "/auth/google/callback",
        "/auth/logout",
        "/system/health/history"
      ])
    );
    expect(spec.components.securitySchemes).toMatchObject({
      ingestionApiKey: { type: "http", scheme: "bearer" },
      heartbeatSecret: { type: "http", scheme: "bearer" },
      sourceMapUploadToken: { type: "http", scheme: "bearer" },
      sessionCookie: { type: "apiKey", in: "cookie", name: "__Host-sigmon_session" }
    });
    expect(spec.paths["/v1/events"].post.security).toEqual([{ ingestionApiKey: [] }]);
    expect(spec.paths["/v1/clicks"].post.security).toEqual([{ ingestionApiKey: [] }]);
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
    expect(spec.paths["/query/events"].get.security).toEqual([{ sessionCookie: [] }, { readToken: [] }]);
    expect(spec.paths["/query/feedback/{id}"].patch.security).toEqual([{ sessionCookie: [] }]);
    expect(spec.paths["/query/fleet"].get.security).toEqual([{ sessionCookie: [] }]);
    expect(spec.paths["/query/fleet/projects/{id}/environments"].get.parameters.map((parameter: { name: string }) => parameter.name)).toEqual([
      "id",
      "window"
    ]);
    expect(spec.paths["/query/error-groups/{id}/errors"].get.parameters.map((parameter: { name: string }) => parameter.name)).toEqual([
      "id",
      "project_id",
      "environment_id",
      "limit",
      "cursor"
    ]);
    expect(spec.paths["/query/error-groups/{id}/errors"].get.responses["200"].content["application/json"].schema).toMatchObject({
      required: ["data"],
      properties: { cursor: { type: ["string", "null"] } }
    });
    expect(spec.paths["/query/aggregates/traces"].get.description).toContain("trace duration");
    expect(spec.paths["/query/users"].get.parameters.map((parameter: { name: string }) => parameter.name)).toEqual([
      "project_id",
      "environment_id",
      "window",
      "search",
      "tenant_id",
      "limit",
      "sort",
      "cursor"
    ]);
    expect(spec.paths["/query/users"].get.parameters.find((parameter: { name: string }) => parameter.name === "sort").schema.enum).toEqual([
      "impact",
      "usage",
      "errors",
      "llm_cost",
      "recent"
    ]);
    expect(
      spec.paths["/query/users"].get.parameters.filter((parameter: { required?: boolean }) => parameter.required)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "project_id", in: "query" }),
        expect.objectContaining({ name: "environment_id", in: "query" })
      ])
    );
    expect(spec.paths["/query/entities/tenants"].get.parameters.map((parameter: { name: string }) => parameter.name)).toEqual([
      "project_id",
      "environment_id",
      "window",
      "search",
      "limit",
      "sort",
      "cursor"
    ]);
    expect(
      spec.paths["/query/entities/tenants"].get.parameters.find((parameter: { name: string }) => parameter.name === "sort").schema.enum
    ).toEqual(["impact", "usage", "errors", "llm_cost", "recent"]);
    expect(spec.paths["/query/error-groups/{id}"].patch.security).toEqual([{ sessionCookie: [] }]);
    expect(spec.paths["/query/error-groups/{id}"].patch.requestBody.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/ErrorGroupTriagePatch"
    });
    expect(spec.components.schemas.ErrorGroupTriagePatch.properties).toMatchObject({
      status: { enum: ["open", "investigating", "resolved", "ignored"] },
      priority: { enum: ["urgent", "high", "normal", "low", null] },
      assignedToUserId: expect.any(Object)
    });
    expect(spec.paths["/query/incidents/error-groups/{id}/notes"].post.requestBody.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/TriageNoteInput"
    });
    expect(spec.components.schemas.TriageNoteInput.required).toEqual(["body"]);
    expect(spec.paths["/query/incidents/error-groups/{id}/silence"].post.requestBody.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/SilenceIncidentInput"
    });
    expect(spec.components.schemas.SilenceIncidentInput.required).toEqual(["minutes"]);
    expect(spec.paths["/query/incidents/mttr"].get.parameters.find((parameter: { name: string }) => parameter.name === "window").schema.enum).toEqual([
      "7d",
      "30d"
    ]);
    expect(spec.paths["/query/traces/{id}/spans"].get.parameters.map((parameter: { name: string }) => parameter.name)).toEqual([
      "id",
      "project_id",
      "environment_id",
      "tenant_id",
      "user_id",
      "session_id",
      "trace_id",
      "from",
      "to",
      "limit",
      "cursor"
    ]);
    expect(spec.components.schemas.EventPayload.description).toContain("tenant");
    expect(spec.components.schemas.ErrorPayload.properties.severity.enum).toEqual([
      "debug",
      "info",
      "warning",
      "error",
      "critical",
      "fatal"
    ]);
    expect(spec.components.schemas.ErrorPayload.properties.stack.description).toContain("Source maps");
    expect(spec.components.schemas.BreadcrumbPayload.required).toEqual(["type", "message"]);
    expect(spec.components.schemas.ClickEventPayload.required).toEqual(["route", "selector", "x", "y", "viewport_width", "viewport_height"]);
    expect(spec.components.schemas.ClickEventPayload.description).toContain("privacy-safe");
    expect(spec.components.schemas.SessionReplayPayload).toMatchObject({
      properties: {
        events: {
          type: "array",
          maxItems: 300,
          description: expect.stringContaining("300 events"),
          items: {
            additionalProperties: false,
            properties: {
              type: {
                enum: ["navigation", "click", "input", "console", "network", "error", "custom"]
              },
              message: {
                description: expect.stringContaining("[REDACTED]")
              },
              data: {
                description: expect.stringContaining("5 container levels")
              }
            }
          }
        }
      }
    });
    expect(spec.components.schemas.SessionReplayPayload.description).toContain("64 KiB");
    expect(spec.components.schemas.SessionReplayPayload.properties.events.items.properties.data.description).toContain(
      "64 object keys"
    );
    expect(spec.components.schemas.BreadcrumbPayload.properties.type.enum).toEqual([
      "navigation",
      "click",
      "console",
      "network",
      "custom"
    ]);
    expect(spec.components.schemas.LlmPayload.properties.status.enum).toContain("pending");
    expect(spec.components.schemas.TracePayload.required).toEqual(["name", "started_at"]);
    expect(spec.components.schemas.SpanPayload.required).toEqual(["trace_id", "name", "started_at"]);
    expect(spec.paths["/v1/source-maps"].post.requestBody.content["multipart/form-data"].schema.anyOf).toEqual([
      { required: ["file", "minified_file"] },
      { required: ["bundle"] }
    ]);
    expect(spec.components.schemas.DeadLetterJob.properties.payload.description).toContain("sanitized");
    expect(spec.components.schemas.DeadLetterJob.properties.projectId.type).toEqual(["string", "null"]);
    expect(spec.components.schemas.DeadLetterJob.properties.environmentId.type).toEqual(["string", "null"]);
    expect(spec.components.schemas.DeadLetterJobAction.properties.action.enum).toEqual(["deleted", "replayed", "expired"]);
    expect(spec.components.schemas.UserIdentifyPayload.description).toContain("last_seen_at");
    expect(spec.components.schemas.UserIdentifyPayload.description).toContain("shallow-merge");
    expect(spec.components.schemas.TenantIdentifyPayload.description).toContain("shallow-merge");
    expect(spec.components.schemas.MessageCampaign.properties.channelType.enum).toEqual(["email", "webhook", "in_app"]);
    expect(spec.components.schemas.MessageCampaignResults.properties.totals.required).toEqual([
      "queued",
      "sent",
      "delivered",
      "opened",
      "clicked",
      "converted",
      "failed",
      "optedOut",
      "uniqueActors"
    ]);
    expect(spec.paths["/admin/message-campaigns"].post.description).toContain("opt-out");
    expect(spec.paths["/query/message-campaigns/{id}/results"].get.security).toEqual([{ sessionCookie: [] }, { readToken: [] }]);
    expect(spec.paths["/v1/identify/user"].post.description).toContain("shallow-merge");
    expect(spec.paths["/v1/identify/tenant"].post.description).toContain("shallow-merge");
    expect(spec.components.schemas.TenantIdentifyPayload.properties.traits.examples[0]).toMatchObject({
      name: "MicroERP",
      operation_mode: "production"
    });
    const warehouseCreateDatasets =
      spec.paths["/admin/warehouse-destinations"].post.requestBody.content["application/json"].schema.properties.datasets;
    const warehouseUpdateDatasets =
      spec.paths["/admin/warehouse-destinations/{id}"].patch.requestBody.content["application/json"].schema.properties.datasets;
    for (const datasets of [warehouseCreateDatasets, warehouseUpdateDatasets]) {
      expect(datasets.description).toContain("actor-id-ordered cyclic snapshots");
      expect(datasets.description).toContain("cursor resets");
      expect(datasets.description).not.toContain("updated_at");
      expect(datasets.description).not.toContain("revision");
    }
  });

  it("documents the closed data governance retention categories", async () => {
    const server = await createApp();
    const response = await server.inject({ method: "GET", url: "/openapi.json" });
    const spec = response.json();
    const categories = [
      "events",
      "errors",
      "traces",
      "spans",
      "llmCalls",
      "profiles",
      "breadcrumbs",
      "webVitals",
      "clicks",
      "replays"
    ];
    const schemas = [
      spec.components.schemas.DataGovernancePolicy.properties.retentionPolicy,
      spec.paths["/admin/data-governance"].put.requestBody.content["application/json"].schema.properties.retentionPolicy
    ];

    for (const schema of schemas) {
      expect(Object.keys(schema.properties)).toEqual(categories);
      expect(schema.additionalProperties).toBe(false);
      expect(schema.description).toMatch(/omitted categories use.*installation defaults/i);
      for (const category of categories) {
        expect(schema.properties[category]).toEqual({ type: "integer", minimum: 1, maximum: 3650 });
      }
    }
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
    expect(response.body).toContain("shallow-merge");
    expect(response.body).toContain("Experiments, flags, surveys, and campaigns");
    expect(response.body).toContain("submitSurvey");
    expect(response.body).toContain("/admin/message-campaigns");
    expect(response.body).toContain("checkout.exposed");
    expect(response.body).toContain("source-maps:upload");
    expect(response.body).toContain("BROWSER_CORS_ORIGINS");
    expect(response.body).toContain("Production smoke tests");
    expect(response.body).toContain("SIGMON_UPLOAD_TIMEOUT_MS");
    expect(response.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});
