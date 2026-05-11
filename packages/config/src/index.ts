import { z } from "zod";

const emptyStringToUndefined = (value: unknown) => (value === "" ? undefined : value);
const optionalEnvString = z.preprocess(emptyStringToUndefined, z.string().optional());
const optionalEnvUrl = z.preprocess(emptyStringToUndefined, z.string().url().optional());
const optionalPositiveInteger = (defaultValue: number) =>
  z.preprocess(emptyStringToUndefined, z.coerce.number().int().min(1).default(defaultValue));

const productionPlaceholders = {
  SESSION_SECRET: "change-me-to-a-long-random-secret",
  API_KEY_PEPPER: "change-me-to-a-long-random-pepper",
  BOOTSTRAP_ADMIN_PASSWORD: "change-me-admin-password-32-chars-min"
} as const;

const localOnlyPostgresPassword = "signalhub-local-only-change-me";

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

const rawConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
  SIGNALHUB_PUBLIC_ENDPOINT: optionalEnvUrl,
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
  ALERTS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  ALERTS_INTERVAL_MINUTES: optionalPositiveInteger(1),
  ALERTS_WEBHOOK_TIMEOUT_MS: optionalPositiveInteger(5000),
  BACKUPS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  BACKUPS_INTERVAL_HOURS: optionalPositiveInteger(24),
  BACKUPS_LOCAL_DIR: z.preprocess(emptyStringToUndefined, z.string().min(1).default("/var/lib/signalhub/backups")),
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
  BACKUPS_S3_PREFIX: z.preprocess(emptyStringToUndefined, z.string().default("signalhub")),
  SOURCE_MAPS_LOCAL_DIR: z.preprocess(
    emptyStringToUndefined,
    z.string().min(1).default("/var/lib/signalhub/source-maps")
  ),
  SOURCE_MAPS_MAX_UPLOAD_MB: optionalPositiveInteger(50)
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

  return {
    nodeEnv: parsed.NODE_ENV,
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
      publicEndpoint: parsed.SIGNALHUB_PUBLIC_ENDPOINT ?? ""
    },
    retention: {
      enabled: parsed.RETENTION_ENABLED,
      intervalMinutes: parsed.RETENTION_INTERVAL_MINUTES,
      batchSize: parsed.RETENTION_BATCH_SIZE,
      eventsDays: parsed.RETENTION_EVENTS_DAYS,
      errorsDays: parsed.RETENTION_ERRORS_DAYS,
      tracesDays: parsed.RETENTION_TRACES_DAYS,
      spansDays: parsed.RETENTION_SPANS_DAYS,
      llmCallsDays: parsed.RETENTION_LLM_CALLS_DAYS
    },
    alerts: {
      enabled: parsed.ALERTS_ENABLED,
      intervalMinutes: parsed.ALERTS_INTERVAL_MINUTES,
      webhookTimeoutMs: parsed.ALERTS_WEBHOOK_TIMEOUT_MS
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
      maxUploadMb: parsed.SOURCE_MAPS_MAX_UPLOAD_MB
    }
  };
}
