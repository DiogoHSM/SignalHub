import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { registerRequestContext } from "./plugins/request-context.js";
import { registerAdminRoutes, type UserAdministrationDependencies } from "./routes/admin.js";
import { registerAuthRoutes, type AuthDependencies } from "./routes/auth.js";
import { registerHealthRoutes, type ReadinessCheck } from "./routes/health.js";

export type BuildAppOptions = {
  readiness: ReadinessCheck;
  auth?: AuthDependencies;
  users?: UserAdministrationDependencies;
  googleOAuthEnabled?: boolean;
};

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });

  registerRequestContext(app);
  registerHealthRoutes(app, options.readiness);
  registerAuthRoutes(app, {
    auth: options.auth,
    googleOAuthEnabled: options.googleOAuthEnabled
  });
  registerAdminRoutes(app, {
    auth: options.auth,
    users: options.users
  });

  return app;
}
