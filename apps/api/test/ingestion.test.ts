import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
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
    expect(response.json()).toEqual({ error: "ingestion_unavailable" });
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
    expect(missingResponse.json()).toEqual({ error: "invalid_api_key" });
    expect(invalidResponse.statusCode).toBe(401);
    expect(invalidResponse.json()).toEqual({ error: "invalid_api_key" });
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
      details: expect.arrayContaining([
        expect.objectContaining({
          path: ["name"]
        })
      ])
    });
  });

  it.each([
    ["/v1/errors", "error", /^err_/, { message: "Unhandled exception" }],
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
