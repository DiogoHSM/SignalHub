import type { FastifyInstance, FastifyRequest } from "fastify";

export type AuthenticatedUser = {
  id: string;
  email: string;
  isAdmin: boolean;
};

declare module "fastify" {
  interface FastifyRequest {
    currentUser: AuthenticatedUser | null;
  }
}

export function registerRequestContext(app: FastifyInstance): void {
  app.decorateRequest("currentUser", null);
}

export function setCurrentUser(request: FastifyRequest, user: AuthenticatedUser | null): void {
  request.currentUser = user;
}
