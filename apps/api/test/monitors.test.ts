import type { FastifyInstance } from "fastify";
import type { MonitorCheckRecord, MonitorRecord } from "@sigmon/db/repositories/monitors.js";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

const readiness = async () => ({ postgres: true, redis: true });
const createdAt = new Date("2026-05-06T12:00:00.000Z");

const adminAuth = {
  login: async () => ({ id: "usr_admin", email: "admin@example.com", isAdmin: true }),
  findSessionUser: async () => ({ id: "usr_admin", email: "admin@example.com", isAdmin: true })
};

const userAuth = {
  login: async () => ({ id: "usr_member", email: "member@example.com", isAdmin: false }),
  findSessionUser: async () => ({ id: "usr_member", email: "member@example.com", isAdmin: false })
};

function monitor(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
  return {
    id: "mon_1",
    projectId: "prj_1",
    environmentId: "env_1",
    notificationChannelId: "chn_1",
    kind: "http",
    name: "API uptime",
    enabled: true,
    status: "unknown",
    url: "https://api.example.com/health",
    method: "GET",
    expectedStatus: "2xx",
    bodyContains: null,
    timeoutMs: 5000,
    intervalMinutes: 5,
    failureThreshold: 2,
    recoveryThreshold: 2,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    expectedIntervalMinutes: null,
    graceMinutes: null,
    secretHash: null,
    lastCheckedAt: null,
    lastCheckStatus: null,
    lastCheckLatencyMs: null,
    lastCheckResponseStatus: null,
    lastCheckErrorMessage: null,
    lastHeartbeatAt: null,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    ...overrides
  };
}

function check(overrides: Partial<MonitorCheckRecord> = {}): MonitorCheckRecord {
  return {
    id: "mchk_1",
    monitorId: "mon_1",
    checkedAt: createdAt,
    status: "success",
    latencyMs: 52,
    responseStatus: 200,
    errorMessage: null,
    createdAt,
    ...overrides
  };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("admin monitor routes", () => {
  it("requires admin access to create monitors", async () => {
    app = await buildApp({
      readiness,
      auth: userAuth,
      monitors: {
        createHttpMonitor: async () => monitor()
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/monitors/http",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "API uptime",
        url: "https://api.example.com/health"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "admin_required" });
  });

  it("creates HTTP monitors without exposing secret fields", async () => {
    const receivedInputs: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      monitors: {
        createHttpMonitor: async (input) => {
          receivedInputs.push(input);
          return monitor(input);
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/monitors/http",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "API uptime",
        url: "https://api.example.com/health",
        method: "GET",
        intervalMinutes: 5,
        timeoutMs: 5000,
        expectedStatus: "2xx",
        failureThreshold: 2,
        recoveryThreshold: 2,
        enabled: true
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().monitor).toMatchObject({ id: "mon_1", kind: "http", name: "API uptime" });
    expect(response.json().monitor.secretHash).toBeUndefined();
    expect(receivedInputs).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        notificationChannelId: null,
        name: "API uptime",
        url: "https://api.example.com/health",
        method: "GET",
        intervalMinutes: 5,
        timeoutMs: 5000,
        expectedStatus: "2xx",
        bodyContains: null,
        failureThreshold: 2,
        recoveryThreshold: 2,
        enabled: true
      }
    ]);
  });

  it("rejects unsafe HTTP monitor URLs", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      nodeEnv: "production",
      monitors: {
        createHttpMonitor: async () => monitor()
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/monitors/http",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Loopback",
        url: "http://127.0.0.1/health"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_monitor_request" });
  });

  it("creates heartbeat monitors and returns the secret only once", async () => {
    const receivedInputs: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      createHeartbeatSecret: () => "shhb_testsecret",
      hashHeartbeatSecret: async (secret) => `hashed:${secret}`,
      monitors: {
        createHeartbeatMonitor: async (input) => {
          receivedInputs.push(input);
          return monitor({
            ...input,
            kind: "heartbeat",
            url: null,
            method: null,
            expectedStatus: null,
            timeoutMs: null,
            intervalMinutes: null,
            failureThreshold: 1,
            recoveryThreshold: 1,
            secretHash: input.secretHash
          });
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/monitors/heartbeat",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Worker heartbeat",
        expectedIntervalMinutes: 5,
        graceMinutes: 2
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().secret).toBe("shhb_testsecret");
    expect(response.json().monitor.secretHash).toBeUndefined();
    expect(receivedInputs).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        notificationChannelId: null,
        name: "Worker heartbeat",
        expectedIntervalMinutes: 5,
        graceMinutes: 2,
        secretHash: "hashed:shhb_testsecret",
        enabled: true
      }
    ]);
  });

  it("lists monitors and monitor checks", async () => {
    const receivedFilters: unknown[] = [];
    const receivedChecks: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      monitors: {
        listMonitors: async (filters) => {
          receivedFilters.push(filters);
          return [monitor()];
        },
        listMonitorChecks: async (input) => {
          receivedChecks.push(input);
          return [check()];
        }
      }
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/monitors?project_id=prj_1&environment_id=env_1&kind=http"
    });
    const checksResponse = await app.inject({
      method: "GET",
      url: "/admin/monitors/mon_1/checks?limit=10"
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().monitors[0].secretHash).toBeUndefined();
    expect(checksResponse.statusCode).toBe(200);
    expect(checksResponse.json().checks).toHaveLength(1);
    expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", kind: "http" }]);
    expect(receivedChecks).toEqual([{ monitorId: "mon_1", limit: 10 }]);
  });
});

describe("heartbeat monitor ingestion", () => {
  it("records heartbeat check-ins with a valid bearer secret", async () => {
    const receivedCheckIns: unknown[] = [];
    app = await buildApp({
      readiness,
      monitors: {
        getMonitor: async (id) =>
          monitor({
            id,
            kind: "heartbeat",
            secretHash: "hashed-secret",
            url: null,
            method: null,
            expectedStatus: null,
            timeoutMs: null,
            intervalMinutes: null,
            expectedIntervalMinutes: 5,
            graceMinutes: 2
          }),
        verifyHeartbeatSecret: async (hash, secret) => hash === "hashed-secret" && secret === "shhb_valid",
        recordHeartbeatCheckIn: async (input) => {
          receivedCheckIns.push({ ...input, checkedInAt: input.checkedInAt.toISOString() });
          return monitor({ id: input.monitorId, kind: "heartbeat" });
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/heartbeats/mon_1",
      headers: { authorization: "Bearer shhb_valid" }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true });
    expect(receivedCheckIns).toEqual([
      {
        monitorId: "mon_1",
        checkedInAt: expect.any(String)
      }
    ]);
  });

  it("rejects invalid heartbeat secrets", async () => {
    app = await buildApp({
      readiness,
      monitors: {
        getMonitor: async (id) =>
          monitor({
            id,
            kind: "heartbeat",
            secretHash: "hashed-secret",
            url: null,
            method: null,
            expectedStatus: null,
            timeoutMs: null,
            intervalMinutes: null,
            expectedIntervalMinutes: 5,
            graceMinutes: 2
          }),
        verifyHeartbeatSecret: async () => false,
        recordHeartbeatCheckIn: async () => monitor({ kind: "heartbeat" })
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/heartbeats/mon_1",
      headers: { authorization: "Bearer wrong" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_heartbeat_secret" });
  });
});
