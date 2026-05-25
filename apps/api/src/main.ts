import { createStructuredLogger, loadConfig } from "@sigmon/config";
import { createDb } from "@sigmon/db";
import { migrate } from "@sigmon/db/migrate.js";
import {
  archiveEnvironment,
  archiveProject,
  createApiKeyRecord,
  createEnvironment,
  createProject,
  findApiKeyByPrefix,
  getProject,
  listApiKeys,
  listEnvironments,
  listProjects,
  revokeApiKey,
  updateEnvironment,
  updateProject
} from "@sigmon/db/repositories/admin.js";
import {
  archiveAlertRule,
  archiveNotificationChannel,
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
  archiveUser,
  createUser,
  findUserByEmail,
  findUserByGoogleSubject,
  findUserById,
  linkGoogleSubject,
  listUsers,
  updateUser
} from "@sigmon/db/repositories/users.js";
import { getBackupStatus } from "@sigmon/db/repositories/backups.js";
import {
  getHeartbeat,
  getIngestionFreshness,
  getLastRetentionRun
} from "@sigmon/db/repositories/system.js";
import {
  findSourceMapArtifactForFrame,
  getCachedErrorStackResolution,
  listSourceMapArtifacts,
  replaceErrorStackResolutions
} from "@sigmon/db/repositories/source-maps.js";
import {
  createSourceMapUploadTokenRecord,
  findSourceMapUploadTokenByPrefix,
  listSourceMapUploadTokens,
  revokeSourceMapUploadToken,
  updateSourceMapUploadTokenLastUsed
} from "@sigmon/db/repositories/source-map-upload-tokens.js";
import {
  getErrorAggregates,
  getErrorForSourceMapResolution,
  getEventAggregates,
  getLlmAggregates,
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
  listErrorGroups,
  updateErrorGroupStatus,
  updateErrorGroupTriage
} from "@sigmon/db/repositories/error-groups.js";
import { getErrorGroupIncident } from "@sigmon/db/repositories/incidents.js";
import { getEntityTenantDetail, listEntityTenants } from "@sigmon/db/repositories/entities-query.js";
import { getUserDetail, listUsersActivity } from "@sigmon/db/repositories/users-query.js";
import { createTelemetryQueue, enqueueTelemetryJob } from "@sigmon/queues";
import { hashPassword, verifyPassword } from "@sigmon/telemetry/auth";
import { verifyApiKey } from "@sigmon/telemetry/api-keys";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import { sql } from "kysely";
import { z } from "zod";
import { buildApp } from "./app.js";
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
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
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
  const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
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
      revoke: (id) => revokeApiKey(db, id)
    }
  },
  ingestion: {
    verifyApiKey: async (secret) => {
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
    },
    enqueue: async (job) => {
      await enqueueTelemetryJob(telemetryQueue, job);
    }
  },
  query: {
    listEvents: (filters) => listEvents(db, filters),
    listErrors: (filters) => listErrors(db, filters),
    listErrorGroups: (filters) => listErrorGroups(db, filters),
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
      })
  },
  system: {
    getHealth: () =>
      createSystemHealthSnapshot({
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
        getHeartbeats: async () => {
          const [worker, scheduler] = await Promise.all([getHeartbeat(db, "worker"), getHeartbeat(db, "scheduler")]);
          return { worker, scheduler };
        },
        getIngestionFreshness: () => getIngestionFreshness(db),
        getLastRetentionRun: () => getLastRetentionRun(db),
        getBackupStatus: () => getBackupStatus(db)
      })
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
    getAlertEvent: (id) => getAlertEvent(db, id)
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
  sourceMaps: {
    list: (filters) => listSourceMapArtifacts(db, filters),
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
    revoke: (input) => revokeSourceMapUploadToken(db, input)
  },
  apiKeyPepper: config.apiKeyPepper,
  googleOAuthEnabled: config.googleOAuth.enabled,
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
