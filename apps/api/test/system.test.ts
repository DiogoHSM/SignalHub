import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createSystemHealthSnapshot } from "../src/system-health.js";
import type { SystemHealthSnapshot } from "../src/routes/system.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const auth = {
  findSessionUser: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true }),
  login: async () => null,
  logout: async () => {}
};

const systemHealthSnapshot: SystemHealthSnapshot = {
  generatedAt: "2026-05-06T12:00:00.000Z",
  status: "degraded",
  services: {
    api: { status: "healthy", uptimeSeconds: 10 },
    postgres: { status: "healthy", latencyMs: 2 },
    redis: { status: "healthy", latencyMs: 3 },
    worker: { status: "degraded", lastHeartbeatAt: null }
  },
  queues: { telemetry: { waiting: 0, active: 0, completed: 1, failed: 0, delayed: 0 } },
  ingestion: {
    lastEventAt: null,
    lastErrorAt: null,
    lastTraceAt: null,
    lastSpanAt: null,
    lastLlmCallAt: null
  },
  retention: {
    enabled: true,
    intervalMinutes: 60,
    lastRun: null,
    policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180 }
  }
};

describe("system health routes", () => {
  it("requires authentication", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: undefined,
      system: {
        getHealth: async () => systemHealthSnapshot
      }
    });

    const response = await app.inject({ method: "GET", url: "/system/health" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns unavailable when system health dependency is missing", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth
    });

    const response = await app.inject({ method: "GET", url: "/system/health" });
    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "system_health_unavailable" });
  });

  it("returns system health for authenticated users", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth,
      system: {
        getHealth: async () => systemHealthSnapshot
      }
    });

    const response = await app.inject({ method: "GET", url: "/system/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe("degraded");
  });

  it("returns unavailable when system health dependency fails", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth,
      system: {
        getHealth: async () => {
          throw new Error("health dependency failed");
        }
      }
    });

    const response = await app.inject({ method: "GET", url: "/system/health" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "system_health_unavailable" });
  });

  it("returns a partial unhealthy snapshot when operational probes fail", async () => {
    const snapshot = await createSystemHealthSnapshot({
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180 }
      },
      uptimeSeconds: () => 12,
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      postgresPing: async () => {
        throw new Error("postgres down");
      },
      redisPing: async () => "PONG",
      getQueueCounts: async () => {
        throw new Error("redis queue unavailable");
      },
      getHeartbeat: async () => {
        throw new Error("postgres down");
      },
      getIngestionFreshness: async () => {
        throw new Error("postgres down");
      },
      getLastRetentionRun: async () => {
        throw new Error("postgres down");
      }
    });

    expect(snapshot.status).toBe("unhealthy");
    expect(snapshot.services.postgres).toEqual({ status: "unhealthy", latencyMs: null });
    expect(snapshot.services.redis.status).toBe("healthy");
    expect(snapshot.services.worker).toEqual({ status: "degraded", lastHeartbeatAt: null });
    expect(snapshot.queues.telemetry).toEqual({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
    expect(snapshot.ingestion).toEqual({
      lastEventAt: null,
      lastErrorAt: null,
      lastTraceAt: null,
      lastSpanAt: null,
      lastLlmCallAt: null
    });
    expect(snapshot.retention.lastRun).toBeNull();
  });
});
