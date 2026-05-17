import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceMapFixtureContent } from "./fixtures.js";
import type { GeneratedSecrets, SmokeResources } from "./types.js";

export function defaultSmokeSecrets(runId: string): GeneratedSecrets {
  return {
    postgresPassword: `${runId}-postgres-password-00000000000000000000`,
    sessionSecret: `${runId}-session-secret-000000000000000000000000`,
    apiKeyPepper: `${runId}-api-key-pepper-000000000000000000000`,
    adminEmail: `${runId}-admin@example.com`,
    adminPassword: `${runId}-admin-password-00000000000000000000`
  };
}

export function createSmokeEnvContent(envExample: string, secrets: GeneratedSecrets, apiUrl: string): string {
  const databaseUrl = `postgres://signalhub:${secrets.postgresPassword}@localhost:5432/signalhub`;
  const replacements = new Map([
    ["signalhub-local-only-change-me", secrets.postgresPassword],
    ["change-me-to-a-long-random-secret", secrets.sessionSecret],
    ["change-me-to-a-long-random-pepper", secrets.apiKeyPepper],
    ["change-me-admin-password-32-chars-min", secrets.adminPassword],
    ["admin@example.com", secrets.adminEmail]
  ]);

  let output = envExample;
  for (const [from, to] of replacements) {
    output = output.split(from).join(to);
  }

  const lines = output.split(/\r?\n/);
  const upsert = (key: string, value: string) => {
    const prefix = `${key}=`;
    const index = lines.findIndex((line) => line.startsWith(prefix));
    if (index === -1) {
      lines.push(`${key}=${value}`);
    } else {
      lines[index] = `${key}=${value}`;
    }
  };

  upsert("DATABASE_URL", databaseUrl);
  upsert("SIGNALHUB_PUBLIC_ENDPOINT", apiUrl);
  upsert("BOOTSTRAP_ADMIN_EMAIL", secrets.adminEmail);
  upsert("BOOTSTRAP_ADMIN_PASSWORD", secrets.adminPassword);

  return lines.join("\n");
}

export async function writeSmokeResources(input: {
  tempRoot?: string;
  envExamplePath: string;
  apiUrl: string;
  runId: string;
}): Promise<SmokeResources & { secrets: GeneratedSecrets }> {
  const tempDir = input.tempRoot ?? (await mkdtemp(join(tmpdir(), "signalhub-smoke-")));
  const secrets = defaultSmokeSecrets(input.runId);
  const envExample = await readFile(input.envExamplePath, "utf8");
  const envFile = join(tempDir, ".env");
  const sourceMapFile = join(tempDir, "app.min.js.map");

  await writeFile(envFile, createSmokeEnvContent(envExample, secrets, input.apiUrl));
  await writeFile(sourceMapFile, sourceMapFixtureContent());

  return { tempDir, envFile, sourceMapFile, secrets };
}
