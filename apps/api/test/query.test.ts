import type { FastifyInstance } from "fastify";
import { zipSync } from "fflate";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import {
  extractSourceMapsFromZip,
  inferMinifiedFileFromMap,
  MAX_SOURCE_MAP_UPLOAD_BYTES,
  parseSourceMapJson,
  parseStackFrames
} from "../src/source-maps/parser.js";
import { resolveErrorStackWithSourceMaps, resolveFrameWithSourceMap } from "../src/source-maps/resolver.js";
import { readSourceMapFile, storeSourceMapFile } from "../src/source-maps/storage.js";

vi.mock("@sigmon/db/repositories/source-maps.js", () => ({
  createSourceMapArtifact: vi.fn(),
  deleteSourceMapArtifact: vi.fn(),
  getSourceMapArtifact: vi.fn()
}));

let app: FastifyInstance | undefined;

const humanAuth = {
  login: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false }),
  findSessionUser: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false })
};

const readiness = async () => ({ postgres: true, redis: true });

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("source map helpers", () => {
  it("parses browser stack frames for source map resolution", () => {
    expect(
      parseStackFrames(
        [
          "TypeError: failed",
          "    at checkout (https://cdn.example.com/assets/app.abc123.js:10:1234)",
          "    at https://cdn.example.com/assets/vendor.js:2:45",
          "render@https://cdn.example.com/assets/chunk.js:3:9"
        ].join("\n")
      )
    ).toEqual([
      {
        frameIndex: 0,
        functionName: "checkout",
        minifiedFile: "app.abc123.js",
        minifiedLine: 10,
        minifiedColumn: 1234
      },
      { frameIndex: 1, functionName: null, minifiedFile: "vendor.js", minifiedLine: 2, minifiedColumn: 45 },
      { frameIndex: 2, functionName: "render", minifiedFile: "chunk.js", minifiedLine: 3, minifiedColumn: 9 }
    ]);
  });

  it("infers minified file from a source map file property", () => {
    expect(inferMinifiedFileFromMap({ version: 3, file: "assets/app.abc123.js", sources: [], names: [], mappings: "" })).toBe(
      "app.abc123.js"
    );
  });

  it("rejects invalid and indexed source maps", () => {
    expect(() => parseSourceMapJson(JSON.stringify({ version: 2, sources: [], names: [], mappings: "" }))).toThrow(
      "invalid_source_map"
    );
    expect(() =>
      parseSourceMapJson(JSON.stringify({ version: 3, sections: [], sources: [], names: [], mappings: "" }))
    ).toThrow("indexed_source_maps_unsupported");
  });

  it("accepts null entries in source map sourcesContent", () => {
    expect(
      parseSourceMapJson(
        JSON.stringify({
          version: 3,
          sources: ["src/missing.ts", "src/app.ts"],
          sourcesContent: [null, "export const app = true;"],
          names: [],
          mappings: ""
        })
      ).sourcesContent
    ).toEqual([null, "export const app = true;"]);
  });

  it("extracts source maps from zip uploads", () => {
    const map = JSON.stringify({ version: 3, file: "assets/app.min.js", sources: [], names: [], mappings: "" });
    const zip = Buffer.from(
      zipSync({
        "assets/app.min.js.map": new TextEncoder().encode(map),
        "assets/ignored.txt": new TextEncoder().encode("ignored")
      })
    );

    expect(extractSourceMapsFromZip(zip)).toEqual([
      {
        originalFilename: "app.min.js.map",
        content: Buffer.from(map),
        minifiedFile: "app.min.js"
      }
    ]);
  });

  it("rejects zip uploads with more than 100 total entries", () => {
    const entries: Record<string, Uint8Array> = {};
    for (let index = 0; index < 101; index += 1) {
      entries[`ignored-${index}.txt`] = new TextEncoder().encode("ignored");
    }

    expect(() => extractSourceMapsFromZip(Buffer.from(zipSync(entries)))).toThrow("source_map_zip_too_many_entries");
  });

  it("extracts only source map entries from zip uploads with non-map entries", () => {
    const entries: Record<string, Uint8Array> = {
      "assets/app.min.js.map": new TextEncoder().encode(
        JSON.stringify({ version: 3, file: "assets/app.min.js", sources: [], names: [], mappings: "" })
      )
    };
    for (let index = 0; index < 50; index += 1) {
      entries[`assets/ignored-${index}.txt`] = new TextEncoder().encode("ignored");
    }

    expect(extractSourceMapsFromZip(Buffer.from(zipSync(entries))).map((entry) => entry.originalFilename)).toEqual([
      "app.min.js.map"
    ]);
  });

  it("rejects source map zip uploads above the compressed size limit", () => {
    expect(() => extractSourceMapsFromZip(Buffer.alloc(MAX_SOURCE_MAP_UPLOAD_BYTES + 1))).toThrow(
      "source_map_upload_too_large"
    );
  });

  it("infers minified file from the zip entry when source map file is missing", () => {
    const map = JSON.stringify({ version: 3, sources: [], names: [], mappings: "" });

    expect(
      extractSourceMapsFromZip(
        Buffer.from(
          zipSync({
            "assets/app.min.js.map": new TextEncoder().encode(map)
          })
        )
      )
    ).toEqual([
      {
        originalFilename: "app.min.js.map",
        content: Buffer.from(map),
        minifiedFile: "app.min.js"
      }
    ]);
  });

  it("keeps stored source maps inside local storage for traversal-like segments", async () => {
    const localDir = await mkdtemp(path.join(tmpdir(), "sigmon-source-maps-"));
    const escapedDirectory = path.join(path.dirname(localDir), ".._x");

    try {
      const artifact = await storeSourceMapFile({
        localDir,
        projectId: "..",
        environmentId: ".",
        release: "../x",
        artifactId: ".",
        content: Buffer.from("{}")
      });

      const relativePath = path.relative(await realpath(localDir), artifact.storagePath);
      expect(relativePath).not.toBe("");
      expect(relativePath).not.toBe("..");
      expect(relativePath.startsWith(`..${path.sep}`)).toBe(false);
      expect(path.isAbsolute(relativePath)).toBe(false);
    } finally {
      await rm(localDir, { recursive: true, force: true });
      await rm(escapedDirectory, { recursive: true, force: true });
    }
  });

  it("rejects source map reads outside local storage", async () => {
    const localDir = await mkdtemp(path.join(tmpdir(), "sigmon-source-maps-"));

    try {
      await expect(readSourceMapFile({ localDir, storagePath: path.join(path.dirname(localDir), "outside.map") })).rejects.toThrow(
        "source_map_storage_path_invalid"
      );
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it("rejects source map reads through symlinks inside local storage", async () => {
    const localDir = await mkdtemp(path.join(tmpdir(), "sigmon-source-maps-"));
    const outsideFile = path.join(path.dirname(localDir), "outside-source-map.map");
    const symlinkPath = path.join(localDir, "linked.map");

    try {
      await writeFile(outsideFile, "{}");
      await symlink(outsideFile, symlinkPath);

      await expect(readSourceMapFile({ localDir, storagePath: symlinkPath })).rejects.toThrow(
        "source_map_storage_path_invalid"
      );
    } finally {
      await rm(localDir, { recursive: true, force: true });
      await rm(outsideFile, { force: true });
    }
  });

  it("resolves a generated frame with a regular source map", () => {
    const map = {
      version: 3,
      file: "app.min.js",
      sources: ["src/app.ts"],
      names: ["checkout"],
      mappings: "IAyCIA"
    };

    expect(
      resolveFrameWithSourceMap(JSON.stringify(map), {
        frameIndex: 0,
        functionName: "checkout",
        minifiedFile: "app.min.js",
        minifiedLine: 1,
        minifiedColumn: 5
      })
    ).toEqual({
      frameIndex: 0,
      minifiedFile: "app.min.js",
      minifiedLine: 1,
      minifiedColumn: 5,
      originalSource: "src/app.ts",
      originalLine: 42,
      originalColumn: 4,
      originalName: "checkout"
    });
  });

  it("resolves browser stack columns as one-based generated columns", () => {
    const map = {
      version: 3,
      file: "app.min.js",
      sources: ["src/first.ts", "src/second.ts"],
      names: ["first", "second"],
      mappings: "AAAAA,CCAAC"
    };

    expect(
      resolveFrameWithSourceMap(JSON.stringify(map), {
        frameIndex: 0,
        functionName: null,
        minifiedFile: "app.min.js",
        minifiedLine: 1,
        minifiedColumn: 1
      })
    ).toEqual({
      frameIndex: 0,
      minifiedFile: "app.min.js",
      minifiedLine: 1,
      minifiedColumn: 1,
      originalSource: "src/first.ts",
      originalLine: 1,
      originalColumn: 0,
      originalName: "first"
    });
  });

  it("does not cache partially resolved error stacks", async () => {
    const map = JSON.stringify({
      version: 3,
      file: "app.min.js",
      sources: ["src/app.ts"],
      names: ["checkout"],
      mappings: "AAAAA"
    });
    const replaceErrorStackResolutions = vi.fn(async (input) => input.frames);

    const resolution = await resolveErrorStackWithSourceMaps({
      errorId: "err_1",
      projectId: "prj_1",
      environmentId: "env_1",
      getErrorForSourceMapResolution: async () => ({
        id: "err_1",
        projectId: "prj_1",
        environmentId: "env_1",
        release: "2026.05.11",
        stack: [
          "TypeError: failed",
          "    at checkout (https://cdn.example.com/assets/app.min.js:1:1)",
          "    at vendor (https://cdn.example.com/assets/vendor.min.js:1:1)"
        ].join("\n")
      }),
      getCachedErrorStackResolution: async () => [],
      findSourceMapArtifactForFrame: async (input) =>
        input.minifiedFile === "app.min.js" ? { id: "smap_1", storagePath: "/source-maps/app.min.js.map" } : null,
      readSourceMapFile: async () => map,
      replaceErrorStackResolutions
    });

    expect(resolution).toEqual({
      errorId: "err_1",
      release: "2026.05.11",
      status: "partially_resolved",
      frames: [
        {
          sourceMapArtifactId: "smap_1",
          frameIndex: 0,
          minifiedFile: "app.min.js",
          minifiedLine: 1,
          minifiedColumn: 1,
          originalSource: "src/app.ts",
          originalLine: 1,
          originalColumn: 0,
          originalName: "checkout"
        }
      ],
      unresolvedFrameCount: 1
    });
    expect(replaceErrorStackResolutions).not.toHaveBeenCalled();
  });

  it("caches fully resolved error stacks", async () => {
    const maps = new Map([
      [
        "/source-maps/app.min.js.map",
        JSON.stringify({
          version: 3,
          file: "app.min.js",
          sources: ["src/app.ts"],
          sourcesContent: ["const secretImplementation = true;"],
          names: ["checkout"],
          mappings: "AAAAA"
        })
      ],
      [
        "/source-maps/vendor.min.js.map",
        JSON.stringify({
          version: 3,
          file: "vendor.min.js",
          sources: ["src/vendor.ts"],
          sourcesContent: ["const vendorSecretImplementation = true;"],
          names: ["vendor"],
          mappings: "AAAAA"
        })
      ]
    ]);
    const replaceErrorStackResolutions = vi.fn(async (input) => input.frames);

    const resolution = await resolveErrorStackWithSourceMaps({
      errorId: "err_1",
      projectId: "prj_1",
      environmentId: "env_1",
      getErrorForSourceMapResolution: async () => ({
        id: "err_1",
        projectId: "prj_1",
        environmentId: "env_1",
        release: "2026.05.11",
        stack: [
          "TypeError: failed",
          "    at checkout (https://cdn.example.com/assets/app.min.js:1:1)",
          "    at vendor (https://cdn.example.com/assets/vendor.min.js:1:1)"
        ].join("\n")
      }),
      getCachedErrorStackResolution: async () => [],
      findSourceMapArtifactForFrame: async (input) => ({
        id: input.minifiedFile === "app.min.js" ? "smap_1" : "smap_2",
        storagePath: `/source-maps/${input.minifiedFile}.map`
      }),
      readSourceMapFile: async ({ storagePath }) => maps.get(storagePath) ?? "",
      replaceErrorStackResolutions
    });

    expect(resolution?.status).toBe("resolved");
    expect(resolution?.unresolvedFrameCount).toBe(0);
    expect(resolution?.frames).toHaveLength(2);
    expect(JSON.stringify(resolution?.frames)).not.toContain("secretImplementation");
    expect(replaceErrorStackResolutions).toHaveBeenCalledTimes(1);
    expect(replaceErrorStackResolutions).toHaveBeenCalledWith({
      errorId: "err_1",
      projectId: "prj_1",
      environmentId: "env_1",
      release: "2026.05.11",
      frames: expect.arrayContaining([
        expect.objectContaining({ frameIndex: 0, sourceMapArtifactId: "smap_1" }),
        expect.objectContaining({ frameIndex: 1, sourceMapArtifactId: "smap_2" })
      ])
    });
  });
});

describe("query routes", () => {
  it("lists events for an authenticated human user", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEvents: async (filters) => {
          receivedFilters.push(filters);
          return {
            data: [{ id: "evt_1", name: "account.created" }],
            cursor: "next_cursor"
          };
        },
        getEventAggregates: async () => ({ total: 1 })
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [{ id: "evt_1", name: "account.created" }],
      cursor: "next_cursor"
    });
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        limit: 50
      }
    ]);
  });

  it("returns 401 when query routes are unauthenticated", async () => {
    app = await buildApp({
      readiness,
      auth: {
        login: async () => null,
        findSessionUser: async () => null
      },
      query: {
        listEvents: async () => []
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("requires project_id and environment_id for list routes", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEvents: async () => []
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("defaults invalid limits and caps high limits", async () => {
    const limits: number[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEvents: async (filters) => {
          limits.push(filters.limit);
          return [];
        }
      }
    });

    await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1&limit=not-a-number"
    });
    await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1&limit=0"
    });
    await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1&limit=900"
    });

    expect(limits).toEqual([50, 1, 500]);
  });

  it("parses event_name for event queries", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEvents: async (filters) => {
          receivedFilters.push(filters);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1&event_name=checkout.started"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        eventName: "checkout.started",
        limit: 50
      }
    ]);
  });

  it("does not forward error-only filters for event queries", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEvents: async (filters) => {
          receivedFilters.push(filters);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/events?project_id=prj_1&environment_id=env_1&event_name=checkout.started" +
        "&severity=critical&status=open&fingerprint=fp_1"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        eventName: "checkout.started",
        limit: 50
      }
    ]);
  });

  it("converts optional filter query params to camelCase values", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listErrors: async (filters) => {
          receivedFilters.push(filters);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/errors?project_id=prj_1&environment_id=env_1&tenant_id=ten_1&user_id=user_1" +
        "&session_id=sess_1&trace_id=trc_1&from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z" +
        "&limit=25&cursor=cur_1"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        tenantId: "ten_1",
        userId: "user_1",
        sessionId: "sess_1",
        traceId: "trc_1",
        from: new Date("2026-01-01T00:00:00.000Z"),
        to: new Date("2026-01-02T00:00:00.000Z"),
        limit: 25,
        cursor: "cur_1"
      }
    ]);
  });

  it("returns 400 when a query cursor is invalid for the requested scope", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEvents: async () => {
          throw new Error("invalid_cursor_scope");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1&cursor=cur_other_scope"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_cursor" });
  });

  it("parses severity status and fingerprint for error queries", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listErrors: async (filters) => {
          receivedFilters.push(filters);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/errors?project_id=prj_1&environment_id=env_1" +
        "&severity=critical&status=open&fingerprint=fp_checkout_fetch"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        severity: "critical",
        status: "open",
        fingerprint: "fp_checkout_fetch",
        limit: 50
      }
    ]);
  });

  it("parses error_group_id for raw error queries", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listErrors: async (filters) => {
          receivedFilters.push(filters);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/errors?project_id=prj_1&environment_id=env_1&error_group_id=egrp_1"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        errorGroupId: "egrp_1",
        limit: 50
      }
    ]);
  });

  it("ignores event_name for error queries", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listErrors: async (filters) => {
          receivedFilters.push(filters);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/errors?project_id=prj_1&environment_id=env_1" +
        "&event_name=checkout.started&severity=critical"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        severity: "critical",
        limit: 50
      }
    ]);
  });

  it("returns unresolved source map resolution for an error without a release", async () => {
    const resolveErrorStack = vi.fn(async () => ({
      errorId: "err_1",
      release: null,
      status: "unresolved" as const,
      frames: [],
      unresolvedFrameCount: 0
    }));

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        resolveErrorStack
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/errors/err_1/source-map-resolution?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        errorId: "err_1",
        release: null,
        status: "unresolved",
        frames: [],
        unresolvedFrameCount: 0
      }
    });
    expect(resolveErrorStack).toHaveBeenCalledWith({
      errorId: "err_1",
      projectId: "prj_1",
      environmentId: "env_1"
    });
  });

  it("returns resolved source map frames without exposing source contents", async () => {
    const map = JSON.stringify({
      version: 3,
      file: "app.min.js",
      sources: ["src/app.ts"],
      sourcesContent: ["const secretImplementation = true;"],
      names: ["checkout"],
      mappings: "AAAAA"
    });
    const replaceErrorStackResolutions = vi.fn(async (input) => input.frames);
    const resolveErrorStack = vi.fn((input: { errorId: string; projectId: string; environmentId: string }) =>
      resolveErrorStackWithSourceMaps({
        ...input,
        getErrorForSourceMapResolution: async () => ({
          id: "err_1",
          projectId: "prj_1",
          environmentId: "env_1",
          release: "2026.05.11",
          stack: "    at checkout (https://cdn.example.com/assets/app.min.js:1:1)"
        }),
        getCachedErrorStackResolution: async () => [],
        findSourceMapArtifactForFrame: async () => ({ id: "smap_1", storagePath: "/source-maps/app.min.js.map" }),
        readSourceMapFile: async () => map,
        replaceErrorStackResolutions
      })
    );

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        resolveErrorStack
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/errors/err_1/source-map-resolution?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        errorId: "err_1",
        release: "2026.05.11",
        status: "resolved",
        frames: [
          expect.objectContaining({
            sourceMapArtifactId: "smap_1",
            frameIndex: 0,
            minifiedFile: "app.min.js",
            originalSource: "src/app.ts",
            originalName: "checkout"
          })
        ],
        unresolvedFrameCount: 0
      }
    });
    expect(JSON.stringify(response.json())).not.toContain("sourcesContent");
    expect(JSON.stringify(response.json())).not.toContain("secretImplementation");
    expect(resolveErrorStack).toHaveBeenCalledWith({
      errorId: "err_1",
      projectId: "prj_1",
      environmentId: "env_1"
    });
    expect(replaceErrorStackResolutions).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for source map resolution without scope", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        resolveErrorStack: async () => null
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/errors/err_1/source-map-resolution?project_id=prj_1"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 401 for unauthenticated source map resolution", async () => {
    app = await buildApp({
      readiness,
      auth: {
        login: async () => null,
        findSessionUser: async () => null
      },
      query: {
        resolveErrorStack: async () => null
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/errors/err_1/source-map-resolution?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns 404 when an error source map resolution target is not found", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        resolveErrorStack: async () => null
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/errors/missing/source-map-resolution?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "error_not_found" });
  });

  it("returns a session timeline for logged-in users", async () => {
    const timeline = {
      sessionId: "sess_1",
      scope: { projectId: "prj_1", environmentId: "env_1" },
      range: { from: "2026-05-11T11:50:00.000Z", to: "2026-05-11T12:02:00.000Z" },
      items: [{ id: "brd_1", type: "breadcrumb", timestamp: "2026-05-11T12:00:00.000Z", title: "Clicked Pay" }],
      page: { nextCursor: null, previousCursor: null }
    };
    const getSessionTimeline = vi.fn(async () => timeline);

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getSessionTimeline }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1" +
        "&center=2026-05-11T12%3A00%3A00.000Z&before=600&after=120&types=breadcrumb,error&limit=25"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: timeline });
    expect(getSessionTimeline).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      sessionId: "sess_1",
      center: new Date("2026-05-11T12:00:00.000Z"),
      beforeMs: 600_000,
      afterMs: 120_000,
      types: ["breadcrumb", "error"],
      limit: 25
    });
  });

  it("forwards optional session timeline filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getSessionTimeline: async (filters) => {
          receivedFilters.push(filters);
          return { sessionId: "sess/1", items: [] };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        `/query/sessions/${encodeURIComponent("sess/1")}/timeline?project_id=prj_1&environment_id=env_1` +
        "&tenant_id=ten_1&user_id=user_1&from=2026-05-11T11%3A00%3A00.000Z&to=2026-05-11T12%3A00%3A00.000Z" +
        "&limit=900"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        sessionId: "sess/1",
        tenantId: "ten_1",
        userId: "user_1",
        from: new Date("2026-05-11T11:00:00.000Z"),
        to: new Date("2026-05-11T12:00:00.000Z"),
        limit: 500
      }
    ]);
  });

  it("flattens repeated session timeline type lists", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getSessionTimeline: async (filters) => {
          receivedFilters.push(filters);
          return { sessionId: "sess_1", items: [] };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1" +
        "&types=breadcrumb,error&types=trace"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        sessionId: "sess_1",
        types: ["breadcrumb", "error", "trace"],
        limit: 50
      }
    ]);
  });

  it.each([
    "/query/sessions/sess_1/timeline?project_id=prj_1",
    "/query/sessions/%20/timeline?project_id=prj_1&environment_id=env_1",
    "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1&from=yesterday",
    "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1&to=tomorrow",
    "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1&center=soon",
    "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1&before=-1",
    "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1&before=1&before=-1",
    "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1&after=-1",
    "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1&after=1&after=-1",
    "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1&types=breadcrumb,metric",
    "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1&types=breadcrumb&types=metric"
  ])("rejects invalid session timeline query %s", async (url) => {
    const getSessionTimeline = vi.fn(async () => ({ sessionId: "sess_1", items: [] }));

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getSessionTimeline }
    });

    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
    expect(getSessionTimeline).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated session timeline queries", async () => {
    app = await buildApp({
      readiness,
      auth: {
        login: async () => null,
        findSessionUser: async () => null
      },
      query: {
        getSessionTimeline: async () => ({ sessionId: "sess_1", items: [] })
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns 501 when session timeline query dependency is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {}
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "query_method_unavailable" });
  });

  it("returns 503 when session timeline query dependency throws", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getSessionTimeline: async () => {
          throw new Error("database down");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "query_unavailable" });
  });

  it("rejects invalid date filters", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEvents: async () => []
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1&from=yesterday"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("lists trace spans for a valid trace id", async () => {
    const received: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listTraceSpans: async (traceId, filters) => {
          received.push({ traceId, filters });
          return [{ id: "spn_1", traceId }];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/traces/trc_1/spans?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [{ id: "spn_1", traceId: "trc_1" }] });
    expect(received).toEqual([
      {
        traceId: "trc_1",
        filters: {
          projectId: "prj_1",
          environmentId: "env_1",
          traceId: "trc_1",
          limit: 50
        }
      }
    ]);
  });

  it("forwards trace endpoint filters for APM drilldown", async () => {
    const received: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listTraces: async (filters) => {
          received.push(filters);
          return [{ id: "trc_1", name: "GET /api/orders" }];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/traces?project_id=prj_1&environment_id=env_1&trace_name=GET+%2Fapi%2Forders&status=success"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [{ id: "trc_1", name: "GET /api/orders" }] });
    expect(received).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        traceName: "GET /api/orders",
        eventName: "GET /api/orders",
        status: "success",
        limit: 50
      }
    ]);
  });

  it("rejects conflicting trace ids for trace span queries", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listTraceSpans: async () => []
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/traces/trc_1/spans?project_id=prj_1&environment_id=env_1&trace_id=trc_2"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("keeps query dependency method context", async () => {
    const query = {
      events: [{ id: "evt_1" }],
      async listEvents() {
        return this.events;
      }
    };

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [{ id: "evt_1" }] });
  });

  it("returns aggregates under data", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getEventAggregates: async () => ({ total: 2, byName: { "account.created": 2 } })
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/aggregates/events?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { total: 2, byName: { "account.created": 2 } } });
  });

  it("does not forward event_name for event aggregate queries", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getEventAggregates: async (filters) => {
          receivedFilters.push(filters);
          return { total: 2 };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/aggregates/events?project_id=prj_1&environment_id=env_1&event_name=checkout.started"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        limit: 50
      }
    ]);
  });

  it("forwards LLM-specific filters for LLM call queries", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listLlmCalls: async (filters) => {
          receivedFilters.push(filters);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/llm-calls?project_id=prj_1&environment_id=env_1&provider=openai&model=gpt-5&prompt_name=generate_sql&status=success&limit=25"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        status: "success",
        limit: 25
      }
    ]);
  });

  it("forwards LLM-specific filters for LLM aggregate queries", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmAggregates: async (filters) => {
          receivedFilters.push(filters);
          return { totalCalls: 1 };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/aggregates/llm?project_id=prj_1&environment_id=env_1&provider=openai&model=gpt-5&prompt_name=generate_sql&status=success"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        status: "success",
        limit: 50
      }
    ]);
  });

  it("does not forward LLM-specific filters for event aggregate queries", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getEventAggregates: async (filters) => {
          receivedFilters.push(filters);
          return { total: 2 };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/aggregates/events?project_id=prj_1&environment_id=env_1&provider=openai&model=gpt-5&prompt_name=generate_sql&status=success"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        limit: 50
      }
    ]);
  });

  it("forwards default overview filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getOverview: async (filters) => {
          receivedFilters.push(filters);
          return { ok: true };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/overview?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { ok: true } });
    expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", window: "24h" }]);
  });

  it("forwards explicit overview windows", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getOverview: async (filters) => {
          receivedFilters.push(filters);
          return { ok: true };
        }
      }
    });

    for (const window of ["24h", "7d", "30d"]) {
      const response = await app.inject({
        method: "GET",
        url: `/query/overview?project_id=prj_1&environment_id=env_1&window=${window}`
      });
      expect(response.statusCode).toBe(200);
    }

    expect(receivedFilters).toEqual([
      { projectId: "prj_1", environmentId: "env_1", window: "24h" },
      { projectId: "prj_1", environmentId: "env_1", window: "7d" },
      { projectId: "prj_1", environmentId: "env_1", window: "30d" }
    ]);
  });

  it("rejects unsupported overview windows", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getOverview: async () => ({ ok: true })
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/overview?project_id=prj_1&environment_id=env_1&window=custom"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("forwards default operations filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getOperations: async (filters) => {
          receivedFilters.push(filters);
          return { status: "healthy" };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/operations?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { status: "healthy" } });
    expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", window: "24h" }]);
  });

  it("forwards explicit operations windows", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getOperations: async (filters) => {
          receivedFilters.push(filters);
          return { status: "healthy" };
        }
      }
    });

    for (const window of ["24h", "7d", "30d"]) {
      const response = await app.inject({
        method: "GET",
        url: `/query/operations?project_id=prj_1&environment_id=env_1&window=${window}`
      });
      expect(response.statusCode).toBe(200);
    }

    expect(receivedFilters).toEqual([
      { projectId: "prj_1", environmentId: "env_1", window: "24h" },
      { projectId: "prj_1", environmentId: "env_1", window: "7d" },
      { projectId: "prj_1", environmentId: "env_1", window: "30d" }
    ]);
  });

  it("forwards APM endpoint query filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getApmEndpoints: async (filters) => {
          receivedFilters.push(filters);
          return { endpoints: [] };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/apm/endpoints?project_id=prj_1&environment_id=env_1&window=7d&limit=25"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { endpoints: [] } });
    expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", window: "7d", limit: 25 }]);
  });

  it("forwards event property catalog query filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getEventPropertyCatalog: async (filters) => {
          receivedFilters.push(filters);
          return { properties: [] };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events/properties?project_id=prj_1&environment_id=env_1&window=7d&limit=25"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { properties: [] } });
    expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", window: "7d", limit: 25 }]);
  });

  it("forwards conversion funnel query filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getEventFunnel: async (filters) => {
          receivedFilters.push(filters);
          return { steps: [] };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events/funnel?project_id=prj_1&environment_id=env_1&window=30d&steps=signup.started,project.created&limit=20"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { steps: [] } });
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        window: "30d",
        limit: 20,
        steps: ["signup.started", "project.created"]
      }
    ]);
  });

  it("rejects conversion funnels with fewer than two steps", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getEventFunnel: async () => ({ steps: [] })
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events/funnel?project_id=prj_1&environment_id=env_1&steps=signup.started"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("forwards event pathfinder query filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getEventPaths: async (filters) => {
          receivedFilters.push(filters);
          return { paths: [] };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events/paths?project_id=prj_1&environment_id=env_1&window=30d&start_event=signup.started&end_event=key.created&tenant_id=tenant_1&segment_id=seg_1&actor=user&max_depth=4&limit=20&from=2026-05-01T00:00:00.000Z&to=2026-05-08T00:00:00.000Z"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { paths: [] } });
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        window: "30d",
        limit: 20,
        startEvent: "signup.started",
        endEvent: "key.created",
        tenantId: "tenant_1",
        userId: undefined,
        sessionId: undefined,
        traceId: undefined,
        segmentId: "seg_1",
        actorType: "user",
        from: new Date("2026-05-01T00:00:00.000Z"),
        to: new Date("2026-05-08T00:00:00.000Z"),
        pathLength: 4
      }
    ]);
  });

  it.each([
    "/query/events/paths?project_id=prj_1&environment_id=env_1",
    "/query/events/paths?project_id=prj_1&environment_id=env_1&start_event=signup.started&actor=device",
    "/query/events/paths?project_id=prj_1&environment_id=env_1&start_event=signup.started&max_depth=1",
    "/query/events/paths?project_id=prj_1&environment_id=env_1&start_event=signup.started&from=2026-05-08T00:00:00.000Z&to=2026-05-01T00:00:00.000Z"
  ])("rejects invalid event pathfinder query %s", async (url) => {
    const getEventPaths = vi.fn(async () => ({ paths: [] }));

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getEventPaths }
    });

    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
    expect(getEventPaths).not.toHaveBeenCalled();
  });

  it("forwards event retention query filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getEventRetention: async (filters) => {
          receivedFilters.push(filters);
          return { cohorts: [] };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events/retention?project_id=prj_1&environment_id=env_1&window=30d&entry_event=signup.started&return_event=app.opened&period=daily&intervals=7&limit=20"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { cohorts: [] } });
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        window: "30d",
        limit: 20,
        entryEvent: "signup.started",
        returnEvent: "app.opened",
        period: "daily",
        intervals: 7
      }
    ]);
  });

  it.each([
    "/query/events/retention?project_id=prj_1&environment_id=env_1&entry_event=signup.started",
    "/query/events/retention?project_id=prj_1&environment_id=env_1&entry_event=signup.started&return_event=app.opened&period=yearly",
    "/query/events/retention?project_id=prj_1&environment_id=env_1&entry_event=signup.started&return_event=app.opened&intervals=1",
    "/query/events/retention?project_id=prj_1&environment_id=env_1&entry_event=signup.started&return_event=app.opened&intervals=13"
  ])("rejects invalid event retention query %s", async (url) => {
    const getEventRetention = vi.fn(async () => ({ cohorts: [] }));

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getEventRetention }
    });

    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
    expect(getEventRetention).not.toHaveBeenCalled();
  });

  it("forwards service map query filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getServiceMap: async (filters) => {
          receivedFilters.push(filters);
          return { edges: [] };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/apm/service-map?project_id=prj_1&environment_id=env_1&window=30d&limit=15"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { edges: [] } });
    expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", window: "30d", limit: 15 }]);
  });

  it("forwards web vitals query filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getWebVitals: async (filters) => {
          receivedFilters.push(filters);
          return { metrics: [] };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/apm/web-vitals?project_id=prj_1&environment_id=env_1&window=7d&limit=12"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { metrics: [] } });
    expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", window: "7d", limit: 12 }]);
  });

  it("forwards runtime profile query filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getRuntimeProfiles: async (filters) => {
          receivedFilters.push(filters);
          return { profiles: [], hotFunctions: [] };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/apm/profiles?project_id=prj_1&environment_id=env_1&window=24h&limit=20"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { profiles: [], hotFunctions: [] } });
    expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", window: "24h", limit: 20 }]);
  });

  it("rejects unsupported operations windows", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getOperations: async () => ({ status: "healthy" })
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/operations?project_id=prj_1&environment_id=env_1&window=custom"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("forwards default entity tenant list filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEntityTenants: async (filters) => {
          receivedFilters.push(filters);
          return {
            window: "7d",
            generatedAt: "2026-05-05T12:00:00.000Z",
            scope: { projectId: "prj_1", environmentId: "env_1" },
            range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
            tenants: []
          };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/entities/tenants?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        window: "7d",
        generatedAt: "2026-05-05T12:00:00.000Z",
        scope: { projectId: "prj_1", environmentId: "env_1" },
        range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
        tenants: []
      }
    });
    expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", window: "7d", limit: 50 }]);
  });

  it("forwards explicit entity tenant list filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEntityTenants: async (filters) => {
          receivedFilters.push(filters);
          return {
            window: "30d",
            generatedAt: "2026-05-05T12:00:00.000Z",
            scope: { projectId: "prj_1", environmentId: "env_1" },
            range: { from: "2026-04-05T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
            tenants: []
          };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/entities/tenants?project_id=prj_1&environment_id=env_1&window=30d&search=%20tenant_1%20&limit=500"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      { projectId: "prj_1", environmentId: "env_1", window: "30d", search: "tenant_1", limit: 100 }
    ]);
  });

  it("rejects unsupported entity windows", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEntityTenants: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/entities/tenants?project_id=prj_1&environment_id=env_1&window=custom"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("forwards entity tenant detail filters and decoded cursor", async () => {
    const receivedFilters: unknown[] = [];
    const cursor = Buffer.from(JSON.stringify({ timestamp: "2026-05-05T11:00:00.000Z", type: "error", id: "err_1" })).toString(
      "base64url"
    );

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getEntityTenantDetail: async (tenantId, filters) => {
          receivedFilters.push({ tenantId, filters });
          return {
            window: "24h",
            generatedAt: "2026-05-05T12:00:00.000Z",
            scope: { projectId: "prj_1", environmentId: "env_1", tenantId },
            timeline: []
          };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/entities/tenants/tenant%2Fone?project_id=prj_1&environment_id=env_1&window=24h&user_id=%20usr_1%20" +
        `&signal_type=error&limit=25&cursor=${cursor}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        window: "24h",
        generatedAt: "2026-05-05T12:00:00.000Z",
        scope: { projectId: "prj_1", environmentId: "env_1", tenantId: "tenant/one" },
        timeline: []
      }
    });
    expect(receivedFilters).toEqual([
      {
        tenantId: "tenant/one",
        filters: {
          projectId: "prj_1",
          environmentId: "env_1",
          window: "24h",
          userId: "usr_1",
          signalType: "error",
          limit: 25,
          cursor: { timestamp: "2026-05-05T11:00:00.000Z", type: "error", id: "err_1" }
        }
      }
    ]);
  });

  it("rejects unassigned entity tenant detail routes", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getEntityTenantDetail: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/entities/tenants/_unassigned?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("rejects invalid entity tenant detail cursors", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getEntityTenantDetail: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/entities/tenants/tenant_1?project_id=prj_1&environment_id=env_1&cursor=not-json"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 501 when entity query dependency methods are missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {}
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/query/entities/tenants?project_id=prj_1&environment_id=env_1"
    });
    const detailResponse = await app.inject({
      method: "GET",
      url: "/query/entities/tenants/tenant_1?project_id=prj_1&environment_id=env_1"
    });

    expect(listResponse.statusCode).toBe(501);
    expect(listResponse.json()).toEqual({ error: "query_method_unavailable" });
    expect(detailResponse.statusCode).toBe(501);
    expect(detailResponse.json()).toEqual({ error: "query_method_unavailable" });
  });

  it("returns 503 when entity query dependencies throw", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEntityTenants: async () => {
          throw new Error("database down");
        },
        getEntityTenantDetail: async () => {
          throw new Error("database down");
        }
      }
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/query/entities/tenants?project_id=prj_1&environment_id=env_1"
    });
    const detailResponse = await app.inject({
      method: "GET",
      url: "/query/entities/tenants/tenant_1?project_id=prj_1&environment_id=env_1"
    });

    expect(listResponse.statusCode).toBe(503);
    expect(listResponse.json()).toEqual({ error: "query_unavailable" });
    expect(detailResponse.statusCode).toBe(503);
    expect(detailResponse.json()).toEqual({ error: "query_unavailable" });
  });

  it("forwards default user list filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listUsersActivity: async (filters) => {
          receivedFilters.push(filters);
          return {
            window: "7d",
            generatedAt: "2026-05-05T12:00:00.000Z",
            scope: { projectId: "prj_1", environmentId: "env_1" },
            range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
            users: []
          };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/users?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        window: "7d",
        generatedAt: "2026-05-05T12:00:00.000Z",
        scope: { projectId: "prj_1", environmentId: "env_1" },
        range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
        users: []
      }
    });
    expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", window: "7d", limit: 50 }]);
  });

  it("forwards explicit user list filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listUsersActivity: async (filters) => {
          receivedFilters.push(filters);
          return {
            window: "30d",
            generatedAt: "2026-05-05T12:00:00.000Z",
            scope: { projectId: "prj_1", environmentId: "env_1" },
            range: { from: "2026-04-05T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
            users: []
          };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/users?project_id=prj_1&environment_id=env_1&window=30d&search=%20user_1%20&tenant_id=%20tenant_1%20&limit=500"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      { projectId: "prj_1", environmentId: "env_1", window: "30d", search: "user_1", tenantId: "tenant_1", limit: 100 }
    ]);
  });

  it("rejects unsupported user windows", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listUsersActivity: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/users?project_id=prj_1&environment_id=env_1&window=custom"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("forwards user detail filters and decoded cursor", async () => {
    const receivedFilters: unknown[] = [];
    const cursor = Buffer.from(JSON.stringify({ timestamp: "2026-05-05T11:00:00.000Z", type: "error", id: "err_1" })).toString(
      "base64url"
    );

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getUserDetail: async (userId, filters) => {
          receivedFilters.push({ userId, filters });
          return {
            window: "24h",
            generatedAt: "2026-05-05T12:00:00.000Z",
            scope: { projectId: "prj_1", environmentId: "env_1" },
            range: { from: "2026-05-04T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
            user: {
              userId: "user/one",
              label: "user/one",
              isAnonymous: false,
              impactScore: 0,
              lastSeenAt: null,
              events: 0,
              errors: 0,
              openErrors: 0,
              severeErrors: 0,
              traces: 0,
              failedTraces: 0,
              llmCalls: 0,
              failedLlmCalls: 0,
              llmCostUsd: "0",
              activeTenants: 0,
              activeSessions: 0
            },
            recentSessions: [],
            timeline: []
          };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        `/query/users/${encodeURIComponent("user/one")}?project_id=prj_1&environment_id=env_1&window=24h` +
        `&tenant_id=tenant_1&signal_type=error&limit=25&cursor=${cursor}`
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        userId: "user/one",
        filters: {
          projectId: "prj_1",
          environmentId: "env_1",
          window: "24h",
          tenantId: "tenant_1",
          signalType: "error",
          limit: 25,
          cursor: { timestamp: "2026-05-05T11:00:00.000Z", type: "error", id: "err_1" }
        }
      }
    ]);
  });

  it("rejects anonymous and invalid user detail cursors", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getUserDetail: async () => {
          throw new Error("should not run");
        }
      }
    });

    const anonymousResponse = await app.inject({
      method: "GET",
      url: "/query/users/_anonymous?project_id=prj_1&environment_id=env_1"
    });
    expect(anonymousResponse.statusCode).toBe(400);
    expect(anonymousResponse.json()).toEqual({ error: "invalid_query" });

    const invalidCursorResponse = await app.inject({
      method: "GET",
      url: "/query/users/user_1?project_id=prj_1&environment_id=env_1&cursor=not-json"
    });
    expect(invalidCursorResponse.statusCode).toBe(400);
    expect(invalidCursorResponse.json()).toEqual({ error: "invalid_query" });
  });

  it("lists error groups with filters", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listErrorGroups: async (filters) => {
          receivedFilters.push(filters);
          return { data: [{ id: "egrp_1", status: "open" }], cursor: "cursor_next" };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/error-groups?project_id=prj_1&environment_id=env_1" +
        "&status=open&severity=critical&fingerprint=fp_1&release=1.2.3&limit=25&cursor=cursor_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [{ id: "egrp_1", status: "open" }], cursor: "cursor_next" });
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        status: "open",
        severity: "critical",
        fingerprint: "fp_1",
        release: "1.2.3",
        limit: 25,
        cursor: "cursor_1"
      }
    ]);
  });

  it("returns 400 for invalid error group cursors", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listErrorGroups: async () => {
          throw new Error("invalid_cursor");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/error-groups?project_id=prj_1&environment_id=env_1&cursor=bad"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_cursor" });
  });

  it("gets an error group detail by id with project and environment scope", async () => {
    const received: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getErrorGroup: async (id, filters) => {
          received.push({ id, filters });
          return { id: "egrp_1", status: "open" };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { id: "egrp_1", status: "open" } });
    expect(received).toEqual([
      {
        id: "egrp_1",
        filters: {
          projectId: "prj_1",
          environmentId: "env_1"
        }
      }
    ]);
  });

  it("gets an error group incident by id", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getErrorGroupIncident: async (id, filters) => ({
          group: { id, projectId: filters.projectId, environmentId: filters.environmentId },
          primaryOccurrence: { id: filters.errorId ?? "err_latest", errorGroupId: id },
          priority: null,
          suggestedPriority: "urgent",
          sourceMapResolution: { status: "none" },
          stronglyRelated: { items: [], truncated: false },
          nearbyContext: { items: [], truncated: false },
          related: { traceId: null, sessionId: null, userId: null, tenantId: null, release: null }
        })
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/incidents/error-groups/egrp_1?project_id=prj_1&environment_id=env_1&error_id=err_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        group: { id: "egrp_1" },
        primaryOccurrence: { id: "err_1" },
        suggestedPriority: "urgent"
      }
    });
  });

  it("lists raw occurrences for an error group", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listErrors: async (filters) => {
          receivedFilters.push(filters);
          return [{ id: "err_1", errorGroupId: "egrp_1" }];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/error-groups/egrp_1/errors?project_id=prj_1&environment_id=env_1&limit=25"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [{ id: "err_1", errorGroupId: "egrp_1" }] });
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        errorGroupId: "egrp_1",
        limit: 25
      }
    ]);
  });

  it("rejects conflicting error group ids for occurrence queries", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listErrors: async () => []
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/error-groups/egrp_1/errors?project_id=prj_1&environment_id=env_1&error_group_id=egrp_2"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 400 for invalid raw occurrence cursors", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listErrors: async () => {
          throw new Error("invalid_cursor_scope");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/error-groups/egrp_1/errors?project_id=prj_1&environment_id=env_1&cursor=bad"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_cursor" });
  });

  it("updates an error group status", async () => {
    const received: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        updateErrorGroupStatus: async (id, input) => {
          received.push({ id, input });
          return { id: "egrp_1", status: "resolved" };
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
      payload: { status: "resolved" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { id: "egrp_1", status: "resolved" } });
    expect(received).toEqual([
      {
        id: "egrp_1",
        input: {
          projectId: "prj_1",
          environmentId: "env_1",
          status: "resolved"
        }
      }
    ]);
  });

  it("updates error group status and priority", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        updateErrorGroupTriage: async (id, input) => ({
          id,
          projectId: input.projectId,
          environmentId: input.environmentId,
          status: input.status,
          priority: input.priority
        })
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
      payload: { status: "investigating", priority: "high" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { id: "egrp_1", status: "investigating", priority: "high" }
    });
  });

  it("rejects invalid error group priority", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        updateErrorGroupTriage: async () => {
          throw new Error("should not be called");
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
      payload: { priority: "p0" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it.each(["open", "investigating", "resolved", "ignored"])("accepts %s as an error group status", async (status) => {
    const receivedStatuses: string[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        updateErrorGroupStatus: async (_id, input) => {
          receivedStatuses.push(input.status);
          return { id: "egrp_1", status: input.status };
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
      payload: { status }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { id: "egrp_1", status } });
    expect(receivedStatuses).toEqual([status]);
  });

  it("rejects invalid error group statuses", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        updateErrorGroupStatus: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
      payload: { status: "closed" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 501 when overview query dependency is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {}
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/overview?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "query_method_unavailable" });
  });

  it("returns 503 when overview query dependency throws", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getOverview: async () => {
          throw new Error("database down");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/overview?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "query_unavailable" });
  });

  it("returns 501 when operations query dependency is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {}
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/operations?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "query_method_unavailable" });
  });

  it("returns 503 when operations query dependency throws", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getOperations: async () => {
          throw new Error("database down");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/operations?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "query_unavailable" });
  });

  it("returns 501 when a query dependency method is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {}
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/llm-calls?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "query_method_unavailable" });
  });

  // ── assign incident ─────────────────────────────────────────────────────────

  it("assigns an incident to a user via PATCH /query/error-groups/:id", async () => {
    const received: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        assignIncident: async (input) => {
          received.push(input);
          return { ok: true, group: { id: "egrp_1", assignedToUserId: "usr_2" } as never };
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
      payload: { assignedToUserId: "usr_2" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { id: "egrp_1", assignedToUserId: "usr_2" } });
    expect(received).toEqual([{ errorGroupId: "egrp_1", assignedToUserId: "usr_2", projectId: "prj_1", environmentId: "env_1" }]);
  });

  it("unassigns an incident when assignedToUserId is null", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        assignIncident: async (input) =>
          ({ ok: true, group: { id: "egrp_1", assignedToUserId: input.assignedToUserId } } as never)
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
      payload: { assignedToUserId: null }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { assignedToUserId: null } });
  });

  it("returns 404 when assigning to an unknown error group", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        assignIncident: async () => ({ ok: false, error: { kind: "group_not_found" } } as never)
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_unknown?project_id=prj_1&environment_id=env_1",
      payload: { assignedToUserId: "usr_2" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "error_group_not_found" });
  });

  it("returns 400 when assignee user is not found", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        assignIncident: async () => ({ ok: false, error: { kind: "user_not_found" } } as never)
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
      payload: { assignedToUserId: "usr_ghost" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "user_not_found" });
  });

  it("returns 400 when assignee user is archived", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        assignIncident: async () => ({ ok: false, error: { kind: "user_archived" } } as never)
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
      payload: { assignedToUserId: "usr_archived" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "user_archived" });
  });

  it("returns 401 for unauthenticated assign request", async () => {
    app = await buildApp({
      readiness,
      auth: { login: humanAuth.login, findSessionUser: async () => null },
      query: {
        assignIncident: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
      payload: { assignedToUserId: "usr_2" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  // ── triage notes ────────────────────────────────────────────────────────────

  it("creates a triage note with currentUser identity", async () => {
    const received: unknown[] = [];
    const now = new Date();

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        addTriageNote: async (input) => {
          received.push(input);
          return {
            ok: true as const,
            note: {
              id: "note_1",
              errorGroupId: input.errorGroupId,
              authorUserId: input.authorUserId,
              authorEmail: input.authorEmail,
              body: input.body,
              createdAt: now
            }
          };
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_1/notes?project_id=prj_1&environment_id=env_1",
      payload: { body: "Looks like a memory leak." }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        id: "note_1",
        errorGroupId: "egrp_1",
        authorUserId: "usr_1",
        authorEmail: "user@example.com",
        body: "Looks like a memory leak."
      }
    });
    expect(received).toEqual([
      {
        errorGroupId: "egrp_1",
        authorUserId: "usr_1",
        authorEmail: "user@example.com",
        body: "Looks like a memory leak.",
        projectId: "prj_1",
        environmentId: "env_1"
      }
    ]);
  });

  it("rejects empty note body", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        addTriageNote: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_1/notes?project_id=prj_1&environment_id=env_1",
      payload: { body: "   " }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("rejects note body exceeding 5000 characters", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        addTriageNote: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_1/notes?project_id=prj_1&environment_id=env_1",
      payload: { body: "a".repeat(5001) }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 401 for unauthenticated note creation", async () => {
    app = await buildApp({
      readiness,
      auth: { login: humanAuth.login, findSessionUser: async () => null },
      query: {
        addTriageNote: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_1/notes?project_id=prj_1&environment_id=env_1",
      payload: { body: "Hello" }
    });

    expect(response.statusCode).toBe(401);
  });

  // ── silence incident ────────────────────────────────────────────────────────

  it("silences an incident for a given number of minutes", async () => {
    const received: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        silenceIncident: async (input) => {
          received.push({ errorGroupId: input.errorGroupId, hasUntil: input.until !== null });
          return { id: "egrp_1", silencedUntil: input.until };
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_1/silence?project_id=prj_1&environment_id=env_1",
      payload: { minutes: 60 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { id: "egrp_1" } });
    expect(received).toEqual([{ errorGroupId: "egrp_1", hasUntil: true }]);
  });

  it("clears silence when minutes is null", async () => {
    const received: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        silenceIncident: async (input) => {
          received.push({ errorGroupId: input.errorGroupId, until: input.until });
          return { id: "egrp_1", silencedUntil: null };
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_1/silence?project_id=prj_1&environment_id=env_1",
      payload: { minutes: null }
    });

    expect(response.statusCode).toBe(200);
    expect(received).toEqual([{ errorGroupId: "egrp_1", until: null }]);
  });

  it("clears silence when minutes is 0", async () => {
    const received: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        silenceIncident: async (input) => {
          received.push({ until: input.until });
          return { id: "egrp_1", silencedUntil: null };
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_1/silence?project_id=prj_1&environment_id=env_1",
      payload: { minutes: 0 }
    });

    expect(response.statusCode).toBe(200);
    expect(received).toEqual([{ until: null }]);
  });

  it("returns 404 when silencing an unknown error group", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        silenceIncident: async () => null
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_unknown/silence?project_id=prj_1&environment_id=env_1",
      payload: { minutes: 30 }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "error_group_not_found" });
  });

  it("returns 400 for invalid silence body", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        silenceIncident: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_1/silence?project_id=prj_1&environment_id=env_1",
      payload: { minutes: -5 }
    });

    expect(response.statusCode).toBe(400);
  });

  // ── MTTR ────────────────────────────────────────────────────────────────────

  it("returns MTTR data for the default 7d window", async () => {
    const received: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getIncidentMttr: async (input) => {
          received.push(input);
          return { mttrMs: 3600000, resolvedCount: 5 };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/incidents/mttr?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: { mttrMs: 3600000, resolvedCount: 5, windowDays: 7 }
    });
    expect(received).toEqual([{ projectId: "prj_1", environmentId: "env_1", windowDays: 7 }]);
  });

  it("returns MTTR data for the 30d window", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getIncidentMttr: async (input) => ({ mttrMs: null, resolvedCount: 0 })
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/incidents/mttr?project_id=prj_1&environment_id=env_1&window=30d"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: { mttrMs: null, resolvedCount: 0, windowDays: 30 }
    });
  });

  it("returns 400 for unsupported MTTR window", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getIncidentMttr: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/incidents/mttr?project_id=prj_1&environment_id=env_1&window=24h"
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for missing project_id in MTTR request", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getIncidentMttr: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/incidents/mttr?environment_id=env_1"
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 401 for unauthenticated MTTR request", async () => {
    app = await buildApp({
      readiness,
      auth: { login: humanAuth.login, findSessionUser: async () => null },
      query: {
        getIncidentMttr: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/incidents/mttr?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(401);
  });

  // ── scope enforcement ────────────────────────────────────────────────────────

  it("returns 404 when assigning to an error group that exists but is in a different project/env", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        assignIncident: async () => ({ ok: false, error: { kind: "group_not_found" } } as never)
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_other&environment_id=env_other",
      payload: { assignedToUserId: "usr_2" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "error_group_not_found" });
  });

  it("passes projectId and environmentId to assignIncident", async () => {
    const received: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        assignIncident: async (input) => {
          received.push(input);
          return { ok: true, group: { id: "egrp_1", assignedToUserId: "usr_2" } as never };
        }
      }
    });

    await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_scope&environment_id=env_scope",
      payload: { assignedToUserId: "usr_2" }
    });

    expect(received).toEqual([
      { errorGroupId: "egrp_1", assignedToUserId: "usr_2", projectId: "prj_scope", environmentId: "env_scope" }
    ]);
  });

  it("returns 400 when assigning without project_id", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        assignIncident: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?environment_id=env_1",
      payload: { assignedToUserId: "usr_2" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 404 when silencing an error group in the wrong project/env", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        silenceIncident: async () => null
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_1/silence?project_id=prj_other&environment_id=env_other",
      payload: { minutes: 30 }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "error_group_not_found" });
  });

  it("passes projectId and environmentId to silenceIncident", async () => {
    const received: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        silenceIncident: async (input) => {
          received.push({ errorGroupId: input.errorGroupId, projectId: input.projectId, environmentId: input.environmentId });
          return { id: "egrp_1" };
        }
      }
    });

    await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_1/silence?project_id=prj_scope&environment_id=env_scope",
      payload: { minutes: 10 }
    });

    expect(received).toEqual([
      { errorGroupId: "egrp_1", projectId: "prj_scope", environmentId: "env_scope" }
    ]);
  });

  it("returns 400 when silencing without project_id", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        silenceIncident: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_1/silence?environment_id=env_1",
      payload: { minutes: 30 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 404 when adding a note to an error group in the wrong project/env", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        addTriageNote: async () => ({ ok: false as const, error: "group_not_found" as const })
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_1/notes?project_id=prj_other&environment_id=env_other",
      payload: { body: "This note should not be saved." }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "error_group_not_found" });
  });

  it("passes projectId and environmentId to addTriageNote", async () => {
    const received: unknown[] = [];
    const now = new Date();

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        addTriageNote: async (input) => {
          received.push({ errorGroupId: input.errorGroupId, projectId: input.projectId, environmentId: input.environmentId });
          return {
            ok: true as const,
            note: {
              id: "note_1",
              errorGroupId: input.errorGroupId,
              authorUserId: input.authorUserId,
              authorEmail: input.authorEmail,
              body: input.body,
              createdAt: now
            }
          };
        }
      }
    });

    await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_1/notes?project_id=prj_scope&environment_id=env_scope",
      payload: { body: "Scoped note." }
    });

    expect(received).toEqual([
      { errorGroupId: "egrp_1", projectId: "prj_scope", environmentId: "env_scope" }
    ]);
  });

  it("returns 400 when adding a note without project_id", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        addTriageNote: async () => {
          throw new Error("should not run");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/query/incidents/error-groups/egrp_1/notes?environment_id=env_1",
      payload: { body: "Missing scope." }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("applies both status and assignedToUserId in a combined PATCH payload", async () => {
    const triageCalls: unknown[] = [];
    const assignCalls: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        updateErrorGroupTriage: async (id, input) => {
          triageCalls.push({ id, ...input });
          return { id: "egrp_1", status: input.status } as never;
        },
        assignIncident: async (input) => {
          assignCalls.push(input);
          return { ok: true, group: { id: "egrp_1", status: "investigating", assignedToUserId: "usr_2" } as never };
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
      payload: { status: "investigating", assignedToUserId: "usr_2" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { id: "egrp_1", assignedToUserId: "usr_2" } });
    expect(triageCalls).toHaveLength(1);
    expect(assignCalls).toHaveLength(1);
    expect(assignCalls[0]).toMatchObject({ errorGroupId: "egrp_1", assignedToUserId: "usr_2", projectId: "prj_1", environmentId: "env_1" });
  });
});
