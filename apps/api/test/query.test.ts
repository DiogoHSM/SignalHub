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

vi.mock("@signal-hub/db/repositories/source-maps.js", () => ({
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
    const localDir = await mkdtemp(path.join(tmpdir(), "signalhub-source-maps-"));
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
    const localDir = await mkdtemp(path.join(tmpdir(), "signalhub-source-maps-"));

    try {
      await expect(readSourceMapFile({ localDir, storagePath: path.join(path.dirname(localDir), "outside.map") })).rejects.toThrow(
        "source_map_storage_path_invalid"
      );
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it("rejects source map reads through symlinks inside local storage", async () => {
    const localDir = await mkdtemp(path.join(tmpdir(), "signalhub-source-maps-"));
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

  it("returns resolved source map frames from the query dependency", async () => {
    const resolved = {
      errorId: "err_1",
      release: "2026.05.11",
      status: "resolved" as const,
      frames: [
        {
          sourceMapArtifactId: "smap_1",
          frameIndex: 0,
          minifiedFile: "app.min.js",
          minifiedLine: 10,
          minifiedColumn: 1234,
          originalSource: "src/app.ts",
          originalLine: 42,
          originalColumn: 4,
          originalName: "checkout"
        }
      ],
      unresolvedFrameCount: 0
    };
    const resolveErrorStack = vi.fn(async () => resolved);

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
    expect(response.json()).toEqual({ data: resolved });
    expect(resolveErrorStack).toHaveBeenCalledWith({
      errorId: "err_1",
      projectId: "prj_1",
      environmentId: "env_1"
    });
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
          return [{ id: "egrp_1", status: "open" }];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/error-groups?project_id=prj_1&environment_id=env_1" +
        "&status=open&severity=critical&fingerprint=fp_1&release=1.2.3&limit=25"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [{ id: "egrp_1", status: "open" }] });
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        status: "open",
        severity: "critical",
        fingerprint: "fp_1",
        release: "1.2.3",
        limit: 25
      }
    ]);
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
});
