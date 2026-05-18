import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { CommandInput, CommandResult } from "./types.js";

export interface SpawnedProcess {
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (code: number | null) => void): this;
  removeListener(event: "error", listener: (error: Error) => void): this;
  removeListener(event: "close", listener: (code: number | null) => void): this;
}

export interface RunCommandDependencies {
  spawnProcess?(
    command: string,
    args: string[],
    options: { cwd?: string; env: NodeJS.ProcessEnv }
  ): SpawnedProcess;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export function commandToString(input: CommandInput): string {
  return [input.command, ...input.args].join(" ");
}

export function truncateOutput(value: string, maxLines = 12): string {
  return value.trim().split(/\r?\n/).slice(0, maxLines).join("\n");
}

export function formatCommandFailure(input: CommandInput, result: CommandResult, redact: (value: string) => string): string {
  const command = redact(commandToString(input));
  const output = truncateOutput(result.stderr || result.stdout || `exit ${result.exitCode}`);
  return `${command} failed\n${redact(output)}`;
}

export function runCommand(input: CommandInput, dependencies: RunCommandDependencies = {}): Promise<CommandResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = { ...process.env, ...input.env };
  const child =
    dependencies.spawnProcess?.(input.command, input.args, { cwd: input.cwd, env }) ??
    spawn(input.command, input.args, {
      cwd: input.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      child.stdout.removeListener("data", onStdout);
      child.stderr.removeListener("data", onStderr);
    };

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 1000);
    }, timeoutMs);

    function onStdout(chunk: Buffer | string) {
      stdout += chunk.toString();
    }

    function onStderr(chunk: Buffer | string) {
      stderr += chunk.toString();
    }

    function onError(error: Error) {
      settle(() => reject(error));
    }

    function onClose(code: number | null) {
      if (timedOut) {
        settle(() => reject(new Error(`${input.command} timed out after ${timeoutMs}ms`)));
        return;
      }

      settle(() => resolve({ exitCode: code ?? 1, stdout, stderr }));
    }

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", onError);
    child.on("close", onClose);
  });
}
