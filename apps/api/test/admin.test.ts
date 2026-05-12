import type { FastifyInstance } from "fastify";
import { access, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

const adminAuth = {
  login: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true }),
  findSessionUser: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true })
};

const userAuth = {
  login: async () => ({ id: "usr_2", email: "user@example.com", isAdmin: false }),
  findSessionUser: async () => ({ id: "usr_2", email: "user@example.com", isAdmin: false })
};

const readiness = async () => ({ postgres: true, redis: true });

function sourceMapArtifact(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "smap_1",
    projectId: "prj_1",
    environmentId: "env_1",
    release: "2026.05.10",
    minifiedFile: "app.min.js",
    originalFilename: "app.min.js.map",
    contentType: "application/json",
    byteSize: 72,
    sha256: "abc123",
    storagePath: "/tmp/source-maps/smap_1.map",
    uploadedByUserId: "usr_1",
    uploadedByTokenId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides
  };
}

function createMultipartPayload(
  parts: Array<
    | { name: string; value: string }
    | { name: string; filename: string; contentType: string; content: string | Buffer }
  >
): { headers: Record<string, string>; payload: Buffer } {
  const boundary = `signalhub-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];

  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if ("filename" in part) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.contentType}\r\n\r\n`
        )
      );
      chunks.push(Buffer.isBuffer(part.content) ? part.content : Buffer.from(part.content));
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`));
    }
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(chunks)
  };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.doUnmock("@signal-hub/db/repositories/source-maps.js");
  vi.resetModules();
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

  it("lists source map artifacts for admins", async () => {
    const listCalls: unknown[] = [];
    const artifact = sourceMapArtifact();

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        list: async (filters) => {
          listCalls.push(filters);
          return [artifact];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/source-maps?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ artifacts: [artifact] });
    expect(listCalls).toEqual([{ projectId: "prj_1", environmentId: "env_1" }]);
  });

  it("rejects source map uploads for non-admin users", async () => {
    const uploadCalls: unknown[] = [];
    const { headers, payload } = createMultipartPayload([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "2026.05.10" },
      { name: "minified_file", value: "app.min.js" },
      {
        name: "file",
        filename: "app.min.js.map",
        contentType: "application/json",
        content: JSON.stringify({ version: 3, file: "app.min.js", sources: [], names: [], mappings: "" })
      }
    ]);

    app = await buildApp({
      readiness,
      auth: userAuth,
      sourceMaps: {
        uploadMap: async (input) => {
          uploadCalls.push(input);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-maps",
      headers,
      payload
    });

    expect(response.statusCode).toBe(403);
    expect(uploadCalls).toEqual([]);
  });

  it("deletes source map artifacts for admins", async () => {
    const removeCalls: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        remove: async (input) => {
          removeCalls.push(input);
        }
      }
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/admin/source-maps/smap_1?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(204);
    expect(removeCalls).toEqual([{ id: "smap_1", projectId: "prj_1", environmentId: "env_1" }]);
  });

  it("uploads a single source map for admins", async () => {
    const uploadCalls: unknown[] = [];
    const uploadedArtifacts = [sourceMapArtifact()];
    const sourceMap = JSON.stringify({ version: 3, file: "app.min.js", sources: [], names: [], mappings: "" });
    const { headers, payload } = createMultipartPayload([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "2026.05.10" },
      { name: "minified_file", value: "app.min.js" },
      { name: "file", filename: "app.min.js.map", contentType: "application/json", content: sourceMap }
    ]);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        uploadMap: async (input) => {
          uploadCalls.push(input);
          return uploadedArtifacts;
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-maps",
      headers,
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ artifacts: uploadedArtifacts });
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0]).toMatchObject({
      projectId: "prj_1",
      environmentId: "env_1",
      release: "2026.05.10",
      minifiedFile: "app.min.js",
      uploadedByUserId: "usr_1",
      originalFilename: "app.min.js.map",
      contentType: "application/json"
    });
    expect((uploadCalls[0] as { content: Buffer }).content).toEqual(Buffer.from(sourceMap));
  });

  it("returns 400 when source map upload content is invalid", async () => {
    const { headers, payload } = createMultipartPayload([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "2026.05.10" },
      { name: "minified_file", value: "app.min.js" },
      { name: "file", filename: "app.min.js.map", contentType: "application/json", content: "not-json" }
    ]);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        uploadMap: async () => {
          throw new Error("invalid_source_map");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-maps",
      headers,
      payload
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_source_map_request" });
  });

  it("rejects uploads with multiple file parts without calling source map upload", async () => {
    const uploadCalls: unknown[] = [];
    const sourceMap = JSON.stringify({ version: 3, file: "app.min.js", sources: [], names: [], mappings: "" });
    const { headers, payload } = createMultipartPayload([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "2026.05.10" },
      { name: "minified_file", value: "app.min.js" },
      { name: "file", filename: "app.min.js.map", contentType: "application/json", content: sourceMap },
      { name: "bundle", filename: "source-maps.zip", contentType: "application/zip", content: Buffer.from("zip") }
    ]);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        uploadMap: async (input) => {
          uploadCalls.push(input);
          return [];
        },
        uploadBundle: async (input) => {
          uploadCalls.push(input);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-maps",
      headers,
      payload
    });

    expect([400, 413]).toContain(response.statusCode);
    expect(uploadCalls).toEqual([]);
  });

  it("rejects source map uploads with too many fields without calling upload", async () => {
    const uploadCalls: unknown[] = [];
    const sourceMap = JSON.stringify({ version: 3, file: "app.min.js", sources: [], names: [], mappings: "" });
    const { headers, payload } = createMultipartPayload([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "2026.05.10" },
      { name: "minified_file", value: "app.min.js" },
      { name: "extra", value: "client-controlled" },
      { name: "file", filename: "app.min.js.map", contentType: "application/json", content: sourceMap }
    ]);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        uploadMap: async (input) => {
          uploadCalls.push(input);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-maps",
      headers,
      payload
    });

    expect([400, 413]).toContain(response.statusCode);
    expect(uploadCalls).toEqual([]);
  });

  it("uploads a source map bundle for admins", async () => {
    const uploadCalls: unknown[] = [];
    const uploadedArtifacts = [sourceMapArtifact()];
    const bundle = Buffer.from("zip-content");
    const { headers, payload } = createMultipartPayload([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "2026.05.10" },
      { name: "bundle", filename: "source-maps.zip", contentType: "application/zip", content: bundle }
    ]);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        uploadBundle: async (input) => {
          uploadCalls.push(input);
          return uploadedArtifacts;
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-maps",
      headers,
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ artifacts: uploadedArtifacts });
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0]).toMatchObject({
      projectId: "prj_1",
      environmentId: "env_1",
      release: "2026.05.10",
      uploadedByUserId: "usr_1",
      originalFilename: "source-maps.zip",
      contentType: "application/zip"
    });
    expect((uploadCalls[0] as { content: Buffer }).content).toEqual(bundle);
  });

  it("cleans up bundle files when artifact creation fails after a partial bundle upload", async () => {
    vi.resetModules();

    const createdArtifactInputs: Array<{ storagePath: string }> = [];
    const createSourceMapArtifact = vi.fn(async (_db, input: { storagePath: string }) => {
      createdArtifactInputs.push(input);
      if (createdArtifactInputs.length === 2) {
        throw new Error("db_down");
      }

      return sourceMapArtifact({ storagePath: input.storagePath });
    });

    vi.doMock("@signal-hub/db/repositories/source-maps.js", () => ({
      createSourceMapArtifact,
      deleteSourceMapArtifact: vi.fn(),
      getSourceMapArtifact: vi.fn()
    }));

    const { uploadSourceMapBundle } = await import("../src/source-maps/storage.js");
    const localDir = await mkdtemp(path.join(tmpdir(), "signalhub-source-maps-"));
    const db = {
      transaction: () => ({
        execute: async <T>(callback: (trx: unknown) => Promise<T>) => callback({})
      })
    };
    const firstMap = Buffer.from(
      JSON.stringify({ version: 3, file: "app-one.min.js", sources: [], names: [], mappings: "" })
    );
    const secondMap = Buffer.from(
      JSON.stringify({ version: 3, file: "app-two.min.js", sources: [], names: [], mappings: "" })
    );

    try {
      await expect(
        uploadSourceMapBundle({
          db: db as never,
          localDir,
          input: {
            projectId: "prj_1",
            environmentId: "env_1",
            release: "2026.05.10",
            uploadedByUserId: "usr_1",
            originalFilename: "source-maps.zip",
            contentType: "application/zip",
            content: Buffer.from(
              zipSync({
                "app-one.min.js.map": firstMap,
                "app-two.min.js.map": secondMap
              })
            )
          }
        })
      ).rejects.toThrow("db_down");

      expect(createSourceMapArtifact).toHaveBeenCalledTimes(2);
      expect(createdArtifactInputs).toHaveLength(2);
      await Promise.all(
        createdArtifactInputs.map((input) => expect(access(input.storagePath)).rejects.toThrow())
      );
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it("passes token attribution to source map artifact creation", async () => {
    vi.resetModules();

    const createdArtifactInputs: Array<Record<string, unknown>> = [];
    const createSourceMapArtifact = vi.fn(async (_db, input: Record<string, unknown>) => {
      createdArtifactInputs.push(input);
      return sourceMapArtifact({
        storagePath: input.storagePath,
        uploadedByUserId: input.uploadedByUserId ?? null,
        uploadedByTokenId: input.uploadedByTokenId ?? null
      });
    });

    vi.doMock("@signal-hub/db/repositories/source-maps.js", () => ({
      createSourceMapArtifact,
      deleteSourceMapArtifact: vi.fn(),
      getSourceMapArtifact: vi.fn()
    }));

    const { uploadSingleSourceMap, uploadSourceMapBundle } = await import("../src/source-maps/storage.js");
    const localDir = await mkdtemp(path.join(tmpdir(), "signalhub-source-maps-"));
    const db = {
      transaction: () => ({
        execute: async <T>(callback: (trx: unknown) => Promise<T>) => callback({})
      })
    };
    const singleMap = Buffer.from(
      JSON.stringify({ version: 3, file: "app.min.js", sources: [], names: [], mappings: "" })
    );
    const bundledMap = Buffer.from(
      JSON.stringify({ version: 3, file: "bundle.min.js", sources: [], names: [], mappings: "" })
    );

    try {
      await uploadSingleSourceMap({
        db: db as never,
        localDir,
        input: {
          projectId: "prj_1",
          environmentId: "env_1",
          release: "2026.05.10",
          minifiedFile: "app.min.js",
          uploadedByTokenId: "smtok_1",
          originalFilename: "app.min.js.map",
          contentType: "application/json",
          content: singleMap
        }
      });

      await uploadSourceMapBundle({
        db: db as never,
        localDir,
        input: {
          projectId: "prj_1",
          environmentId: "env_1",
          release: "2026.05.10",
          uploadedByTokenId: "smtok_1",
          originalFilename: "source-maps.zip",
          contentType: "application/zip",
          content: Buffer.from(zipSync({ "bundle.min.js.map": bundledMap }))
        }
      });

      expect(createSourceMapArtifact).toHaveBeenCalledTimes(2);
      expect(createdArtifactInputs).toHaveLength(2);
      expect(createdArtifactInputs[0]).toMatchObject({
        minifiedFile: "app.min.js",
        uploadedByTokenId: "smtok_1"
      });
      expect(createdArtifactInputs[0]).not.toHaveProperty("uploadedByUserId");
      expect(createdArtifactInputs[1]).toMatchObject({
        minifiedFile: "bundle.min.js",
        uploadedByTokenId: "smtok_1"
      });
      expect(createdArtifactInputs[1]).not.toHaveProperty("uploadedByUserId");
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });
});
