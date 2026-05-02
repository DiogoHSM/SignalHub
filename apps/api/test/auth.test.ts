import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("auth routes", () => {
  it("logs in with a session-capable auth dependency", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: {
        login: async (_email, _password, { reply }) => {
          reply.setCookie("signalhub_session", "session_1", { httpOnly: true, sameSite: "lax" });
          return { id: "usr_1", email: "admin@example.com", isAdmin: true };
        },
        findSessionUser: async (request) =>
          request.cookies.signalhub_session === "session_1"
            ? { id: "usr_1", email: "admin@example.com", isAdmin: true }
            : null
      }
    });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "admin@example.com",
        password: "password"
      }
    });

    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.headers["set-cookie"]).toContain("signalhub_session=session_1");
    expect(loginResponse.json()).toEqual({
      user: { id: "usr_1", email: "admin@example.com", isAdmin: true }
    });

    const meResponse = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: "signalhub_session=session_1" }
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json()).toEqual({
      user: { id: "usr_1", email: "admin@example.com", isAdmin: true }
    });
  });

  it("delegates logout to the auth dependency", async () => {
    let logoutCalled = false;
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: {
        login: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true }),
        findSessionUser: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true }),
        logout: async ({ reply }) => {
          logoutCalled = true;
          reply.clearCookie("signalhub_session");
        }
      }
    });

    const response = await app.inject({ method: "POST", url: "/auth/logout" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(logoutCalled).toBe(true);
    expect(response.headers["set-cookie"]).toContain("signalhub_session=;");
  });
});
