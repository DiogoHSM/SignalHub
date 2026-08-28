import { z } from "zod";

export * from "./logger.js";
export * from "./network-security.js";

const emptyStringToUndefined = (value: unknown) => (value === "" ? undefined : value);
const optionalEnvString = z.preprocess(emptyStringToUndefined, z.string().optional());
const optionalTrimmedEnvString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);
const optionalEnvUrl = z.preprocess(emptyStringToUndefined, z.string().url().optional());
const optionalPositiveInteger = (defaultValue: number) =>
  z.preprocess(emptyStringToUndefined, z.coerce.number().int().min(1).default(defaultValue));
const optionalNonNegativeInteger = (defaultValue: number) =>
  z.preprocess(emptyStringToUndefined, z.coerce.number().int().min(0).default(defaultValue));

const productionPlaceholders = {
  SESSION_SECRET: "change-me-to-a-long-random-secret",
  API_KEY_PEPPER: "change-me-to-a-long-random-pepper",
  BOOTSTRAP_ADMIN_PASSWORD: "change-me-admin-password-32-chars-min"
} as const;

const localOnlyPostgresPassword = "sigmon-local-only-change-me";

function requireNoProductionPlaceholder(name: keyof typeof productionPlaceholders, value: string, nodeEnv: string): void {
  if (nodeEnv === "production" && value === productionPlaceholders[name]) {
    throw new Error(`${name} must be replaced for production`);
  }
}

function decodeUrlComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function requireProductionDatabasePasswordIsNotPlaceholder(databaseUrl: string, nodeEnv: string): void {
  if (nodeEnv !== "production") return;

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return;
  }

  const decodedPassword = decodeUrlComponent(parsed.password);
  if (parsed.password === localOnlyPostgresPassword || decodedPassword === localOnlyPostgresPassword) {
    throw new Error("DATABASE_URL uses the local-only Postgres password placeholder");
  }
}

function parseHostList(value: string | undefined, fallback: string[]): string[] {
  if (!value) {
    return fallback;
  }

  const hosts = value
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  for (const host of hosts) {
    if (host.includes("/") || host.includes(":")) {
      throw new Error(`LANDING_HOSTS entries must be bare hostnames without scheme or port: ${host}`);
    }
  }

  return hosts;
}

function parseOriginList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        throw new Error(`BROWSER_CORS_ORIGINS contains an invalid origin: ${origin}`);
      }
    });
}

const rawConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WORKER_ROLE: z.enum(["all", "queue", "scheduler"]).default("all"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string(),
  API_KEY_PEPPER: z.string(),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string(),
  GOOGLE_OAUTH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  GOOGLE_CLIENT_ID: optionalEnvString,
  GOOGLE_CLIENT_SECRET: optionalEnvString,
  GOOGLE_REDIRECT_URI: optionalEnvUrl,
  CONSOLE_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  SIGMON_PUBLIC_ENDPOINT: optionalEnvUrl,
  LANDING_HOSTS: optionalEnvString,
  BROWSER_CORS_ORIGINS: optionalEnvString,
  RETENTION_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  RETENTION_INTERVAL_MINUTES: optionalPositiveInteger(60),
  RETENTION_BATCH_SIZE: optionalPositiveInteger(1000),
  RETENTION_EVENTS_DAYS: optionalPositiveInteger(90),
  RETENTION_ERRORS_DAYS: optionalPositiveInteger(180),
  RETENTION_TRACES_DAYS: optionalPositiveInteger(90),
  RETENTION_SPANS_DAYS: optionalPositiveInteger(90),
  RETENTION_LLM_CALLS_DAYS: optionalPositiveInteger(180),
  RETENTION_PROFILES_DAYS: optionalPositiveInteger(30),
  RETENTION_BREADCRUMBS_DAYS: optionalPositiveInteger(30),
  RETENTION_DEAD_LETTER_JOBS_DAYS: optionalPositiveInteger(30),
  EVENT_ROLLUPS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  EVENT_ROLLUPS_INTERVAL_MINUTES: optionalPositiveInteger(60),
  EVENT_ROLLUPS_LOOKBACK_DAYS: optionalPositiveInteger(400),
  ALERTS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  ALERTS_INTERVAL_MINUTES: optionalPositiveInteger(1),
  ALERTS_WEBHOOK_TIMEOUT_MS: optionalPositiveInteger(5000),
  MONITORS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  MONITORS_INTERVAL_MINUTES: optionalPositiveInteger(1),
  MONITORS_HTTP_TIMEOUT_MS: optionalPositiveInteger(5000),
  MONITORS_MAX_CONCURRENCY: optionalPositiveInteger(5),
  WAREHOUSE_EXPORTS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  WAREHOUSE_EXPORTS_INTERVAL_MINUTES: optionalPositiveInteger(15),
  SMTP_HOST: optionalTrimmedEnvString,
  SMTP_PORT: optionalPositiveInteger(587),
  SMTP_USERNAME: optionalTrimmedEnvString,
  SMTP_PASSWORD: optionalTrimmedEnvString,
  SMTP_FROM: optionalTrimmedEnvString,
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BACKUPS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  BACKUPS_INTERVAL_HOURS: optionalPositiveInteger(24),
  BACKUPS_LOCAL_DIR: z.preprocess(emptyStringToUndefined, z.string().min(1).default("/var/lib/sigmon/backups")),
  BACKUPS_RETENTION_DAYS: optionalPositiveInteger(14),
  BACKUPS_S3_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BACKUPS_S3_ENDPOINT: optionalEnvUrl,
  BACKUPS_S3_REGION: z.preprocess(emptyStringToUndefined, z.string().default("auto")),
  BACKUPS_S3_BUCKET: optionalEnvString,
  BACKUPS_S3_ACCESS_KEY_ID: optionalEnvString,
  BACKUPS_S3_SECRET_ACCESS_KEY: optionalEnvString,
  BACKUPS_S3_PREFIX: z.preprocess(emptyStringToUndefined, z.string().default("sigmon")),
  SOURCE_MAPS_LOCAL_DIR: z.preprocess(
    emptyStringToUndefined,
    z.string().min(1).default("/var/lib/sigmon/source-maps")
  ),
  SOURCE_MAPS_MAX_UPLOAD_MB: optionalPositiveInteger(50),
  SOURCE_MAPS_RETENTION_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SOURCE_MAPS_RETENTION_DAYS: optionalPositiveInteger(180),
  SOURCE_MAPS_RETENTION_BATCH_SIZE: optionalPositiveInteger(100),
  SYSTEM_HEALTH_HISTORY_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SYSTEM_HEALTH_SAMPLE_INTERVAL_MINUTES: optionalPositiveInteger(5),
  SYSTEM_HEALTH_HISTORY_RETENTION_HOURS: optionalPositiveInteger(48),
  // PER-449: statement_timeout (ms) for the API's request-serving Postgres pool. 0 disables it.
  // Migrations run on a separate, timeout-free pool (see apps/api/src/main.ts) so a slow one-time
  // migration on a large table can't be killed by this value.
  DB_STATEMENT_TIMEOUT_MS: optionalNonNegativeInteger(15_000),
  // The worker runs long-lived jobs (rollups, retention, backups, source-map cleanup) that can
  // legitimately take longer than an API read route should ever take, so its default is disabled
  // (0). Operators who want a safety net on the worker pool can opt in explicitly.
  DB_WORKER_STATEMENT_TIMEOUT_MS: optionalNonNegativeInteger(0),
  // PER-449: cap on distinct actors allowed into the event funnel chain (see
  // packages/db/src/repositories/telemetry-query.ts, assertFunnelScopeWithinLimit). 0 disables it.
  FUNNEL_MAX_ACTORS: optionalNonNegativeInteger(50_000)
});

export type AppConfig = ReturnType<typeof loadConfig>;

function requireStrongSecret(name: string, value: string, nodeEnv: string): void {
  if (nodeEnv !== "test" && value.length < 32) {
    throw new Error(`${name} must be at least 32 characters`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = rawConfigSchema.parse(env);

  requireStrongSecret("SESSION_SECRET", parsed.SESSION_SECRET, parsed.NODE_ENV);
  requireStrongSecret("API_KEY_PEPPER", parsed.API_KEY_PEPPER, parsed.NODE_ENV);
  requireStrongSecret("BOOTSTRAP_ADMIN_PASSWORD", parsed.BOOTSTRAP_ADMIN_PASSWORD, parsed.NODE_ENV);
  requireNoProductionPlaceholder("SESSION_SECRET", parsed.SESSION_SECRET, parsed.NODE_ENV);
  requireNoProductionPlaceholder("API_KEY_PEPPER", parsed.API_KEY_PEPPER, parsed.NODE_ENV);
  requireNoProductionPlaceholder("BOOTSTRAP_ADMIN_PASSWORD", parsed.BOOTSTRAP_ADMIN_PASSWORD, parsed.NODE_ENV);
  requireProductionDatabasePasswordIsNotPlaceholder(parsed.DATABASE_URL, parsed.NODE_ENV);

  if (parsed.GOOGLE_OAUTH_ENABLED) {
    if (!parsed.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID is required when Google OAuth is enabled");
    if (!parsed.GOOGLE_CLIENT_SECRET) throw new Error("GOOGLE_CLIENT_SECRET is required when Google OAuth is enabled");
    if (!parsed.GOOGLE_REDIRECT_URI) throw new Error("GOOGLE_REDIRECT_URI is required when Google OAuth is enabled");
  }

  if (parsed.BACKUPS_S3_ENABLED) {
    if (!parsed.BACKUPS_S3_ENDPOINT) throw new Error("BACKUPS_S3_ENDPOINT is required when backup S3 upload is enabled");
    if (!parsed.BACKUPS_S3_BUCKET) throw new Error("BACKUPS_S3_BUCKET is required when backup S3 upload is enabled");
    if (!parsed.BACKUPS_S3_ACCESS_KEY_ID) {
      throw new Error("BACKUPS_S3_ACCESS_KEY_ID is required when backup S3 upload is enabled");
    }
    if (!parsed.BACKUPS_S3_SECRET_ACCESS_KEY) {
      throw new Error("BACKUPS_S3_SECRET_ACCESS_KEY is required when backup S3 upload is enabled");
    }
  }

  const smtpConfigured = Boolean(
    parsed.SMTP_HOST ||
      parsed.SMTP_USERNAME ||
      parsed.SMTP_PASSWORD ||
      parsed.SMTP_FROM ||
      (env.SMTP_PORT !== undefined && parsed.SMTP_PORT !== 587) ||
      (env.SMTP_SECURE !== undefined && parsed.SMTP_SECURE !== false)
  );
  if (smtpConfigured) {
    if (!parsed.SMTP_HOST) throw new Error("SMTP_HOST is required when SMTP email is enabled");
    if (!parsed.SMTP_USERNAME) throw new Error("SMTP_USERNAME is required when SMTP email is enabled");
    if (!parsed.SMTP_PASSWORD) throw new Error("SMTP_PASSWORD is required when SMTP email is enabled");
    if (!parsed.SMTP_FROM) throw new Error("SMTP_FROM is required when SMTP email is enabled");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    worker: {
      role: parsed.WORKER_ROLE
    },
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    sessionSecret: parsed.SESSION_SECRET,
    apiKeyPepper: parsed.API_KEY_PEPPER,
    bootstrapAdmin: {
      email: parsed.BOOTSTRAP_ADMIN_EMAIL,
      password: parsed.BOOTSTRAP_ADMIN_PASSWORD
    },
    googleOAuth: {
      enabled: parsed.GOOGLE_OAUTH_ENABLED,
      clientId: parsed.GOOGLE_CLIENT_ID ?? "",
      clientSecret: parsed.GOOGLE_CLIENT_SECRET ?? "",
      redirectUri: parsed.GOOGLE_REDIRECT_URI ?? ""
    },
    console: {
      enabled: parsed.CONSOLE_ENABLED ?? (parsed.NODE_ENV === "production"),
      publicEndpoint: parsed.SIGMON_PUBLIC_ENDPOINT ?? ""
    },
    landing: {
      hosts: parseHostList(parsed.LANDING_HOSTS, ["sigmon.app", "www.sigmon.app"])
    },
    browserCors: {
      origins: parseOriginList(parsed.BROWSER_CORS_ORIGINS)
    },
    retention: {
      enabled: parsed.RETENTION_ENABLED,
      intervalMinutes: parsed.RETENTION_INTERVAL_MINUTES,
      batchSize: parsed.RETENTION_BATCH_SIZE,
      eventsDays: parsed.RETENTION_EVENTS_DAYS,
      errorsDays: parsed.RETENTION_ERRORS_DAYS,
      tracesDays: parsed.RETENTION_TRACES_DAYS,
      spansDays: parsed.RETENTION_SPANS_DAYS,
      llmCallsDays: parsed.RETENTION_LLM_CALLS_DAYS,
      profilesDays: parsed.RETENTION_PROFILES_DAYS,
      breadcrumbsDays: parsed.RETENTION_BREADCRUMBS_DAYS,
      deadLetterJobsDays: parsed.RETENTION_DEAD_LETTER_JOBS_DAYS
    },
    eventRollups: {
      enabled: parsed.EVENT_ROLLUPS_ENABLED,
      intervalMinutes: parsed.EVENT_ROLLUPS_INTERVAL_MINUTES,
      lookbackDays: parsed.EVENT_ROLLUPS_LOOKBACK_DAYS
    },
    alerts: {
      enabled: parsed.ALERTS_ENABLED,
      intervalMinutes: parsed.ALERTS_INTERVAL_MINUTES,
      webhookTimeoutMs: parsed.ALERTS_WEBHOOK_TIMEOUT_MS
    },
    monitors: {
      enabled: parsed.MONITORS_ENABLED,
      intervalMinutes: parsed.MONITORS_INTERVAL_MINUTES,
      httpTimeoutMs: parsed.MONITORS_HTTP_TIMEOUT_MS,
      maxConcurrency: parsed.MONITORS_MAX_CONCURRENCY
    },
    warehouseExports: {
      enabled: parsed.WAREHOUSE_EXPORTS_ENABLED,
      intervalMinutes: parsed.WAREHOUSE_EXPORTS_INTERVAL_MINUTES
    },
    smtp: {
      enabled: smtpConfigured,
      host: parsed.SMTP_HOST ?? "",
      port: parsed.SMTP_PORT,
      username: parsed.SMTP_USERNAME ?? "",
      password: parsed.SMTP_PASSWORD ?? "",
      from: parsed.SMTP_FROM ?? "",
      secure: parsed.SMTP_SECURE
    },
    backups: {
      enabled: parsed.BACKUPS_ENABLED,
      intervalHours: parsed.BACKUPS_INTERVAL_HOURS,
      localDir: parsed.BACKUPS_LOCAL_DIR,
      retentionDays: parsed.BACKUPS_RETENTION_DAYS,
      s3: {
        enabled: parsed.BACKUPS_S3_ENABLED,
        endpoint: parsed.BACKUPS_S3_ENDPOINT ?? "",
        region: parsed.BACKUPS_S3_REGION,
        bucket: parsed.BACKUPS_S3_BUCKET ?? "",
        accessKeyId: parsed.BACKUPS_S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: parsed.BACKUPS_S3_SECRET_ACCESS_KEY ?? "",
        prefix: parsed.BACKUPS_S3_PREFIX
      }
    },
    sourceMaps: {
      localDir: parsed.SOURCE_MAPS_LOCAL_DIR,
      maxUploadMb: parsed.SOURCE_MAPS_MAX_UPLOAD_MB,
      retention: {
        enabled: parsed.SOURCE_MAPS_RETENTION_ENABLED,
        days: parsed.SOURCE_MAPS_RETENTION_DAYS,
        batchSize: parsed.SOURCE_MAPS_RETENTION_BATCH_SIZE
      }
    },
    systemHealthHistory: {
      enabled: parsed.SYSTEM_HEALTH_HISTORY_ENABLED,
      sampleIntervalMinutes: parsed.SYSTEM_HEALTH_SAMPLE_INTERVAL_MINUTES,
      retentionHours: parsed.SYSTEM_HEALTH_HISTORY_RETENTION_HOURS
    },
    db: {
      statementTimeoutMs: parsed.DB_STATEMENT_TIMEOUT_MS,
      workerStatementTimeoutMs: parsed.DB_WORKER_STATEMENT_TIMEOUT_MS
    },
    funnel: {
      maxActors: parsed.FUNNEL_MAX_ACTORS
    }
  };
}
