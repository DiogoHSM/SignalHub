import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { setCurrentUser } from "../plugins/request-context.js";
import type { AuthDependencies } from "./auth.js";

export type SystemStatus = "healthy" | "degraded" | "unhealthy";

export type SystemHealthDependencies = {
  getHealth?: () => Promise<unknown>;
};

export function registerSystemRoutes(
  app: FastifyInstance,
  options: { auth?: AuthDependencies; system?: SystemHealthDependencies }
): void {
  app.get("/system/health", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await options.auth?.findSessionUser(request as Parameters<AuthDependencies["findSessionUser"]>[0]);
    if (!user) {
      setCurrentUser(request, null);
      return reply.code(401).send({ error: "unauthorized" });
    }
    setCurrentUser(request, user);

    if (!options.system?.getHealth) {
      return reply.code(501).send({ error: "system_health_unavailable" });
    }

    try {
      return { data: await options.system.getHealth() };
    } catch {
      return reply.code(503).send({ error: "system_health_unavailable" });
    }
  });
}
