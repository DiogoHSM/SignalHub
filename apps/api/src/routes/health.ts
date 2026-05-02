import type { FastifyInstance } from "fastify";

export type ReadinessCheck = () => Promise<{ postgres: boolean; redis: boolean }>;

export function registerHealthRoutes(app: FastifyInstance, readiness: ReadinessCheck): void {
  app.get("/health", async () => ({ ok: true }));

  app.get("/ready", async (_request, reply) => {
    const checks = await readiness();
    const ok = checks.postgres && checks.redis;

    return reply.status(ok ? 200 : 503).send({ ok, checks });
  });
}
