import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("API hardening", () => {
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
