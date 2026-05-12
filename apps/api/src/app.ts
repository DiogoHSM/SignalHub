import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { registerRequestContext } from "./plugins/request-context.js";
import { registerAlertRoutes, type AlertRouteDependencies } from "./routes/alerts.js";
import {
  registerAdminRoutes,
  type AlertAdministrationDependencies,
  type AdminResourceDependencies,
  type SourceMapUploadTokenAdministrationDependencies,
  type SourceMapAdministrationDependencies,
  type UserAdministrationDependencies
} from "./routes/admin.js";
import { registerAuthRoutes, type AuthDependencies } from "./routes/auth.js";
import { registerConsoleRoutes, type ConsoleRouteOptions } from "./routes/console.js";
import { registerHealthRoutes, type ReadinessCheck } from "./routes/health.js";
import { registerIngestionRoutes, type IngestionDependencies } from "./routes/ingestion.js";
import { registerQueryRoutes, type QueryDependencies } from "./routes/query.js";
import { registerSystemRoutes, type SystemHealthDependencies } from "./routes/system.js";

export type BuildAppOptions = {
  readiness: ReadinessCheck;
  auth?: AuthDependencies;
  users?: UserAdministrationDependencies;
  adminResources?: AdminResourceDependencies;
  alerts?: AlertRouteDependencies & AlertAdministrationDependencies;
  sourceMaps?: SourceMapAdministrationDependencies & { maxUploadBytes?: number };
  sourceMapUploadTokens?: SourceMapUploadTokenAdministrationDependencies;
  createSourceMapUploadToken?: () => { secret: string; prefix: string };
  ingestion?: IngestionDependencies;
  query?: QueryDependencies;
  system?: SystemHealthDependencies;
  apiKeyPepper?: string;
  hashApiKeySecret?: (secret: string) => Promise<string>;
  googleOAuthEnabled?: boolean;
  nodeEnv?: string;
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
  await app.register(multipart, {
    limits: {
      fileSize: options.sourceMaps?.maxUploadBytes ?? 50 * 1024 * 1024,
      files: 1,
      fields: 4,
      parts: 6
    }
  });
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
    apiEndpoint: options.console?.apiEndpoint ?? "",
    assetsDir: options.console?.assetsDir,
    googleOAuthEnabled: options.googleOAuthEnabled ?? false
  });
  registerAdminRoutes(app, {
    auth: options.auth,
    users: options.users,
    adminResources: options.adminResources,
    alerts: options.alerts,
    sourceMaps: options.sourceMaps,
    sourceMapUploadTokens: options.sourceMapUploadTokens,
    createSourceMapUploadToken: options.createSourceMapUploadToken,
    apiKeyPepper: options.apiKeyPepper,
    hashApiKeySecret: options.hashApiKeySecret,
    nodeEnv: options.nodeEnv
  });
  registerAlertRoutes(app, {
    auth: options.auth,
    alerts: options.alerts
  });
  registerIngestionRoutes(app, options.ingestion);
  registerQueryRoutes(app, {
    auth: options.auth,
    query: options.query
  });
  registerSystemRoutes(app, {
    auth: options.auth,
    system: options.system
  });

  return app;
}
