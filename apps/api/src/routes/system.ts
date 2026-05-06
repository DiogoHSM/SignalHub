import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { setCurrentUser } from "../plugins/request-context.js";
import type { AuthDependencies } from "./auth.js";

export type SystemStatus = "healthy" | "degraded" | "unhealthy";

export type SystemQueueCounts = {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
};

export type SystemHealthSnapshot = {
  generatedAt: string;
  status: SystemStatus;
  services: {
    api: { status: SystemStatus; uptimeSeconds: number };
    postgres: { status: SystemStatus; latencyMs: number | null };
    redis: { status: SystemStatus; latencyMs: number | null };
    worker: { status: SystemStatus; lastHeartbeatAt: string | null };
  };
  queues: {
    telemetry: SystemQueueCounts & { status: SystemStatus; errorMessage: string | null };
  };
  ingestion: {
    lastEventAt: string | null;
    lastErrorAt: string | null;
    lastTraceAt: string | null;
    lastSpanAt: string | null;
    lastLlmCallAt: string | null;
  };
  retention: {
    enabled: boolean;
    intervalMinutes: number;
    lastRun: {
      id: string;
      status: "success" | "failed";
      startedAt: string;
      finishedAt: string | null;
      deleted: {
        events: number;
        errors: number;
        traces: number;
        spans: number;
        llmCalls: number;
      };
      errorMessage: string | null;
    } | null;
    policy: {
      eventsDays: number;
      errorsDays: number;
      tracesDays: number;
      spansDays: number;
      llmCallsDays: number;
    };
  };
};

export type SystemHealthDependencies = {
  getHealth?: () => Promise<SystemHealthSnapshot>;
};

export function registerSystemRoutes(
  app: FastifyInstance,
  options: { auth?: AuthDependencies; system?: SystemHealthDependencies }
): void {
  app.get("/system/health", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await options.auth?.findSessionUser(request as Parameters<AuthDependencies["findSessionUser"]>[0]);
    if (!user) {
      setCurrentUser(request, null);
      return reply.code(401).send({ error: "unauthenticated" });
    }
    setCurrentUser(request, user);

    if (!options.system?.getHealth) {
      return reply.code(501).send({ error: "system_health_unavailable" });
    }

    try {
      return { data: await options.system.getHealth() };
    } catch {
      return reply.code(503).send({ error: "system_health_unavailable" });
    }
  });
}
