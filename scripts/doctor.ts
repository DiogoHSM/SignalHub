import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import type { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

void accessSync;
void constants;
void existsSync;
void readFileSync;
void spawn;
void statSync;

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

  if (nodeEnv === "production" && env.DATABASE_URL?.includes(":sigmon-local-only-change-me@")) {
    results.push(createResult("fail", "DATABASE_URL uses the local-only Postgres password placeholder"));
  }

  if (nodeEnv === "production" && env.POSTGRES_PASSWORD === "sigmon-local-only-change-me") {
    results.push(createResult("fail", "POSTGRES_PASSWORD must be replaced for production"));
  }

  for (const name of ["DATABASE_URL", "REDIS_URL", "SIGMON_PUBLIC_ENDPOINT"] as const) {
    const value = env[name];
    if (value && !isValidUrl(value)) {
      results.push(createResult("fail", `${name} must be a valid URL`));
    }
  }

  if (nodeEnv === "production" && env.SIGMON_PUBLIC_ENDPOINT) {
    if (isLocalhostUrl(env.SIGMON_PUBLIC_ENDPOINT)) {
      results.push(createResult("warn", "SIGMON_PUBLIC_ENDPOINT points to localhost in production"));
    }
    if (isPlainHttpUrl(env.SIGMON_PUBLIC_ENDPOINT)) {
      results.push(createResult("warn", "SIGMON_PUBLIC_ENDPOINT uses plain HTTP in production"));
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

export function checkDirectoryWritable(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function checkSourceMapDirectory(
  env: DoctorEnv,
  checkDirectoryWritablePath: (path: string) => boolean,
  options: DoctorOptions
): DoctorResult[] {
  const localDir = env.SOURCE_MAPS_LOCAL_DIR?.trim();
  if (!localDir) return [];
  if (options.compose) return [];
  return checkDirectoryWritablePath(localDir) ? [] : [createResult("warn", "SOURCE_MAPS_LOCAL_DIR is missing or not writable")];
}

export function renderResults(results: DoctorResult[]): string {
  const icon = { pass: "PASS", warn: "WARN", fail: "FAIL" } satisfies Record<DoctorStatus, string>;
  return results.map((result) => `[${icon[result.status]}] ${result.message}${result.detail ? `\n  ${result.detail}` : ""}`).join("\n");
}

export function redactDoctorText(text: string, secrets: Array<string | undefined>): string {
  const redactedSecrets = secrets
    .filter((secret): secret is string => Boolean(secret))
    .reduce((output, secret) => output.split(secret).join("[REDACTED]"), text);
  return redactUrlUserInfo(redactedSecrets);
}

export function collectSecretValues(env: DoctorEnv): string[] {
  return secretEnvNames.map((name) => env[name]).filter((value): value is string => Boolean(value));
}

function redactUrlUserInfo(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s/@]+(?::[^\s/@]*)?@/gi, (match) => {
    const scheme = match.slice(0, match.indexOf("//") + 2);
    return `${scheme}[REDACTED]@`;
  });
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
  checkDirectoryWritable: (path: string) => boolean;
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
      const detail = redactUrlUserInfo(error instanceof Error ? error.message : String(error));
      results.push(createResult(required ? "fail" : "warn", `API ${path} is unreachable`, detail));
    }
  }
  return results;
}

export async function buildDoctorResults(dependencies: BuildDoctorDependencies): Promise<DoctorResult[]> {
  const { options, fileExists, readFile, runCommand, fetchHealth, checkDirectoryWritable } = dependencies;
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
    results.push(...checkSourceMapDirectory(env, checkDirectoryWritable, options));
  }

  results.push(await checkCommand("Docker Compose config", ["docker", "compose", "config", "--quiet"], runCommand, "warn"));

  if (options.compose) {
    results.push(await checkCommand("Docker service list", ["docker", "compose", "ps"], runCommand));
    for (const service of ["postgres", "redis", "api", "worker"]) {
      results.push(await checkCommand(`Docker Compose ${service} service`, ["docker", "compose", "ps", service], runCommand));
    }
  }

  const apiUrl = options.apiUrl ?? env.SIGMON_PUBLIC_ENDPOINT;
  if (apiUrl && (options.apiUrl || options.compose || isLocalhostUrl(apiUrl))) {
    results.push(...(await checkApiHealth(apiUrl, fetchHealth, options.compose)));
  }

  return results;
}

type SpawnedProcess = {
  stdout: Readable;
  stderr: Readable;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  on: (event: "error", listener: (error: Error) => void) => SpawnedProcess;
  on: (event: "close", listener: (exitCode: number | null) => void) => SpawnedProcess;
  removeListener: (event: "error", listener: (error: Error) => void) => SpawnedProcess;
  removeListener: (event: "close", listener: (exitCode: number | null) => void) => SpawnedProcess;
};

type RunCommandWithTimeoutOptions = {
  spawnProcess?: (command: string, args: string[]) => SpawnedProcess;
  killGraceMs?: number;
};

export function runCommandWithTimeout(command: string[], timeoutMs = 5000, options: RunCommandWithTimeoutOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = options.spawnProcess
      ? options.spawnProcess(command[0]!, command.slice(1))
      : spawn(command[0]!, command.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    const timeoutError = new Error(`${command.join(" ")} timed out after ${timeoutMs}ms`);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onError = (error: Error) => {
      settle(() => reject(timedOut ? timeoutError : error));
    };
    const onClose = (exitCode: number | null) => {
      settle(() => {
        if (timedOut) {
          reject(timeoutError);
        } else {
          resolve({ exitCode: exitCode ?? 1, stdout, stderr });
        }
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, options.killGraceMs ?? 1000);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", onError);
    child.on("close", onClose);
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
    checkDirectoryWritable,
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
