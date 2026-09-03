import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DUMMY_PASSWORD_HASH } from "@sigmon/telemetry/auth";
import { buildApp } from "../src/app.js";
import { Argon2Semaphore, LoginGuard, createGuardedLogin } from "../src/auth/login-guard.js";
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

function createGuardedAuthHarness(options: { accountLimit?: number; redisUnavailable?: boolean } = {}) {
  const counts = new Map<string, number>();
  const users = new Map([
    [
      "admin@example.com",
      {
        id: "usr_admin",
        email: "admin@example.com",
        passwordHash: "real-password-hash",
        archivedAt: null,
        isAdmin: true
      }
    ],
    [
      "oauth@example.com",
      {
        id: "usr_oauth",
        email: "oauth@example.com",
        passwordHash: null,
        archivedAt: null,
        isAdmin: false
      }
    ],
    [
      "archived@example.com",
      {
        id: "usr_archived",
        email: "archived@example.com",
        passwordHash: "real-password-hash",
        archivedAt: new Date("2026-08-01T00:00:00.000Z"),
        isAdmin: true
      }
    ]
  ]);
  const verify = vi.fn(async (hash: string, password: string) => hash === "real-password-hash" && password === "correct");
  const sessionUserIds: string[] = [];
  const guard = new LoginGuard({
    sessionSecret: "unit-test-session-secret",
    accountLimit: options.accountLimit,
    delay: async () => undefined,
    redis: {
      eval: async (_script, _numberOfKeys, key) => {
        if (options.redisUnavailable) throw new Error("redis unavailable");
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return count;
      },
      del: async (key) => {
        if (options.redisUnavailable) throw new Error("redis unavailable");
        counts.delete(key);
        return 1;
      }
    }
  });
  const login = createGuardedLogin({
    guard,
    semaphore: new Argon2Semaphore(2),
    findUser: async (email) => users.get(email),
    verifyPassword: verify,
    createSession: async (user, { reply }) => {
      sessionUserIds.push(user.id);
      reply.setCookie("sigmon_session", `session-${user.id}`, { httpOnly: true, sameSite: "lax", path: "/" });
    }
  });

  return {
    auth: {
      loginGuard: guard,
      login,
      findSessionUser: async () => null
    } satisfies AuthDependencies,
    sessionUserIds,
    verify
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

  it("clears the host-prefixed production cookie with all required attributes", async () => {
    const token = Buffer.alloc(32, 4).toString("base64url");
    const service: OpaqueSessionServiceDependencies = {
      cookieName: "__Host-sigmon_session",
      cookieOptions: getSessionCookieOptions("production", 123),
      maxAgeSeconds: 123,
      now: () => new Date("2026-09-01T12:00:00.000Z"),
      createSession: async () => undefined,
      findSessionUser: async () => undefined,
      revokeSession: async () => undefined
    };
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      nodeEnv: "production",
      auth: {
        login: async () => null,
        findSessionUser: async () => null,
        logout: (context) => revokeCurrentSession(service, context)
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: `__Host-sigmon_session=${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("__Host-sigmon_session=;");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("Secure");
    expect(response.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(response.headers["set-cookie"]).toContain("Path=/");
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
    expect(response.headers["set-cookie"]).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
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

  it.each(["malformed", "payload.signature", `${"A".repeat(42)}B`])(
    "rejects a copied %s session cookie",
    async (token) => {
      const harness = createSessionAuthHarness();
      app = await buildApp({ readiness: async () => ({ postgres: true, redis: true }), auth: harness.auth });

      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { cookie: `sigmon_session=${token}` }
      });

      expect(response.statusCode).toBe(401);
    }
  );

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

  it("performs one dummy password verification for an absent account", async () => {
    const harness = createGuardedAuthHarness();
    app = await buildApp({ readiness: async () => ({ postgres: true, redis: true }), auth: harness.auth });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "missing@example.com", password: "submitted" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_credentials" });
    expect(harness.verify).toHaveBeenCalledTimes(1);
    expect(harness.verify).toHaveBeenCalledWith(DUMMY_PASSWORD_HASH, "submitted");
  });

  it("performs one dummy password verification for an OAuth-only account", async () => {
    const harness = createGuardedAuthHarness();
    app = await buildApp({ readiness: async () => ({ postgres: true, redis: true }), auth: harness.auth });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "oauth@example.com", password: "submitted" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_credentials" });
    expect(harness.verify).toHaveBeenCalledTimes(1);
    expect(harness.verify).toHaveBeenCalledWith(DUMMY_PASSWORD_HASH, "submitted");
  });

  it("rejects passwords larger than 1024 UTF-8 bytes before verification", async () => {
    const harness = createGuardedAuthHarness();
    app = await buildApp({ readiness: async () => ({ postgres: true, redis: true }), auth: harness.auth });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin@example.com", password: "é".repeat(513) }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_login_request" });
    expect(harness.verify).not.toHaveBeenCalled();
  });

  it("enforces a login-specific source quota using request.ip", async () => {
    const harness = createGuardedAuthHarness();
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: harness.auth,
      loginSourceRateLimit: { max: 2, timeWindow: 60_000 }
    });

    const responses = [];
    for (const email of ["first@example.com", "second@example.com", "third@example.com"]) {
      responses.push(
        await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "submitted" } })
      );
    }

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 429]);
    expect(responses[2]?.json()).toEqual({ error: "too_many_login_attempts" });
    expect(harness.verify).toHaveBeenCalledTimes(2);
  });

  it("enforces the shared normalized-account quota", async () => {
    const harness = createGuardedAuthHarness({ accountLimit: 2 });
    app = await buildApp({ readiness: async () => ({ postgres: true, redis: true }), auth: harness.auth });

    const first = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "Missing@Example.com", password: "submitted" }
    });
    const second = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: " missing@example.com ", password: "submitted" }
    });
    const third = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "missing@example.com", password: "submitted" }
    });

    expect([first.statusCode, second.statusCode, third.statusCode]).toEqual([401, 401, 429]);
    expect(third.json()).toEqual({ error: "too_many_login_attempts" });
    expect(harness.verify).toHaveBeenCalledTimes(2);
  });

  it("fails login closed with a 503 when the account guard is unavailable", async () => {
    const harness = createGuardedAuthHarness({ redisUnavailable: true });
    app = await buildApp({ readiness: async () => ({ postgres: true, redis: true }), auth: harness.auth });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin@example.com", password: "correct" }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "auth_unavailable" });
    expect(harness.verify).not.toHaveBeenCalled();
    expect(harness.sessionUserIds).toEqual([]);
  });

  it("keeps missing, OAuth-only, archived, and wrong-password failures publicly identical", async () => {
    const harness = createGuardedAuthHarness();
    app = await buildApp({ readiness: async () => ({ postgres: true, redis: true }), auth: harness.auth });

    const credentials = [
      ["missing@example.com", "submitted"],
      ["oauth@example.com", "submitted"],
      ["archived@example.com", "correct"],
      ["admin@example.com", "wrong"]
    ] as const;
    const results = [];
    for (const [email, password] of credentials) {
      const response = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
      results.push({ statusCode: response.statusCode, body: response.json() });
    }

    expect(results).toEqual(
      credentials.map(() => ({ statusCode: 401, body: { error: "invalid_credentials" } }))
    );
    expect(harness.verify).toHaveBeenCalledTimes(4);
    expect(harness.verify.mock.calls.map(([hash]) => hash)).toEqual([
      DUMMY_PASSWORD_HASH,
      DUMMY_PASSWORD_HASH,
      "real-password-hash",
      "real-password-hash"
    ]);
  });

  it("records account success and creates the normal opaque session", async () => {
    const harness = createGuardedAuthHarness();
    app = await buildApp({ readiness: async () => ({ postgres: true, redis: true }), auth: harness.auth });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "ADMIN@example.com", password: "correct" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("sigmon_session=session-usr_admin");
    expect(response.json()).toEqual({
      user: { id: "usr_admin", email: "admin@example.com", isAdmin: true }
    });
    expect(harness.verify).toHaveBeenCalledTimes(1);
    expect(harness.verify).toHaveBeenCalledWith("real-password-hash", "correct");
    expect(harness.sessionUserIds).toEqual(["usr_admin"]);
  });
});
