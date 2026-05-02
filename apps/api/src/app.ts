import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { registerHealthRoutes, type ReadinessCheck } from "./routes/health.js";

export type BuildAppOptions = {
  readiness: ReadinessCheck;
};

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });

  registerHealthRoutes(app, options.readiness);

  return app;
}
