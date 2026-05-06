import { loadConfig } from "@signal-hub/config";
import { createDb } from "@signal-hub/db";
import { migrate } from "@signal-hub/db/migrate.js";
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
} from "@signal-hub/db/repositories/admin.js";
import {
  archiveUser,
  createUser,
  findUserByEmail,
  findUserByGoogleSubject,
  findUserById,
  linkGoogleSubject,
  listUsers,
  updateUser
} from "@signal-hub/db/repositories/users.js";
import {
  getHeartbeat,
  getIngestionFreshness,
  getLastRetentionRun
} from "@signal-hub/db/repositories/system.js";
import {
  getErrorAggregates,
  getEventAggregates,
  getLlmAggregates,
  getOverview,
  getTraceAggregates,
  listErrors,
  listEvents,
  listLlmCalls,
  listTraceSpans,
  listTraces
} from "@signal-hub/db/repositories/telemetry-query.js";
import { getEntityTenantDetail, listEntityTenants } from "@signal-hub/db/repositories/entities-query.js";
import { getUserDetail, listUsersActivity } from "@signal-hub/db/repositories/users-query.js";
import { createTelemetryQueue, enqueueTelemetryJob } from "@signal-hub/queues";
import { hashPassword, verifyPassword } from "@signal-hub/telemetry/auth";
import { verifyApiKey } from "@signal-hub/telemetry/api-keys";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import { sql } from "kysely";
import { z } from "zod";
import { buildApp } from "./app.js";
import type { AuthDependencies, AuthSessionContext, AuthUser, CookieCapableReply } from "./routes/auth.js";
import { createSystemHealthSnapshot } from "./system-health.js";

const sessionCookieName = "signalhub_session";
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

const config = loadConfig();
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
  llmCallsDays: config.retention.llmCallsDays
};

function setSessionCookie(reply: CookieCapableReply, userId: string): void {
  const sessionToken = createSessionToken(
    {
      userId,
      exp: Math.floor(Date.now() / 1000) + sessionMaxAgeSeconds
    },
    config.sessionSecret
  );
  reply.setCookie(sessionCookieName, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds
  });
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
    listLlmCalls: (filters) => listLlmCalls(db, filters),
    listTraces: (filters) => listTraces(db, filters),
    listTraceSpans: (_traceId, filters) => listTraceSpans(db, filters),
    getEventAggregates: (filters) => getEventAggregates(db, filters),
    getErrorAggregates: (filters) => getErrorAggregates(db, filters),
    getLlmAggregates: (filters) => getLlmAggregates(db, filters),
    getOverview: (filters) => getOverview(db, filters),
    getTraceAggregates: (filters) => getTraceAggregates(db, filters),
    listEntityTenants: (filters) => listEntityTenants(db, filters),
    getEntityTenantDetail: (tenantId, filters) => getEntityTenantDetail(db, tenantId, filters),
    listUsersActivity: (filters) => listUsersActivity(db, filters),
    getUserDetail: (userId, filters) => getUserDetail(db, userId, filters)
  },
  system: {
    getHealth: () =>
      createSystemHealthSnapshot({
        retention: {
          enabled: config.retention.enabled,
          intervalMinutes: config.retention.intervalMinutes,
          policy: retentionPolicy
        },
        postgresPing: () => sql`select 1`.execute(db),
        redisPing: () => redis.ping(),
        getQueueCounts: () => telemetryQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        getHeartbeat: () => getHeartbeat(db, "worker"),
        getIngestionFreshness: () => getIngestionFreshness(db),
        getLastRetentionRun: () => getLastRetentionRun(db)
      })
  },
  apiKeyPepper: config.apiKeyPepper,
  googleOAuthEnabled: config.googleOAuth.enabled,
  console: {
    enabled: config.console.enabled,
    apiBasePath: "/",
    apiEndpoint: config.console.publicEndpoint,
    assetsDir:
      config.console.enabled ? fileURLToPath(new URL("../../console/dist/", import.meta.url)) : undefined
  }
});

await app.listen({ port: config.port, host: "0.0.0.0" });

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.info(`Received ${signal}, shutting down API`);

  const results = await Promise.allSettled([app.close(), telemetryQueue.close(), redis.quit(), db.destroy()]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("API shutdown step failed", result.reason);
    }
  }
}

process.once("SIGINT", (signal) => {
  void shutdown(signal).finally(() => process.exit(0));
});

process.once("SIGTERM", (signal) => {
  void shutdown(signal).finally(() => process.exit(0));
});
