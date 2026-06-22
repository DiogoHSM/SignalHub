import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { clearFleetCache } from "../src/routes/query.js";
import type { FleetData, FleetProjectEnvsResult } from "@sigmon/db/repositories/fleet-query.js";

let app: FastifyInstance | undefined;

const humanAuth = {
  login: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false }),
  findSessionUser: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false })
};

const unauthenticatedAuth = {
  login: async () => null,
  findSessionUser: async () => null
};

const readiness = async () => ({ postgres: true, redis: true });

const mockFleetData: FleetData = {
  window: "24h",
  generatedAt: "2026-06-21T00:00:00.000Z",
  projects: [
    {
      id: "prj_1",
      name: "Alpha",
      status: "ok",
      incidents: 0,
      alerts: 0,
      errorRatePercent: null,
      errorRateDelta: null,
      errorTrend: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      events: 100,
      activeUsers: 5,
      activeTenants: 2,
      llmCostUsd: "0.00",
      llmCostDeltaUsd: null,
      p95TraceDurationMs: null,
      p95DeltaMs: null,
      infra: { api: "ok", db: "ok", redis: "ok", queue: "ok" },
      topIncident: null
    }
  ],
  rollup: {
    counts: { ok: 1, warning: 0, critical: 0 },
    incidents: 0,
    alerts: 0,
    llmCostUsd: "0.00",
    overall: "ok",
    total: 1
  }
};

const mockEnvsResult: FleetProjectEnvsResult = {
  projectId: "prj_1",
  envs: [
    {
      name: "production",
      status: "ok",
      incidents: 0,
      errorRatePercent: null,
      events: 100,
      note: null
    }
  ]
};

beforeEach(() => {
  clearFleetCache();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /query/fleet", () => {
  it("returns 401 when unauthenticated", async () => {
    app = await buildApp({
      readiness,
      auth: unauthenticatedAuth,
      query: {
        getFleet: async () => mockFleetData
      }
    });

    const response = await app.inject({ method: "GET", url: "/query/fleet" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns 400 when window param is invalid", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getFleet: async () => mockFleetData
      }
    });

    const response = await app.inject({ method: "GET", url: "/query/fleet?window=foo" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 200 with fleet data when authenticated and valid window", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getFleet: async () => mockFleetData
      }
    });

    const response = await app.inject({ method: "GET", url: "/query/fleet" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: FleetData };
    expect(body.data.rollup).toBeDefined();
    expect(body.data.projects).toBeDefined();
    expect(Array.isArray(body.data.projects)).toBe(true);
  });

  it("projects in fleet response do not have an envs field", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getFleet: async () => mockFleetData
      }
    });

    const response = await app.inject({ method: "GET", url: "/query/fleet" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: FleetData };
    for (const project of body.data.projects) {
      expect(Object.prototype.hasOwnProperty.call(project, "envs")).toBe(false);
    }
  });

  it("defaults window to 24h when not provided", async () => {
    const receivedWindows: string[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getFleet: async (window) => {
          receivedWindows.push(window);
          return mockFleetData;
        }
      }
    });

    const response = await app.inject({ method: "GET", url: "/query/fleet" });

    expect(response.statusCode).toBe(200);
    expect(receivedWindows).toEqual(["24h"]);
  });

  it("accepts valid window values (7d, 30d)", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getFleet: async () => mockFleetData
      }
    });

    const r7d = await app.inject({ method: "GET", url: "/query/fleet?window=7d" });
    const r30d = await app.inject({ method: "GET", url: "/query/fleet?window=30d" });

    expect(r7d.statusCode).toBe(200);
    expect(r30d.statusCode).toBe(200);
  });

  it("returns 501 when getFleet dependency is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {}
    });

    const response = await app.inject({ method: "GET", url: "/query/fleet" });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "query_method_unavailable" });
  });

  it("returns 503 when getFleet throws", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getFleet: async () => {
          throw new Error("db error");
        }
      }
    });

    const response = await app.inject({ method: "GET", url: "/query/fleet" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "query_unavailable" });
  });

  it("caches fleet data for 10s and recomputes after TTL expires", async () => {
    vi.useFakeTimers();

    try {
      const getFleetMock = vi.fn(async () => mockFleetData);

      app = await buildApp({
        readiness,
        auth: humanAuth,
        query: {
          getFleet: getFleetMock
        }
      });

      // First request — mock called once
      const response1 = await app.inject({ method: "GET", url: "/query/fleet" });
      expect(response1.statusCode).toBe(200);
      expect(getFleetMock).toHaveBeenCalledTimes(1);

      // Second request immediately after — mock still called once (cached)
      const response2 = await app.inject({ method: "GET", url: "/query/fleet" });
      expect(response2.statusCode).toBe(200);
      expect(getFleetMock).toHaveBeenCalledTimes(1);

      // Advance time past 10s
      vi.advanceTimersByTime(10_001);

      // Third request — mock called twice (cache expired, recomputed)
      const response3 = await app.inject({ method: "GET", url: "/query/fleet" });
      expect(response3.statusCode).toBe(200);
      expect(getFleetMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GET /query/fleet/projects/:id/environments", () => {
  it("returns 401 when unauthenticated", async () => {
    app = await buildApp({
      readiness,
      auth: unauthenticatedAuth,
      query: {
        getProjectFleetEnvironments: async () => mockEnvsResult
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/fleet/projects/prj_1/environments"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns 400 when window param is invalid", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getProjectFleetEnvironments: async () => mockEnvsResult
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/fleet/projects/prj_1/environments?window=foo"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 404 when project is unknown", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getProjectFleetEnvironments: async () => undefined
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/fleet/projects/prj_unknown/environments"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "project_not_found" });
  });

  it("returns 200 with envs data when project exists", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getProjectFleetEnvironments: async () => mockEnvsResult
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/fleet/projects/prj_1/environments"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: FleetProjectEnvsResult };
    expect(body.data.projectId).toBe("prj_1");
    expect(Array.isArray(body.data.envs)).toBe(true);
    expect(body.data.envs.length).toBeGreaterThan(0);
  });

  it("returns 501 when getProjectFleetEnvironments dependency is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {}
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/fleet/projects/prj_1/environments"
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "query_method_unavailable" });
  });

  it("returns 503 when getProjectFleetEnvironments throws", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getProjectFleetEnvironments: async () => {
          throw new Error("db error");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/fleet/projects/prj_1/environments"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "query_unavailable" });
  });
});
