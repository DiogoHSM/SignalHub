import { readFile, stat } from "node:fs/promises";
import path from "node:path";

type Io = {
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

type ParsedArgs = {
  endpoint?: string;
  token?: string;
  projectId?: string;
  environmentId?: string;
  release?: string;
  file?: string;
  bundle?: string;
  minifiedFile?: string;
};

type ValidatedInput = ParsedArgs & {
  endpoint: string;
  token: string;
  projectId: string;
  environmentId: string;
  release: string;
};

type SourceMapUploadResponse = {
  artifacts?: Array<{
    minifiedFile?: string;
  }>;
};

const optionMap: Record<string, keyof ParsedArgs> = {
  "--endpoint": "endpoint",
  "--token": "token",
  "--project-id": "projectId",
  "--environment-id": "environmentId",
  "--release": "release",
  "--file": "file",
  "--bundle": "bundle",
  "--minified-file": "minifiedFile"
};

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith("--")) {
      throw new Error("Unknown argument");
    }

    const key = optionMap[arg];
    if (!key) {
      throw new Error("Unknown option");
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    parsed[key] = value;
    index += 1;
  }

  return parsed;
}

function withEnv(parsed: ParsedArgs, env: NodeJS.ProcessEnv): ParsedArgs {
  return {
    ...parsed,
    endpoint: parsed.endpoint ?? env.SIGNALHUB_ENDPOINT,
    token: parsed.token ?? env.SIGNALHUB_SOURCE_MAP_TOKEN,
    projectId: parsed.projectId ?? env.SIGNALHUB_PROJECT_ID,
    environmentId: parsed.environmentId ?? env.SIGNALHUB_ENVIRONMENT_ID,
    release: parsed.release ?? env.SIGNALHUB_RELEASE
  };
}

function validate(input: ParsedArgs): asserts input is ValidatedInput {
  const required: Array<[keyof ParsedArgs, string]> = [
    ["endpoint", "--endpoint or SIGNALHUB_ENDPOINT"],
    ["token", "--token or SIGNALHUB_SOURCE_MAP_TOKEN"],
    ["projectId", "--project-id or SIGNALHUB_PROJECT_ID"],
    ["environmentId", "--environment-id or SIGNALHUB_ENVIRONMENT_ID"],
    ["release", "--release or SIGNALHUB_RELEASE"]
  ];

  for (const [key, label] of required) {
    if (!input[key]) {
      throw new Error(`Missing required option ${label}`);
    }
  }

  if (Boolean(input.file) === Boolean(input.bundle)) {
    throw new Error("Provide exactly one of --file or --bundle");
  }

  if (input.bundle && input.minifiedFile) {
    throw new Error("--minified-file can only be used with --file");
  }
}

function uploadUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/v1/source-maps`;
}

async function readUploadFile(filePath: string): Promise<Buffer> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      throw new Error("not_regular_file");
    }
    return await readFile(filePath);
  } catch {
    throw new Error(`Upload file is not readable: ${filePath}`);
  }
}

function redactMessage(message: string, token: string | undefined): string {
  if (!token) {
    return message;
  }
  return message.split(token).join("[redacted]");
}

function createUploadBody(input: ValidatedInput, uploadPath: string, content: Buffer): FormData {
  const body = new FormData();
  const field = input.file ? "file" : "bundle";
  const type = input.file ? "application/json" : "application/zip";
  const bytes = new Uint8Array(content.byteLength);
  bytes.set(content);

  body.set("project_id", input.projectId);
  body.set("environment_id", input.environmentId);
  body.set("release", input.release);
  if (input.minifiedFile) {
    body.set("minified_file", input.minifiedFile);
  }
  body.set(field, new Blob([bytes], { type }), path.basename(uploadPath));

  return body;
}

export async function runSourceMapUploadCommand(args: string[], io: Io): Promise<number> {
  let token: string | undefined;

  try {
    const input = withEnv(parseArgs(args), io.env);
    token = input.token;
    validate(input);

    const uploadPath = input.file ?? input.bundle;
    if (!uploadPath) {
      throw new Error("Provide exactly one of --file or --bundle");
    }

    const content = await readUploadFile(uploadPath);
    const response = await fetch(uploadUrl(input.endpoint), {
      method: "POST",
      headers: { authorization: `Bearer ${input.token}` },
      body: createUploadBody(input, uploadPath, content)
    });

    if (!response.ok) {
      io.stderr(`Source map upload failed with HTTP ${response.status}.`);
      return 1;
    }

    const payload = (await response.json()) as SourceMapUploadResponse;
    const artifacts = payload.artifacts ?? [];

    io.stdout(`Uploaded ${artifacts.length} source map artifact(s) for release ${input.release}.`);
    for (const artifact of artifacts) {
      if (artifact.minifiedFile) {
        io.stdout(`- ${artifact.minifiedFile}`);
      }
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source map upload failed.";
    io.stderr(redactMessage(message, token));
    return 1;
  }
}
