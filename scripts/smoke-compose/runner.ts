import { rm } from "node:fs/promises";
import { parseSmokeArgs } from "./args.js";
import { cleanupPlan } from "./cleanup.js";
import { formatCommandFailure, runCommand as runCommandImpl } from "./command.js";
import { createSmokePayloads } from "./fixtures.js";
import { createRedactor } from "./redaction.js";
import { createStepRecorder, renderSummary } from "./steps.js";
import { writeSmokeResources } from "./temp-env.js";
import type { CommandInput, CommandResult, GeneratedSecrets, SmokeOptions, SmokeResources } from "./types.js";

type PreparedResources = SmokeResources & {
  secrets: GeneratedSecrets;
};

export type SmokeRunnerDependencies = {
  getCommit: () => Promise<string>;
  prepareResources: () => Promise<PreparedResources>;
  runCommand: (input: CommandInput) => Promise<CommandResult>;
  runHttpSmoke: (input: {
    apiUrl: string;
    adminEmail: string;
    adminPassword: string;
    sourceMapFile: string;
    phase: "pre-restore" | "post-restore";
    redact: (value: string) => string;
  }) => Promise<void>;
  removeTempDir: (dir: string) => Promise<void>;
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

async function defaultRunHttpSmoke(): Promise<void> {
  createSmokePayloads("phase6b");
  throw new Error("HTTP smoke flow requires the Task 6 implementation before pnpm smoke:compose is run against real services");
}

export async function runSmokeCompose(input: RunSmokeComposeInput): Promise<number> {
  const recorder = createStepRecorder(input.write);
  const redactor = createRedactor([]);
  const dependencies: SmokeRunnerDependencies = {
    getCommit: input.dependencies?.getCommit ?? defaultGetCommit,
    prepareResources: input.dependencies?.prepareResources ?? (() => defaultPrepareResources(input.options)),
    runCommand: input.dependencies?.runCommand ?? runCommandImpl,
    runHttpSmoke: input.dependencies?.runHttpSmoke ?? defaultRunHttpSmoke,
    removeTempDir: input.dependencies?.removeTempDir ?? ((dir) => rm(dir, { recursive: true, force: true }))
  };

  let commit = "unknown";
  let resources: PreparedResources | undefined;

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

    await run({ command: "pnpm", args: ["run", "doctor", "--", "--env-file", envFile], timeoutMs: 60_000 });
    recorder.pass("doctor", "pre-start checks passed");

    await run(composeCommand(input.options.projectName, envFile, ["config", "--quiet"]));
    recorder.pass("compose config", "configuration rendered");

    await run(composeCommand(input.options.projectName, envFile, ["up", "-d", "postgres", "redis"]));
    recorder.pass("dependencies", "postgres and redis started");

    await run(composeCommand(input.options.projectName, envFile, ["run", "--rm", "api", "pnpm", "seed:admin"]));
    recorder.pass("seed admin", "bootstrap admin seeded");

    await run(composeCommand(input.options.projectName, envFile, ["up", "-d", "--build"]));
    recorder.pass("stack", "api and worker started");

    await run({
      command: "pnpm",
      args: ["run", "doctor", "--", "--compose", "--api-url", input.options.apiUrl, "--env-file", envFile],
      env: { COMPOSE_PROJECT_NAME: input.options.projectName },
      timeoutMs: 60_000
    });
    recorder.pass("compose doctor", "running checks passed");

    await dependencies.runHttpSmoke({
      apiUrl: input.options.apiUrl,
      adminEmail: resources.secrets.adminEmail,
      adminPassword: resources.secrets.adminPassword,
      sourceMapFile: resources.sourceMapFile,
      phase: "pre-restore",
      redact: redactor.redact
    });
    recorder.pass("http smoke", "pre-restore data verified");

    await run(composeCommand(input.options.projectName, envFile, ["run", "--rm", "worker", "pnpm", "backup:create"]));
    recorder.pass("backup", "manual backup completed");

    const backupDiscovery = await run(
      composeCommand(input.options.projectName, envFile, ["run", "--rm", "worker", "sh", "-lc", "ls -1t /var/lib/signalhub/backups/*.dump | head -n 1"])
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

    await run({
      command: "pnpm",
      args: ["run", "doctor", "--", "--compose", "--api-url", input.options.apiUrl, "--env-file", envFile],
      env: { COMPOSE_PROJECT_NAME: input.options.projectName },
      timeoutMs: 60_000
    });

    await dependencies.runHttpSmoke({
      apiUrl: input.options.apiUrl,
      adminEmail: resources.secrets.adminEmail,
      adminPassword: resources.secrets.adminPassword,
      sourceMapFile: resources.sourceMapFile,
      phase: "post-restore",
      redact: redactor.redact
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
