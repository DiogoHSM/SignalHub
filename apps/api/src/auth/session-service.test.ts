import { describe, expect, it, vi } from "vitest";
import {
  authenticateOpaqueSession,
  createOpaqueSession,
  generateSessionToken,
  hashSessionToken,
  revokeCurrentSession,
  type OpaqueSessionServiceDependencies
} from "./session-service.js";

const user = { id: "usr_1", email: "admin@example.com", isAdmin: true };

function dependencies(
  overrides: Partial<OpaqueSessionServiceDependencies> = {}
): OpaqueSessionServiceDependencies {
  return {
    cookieName: "sigmon_session",
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 3600
    },
    maxAgeSeconds: 3600,
    now: () => new Date("2026-09-01T12:00:00.000Z"),
    generateToken: () => "A".repeat(43),
    createSession: vi.fn(async () => undefined),
    findSessionUser: vi.fn(async () => user),
    revokeSession: vi.fn(async () => undefined),
    ...overrides
  };
}

describe("opaque session service", () => {
  it("generates a random 32-byte base64url token", () => {
    const first = generateSessionToken();
    const second = generateSessionToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first, "base64url")).toHaveLength(32);
    expect(second).not.toBe(first);
  });

  it("hashes tokens with SHA-256", () => {
    expect(hashSessionToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("stores only the token hash before exposing the cookie", async () => {
    const operations: string[] = [];
    const createSession = vi.fn(async (input) => {
      operations.push("store");
      expect(input).toEqual({
        userId: "usr_1",
        tokenHash: hashSessionToken("A".repeat(43)),
        now: new Date("2026-09-01T12:00:00.000Z"),
        expiresAt: new Date("2026-09-01T13:00:00.000Z")
      });
      expect(input).not.toHaveProperty("token");
    });
    const reply = {
      setCookie: vi.fn(() => {
        operations.push("cookie");
      })
    };

    await createOpaqueSession(dependencies({ createSession }), "usr_1", reply);

    expect(operations).toEqual(["store", "cookie"]);
    expect(reply.setCookie).toHaveBeenCalledWith("sigmon_session", "A".repeat(43), {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 3600
    });
  });

  it("does not expose a cookie when persistence fails", async () => {
    const reply = { setCookie: vi.fn() };

    await expect(
      createOpaqueSession(
        dependencies({ createSession: vi.fn(async () => Promise.reject(new Error("database unavailable"))) }),
        "usr_1",
        reply
      )
    ).rejects.toThrow("database unavailable");
    expect(reply.setCookie).not.toHaveBeenCalled();
  });

  it("hashes a well-formed cookie before session lookup", async () => {
    const token = "B".repeat(43);
    const findSessionUser = vi.fn(async () => user);

    await expect(
      authenticateOpaqueSession(dependencies({ findSessionUser }), {
        cookies: { sigmon_session: token }
      })
    ).resolves.toEqual(user);
    expect(findSessionUser).toHaveBeenCalledWith({
      tokenHash: hashSessionToken(token),
      now: new Date("2026-09-01T12:00:00.000Z")
    });
  });

  it.each(["short", "payload.signature", "A".repeat(42), `${"A".repeat(42)}!`])(
    "rejects malformed or legacy cookie %s without a database lookup",
    async (token) => {
      const findSessionUser = vi.fn(async () => user);

      await expect(
        authenticateOpaqueSession(dependencies({ findSessionUser }), {
          cookies: { sigmon_session: token }
        })
      ).resolves.toBeNull();
      expect(findSessionUser).not.toHaveBeenCalled();
    }
  );

  it("revokes a valid token before clearing its cookie", async () => {
    const operations: string[] = [];
    const token = "C".repeat(43);
    const revokeSession = vi.fn(async () => {
      operations.push("revoke");
    });
    const reply = {
      clearCookie: vi.fn(() => {
        operations.push("clear");
      })
    };

    await revokeCurrentSession(dependencies({ revokeSession }), {
      request: { cookies: { sigmon_session: token } },
      reply
    });

    expect(operations).toEqual(["revoke", "clear"]);
    expect(revokeSession).toHaveBeenCalledWith({
      tokenHash: hashSessionToken(token),
      now: new Date("2026-09-01T12:00:00.000Z")
    });
    expect(reply.clearCookie).toHaveBeenCalledWith("sigmon_session", { path: "/" });
  });

  it("does not clear the cookie when revocation fails", async () => {
    const reply = { clearCookie: vi.fn() };

    await expect(
      revokeCurrentSession(
        dependencies({ revokeSession: vi.fn(async () => Promise.reject(new Error("database unavailable"))) }),
        {
          request: { cookies: { sigmon_session: "D".repeat(43) } },
          reply
        }
      )
    ).rejects.toThrow("database unavailable");
    expect(reply.clearCookie).not.toHaveBeenCalled();
  });
});
