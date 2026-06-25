import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { setCurrentUser } from "../plugins/request-context.js";
import type { AuthDependencies } from "./auth.js";
import type { AlertSuggestion } from "@sigmon/db/repositories/alerts.js";

export type AlertEventListFilters = {
  projectId: string;
  environmentId: string;
  limit?: number;
};

export type AlertSuggestionsFilters = {
  projectId: string;
  environmentId: string;
};

export type AlertRouteDependencies = {
  listAlertEvents?: (filters: AlertEventListFilters) => Promise<unknown[]>;
  getAlertEvent?: (id: string) => Promise<unknown | null | undefined>;
  listAlertSuggestions?: (filters: AlertSuggestionsFilters) => Promise<AlertSuggestion[]>;
};

export type AlertRouteOptions = {
  auth?: AuthDependencies;
  alerts?: AlertRouteDependencies;
};

const listAlertEventsQuerySchema = z.object({
  project_id: z.string().trim().min(1),
  environment_id: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const alertEventParamsSchema = z.object({ id: z.string().trim().min(1) });

const alertSuggestionsQuerySchema = z.object({
  project_id: z.string().trim().min(1),
  environment_id: z.string().trim().min(1),
});

async function requireHumanUser(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthDependencies | undefined
): Promise<boolean> {
  const user = await auth?.findSessionUser(request as Parameters<AuthDependencies["findSessionUser"]>[0]);
  if (!user) {
    setCurrentUser(request, null);
    reply.status(401).send({ error: "unauthenticated" });
    return false;
  }

  setCurrentUser(request, user);
  return true;
}

export function registerAlertRoutes(app: FastifyInstance, options: AlertRouteOptions): void {
  app.get("/alerts/events", async (request, reply) => {
    const authenticated = await requireHumanUser(request, reply, options.auth);
    if (!authenticated) {
      return reply;
    }

    if (!options.alerts?.listAlertEvents) {
      return reply.status(501).send({ error: "alerts_repository_unavailable" });
    }

    const parsed = listAlertEventsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_alert_query" });
    }

    try {
      const data = await options.alerts.listAlertEvents({
        projectId: parsed.data.project_id,
        environmentId: parsed.data.environment_id,
        limit: parsed.data.limit
      });
      return reply.send({ data });
    } catch {
      return reply.status(503).send({ error: "alerts_unavailable" });
    }
  });

  app.get("/alerts/events/:id", async (request, reply) => {
    const authenticated = await requireHumanUser(request, reply, options.auth);
    if (!authenticated) {
      return reply;
    }

    if (!options.alerts?.getAlertEvent) {
      return reply.status(501).send({ error: "alerts_repository_unavailable" });
    }

    const parsed = alertEventParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_alert_event_request" });
    }

    try {
      const data = await options.alerts.getAlertEvent(parsed.data.id);
      if (!data) {
        return reply.status(404).send({ error: "alert_event_not_found" });
      }

      return reply.send({ data });
    } catch {
      return reply.status(503).send({ error: "alerts_unavailable" });
    }
  });

  app.get("/alerts/suggestions", async (request, reply) => {
    const authenticated = await requireHumanUser(request, reply, options.auth);
    if (!authenticated) {
      return reply;
    }

    if (!options.alerts?.listAlertSuggestions) {
      return reply.status(501).send({ error: "alerts_repository_unavailable" });
    }

    const parsed = alertSuggestionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_alert_suggestions_query" });
    }

    try {
      const suggestions = await options.alerts.listAlertSuggestions({
        projectId: parsed.data.project_id,
        environmentId: parsed.data.environment_id,
      });
      return reply.send({ suggestions });
    } catch {
      return reply.status(503).send({ error: "alerts_unavailable" });
    }
  });
}
