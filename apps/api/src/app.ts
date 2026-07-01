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
  type DeadLetterAdministrationDependencies,
  type MonitorAdministrationDependencies,
  type SourceMapUploadTokenAdministrationDependencies,
  type SourceMapAdministrationDependencies,
  type UserAdministrationDependencies
} from "./routes/admin.js";
import { registerAuthRoutes, type AuthDependencies } from "./routes/auth.js";
import { registerConsoleRoutes, type ConsoleRouteOptions } from "./routes/console.js";
import { registerDocsRoutes } from "./routes/docs.js";
import { registerHealthRoutes, type ReadinessCheck } from "./routes/health.js";
import { registerIdentifyRoutes, type IdentifyRouteDependencies } from "./routes/identify.js";
import { registerIngestionRoutes, type IngestionDependencies } from "./routes/ingestion.js";
import { registerMonitorRoutes, type MonitorRouteDependencies } from "./routes/monitors.js";
import { registerQueryRoutes, type QueryDependencies } from "./routes/query.js";
import { registerSdkDocsRoutes } from "./routes/sdk-docs.js";
import { registerSourceMapUploadRoutes, type SourceMapUploadRouteDependencies } from "./routes/source-map-uploads.js";
import { registerSystemRoutes, type SystemHealthDependencies } from "./routes/system.js";

export type BuildAppOptions = {
  readiness: ReadinessCheck;
  auth?: AuthDependencies;
  users?: UserAdministrationDependencies;
  adminResources?: AdminResourceDependencies;
  alerts?: AlertRouteDependencies & AlertAdministrationDependencies;
  monitors?: MonitorRouteDependencies & MonitorAdministrationDependencies;
  deadLetters?: DeadLetterAdministrationDependencies;
  sourceMaps?: SourceMapAdministrationDependencies & { maxUploadBytes?: number };
  sourceMapUploadTokens?: SourceMapUploadTokenAdministrationDependencies;
  sourceMapUploads?: SourceMapUploadRouteDependencies;
  createSourceMapUploadToken?: () => { secret: string; prefix: string };
  createHeartbeatSecret?: () => string;
  ingestion?: IngestionDependencies;
  identify?: IdentifyRouteDependencies;
  query?: QueryDependencies;
  system?: SystemHealthDependencies;
  apiKeyPepper?: string;
  hashApiKeySecret?: (secret: string) => Promise<string>;
  hashHeartbeatSecret?: (secret: string) => Promise<string>;
  googleOAuthEnabled?: boolean;
  nodeEnv?: string;
  console?: Omit<ConsoleRouteOptions, "browserCorsOrigins" | "googleOAuthEnabled">;
  corsOrigin?: string | string[];
  browserCorsOrigins?: string[];
  isBrowserCorsOriginAllowed?: (origin: string) => Promise<boolean>;
  rateLimit?: {
    max: number;
    timeWindow: number | string;
  };
};

const browserIngestionCorsPaths = new Set([
  "/v1/events",
  "/v1/errors",
  "/v1/breadcrumbs",
  "/v1/web-vitals",
  "/v1/llm",
  "/v1/traces",
  "/v1/spans",
  "/v1/identify/user",
  "/v1/identify/tenant"
]);
const browserIngestionCorsMethods = "POST, OPTIONS";
const browserIngestionCorsHeaders = "Authorization, Content-Type";

function requestPath(url: string): string {
  return url.split("?")[0] ?? url;
}

function isBrowserIngestionCorsPath(url: string): boolean {
  return browserIngestionCorsPaths.has(requestPath(url));
}

function appendVary(existing: unknown, value: string): string {
  if (typeof existing !== "string" || existing.length === 0) {
    return value;
  }

  const values = existing.split(",").map((entry) => entry.trim().toLowerCase());
  return values.includes(value.toLowerCase()) ? existing : `${existing}, ${value}`;
}

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
  const browserCorsOrigins = new Set(options.browserCorsOrigins ?? []);
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

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin !== "string" || !isBrowserIngestionCorsPath(request.url)) {
      return;
    }
    const allowed = browserCorsOrigins.has(origin) || (await options.isBrowserCorsOriginAllowed?.(origin));
    if (!allowed) {
      return;
    }

    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Access-Control-Allow-Methods", browserIngestionCorsMethods);
    reply.header("Access-Control-Allow-Headers", browserIngestionCorsHeaders);
    reply.header("Access-Control-Max-Age", "600");
    reply.header("Vary", appendVary(reply.getHeader("Vary"), "Origin"));

    if (request.method === "OPTIONS") {
      return reply.status(204).send();
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
  await app.register(rateLimit, options.rateLimit ?? { max: 1000, timeWindow: "1 minute" });

  registerRequestContext(app);
  await registerDocsRoutes(app);
  await registerSdkDocsRoutes(app);
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
    browserCorsOrigins: options.browserCorsOrigins ?? [],
    googleOAuthEnabled: options.googleOAuthEnabled ?? false
  });
  registerAdminRoutes(app, {
    auth: options.auth,
    users: options.users,
    adminResources: options.adminResources,
    alerts: options.alerts,
    monitors: options.monitors,
    deadLetters: options.deadLetters,
    sourceMaps: options.sourceMaps,
    sourceMapUploadTokens: options.sourceMapUploadTokens,
    createSourceMapUploadToken: options.createSourceMapUploadToken,
    createHeartbeatSecret: options.createHeartbeatSecret,
    apiKeyPepper: options.apiKeyPepper,
    hashApiKeySecret: options.hashApiKeySecret,
    hashHeartbeatSecret: options.hashHeartbeatSecret,
    nodeEnv: options.nodeEnv
  });
  registerAlertRoutes(app, {
    auth: options.auth,
    alerts: options.alerts
  });
  registerSourceMapUploadRoutes(app, options.sourceMapUploads);
  registerMonitorRoutes(app, options.monitors);
  registerIngestionRoutes(app, options.ingestion);
  registerIdentifyRoutes(app, options.identify);
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
