import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const auth = {
  findSessionUser: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true }),
  login: async () => null,
  logout: async () => {}
};

describe("system health routes", () => {
  it("requires authentication", async () => {
    const app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: undefined,
      system: {
        getHealth: async () => ({ generatedAt: "2026-05-06T12:00:00.000Z", status: "healthy" })
      }
    });

    const response = await app.inject({ method: "GET", url: "/system/health" });
    expect(response.statusCode).toBe(401);
  });

  it("returns system health for authenticated users", async () => {
    const app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth,
      system: {
        getHealth: async () => ({
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
        })
      }
    });

    const response = await app.inject({ method: "GET", url: "/system/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe("degraded");
  });

  it("returns unavailable when system health dependency fails", async () => {
    const app = await buildApp({
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
});
