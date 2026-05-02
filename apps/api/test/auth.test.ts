import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("auth routes", () => {
  it("returns the authenticated user for POST /auth/login", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: {
        login: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true }),
        findSessionUser: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true })
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "admin@example.com",
        password: "password"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: { id: "usr_1", email: "admin@example.com", isAdmin: true }
    });
  });
});
