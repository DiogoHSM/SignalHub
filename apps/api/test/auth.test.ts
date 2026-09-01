import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  authenticateOpaqueSession,
  createOpaqueSession,
  revokeCurrentSession,
  type OpaqueSessionServiceDependencies
} from "../src/auth/session-service.js";
import {
  getSessionCookieName,
  getSessionCookieOptions,
  type AuthDependencies
} from "../src/routes/auth.js";

let app: FastifyInstance | undefined;

type TestUser = { id: string; email: string; isAdmin: boolean };

function sessionCookie(response: { headers: { "set-cookie"?: string | string[] | number } }): string {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : typeof header === "string" ? [header] : [];
  const session = values.find((value) => value?.startsWith("sigmon_session="));
  if (!session) throw new Error("session cookie not set");
  return session.split(";", 1)[0]!;
}

function createSessionAuthHarness() {
  let currentTime = new Date("2026-09-01T12:00:00.000Z");
  let tokenNumber = 0;
  const users = new Map<string, TestUser>([
    ["admin@example.com", { id: "usr_1", email: "admin@example.com", isAdmin: true }],
    ["google@example.com", { id: "usr_google", email: "google@example.com", isAdmin: false }]
  ]);
  const sessions = new Map<string, { userId: string; expiresAt: Date; revoked: boolean }>();
  const service: OpaqueSessionServiceDependencies = {
    cookieName: "sigmon_session",
    cookieOptions: getSessionCookieOptions("test", 60),
    maxAgeSeconds: 60,
    now: () => currentTime,
    generateToken: () => Buffer.alloc(32, ++tokenNumber).toString("base64url"),
    createSession: async ({ userId, tokenHash, expiresAt }) => {
      sessions.set(tokenHash, { userId, expiresAt, revoked: false });
    },
    findSessionUser: async ({ tokenHash, now }) => {
      const session = sessions.get(tokenHash);
      if (!session || session.revoked || session.expiresAt <= now) return undefined;
      return [...users.values()].find((candidate) => candidate.id === session.userId);
    },
    revokeSession: async ({ tokenHash }) => {
      const session = sessions.get(tokenHash);
      if (session) session.revoked = true;
    }
  };

  const auth: AuthDependencies = {
    login: async (email: string, password: string, { reply }) => {
      const user = password === "password" ? users.get(email) : undefined;
      if (!user) return null;
      await createOpaqueSession(service, user.id, reply);
      return user;
    },
    findSessionUser: (request) => authenticateOpaqueSession(service, request),
    logout: (context) => revokeCurrentSession(service, context),
    googleOAuth: {
      createAuthorizationUrl: (state: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
      complete: async (_code: string, _state: string, { reply }) => {
        const user = users.get("google@example.com")!;
        await createOpaqueSession(service, user.id, reply);
        return user;
      }
    }
  };

  return {
    auth,
    advanceTime(milliseconds: number) {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    }
  };
}

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

  it("rejects a copied cookie after logout", async () => {
    const harness = createSessionAuthHarness();
    app = await buildApp({ readiness: async () => ({ postgres: true, redis: true }), auth: harness.auth });
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin@example.com", password: "password" }
    });
    const cookie = sessionCookie(login);

    expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("rejects an expired opaque cookie", async () => {
    const harness = createSessionAuthHarness();
    app = await buildApp({ readiness: async () => ({ postgres: true, redis: true }), auth: harness.auth });
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin@example.com", password: "password" }
    });
    const cookie = sessionCookie(login);
    harness.advanceTime(60_000);

    expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it.each(["malformed", "payload.signature"])("rejects a copied %s session cookie", async (token) => {
    const harness = createSessionAuthHarness();
    app = await buildApp({ readiness: async () => ({ postgres: true, redis: true }), auth: harness.auth });

    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: `sigmon_session=${token}` }
    });

    expect(response.statusCode).toBe(401);
  });

  it("keeps password login compatible with the existing cookie name and options", async () => {
    const harness = createSessionAuthHarness();
    app = await buildApp({ readiness: async () => ({ postgres: true, redis: true }), auth: harness.auth });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin@example.com", password: "password" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("sigmon_session=");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(response.headers["set-cookie"]).toContain("Path=/");
  });

  it("keeps Google OAuth compatible with the existing session cookie", async () => {
    const harness = createSessionAuthHarness();
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      googleOAuthEnabled: true,
      auth: harness.auth
    });

    const response = await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=abc&state=expected",
      headers: { cookie: "sigmon_oauth_state=expected" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("sigmon_session="),
        expect.stringContaining("sigmon_oauth_state=;")
      ])
    );
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

  it("uses secure OAuth state cookies in production", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      nodeEnv: "production",
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
    expect(response.headers["set-cookie"]).toContain("sigmon_oauth_state=");
    expect(response.headers["set-cookie"]).toContain("Secure");
    expect(response.headers["set-cookie"]).toContain("Path=/auth/google/callback");
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
