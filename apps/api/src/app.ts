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
  type ReadTokenAdministrationDependencies,
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
import { registerLandingRoutes, type LandingRouteOptions } from "./routes/landing.js";
import { registerMonitorRoutes, type MonitorRouteDependencies } from "./routes/monitors.js";
import { registerQueryRoutes, type QueryDependencies, type QueryRouteOptions } from "./routes/query.js";
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
  readTokens?: ReadTokenAdministrationDependencies;
  createReadToken?: () => { secret: string; prefix: string };
  verifyReadToken?: QueryRouteOptions["verifyReadToken"];
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
  landing?: Omit<LandingRouteOptions, "consoleEnabled">;
  corsOrigin?: string | string[];
  browserCorsOrigins?: string[];
  isBrowserCorsOriginAllowed?: (origin: string) => Promise<boolean>;
  rateLimitRedis?: unknown;
  trustProxy?: string[];
  rateLimit?: {
    max: number;
    timeWindow: number | string;
  };
  loginSourceRateLimit?: {
    max: number;
    timeWindow: number;
  };
};

const browserIngestionCorsPaths = new Set([
  "/v1/events",
  "/v1/errors",
  "/v1/breadcrumbs",
  "/v1/web-vitals",
  "/v1/clicks",
  "/v1/replays",
  "/v1/llm",
  "/v1/traces",
  "/v1/spans",
  "/v1/profiles",
  "/v1/surveys/responses",
  "/v1/feedback",
  "/v1/identify/user",
  "/v1/identify/tenant"
]);
const browserIngestionCorsMethods = "POST, OPTIONS";
const browserIngestionCorsHeaders = "Authorization, Content-Type";
const browserOriginCacheTtlMs = 60_000;
const browserOriginCacheMaxEntries = 1_000;

type BrowserOriginCacheOptions = {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
};

type BrowserOriginCacheEntry = {
  allowed: boolean;
  expiresAt: number;
};

function normalizeConfiguredBrowserOrigin(origin: string): string | undefined {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function parseSerializedBrowserOrigin(origin: string): string | undefined {
  if (!/^https?:\/\/[^\s/?#\\@]+$/.test(origin)) {
    return undefined;
  }

  try {
    const parsed = new URL(origin);
    if (parsed.username || parsed.password || parsed.hostname.endsWith(".") || parsed.origin !== origin) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export class BrowserOriginCache {
  private readonly entries = new Map<string, BrowserOriginCacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private mutationRevision = 0;

  constructor(
    private readonly lookup: (origin: string) => Promise<boolean>,
    options: BrowserOriginCacheOptions = {}
  ) {
    this.ttlMs = options.ttlMs ?? browserOriginCacheTtlMs;
    this.maxEntries = options.maxEntries ?? browserOriginCacheMaxEntries;
    this.now = options.now ?? Date.now;
  }

  async isAllowed(origin: string): Promise<boolean> {
    const normalizedOrigin = parseSerializedBrowserOrigin(origin);
    if (!normalizedOrigin) {
      return false;
    }

    const cached = this.entries.get(normalizedOrigin);
    if (cached && cached.expiresAt > this.now()) {
      return cached.allowed;
    }
    if (cached) {
      this.entries.delete(normalizedOrigin);
    }

    const lookupRevision = this.mutationRevision;
    const allowed = await this.lookup(normalizedOrigin);
    if (lookupRevision !== this.mutationRevision) {
      const updated = this.entries.get(normalizedOrigin);
      return updated !== undefined && updated.expiresAt > this.now() ? updated.allowed : false;
    }
    this.set(normalizedOrigin, allowed);
    return allowed;
  }

  allow(origin: string): void {
    const normalizedOrigin = parseSerializedBrowserOrigin(origin);
    if (normalizedOrigin) {
      this.mutationRevision += 1;
      this.set(normalizedOrigin, true);
    }
  }

  invalidate(origin: string): void {
    const normalizedOrigin = parseSerializedBrowserOrigin(origin);
    if (normalizedOrigin) {
      this.mutationRevision += 1;
      this.entries.delete(normalizedOrigin);
    }
  }

  clear(): void {
    this.mutationRevision += 1;
    this.entries.clear();
  }

  private set(origin: string, allowed: boolean): void {
    this.entries.delete(origin);
    while (this.entries.size >= this.maxEntries) {
      const oldestOrigin = this.entries.keys().next().value as string | undefined;
      if (!oldestOrigin) {
        break;
      }
      this.entries.delete(oldestOrigin);
    }
    this.entries.set(origin, { allowed, expiresAt: this.now() + this.ttlMs });
  }
}

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
  const browserCorsOrigins = new Set(
    (options.browserCorsOrigins ?? [])
      .map(normalizeConfiguredBrowserOrigin)
      .filter((origin): origin is string => origin !== undefined)
  );
  const browserOriginCache = new BrowserOriginCache(
    options.isBrowserCorsOriginAllowed ?? (async () => false)
  );
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
  if (options.trustProxy && options.trustProxy.length > 0) {
    fastifyOptions.trustProxy = options.trustProxy;
  }
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

  await app.register(rateLimit, {
    ...(options.rateLimit ?? { max: 1000, timeWindow: "1 minute" }),
    hook: "onRequest",
    skipOnError: false,
    ipv6Subnet: 64,
    ...(options.rateLimitRedis ? { redis: options.rateLimitRedis } : {})
  });

  app.addHook("preParsing", async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin !== "string" || !isBrowserIngestionCorsPath(request.url)) {
      return;
    }
    const normalizedOrigin = parseSerializedBrowserOrigin(origin);
    if (!normalizedOrigin) {
      return;
    }
    const allowed = browserCorsOrigins.has(normalizedOrigin) || (await browserOriginCache.isAllowed(normalizedOrigin));
    if (!allowed) {
      return;
    }

    reply.header("Access-Control-Allow-Origin", normalizedOrigin);
    reply.header("Access-Control-Allow-Methods", browserIngestionCorsMethods);
    reply.header("Access-Control-Allow-Headers", browserIngestionCorsHeaders);
    reply.header("Access-Control-Max-Age", "600");
    reply.header("Vary", appendVary(reply.getHeader("Vary"), "Origin"));

    if (request.method === "OPTIONS") {
      return reply.status(204).send();
    }
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
  registerRequestContext(app);
  await registerDocsRoutes(app);
  await registerSdkDocsRoutes(app);
  registerHealthRoutes(app, options.readiness);
  registerAuthRoutes(app, {
    auth: options.auth,
    googleOAuthEnabled: options.googleOAuthEnabled,
    nodeEnv,
    loginSourceRateLimit: options.loginSourceRateLimit
  });
  await registerConsoleRoutes(app, {
    enabled: options.console?.enabled ?? false,
    apiBasePath: options.console?.apiBasePath ?? "/",
    apiEndpoint: options.console?.apiEndpoint ?? "",
    assetsDir: options.console?.assetsDir,
    browserCorsOrigins: options.browserCorsOrigins ?? [],
    googleOAuthEnabled: options.googleOAuthEnabled ?? false
  });
  registerLandingRoutes(app, {
    landingHosts: options.landing?.landingHosts ?? [],
    consoleEnabled: options.console?.enabled ?? false
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
    readTokens: options.readTokens,
    createReadToken: options.createReadToken,
    createHeartbeatSecret: options.createHeartbeatSecret,
    apiKeyPepper: options.apiKeyPepper,
    hashApiKeySecret: options.hashApiKeySecret,
    hashHeartbeatSecret: options.hashHeartbeatSecret,
    browserOriginCache,
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
    query: options.query,
    verifyReadToken: options.verifyReadToken
  });
  registerSystemRoutes(app, {
    auth: options.auth,
    system: options.system
  });

  return app;
}
