import { describe, expect, it, vi } from "vitest";
import { SigmonClient, SigmonClientError } from "./client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function makeClient(fetchImpl: typeof fetch) {
  return new SigmonClient({
    baseUrl: "https://sigmon.example.test",
    readToken: "shread_test_token",
    fetch: fetchImpl
  });
}

describe("SigmonClient", () => {
  it("sends the bearer header and returns the parsed data on success", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { data: { calls: 12, failedCalls: 1, costUsd: "1.2300", avgTokens: 100, avgLatencyMs: 250, p95LatencyMs: 400 } })
    );

    const client = makeClient(fetchMock as unknown as typeof fetch);
    const summary = await client.getLlmSummary({ window: "7d" });

    expect(summary).toEqual({ calls: 12, failedCalls: 1, costUsd: "1.2300", avgTokens: 100, avgLatencyMs: 250, p95LatencyMs: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(init?.headers).toMatchObject({ Authorization: "Bearer shread_test_token" });
    const requestUrl = new URL(String(url));
    expect(requestUrl.pathname).toBe("/query/llm/summary");
    expect(requestUrl.searchParams.get("window")).toBe("7d");
  });

  it("maps a 401 to the readable, no-detail unauthenticated message", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, { error: "unauthenticated" }));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    await expect(client.getOperations()).rejects.toMatchObject({
      name: "SigmonClientError",
      code: "unauthenticated",
      status: 401,
      message: "token inválido ou revogado; gere outro em Project Settings → Read tokens"
    });
  });

  it("maps a 403 read_token_is_read_only response to the read-only message", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(403, { error: "read_token_is_read_only" }));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    let caught: unknown;
    try {
      await client.getOperations();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SigmonClientError);
    expect((caught as SigmonClientError).code).toBe("read_token_is_read_only");
    expect((caught as SigmonClientError).message).toBe("este token é somente leitura");
  });

  it("maps a 403 read_token_scope_insufficient response to a named scope-mismatch error", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(403, { error: "read_token_scope_insufficient" }));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    await expect(client.getOperations()).rejects.toMatchObject({
      code: "read_token_scope_insufficient",
      status: 403
    });
  });

  it("serializes query params correctly for a route with several filters", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, { data: [], cursor: null }));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    await client.listErrorGroups({
      status: "open",
      severity: "critical",
      tenantId: "tenant-1",
      userId: "user-1",
      release: "web@1.4.2",
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-20T00:00:00.000Z",
      limit: 25,
      cursor: "opaque-cursor"
    });

    const [url] = fetchMock.mock.calls[0]!;
    const requestUrl = new URL(String(url));
    expect(requestUrl.pathname).toBe("/query/error-groups");
    expect(requestUrl.searchParams.get("status")).toBe("open");
    expect(requestUrl.searchParams.get("severity")).toBe("critical");
    expect(requestUrl.searchParams.get("tenant_id")).toBe("tenant-1");
    expect(requestUrl.searchParams.get("user_id")).toBe("user-1");
    expect(requestUrl.searchParams.get("release")).toBe("web@1.4.2");
    expect(requestUrl.searchParams.get("from")).toBe("2026-08-01T00:00:00.000Z");
    expect(requestUrl.searchParams.get("to")).toBe("2026-08-20T00:00:00.000Z");
    expect(requestUrl.searchParams.get("limit")).toBe("25");
    expect(requestUrl.searchParams.get("cursor")).toBe("opaque-cursor");
    // The token's own scope always wins, but the API still requires the params to be present.
    expect(requestUrl.searchParams.get("project_id")).toBe("read-token-scoped");
    expect(requestUrl.searchParams.get("environment_id")).toBe("read-token-scoped");
  });

  it("throws when constructed without a readToken", () => {
    expect(() => new SigmonClient({ baseUrl: "https://sigmon.example.test", readToken: "" })).toThrow(/readToken/);
  });
});
