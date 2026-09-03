import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "node:net";
import { BrowserOriginCache, buildApp } from "../src/app.js";
import { closeRateLimitRedis, createRateLimitRedis } from "../src/rate-limit-redis.js";

let app: FastifyInstance | undefined;

async function unavailableRedisUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP address");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return `redis://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("API hardening", () => {
  async function buildIpObserver(options: Parameters<typeof buildApp>[0] = {
    readiness: async () => ({ postgres: true, redis: true })
  }) {
    app = await buildApp(options);
    app.get("/__test/request-ip", async (request) => ({
      ip: request.ip,
      ips: request.ips
    }));
    return app;
  }

  it("sets baseline security headers", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      nodeEnv: "production"
    });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("returns sanitized JSON for unexpected route errors", async () => {
    app = await buildApp({
      readiness: async () => {
        throw new Error("database password=super-secret exploded");
      },
      nodeEnv: "production"
    });

    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal_server_error" });
    expect(response.body).not.toContain("super-secret");
  });

  it("does not accept forwarded identity from an untrusted immediate peer", async () => {
    const ipObserver = await buildIpObserver({
      readiness: async () => ({ postgres: true, redis: true }),
      nodeEnv: "test",
      trustProxy: ["10.0.0.0/8"]
    });

    const response = await ipObserver.inject({
      method: "GET",
      url: "/__test/request-ip",
      remoteAddress: "192.0.2.44",
      headers: { "x-forwarded-for": "203.0.113.70" }
    });

    expect(response.json()).toEqual({ ip: "192.0.2.44", ips: ["192.0.2.44"] });
  });

  it("resolves the rightmost untrusted client behind an explicitly trusted proxy", async () => {
    const ipObserver = await buildIpObserver({
      readiness: async () => ({ postgres: true, redis: true }),
      nodeEnv: "test",
      trustProxy: ["10.0.0.0/8"]
    });

    const response = await ipObserver.inject({
      method: "GET",
      url: "/__test/request-ip",
      remoteAddress: "10.0.0.4",
      headers: { "x-forwarded-for": "198.51.100.20, 203.0.113.70" }
    });

    expect(response.json()).toEqual({
      ip: "203.0.113.70",
      ips: ["10.0.0.4", "203.0.113.70"]
    });
  });

  it("ignores forwarded identity with the empty default proxy configuration", async () => {
    const ipObserver = await buildIpObserver({
      readiness: async () => ({ postgres: true, redis: true }),
      nodeEnv: "test"
    });

    const response = await ipObserver.inject({
      method: "GET",
      url: "/__test/request-ip",
      remoteAddress: "192.0.2.44",
      headers: { "x-forwarded-for": "203.0.113.70" }
    });

    expect(response.json()).toEqual({ ip: "192.0.2.44" });
  });

  it("limits IPv6 clients by a normalized /64 key", async () => {
    const ipObserver = await buildIpObserver({
      readiness: async () => ({ postgres: true, redis: true }),
      nodeEnv: "test",
      trustProxy: ["10.0.0.0/8"],
      rateLimit: { max: 1, timeWindow: 60_000 }
    });

    const first = await ipObserver.inject({
      method: "GET",
      url: "/__test/request-ip",
      remoteAddress: "10.0.0.4",
      headers: { "x-forwarded-for": "2001:db8:1:2::1" }
    });
    const second = await ipObserver.inject({
      method: "GET",
      url: "/__test/request-ip",
      remoteAddress: "10.0.0.5",
      headers: { "x-forwarded-for": "2001:db8:1:2::2" }
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
  });

  it("limits OPTIONS probes before another asynchronous browser-origin lookup", async () => {
    const isBrowserCorsOriginAllowed = vi.fn(async (origin: string) => origin === "https://allowed.example.com");
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      isBrowserCorsOriginAllowed,
      rateLimit: { max: 2, timeWindow: 60_000 }
    });

    const allowed = await app.inject({
      method: "OPTIONS",
      url: "/v1/events",
      headers: { origin: "https://allowed.example.com" }
    });
    const denied = await app.inject({
      method: "OPTIONS",
      url: "/v1/events",
      headers: { origin: "https://denied.example.com" }
    });
    const blocked = await app.inject({
      method: "OPTIONS",
      url: "/v1/events",
      headers: { origin: "https://third.example.com" }
    });

    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://allowed.example.com");
    expect(denied.statusCode).not.toBe(429);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    expect(blocked.statusCode).toBe(429);
    expect(isBrowserCorsOriginAllowed).toHaveBeenCalledTimes(2);
  });

  it("uses a bounded positive-and-negative browser-origin cache with deterministic expiry and eviction", async () => {
    let now = 1_000;
    const lookup = vi.fn(async (origin: string) => origin !== "https://denied.example.com");
    const cache = new BrowserOriginCache(lookup, {
      ttlMs: 60_000,
      maxEntries: 2,
      now: () => now
    });

    await expect(cache.isAllowed("https://allowed.example.com")).resolves.toBe(true);
    await expect(cache.isAllowed("https://allowed.example.com")).resolves.toBe(true);
    await expect(cache.isAllowed("https://denied.example.com")).resolves.toBe(false);
    await expect(cache.isAllowed("https://denied.example.com")).resolves.toBe(false);
    expect(lookup.mock.calls.map(([origin]) => origin)).toEqual([
      "https://allowed.example.com",
      "https://denied.example.com"
    ]);

    await expect(cache.isAllowed("not an origin")).resolves.toBe(false);
    expect(lookup).toHaveBeenCalledTimes(2);

    await expect(cache.isAllowed("https://third.example.com")).resolves.toBe(true);
    await expect(cache.isAllowed("https://allowed.example.com")).resolves.toBe(true);
    expect(lookup.mock.calls.map(([origin]) => origin)).toEqual([
      "https://allowed.example.com",
      "https://denied.example.com",
      "https://third.example.com",
      "https://allowed.example.com"
    ]);

    now += 60_001;
    await expect(cache.isAllowed("https://allowed.example.com")).resolves.toBe(true);
    expect(lookup).toHaveBeenCalledTimes(5);
  });

  it.each([
    "https://user:password@example.com",
    "https://@example.com",
    "https://example.com/path",
    "https://example.com?query=value",
    "https://example.com#fragment",
    "https://example.com/",
    "ftp://example.com",
    "https://%65xample.com",
    "https://example%2ecom",
    "https://example.com:",
    "https://example.com:0443",
    "https://EXAMPLE.com",
    "https://example.com:443",
    "https://example.com.",
    "http://0177.0.0.1",
    "http://2130706433",
    "https://[2001:0db8:0000::1]"
  ])("rejects non-serialized browser Origin %s before cache lookup", async (origin) => {
    const lookup = vi.fn().mockResolvedValue(true);
    const cache = new BrowserOriginCache(lookup);

    await expect(cache.isAllowed(origin)).resolves.toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    "https://public.example.com",
    "https://public.example.com:8443",
    "https://[2001:db8::1]:8443"
  ])("accepts exact serialized browser Origin %s", async (origin) => {
    const lookup = vi.fn().mockResolvedValue(true);
    const cache = new BrowserOriginCache(lookup);

    await expect(cache.isAllowed(origin)).resolves.toBe(true);
    expect(lookup).toHaveBeenCalledWith(origin);
  });

  it("rejects malformed browser Origin headers before lookup or CORS authorization", async () => {
    const lookup = vi.fn().mockResolvedValue(true);
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      isBrowserCorsOriginAllowed: lookup
    });

    for (const origin of [
      "https://user:password@example.com",
      "https://@example.com",
      "https://example.com/path",
      "https://example.com?query=value",
      "https://example.com#fragment",
      "https://example.com/",
      "https://%65xample.com",
      "https://example%2ecom",
      "https://example.com:",
      "https://example.com:0443",
      "https://EXAMPLE.com",
      "https://example.com:443",
      "https://example.com.",
      "http://0177.0.0.1",
      "http://2130706433",
      "https://[2001:0db8:0000::1]"
    ]) {
      const response = await app.inject({ method: "OPTIONS", url: "/v1/events", headers: { origin } });
      expect(response.statusCode).not.toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    }

    expect(lookup).not.toHaveBeenCalled();
  });

  it("fails closed promptly before origin lookup when the rate-limit Redis store is unreachable", async () => {
    const rateLimitRedis = createRateLimitRedis(await unavailableRedisUrl(), {
      connectTimeoutMs: 50,
      commandTimeoutMs: 50,
      socketTimeoutMs: 50,
      retryDelayMs: 10,
      onError: () => undefined
    });
    const lookup = vi.fn().mockResolvedValue(true);

    try {
      app = await buildApp({
        readiness: async () => ({ postgres: true, redis: false }),
        isBrowserCorsOriginAllowed: lookup,
        rateLimitRedis
      });
      const timedOut = Symbol("timed-out");
      const response = await Promise.race([
        app.inject({
          method: "OPTIONS",
          url: "/v1/events",
          headers: { origin: "https://allowed.example.com" }
        }),
        new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), 500))
      ]);

      expect(response).not.toBe(timedOut);
      if (response === timedOut) throw new Error("rate-limit request did not settle");
      expect(response.statusCode).toBeGreaterThanOrEqual(500);
      expect(response.statusCode).toBeLessThan(600);
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      await closeRateLimitRedis(rateLimitRedis);
    }
  });

  it("does not cache failed browser-origin lookups or poison a later healthy result", async () => {
    const lookup = vi.fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(true);
    const cache = new BrowserOriginCache(lookup);

    await expect(cache.isAllowed("https://recovered.example.com")).rejects.toThrow("database unavailable");
    await expect(cache.isAllowed("https://recovered.example.com")).resolves.toBe(true);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("does not let an in-flight lookup restore an origin after invalidation", async () => {
    let resolveLookup: ((allowed: boolean) => void) | undefined;
    const lookup = vi.fn()
      .mockImplementationOnce(
        () => new Promise<boolean>((resolve) => {
          resolveLookup = resolve;
        })
      )
      .mockResolvedValueOnce(false);
    const cache = new BrowserOriginCache(lookup);

    const pendingLookup = cache.isAllowed("https://archived.example.com");
    cache.invalidate("https://archived.example.com");
    resolveLookup?.(true);

    await expect(pendingLookup).resolves.toBe(false);
    await expect(cache.isAllowed("https://archived.example.com")).resolves.toBe(false);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("uses an injected Redis client for the global rate-limit store", async () => {
    const redisCommands: Record<string, (...args: unknown[]) => void> = {};
    const defineCommand = vi.fn((name: string) => {
      redisCommands[name] = (...args: unknown[]) => {
        const callback = args.at(-1) as (error: Error | null, result: [number, number]) => void;
        callback(null, name === "rateLimit" ? [1, 60_000] : [0, 0]);
      };
    });
    const redis = {
      defineCommand,
      get rateLimit() {
        return redisCommands.rateLimit;
      },
      get rateLimitRead() {
        return redisCommands.rateLimitRead;
      }
    };

    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      rateLimitRedis: redis
    });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(defineCommand.mock.calls.map(([name]) => name)).toEqual(["rateLimit", "rateLimitRead"]);
  });
});
