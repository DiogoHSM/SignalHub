import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { redactLogFields } from "@sigmon/config";
import Fastify, { type FastifyError, type FastifyHttpOptions } from "fastify";
import type { Server } from "node:http";
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
import { registerSourceMapUploadRoutes, type SourceMapUploadRouteDependencies } from "./routes/source-map-uploads.js";
import { registerSystemRoutes, type SystemHealthDependencies } from "./routes/system.js";

export type BuildAppOptions = {
  readiness: ReadinessCheck;
  auth?: AuthDependencies;
  users?: UserAdministrationDependencies;
  adminResources?: AdminResourceDependencies;
  alerts?: AlertRouteDependencies & AlertAdministrationDependencies;
  sourceMaps?: SourceMapAdministrationDependencies & { maxUploadBytes?: number };
  sourceMapUploadTokens?: SourceMapUploadTokenAdministrationDependencies;
  sourceMapUploads?: SourceMapUploadRouteDependencies;
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

function serializeFastifyError(error: FastifyError): { type: string; message: string; stack: string; [key: string]: unknown } {
  const redacted = redactLogFields(error) as Record<string, unknown>;

  return {
    ...redacted,
    type: typeof redacted.name === "string" ? redacted.name : error.name,
    message: typeof redacted.message === "string" ? redacted.message : "",
    stack: typeof redacted.stack === "string" ? redacted.stack : ""
  };
}

function getErrorStatusCode(error: unknown): number {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return 500;
  }

  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" && statusCode >= 400 ? statusCode : 500;
}

export async function buildApp(options: BuildAppOptions) {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const fastifyOptions: FastifyHttpOptions<Server> = {
    logger: {
      level: nodeEnv === "test" ? "silent" : "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers['x-api-key']",
          "req.headers['sigmon-source-map-token']",
          "res.headers['set-cookie']"
        ],
        censor: "[REDACTED]"
      },
      serializers: {
        err: serializeFastifyError
      }
    }
  };
  const app = Fastify(fastifyOptions);

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"
    );
    if (nodeEnv === "production") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Unhandled API error");
    return reply.status(getErrorStatusCode(error)).send({
      error: "internal_server_error"
    });
  });

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
    googleOAuthEnabled: options.googleOAuthEnabled,
    nodeEnv
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
  registerSourceMapUploadRoutes(app, options.sourceMapUploads);
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
