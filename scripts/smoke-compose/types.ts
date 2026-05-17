export interface SmokeOptions {
  projectName: string;
  apiUrl: string;
  preserve: boolean;
}

export interface SmokeSummaryContext {
  commit: string;
  projectName: string;
  apiUrl: string;
}

export type StepStatus = "pass" | "warn" | "fail";

export interface StepResult {
  status: StepStatus;
  name: string;
  detail?: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandInput {
  command: string;
  args: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  timeoutMs?: number;
  allowFailure?: boolean;
}

export interface GeneratedSecrets {
  postgresPassword: string;
  sessionSecret: string;
  apiKeyPepper: string;
  adminEmail: string;
  adminPassword: string;
}

export interface SmokeResources {
  tempDir: string;
  envFile: string;
  sourceMapFile: string;
}
