/**
 * Registers all nine SignalMonitor investigation tools against `@modelcontextprotocol/sdk`'s
 * server. Deliberately transport-agnostic: this file only builds a `Server` instance. Connecting
 * it to a transport (stdio today, per `stdio.ts`; HTTP in fase 3) is the caller's job, so a later
 * transport is a new file importing `createSigmonMcpServer`, not a rewrite of this one.
 *
 * The nine tool modules under `tools/` were built in two independent batches and don't share one
 * export convention:
 *   - `describe_scope` / `whats_broken` / `investigate_error` / `trace_request` export a Zod
 *     raw-shape `inputSchema` and bundle the handler directly on the tool object (`tool.handler`).
 *   - `slow_endpoints` / `user_journey` / `llm_costs` / `search_events` / `query` export an
 *     already-built JSON Schema `inputSchema` and keep the handler as a separate `handleXxx`
 *     export.
 * Rather than force one convention onto the other, this file normalizes both into one internal
 * `ToolEntry` shape used to answer `tools/list` and dispatch `tools/call`: a JSON Schema (Zod
 * shapes are converted with `z.toJSONSchema`) and a single `execute` function.
 *
 * Error contract: none of the nine tool handlers catch or reformat errors themselves — they let
 * `SigmonClientError` (the 401/403/scope-mismatch mapping centralized once in `client.ts`) and,
 * for `query`, `QueryToolInputError` (malformed tool input) propagate untouched. This file is the
 * single place that turns a thrown error into an MCP tool error result: it reports `isError: true`
 * with only `error.message` — never a stack, never other internal detail — regardless of which of
 * those two error types (or an unexpected one) was thrown.
 */

import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";

import type { SigmonClient } from "./client.js";

import { describeScopeTool } from "./tools/describe_scope.js";
import { whatsBrokenTool } from "./tools/whats_broken.js";
import { investigateErrorTool } from "./tools/investigate_error.js";
import { traceRequestTool } from "./tools/trace_request.js";
import { slowEndpointsTool, handleSlowEndpoints } from "./tools/slow_endpoints.js";
import { userJourneyTool, handleUserJourney } from "./tools/user_journey.js";
import { llmCostsTool, handleLlmCosts } from "./tools/llm_costs.js";
import { searchEventsTool, handleSearchEvents } from "./tools/search_events.js";
import { queryTool, handleQuery } from "./tools/query.js";

type ToolInputSchema = Tool["inputSchema"];

interface ToolEntry {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute: (client: SigmonClient, rawArgs: Record<string, unknown>) => Promise<unknown>;
}

/** Batch A adapter: Zod raw-shape `inputSchema` + bundled `handler`. */
function fromZodShapeTool<Shape extends z.ZodRawShape, R>(tool: {
  name: string;
  description: string;
  inputSchema: Shape;
  handler: (client: SigmonClient, input: z.infer<z.ZodObject<Shape>>) => Promise<R>;
}): ToolEntry {
  const schema = z.object(tool.inputSchema);
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(schema) as ToolInputSchema,
    execute: (client, rawArgs) => tool.handler(client, schema.parse(rawArgs))
  };
}

/** Batch B adapter: pre-built JSON Schema `inputSchema` + a separate `handleXxx` function. */
function fromJsonSchemaTool<Input>(
  tool: { name: string; description: string; inputSchema: Record<string, unknown> },
  handler: (client: SigmonClient, input: Input) => Promise<unknown>
): ToolEntry {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as ToolInputSchema,
    execute: (client, rawArgs) => handler(client, rawArgs as Input)
  };
}

const TOOLS: ToolEntry[] = [
  fromZodShapeTool(describeScopeTool),
  fromZodShapeTool(whatsBrokenTool),
  fromZodShapeTool(investigateErrorTool),
  fromZodShapeTool(traceRequestTool),
  fromJsonSchemaTool(slowEndpointsTool, handleSlowEndpoints),
  fromJsonSchemaTool(userJourneyTool, handleUserJourney),
  fromJsonSchemaTool(llmCostsTool, handleLlmCosts),
  fromJsonSchemaTool(searchEventsTool, handleSearchEvents),
  fromJsonSchemaTool(queryTool, handleQuery)
];

/** Tool names, in registration order — the design doc's "As nove tools" table order. */
export const TOOL_NAMES: readonly string[] = TOOLS.map((tool) => tool.name);

/** Builds a `Server` with all nine tools registered, ready to `connect()` to any transport. */
export function createSigmonMcpServer(client: SigmonClient): Server {
  const server = new Server({ name: "sigmon-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((entry) => entry.name === request.params.name);
    if (!tool) {
      return { isError: true, content: [{ type: "text" as const, text: `unknown tool: ${request.params.name}` }] };
    }

    try {
      const result = await tool.execute(client, (request.params.arguments ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      // Never surface a stack or raw error object — only the message, which is where
      // SigmonClientError (client.ts) and QueryToolInputError (tools/query.ts) put their
      // already-readable, no-internal-detail text.
      const message = error instanceof Error ? error.message : "unexpected error";
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
  });

  return server;
}
