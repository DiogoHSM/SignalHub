import { createStructuredLogger, loadConfig } from "@sigmon/config";
import { createDb } from "@sigmon/db";
import { migrate } from "@sigmon/db/migrate.js";
import type { ApiKeyScope } from "./routes/api-key-auth.js";
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
  isScopeActive,
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
  archiveAnalyticsSegment,
  createAnalyticsSegment,
  getAnalyticsSegment,
  listAnalyticsSegments,
  previewAnalyticsSegment,
  updateAnalyticsSegment
} from "@sigmon/db/repositories/analytics-segments.js";
import {
  archiveAnalyticsDashboard,
  createAnalyticsDashboard,
  getAnalyticsDashboard,
  listAnalyticsDashboards,
  updateAnalyticsDashboard
} from "@sigmon/db/repositories/analytics-dashboards.js";
import * as analyticsInsightsRepository from "@sigmon/db/repositories/analytics-insights.js";
import {
  archiveAnalyticsInsight,
  archiveEventProperty,
  createAnalyticsInsight,
  getAnalyticsInsight,
  promoteEventProperty,
  queryEventTrend,
  updateAnalyticsInsight
} from "@sigmon/db/repositories/analytics-insights.js";
import {
  archiveExperiment,
  createExperiment,
  getExperimentResults,
  listExperiments,
  updateExperiment
} from "@sigmon/db/repositories/experiments.js";
import {
  archiveFeatureFlag,
  createFeatureFlag,
  evaluateFeatureFlagById,
  listFeatureFlagAudit,
  listFeatureFlags,
  updateFeatureFlag
} from "@sigmon/db/repositories/feature-flags.js";
import {
  addBetaProgramParticipant,
  archiveBetaProgram,
  createBetaProgram,
  getBetaProgramAdoption,
  listBetaProgramParticipants,
  listBetaPrograms,
  removeBetaProgramParticipant,
  updateBetaProgram
} from "@sigmon/db/repositories/beta-programs.js";
import {
  applyDataGovernanceRules,
  getDataGovernancePolicy,
  upsertDataGovernancePolicy
} from "@sigmon/db/repositories/data-governance.js";
import {
  archiveWarehouseDestination,
  createWarehouseDestination,
  getWarehouseDestination,
  listWarehouseDestinations,
  listWarehouseExportRuns,
  recordWarehouseExportRun,
  selectWarehouseExportBatch,
  updateWarehouseDestination,
  updateWarehouseDestinationCursor,
  withWarehouseExportLock
} from "@sigmon/db/repositories/warehouse-exports.js";
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
  updateAlertEventTriage,
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
  archiveUserAsAdmin,
  createUser,
  findUserByEmail,
  findUserByGoogleSubject,
  linkGoogleSubject,
  listUsers,
  updateUserAsAdmin
} from "@sigmon/db/repositories/users.js";
import {
  createAuthSession,
  findActiveSessionUser,
  revokeAuthSession
} from "@sigmon/db/repositories/auth-sessions.js";
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
  createReadTokenRecord,
  findReadTokenByPrefix,
  listReadTokens,
  revokeReadToken,
  updateReadToken,
  updateReadTokenLastUsed
} from "@sigmon/db/repositories/read-tokens.js";
import {
  getApmEndpoints,
  getRuntimeProfiles,
  getServiceMap,
  getWebVitals,
  getErrorAggregates,
  getErrorForSourceMapResolution,
  getEventAggregates,
  getEventClickMap,
  getEventFunnel,
  getEventPaths,
  getEventPropertyCatalog,
  getEventRetention,
  getLlmAggregates,
  getLlmSummary,
  getLlmByTenant,
  getLlmByPrompt,
  getLlmCostByModel,
  getOverview,
  getRecentActivity,
  getSessionReplayDetail,
  getTraceAggregates,
  listReleases,
  listSessionReplays,
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
  buildIncidentIssueDraft,
  createCodeIntegration,
  linkIncidentExternalIssue,
  listCodeIntegrations,
  listIncidentExternalIssues,
  revokeCodeIntegration,
  upsertReleaseMetadata
} from "@sigmon/db/repositories/code-integrations.js";
import {
  archiveSurvey,
  createSurvey,
  getNpsResults,
  getSurveyResults,
  listSurveys,
  updateSurvey
} from "@sigmon/db/repositories/surveys.js";
import {
  archiveMessageCampaign,
  createMessageCampaign,
  getMessageCampaignResults,
  listMessageCampaigns,
  updateMessageCampaign
} from "@sigmon/db/repositories/message-campaigns.js";
import {
  getFeedbackWidgetSettings,
  listFeedbackItems,
  updateFeedbackItemStatus,
  upsertFeedbackWidgetSettings
} from "@sigmon/db/repositories/feedback-widget.js";
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
import { runWarehouseExportOnce, writePostgresWarehouseBatch } from "../../worker/src/warehouse-exports.js";
import { runRetentionOnce } from "../../worker/src/retention.js";
import { deleteExpiredSourceMapArtifacts } from "../../worker/src/source-map-retention.js";
import {
  authenticateOpaqueSession,
  createOpaqueSession,
  revokeCurrentSession,
  type OpaqueSessionServiceDependencies
} from "./auth/session-service.js";

const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;

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

// PER-449: migrations run on a short-lived, timeout-free pool. A one-time schema change (e.g. a
// CREATE INDEX on a large `events` table) can legitimately take longer than the statement_timeout
// applied below to the request-serving pool - sharing one pool between the two would risk killing
// a legitimate migration mid-run.
const migrationDb = createDb(config.databaseUrl);
await migrate(migrationDb);
await migrationDb.destroy();

const db = createDb(config.databaseUrl, { statementTimeoutMs: config.db.statementTimeoutMs });

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
  profilesDays: config.retention.profilesDays,
  breadcrumbsDays: config.retention.breadcrumbsDays,
  deadLetterJobsDays: config.retention.deadLetterJobsDays,
  sourceMapsEnabled: config.sourceMaps.retention.enabled,
  sourceMapsDays: config.sourceMaps.retention.days,
  sourceMapsBatchSize: config.sourceMaps.retention.batchSize
};

const opaqueSessions: OpaqueSessionServiceDependencies = {
  cookieName: sessionCookieName,
  cookieOptions: getSessionCookieOptions(config.nodeEnv, sessionMaxAgeSeconds),
  maxAgeSeconds: sessionMaxAgeSeconds,
  createSession: (input) => createAuthSession(db, input),
  findSessionUser: (input) => findActiveSessionUser(db, input),
  revokeSession: (input) => revokeAuthSession(db, input)
};

function setSessionCookie(reply: CookieCapableReply, userId: string): Promise<void> {
  return createOpaqueSession(opaqueSessions, userId, reply);
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
    await setSessionCookie(reply, existingBySubject.id);
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

  await setSessionCookie(reply, linkedUser.id);
  return toAuthUser(linkedUser);
}

async function verifyIngestionApiKey(secret: string): Promise<ApiKeyScope | null> {
  const apiKey = await findApiKeyByPrefix(db, secret.slice(0, 12));
  if (!apiKey) {
    return null;
  }

  const valid = await verifyApiKey(apiKey.hash, secret, config.apiKeyPepper);
  return valid
    ? {
        projectId: apiKey.projectId,
        environmentId: apiKey.environmentId,
        capability: apiKey.capability
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

    await setSessionCookie(reply, user.id);

    return toAuthUser(user);
  },
  findSessionUser: async (request) => {
    const user = await authenticateOpaqueSession(opaqueSessions, request);
    return user ? toAuthUser(user) : null;
  },
  logout: (context) => revokeCurrentSession(opaqueSessions, context),
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
    updateUser: async (id, input, context) => {
      const user = await updateUserAsAdmin(db, context.actorUserId, id, {
        email: input.email,
        passwordHash: input.password ? await hashPassword(input.password) : undefined,
        isAdmin: input.isAdmin
      });
      return user ? toAuthUser(user) : null;
    },
    archiveUser: (id, context) => archiveUserAsAdmin(db, context.actorUserId, id)
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
    },
    codeIntegrations: {
      list: (projectId) => listCodeIntegrations(db, projectId),
      create: (input) => createCodeIntegration(db, input),
      revoke: (input) => revokeCodeIntegration(db, input),
      upsertReleaseMetadata: (input) => upsertReleaseMetadata(db, input)
    },
    analyticsSegments: {
      list: (filters) => listAnalyticsSegments(db, filters),
      create: (input) => createAnalyticsSegment(db, input),
      update: (id, input) => updateAnalyticsSegment(db, id, input),
      archive: (id) => archiveAnalyticsSegment(db, id),
      get: (input) => getAnalyticsSegment(db, input),
      preview: (segment, input) => previewAnalyticsSegment(db, segment, input)
    },
    analyticsDashboards: {
      list: (filters) => listAnalyticsDashboards(db, filters),
      create: (input) => createAnalyticsDashboard(db, input),
      update: (input) => updateAnalyticsDashboard(db, input),
      archive: (input) => archiveAnalyticsDashboard(db, input)
    },
    analyticsInsights: {
      list: (scope) => {
        const repository = analyticsInsightsRepository as unknown as {
          listAnalyticsInsights?: (database: typeof db, input: typeof scope) => Promise<unknown[]>;
          listAnalyticsInsight?: (database: typeof db, input: typeof scope) => Promise<unknown[]>;
        };
        const list = repository.listAnalyticsInsights ?? repository.listAnalyticsInsight;
        if (!list) throw new Error("analytics_insights_repository_unavailable");
        return list(db, scope) as ReturnType<NonNullable<typeof list>> as never;
      },
      create: (input) => createAnalyticsInsight(db, input as never) as never,
      update: (input) => updateAnalyticsInsight(db, input as never) as never,
      archive: (input) => archiveAnalyticsInsight(db, input),
      listProperties: (scope) => {
        const repository = analyticsInsightsRepository as unknown as {
          listEventProperties?: (database: typeof db, input: typeof scope) => Promise<unknown[]>;
          listEventProperty?: (database: typeof db, input: typeof scope) => Promise<unknown[]>;
        };
        const list = repository.listEventProperties ?? repository.listEventProperty;
        if (!list) throw new Error("analytics_insights_repository_unavailable");
        return list(db, scope) as ReturnType<NonNullable<typeof list>> as never;
      },
      promoteProperty: (input) =>
        promoteEventProperty(db, { ...input, propertyName: input.property } as never) as never,
      archiveProperty: (input) => archiveEventProperty(db, input)
    },
    experiments: {
      list: (filters) => listExperiments(db, filters),
      create: (input) => createExperiment(db, input),
      update: (input) => updateExperiment(db, input),
      archive: (input) => archiveExperiment(db, input)
    },
    surveys: {
      list: (filters) => listSurveys(db, filters),
      create: (input) => createSurvey(db, input),
      update: (input) => updateSurvey(db, input),
      archive: (input) => archiveSurvey(db, input)
    },
    messageCampaigns: {
      list: (filters) => listMessageCampaigns(db, filters),
      create: (input) => createMessageCampaign(db, input),
      update: (input) => updateMessageCampaign(db, input),
      archive: (input) => archiveMessageCampaign(db, input)
    },
    feedbackWidget: {
      getSettings: (input) => getFeedbackWidgetSettings(db, input),
      upsertSettings: (input) => upsertFeedbackWidgetSettings(db, input)
    },
    featureFlags: {
      list: (filters) => listFeatureFlags(db, filters),
      create: (input) => createFeatureFlag(db, input),
      update: (input) => updateFeatureFlag(db, input),
      archive: (input) => archiveFeatureFlag(db, input),
      listAudit: (input) => listFeatureFlagAudit(db, input),
      evaluate: (input) => evaluateFeatureFlagById(db, input)
    },
    betaPrograms: {
      list: (filters) => listBetaPrograms(db, filters),
      create: (input) => createBetaProgram(db, input),
      update: (input) => updateBetaProgram(db, input),
      archive: (input) => archiveBetaProgram(db, input),
      listParticipants: (input) => listBetaProgramParticipants(db, input),
      addParticipant: (input) => addBetaProgramParticipant(db, input),
      removeParticipant: (input) => removeBetaProgramParticipant(db, input),
      getAdoption: (input) => getBetaProgramAdoption(db, input)
    },
    dataGovernance: {
      get: (input) => getDataGovernancePolicy(db, input),
      upsert: (input) => upsertDataGovernancePolicy(db, input)
    },
    warehouseExports: {
      listDestinations: (input) => listWarehouseDestinations(db, { ...input, includeDisabled: true }),
      createDestination: (input) => createWarehouseDestination(db, input),
      updateDestination: (input) => updateWarehouseDestination(db, input),
      archiveDestination: (input) => archiveWarehouseDestination(db, input),
      listRuns: (input) => listWarehouseExportRuns(db, input),
      runDestination: async (input) => {
        const destination = await getWarehouseDestination(db, {
          id: input.destinationId,
          projectId: input.projectId,
          environmentId: input.environmentId,
          includeSecret: true
        });
        if (!destination) {
          return { ran: true, skipped: false, exported: 0, failed: 1 };
        }
        return runWarehouseExportOnce(
          {
            now: () => new Date(),
            withLock: (run) => withWarehouseExportLock(db, run),
            listActiveDestinations: async () => [destination],
            selectBatch: (selectedDestination, batchInput) => selectWarehouseExportBatch(db, selectedDestination, batchInput),
            writeBatch: (writeInput) => writePostgresWarehouseBatch(writeInput),
            updateCursor: (cursorInput) => updateWarehouseDestinationCursor(db, cursorInput),
            recordRun: (runInput) => recordWarehouseExportRun(db, runInput)
          },
          input.trigger
        );
      }
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
    identifyUser: async (input) => {
      const policy = await getDataGovernancePolicy(db, input);
      await identifyUserProfile(db, {
        ...input,
        traits: applyDataGovernanceRules(input.traits, policy, "identity.traits")
      });
    },
    identifyTenant: async (input) => {
      const policy = await getDataGovernancePolicy(db, input);
      await identifyTenantProfile(db, {
        ...input,
        traits: applyDataGovernanceRules(input.traits, policy, "identity.traits")
      });
    }
  },
  query: {
    isScopeActive: (projectId, environmentId) => isScopeActive(db, projectId, environmentId),
    listEvents: (filters) => listEvents(db, filters),
    listErrors: (filters) => listErrors(db, filters),
    listErrorGroups: (filters) => listErrorGroupsPage(db, filters),
    getErrorGroup: (id, filters) => getErrorGroup(db, { id, ...filters }),
    getErrorGroupIncident: (id, filters) => getErrorGroupIncident(db, { groupId: id, ...filters }),
    listIncidentExternalIssues: (input) => listIncidentExternalIssues(db, input),
    linkIncidentExternalIssue: (input) => linkIncidentExternalIssue(db, input),
    buildIncidentIssueDraft: (input) => buildIncidentIssueDraft(db, input),
    updateErrorGroupTriage: (id, input) => updateErrorGroupTriage(db, { id, ...input }),
    updateErrorGroupStatus: (id, input) => updateErrorGroupStatus(db, { id, ...input }),
    listLlmCalls: (filters) => listLlmCalls(db, filters),
    listTraces: (filters) => listTraces(db, filters),
    listTraceSpans: (_traceId, filters) => listTraceSpans(db, filters),
    getEventAggregates: (filters) => getEventAggregates(db, filters),
    getAnalyticsInsight: (input) => getAnalyticsInsight(db, input) as never,
    queryEventTrend: (input) => queryEventTrend(db, input as never),
    getErrorAggregates: (filters) => getErrorAggregates(db, filters),
    getLlmAggregates: (filters) => getLlmAggregates(db, filters),
    getLlmSummary: (filters) => getLlmSummary(db, filters),
    getLlmByTenant: (filters) => getLlmByTenant(db, filters),
    getLlmByPrompt: (filters) => getLlmByPrompt(db, filters),
    getLlmCostByModel: (filters) => getLlmCostByModel(db, filters),
    getOverview: (filters) => getOverview(db, filters),
    getRecentActivity: (filters) => getRecentActivity(db, filters),
    listReleases: (filters) => listReleases(db, filters),
    getOperations: (filters) => getOperations(db, filters),
    getEventPropertyCatalog: (filters) => getEventPropertyCatalog(db, filters),
    getEventClickMap: (filters) => getEventClickMap(db, filters),
    getEventFunnel: (filters) => getEventFunnel(db, filters, { maxActors: config.funnel.maxActors }),
    getExperimentResults: (filters) => getExperimentResults(db, filters),
    getSurveyResults: (filters) => getSurveyResults(db, filters),
    getMessageCampaignResults: (filters) => getMessageCampaignResults(db, filters),
    getNpsResults: (filters) => getNpsResults(db, filters),
    listFeedbackItems: (filters) => listFeedbackItems(db, filters),
    updateFeedbackStatus: (input) => updateFeedbackItemStatus(db, input),
    getEventPaths: (filters) => getEventPaths(db, filters),
    getEventRetention: (filters) =>
      getEventRetention(db, { ...filters, retentionEventsDays: config.retention.eventsDays }),
    getApmEndpoints: (filters) => getApmEndpoints(db, filters),
    getServiceMap: (filters) => getServiceMap(db, filters),
    getWebVitals: (filters) => getWebVitals(db, filters),
    getRuntimeProfiles: (filters) => getRuntimeProfiles(db, filters),
    getAnalyticsDashboard: (input) => getAnalyticsDashboard(db, input),
    getTraceAggregates: (filters) => getTraceAggregates(db, filters),
    listEntityTenants: (filters) => listEntityTenants(db, filters),
    getEntityTenantDetail: (tenantId, filters) => getEntityTenantDetail(db, tenantId, filters),
    listUsersActivity: (filters) => listUsersActivity(db, filters),
    getUserDetail: (userId, filters) => getUserDetail(db, userId, filters),
    getSessionTimeline: (filters) => getSessionTimeline(db, filters),
    getSessionReplayDetail: (filters) => getSessionReplayDetail(db, filters),
    listSessionReplays: (filters) => listSessionReplays(db, filters),
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
    updateAlertEventTriage: (id, input) => updateAlertEventTriage(db, id, input),
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
  readTokens: {
    list: (scope) => listReadTokens(db, scope),
    create: (input) => createReadTokenRecord(db, input),
    update: (input) => updateReadToken(db, input),
    revoke: (input) => revokeReadToken(db, input)
  },
  verifyReadToken: async (secret) => {
    const token = await findReadTokenByPrefix(db, secret.slice(0, 16));
    if (!token) {
      return null;
    }

    const valid = await verifyApiKey(token.hash, secret, config.apiKeyPepper);
    if (!valid) {
      return null;
    }

    await updateReadTokenLastUsed(db, token.id);
    return {
      id: token.id,
      projectId: token.projectId,
      environmentId: token.environmentId
    };
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
  },
  landing: {
    landingHosts: config.landing.hosts
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
