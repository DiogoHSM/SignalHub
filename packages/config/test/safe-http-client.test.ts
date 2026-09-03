import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, LookupFunction } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { OutboundPolicy, safeHttpRequest } from "../src/index.js";

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const openServers: TestServer[] = [];

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<TestServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const testServer = {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
  openServers.push(testServer);
  return testServer;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

function loopbackPolicy(): OutboundPolicy {
  return new OutboundPolicy({ nodeEnv: "test", allowLoopback: true });
}

describe("safeHttpRequest", () => {
  it("returns only bounded response data from an explicitly allowed development loopback target", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain", "x-result": "ok" });
      response.end("healthy");
    });

    const response = await safeHttpRequest({
      url: `${server.origin}/health?probe=1`,
      method: "GET",
      timeoutMs: 1_000,
      maxResponseBytes: 64,
      policy: loopbackPolicy()
    });

    expect(response).toMatchObject({ status: 200, body: "healthy", headers: { "x-result": "ok" } });
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects unsupported methods, request bodies on GET/HEAD, and invalid bounds before connection", async () => {
    const policy = loopbackPolicy();

    await expect(
      safeHttpRequest({ url: "http://127.0.0.1:1", method: "DELETE" as "GET", timeoutMs: 100, policy })
    ).rejects.toThrow("outbound_http_method_forbidden");
    await expect(
      safeHttpRequest({ url: "http://127.0.0.1:1", method: "GET", body: "secret", timeoutMs: 100, policy })
    ).rejects.toThrow("outbound_http_body_forbidden");
    await expect(
      safeHttpRequest({ url: "http://127.0.0.1:1", method: "GET", timeoutMs: 0, policy })
    ).rejects.toThrow("outbound_http_options_invalid");
    await expect(
      safeHttpRequest({
        url: "http://127.0.0.1:1",
        method: "GET",
        timeoutMs: 100,
        maxResponseBytes: Number.POSITIVE_INFINITY,
        policy
      })
    ).rejects.toThrow("outbound_http_options_invalid");
  });

  it("rejects mixed public/private DNS answers at the lookup used by the actual socket", async () => {
    const lookup: LookupFunction = (_hostname, options, callback) => {
      expect(options).toMatchObject({ all: true, verbatim: true });
      callback(
        null,
        [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 }
        ],
        4
      );
    };

    await expect(
      safeHttpRequest({
        url: "http://public.example.test/health",
        method: "GET",
        timeoutMs: 500,
        policy: new OutboundPolicy({ nodeEnv: "production" }),
        lookup
      })
    ).rejects.toThrow("outbound_http_target_forbidden");
  });

  it("enforces one deadline while DNS is unresolved and does not allow a late success", async () => {
    let callback: Parameters<LookupFunction>[2] | undefined;
    const lookup: LookupFunction = (_hostname, _options, done) => {
      callback = done;
    };

    const request = safeHttpRequest({
      url: "http://public.example.test/health",
      method: "GET",
      timeoutMs: 25,
      policy: new OutboundPolicy({ nodeEnv: "production" }),
      lookup
    });

    await expect(request).rejects.toThrow("outbound_http_timeout");
    callback?.(null, [{ address: "93.184.216.34", family: 4 }], 4);
    await expect(request).rejects.toThrow("outbound_http_timeout");
  });

  it("destroys an oversized response instead of buffering or waiting for the peer", async () => {
    let socketClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      socketClosed = resolve;
    });
    const server = await startServer((_request, response) => {
      response.socket?.once("close", () => socketClosed());
      response.write("0123456789");
      setTimeout(() => response.end("late"), 500);
    });

    await expect(
      safeHttpRequest({
        url: `${server.origin}/large`,
        method: "GET",
        timeoutMs: 1_000,
        maxResponseBytes: 4,
        policy: loopbackPolicy()
      })
    ).rejects.toThrow("outbound_http_response_too_large");
    await expect(Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error("socket open")), 250))]))
      .resolves.toBeUndefined();
  });

  it("revalidates redirect targets and rejects a redirect to a private address", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(302, { location: "http://10.0.0.1/internal?token=secret" });
      response.end();
    });

    await expect(
      safeHttpRequest({
        url: `${server.origin}/start`,
        method: "GET",
        timeoutMs: 1_000,
        redirectLimit: 1,
        policy: loopbackPolicy()
      })
    ).rejects.toThrow("outbound_http_target_forbidden");
  });

  it("uses the original deadline across redirects and strips all caller headers across origins", async () => {
    const receivedHeaders: Array<Record<string, string | string[] | undefined>> = [];
    const destination = await startServer((request, response) => {
      receivedHeaders.push(request.headers);
      setTimeout(() => response.end("late"), 80);
    });
    const redirector = await startServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(302, { location: `${destination.origin}/next` });
        response.end();
      }, 35);
    });

    await expect(
      safeHttpRequest({
        url: `${redirector.origin}/start`,
        method: "GET",
        headers: { Authorization: "Bearer secret", "X-Caller-Secret": "secret" },
        timeoutMs: 75,
        redirectLimit: 1,
        policy: loopbackPolicy()
      })
    ).rejects.toThrow("outbound_http_timeout");
    expect(receivedHeaders).toHaveLength(1);
    expect(receivedHeaders[0]?.authorization).toBeUndefined();
    expect(receivedHeaders[0]?.["x-caller-secret"]).toBeUndefined();
  });

  it("detects redirect loops without disclosing a credential-bearing path", async () => {
    let origin = "";
    const server = await startServer((_request, response) => {
      response.writeHead(302, { location: `${origin}/secret/path?token=super-secret` });
      response.end();
    });
    origin = server.origin;

    const result = safeHttpRequest({
      url: `${server.origin}/secret/path?token=super-secret`,
      method: "GET",
      timeoutMs: 1_000,
      redirectLimit: 2,
      policy: loopbackPolicy()
    });

    await expect(result).rejects.toThrow("outbound_http_redirect_loop");
    await result.catch((error: Error) => {
      expect(error.message).not.toContain("secret/path");
      expect(error.message).not.toContain("super-secret");
    });
  });
});
