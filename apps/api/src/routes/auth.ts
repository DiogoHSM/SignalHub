import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { setCurrentUser, type AuthenticatedUser } from "../plugins/request-context.js";

export type AuthUser = AuthenticatedUser;

export type AuthDependencies = {
  login: (email: string, password: string) => Promise<AuthUser | null | undefined>;
  findSessionUser: (request: FastifyRequest) => Promise<AuthUser | null | undefined>;
};

export type AuthRouteOptions = {
  auth?: AuthDependencies;
  googleOAuthEnabled?: boolean;
};

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

function authUnavailable() {
  return {
    login: async () => null,
    findSessionUser: async () => null
  } satisfies AuthDependencies;
}

function googleOAuthDisabled(reply: FastifyReply) {
  return reply.status(404).send({ error: "google_oauth_disabled" });
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const auth = options.auth ?? authUnavailable();

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_login_request" });
    }

    const user = await auth.login(parsed.data.email, parsed.data.password);
    if (!user) {
      return reply.status(401).send({ error: "invalid_credentials" });
    }

    setCurrentUser(request, user);
    return reply.send({ user });
  });

  app.post("/auth/logout", async (request, reply) => {
    setCurrentUser(request, null);

    return reply.send({ ok: true });
  });

  app.get("/auth/me", async (request, reply) => {
    const user = await auth.findSessionUser(request);
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

    return reply.status(501).send({ error: "google_oauth_not_configured" });
  });

  app.get("/auth/google/callback", async (_request, reply) => {
    if (!options.googleOAuthEnabled) {
      return googleOAuthDisabled(reply);
    }

    return reply.status(501).send({ error: "google_oauth_not_configured" });
  });
}
