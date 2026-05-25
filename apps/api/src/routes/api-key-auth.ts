import type { FastifyReply, FastifyRequest } from "fastify";

export type ApiKeyScope = {
  projectId: string;
  environmentId: string;
};

export type ApiKeyVerifier = (secret: string) => Promise<ApiKeyScope | null | undefined>;

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
  verifyApiKey?: ApiKeyVerifier
): Promise<ApiKeyScope | undefined> {
  const secret = parseBearerToken(request);
  if (!secret) {
    reply.status(401).send({ error: "invalid_api_key" });
    return undefined;
  }

  if (!verifyApiKey) {
    reply.status(503).send({ error: "ingestion_unavailable" });
    return undefined;
  }

  let scope: ApiKeyScope | null | undefined;
  try {
    scope = await verifyApiKey(secret);
  } catch {
    reply.status(503).send({ error: "ingestion_unavailable" });
    return undefined;
  }

  if (!scope) {
    reply.status(401).send({ error: "invalid_api_key" });
    return undefined;
  }

  return scope;
}
