import { createStructuredLogger, loadConfig } from "@sigmon/config";
import { createDb } from "@sigmon/db";
import { migrate } from "@sigmon/db/migrate.js";
import {
  archiveProjectBrowserOrigin,
  archiveEnvironment,
  archiveProject,
  createApiKeyRecord,
  createEnvironment,
  createProject,
  createProjectBrowserOrigin,
  findApiKeyByPrefix,
  getProject,
  isBrowserOriginAllowed,
  listApiKeys,
  listEnvironments,
  listProjectBrowserOrigins,
  listProjects,
  revokeApiKey,
  updateApiKeyRecord,
  updateEnvironment,
  updateProject
} from "@sigmon/db/repositories/admin.js";
import {
  archiveAlertRule,
  archiveNotificationChannel,
  buildAlertSuggestions,
  createAlertRule,
  createNotificationChannel,
  getAlertEvent,
  getNotificationChannel,
  listAlertEvents,
  listAlertRules,
  listNotificationChannels,
  updateAlertRule,
  updateNotificationChannel
} from "@sigmon/db/repositories/alerts.js";
import {
  archiveMonitor,
  createHeartbeatMonitor,
  createHttpMonitor,
  getMonitor,
  listMonitorChecks,
  listMonitors,
  recordHeartbeatCheckIn,
  updateMonitor
} from "@sigmon/db/repositories/monitors.js";
import {
  countDeadLetterJobs,
  deleteExpiredDeadLetterJobs,
  deleteDeadLetterJobWithAction,
  getDeadLetterJob,
  listDeadLetterJobActions,
  listDeadLetterJobs
} from "@sigmon/db/repositories/dead-letter.js";
import {
  archiveUser,
  createUser,
  findUserByEmail,
  findUserByGoogleSubject,
  findUserById,
  linkGoogleSubject,
  listUsers,
  updateUser
} from "@sigmon/db/repositories/users.js";
import { getBackupStatus, recordBackupRun, withBackupLock } from "@sigmon/db/repositories/backups.js";
import {
  deleteExpiredTelemetry,
  getHeartbeat,
  getIngestionFreshness,
  getLastRetentionRun,
  recordRetentionRun,
  withRetentionLock
} from "@sigmon/db/repositories/system.js";
import { listSystemHealthSamples } from "@sigmon/db/repositories/system-health-samples.js";
import {
  findSourceMapArtifactForFrame,
  getCachedErrorStackResolution,
  listExpiredSourceMapArtifacts,
  listSourceMapArtifactsPage,
  replaceErrorStackResolutions,
  softDeleteSourceMapArtifactForRetention
} from "@sigmon/db/repositories/source-maps.js";
import {
  createSourceMapUploadTokenRecord,
  findSourceMapUploadTokenByPrefix,
  listSourceMapUploadTokens,
  revokeSourceMapUploadToken,
  updateSourceMapUploadToken,
  updateSourceMapUploadTokenLastUsed
} from "@sigmon/db/repositories/source-map-upload-tokens.js";
import {
  getErrorAggregates,
  getErrorForSourceMapResolution,
  getEventAggregates,
  getLlmAggregates,
  getLlmSummary,
  getLlmByTenant,
  getLlmByPrompt,
  getLlmCostByModel,
  getOverview,
  getTraceAggregates,
  listErrors,
  listEvents,
  listLlmCalls,
  listTraceSpans,
  listTraces
} from "@sigmon/db/repositories/telemetry-query.js";
import { getOperations } from "@sigmon/db/repositories/operations-query.js";
import { getSessionTimeline } from "@sigmon/db/repositories/session-timeline.js";
import {
  getErrorGroup,
  listErrorGroupsPage,
  updateErrorGroupStatus,
  updateErrorGroupTriage
} from "@sigmon/db/repositories/error-groups.js";
import { getErrorGroupIncident } from "@sigmon/db/repositories/incidents.js";
import {
  assignIncident,
  addTriageNote,
  silenceIncident,
  getIncidentMttr
} from "@sigmon/db/repositories/incident-triage.js";
import { getEntityTenantDetail, listEntityTenants } from "@sigmon/db/repositories/entities-query.js";
import { identifyTenantProfile, identifyUserProfile } from "@sigmon/db/repositories/identity-profiles.js";
import { getFleetRollup, getProjectFleetEnvironments } from "@sigmon/db/repositories/fleet-query.js";
import { getUserDetail, listUsersActivity } from "@sigmon/db/repositories/users-query.js";
import { createTelemetryQueue, enqueueTelemetryJob, replayTelemetryJob } from "@sigmon/queues";
import { hashPassword, verifyPassword } from "@sigmon/telemetry/auth";
import { verifyApiKey } from "@sigmon/telemetry/api-keys";
import { createId } from "@sigmon/telemetry/ids";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import { sql } from "kysely";
import { z } from "zod";
import { buildApp } from "./app.js";
import { replayDeadLetterTelemetryJob } from "./dead-letter-replay.js";
import {
  getSessionCookieName,
  getSessionCookieOptions,
  type AuthDependencies,
  type AuthSessionContext,
  type AuthUser,
  type CookieCapableReply
} from "./routes/auth.js";
import {
  deleteSourceMapArtifactAndFile,
  readSourceMapFile,
  uploadSingleSourceMap,
  uploadSourceMapBundle
} from "./source-maps/storage.js";
import { resolveErrorStackWithSourceMaps } from "./source-maps/resolver.js";
import { createSystemHealthSnapshot } from "./system-health.js";
import { listenWithCleanup, runShutdownSteps, runSignalShutdown } from "./runtime.js";
import { fetchWithTimeoutAndRetry } from "./fetch-retry.js";
import { runBackupOnce } from "../../worker/src/backups.js";
import { runRetentionOnce } from "../../worker/src/retention.js";
import { deleteExpiredSourceMapArtifacts } from "../../worker/src/source-map-retention.js";

const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;

type SessionPayload = {
  userId: string;
  exp: number;
};

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function signSessionPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function createSessionToken(payload: SessionPayload, secret: string): string {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signSessionPayload(encodedPayload, secret)}`;
}

function parseSessionToken(token: string, secret: string): SessionPayload | undefined {
  const tokenParts = token.split(".");
  if (tokenParts.length !== 2) {
    return undefined;
  }

  const [encodedPayload, signature] = tokenParts;
  if (!encodedPayload || !signature) {
    return undefined;
  }

  const expectedSignature = signSessionPayload(encodedPayload, secret);
  if (!timingSafeStringEqual(signature, expectedSignature)) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof payload.userId !== "string" || typeof payload.exp !== "number") {
      return undefined;
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return undefined;
    }

    return payload as SessionPayload;
  } catch {
    return undefined;
  }
}

function toAuthUser(user: { id: string; email: string; isAdmin: boolean }): AuthUser {
  return {
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin
  };
}

const googleTokenResponseSchema = z.object({
  access_token: z.string().min(1)
});
const googleUserInfoSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean()
});

const logger = createStructuredLogger("api");
const config = loadConfig();
const sessionCookieName = getSessionCookieName(config.nodeEnv);
const db = createDb(config.databaseUrl);
await migrate(db);

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null
});
const telemetryQueue = createTelemetryQueue(config.redisUrl);
const retentionPolicy = {
  eventsDays: config.retention.eventsDays,
  errorsDays: config.retention.errorsDays,
  tracesDays: config.retention.tracesDays,
  spansDays: config.retention.spansDays,
  llmCallsDays: config.retention.llmCallsDays,
  breadcrumbsDays: config.retention.breadcrumbsDays,
  deadLetterJobsDays: config.retention.deadLetterJobsDays,
  sourceMapsEnabled: config.sourceMaps.retention.enabled,
  sourceMapsDays: config.sourceMaps.retention.days,
  sourceMapsBatchSize: config.sourceMaps.retention.batchSize
};

function setSessionCookie(reply: CookieCapableReply, userId: string): void {
  const sessionToken = createSessionToken(
    {
      userId,
      exp: Math.floor(Date.now() / 1000) + sessionMaxAgeSeconds
    },
    config.sessionSecret
  );
  reply.setCookie(sessionCookieName, sessionToken, getSessionCookieOptions(config.nodeEnv, sessionMaxAgeSeconds));
}

function createGoogleAuthorizationUrl(state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.googleOAuth.clientId);
  url.searchParams.set("redirect_uri", config.googleOAuth.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");

  return url.toString();
}

async function fetchGoogleUserInfo(code: string): Promise<z.infer<typeof googleUserInfoSchema>> {
  const tokenResponse = await fetchWithTimeoutAndRetry("https://oauth2.googleapis.com/token", {
    method: "POST",
    attempts: 3,
    timeoutMs: 5000,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleOAuth.clientId,
      client_secret: config.googleOAuth.clientSecret,
      redirect_uri: config.googleOAuth.redirectUri,
      grant_type: "authorization_code",
      code
    })
  });
  if (!tokenResponse.ok) {
    throw new Error("google_token_exchange_failed");
  }

  const token = googleTokenResponseSchema.parse(await tokenResponse.json());
  const userInfoResponse = await fetchWithTimeoutAndRetry("https://openidconnect.googleapis.com/v1/userinfo", {
    attempts: 3,
    timeoutMs: 5000,
    headers: { authorization: `Bearer ${token.access_token}` }
  });
  if (!userInfoResponse.ok) {
    throw new Error("google_userinfo_failed");
  }

  return googleUserInfoSchema.parse(await userInfoResponse.json());
}

async function completeGoogleOAuth(code: string, _state: string, { reply }: AuthSessionContext): Promise<AuthUser | null> {
  const profile = await fetchGoogleUserInfo(code);
  if (!profile.email_verified) {
    return null;
  }

  const existingBySubject = await findUserByGoogleSubject(db, profile.sub);
  if (existingBySubject) {
    setSessionCookie(reply, existingBySubject.id);
    return toAuthUser(existingBySubject);
  }

  const existingByEmail = await findUserByEmail(db, profile.email);
  if (!existingByEmail || (existingByEmail.googleSubject && existingByEmail.googleSubject !== profile.sub)) {
    return null;
  }

  const linkedUser = existingByEmail.googleSubject
    ? existingByEmail
    : await linkGoogleSubject(db, existingByEmail.id, profile.sub);
  if (!linkedUser) {
    return null;
  }

  setSessionCookie(reply, linkedUser.id);
  return toAuthUser(linkedUser);
}

async function verifyIngestionApiKey(secret: string): Promise<{ projectId: string; environmentId: string } | null> {
  const apiKey = await findApiKeyByPrefix(db, secret.slice(0, 12));
  if (!apiKey) {
    return null;
  }

  const valid = await verifyApiKey(apiKey.hash, secret, config.apiKeyPepper);
  return valid
    ? {
        projectId: apiKey.projectId,
        environmentId: apiKey.environmentId
      }
    : null;
}

const auth: AuthDependencies = {
  login: async (email, password, { reply }) => {
    const user = await findUserByEmail(db, email);
    if (!user?.passwordHash) {
      return null;
    }

    const validPassword = await verifyPassword(user.passwordHash, password);
    if (!validPassword) {
      return null;
    }

    setSessionCookie(reply, user.id);

    return toAuthUser(user);
  },
  findSessionUser: async (request) => {
    const token = request.cookies[sessionCookieName];
    if (!token) {
      return null;
    }

    const session = parseSessionToken(token, config.sessionSecret);
    if (!session) {
      return null;
    }

    const user = await findUserById(db, session.userId);
    return user ? toAuthUser(user) : null;
  },
  logout: async ({ reply }) => {
    reply.clearCookie(sessionCookieName, { path: "/" });
  },
  googleOAuth: config.googleOAuth.enabled
    ? {
        createAuthorizationUrl: createGoogleAuthorizationUrl,
        complete: completeGoogleOAuth
      }
    : undefined
};

function getSystemHealth() {
  return createSystemHealthSnapshot({
    retention: {
      enabled: config.retention.enabled,
      intervalMinutes: config.retention.intervalMinutes,
      policy: retentionPolicy
    },
    backups: {
      enabled: config.backups.enabled,
      intervalHours: config.backups.intervalHours,
      retentionDays: config.backups.retentionDays,
      s3Enabled: config.backups.s3.enabled
    },
    runtime: {
      nodeEnv: config.nodeEnv,
      consoleEnabled: config.console.enabled,
      publicEndpointConfigured: Boolean(config.console.publicEndpoint),
      googleOAuthEnabled: config.googleOAuth.enabled,
      smtpConfigured: config.smtp.enabled,
      alertsEnabled: config.alerts.enabled,
      alertsIntervalMinutes: config.alerts.intervalMinutes,
      monitorsEnabled: config.monitors.enabled,
      monitorsIntervalMinutes: config.monitors.intervalMinutes,
      sourceMapRetentionEnabled: config.sourceMaps.retention.enabled
    },
    postgresPing: () => sql`select 1`.execute(db),
    redisPing: () => redis.ping(),
    getQueueCounts: () => telemetryQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
    getDeadLetterCount: () => countDeadLetterJobs(db),
    getHeartbeats: async () => {
      const [worker, scheduler] = await Promise.all([getHeartbeat(db, "worker"), getHeartbeat(db, "scheduler")]);
      return { worker, scheduler };
    },
    getIngestionFreshness: () => getIngestionFreshness(db),
    getLastRetentionRun: () => getLastRetentionRun(db),
    getBackupStatus: () => getBackupStatus(db)
  });
}

async function runSystemDoctor() {
  const snapshot = await getSystemHealth();
  const degradedServices = Object.entries(snapshot.services)
    .filter(([, service]) => service.status !== "healthy")
    .map(([name, service]) => `${name}:${service.status}`);
  const queueProblems = Object.entries(snapshot.queues)
    .filter(([, queue]) => queue.status !== "healthy")
    .map(([name, queue]) => `${name}:${queue.status}`);
  const problemSummary = [...degradedServices, ...queueProblems];

  return {
    status: "success" as const,
    message:
      problemSummary.length === 0
        ? "Doctor completed: system is operational."
        : `Doctor completed: ${snapshot.status} (${problemSummary.join(", ")}).`
  };
}

function runManualRetention() {
  return runRetentionOnce({
    now: () => new Date(),
    policy: retentionPolicy,
    withLock: (run) =>
      withRetentionLock(db, (lockedDb) =>
        run({
          deleteExpiredTelemetry: () =>
            deleteExpiredTelemetry(lockedDb, {
              now: new Date(),
              batchSize: config.retention.batchSize,
              ...retentionPolicy
            }),
          deleteExpiredDeadLetterJobs: () =>
            deleteExpiredDeadLetterJobs(lockedDb, {
              cutoff: new Date(Date.now() - config.retention.deadLetterJobsDays * 24 * 60 * 60 * 1000),
              batchSize: config.retention.batchSize
            })
        })
      ),
    deleteExpiredSourceMapArtifacts: () =>
      deleteExpiredSourceMapArtifacts({
        localDir: config.sourceMaps.localDir,
        now: new Date(),
        retentionDays: config.sourceMaps.retention.days,
        batchSize: config.sourceMaps.retention.batchSize,
        listExpiredArtifacts: (input) => listExpiredSourceMapArtifacts(db, input),
        softDeleteArtifact: (id) => softDeleteSourceMapArtifactForRetention(db, id)
      }),
    recordRetentionRun: (input) => recordRetentionRun(db, input)
  }).then((result) => ({
    status: result.skipped ? ("skipped" as const) : ("success" as const),
    message: result.skipped ? "Retention skipped because another run is active." : "Retention completed.",
    ran: result.ran,
    skipped: result.skipped
  }));
}

function runManualBackup() {
  return runBackupOnce({
    now: () => new Date(),
    trigger: "manual",
    config: {
      ...config.backups,
      enabled: true,
      databaseUrl: config.databaseUrl
    },
    withLock: (run) => withBackupLock(db, run),
    recordBackupRun: (input) => recordBackupRun(db, input)
  }).then((result) => ({
    status: result.skipped ? ("skipped" as const) : ("success" as const),
    message: result.skipped ? "Backup skipped because another backup is active." : "Backup completed.",
    ran: result.ran,
    skipped: result.skipped
  }));
}

const app = await buildApp({
  readiness: async () => {
    const [postgres, redisReady] = await Promise.all([
      sql`select 1`.execute(db).then(
        () => true,
        () => false
      ),
      redis.ping().then(
        (value) => value === "PONG",
        () => false
      )
    ]);

    return { postgres, redis: redisReady };
  },
  auth,
  users: {
    listUsers: async () => (await listUsers(db)).map(toAuthUser),
    createUser: async (input) =>
      toAuthUser(
        await createUser(db, {
          email: input.email,
          passwordHash: await hashPassword(input.password),
          isAdmin: input.isAdmin
        })
      ),
    updateUser: async (id, input) => {
      const user = await updateUser(db, id, {
        email: input.email,
        passwordHash: input.password ? await hashPassword(input.password) : undefined,
        isAdmin: input.isAdmin
      });
      return user ? toAuthUser(user) : null;
    },
    archiveUser: (id) => archiveUser(db, id)
  },
  adminResources: {
    projects: {
      list: () => listProjects(db),
      get: (id) => getProject(db, id),
      create: (input) => createProject(db, input),
      update: (id, input) => updateProject(db, id, input),
      archive: (id) => archiveProject(db, id)
    },
    environments: {
      list: (projectId) => listEnvironments(db, projectId),
      create: (input) => createEnvironment(db, input),
      update: (id, input) => updateEnvironment(db, id, input),
      archive: (id) => archiveEnvironment(db, id)
    },
    apiKeys: {
      list: (projectId) => listApiKeys(db, projectId),
      create: (input) => createApiKeyRecord(db, input),
      update: (id, input) => updateApiKeyRecord(db, id, input),
      revoke: (id) => revokeApiKey(db, id)
    },
    browserOrigins: {
      list: (projectId) => listProjectBrowserOrigins(db, projectId),
      create: (input) => createProjectBrowserOrigin(db, input),
      archive: (id) => archiveProjectBrowserOrigin(db, id)
    }
  },
  ingestion: {
    verifyApiKey: verifyIngestionApiKey,
    enqueue: async (job) => {
      await enqueueTelemetryJob(telemetryQueue, job);
    }
  },
  identify: {
    verifyApiKey: verifyIngestionApiKey,
    identifyUser: (input) => identifyUserProfile(db, input),
    identifyTenant: (input) => identifyTenantProfile(db, input)
  },
  query: {
    listEvents: (filters) => listEvents(db, filters),
    listErrors: (filters) => listErrors(db, filters),
    listErrorGroups: (filters) => listErrorGroupsPage(db, filters),
    getErrorGroup: (id, filters) => getErrorGroup(db, { id, ...filters }),
    getErrorGroupIncident: (id, filters) => getErrorGroupIncident(db, { groupId: id, ...filters }),
    updateErrorGroupTriage: (id, input) => updateErrorGroupTriage(db, { id, ...input }),
    updateErrorGroupStatus: (id, input) => updateErrorGroupStatus(db, { id, ...input }),
    listLlmCalls: (filters) => listLlmCalls(db, filters),
    listTraces: (filters) => listTraces(db, filters),
    listTraceSpans: (_traceId, filters) => listTraceSpans(db, filters),
    getEventAggregates: (filters) => getEventAggregates(db, filters),
    getErrorAggregates: (filters) => getErrorAggregates(db, filters),
    getLlmAggregates: (filters) => getLlmAggregates(db, filters),
    getLlmSummary: (filters) => getLlmSummary(db, filters),
    getLlmByTenant: (filters) => getLlmByTenant(db, filters),
    getLlmByPrompt: (filters) => getLlmByPrompt(db, filters),
    getLlmCostByModel: (filters) => getLlmCostByModel(db, filters),
    getOverview: (filters) => getOverview(db, filters),
    getOperations: (filters) => getOperations(db, filters),
    getTraceAggregates: (filters) => getTraceAggregates(db, filters),
    listEntityTenants: (filters) => listEntityTenants(db, filters),
    getEntityTenantDetail: (tenantId, filters) => getEntityTenantDetail(db, tenantId, filters),
    listUsersActivity: (filters) => listUsersActivity(db, filters),
    getUserDetail: (userId, filters) => getUserDetail(db, userId, filters),
    getSessionTimeline: (filters) => getSessionTimeline(db, filters),
    resolveErrorStack: (input) =>
      resolveErrorStackWithSourceMaps({
        ...input,
        getErrorForSourceMapResolution: (scope) =>
          getErrorForSourceMapResolution(db, {
            id: scope.errorId,
            projectId: scope.projectId,
            environmentId: scope.environmentId
          }),
        getCachedErrorStackResolution: (errorId) => getCachedErrorStackResolution(db, errorId),
        findSourceMapArtifactForFrame: (scope) => findSourceMapArtifactForFrame(db, scope),
        readSourceMapFile: ({ storagePath }) => readSourceMapFile({ localDir: config.sourceMaps.localDir, storagePath }),
        replaceErrorStackResolutions: (resolutionInput) => replaceErrorStackResolutions(db, resolutionInput)
      }),
    getFleet: (window) => getFleetRollup(db, { window, getHealth: getSystemHealth }),
    getProjectFleetEnvironments: (projectId, window) => getProjectFleetEnvironments(db, { projectId, window }),
    assignIncident: (input) => assignIncident(db, input),
    addTriageNote: (input) => addTriageNote(db, input),
    silenceIncident: (input) => silenceIncident(db, input),
    getIncidentMttr: (input) => getIncidentMttr(db, input)
  },
  system: {
    getHealth: getSystemHealth,
    getHistory: ({ limit }) =>
      listSystemHealthSamples(db, { limit }).then((rows) =>
        rows.map((r) => ({
          capturedAt: r.capturedAt.toISOString(),
          postgresLatencyMs: r.postgresLatencyMs,
          redisLatencyMs: r.redisLatencyMs,
          queueWaiting: r.queueWaiting,
          queueActive: r.queueActive,
          queueFailed: r.queueFailed
        }))
      ),
    runDoctor: runSystemDoctor,
    runBackup: runManualBackup,
    runRetention: runManualRetention
  },
  alerts: {
    listNotificationChannels: () => listNotificationChannels(db),
    createNotificationChannel: (input) => createNotificationChannel(db, input),
    updateNotificationChannel: (id, input) => updateNotificationChannel(db, id, input),
    archiveNotificationChannel: (id) => archiveNotificationChannel(db, id),
    getNotificationChannel: (id) => getNotificationChannel(db, id),
    listAlertRules: (filters) => listAlertRules(db, filters),
    createAlertRule: (input) => createAlertRule(db, input),
    updateAlertRule: (id, input) => updateAlertRule(db, id, input),
    archiveAlertRule: (id) => archiveAlertRule(db, id),
    listAlertEvents: (filters) => listAlertEvents(db, filters),
    getAlertEvent: (id) => getAlertEvent(db, id),
    listAlertSuggestions: (filters) =>
      buildAlertSuggestions(db, { ...filters, now: new Date() })
  },
  monitors: {
    listMonitors: (filters) => listMonitors(db, filters),
    getMonitor: (id) => getMonitor(db, id),
    createHttpMonitor: (input) => createHttpMonitor(db, input),
    createHeartbeatMonitor: (input) => createHeartbeatMonitor(db, input),
    updateMonitor: (id, input) => updateMonitor(db, id, input),
    archiveMonitor: (id) => archiveMonitor(db, id),
    listMonitorChecks: (input) => listMonitorChecks(db, input),
    verifyHeartbeatSecret: (hash, secret) => verifyApiKey(hash, secret, config.apiKeyPepper),
    recordHeartbeatCheckIn: (input) => recordHeartbeatCheckIn(db, input)
  },
  deadLetters: {
    listDeadLetterJobs: (input) => listDeadLetterJobs(db, input),
    getDeadLetterJob: (id) => getDeadLetterJob(db, id),
    listDeadLetterJobActions: (id) => listDeadLetterJobActions(db, id),
    deleteDeadLetterJob: (id, actor) =>
      deleteDeadLetterJobWithAction(db, id, {
        action: "deleted",
        actor
      }),
    replayDeadLetterJob: (id, actor) =>
      replayDeadLetterTelemetryJob(
        {
          getDeadLetterJob: (jobId) => getDeadLetterJob(db, jobId),
          enqueueReplay: (payload, replayId) => replayTelemetryJob(telemetryQueue, payload, replayId),
          deleteDeadLetterJob: (jobId) =>
            deleteDeadLetterJobWithAction(db, jobId, {
              action: "replayed",
              actor
            }),
          createReplayAttemptId: () => createId("rpl")
        },
        id
      )
  },
  sourceMaps: {
    list: (filters) => listSourceMapArtifactsPage(db, filters),
    uploadMap: (input) =>
      uploadSingleSourceMap({
        db,
        localDir: config.sourceMaps.localDir,
        input
      }),
    uploadBundle: (input) =>
      uploadSourceMapBundle({
        db,
        localDir: config.sourceMaps.localDir,
        input
      }),
    remove: (input) =>
      deleteSourceMapArtifactAndFile({
        db,
        localDir: config.sourceMaps.localDir,
        input
      }),
    maxUploadBytes: config.sourceMaps.maxUploadMb * 1024 * 1024
  },
  sourceMapUploads: {
    verifyToken: async (secret) => {
      const token = await findSourceMapUploadTokenByPrefix(db, secret.slice(0, 16));
      if (!token) {
        return null;
      }

      const valid = await verifyApiKey(token.hash, secret, config.apiKeyPepper);
      if (!valid) {
        return null;
      }

      await updateSourceMapUploadTokenLastUsed(db, token.id);
      return {
        id: token.id,
        projectId: token.projectId,
        environmentId: token.environmentId
      };
    },
    uploadMap: (input) =>
      uploadSingleSourceMap({
        db,
        localDir: config.sourceMaps.localDir,
        input
      }),
    uploadBundle: (input) =>
      uploadSourceMapBundle({
        db,
        localDir: config.sourceMaps.localDir,
        input
      })
  },
  sourceMapUploadTokens: {
    list: (scope) => listSourceMapUploadTokens(db, scope),
    create: (input) => createSourceMapUploadTokenRecord(db, input),
    update: (input) => updateSourceMapUploadToken(db, input),
    revoke: (input) => revokeSourceMapUploadToken(db, input)
  },
  apiKeyPepper: config.apiKeyPepper,
  googleOAuthEnabled: config.googleOAuth.enabled,
  browserCorsOrigins: config.browserCors.origins,
  isBrowserCorsOriginAllowed: (origin) => isBrowserOriginAllowed(db, origin),
  nodeEnv: config.nodeEnv,
  console: {
    enabled: config.console.enabled,
    apiBasePath: "/",
    apiEndpoint: config.console.publicEndpoint,
    assetsDir:
      config.console.enabled ? fileURLToPath(new URL("../../console/dist/", import.meta.url)) : undefined
  }
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, "API shutting down");

  await runShutdownSteps(
    [
      { name: "app.close", run: () => app.close() },
      { name: "telemetryQueue.close", run: () => telemetryQueue.close() },
      { name: "redis.quit", run: () => redis.quit() },
      { name: "db.destroy", run: () => db.destroy() }
    ],
    10_000,
    logger
  );
}

logger.info({ port: config.port }, "API starting");
await listenWithCleanup({
  listen: () => app.listen({ port: config.port, host: "0.0.0.0" }),
  cleanup: () => shutdown("SIGTERM"),
  logger
});

process.once("SIGINT", (signal) => {
  void runSignalShutdown({
    shutdown: () => shutdown(signal),
    logger,
    failureMessage: "API shutdown failed"
  });
});

process.once("SIGTERM", (signal) => {
  void runSignalShutdown({
    shutdown: () => shutdown(signal),
    logger,
    failureMessage: "API shutdown failed"
  });
});
