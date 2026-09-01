import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

const readiness = async () => ({ postgres: true, redis: true });

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("identify routes", () => {
  it("forbids a valid browser key from mutating a user profile", async () => {
    const identifyUser = vi.fn(async () => undefined);

    app = await buildApp({
      readiness,
      identify: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1", capability: "browser" }),
        identifyUser,
        identifyTenant: async () => undefined
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/identify/user",
      headers: { authorization: "Bearer sh_valid" },
      payload: { user_id: "usr_ana", traits: { name: "Ana" } }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "api_key_capability_forbidden" });
    expect(identifyUser).not.toHaveBeenCalled();
  });

  it("forbids a valid browser key from mutating a tenant profile", async () => {
    const identifyTenant = vi.fn(async () => undefined);

    app = await buildApp({
      readiness,
      identify: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1", capability: "browser" }),
        identifyUser: async () => undefined,
        identifyTenant
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/identify/tenant",
      headers: { authorization: "Bearer sh_valid" },
      payload: { tenant_id: "tenant_acme", traits: { plan: "pro" } }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "api_key_capability_forbidden" });
    expect(identifyTenant).not.toHaveBeenCalled();
  });

  it("accepts a user identify payload and writes it within the API key scope", async () => {
    const identifyUser = vi.fn(async () => undefined);

    app = await buildApp({
      readiness,
      identify: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1", capability: "server" }),
        identifyUser,
        identifyTenant: async () => undefined
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/identify/user",
      headers: { authorization: "Bearer sh_valid" },
      payload: {
        user_id: "usr_ana",
        tenant_id: "tenant_acme",
        traits: { name: "Ana", plan: "pro" },
        timestamp: "2026-05-25T10:00:00.000Z",
        metadata: { source: "sdk" }
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true });
    expect(identifyUser).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      userId: "usr_ana",
      tenantId: "tenant_acme",
      traits: { name: "Ana", plan: "pro" },
      timestamp: new Date("2026-05-25T10:00:00.000Z")
    });
  });

  it("accepts a tenant identify payload and writes it within the API key scope", async () => {
    const identifyTenant = vi.fn(async () => undefined);

    app = await buildApp({
      readiness,
      identify: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1", capability: "server" }),
        identifyUser: async () => undefined,
        identifyTenant
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/identify/tenant",
      headers: { authorization: "Bearer sh_valid" },
      payload: {
        tenant_id: "tenant_acme",
        traits: { plan: "enterprise" },
        timestamp: "2026-05-25T10:01:00.000Z"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true });
    expect(identifyTenant).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      tenantId: "tenant_acme",
      traits: { plan: "enterprise" },
      timestamp: new Date("2026-05-25T10:01:00.000Z")
    });
  });

  it("returns 401 when the bearer token is missing or invalid", async () => {
    let verifyCalls = 0;
    const identifyUser = vi.fn(async () => undefined);

    app = await buildApp({
      readiness,
      identify: {
        verifyApiKey: async () => {
          verifyCalls += 1;
          return null;
        },
        identifyUser,
        identifyTenant: async () => undefined
      }
    });

    const missingResponse = await app.inject({
      method: "POST",
      url: "/v1/identify/user",
      payload: { user_id: "usr_ana", traits: {} }
    });

    const invalidResponse = await app.inject({
      method: "POST",
      url: "/v1/identify/user",
      headers: { authorization: "Bearer sh_invalid" },
      payload: { user_id: "usr_ana", traits: {} }
    });

    expect(missingResponse.statusCode).toBe(401);
    expect(missingResponse.json()).toEqual({ error: "invalid_api_key" });
    expect(invalidResponse.statusCode).toBe(401);
    expect(invalidResponse.json()).toEqual({ error: "invalid_api_key" });
    expect(verifyCalls).toBe(1);
    expect(identifyUser).not.toHaveBeenCalled();
  });

  it("returns 400 with validation details for an invalid payload", async () => {
    app = await buildApp({
      readiness,
      identify: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1", capability: "server" }),
        identifyUser: async () => undefined,
        identifyTenant: async () => undefined
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/identify/user",
      headers: { authorization: "Bearer sh_valid" },
      payload: { traits: { name: "Ana" } }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "invalid_identify_payload",
      details: expect.arrayContaining([
        expect.objectContaining({
          path: ["user_id"]
        })
      ])
    });
  });

  it("returns 503 when an identify dependency fails", async () => {
    app = await buildApp({
      readiness,
      identify: {
        verifyApiKey: async () => ({ projectId: "prj_1", environmentId: "env_1", capability: "server" }),
        identifyUser: async () => {
          throw new Error("database down");
        },
        identifyTenant: async () => undefined
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/identify/user",
      headers: { authorization: "Bearer sh_valid" },
      payload: { user_id: "usr_ana", traits: {} }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "ingestion_unavailable" });
  });
});
