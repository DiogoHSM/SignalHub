import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SourceMapArtifactResponse, SourceMapBundleUploadInput, SourceMapUploadInput } from "./admin.js";
import { parseSourceMapUploadRequest, sourceMapUploadErrorStatus } from "./admin.js";
import { parseBearerToken } from "./bearer.js";

export type SourceMapUploadTokenScope = {
  id: string;
  projectId: string;
  environmentId: string;
};

export type SourceMapUploadRouteDependencies = {
  verifyToken?: (secret: string) => Promise<SourceMapUploadTokenScope | null | undefined>;
  uploadMap?: (input: SourceMapUploadInput) => Promise<SourceMapArtifactResponse[]>;
  uploadBundle?: (input: SourceMapBundleUploadInput) => Promise<SourceMapArtifactResponse[]>;
};

async function requireUploadToken(
  request: FastifyRequest,
  reply: FastifyReply,
  sourceMapUploads: SourceMapUploadRouteDependencies | undefined
): Promise<SourceMapUploadTokenScope | undefined> {
  const secret = parseBearerToken(request);
  if (!secret) {
    reply.status(401).send({ error: "invalid_source_map_upload_token" });
    return undefined;
  }

  if (!sourceMapUploads?.verifyToken) {
    reply.status(503).send({ error: "source_map_uploads_unavailable" });
    return undefined;
  }

  let scope: SourceMapUploadTokenScope | null | undefined;
  try {
    scope = await sourceMapUploads.verifyToken(secret);
  } catch {
    reply.status(503).send({ error: "source_map_uploads_unavailable" });
    return undefined;
  }

  if (!scope) {
    reply.status(401).send({ error: "invalid_source_map_upload_token" });
    return undefined;
  }

  return scope;
}

function redactArtifact(artifact: SourceMapArtifactResponse) {
  return {
    id: artifact.id,
    projectId: artifact.projectId,
    environmentId: artifact.environmentId,
    release: artifact.release,
    minifiedFile: artifact.minifiedFile,
    originalFilename: artifact.originalFilename,
    byteSize: artifact.byteSize,
    sha256: artifact.sha256,
    createdAt: artifact.createdAt
  };
}

export function registerSourceMapUploadRoutes(
  app: FastifyInstance,
  sourceMapUploads?: SourceMapUploadRouteDependencies
): void {
  app.post("/v1/source-maps", async (request, reply) => {
    const token = await requireUploadToken(request, reply, sourceMapUploads);
    if (!token) {
      return reply;
    }

    let input: SourceMapUploadInput | SourceMapBundleUploadInput | undefined;
    try {
      input = await parseSourceMapUploadRequest(request, { uploadedByTokenId: token.id });
    } catch (error) {
      const status = sourceMapUploadErrorStatus(error);
      return reply.status(status ?? 400).send({ error: "invalid_source_map_request" });
    }

    if (!input) {
      return reply.status(400).send({ error: "invalid_source_map_request" });
    }

    if (input.projectId !== token.projectId || input.environmentId !== token.environmentId) {
      return reply.status(403).send({ error: "source_map_upload_scope_mismatch" });
    }

    try {
      if ("minifiedFile" in input) {
        if (!sourceMapUploads?.uploadMap) {
          return reply.status(503).send({ error: "source_map_uploads_unavailable" });
        }
        const artifacts = await sourceMapUploads.uploadMap(input);
        return reply.send({ artifacts: artifacts.map(redactArtifact) });
      }

      if (!sourceMapUploads?.uploadBundle) {
        return reply.status(503).send({ error: "source_map_uploads_unavailable" });
      }
      const artifacts = await sourceMapUploads.uploadBundle(input);
      return reply.send({ artifacts: artifacts.map(redactArtifact) });
    } catch (error) {
      const status = sourceMapUploadErrorStatus(error);
      if (status) {
        return reply.status(status).send({ error: "invalid_source_map_request" });
      }
      return reply.status(503).send({ error: "source_map_uploads_unavailable" });
    }
  });
}
