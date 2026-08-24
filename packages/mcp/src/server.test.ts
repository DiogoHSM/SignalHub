import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { SigmonClient } from "./client.js";
import { createSigmonMcpServer, TOOL_NAMES } from "./server.js";

const EXPECTED_TOOL_NAMES = [
  "describe_scope",
  "whats_broken",
  "investigate_error",
  "trace_request",
  "slow_endpoints",
  "user_journey",
  "llm_costs",
  "search_events",
  "query"
];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeSigmonClient(fetchImpl: typeof fetch): SigmonClient {
  return new SigmonClient({ baseUrl: "https://sigmon.example.test", readToken: "shread_test_token", fetch: fetchImpl });
}

async function connectedClient(sigmonClient: SigmonClient): Promise<Client> {
  const server = createSigmonMcpServer(sigmonClient);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("createSigmonMcpServer", () => {
  it("exposes exactly the nine design-doc tools, by name", async () => {
    expect(TOOL_NAMES).toEqual(EXPECTED_TOOL_NAMES);

    const fetchMock = vi.fn(async () => jsonResponse(200, { data: {} }));
    const client = await connectedClient(makeSigmonClient(fetchMock as unknown as typeof fetch));

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(9);
    expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());

    await client.close();
  });

  it("surfaces a 401 end-to-end as the readable design-doc message, not a raw error", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, { error: "unauthenticated" }));
    const client = await connectedClient(makeSigmonClient(fetchMock as unknown as typeof fetch));

    const result = await client.callTool({ name: "whats_broken", arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "token inválido ou revogado; gere outro em Project Settings → Read tokens" }
    ]);
    // No stack, no raw error object/status leaking into the message an agent sees.
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    expect(text).not.toMatch(/at .*\(.*:\d+:\d+\)/);
    expect(text).not.toContain("SigmonClientError");

    await client.close();
  });

  it("surfaces a 403 read-only rejection end-to-end as the readable message", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(403, { error: "read_token_is_read_only" }));
    const client = await connectedClient(makeSigmonClient(fetchMock as unknown as typeof fetch));

    const result = await client.callTool({ name: "describe_scope", arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "este token é somente leitura" }]);

    await client.close();
  });

  it("surfaces a scope-mismatch 403 end-to-end as its own named message", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(403, { error: "read_token_scope_insufficient" }));
    const client = await connectedClient(makeSigmonClient(fetchMock as unknown as typeof fetch));

    const result = await client.callTool({ name: "trace_request", arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "this read token's scope does not cover the requested resource" }]);

    await client.close();
  });

  it("rejects an unknown tool name without throwing", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: {} }));
    const client = await connectedClient(makeSigmonClient(fetchMock as unknown as typeof fetch));

    const result = await client.callTool({ name: "not_a_real_tool", arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "unknown tool: not_a_real_tool" }]);

    await client.close();
  });
});
