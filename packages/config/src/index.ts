import { z } from "zod";

const emptyStringToUndefined = (value: unknown) => (value === "" ? undefined : value);
const optionalEnvString = z.preprocess(emptyStringToUndefined, z.string().optional());
const optionalEnvUrl = z.preprocess(emptyStringToUndefined, z.string().url().optional());
const optionalPositiveInteger = (defaultValue: number) =>
  z.preprocess(emptyStringToUndefined, z.coerce.number().int().min(1).default(defaultValue));

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
  RETENTION_LLM_CALLS_DAYS: optionalPositiveInteger(180)
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

  if (parsed.GOOGLE_OAUTH_ENABLED) {
    if (!parsed.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID is required when Google OAuth is enabled");
    if (!parsed.GOOGLE_CLIENT_SECRET) throw new Error("GOOGLE_CLIENT_SECRET is required when Google OAuth is enabled");
    if (!parsed.GOOGLE_REDIRECT_URI) throw new Error("GOOGLE_REDIRECT_URI is required when Google OAuth is enabled");
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
    }
  };
}
