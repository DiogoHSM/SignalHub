import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { getSessionCookieName, getSessionCookieOptions } from "../src/routes/auth.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("auth routes", () => {
  it("uses a host-prefixed session cookie name only in production", () => {
    expect(getSessionCookieName("production")).toBe("__Host-sigmon_session");
    expect(getSessionCookieName("development")).toBe("sigmon_session");
    expect(getSessionCookieName("test")).toBe("sigmon_session");
  });

  it("uses secure root-scoped session cookie options only in production", () => {
    expect(getSessionCookieOptions("production", 123)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 123
    });
    expect(getSessionCookieOptions("development", 123)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 123
    });
  });

  it("uses host-prefixed secure session cookies in production", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      nodeEnv: "production",
      auth: {
        login: async (_email, _password, { reply }) => {
          reply.setCookie("__Host-sigmon_session", "session_1", {
            httpOnly: true,
            sameSite: "lax",
            secure: true,
            path: "/"
          });
          return { id: "usr_1", email: "admin@example.com", isAdmin: true };
        },
        findSessionUser: async () => null
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin@example.com", password: "password" }
    });

    expect(response.headers["set-cookie"]).toContain("__Host-sigmon_session=");
    expect(response.headers["set-cookie"]).toContain("Secure");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("Path=/");
  });

  it("logs in with a session-capable auth dependency", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: {
        login: async (_email, _password, { reply }) => {
          reply.setCookie("sigmon_session", "session_1", { httpOnly: true, sameSite: "lax" });
          return { id: "usr_1", email: "admin@example.com", isAdmin: true };
        },
        findSessionUser: async (request) =>
          request.cookies.sigmon_session === "session_1"
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
    expect(loginResponse.headers["set-cookie"]).toContain("sigmon_session=session_1");
    expect(loginResponse.json()).toEqual({
      user: { id: "usr_1", email: "admin@example.com", isAdmin: true }
    });

    const meResponse = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: "sigmon_session=session_1" }
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
          reply.clearCookie("sigmon_session");
        }
      }
    });

    const response = await app.inject({ method: "POST", url: "/auth/logout" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(logoutCalled).toBe(true);
    expect(response.headers["set-cookie"]).toContain("sigmon_session=;");
  });

  it("keeps Google OAuth inert when disabled", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      googleOAuthEnabled: false
    });

    const response = await app.inject({ method: "GET", url: "/auth/google" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "google_oauth_disabled" });
  });

  it("redirects to Google OAuth with a state cookie when enabled", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      googleOAuthEnabled: true,
      auth: {
        login: async () => null,
        findSessionUser: async () => null,
        googleOAuth: {
          createAuthorizationUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
          complete: async () => null
        }
      }
    });

    const response = await app.inject({ method: "GET", url: "/auth/google" });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?state=/);
    expect(response.headers["set-cookie"]).toContain("sigmon_oauth_state=");
  });

  it("rejects Google OAuth callbacks with invalid state", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      googleOAuthEnabled: true,
      auth: {
        login: async () => null,
        findSessionUser: async () => null,
        googleOAuth: {
          createAuthorizationUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
          complete: async () => ({ id: "usr_google", email: "user@example.com", isAdmin: false })
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=abc&state=wrong",
      headers: { cookie: "sigmon_oauth_state=expected" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_oauth_state" });
  });

  it("completes Google OAuth callbacks through the auth dependency", async () => {
    const completed: Array<{ code: string; state: string }> = [];
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      googleOAuthEnabled: true,
      auth: {
        login: async () => null,
        findSessionUser: async () => null,
        googleOAuth: {
          createAuthorizationUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
          complete: async (code, state, { reply }) => {
            completed.push({ code, state });
            reply.setCookie("sigmon_session", "google-session", { httpOnly: true, sameSite: "lax" });
            return { id: "usr_google", email: "user@example.com", isAdmin: false };
          }
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=abc&state=expected",
      headers: { cookie: "sigmon_oauth_state=expected" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: { id: "usr_google", email: "user@example.com", isAdmin: false }
    });
    expect(completed).toEqual([{ code: "abc", state: "expected" }]);
    expect(response.headers["set-cookie"]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("sigmon_session=google-session"),
        expect.stringContaining("sigmon_oauth_state=;")
      ])
    );
  });
});
