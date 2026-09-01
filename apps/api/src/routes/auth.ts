import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { setCurrentUser, type AuthenticatedUser } from "../plugins/request-context.js";

export type AuthUser = AuthenticatedUser;

export type SessionCookieOptions = {
  httpOnly?: boolean;
  sameSite?: "lax" | "none" | "strict" | boolean;
  secure?: boolean | "auto";
  path?: string;
  maxAge?: number;
  expires?: Date;
};

export type CookieCapableRequest = FastifyRequest & {
  cookies: Record<string, string | undefined>;
};

export type CookieCapableReply = FastifyReply & {
  setCookie: (name: string, value: string, options?: SessionCookieOptions) => FastifyReply;
  clearCookie: (name: string, options?: SessionCookieOptions) => FastifyReply;
};

export type AuthSessionContext = {
  request: CookieCapableRequest;
  reply: CookieCapableReply;
};

export type AuthDependencies = {
  login: (email: string, password: string, context: AuthSessionContext) => Promise<AuthUser | null | undefined>;
  findSessionUser: (request: CookieCapableRequest) => Promise<AuthUser | null | undefined>;
  logout?: (context: AuthSessionContext) => Promise<void>;
  googleOAuth?: {
    createAuthorizationUrl: (state: string) => string;
    complete: (code: string, state: string, context: AuthSessionContext) => Promise<AuthUser | null | undefined>;
  };
};

export type AuthRouteOptions = {
  auth?: AuthDependencies;
  googleOAuthEnabled?: boolean;
  nodeEnv?: string;
};

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});
const googleCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
});

const oauthStateCookieName = "sigmon_oauth_state";
const oauthStateMaxAgeSeconds = 10 * 60;

export function getSessionCookieName(nodeEnv: string | undefined): string {
  return nodeEnv === "production" ? "__Host-sigmon_session" : "sigmon_session";
}

export function getSessionCookieOptions(nodeEnv: string | undefined, maxAge: number): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: nodeEnv === "production",
    path: "/",
    maxAge
  };
}

function authUnavailable(): AuthDependencies {
  return {
    login: async () => null,
    findSessionUser: async () => null
  } satisfies AuthDependencies;
}

function googleOAuthDisabled(reply: FastifyReply) {
  return reply.status(404).send({ error: "google_oauth_disabled" });
}

function googleOAuthUnavailable(reply: FastifyReply) {
  return reply.status(501).send({ error: "google_oauth_not_configured" });
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const auth = options.auth ?? authUnavailable();

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_login_request" });
    }

    const user = await auth.login(parsed.data.email, parsed.data.password, {
      request: request as CookieCapableRequest,
      reply: reply as CookieCapableReply
    });
    if (!user) {
      return reply.status(401).send({ error: "invalid_credentials" });
    }

    setCurrentUser(request, user);
    return reply.send({ user });
  });

  app.post("/auth/logout", async (request, reply) => {
    await auth.logout?.({
      request: request as CookieCapableRequest,
      reply: reply as CookieCapableReply
    });
    setCurrentUser(request, null);

    return reply.send({ ok: true });
  });

  app.get("/auth/me", async (request, reply) => {
    const user = await auth.findSessionUser(request as CookieCapableRequest);
    if (!user) {
      setCurrentUser(request, null);
      return reply.status(401).send({ error: "unauthenticated" });
    }

    setCurrentUser(request, user);
    return reply.send({ user });
  });

  app.get("/auth/google", async (_request, reply) => {
    if (!options.googleOAuthEnabled) {
      return googleOAuthDisabled(reply);
    }
    if (!auth.googleOAuth) {
      return googleOAuthUnavailable(reply);
    }

    const state = randomBytes(32).toString("base64url");
    // __Host- cookies require Path=/, while OAuth state is intentionally scoped to the callback path.
    (reply as CookieCapableReply).setCookie(oauthStateCookieName, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: options.nodeEnv === "production" ? true : "auto",
      path: "/auth/google/callback",
      maxAge: oauthStateMaxAgeSeconds
    });

    return reply.redirect(auth.googleOAuth.createAuthorizationUrl(state));
  });

  app.get("/auth/google/callback", async (request, reply) => {
    if (!options.googleOAuthEnabled) {
      return googleOAuthDisabled(reply);
    }
    if (!auth.googleOAuth) {
      return googleOAuthUnavailable(reply);
    }

    const parsed = googleCallbackQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_oauth_callback" });
    }

    const expectedState = (request as CookieCapableRequest).cookies[oauthStateCookieName];
    if (!expectedState || expectedState !== parsed.data.state) {
      return reply.status(400).send({ error: "invalid_oauth_state" });
    }

    const context = {
      request: request as CookieCapableRequest,
      reply: reply as CookieCapableReply
    };
    let user: AuthUser | null | undefined;
    try {
      user = await auth.googleOAuth.complete(parsed.data.code, parsed.data.state, context);
    } catch {
      return reply.status(503).send({ error: "google_oauth_unavailable" });
    } finally {
      (reply as CookieCapableReply).clearCookie(oauthStateCookieName, { path: "/auth/google/callback" });
    }
    if (!user) {
      return reply.status(403).send({ error: "google_oauth_user_not_allowed" });
    }

    setCurrentUser(request, user);
    return reply.send({ user });
  });
}
