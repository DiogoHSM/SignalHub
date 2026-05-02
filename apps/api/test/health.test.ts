import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("health routes", () => {
  it("returns ok for GET /health", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true })
    });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("returns unavailable readiness when a dependency is not ready", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: false })
    });

    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      ok: false,
      checks: { postgres: true, redis: false }
    });
  });
});
