import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { registerRequestContext } from "./plugins/request-context.js";
import {
  registerAdminRoutes,
  type AdminResourceDependencies,
  type UserAdministrationDependencies
} from "./routes/admin.js";
import { registerAuthRoutes, type AuthDependencies } from "./routes/auth.js";
import { registerConsoleRoutes, type ConsoleRouteOptions } from "./routes/console.js";
import { registerHealthRoutes, type ReadinessCheck } from "./routes/health.js";
import { registerIngestionRoutes, type IngestionDependencies } from "./routes/ingestion.js";
import { registerQueryRoutes, type QueryDependencies } from "./routes/query.js";

export type BuildAppOptions = {
  readiness: ReadinessCheck;
  auth?: AuthDependencies;
  users?: UserAdministrationDependencies;
  adminResources?: AdminResourceDependencies;
  ingestion?: IngestionDependencies;
  query?: QueryDependencies;
  apiKeyPepper?: string;
  hashApiKeySecret?: (secret: string) => Promise<string>;
  googleOAuthEnabled?: boolean;
  console?: Omit<ConsoleRouteOptions, "googleOAuthEnabled">;
  corsOrigin?: string | string[];
};

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: options.corsOrigin ?? false,
    credentials: options.corsOrigin !== undefined
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });

  registerRequestContext(app);
  registerHealthRoutes(app, options.readiness);
  registerAuthRoutes(app, {
    auth: options.auth,
    googleOAuthEnabled: options.googleOAuthEnabled
  });
  await registerConsoleRoutes(app, {
    enabled: options.console?.enabled ?? false,
    apiBasePath: options.console?.apiBasePath ?? "/",
    assetsDir: options.console?.assetsDir,
    googleOAuthEnabled: options.googleOAuthEnabled ?? false
  });
  registerAdminRoutes(app, {
    auth: options.auth,
    users: options.users,
    adminResources: options.adminResources,
    apiKeyPepper: options.apiKeyPepper,
    hashApiKeySecret: options.hashApiKeySecret
  });
  registerIngestionRoutes(app, options.ingestion);
  registerQueryRoutes(app, {
    auth: options.auth,
    query: options.query
  });

  return app;
}
