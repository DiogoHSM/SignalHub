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
    expect(response.json()).toEqual({ ok: true, version: null });
  });

  it("reports the deployed commit from SOURCE_COMMIT", async () => {
    const previous = process.env.SOURCE_COMMIT;
    process.env.SOURCE_COMMIT = "e8460fbfef11972f7605a2221fee2d19c452ca9d";

    try {
      app = await buildApp({
        readiness: async () => ({ postgres: true, redis: true })
      });

      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.json()).toEqual({
        ok: true,
        version: "e8460fbfef11972f7605a2221fee2d19c452ca9d"
      });
    } finally {
      if (previous === undefined) {
        delete process.env.SOURCE_COMMIT;
      } else {
        process.env.SOURCE_COMMIT = previous;
      }
    }
  });

  it("reports a null version when SOURCE_COMMIT is blank", async () => {
    const previous = process.env.SOURCE_COMMIT;
    process.env.SOURCE_COMMIT = "   ";

    try {
      app = await buildApp({
        readiness: async () => ({ postgres: true, redis: true })
      });

      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.json()).toEqual({ ok: true, version: null });
    } finally {
      if (previous === undefined) {
        delete process.env.SOURCE_COMMIT;
      } else {
        process.env.SOURCE_COMMIT = previous;
      }
    }
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
