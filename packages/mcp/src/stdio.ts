#!/usr/bin/env node
/**
 * `sigmon-mcp` bin entrypoint (stdio transport). Reads `SIGMON_URL`/`SIGMON_READ_TOKEN` from the
 * environment, builds the typed client and the tool registry from `server.ts`, and connects the
 * stdio transport. Fails fast to stderr with a non-zero exit if either variable is missing — this
 * is a local process an agent host spawns, so there's no other place to surface a config mistake.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { SigmonClient } from "./client.js";
import { createSigmonMcpServer } from "./server.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`sigmon-mcp: missing required environment variable ${name}. Set SIGMON_URL and SIGMON_READ_TOKEN before starting.\n`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const baseUrl = requireEnv("SIGMON_URL");
  const readToken = requireEnv("SIGMON_READ_TOKEN");

  const client = new SigmonClient({ baseUrl, readToken });
  const server = createSigmonMcpServer(client, { allowRawDetail: process.env.MCP_ALLOW_RAW_DETAIL === "true" });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sigmon-mcp: fatal error: ${message}\n`);
  process.exit(1);
});
