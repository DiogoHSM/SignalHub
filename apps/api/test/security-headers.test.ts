import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("API hardening", () => {
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
});
