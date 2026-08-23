import type { FastifyRequest } from "fastify";

export function parseBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string") {
    return undefined;
  }

  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1];
}
