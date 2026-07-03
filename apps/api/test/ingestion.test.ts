import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

type EnqueuedJob = {
  kind: string;
  id: string;
  projectId: string;
  environmentId: string;
  payload: Record<string, unknown>;
};

const readiness = async () => ({ postgres: true, redis: true });

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("ingestion routes", () => {
  it("returns 429 when ingestion requests exceed the configured rate limit", async () => {
    app = await buildApp({
      readiness,
      rateLimit: { max: 1, timeWindow: "1 minute" },
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async () => undefined
      }
    });

    const request = {
      method: "POST" as const,
      url: "/v1/events",
      headers: { authorization: "Bearer sh_valid" },
      payload: { name: "audit.rate_limit" }
    };

    expect((await app.inject(request)).statusCode).toBe(202);

    const response = await app.inject(request);

    expect(response.statusCode).toBe(429);
    expect(response.headers["x-ratelimit-limit"]).toBe("1");
    expect(response.headers["x-ratelimit-remaining"]).toBe("0");
    expect(Number(response.headers["x-ratelimit-reset"])).toBeGreaterThan(0);
  });

  it("allows browser preflight requests for configured browser ingestion origins", async () => {
    app = await buildApp({
      readiness,
      browserCorsOrigins: ["https://app.controledaempresa.com"],
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async () => undefined
      }
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/web-vitals",
      headers: {
        origin: "https://app.controledaempresa.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://app.controledaempresa.com");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-headers"]).toContain("Authorization");
    expect(response.headers.vary).toContain("Origin");
  });

  it("allows browser preflight requests for survey response ingestion", async () => {
    app = await buildApp({
      readiness,
      browserCorsOrigins: ["https://app.controledaempresa.com"],
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async () => undefined
      }
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/surveys/responses",
      headers: {
        origin: "https://app.controledaempresa.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://app.controledaempresa.com");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-headers"]).toContain("Authorization");
    expect(response.headers.vary).toContain("Origin");
  });

  it("allows browser preflight requests for feedback ingestion", async () => {
    app = await buildApp({
      readiness,
      browserCorsOrigins: ["https://app.controledaempresa.com"],
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async () => undefined
      }
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/feedback",
      headers: {
        origin: "https://app.controledaempresa.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://app.controledaempresa.com");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-headers"]).toContain("Authorization");
    expect(response.headers.vary).toContain("Origin");
  });

  it("allows browser preflight requests for persisted project origins", async () => {
    const isBrowserCorsOriginAllowed = vi.fn().mockResolvedValue(true);

    app = await buildApp({
      readiness,
      isBrowserCorsOriginAllowed,
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async () => undefined
      }
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/errors",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type"
      }
    });

    expect(isBrowserCorsOriginAllowed).toHaveBeenCalledWith("https://app.example.com");
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://app.example.com");
  });

  it("adds CORS headers to browser ingestion responses for configured origins", async () => {
    app = await buildApp({
      readiness,
      browserCorsOrigins: ["https://app.controledaempresa.com"],
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async () => undefined
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/errors",
      headers: {
        authorization: "Bearer sh_valid",
        origin: "https://app.controledaempresa.com"
      },
      payload: { message: "Browser boom" }
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers["access-control-allow-origin"]).toBe("https://app.controledaempresa.com");
    expect(response.headers.vary).toContain("Origin");
  });

  it("does not allow browser ingestion CORS for unconfigured origins", async () => {
    app = await buildApp({
      readiness,
      browserCorsOrigins: ["https://app.controledaempresa.com"],
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async () => undefined
      }
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/errors",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type"
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("accepts a valid event payload and enqueues it", async () => {
    const enqueued: EnqueuedJob[] = [];

    app = await buildApp({
      readiness,
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async (job) => {
          enqueued.push(job);
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: "Bearer sh_valid" },
      payload: {
        name: "account.created",
        properties: { plan: "pro" }
      }
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toMatchObject({ accepted: true });
    expect(body.id).toMatch(/^evt_/);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      kind: "event",
      id: body.id,
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        name: "account.created",
        properties: { plan: "pro" }
      }
    });
  });

  it("accepts a valid survey response payload and enqueues it", async () => {
    const enqueued: EnqueuedJob[] = [];

    app = await buildApp({
      readiness,
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async (job) => {
          enqueued.push(job);
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/surveys/responses",
      headers: { authorization: "Bearer sh_valid" },
      payload: {
        survey_id: "surv_1",
        actor_type: "user",
        actor_id: "user_1",
        tenant_id: "tenant_1",
        answers: { satisfaction: 5, comment: "Great" }
      }
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toMatchObject({ accepted: true });
    expect(body.id).toMatch(/^srs_/);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      kind: "survey_response",
      id: body.id,
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        survey_id: "surv_1",
        actor_type: "user",
        actor_id: "user_1",
        tenant_id: "tenant_1",
        answers: { satisfaction: 5, comment: "Great" }
      }
    });
  });

  it("accepts a valid feedback payload and enqueues it", async () => {
    const enqueued: EnqueuedJob[] = [];

    app = await buildApp({
      readiness,
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async (job) => {
          enqueued.push(job);
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { authorization: "Bearer sh_valid" },
      payload: {
        message: "Export wording is unclear",
        category: "ux",
        tenant_id: "tenant_1",
        user_id: "user_1",
        page_url: "https://app.example.com/reports",
        path: "/reports",
        metadata: { surface: "reports" }
      }
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toMatchObject({ accepted: true });
    expect(body.id).toMatch(/^fbk_/);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      kind: "feedback",
      id: body.id,
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        message: "Export wording is unclear",
        category: "ux",
        tenant_id: "tenant_1",
        user_id: "user_1",
        page_url: "https://app.example.com/reports",
        path: "/reports",
        metadata: { surface: "reports" }
      }
    });
  });

  it("accepts a valid runtime profile payload and enqueues it", async () => {
    const enqueued: EnqueuedJob[] = [];

    app = await buildApp({
      readiness,
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async (job) => {
          enqueued.push(job);
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      headers: { authorization: "Bearer sh_valid" },
      payload: {
        name: "worker.tick",
        kind: "memory",
        runtime: "node",
        started_at: "2026-05-11T12:00:00.000Z",
        heap_used_bytes: 1024
      }
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.id).toMatch(/^prf_/);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      kind: "profile",
      id: body.id,
      payload: {
        name: "worker.tick",
        kind: "memory",
        heap_used_bytes: 1024
      }
    });
  });

  it("accepts a valid session replay payload and enqueues it", async () => {
    const enqueued: EnqueuedJob[] = [];

    app = await buildApp({
      readiness,
      browserCorsOrigins: ["https://app.example.com"],
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async (job) => {
          enqueued.push(job);
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/replays",
      headers: {
        authorization: "Bearer sh_valid",
        origin: "https://app.example.com"
      },
      payload: {
        replay_id: "rpl_1",
        started_at: "2026-05-11T12:00:00.000Z",
        route: "/checkout",
        error_id: "err_1",
        events: [{ offset_ms: 100, type: "click", selector: '[data-sigmon-id="pay"]' }]
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    const body = response.json();
    expect(body.id).toMatch(/^rpl_/);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      kind: "replay",
      id: body.id,
      payload: {
        replay_id: "rpl_1",
        route: "/checkout",
        masked: true
      }
    });
  });

  it("returns 503 when enqueue fails", async () => {
    app = await buildApp({
      readiness,
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async () => {
          throw new Error("queue down");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: "Bearer sh_valid" },
      payload: { name: "account.created" }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "ingestion_unavailable",
      hint: "Sigmon accepted the request path but could not enqueue telemetry. Check Redis connectivity and worker/scheduler health."
    });
  });

  it("returns 401 when the bearer token is missing or invalid", async () => {
    let verifyCalls = 0;

    app = await buildApp({
      readiness,
      ingestion: {
        verifyApiKey: async () => {
          verifyCalls += 1;
          return null;
        },
        enqueue: async () => undefined
      }
    });

    const missingResponse = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: { name: "account.created" }
    });

    const invalidResponse = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: "Bearer sh_invalid" },
      payload: { name: "account.created" }
    });

    expect(missingResponse.statusCode).toBe(401);
    expect(missingResponse.json()).toEqual({
      error: "invalid_api_key",
      hint: "Send a project/environment ingestion key as Authorization: Bearer <key>. Browser calls must use a browser-scoped key for the same environment."
    });
    expect(invalidResponse.statusCode).toBe(401);
    expect(invalidResponse.json()).toEqual({
      error: "invalid_api_key",
      hint: "Send a project/environment ingestion key as Authorization: Bearer <key>. Browser calls must use a browser-scoped key for the same environment."
    });
    expect(verifyCalls).toBe(1);
  });

  it("returns 400 with validation details for an invalid payload", async () => {
    app = await buildApp({
      readiness,
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async () => undefined
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: "Bearer sh_valid" },
      payload: { properties: { plan: "pro" } }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "invalid_ingestion_payload",
      hint: "Check the endpoint payload shape in /docs or /openapi.json. SDK payloads are generated for the correct schema automatically.",
      details: expect.arrayContaining([
        expect.objectContaining({
          path: ["name"]
        })
      ])
    });
  });

  it("accepts breadcrumb ingestion", async () => {
    const enqueue = vi.fn(async () => undefined);

    app = await buildApp({
      readiness,
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/breadcrumbs",
      headers: { authorization: "Bearer sh_test" },
      payload: {
        session_id: "sess_1",
        type: "custom",
        category: "checkout",
        message: "Selected shipping method",
        level: "info",
        data: { method: "standard" }
      }
    });

    expect(response.statusCode).toBe(202);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "breadcrumb",
        projectId: "prj_1",
        environmentId: "env_1",
        payload: expect.objectContaining({ type: "custom", message: "Selected shipping method" })
      })
    );
  });

  it.each([
    ["/v1/errors", "error", /^err_/, { message: "Unhandled exception" }],
    [
      "/v1/clicks",
      "click",
      /^clk_/,
      {
        route: "/checkout",
        selector: '[data-sigmon-id="submit"]',
        x: 0.5,
        y: 0.4,
        viewport_width: 1280,
        viewport_height: 720
      }
    ],
    ["/v1/llm", "llm", /^llm_/, { provider: "openai", model: "gpt-5" }],
    [
      "/v1/traces",
      "trace",
      /^trc_/,
      { name: "checkout", started_at: "2026-01-01T00:00:00.000Z" }
    ],
    [
      "/v1/spans",
      "span",
      /^spn_/,
      { trace_id: "trc_parent", name: "db.query", started_at: "2026-01-01T00:00:00.000Z" }
    ]
  ])("accepts %s payloads", async (url, kind, idPattern, payload) => {
    const enqueued: EnqueuedJob[] = [];

    app = await buildApp({
      readiness,
      ingestion: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1" }),
        enqueue: async (job) => {
          enqueued.push(job);
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url,
      headers: { authorization: "Bearer sh_valid" },
      payload
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.id).toMatch(idPattern);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      kind,
      id: body.id,
      projectId: "prj_1",
      environmentId: "env_1",
      payload
    });
  });
});
