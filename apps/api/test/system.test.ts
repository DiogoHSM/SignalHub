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

const retentionPolicy = {
  eventsDays: 90,
  errorsDays: 180,
  tracesDays: 90,
  spansDays: 90,
  llmCallsDays: 180,
  breadcrumbsDays: 30,
  deadLetterJobsDays: 30,
  sourceMapsEnabled: true,
  sourceMapsDays: 180,
  sourceMapsBatchSize: 100
};

const systemHealthSnapshot: SystemHealthSnapshot = {
  generatedAt: "2026-05-06T12:00:00.000Z",
  status: "degraded",
  services: {
    api: { status: "healthy", uptimeSeconds: 10 },
    postgres: { status: "healthy", latencyMs: 2 },
    redis: { status: "healthy", latencyMs: 3 },
    worker: { status: "degraded", expected: true, role: null, lastHeartbeatAt: null },
    scheduler: { status: "healthy", expected: false, role: null, lastHeartbeatAt: null }
  },
  deployment: {
    api: {
      nodeEnv: "unknown",
      consoleEnabled: false,
      publicEndpointConfigured: false,
      googleOAuthEnabled: false,
      smtpConfigured: false
    },
    background: {
      queueExpected: true,
      schedulerExpected: false,
      alertsEnabled: false,
      alertsIntervalMinutes: 0,
      monitorsEnabled: false,
      monitorsIntervalMinutes: 0,
      retentionEnabled: true,
      retentionIntervalMinutes: 60,
      backupsEnabled: true,
      backupsIntervalHours: 24
    },
    storage: {
      backupS3Enabled: true,
      sourceMapRetentionEnabled: true
    }
  },
  queues: { telemetry: { status: "healthy", errorMessage: null, waiting: 0, active: 0, completed: 1, failed: 0, delayed: 0, deadLettered: 0 } },
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
    lastRun: {
      id: "ret_1",
      status: "success",
      startedAt: "2026-05-06T10:00:00.000Z",
      finishedAt: "2026-05-06T10:00:05.000Z",
      deleted: {
        events: 10,
        errors: 1,
        traces: 3,
        spans: 8,
        llmCalls: 2,
        breadcrumbs: 4,
        deadLetterJobs: 0,
          sourceMapArtifacts: 2,
        sourceMapFiles: 2
      },
      errorMessage: null
    },
    policy: retentionPolicy
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
      filename: "sigmon-20260506T000000Z.dump",
      sizeBytes: 1234,
      s3Bucket: "sigmon-backups",
      s3Key: "prod/sigmon/sigmon-20260506T000000Z.dump",
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
    const snapshot = response.json().data as SystemHealthSnapshot;
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.retention.policy.sourceMapsEnabled).toBe(true);
    expect(snapshot.retention.policy.sourceMapsDays).toBe(180);
    expect(snapshot.retention.policy.sourceMapsBatchSize).toBe(100);
    expect(snapshot.retention.lastRun?.deleted.sourceMapArtifacts).toBe(2);
    expect(snapshot.retention.lastRun?.deleted.sourceMapFiles).toBe(2);
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
        policy: retentionPolicy
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
    expect(snapshot.services.worker).toEqual({ status: "degraded", expected: true, role: null, lastHeartbeatAt: null });
    expect(snapshot.services.scheduler).toEqual({
      status: "healthy",
      expected: false,
      role: null,
      lastHeartbeatAt: null
    });
    expect(snapshot.queues.telemetry).toEqual({
      status: "unhealthy",
      errorMessage: "Queue counts unavailable",
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      deadLettered: 0
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

  it("reports queue worker and scheduler health separately with deploy readiness config", async () => {
    const snapshot = await createSystemHealthSnapshot({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      uptimeSeconds: () => 12,
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: retentionPolicy
      },
      backups: {
        enabled: true,
        intervalHours: 24,
        retentionDays: 14,
        s3Enabled: false
      },
      runtime: {
        nodeEnv: "production",
        consoleEnabled: true,
        publicEndpointConfigured: true,
        googleOAuthEnabled: true,
        smtpConfigured: true,
        alertsEnabled: true,
        alertsIntervalMinutes: 1,
        monitorsEnabled: true,
        monitorsIntervalMinutes: 1,
        sourceMapRetentionEnabled: true
      },
      postgresPing: async () => undefined,
      redisPing: async () => "PONG",
      getQueueCounts: async () => ({}),
      getHeartbeats: async () => ({
        worker: {
          lastHeartbeatAt: new Date("2026-05-06T11:59:30.000Z"),
          metadata: { role: "queue", queue: true, scheduler: false, alerts: false, monitors: false }
        },
        scheduler: {
          lastHeartbeatAt: new Date("2026-05-06T11:59:40.000Z"),
          metadata: { role: "scheduler", queue: false, scheduler: true, alerts: true, monitors: true }
        }
      }),
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
          startedAt: new Date("2026-05-06T11:00:00.000Z"),
          finishedAt: new Date("2026-05-06T11:00:05.000Z"),
          filename: "sigmon-20260506T110000Z.dump",
          localPath: "/var/lib/sigmon/backups/sigmon-20260506T110000Z.dump",
          sizeBytes: 1234,
          s3Bucket: null,
          s3Key: null,
          errorMessage: null
        },
        latestFailure: null
      })
    });

    expect(snapshot.status).toBe("healthy");
    expect(snapshot.services.worker).toEqual({
      status: "healthy",
      expected: true,
      lastHeartbeatAt: "2026-05-06T11:59:30.000Z",
      role: "queue"
    });
    expect(snapshot.services.scheduler).toEqual({
      status: "healthy",
      expected: true,
      lastHeartbeatAt: "2026-05-06T11:59:40.000Z",
      role: "scheduler"
    });
    expect(snapshot.deployment).toEqual({
      api: {
        nodeEnv: "production",
        consoleEnabled: true,
        publicEndpointConfigured: true,
        googleOAuthEnabled: true,
        smtpConfigured: true
      },
      background: {
        queueExpected: true,
        schedulerExpected: true,
        alertsEnabled: true,
        alertsIntervalMinutes: 1,
        monitorsEnabled: true,
        monitorsIntervalMinutes: 1,
        retentionEnabled: true,
        retentionIntervalMinutes: 60,
        backupsEnabled: true,
        backupsIntervalHours: 24
      },
      storage: {
        backupS3Enabled: false,
        sourceMapRetentionEnabled: true
      }
    });
  });

  it("degrades system health when dead-letter jobs need attention", async () => {
    const snapshot = await createSystemHealthSnapshot({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      uptimeSeconds: () => 12,
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: retentionPolicy
      },
      backups: {
        enabled: false,
        intervalHours: 24,
        retentionDays: 14,
        s3Enabled: false
      },
      postgresPing: async () => true,
      redisPing: async () => "PONG",
      getQueueCounts: async () => ({ waiting: 0, active: 0, completed: 5, failed: 0, delayed: 0 }),
      getDeadLetterCount: async () => 2,
      getHeartbeats: async () => ({
        worker: { lastHeartbeatAt: new Date("2026-05-06T11:59:00.000Z"), metadata: { role: "queue" } },
        scheduler: null
      }),
      getIngestionFreshness: async () => ({
        lastEventAt: null,
        lastErrorAt: null,
        lastTraceAt: null,
        lastSpanAt: null,
        lastLlmCallAt: null
      }),
      getLastRetentionRun: async () => null,
      getBackupStatus: async () => ({ latestSuccess: null, latestFailure: null })
    });

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.queues.telemetry).toMatchObject({ status: "degraded", deadLettered: 2 });
  });

  it("includes source-map retention policy and deleted counts in snapshots", async () => {
    const policyWithInternalField = { ...retentionPolicy, internalOnly: "do-not-serialize" };
    const deletedCountsWithInternalField = {
      events: 10,
      errors: 1,
      traces: 3,
      spans: 8,
      llmCalls: 2,
      breadcrumbs: 4,
      deadLetterJobs: 5,
      sourceMapArtifacts: 2,
      sourceMapFiles: 2,
      internalOnly: 99
    };

    const snapshot = await createSystemHealthSnapshot({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      uptimeSeconds: () => 12,
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: policyWithInternalField
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
      getLastRetentionRun: async () => ({
        id: "ret_1",
        status: "success",
        startedAt: new Date("2026-05-06T10:00:00.000Z"),
        finishedAt: new Date("2026-05-06T10:00:05.000Z"),
        deleted: deletedCountsWithInternalField,
        errorMessage: null
      }),
      getBackupStatus: async () => ({
        latestSuccess: null,
        latestFailure: null
      })
    });

    expect(snapshot.retention.policy.sourceMapsEnabled).toBe(true);
    expect(snapshot.retention.policy.sourceMapsDays).toBe(180);
    expect(snapshot.retention.policy.sourceMapsBatchSize).toBe(100);
    expect(snapshot.retention.policy).toEqual(retentionPolicy);
    expect(snapshot.retention.lastRun?.deleted.sourceMapArtifacts).toBe(2);
    expect(snapshot.retention.lastRun?.deleted.sourceMapFiles).toBe(2);
    expect(snapshot.retention.lastRun?.deleted.deadLetterJobs).toBe(5);
    expect(snapshot.retention.lastRun?.deleted).toEqual({
      events: 10,
      errors: 1,
      traces: 3,
      spans: 8,
      llmCalls: 2,
      breadcrumbs: 4,
      deadLetterJobs: 5,
      sourceMapArtifacts: 2,
      sourceMapFiles: 2
    });
  });

  it("includes backup status and marks stale backups degraded", async () => {
    const snapshot = await createSystemHealthSnapshot({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: retentionPolicy
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
          filename: "sigmon-20260506T000000Z.dump",
          localPath: "/var/lib/sigmon/backups/sigmon-20260506T000000Z.dump",
          sizeBytes: 1234,
          s3Bucket: "sigmon-backups",
          s3Key: "prod/sigmon/sigmon-20260506T000000Z.dump",
          errorMessage: null,
          createdAt: new Date("2026-05-06T00:00:05.000Z")
        },
        latestFailure: null
      })
    });

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.backups.stale).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("/var/lib/sigmon");
  });

  it("marks health degraded when the latest failed backup is newer than the latest success", async () => {
    const snapshot = await createSystemHealthSnapshot({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: retentionPolicy
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
          filename: "sigmon-20260506T100000Z.dump",
          localPath: "/var/lib/sigmon/backups/sigmon-20260506T100000Z.dump",
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
          filename: "sigmon-20260506T110000Z.dump",
          localPath: "/var/lib/sigmon/backups/sigmon-20260506T110000Z.dump",
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
    expect(JSON.stringify(snapshot)).not.toContain("/var/lib/sigmon");
  });

  it("marks backup status unknown when backup metadata cannot be loaded", async () => {
    const snapshot = await createSystemHealthSnapshot({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: retentionPolicy
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
        policy: retentionPolicy
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
          filename: "sigmon-20260506T110000Z.dump",
          localPath: "/var/lib/sigmon/backups/sigmon-20260506T110000Z.dump",
          sizeBytes: null,
          s3Bucket: null,
          s3Key: null,
          errorMessage: "pg_restore failed for /var/lib/sigmon/backups/sigmon-20260506T110000Z.dump",
          createdAt: new Date("2026-05-06T11:00:05.000Z")
        }
      })
    });

    expect(snapshot.backups.latestFailure?.errorMessage).toBe("pg_restore failed for [REDACTED_PATH]");
    expect(JSON.stringify(snapshot)).not.toContain("/var/lib/sigmon");
  });

  it("redacts local backup directory paths from backup failure messages", async () => {
    const snapshot = await createSystemHealthSnapshot({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: retentionPolicy
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
          filename: "sigmon-20260506T110000Z.dump",
          localPath: "/var/lib/sigmon/backups/sigmon-20260506T110000Z.dump",
          sizeBytes: null,
          s3Bucket: null,
          s3Key: null,
          errorMessage: "scandir '/var/lib/sigmon/backups'",
          createdAt: new Date("2026-05-06T11:00:05.000Z")
        }
      })
    });

    expect(snapshot.backups.latestFailure?.errorMessage).toBe("scandir '[REDACTED_PATH]'");
    expect(JSON.stringify(snapshot)).not.toContain("/var/lib/sigmon");
  });

  it("redacts custom local backup paths from backup failure messages", async () => {
    const snapshot = await createSystemHealthSnapshot({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      retention: {
        enabled: true,
        intervalMinutes: 60,
        policy: retentionPolicy
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
          filename: "sigmon-20260506T110000Z.dump",
          localPath: "/data/sigmon-dumps/sigmon-20260506T110000Z.dump",
          sizeBytes: null,
          s3Bucket: null,
          s3Key: null,
          errorMessage: "stat /data/sigmon-dumps/sigmon-20260506T110000Z.dump failed",
          createdAt: new Date("2026-05-06T11:00:05.000Z")
        }
      })
    });

    expect(snapshot.backups.latestFailure?.errorMessage).toBe("stat [REDACTED_PATH] failed");
    expect(JSON.stringify(snapshot)).not.toContain("/data/sigmon-dumps");
  });
});

const sampleHistory = [
  {
    capturedAt: "2026-06-23T12:00:00.000Z",
    postgresLatencyMs: 2,
    redisLatencyMs: 3,
    queueWaiting: 4,
    queueActive: 5,
    queueFailed: 6
  },
  {
    capturedAt: "2026-06-23T12:05:00.000Z",
    postgresLatencyMs: 7,
    redisLatencyMs: null,
    queueWaiting: 0,
    queueActive: 0,
    queueFailed: 0
  }
];

describe("system health history routes", () => {
  it("requires authentication", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: undefined,
      system: { getHealth: async () => systemHealthSnapshot, getHistory: async () => sampleHistory }
    });

    const response = await app.inject({ method: "GET", url: "/system/health/history" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns unavailable when the history dependency is missing", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth,
      system: { getHealth: async () => systemHealthSnapshot }
    });

    const response = await app.inject({ method: "GET", url: "/system/health/history" });
    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "system_health_history_unavailable" });
  });

  it("returns history oldest -> newest for authenticated users", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth,
      system: { getHealth: async () => systemHealthSnapshot, getHistory: async () => sampleHistory }
    });

    const response = await app.inject({ method: "GET", url: "/system/health/history" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: sampleHistory });
  });

  it("clamps the limit to [1, 480] and defaults to 60", async () => {
    const seen: number[] = [];
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth,
      system: {
        getHealth: async () => systemHealthSnapshot,
        getHistory: async ({ limit }) => {
          seen.push(limit);
          return sampleHistory;
        }
      }
    });

    await app.inject({ method: "GET", url: "/system/health/history" });
    await app.inject({ method: "GET", url: "/system/health/history?limit=0" });
    await app.inject({ method: "GET", url: "/system/health/history?limit=9999" });
    await app.inject({ method: "GET", url: "/system/health/history?limit=abc" });

    expect(seen).toEqual([60, 1, 480, 60]);
  });

  it("returns unavailable when the history dependency fails", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth,
      system: {
        getHealth: async () => systemHealthSnapshot,
        getHistory: async () => {
          throw new Error("history dependency failed");
        }
      }
    });

    const response = await app.inject({ method: "GET", url: "/system/health/history" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "system_health_history_unavailable" });
  });
});
