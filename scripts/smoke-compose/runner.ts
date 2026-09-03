import { readFile, rm } from "node:fs/promises";
import { parseSmokeArgs } from "./args.js";
import { cleanupPlan } from "./cleanup.js";
import { formatCommandFailure, runCommand as runCommandImpl } from "./command.js";
import { doctorCommand } from "./doctor-command.js";
import { createSmokePayloads } from "./fixtures.js";
import {
  createCookieJar,
  expectArrayContains,
  getJson,
  pollUntil,
  postBearerJson,
  postJson,
  uploadSourceMapFile
} from "./http.js";
import { createRedactor } from "./redaction.js";
import { createStepRecorder, renderSummary } from "./steps.js";
import { writeSmokeResources } from "./temp-env.js";
import type { CommandInput, CommandResult, GeneratedSecrets, SmokeOptions, SmokeResources } from "./types.js";

type PreparedResources = SmokeResources & {
  secrets: GeneratedSecrets;
};

export type SmokeScope = { projectId: string; environmentId: string; errorId: string };

type HttpSmokeInput = {
  apiUrl: string;
  adminEmail: string;
  adminPassword: string;
  sourceMapFile: string;
  phase: "pre-restore" | "post-restore";
  scope?: SmokeScope;
  redact: (value: string) => string;
  addSecret?: (secret: string | undefined) => void;
};

export type SmokeRunnerDependencies = {
  getCommit: () => Promise<string>;
  prepareResources: () => Promise<PreparedResources>;
  runCommand: (input: CommandInput) => Promise<CommandResult>;
  runHttpSmoke: (input: HttpSmokeInput) => Promise<SmokeScope | void>;
  removeTempDir: (dir: string) => Promise<void>;
  wait: (ms: number) => Promise<void>;
};

export type RunSmokeComposeInput = {
  options: SmokeOptions;
  write: (line: string) => void;
  dependencies?: Partial<SmokeRunnerDependencies>;
};

function composeCommand(projectName: string, envFile: string, args: string[]): CommandInput {
  return {
    command: "docker",
    args: ["compose", "-p", projectName, "--env-file", envFile, ...args],
    timeoutMs: 180_000
  };
}

async function defaultGetCommit(): Promise<string> {
  const result = await runCommandImpl({ command: "git", args: ["rev-parse", "--short", "HEAD"] });
  return result.stdout.trim() || "unknown";
}

async function defaultPrepareResources(options: SmokeOptions): Promise<PreparedResources> {
  return writeSmokeResources({
    envExamplePath: ".env.example",
    apiUrl: options.apiUrl,
    runId: "phase6b"
  });
}

async function assertCommand(
  input: CommandInput,
  runCommand: (input: CommandInput) => Promise<CommandResult>,
  redact: (value: string) => string
): Promise<CommandResult> {
  const result = await runCommand(input);

  if (result.exitCode !== 0 && !input.allowFailure) {
    throw new Error(formatCommandFailure(input, result, redact));
  }

  return result;
}

async function assertCommandEventually(
  input: CommandInput,
  runCommand: (input: CommandInput) => Promise<CommandResult>,
  redact: (value: string) => string,
  wait: (ms: number) => Promise<void>,
  options = { attempts: 12, delayMs: 2500 }
): Promise<CommandResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await assertCommand(input, runCommand, redact);
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts) {
        break;
      }
      await wait(options.delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function pathUrl(apiUrl: string, path: string): string {
  return `${apiUrl}${path}`;
}

function queryUrl(apiUrl: string, path: string, params: Record<string, string | number | undefined>): string {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${apiUrl}${path}?${query}`;
}

function encodedPath(value: string): string {
  return encodeURIComponent(value);
}

function requireString(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

export async function pollForAssertion(
  label: string,
  assertion: () => Promise<void>,
  options = { attempts: 20, delayMs: 500 }
): Promise<void> {
  await pollUntil(
    label,
    async () => {
      await assertion();
      return true;
    },
    options
  );
}

export function isSmokeErrorGroup(group: { groupingFingerprint?: string }, fingerprint: string): boolean {
  return group.groupingFingerprint === fingerprint;
}

async function defaultRunHttpSmoke(input: HttpSmokeInput): Promise<SmokeScope | void> {
  const runId = "phase6b";
  const payloads = createSmokePayloads(runId);
  const apiUrl = input.apiUrl.replace(/\/+$/, "");
  const cookieJar = createCookieJar();

  await postJson(pathUrl(apiUrl, "/auth/login"), { email: input.adminEmail, password: input.adminPassword }, {
    cookieJar,
    redact: input.redact
  });

  if (input.phase === "post-restore") {
    if (!input.scope) {
      throw new Error("Missing smoke project identifiers for post-restore check");
    }

    await assertRestoredSmokeData(apiUrl, cookieJar, input.scope, payloads, input.redact);
    return;
  }

  const projectResponse = await postJson<{ project: { id: string } }>(
    pathUrl(apiUrl, "/admin/projects"),
    { name: "Phase 6B Smoke Harness" },
    { cookieJar, redact: input.redact }
  );
  const projectId = projectResponse.project.id;

  const environmentResponse = await postJson<{ environment: { id: string } }>(
    pathUrl(apiUrl, `/admin/projects/${encodedPath(projectId)}/environments`),
    { name: "production" },
    { cookieJar, redact: input.redact }
  );
  const environmentId = environmentResponse.environment.id;

  const apiKeyResponse = await postJson<{ apiKey: { secret?: string } }>(
    pathUrl(apiUrl, `/admin/projects/${encodedPath(projectId)}/api-keys`),
    { environmentId, name: "Phase 6B Smoke Ingestion" },
    { cookieJar, redact: input.redact }
  );
  const apiKeySecret = requireString(apiKeyResponse.apiKey.secret, "admin API key secret");
  input.addSecret?.(apiKeySecret);

  const sourceMapTokenResponse = await postJson<{ token: { secret?: string } }>(
    pathUrl(apiUrl, "/admin/source-map-upload-tokens"),
    { projectId, environmentId, name: "Phase 6B Smoke Source Maps" },
    { cookieJar, redact: input.redact }
  );
  const sourceMapTokenSecret = requireString(sourceMapTokenResponse.token.secret, "source map upload token secret");
  input.addSecret?.(sourceMapTokenSecret);

  await postBearerJson(pathUrl(apiUrl, "/v1/events"), payloads.event, apiKeySecret, { redact: input.redact });
  const errorResponse = await postBearerJson<{ accepted: true; id: string }>(
    pathUrl(apiUrl, "/v1/errors"),
    payloads.error,
    apiKeySecret,
    { redact: input.redact }
  );
  await postBearerJson(pathUrl(apiUrl, "/v1/traces"), payloads.trace, apiKeySecret, { redact: input.redact });
  await postBearerJson(pathUrl(apiUrl, "/v1/spans"), payloads.span, apiKeySecret, { redact: input.redact });
  await postBearerJson(pathUrl(apiUrl, "/v1/llm"), payloads.llm, apiKeySecret, { redact: input.redact });
  await postBearerJson(pathUrl(apiUrl, "/v1/breadcrumbs"), payloads.breadcrumb, apiKeySecret, { redact: input.redact });

  await uploadSourceMapFile(apiUrl, {
    token: sourceMapTokenSecret,
    projectId,
    environmentId,
    release: "web@phase6b",
    filePath: input.sourceMapFile,
    minifiedFile: "app.min.js",
    fileContent: await readFile(input.sourceMapFile, "utf8")
  });

  const scope = { projectId, environmentId, errorId: errorResponse.id };
  await pollForAssertion(
    "smoke event query",
    async () => {
      const response = await getJson<{ data: Array<{ name: string }> }>(
        scopedQueryUrl(apiUrl, "/query/events", scope, { event_name: payloads.event.name }),
        { cookieJar, redact: input.redact }
      );
      expectArrayContains(response.data, (event) => event.name === payloads.event.name, "smoke event");
    }
  );

  await assertPreRestoreSmokeData(apiUrl, cookieJar, scope, payloads, input.redact);
  return scope;
}

function scopedQueryUrl(
  apiUrl: string,
  path: string,
  scope: Pick<SmokeScope, "projectId" | "environmentId">,
  params: Record<string, string | number | undefined> = {}
): string {
  return queryUrl(apiUrl, path, {
    project_id: scope.projectId,
    environment_id: scope.environmentId,
    ...params
  });
}

async function assertPreRestoreSmokeData(
  apiUrl: string,
  cookieJar: ReturnType<typeof createCookieJar>,
  scope: SmokeScope,
  payloads: ReturnType<typeof createSmokePayloads>,
  redact: (value: string) => string
): Promise<void> {
  await pollForAssertion("smoke error query", async () => {
    const errors = await getJson<{ data: Array<{ id: string; message: string }> }>(
      scopedQueryUrl(apiUrl, "/query/errors", scope, { fingerprint: payloads.error.fingerprint }),
      { cookieJar, redact }
    );
    expectArrayContains(errors.data, (error) => error.message === payloads.error.message, "smoke error message");
  });

  await pollForAssertion("smoke error group query", async () => {
    const errorGroups = await getJson<{ data: Array<{ groupingFingerprint: string }> }>(
      scopedQueryUrl(apiUrl, "/query/error-groups", scope, { fingerprint: payloads.error.fingerprint }),
      { cookieJar, redact }
    );
    expectArrayContains(errorGroups.data, (group) => isSmokeErrorGroup(group, payloads.error.fingerprint), "smoke error group");
  });

  await pollForAssertion("smoke trace query", async () => {
    const traces = await getJson<{ data: Array<{ traceId: string }> }>(
      scopedQueryUrl(apiUrl, "/query/traces", scope, { trace_id: payloads.trace.trace_id }),
      { cookieJar, redact }
    );
    expectArrayContains(traces.data, (trace) => trace.traceId === payloads.trace.trace_id, "smoke trace");
  });

  await pollForAssertion("smoke llm query", async () => {
    const llmCalls = await getJson<{ data: Array<{ promptName: string | null }> }>(
      scopedQueryUrl(apiUrl, "/query/llm-calls", scope, { prompt_name: payloads.llm.prompt_name }),
      { cookieJar, redact }
    );
    expectArrayContains(llmCalls.data, (llmCall) => llmCall.promptName === payloads.llm.prompt_name, "smoke LLM call");
  });

  await pollForAssertion("smoke tenant query", async () => {
    const tenants = await getJson<{ data: { tenants: Array<{ tenantId: string }> } }>(
      scopedQueryUrl(apiUrl, "/query/entities/tenants", scope),
      { cookieJar, redact }
    );
    expectArrayContains(tenants.data.tenants, (tenant) => tenant.tenantId === payloads.event.tenant_id, "smoke tenant");
  });

  await pollForAssertion("smoke user query", async () => {
    const users = await getJson<{ data: { users: Array<{ userId: string }> } }>(
      scopedQueryUrl(apiUrl, "/query/users", scope),
      { cookieJar, redact }
    );
    expectArrayContains(users.data.users, (user) => user.userId === payloads.event.user_id, "smoke user");
  });

  await pollForAssertion("smoke timeline query", () => assertSessionTimeline(apiUrl, cookieJar, scope, payloads, redact));

  await pollForAssertion("smoke source map resolution", async () => {
    const sourceMapResolution = await getJson<{
      data: { status: string; frames: Array<{ originalSource?: string; originalName?: string }> };
    }>(scopedQueryUrl(apiUrl, `/query/errors/${encodedPath(scope.errorId)}/source-map-resolution`, scope), { cookieJar, redact });
    if (sourceMapResolution.data.status !== "resolved") {
      throw new Error(`Expected source map resolution status resolved, received ${sourceMapResolution.data.status}`);
    }
    expectArrayContains(
      sourceMapResolution.data.frames,
      (frame) => frame.originalSource === "src/app.ts" && frame.originalName === "checkout",
      "resolved source map frame"
    );
  });
}

async function assertRestoredSmokeData(
  apiUrl: string,
  cookieJar: ReturnType<typeof createCookieJar>,
  scope: SmokeScope,
  payloads: ReturnType<typeof createSmokePayloads>,
  redact: (value: string) => string
): Promise<void> {
  await pollForAssertion("restored smoke event query", async () => {
    const events = await getJson<{ data: Array<{ name: string }> }>(
      scopedQueryUrl(apiUrl, "/query/events", scope, { event_name: payloads.event.name }),
      { cookieJar, redact }
    );
    expectArrayContains(events.data, (event) => event.name === payloads.event.name, "restored smoke event");
  });

  await pollForAssertion("restored smoke error query", async () => {
    const errors = await getJson<{ data: Array<{ id: string; message: string }> }>(
      scopedQueryUrl(apiUrl, "/query/errors", scope, { fingerprint: payloads.error.fingerprint }),
      { cookieJar, redact }
    );
    expectArrayContains(errors.data, (error) => error.message === payloads.error.message, "restored smoke error");
  });

  await pollForAssertion("restored smoke trace query", async () => {
    const traces = await getJson<{ data: Array<{ traceId: string }> }>(
      scopedQueryUrl(apiUrl, "/query/traces", scope, { trace_id: payloads.trace.trace_id }),
      { cookieJar, redact }
    );
    expectArrayContains(traces.data, (trace) => trace.traceId === payloads.trace.trace_id, "restored smoke trace");
  });

  await pollForAssertion("restored smoke timeline", () => assertSessionTimeline(apiUrl, cookieJar, scope, payloads, redact));
}

async function assertSessionTimeline(
  apiUrl: string,
  cookieJar: ReturnType<typeof createCookieJar>,
  scope: Pick<SmokeScope, "projectId" | "environmentId">,
  payloads: ReturnType<typeof createSmokePayloads>,
  redact: (value: string) => string
): Promise<void> {
  const timeline = await getJson<{ data: { items: Array<{ title: string }> } }>(
    scopedQueryUrl(apiUrl, `/query/sessions/${encodedPath(payloads.event.session_id)}/timeline`, scope),
    { cookieJar, redact }
  );
  expectArrayContains(timeline.data.items, (item) => item.title === payloads.breadcrumb.message, "smoke breadcrumb timeline item");
}

export async function runSmokeCompose(input: RunSmokeComposeInput): Promise<number> {
  const recorder = createStepRecorder(input.write);
  const redactor = createRedactor([]);
  const dependencies: SmokeRunnerDependencies = {
    getCommit: input.dependencies?.getCommit ?? defaultGetCommit,
    prepareResources: input.dependencies?.prepareResources ?? (() => defaultPrepareResources(input.options)),
    runCommand: input.dependencies?.runCommand ?? runCommandImpl,
    runHttpSmoke: input.dependencies?.runHttpSmoke ?? defaultRunHttpSmoke,
    removeTempDir: input.dependencies?.removeTempDir ?? ((dir) => rm(dir, { recursive: true, force: true })),
    wait: input.dependencies?.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  };

  let commit = "unknown";
  let resources: PreparedResources | undefined;
  let smokeScope: SmokeScope | undefined;

  try {
    commit = await dependencies.getCommit();
    resources = await dependencies.prepareResources();
    redactor.add(resources.secrets.adminPassword);
    redactor.add(resources.secrets.apiKeyPepper);
    redactor.add(resources.secrets.postgresPassword);
    redactor.add(resources.secrets.sessionSecret);

    recorder.pass("prepare", `commit ${commit}, project ${input.options.projectName}`);

    const envFile = resources.envFile;
    const run = (command: CommandInput) => assertCommand(command, dependencies.runCommand, redactor.redact);

    await run(doctorCommand(["--env-file", envFile], { timeoutMs: 60_000 }));
    recorder.pass("doctor", "pre-start checks passed");

    await run(composeCommand(input.options.projectName, envFile, ["config", "--quiet"]));
    recorder.pass("compose config", "configuration rendered");

    await run(composeCommand(input.options.projectName, envFile, ["up", "-d", "postgres", "redis"]));
    recorder.pass("dependencies", "postgres and redis started");

    await run(composeCommand(input.options.projectName, envFile, ["run", "--rm", "api", "pnpm", "seed:admin"]));
    recorder.pass("seed admin", "bootstrap admin seeded");

    await run(composeCommand(input.options.projectName, envFile, ["up", "-d", "--build"]));
    recorder.pass("stack", "api and worker started");

    await assertCommandEventually(
      doctorCommand(["--compose", "--api-url", input.options.apiUrl, "--env-file", envFile], {
        env: { COMPOSE_PROJECT_NAME: input.options.projectName },
        timeoutMs: 60_000
      }),
      dependencies.runCommand,
      redactor.redact,
      dependencies.wait
    );
    recorder.pass("compose doctor", "running checks passed");

    const preRestoreScope = await dependencies.runHttpSmoke({
      apiUrl: input.options.apiUrl,
      adminEmail: resources.secrets.adminEmail,
      adminPassword: resources.secrets.adminPassword,
      sourceMapFile: resources.sourceMapFile,
      phase: "pre-restore",
      redact: redactor.redact,
      addSecret: redactor.add
    });
    if (preRestoreScope) {
      smokeScope = preRestoreScope;
    }
    recorder.pass("http smoke", "pre-restore data verified");

    await run(composeCommand(input.options.projectName, envFile, ["run", "--rm", "worker", "pnpm", "backup:create"]));
    recorder.pass("backup", "manual backup completed");

    const backupDiscovery = await run(
      composeCommand(input.options.projectName, envFile, ["run", "--rm", "worker", "sh", "-lc", "ls -1t /var/lib/sigmon/backups/*.dump | head -n 1"])
    );
    const backupPath = backupDiscovery.stdout.trim();
    if (!backupPath) {
      throw new Error("Backup completed but no dump path was found");
    }

    const unconfirmedRestore = await run({
      ...composeCommand(input.options.projectName, envFile, ["run", "--rm", "worker", "pnpm", "backup:restore", "--", backupPath]),
      allowFailure: true
    });
    if (unconfirmedRestore.exitCode === 0) {
      throw new Error("restore without --yes unexpectedly succeeded");
    }
    recorder.pass("restore guard", "restore without --yes refused");

    await run(composeCommand(input.options.projectName, envFile, ["stop", "api", "worker"]));
    await run(composeCommand(input.options.projectName, envFile, ["run", "--rm", "worker", "pnpm", "backup:restore", "--", backupPath, "--yes"]));
    await run(composeCommand(input.options.projectName, envFile, ["start", "api", "worker"]));
    recorder.pass("restore", "confirmed restore completed");

    await assertCommandEventually(
      doctorCommand(["--compose", "--api-url", input.options.apiUrl, "--env-file", envFile], {
        env: { COMPOSE_PROJECT_NAME: input.options.projectName },
        timeoutMs: 60_000
      }),
      dependencies.runCommand,
      redactor.redact,
      dependencies.wait
    );

    await dependencies.runHttpSmoke({
      apiUrl: input.options.apiUrl,
      adminEmail: resources.secrets.adminEmail,
      adminPassword: resources.secrets.adminPassword,
      sourceMapFile: resources.sourceMapFile,
      phase: "post-restore",
      scope: smokeScope,
      redact: redactor.redact,
      addSecret: redactor.add
    });
    recorder.pass("post-restore smoke", "restored data verified");

    return recorder.results().some((result) => result.status === "fail") ? 1 : 0;
  } catch (error) {
    recorder.fail("smoke", redactor.redact(error instanceof Error ? error.message : String(error)));
    return 1;
  } finally {
    if (resources) {
      const plan = cleanupPlan({
        preserve: input.options.preserve,
        projectName: input.options.projectName,
        tempDir: resources.tempDir
      });

      for (const command of plan.commands) {
        await dependencies.runCommand({ command: command[0]!, args: command.slice(1), timeoutMs: 120_000, allowFailure: true });
      }

      if (plan.removeTempDir) {
        await dependencies.removeTempDir(resources.tempDir);
      }

      input.write(plan.message);
      input.write(renderSummary({ commit, projectName: input.options.projectName, apiUrl: input.options.apiUrl }, recorder.results()));
    }
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseSmokeArgs(args, process.env);
  const exitCode = await runSmokeCompose({
    options,
    write: (line) => process.stdout.write(`${line}\n`)
  });
  process.exitCode = exitCode;
}
