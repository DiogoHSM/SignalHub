import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

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
});
