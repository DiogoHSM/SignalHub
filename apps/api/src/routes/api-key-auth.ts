import type { FastifyReply, FastifyRequest } from "fastify";
import type { ApiKeyCapability } from "@sigmon/db/repositories/admin.js";

export type ApiKeyScope = {
  projectId: string;
  environmentId: string;
  capability: ApiKeyCapability;
};

export type ApiKeyVerifier = (secret: string) => Promise<ApiKeyScope | null | undefined>;
export type ApiKeyAuthOptions = {
  includeHints?: boolean;
};

const invalidApiKeyResponse = {
  error: "invalid_api_key",
  hint: "Send a project/environment ingestion key as Authorization: Bearer <key>. Browser calls must use a browser-scoped key for the same environment."
};

const ingestionUnavailableResponse = {
  error: "ingestion_unavailable",
  hint: "Sigmon accepted the request path but could not enqueue telemetry. Check Redis connectivity and worker/scheduler health."
};

export function parseBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string") {
    return undefined;
  }

  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1];
}

export async function requireApiKeyScope(
  request: FastifyRequest,
  reply: FastifyReply,
  verifyApiKey?: ApiKeyVerifier,
  options: ApiKeyAuthOptions = {}
): Promise<ApiKeyScope | undefined> {
  const invalidApiKey = options.includeHints ? invalidApiKeyResponse : { error: "invalid_api_key" };
  const ingestionUnavailable = options.includeHints
    ? ingestionUnavailableResponse
    : { error: "ingestion_unavailable" };
  const secret = parseBearerToken(request);
  if (!secret) {
    reply.status(401).send(invalidApiKey);
    return undefined;
  }

  if (!verifyApiKey) {
    reply.status(503).send(ingestionUnavailable);
    return undefined;
  }

  let scope: ApiKeyScope | null | undefined;
  try {
    scope = await verifyApiKey(secret);
  } catch {
    reply.status(503).send(ingestionUnavailable);
    return undefined;
  }

  if (!scope) {
    reply.status(401).send(invalidApiKey);
    return undefined;
  }

  return scope;
}
