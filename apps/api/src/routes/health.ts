import type { FastifyInstance } from "fastify";

export type ReadinessCheck = () => Promise<{ postgres: boolean; redis: boolean }>;

export type DeployedVersionResolver = () => string | null;

// Coolify injects SOURCE_COMMIT (full SHA) into every container it builds, so the
// running commit is readable without a build arg or Dockerfile change. Reporting it
// here is what lets a deploy be verified by effect: a 200 alone cannot tell a fresh
// container apart from an old one that simply stayed up.
function resolveDeployedVersion(): string | null {
  const value = process.env.SOURCE_COMMIT?.trim();
  return value === undefined || value === "" ? null : value;
}

export function registerHealthRoutes(
  app: FastifyInstance,
  readiness: ReadinessCheck,
  deployedVersion: DeployedVersionResolver = resolveDeployedVersion
): void {
  app.get("/health", async () => ({ ok: true, version: deployedVersion() }));

  app.get("/ready", async (_request, reply) => {
    const checks = await readiness();
    const ok = checks.postgres && checks.redis;

    return reply.status(ok ? 200 : 503).send({ ok, checks });
  });
}
