import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

void existsSync;
void readFileSync;
void spawn;
void pathToFileURL;

export type DoctorStatus = "pass" | "warn" | "fail";

export type DoctorResult = {
  status: DoctorStatus;
  message: string;
  detail?: string;
};

export type DoctorEnv = Record<string, string | undefined>;

type DoctorOptions = {
  compose: boolean;
  apiUrl?: string;
  envFile: string;
};

void (undefined as DoctorOptions | undefined);

const requiredEnv = [
  "DATABASE_URL",
  "REDIS_URL",
  "SESSION_SECRET",
  "API_KEY_PEPPER",
  "BOOTSTRAP_ADMIN_EMAIL",
  "BOOTSTRAP_ADMIN_PASSWORD"
] as const;

const productionPlaceholders = new Map([
  ["SESSION_SECRET", "change-me-to-a-long-random-secret"],
  ["API_KEY_PEPPER", "change-me-to-a-long-random-pepper"],
  ["BOOTSTRAP_ADMIN_PASSWORD", "change-me-admin-password-32-chars-min"]
]);

const secretEnvNames = [
  "SESSION_SECRET",
  "API_KEY_PEPPER",
  "BOOTSTRAP_ADMIN_PASSWORD",
  "POSTGRES_PASSWORD",
  "POSTGRES_PASSWORD_URLENCODED",
  "GOOGLE_CLIENT_SECRET",
  "BACKUPS_S3_ACCESS_KEY_ID",
  "BACKUPS_S3_SECRET_ACCESS_KEY"
] as const;

export function createResult(status: DoctorStatus, message: string, detail?: string): DoctorResult {
  return detail ? { status, message, detail } : { status, message };
}

export function getExitCode(results: DoctorResult[]): number {
  return results.some((result) => result.status === "fail") ? 1 : 0;
}

function parseBoolean(value: string | undefined): boolean {
  return value === "true";
}

function isLocalhostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isPlainHttpUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "http:";
  } catch {
    return false;
  }
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function containsUrlReservedCharacters(value: string): boolean {
  return /[:/?#\[\]@!$&'()*+,;=%]/.test(value);
}

export function checkEnvValues(env: DoctorEnv): DoctorResult[] {
  const results: DoctorResult[] = [];
  const nodeEnv = env.NODE_ENV ?? "development";

  for (const name of requiredEnv) {
    if (!env[name]) {
      results.push(createResult("fail", `${name} is missing`));
    }
  }

  for (const [name, placeholder] of productionPlaceholders) {
    if (nodeEnv === "production" && env[name] === placeholder) {
      results.push(createResult("fail", `${name} must be replaced for production`));
    }
  }

  if (nodeEnv === "production" && env.DATABASE_URL?.includes(":signalhub-local-only-change-me@")) {
    results.push(createResult("fail", "DATABASE_URL uses the local-only Postgres password placeholder"));
  }

  for (const name of ["DATABASE_URL", "REDIS_URL", "SIGNALHUB_PUBLIC_ENDPOINT"] as const) {
    const value = env[name];
    if (value && !isValidUrl(value)) {
      results.push(createResult("fail", `${name} must be a valid URL`));
    }
  }

  if (nodeEnv === "production" && env.SIGNALHUB_PUBLIC_ENDPOINT) {
    if (isLocalhostUrl(env.SIGNALHUB_PUBLIC_ENDPOINT)) {
      results.push(createResult("warn", "SIGNALHUB_PUBLIC_ENDPOINT points to localhost in production"));
    }
    if (isPlainHttpUrl(env.SIGNALHUB_PUBLIC_ENDPOINT)) {
      results.push(createResult("warn", "SIGNALHUB_PUBLIC_ENDPOINT uses plain HTTP in production"));
    }
  }

  if (env.POSTGRES_PASSWORD && containsUrlReservedCharacters(env.POSTGRES_PASSWORD) && !env.POSTGRES_PASSWORD_URLENCODED) {
    results.push(createResult("warn", "POSTGRES_PASSWORD contains URL-reserved characters; set POSTGRES_PASSWORD_URLENCODED"));
  }

  if (parseBoolean(env.GOOGLE_OAUTH_ENABLED)) {
    for (const name of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"] as const) {
      if (!env[name]) results.push(createResult("warn", `${name} is missing while Google OAuth is enabled`));
    }
  }

  if (parseBoolean(env.BACKUPS_ENABLED) && !env.BACKUPS_LOCAL_DIR) {
    results.push(createResult("warn", "BACKUPS_LOCAL_DIR is missing while backups are enabled"));
  }

  if (parseBoolean(env.BACKUPS_S3_ENABLED)) {
    for (const name of [
      "BACKUPS_S3_ENDPOINT",
      "BACKUPS_S3_BUCKET",
      "BACKUPS_S3_ACCESS_KEY_ID",
      "BACKUPS_S3_SECRET_ACCESS_KEY",
      "BACKUPS_S3_PREFIX"
    ] as const) {
      if (!env[name]) results.push(createResult("warn", `${name} is missing while S3 backups are enabled`));
    }
  }

  if (results.length === 0) {
    results.push(createResult("pass", "Environment values look coherent"));
  }

  return results;
}

export function renderResults(results: DoctorResult[]): string {
  const icon = { pass: "PASS", warn: "WARN", fail: "FAIL" } satisfies Record<DoctorStatus, string>;
  return results.map((result) => `[${icon[result.status]}] ${result.message}${result.detail ? `\n  ${result.detail}` : ""}`).join("\n");
}

export function redactDoctorText(text: string, secrets: Array<string | undefined>): string {
  return secrets.filter((secret): secret is string => Boolean(secret)).reduce((output, secret) => output.split(secret).join("[REDACTED]"), text);
}

export function collectSecretValues(env: DoctorEnv): string[] {
  return secretEnvNames.map((name) => env[name]).filter((value): value is string => Boolean(value));
}

export function parseEnvFile(content: string): DoctorEnv {
  const env: DoctorEnv = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = value;
  }
  return env;
}
