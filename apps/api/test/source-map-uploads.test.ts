import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp, type BuildAppOptions } from "../src/app.js";

let app: FastifyInstance | undefined;

const readiness = async () => ({ postgres: true, redis: true });

function sourceMapArtifact(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "smap_1",
    projectId: "prj_1",
    environmentId: "env_1",
    release: "web@1.2.3",
    minifiedFile: "assets/app.js",
    originalFilename: "app.js.map",
    contentType: "application/json",
    byteSize: 72,
    sha256: "abc123",
    storagePath: "/private/source-maps/smap_1.map",
    uploadedByUserId: null,
    uploadedByTokenId: "smtok_1",
    createdAt: "2026-05-11T12:00:00.000Z",
    deletedAt: null,
    ...overrides
  };
}

function multipartBody(
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

function singleSourceMapBody(overrides: { projectId?: string; environmentId?: string; content?: string | Buffer } = {}) {
  return multipartBody([
    { name: "project_id", value: overrides.projectId ?? "prj_1" },
    { name: "environment_id", value: overrides.environmentId ?? "env_1" },
    { name: "release", value: "web@1.2.3" },
    { name: "minified_file", value: "assets/app.js" },
    {
      name: "file",
      filename: "app.js.map",
      contentType: "application/json",
      content:
        overrides.content ??
        JSON.stringify({ version: 3, sources: [], names: [], mappings: "", file: "assets/app.js" })
    }
  ]);
}

async function appWithUpload(overrides: Partial<BuildAppOptions> = {}) {
  const uploadMap = vi.fn().mockResolvedValue([sourceMapArtifact()]);
  const uploadBundle = vi.fn().mockResolvedValue([
    sourceMapArtifact({
      id: "smap_bundle_1",
      minifiedFile: "assets/vendor.js",
      originalFilename: "vendor.js.map"
    })
  ]);
  const verifyToken = vi.fn().mockResolvedValue({ id: "smtok_1", projectId: "prj_1", environmentId: "env_1" });

  return buildApp({
    readiness,
    sourceMaps: {
      maxUploadBytes: 1024 * 1024
    },
    sourceMapUploads: {
      verifyToken,
      uploadMap,
      uploadBundle
    },
    ...overrides
  });
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("source map CI uploads", () => {
  it("uploads a single source map with a token and returns redacted artifacts", async () => {
    const uploadMap = vi.fn().mockResolvedValue([sourceMapArtifact()]);
    app = await appWithUpload({
      sourceMapUploads: {
        verifyToken: vi.fn().mockResolvedValue({ id: "smtok_1", projectId: "prj_1", environmentId: "env_1" }),
        uploadMap,
        uploadBundle: vi.fn()
      }
    });
    const body = singleSourceMapBody();

    const response = await app.inject({
      method: "POST",
      url: "/v1/source-maps",
      headers: { ...body.headers, authorization: "Bearer shsmap_valid" },
      payload: body.payload
    });

    expect(response.statusCode).toBe(200);
    expect(uploadMap).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.2.3",
        minifiedFile: "assets/app.js",
        uploadedByTokenId: "smtok_1"
      })
    );
    expect(response.json()).toEqual({
      artifacts: [
        {
          id: "smap_1",
          projectId: "prj_1",
          environmentId: "env_1",
          release: "web@1.2.3",
          minifiedFile: "assets/app.js",
          originalFilename: "app.js.map",
          byteSize: 72,
          sha256: "abc123",
          createdAt: "2026-05-11T12:00:00.000Z"
        }
      ]
    });
  });

  it("uploads a source map bundle with a token", async () => {
    const uploadBundle = vi.fn().mockResolvedValue([sourceMapArtifact({ id: "smap_bundle_1" })]);
    app = await appWithUpload({
      sourceMapUploads: {
        verifyToken: vi.fn().mockResolvedValue({ id: "smtok_1", projectId: "prj_1", environmentId: "env_1" }),
        uploadMap: vi.fn(),
        uploadBundle
      }
    });
    const body = multipartBody([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "web@1.2.3" },
      { name: "bundle", filename: "source-maps.zip", contentType: "application/zip", content: Buffer.from("zip") }
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/source-maps",
      headers: { ...body.headers, authorization: "Bearer shsmap_valid" },
      payload: body.payload
    });

    expect(response.statusCode).toBe(200);
    expect(uploadBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        uploadedByTokenId: "smtok_1",
        originalFilename: "source-maps.zip"
      })
    );
    expect(response.json().artifacts[0].storagePath).toBeUndefined();
  });

  it("rejects source map uploads outside the token scope", async () => {
    const uploadMap = vi.fn();
    app = await appWithUpload({
      sourceMapUploads: {
        verifyToken: vi.fn().mockResolvedValue({ id: "smtok_1", projectId: "prj_1", environmentId: "env_1" }),
        uploadMap,
        uploadBundle: vi.fn()
      }
    });
    const body = singleSourceMapBody({ projectId: "prj_2" });

    const response = await app.inject({
      method: "POST",
      url: "/v1/source-maps",
      headers: { ...body.headers, authorization: "Bearer shsmap_valid" },
      payload: body.payload
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "source_map_upload_scope_mismatch" });
    expect(uploadMap).not.toHaveBeenCalled();
  });

  it("rejects invalid source map upload tokens", async () => {
    app = await appWithUpload({
      sourceMapUploads: {
        verifyToken: vi.fn().mockResolvedValue(null),
        uploadMap: vi.fn(),
        uploadBundle: vi.fn()
      }
    });
    const body = singleSourceMapBody();

    const response = await app.inject({
      method: "POST",
      url: "/v1/source-maps",
      headers: { ...body.headers, authorization: "Bearer shsmap_invalid" },
      payload: body.payload
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_source_map_upload_token" });
  });

  it("rejects missing auth", async () => {
    app = await appWithUpload();
    const body = singleSourceMapBody();

    const response = await app.inject({
      method: "POST",
      url: "/v1/source-maps",
      headers: body.headers,
      payload: body.payload
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_source_map_upload_token" });
  });

  it("rejects malformed auth", async () => {
    const verifyToken = vi.fn();
    const uploadMap = vi.fn();
    app = await appWithUpload({
      sourceMapUploads: {
        verifyToken,
        uploadMap,
        uploadBundle: vi.fn()
      }
    });
    const body = singleSourceMapBody();

    const response = await app.inject({
      method: "POST",
      url: "/v1/source-maps",
      headers: { ...body.headers, authorization: "Token shsmap_valid" },
      payload: body.payload
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_source_map_upload_token" });
    expect(verifyToken).not.toHaveBeenCalled();
    expect(uploadMap).not.toHaveBeenCalled();
  });

  it("returns unavailable when token verification is not wired", async () => {
    app = await appWithUpload({ sourceMapUploads: { uploadMap: vi.fn() } });
    const body = singleSourceMapBody();

    const response = await app.inject({
      method: "POST",
      url: "/v1/source-maps",
      headers: { ...body.headers, authorization: "Bearer shsmap_valid" },
      payload: body.payload
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "source_map_uploads_unavailable" });
  });

  it("returns unavailable when upload storage is not wired", async () => {
    app = await appWithUpload({
      sourceMapUploads: {
        verifyToken: vi.fn().mockResolvedValue({ id: "smtok_1", projectId: "prj_1", environmentId: "env_1" })
      }
    });
    const body = singleSourceMapBody();

    const response = await app.inject({
      method: "POST",
      url: "/v1/source-maps",
      headers: { ...body.headers, authorization: "Bearer shsmap_valid" },
      payload: body.payload
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "source_map_uploads_unavailable" });
  });

  it("maps invalid source map upload errors to bad request", async () => {
    app = await appWithUpload({
      sourceMapUploads: {
        verifyToken: vi.fn().mockResolvedValue({ id: "smtok_1", projectId: "prj_1", environmentId: "env_1" }),
        uploadMap: vi.fn().mockRejectedValue(new Error("invalid_source_map")),
        uploadBundle: vi.fn()
      }
    });
    const body = singleSourceMapBody({ content: "{}" });

    const response = await app.inject({
      method: "POST",
      url: "/v1/source-maps",
      headers: { ...body.headers, authorization: "Bearer shsmap_valid" },
      payload: body.payload
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_source_map_request" });
  });

  it("maps upload size errors to payload too large", async () => {
    app = await appWithUpload({
      sourceMapUploads: {
        verifyToken: vi.fn().mockResolvedValue({ id: "smtok_1", projectId: "prj_1", environmentId: "env_1" }),
        uploadMap: vi.fn().mockRejectedValue(new Error("source_map_upload_too_large")),
        uploadBundle: vi.fn()
      }
    });
    const body = singleSourceMapBody();

    const response = await app.inject({
      method: "POST",
      url: "/v1/source-maps",
      headers: { ...body.headers, authorization: "Bearer shsmap_valid" },
      payload: body.payload
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: "invalid_source_map_request" });
  });
});
