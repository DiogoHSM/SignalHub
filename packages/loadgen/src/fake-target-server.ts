import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

export type FakeTargetServerOptions = {
  controlToken: string;
};

const controlParamsSchema = z.object({ key: z.string().trim().min(1) });
const controlBodySchema = z.object({ state: z.enum(["up", "down"]) });

function parseBearerToken(header: string | undefined): string | undefined {
  const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  return match?.[1]?.trim();
}

export function createFakeTargetServer(options: FakeTargetServerOptions): FastifyInstance {
  const app = Fastify();
  const state = new Map<string, "up" | "down">();

  app.get("/t/:key", async (request, reply) => {
    const params = controlParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_key" });
    }

    const current = state.get(params.data.key) ?? "up";
    return reply.status(current === "up" ? 200 : 503).send({ ok: current === "up" });
  });

  app.post("/control/:key", async (request, reply) => {
    const token = parseBearerToken(request.headers.authorization);
    if (token !== options.controlToken) {
      return reply.status(401).send({ error: "invalid_control_token" });
    }

    const params = controlParamsSchema.safeParse(request.params);
    const body = controlBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "invalid_request" });
    }

    state.set(params.data.key, body.data.state);
    return reply.status(200).send({ key: params.data.key, state: body.data.state });
  });

  return app;
}
