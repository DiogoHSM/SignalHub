import type { SmokeOptions } from "./types.js";

const DEFAULT_PROJECT_NAME = "signalhub_smoke";
const DEFAULT_API_URL = "http://localhost:3000";

export function parseSmokeArgs(args: string[], env: Record<string, string | undefined>): SmokeOptions {
  const options: SmokeOptions = {
    projectName: normalizeValue(env.SIGNALHUB_SMOKE_PROJECT_NAME) || DEFAULT_PROJECT_NAME,
    apiUrl: normalizeApiUrl(env.SIGNALHUB_SMOKE_API_URL) || DEFAULT_API_URL,
    preserve: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--project-name") {
      options.projectName = readValue(args, index, "--project-name");
      index += 1;
      continue;
    }

    if (arg === "--api-url") {
      options.apiUrl = stripTrailingSlash(readValue(args, index, "--api-url"));
      index += 1;
      continue;
    }

    if (arg === "--preserve") {
      options.preserve = true;
      continue;
    }

    throw new Error(`Unknown smoke argument: ${arg}`);
  }

  return options;
}

function readValue(args: string[], index: number, flag: string): string {
  const value = normalizeValue(args[index + 1]);

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function normalizeApiUrl(value: string | undefined): string {
  const normalized = normalizeValue(value);
  return normalized ? stripTrailingSlash(normalized) : "";
}

function normalizeValue(value: string | undefined): string {
  return value?.trim() ?? "";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
