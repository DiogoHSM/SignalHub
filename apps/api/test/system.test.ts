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
  queues: { telemetry: { status: "healthy", errorMessage: null, waiting: 0, active: 0, completed: 1, failed: 0, delayed: 0 } },
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
    policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180, breadcrumbsDays: 30 }
  },
  backups: {
    enabled: true,
    intervalHours: 24,
    retentionDays: 14,
    s3Enabled: true,
    stale: false,
    latestSuccess: {
      id: "bkp_1",
      status: "success",
      trigger: "scheduled",
      startedAt: "2026-05-06T00:00:00.000Z",
      finishedAt: "2026-05-06T00:00:05.000Z",
      filename: "signalhub-20260506T000000Z.dump",
      sizeBytes: 1234,
      s3Bucket: "signalhub-backups",
      s3Key: "prod/signalhub/signalhub-20260506T000000Z.dump",
      errorMessage: null
    },
    latestFailure: null
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
        policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180, breadcrumbsDays: 30 }
      },
      backups: {
        enabled: true,
        intervalHours: 24,
        retentionDays: 14,
        s3Enabled: false
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
      },
      getBackupStatus: async () => {
        throw new Error("postgres down");
      }
    });

    expect(snapshot.status).toBe("unhealthy");
    expect(snapshot.services.postgres).toEqual({ status: "unhealthy", latencyMs: null });
    expect(snapshot.services.redis.status).toBe("healthy");
    expect(snapshot.services.worker).toEqual({ status: "degraded", lastHeartbeatAt: null });
    expect(snapshot.queues.telemetry).toEqual({
      status: "unhealthy",
      errorMessage: "Queue counts unavailable",
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0
    });
    expect(snapshot.ingestion).toEqual({
      lastEventAt: null,
      lastErrorAt: null,
      lastTraceAt: null,
      lastSpanAt: null,
      lastLlmCallAt: null
    });
    expect(snapshot.retention.lastRun).toBeNull();
  });

  it("includes backup status and marks stale backups degraded", async () => {
    const snapshot = await createSystemHealthSnapshot({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180, breadcrumbsDays: 30 }
      },
      backups: {
        enabled: true,
        intervalHours: 4,
        retentionDays: 14,
        s3Enabled: true
      },
      postgresPing: async () => undefined,
      redisPing: async () => "PONG",
      getQueueCounts: async () => ({}),
      getHeartbeat: async () => ({ lastHeartbeatAt: new Date("2026-05-06T11:59:00.000Z") }),
      getIngestionFreshness: async () => ({
        lastEventAt: null,
        lastErrorAt: null,
        lastTraceAt: null,
        lastSpanAt: null,
        lastLlmCallAt: null
      }),
      getLastRetentionRun: async () => null,
      getBackupStatus: async () => ({
        latestSuccess: {
          id: "bkp_1",
          status: "success",
          trigger: "scheduled",
          startedAt: new Date("2026-05-06T00:00:00.000Z"),
          finishedAt: new Date("2026-05-06T00:00:05.000Z"),
          filename: "signalhub-20260506T000000Z.dump",
          localPath: "/var/lib/signalhub/backups/signalhub-20260506T000000Z.dump",
          sizeBytes: 1234,
          s3Bucket: "signalhub-backups",
          s3Key: "prod/signalhub/signalhub-20260506T000000Z.dump",
          errorMessage: null,
          createdAt: new Date("2026-05-06T00:00:05.000Z")
        },
        latestFailure: null
      })
    });

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.backups.stale).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("/var/lib/signalhub");
  });

  it("marks health degraded when the latest failed backup is newer than the latest success", async () => {
    const snapshot = await createSystemHealthSnapshot({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180, breadcrumbsDays: 30 }
      },
      backups: {
        enabled: true,
        intervalHours: 24,
        retentionDays: 14,
        s3Enabled: false
      },
      postgresPing: async () => undefined,
      redisPing: async () => "PONG",
      getQueueCounts: async () => ({}),
      getHeartbeat: async () => ({ lastHeartbeatAt: new Date("2026-05-06T11:59:00.000Z") }),
      getIngestionFreshness: async () => ({
        lastEventAt: null,
        lastErrorAt: null,
        lastTraceAt: null,
        lastSpanAt: null,
        lastLlmCallAt: null
      }),
      getLastRetentionRun: async () => null,
      getBackupStatus: async () => ({
        latestSuccess: {
          id: "bkp_success",
          status: "success",
          trigger: "scheduled",
          startedAt: new Date("2026-05-06T10:00:00.000Z"),
          finishedAt: new Date("2026-05-06T10:00:05.000Z"),
          filename: "signalhub-20260506T100000Z.dump",
          localPath: "/var/lib/signalhub/backups/signalhub-20260506T100000Z.dump",
          sizeBytes: 1234,
          s3Bucket: null,
          s3Key: null,
          errorMessage: null,
          createdAt: new Date("2026-05-06T10:00:05.000Z")
        },
        latestFailure: {
          id: "bkp_failure",
          status: "failed",
          trigger: "scheduled",
          startedAt: new Date("2026-05-06T11:00:00.000Z"),
          finishedAt: new Date("2026-05-06T11:00:05.000Z"),
          filename: "signalhub-20260506T110000Z.dump",
          localPath: "/var/lib/signalhub/backups/signalhub-20260506T110000Z.dump",
          sizeBytes: null,
          s3Bucket: null,
          s3Key: null,
          errorMessage: "pg_dump failed",
          createdAt: new Date("2026-05-06T11:00:05.000Z")
        }
      })
    });

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.backups.stale).toBe(false);
    expect(snapshot.backups.latestFailure?.id).toBe("bkp_failure");
    expect(JSON.stringify(snapshot)).not.toContain("/var/lib/signalhub");
  });

  it("marks backup status unknown when backup metadata cannot be loaded", async () => {
    const snapshot = await createSystemHealthSnapshot({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180, breadcrumbsDays: 30 }
      },
      backups: {
        enabled: true,
        intervalHours: 24,
        retentionDays: 14,
        s3Enabled: false
      },
      postgresPing: async () => undefined,
      redisPing: async () => "PONG",
      getQueueCounts: async () => ({}),
      getHeartbeat: async () => ({ lastHeartbeatAt: new Date("2026-05-06T11:59:00.000Z") }),
      getIngestionFreshness: async () => ({
        lastEventAt: null,
        lastErrorAt: null,
        lastTraceAt: null,
        lastSpanAt: null,
        lastLlmCallAt: null
      }),
      getLastRetentionRun: async () => null,
      getBackupStatus: async () => {
        throw new Error("backup metadata unavailable");
      }
    });

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.backups.stale).toBeNull();
    expect(snapshot.backups.latestSuccess).toBeNull();
    expect(snapshot.backups.latestFailure).toBeNull();
  });

  it("redacts local paths from backup failure messages", async () => {
    const snapshot = await createSystemHealthSnapshot({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180, breadcrumbsDays: 30 }
      },
      backups: {
        enabled: true,
        intervalHours: 24,
        retentionDays: 14,
        s3Enabled: false
      },
      postgresPing: async () => undefined,
      redisPing: async () => "PONG",
      getQueueCounts: async () => ({}),
      getHeartbeat: async () => ({ lastHeartbeatAt: new Date("2026-05-06T11:59:00.000Z") }),
      getIngestionFreshness: async () => ({
        lastEventAt: null,
        lastErrorAt: null,
        lastTraceAt: null,
        lastSpanAt: null,
        lastLlmCallAt: null
      }),
      getLastRetentionRun: async () => null,
      getBackupStatus: async () => ({
        latestSuccess: null,
        latestFailure: {
          id: "bkp_failure",
          status: "failed",
          trigger: "manual",
          startedAt: new Date("2026-05-06T11:00:00.000Z"),
          finishedAt: new Date("2026-05-06T11:00:05.000Z"),
          filename: "signalhub-20260506T110000Z.dump",
          localPath: "/var/lib/signalhub/backups/signalhub-20260506T110000Z.dump",
          sizeBytes: null,
          s3Bucket: null,
          s3Key: null,
          errorMessage: "pg_restore failed for /var/lib/signalhub/backups/signalhub-20260506T110000Z.dump",
          createdAt: new Date("2026-05-06T11:00:05.000Z")
        }
      })
    });

    expect(snapshot.backups.latestFailure?.errorMessage).toBe("pg_restore failed for [REDACTED_PATH]");
    expect(JSON.stringify(snapshot)).not.toContain("/var/lib/signalhub");
  });

  it("redacts local backup directory paths from backup failure messages", async () => {
    const snapshot = await createSystemHealthSnapshot({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180, breadcrumbsDays: 30 }
      },
      backups: {
        enabled: true,
        intervalHours: 24,
        retentionDays: 14,
        s3Enabled: false
      },
      postgresPing: async () => undefined,
      redisPing: async () => "PONG",
      getQueueCounts: async () => ({}),
      getHeartbeat: async () => ({ lastHeartbeatAt: new Date("2026-05-06T11:59:00.000Z") }),
      getIngestionFreshness: async () => ({
        lastEventAt: null,
        lastErrorAt: null,
        lastTraceAt: null,
        lastSpanAt: null,
        lastLlmCallAt: null
      }),
      getLastRetentionRun: async () => null,
      getBackupStatus: async () => ({
        latestSuccess: null,
        latestFailure: {
          id: "bkp_failure",
          status: "failed",
          trigger: "scheduled",
          startedAt: new Date("2026-05-06T11:00:00.000Z"),
          finishedAt: new Date("2026-05-06T11:00:05.000Z"),
          filename: "signalhub-20260506T110000Z.dump",
          localPath: "/var/lib/signalhub/backups/signalhub-20260506T110000Z.dump",
          sizeBytes: null,
          s3Bucket: null,
          s3Key: null,
          errorMessage: "scandir '/var/lib/signalhub/backups'",
          createdAt: new Date("2026-05-06T11:00:05.000Z")
        }
      })
    });

    expect(snapshot.backups.latestFailure?.errorMessage).toBe("scandir '[REDACTED_PATH]'");
    expect(JSON.stringify(snapshot)).not.toContain("/var/lib/signalhub");
  });

  it("redacts custom local backup paths from backup failure messages", async () => {
    const snapshot = await createSystemHealthSnapshot({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180, breadcrumbsDays: 30 }
      },
      backups: {
        enabled: true,
        intervalHours: 24,
        retentionDays: 14,
        s3Enabled: false
      },
      postgresPing: async () => undefined,
      redisPing: async () => "PONG",
      getQueueCounts: async () => ({}),
      getHeartbeat: async () => ({ lastHeartbeatAt: new Date("2026-05-06T11:59:00.000Z") }),
      getIngestionFreshness: async () => ({
        lastEventAt: null,
        lastErrorAt: null,
        lastTraceAt: null,
        lastSpanAt: null,
        lastLlmCallAt: null
      }),
      getLastRetentionRun: async () => null,
      getBackupStatus: async () => ({
        latestSuccess: null,
        latestFailure: {
          id: "bkp_failure",
          status: "failed",
          trigger: "scheduled",
          startedAt: new Date("2026-05-06T11:00:00.000Z"),
          finishedAt: new Date("2026-05-06T11:00:05.000Z"),
          filename: "signalhub-20260506T110000Z.dump",
          localPath: "/data/signalhub-dumps/signalhub-20260506T110000Z.dump",
          sizeBytes: null,
          s3Bucket: null,
          s3Key: null,
          errorMessage: "stat /data/signalhub-dumps/signalhub-20260506T110000Z.dump failed",
          createdAt: new Date("2026-05-06T11:00:05.000Z")
        }
      })
    });

    expect(snapshot.backups.latestFailure?.errorMessage).toBe("stat [REDACTED_PATH] failed");
    expect(JSON.stringify(snapshot)).not.toContain("/data/signalhub-dumps");
  });
});
