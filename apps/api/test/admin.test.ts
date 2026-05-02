import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

const adminAuth = {
  login: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true }),
  findSessionUser: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true })
};

const readiness = async () => ({ postgres: true, redis: true });

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("admin routes", () => {
  it("returns 401 for unauthenticated users on GET /admin/users", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: {
        login: async () => null,
        findSessionUser: async () => null
      },
      users: {
        listUsers: async () => []
      }
    });

    const response = await app.inject({ method: "GET", url: "/admin/users" });

    expect(response.statusCode).toBe(401);
  });

  it("returns 403 for regular users on GET /admin/users", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: {
        login: async () => ({ id: "usr_2", email: "user@example.com", isAdmin: false }),
        findSessionUser: async () => ({ id: "usr_2", email: "user@example.com", isAdmin: false })
      },
      users: {
        listUsers: async () => []
      }
    });

    const response = await app.inject({ method: "GET", url: "/admin/users" });

    expect(response.statusCode).toBe(403);
  });

  it("rejects weak admin-created passwords", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      users: {
        createUser: async () => ({ id: "usr_2", email: "user@example.com", isAdmin: false })
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/users",
      payload: { email: "user@example.com", password: "x", isAdmin: false }
    });

    expect(response.statusCode).toBe(400);
  });

  it("creates a project", async () => {
    const createdProjects: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        projects: {
          list: async () => [],
          get: async () => null,
          create: async (input) => {
            createdProjects.push(input);
            return {
              id: "prj_1",
              name: input.name,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-01T00:00:00.000Z"),
              archivedAt: null
            };
          },
          update: async () => null,
          archive: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/projects",
      payload: { name: "SignalHub" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().project).toMatchObject({ id: "prj_1", name: "SignalHub" });
    expect(createdProjects).toEqual([{ name: "SignalHub" }]);
  });

  it("creates an environment for a project", async () => {
    const createdEnvironments: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        environments: {
          list: async () => [],
          create: async (input) => {
            createdEnvironments.push(input);
            return {
              id: "env_1",
              projectId: input.projectId,
              name: input.name,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-01T00:00:00.000Z"),
              archivedAt: null
            };
          },
          update: async () => null,
          archive: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_1/environments",
      payload: { name: "Production" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().environment).toMatchObject({
      id: "env_1",
      projectId: "prj_1",
      name: "Production"
    });
    expect(createdEnvironments).toEqual([{ projectId: "prj_1", name: "Production" }]);
  });

  it("returns 404 when environment creation targets an inactive project scope", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        environments: {
          list: async () => [],
          create: async () => {
            throw new Error("active_project_not_found");
          },
          update: async () => null,
          archive: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_archived/environments",
      payload: { name: "Production" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "project_not_found" });
  });

  it("returns a one-time API key secret and stores only prefix and hash", async () => {
    const storedApiKeys: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: adminAuth,
      apiKeyPepper: "test-pepper",
      adminResources: {
        apiKeys: {
          list: async () => [],
          create: async (input) => {
            storedApiKeys.push(input);
            return {
              id: "key_1",
              projectId: input.projectId,
              environmentId: input.environmentId,
              name: input.name,
              prefix: input.prefix,
              hash: input.hash,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              revokedAt: null
            };
          },
          revoke: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_1/api-keys",
      payload: { environmentId: "env_1", name: "Production ingest" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().apiKey.secret).toMatch(/^sh_/);
    expect(response.json().apiKey.prefix).toBe(response.json().apiKey.secret.slice(0, 12));
    expect(storedApiKeys).toHaveLength(1);
    expect(storedApiKeys[0]).toMatchObject({
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Production ingest",
      prefix: response.json().apiKey.prefix
    });
    expect(storedApiKeys[0]).not.toHaveProperty("secret");
    expect(storedApiKeys[0]).toHaveProperty("hash");
    expect(response.json().apiKey.hash).toBeUndefined();
  });

  it("returns 404 when API key creation targets an inactive project or environment scope", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      apiKeyPepper: "test-pepper",
      adminResources: {
        apiKeys: {
          list: async () => [],
          create: async () => {
            throw new Error("active_api_key_scope_not_found");
          },
          revoke: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_archived/api-keys",
      payload: { environmentId: "env_archived", name: "Production ingest" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "api_key_scope_not_found" });
  });

  it("soft archives a project", async () => {
    const archivedProjectIds: string[] = [];

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        projects: {
          list: async () => [],
          get: async () => null,
          create: async () => {
            throw new Error("not used");
          },
          update: async () => null,
          archive: async (id) => {
            archivedProjectIds.push(id);
          }
        }
      }
    });

    const response = await app.inject({ method: "DELETE", url: "/admin/projects/prj_1" });

    expect(response.statusCode).toBe(204);
    expect(archivedProjectIds).toEqual(["prj_1"]);
  });

  it("revokes an API key", async () => {
    const revokedApiKeyIds: string[] = [];

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        apiKeys: {
          list: async () => [],
          create: async () => {
            throw new Error("not used");
          },
          revoke: async (id) => {
            revokedApiKeyIds.push(id);
          }
        }
      }
    });

    const response = await app.inject({ method: "DELETE", url: "/admin/api-keys/key_1" });

    expect(response.statusCode).toBe(204);
    expect(revokedApiKeyIds).toEqual(["key_1"]);
  });
});
