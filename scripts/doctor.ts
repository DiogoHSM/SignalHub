import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

void existsSync;
void readFileSync;
void spawn;

export type DoctorStatus = "pass" | "warn" | "fail";

export type DoctorResult = {
  status: DoctorStatus;
  message: string;
  detail?: string;
};

export type DoctorEnv = Record<string, string | undefined>;

export type DoctorOptions = {
  compose: boolean;
  apiUrl?: string;
  envFile: string;
};

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
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    return ["localhost", "127.0.0.1", "::1"].includes(hostname);
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

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type CommandRunner = (command: string[]) => Promise<CommandResult>;

type FetchResult = {
  ok: boolean;
  status: number;
};

type FetchHealth = (url: string) => Promise<FetchResult>;

type BuildDoctorDependencies = {
  options: DoctorOptions;
  fileExists: (path: string) => boolean;
  readFile: (path: string) => string;
  runCommand: CommandRunner;
  fetchHealth: FetchHealth;
};

export function parseDoctorArgs(args: string[]): DoctorOptions {
  const options: DoctorOptions = { compose: false, envFile: ".env" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--compose") {
      options.compose = true;
      continue;
    }
    if (arg === "--api-url") {
      const value = args[index + 1];
      if (!value) throw new Error("--api-url requires a value");
      options.apiUrl = value;
      index += 1;
      continue;
    }
    if (arg === "--env-file") {
      const value = args[index + 1];
      if (!value) throw new Error("--env-file requires a value");
      options.envFile = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown doctor argument: ${arg}`);
  }
  return options;
}

function truncateOutput(value: string): string {
  return value.trim().split(/\r?\n/).slice(0, 8).join("\n");
}

export async function checkCommand(
  label: string,
  command: string[],
  runCommand: CommandRunner,
  failedStatus: DoctorStatus = "fail"
): Promise<DoctorResult> {
  try {
    const result = await runCommand(command);
    if (result.exitCode === 0) {
      return createResult("pass", `${label} passed`);
    }
    return createResult(failedStatus, `${label} failed`, truncateOutput(result.stderr || result.stdout));
  } catch (error) {
    return createResult(failedStatus, `${label} failed`, error instanceof Error ? error.message : String(error));
  }
}

export async function checkApiHealth(apiUrl: string, fetchHealth: FetchHealth, required = false): Promise<DoctorResult[]> {
  const base = apiUrl.replace(/\/$/, "");
  const checks: Array<[string, string]> = [
    ["/health", `${base}/health`],
    ["/ready", `${base}/ready`]
  ];
  const results: DoctorResult[] = [];
  for (const [path, url] of checks) {
    try {
      const response = await fetchHealth(url);
      results.push(
        response.ok
          ? createResult("pass", `API ${path} responded successfully`)
          : createResult(required ? "fail" : "warn", `API ${path} returned HTTP ${response.status}`)
      );
    } catch (error) {
      results.push(createResult(required ? "fail" : "warn", `API ${path} is unreachable`, error instanceof Error ? error.message : String(error)));
    }
  }
  return results;
}

export async function buildDoctorResults(dependencies: BuildDoctorDependencies): Promise<DoctorResult[]> {
  const { options, fileExists, readFile, runCommand, fetchHealth } = dependencies;
  const results: DoctorResult[] = [];
  let env: DoctorEnv = {};

  results.push(await checkCommand("Node.js version check", ["node", "--version"], runCommand));
  results.push(await checkCommand("pnpm version check", ["pnpm", "--version"], runCommand));

  if (!fileExists(options.envFile)) {
    results.push(createResult("fail", `${options.envFile} is missing; copy .env.example to ${options.envFile}`));
  } else {
    env = parseEnvFile(readFile(options.envFile));
    results.push(createResult("pass", `${options.envFile} exists`));
    results.push(...checkEnvValues(env));
  }

  results.push(await checkCommand("Docker Compose config", ["docker", "compose", "config", "--quiet"], runCommand, "warn"));

  if (options.compose) {
    results.push(await checkCommand("Docker service list", ["docker", "compose", "ps"], runCommand));
    for (const service of ["postgres", "redis", "api", "worker"]) {
      results.push(await checkCommand(`Docker Compose ${service} service`, ["docker", "compose", "ps", service], runCommand));
    }
  }

  const apiUrl = options.apiUrl ?? env.SIGNALHUB_PUBLIC_ENDPOINT;
  if (apiUrl && (options.apiUrl || options.compose || isLocalhostUrl(apiUrl))) {
    results.push(...(await checkApiHealth(apiUrl, fetchHealth, options.compose)));
  }

  return results;
}

function runCommandWithTimeout(command: string[], timeoutMs = 5000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

export async function runDoctor(input: BuildDoctorDependencies & { write: (output: string) => void }): Promise<number> {
  const results = await buildDoctorResults(input);
  const env = input.fileExists(input.options.envFile) ? parseEnvFile(input.readFile(input.options.envFile)) : {};
  const output = redactDoctorText(renderResults(results), collectSecretValues(env));
  input.write(`${output}\n`);
  return getExitCode(results);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseDoctorArgs(args);
  const exitCode = await runDoctor({
    options,
    fileExists: existsSync,
    readFile: (path) => readFileSync(path, "utf8"),
    runCommand: runCommandWithTimeout,
    fetchHealth: fetchWithTimeout,
    write: (output) => process.stdout.write(output)
  });
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
