import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { setCurrentUser } from "../plugins/request-context.js";
import type { AuthDependencies, AuthUser } from "./auth.js";

export type SystemStatus = "healthy" | "degraded" | "unhealthy";

export type SystemQueueCounts = {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  deadLettered: number;
};

export type BackgroundComponentHealth = {
  status: SystemStatus;
  expected: boolean;
  role: "all" | "queue" | "scheduler" | null;
  lastHeartbeatAt: string | null;
};

export type SystemBackupHealthRun = {
  id: string;
  status: "success" | "failed";
  trigger: "scheduled" | "manual";
  startedAt: string;
  finishedAt: string | null;
  filename: string;
  sizeBytes: number | null;
  s3Bucket: string | null;
  s3Key: string | null;
  errorMessage: string | null;
};

export type SystemHealthSnapshot = {
  generatedAt: string;
  status: SystemStatus;
  services: {
    api: { status: SystemStatus; uptimeSeconds: number };
    postgres: { status: SystemStatus; latencyMs: number | null };
    redis: { status: SystemStatus; latencyMs: number | null };
    worker: BackgroundComponentHealth;
    scheduler: BackgroundComponentHealth;
  };
  deployment: {
    api: {
      nodeEnv: string;
      consoleEnabled: boolean;
      publicEndpointConfigured: boolean;
      googleOAuthEnabled: boolean;
      smtpConfigured: boolean;
    };
    background: {
      queueExpected: boolean;
      schedulerExpected: boolean;
      alertsEnabled: boolean;
      alertsIntervalMinutes: number;
      monitorsEnabled: boolean;
      monitorsIntervalMinutes: number;
      retentionEnabled: boolean;
      retentionIntervalMinutes: number;
      backupsEnabled: boolean;
      backupsIntervalHours: number;
    };
    storage: {
      backupS3Enabled: boolean;
      sourceMapRetentionEnabled: boolean;
    };
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
        webVitals: number;
        profiles: number;
        breadcrumbs: number;
        deadLetterJobs: number;
        sourceMapArtifacts: number;
        sourceMapFiles: number;
      };
      errorMessage: string | null;
    } | null;
    policy: {
      eventsDays: number;
      errorsDays: number;
      tracesDays: number;
      spansDays: number;
      llmCallsDays: number;
      profilesDays: number;
      breadcrumbsDays: number;
      deadLetterJobsDays: number;
      sourceMapsEnabled: boolean;
      sourceMapsDays: number;
      sourceMapsBatchSize: number;
    };
  };
  backups: {
    enabled: boolean;
    intervalHours: number;
    retentionDays: number;
    s3Enabled: boolean;
    stale: boolean | null;
    latestSuccess: SystemBackupHealthRun | null;
    latestFailure: SystemBackupHealthRun | null;
  };
};

export type SystemHealthSampleResponse = {
  capturedAt: string;
  postgresLatencyMs: number | null;
  redisLatencyMs: number | null;
  queueWaiting: number;
  queueActive: number;
  queueFailed: number;
};

export type SystemActionResponse = {
  ok: true;
  action: "doctor" | "retention";
  status: "success" | "skipped";
  message: string;
  ran?: boolean;
  skipped?: boolean;
  generatedAt: string;
};

export type SystemBackupActionResponse = {
  ok: true;
  action: "backup";
  status: "accepted";
  message: "Backup queued.";
  jobId: string;
  generatedAt: string;
};

export type SystemHealthDependencies = {
  getHealth?: () => Promise<SystemHealthSnapshot>;
  getHistory?: (input: { limit: number }) => Promise<SystemHealthSampleResponse[]>;
  runDoctor?: () => Promise<Omit<SystemActionResponse, "ok" | "action" | "generatedAt">>;
  enqueueBackup?: (input: { requestedBy: string; requestedAt: string }) => Promise<{ jobId: string }>;
  runRetention?: () => Promise<Omit<SystemActionResponse, "ok" | "action" | "generatedAt">>;
};

function parseHistoryLimit(raw: unknown): number {
  const value = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(value)) return 60;
  return Math.min(480, Math.max(1, value));
}

async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthDependencies | undefined
): Promise<AuthUser | null> {
  const user = await auth?.findSessionUser(request as Parameters<AuthDependencies["findSessionUser"]>[0]);
  if (!user) {
    setCurrentUser(request, null);
    reply.code(401).send({ error: "unauthenticated" });
    return null;
  }
  setCurrentUser(request, user);
  return user;
}

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthDependencies | undefined
): Promise<AuthUser | null> {
  const user = await requireUser(request, reply, auth);
  if (!user) return null;
  if (!user.isAdmin) {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return user;
}

function actionPayload(
  action: SystemActionResponse["action"],
  result: Omit<SystemActionResponse, "ok" | "action" | "generatedAt">
): SystemActionResponse {
  return {
    ok: true,
    action,
    ...result,
    generatedAt: new Date().toISOString()
  };
}

export function registerSystemRoutes(
  app: FastifyInstance,
  options: { auth?: AuthDependencies; system?: SystemHealthDependencies }
): void {
  app.get("/system/health", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(request, reply, options.auth);
    if (!user) return;

    if (!options.system?.getHealth) {
      return reply.code(501).send({ error: "system_health_unavailable" });
    }

    try {
      return { data: await options.system.getHealth() };
    } catch {
      return reply.code(503).send({ error: "system_health_unavailable" });
    }
  });

  app.get("/system/health/history", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(request, reply, options.auth);
    if (!user) return;

    if (!options.system?.getHistory) {
      return reply.code(501).send({ error: "system_health_history_unavailable" });
    }

    const limit = parseHistoryLimit((request.query as { limit?: unknown } | undefined)?.limit);

    try {
      return { data: await options.system.getHistory({ limit }) };
    } catch {
      return reply.code(503).send({ error: "system_health_history_unavailable" });
    }
  });

  app.post("/system/actions/doctor", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await requireAdmin(request, reply, options.auth);
    if (!user) return;

    if (!options.system?.runDoctor) {
      return reply.code(501).send({ error: "system_doctor_unavailable" });
    }

    try {
      return actionPayload("doctor", await options.system.runDoctor());
    } catch {
      return reply.code(503).send({ error: "system_doctor_failed" });
    }
  });

  app.post("/system/actions/backup", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await requireAdmin(request, reply, options.auth);
    if (!user) return;

    if (!options.system?.enqueueBackup) {
      return reply.code(501).send({ error: "system_backup_unavailable" });
    }

    const generatedAt = new Date().toISOString();
    try {
      const { jobId } = await options.system.enqueueBackup({ requestedBy: user.id, requestedAt: generatedAt });
      const response: SystemBackupActionResponse = {
        ok: true,
        action: "backup",
        status: "accepted",
        message: "Backup queued.",
        jobId,
        generatedAt
      };
      return reply.code(202).send(response);
    } catch {
      return reply.code(503).send({ error: "system_backup_failed" });
    }
  });

  app.post("/system/actions/retention", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await requireAdmin(request, reply, options.auth);
    if (!user) return;

    if (!options.system?.runRetention) {
      return reply.code(501).send({ error: "system_retention_unavailable" });
    }

    try {
      return actionPayload("retention", await options.system.runRetention());
    } catch {
      return reply.code(503).send({ error: "system_retention_failed" });
    }
  });
}
