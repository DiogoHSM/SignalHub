import { createHash, randomBytes } from "node:crypto";
import type { SessionCookieOptions } from "../routes/auth.js";

type SessionRequest = {
  cookies: Record<string, string | undefined>;
};

type SessionReply = {
  setCookie: (name: string, value: string, options?: SessionCookieOptions) => unknown;
  clearCookie?: (name: string, options?: SessionCookieOptions) => unknown;
};

export type OpaqueSessionUser = {
  id: string;
  email: string;
  isAdmin: boolean;
};

export type OpaqueSessionServiceDependencies = {
  cookieName: string;
  cookieOptions: SessionCookieOptions;
  maxAgeSeconds: number;
  now?: () => Date;
  generateToken?: () => string;
  createSession: (input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }) => Promise<void>;
  findSessionUser: (input: { tokenHash: string; now: Date }) => Promise<OpaqueSessionUser | undefined>;
  revokeSession: (input: { tokenHash: string; now: Date }) => Promise<void>;
};

const opaqueSessionTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function isOpaqueSessionToken(token: string): boolean {
  return opaqueSessionTokenPattern.test(token);
}

export async function createOpaqueSession(
  dependencies: OpaqueSessionServiceDependencies,
  userId: string,
  reply: Pick<SessionReply, "setCookie">
): Promise<void> {
  const token = (dependencies.generateToken ?? generateSessionToken)();
  const now = dependencies.now?.() ?? new Date();
  await dependencies.createSession({
    userId,
    tokenHash: hashSessionToken(token),
    now,
    expiresAt: new Date(now.getTime() + dependencies.maxAgeSeconds * 1000)
  });
  reply.setCookie(dependencies.cookieName, token, dependencies.cookieOptions);
}

export async function authenticateOpaqueSession(
  dependencies: OpaqueSessionServiceDependencies,
  request: SessionRequest
): Promise<OpaqueSessionUser | null> {
  const token = request.cookies[dependencies.cookieName];
  if (!token || !isOpaqueSessionToken(token)) return null;

  return (
    (await dependencies.findSessionUser({
      tokenHash: hashSessionToken(token),
      now: dependencies.now?.() ?? new Date()
    })) ?? null
  );
}

export async function revokeCurrentSession(
  dependencies: OpaqueSessionServiceDependencies,
  context: { request: SessionRequest; reply: Required<Pick<SessionReply, "clearCookie">> }
): Promise<void> {
  const token = context.request.cookies[dependencies.cookieName];
  if (token && isOpaqueSessionToken(token)) {
    await dependencies.revokeSession({
      tokenHash: hashSessionToken(token),
      now: dependencies.now?.() ?? new Date()
    });
  }
  context.reply.clearCookie(dependencies.cookieName, { path: "/" });
}
