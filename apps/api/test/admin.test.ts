import type { FastifyInstance } from "fastify";
import { access, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSegmentPreview, AnalyticsSegmentRecord } from "../../../packages/db/src/repositories/analytics-segments.js";
import type { AnalyticsDashboardRecord } from "../../../packages/db/src/repositories/analytics-dashboards.js";
import { EventPropertyNotPromotedError } from "../../../packages/db/src/repositories/analytics-insights.js";
import type { ExperimentRecord } from "../../../packages/db/src/repositories/experiments.js";
import type {
  FeatureFlagAuditRecord,
  FeatureFlagEvaluation,
  FeatureFlagRecord
} from "../../../packages/db/src/repositories/feature-flags.js";
import type {
  BetaProgramAdoption,
  BetaProgramParticipantRecord,
  BetaProgramRecord
} from "../../../packages/db/src/repositories/beta-programs.js";
import type { SurveyRecord } from "../../../packages/db/src/repositories/surveys.js";
import type { MessageCampaignRecord } from "../../../packages/db/src/repositories/message-campaigns.js";
import type { DataGovernancePolicy } from "../../../packages/db/src/repositories/data-governance.js";
import type {
  WarehouseDestinationRecord,
  WarehouseExportRunRecord
} from "../../../packages/db/src/repositories/warehouse-exports.js";
import type {
  CodeIntegrationRecord,
  ReleaseMetadataRecord
} from "../../../packages/db/src/repositories/code-integrations.js";
import type { FeedbackWidgetSettings } from "../../../packages/db/src/repositories/feedback-widget.js";
import { AdminUserInvariantError } from "../../../packages/db/src/repositories/users.js";
import { buildApp } from "../src/app.js";
import {
  authenticateOpaqueSession,
  createOpaqueSession,
  revokeCurrentSession,
  type OpaqueSessionServiceDependencies
} from "../src/auth/session-service.js";
import { getSessionCookieOptions, type AuthDependencies } from "../src/routes/auth.js";
import type { UserAdministrationDependencies } from "../src/routes/admin.js";

let app: FastifyInstance | undefined;

const adminAuth = {
  login: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true }),
  findSessionUser: async () => ({ id: "usr_1", email: "admin@example.com", isAdmin: true })
};

const userAuth = {
  login: async () => ({ id: "usr_2", email: "user@example.com", isAdmin: false }),
  findSessionUser: async () => ({ id: "usr_2", email: "user@example.com", isAdmin: false })
};

const readiness = async () => ({ postgres: true, redis: true });

type LifecycleUser = { id: string; email: string; isAdmin: boolean };

function readSessionCookie(response: { headers: { "set-cookie"?: string | string[] | number } }): string {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : typeof header === "string" ? [header] : [];
  const session = values.find((value) => value?.startsWith("sigmon_session="));
  if (!session) throw new Error("session cookie not set");
  return session.split(";", 1)[0]!;
}

function createLifecycleHarness() {
  let tokenNumber = 0;
  const now = new Date("2026-09-01T12:00:00.000Z");
  const users = new Map<string, LifecycleUser>([
    ["admin@example.com", { id: "usr_1", email: "admin@example.com", isAdmin: true }],
    ["admin-2@example.com", { id: "usr_2", email: "admin-2@example.com", isAdmin: true }]
  ]);
  const sessions = new Map<string, { userId: string; revoked: boolean }>();
  const service: OpaqueSessionServiceDependencies = {
    cookieName: "sigmon_session",
    cookieOptions: getSessionCookieOptions("test", 3600),
    maxAgeSeconds: 3600,
    now: () => now,
    generateToken: () => Buffer.alloc(32, ++tokenNumber).toString("base64url"),
    createSession: async ({ userId, tokenHash }) => {
      sessions.set(tokenHash, { userId, revoked: false });
    },
    findSessionUser: async ({ tokenHash }) => {
      const session = sessions.get(tokenHash);
      if (!session || session.revoked) return undefined;
      return [...users.values()].find((user) => user.id === session.userId);
    },
    revokeSession: async ({ tokenHash }) => {
      const session = sessions.get(tokenHash);
      if (session) session.revoked = true;
    }
  };
  const revokeUserSessions = (userId: string) => {
    for (const session of sessions.values()) {
      if (session.userId === userId) session.revoked = true;
    }
  };

  const auth: AuthDependencies = {
    login: async (email: string, password: string, { reply }) => {
      const user = password === "password" ? users.get(email) : undefined;
      if (!user) return null;
      await createOpaqueSession(service, user.id, reply);
      return user;
    },
    findSessionUser: (request) => authenticateOpaqueSession(service, request),
    logout: (context) => revokeCurrentSession(service, context)
  };
  const userDependencies: UserAdministrationDependencies = {
    updateUser: async (id: string, input: { password?: string }) => {
      const user = [...users.values()].find((candidate) => candidate.id === id);
      if (!user) return null;
      if (input.password !== undefined) revokeUserSessions(id);
      return user;
    },
    archiveUser: async (id: string) => {
      revokeUserSessions(id);
    }
  };

  return {
    auth,
    users: userDependencies
  };
}

function sourceMapArtifact(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "smap_1",
    projectId: "prj_1",
    environmentId: "env_1",
    release: "2026.05.10",
    minifiedFile: "app.min.js",
    originalFilename: "app.min.js.map",
    contentType: "application/json",
    byteSize: 72,
    sha256: "abc123",
    storagePath: "/tmp/source-maps/smap_1.map",
    uploadedByUserId: "usr_1",
    uploadedByTokenId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides
  };
}

function analyticsSegment(overrides: Partial<AnalyticsSegmentRecord> = {}): AnalyticsSegmentRecord {
  return {
    id: "seg_1",
    projectId: "prj_1",
    environmentId: "env_1",
    name: "Team creators",
    description: null,
    actorType: "user",
    definition: { window: "30d", eventName: "project.created", propertyName: "plan", propertyValue: "team" },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides
  };
}

function analyticsSegmentResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...analyticsSegment(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides
  };
}

function analyticsSegmentPreview(overrides: Partial<AnalyticsSegmentPreview> = {}): AnalyticsSegmentPreview {
  return {
    segmentId: "seg_1",
    actorType: "user",
    window: "30d",
    actors: 1,
    samples: [{ actorId: "user_1", lastSeenAt: "2026-01-01T00:00:00.000Z" }],
    ...overrides
  };
}

function analyticsDashboard(overrides: Partial<AnalyticsDashboardRecord> = {}): AnalyticsDashboardRecord {
  return {
    id: "dash_1",
    projectId: "prj_1",
    environmentId: "env_1",
    name: "Operations report",
    description: null,
    category: "operational",
    filters: { window: "7d" },
    widgets: [
      { id: "wid_1", type: "metric.events", title: "Events", width: "half", options: {} },
      { id: "wid_2", type: "metric.errors", title: "Errors", width: "half", options: {} },
      { id: "wid_3", type: "top.events", title: "Top events", width: "full", options: {} }
    ],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides
  };
}

function analyticsDashboardResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...analyticsDashboard(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides
  };
}

function experiment(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    id: "exp_1",
    projectId: "prj_1",
    environmentId: "env_1",
    key: "checkout_copy",
    name: "Checkout copy",
    description: null,
    status: "running",
    actorType: "user",
    exposureEvent: "sigmon.experiment.exposed",
    conversionEvent: "checkout.completed",
    variants: [
      { key: "control", name: "Control", weight: 50 },
      { key: "treatment", name: "Treatment", weight: 50 }
    ],
    primaryMetric: { eventName: "checkout.completed", windowHours: 24 },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides
  };
}

function experimentResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...experiment(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides
  };
}

function survey(overrides: Partial<SurveyRecord> = {}): SurveyRecord {
  return {
    id: "surv_1",
    projectId: "prj_1",
    environmentId: "env_1",
    key: "activation_pulse",
    name: "Activation pulse",
    description: null,
    status: "active",
    actorType: "user",
    triggerEvent: "checkout.completed",
    questions: [
      {
        id: "satisfaction",
        type: "rating",
        label: "How satisfied are you?",
        required: true,
        scale: { min: 1, max: 5, minLabel: "Hard", maxLabel: "Great" }
      }
    ],
    targeting: { tenantId: "tenant_1" },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides
  };
}

function surveyResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...survey(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides
  };
}

function messageCampaign(overrides: Partial<MessageCampaignRecord> = {}): MessageCampaignRecord {
  return {
    id: "cmp_1",
    projectId: "prj_1",
    environmentId: "env_1",
    key: "invoice_activation",
    name: "Invoice activation",
    description: null,
    status: "active",
    channelType: "email",
    notificationChannelId: "chn_1",
    segmentId: "seg_1",
    conversionEvent: "invoice.paid",
    subject: "Create your first invoice",
    body: "Invite tenants to finish onboarding.",
    ctaUrl: "https://app.example.com/invoices",
    consentCategory: "product",
    privacyNote: "Only opted-in contacts.",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides
  };
}

function messageCampaignResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...messageCampaign(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides
  };
}

function feedbackWidgetSettings(overrides: Partial<FeedbackWidgetSettings> = {}): FeedbackWidgetSettings {
  return {
    projectId: "prj_1",
    environmentId: "env_1",
    enabled: true,
    title: "Send feedback",
    prompt: "Tell us what happened.",
    placeholder: "Write your feedback...",
    buttonLabel: "Feedback",
    accentColor: "#66e38a",
    allowScreenshot: false,
    privacyNote: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

function feedbackWidgetSettingsResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...feedbackWidgetSettings(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function featureFlag(overrides: Partial<FeatureFlagRecord> = {}): FeatureFlagRecord {
  return {
    id: "flg_1",
    projectId: "prj_1",
    environmentId: "env_1",
    key: "new_checkout",
    name: "New checkout",
    description: null,
    status: "active",
    defaultVariant: "off",
    variants: [
      { key: "off", value: false },
      { key: "on", value: true }
    ],
    rules: [{ id: "internal", description: "Internal user", variant: "on", match: { userId: "user_1" } }],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides
  };
}

function featureFlagResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...featureFlag(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides
  };
}

function featureFlagAudit(overrides: Partial<FeatureFlagAuditRecord> = {}): FeatureFlagAuditRecord {
  return {
    id: "ffaud_1",
    featureFlagId: "flg_1",
    projectId: "prj_1",
    environmentId: "env_1",
    action: "created",
    actorId: "usr_1",
    changes: { key: "new_checkout" },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

function featureFlagAuditResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...featureFlagAudit(),
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function warehouseDestination(overrides: Partial<WarehouseDestinationRecord> = {}): WarehouseDestinationRecord {
  return {
    id: "whdst_1",
    projectId: "prj_1",
    environmentId: "env_1",
    name: "Warehouse",
    destinationType: "postgres",
    connectionUrlPreview: "postgres://writer:***@warehouse.internal:5432/analytics",
    datasets: ["events", "errors"],
    cursor: {},
    batchSize: 500,
    enabled: true,
    lastRunAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorMessage: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides
  };
}

function warehouseDestinationResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...warehouseDestination(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides
  };
}

function warehouseExportRun(overrides: Partial<WarehouseExportRunRecord> = {}): WarehouseExportRunRecord {
  return {
    id: "whrun_1",
    destinationId: "whdst_1",
    projectId: "prj_1",
    environmentId: "env_1",
    trigger: "manual",
    status: "success",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    finishedAt: new Date("2026-01-01T00:00:01.000Z"),
    cursorBefore: {},
    cursorAfter: { events: { timestamp: "2026-01-01T00:00:00.000Z", id: "evt_1" } },
    exported: { events: 1 },
    errorMessage: null,
    createdAt: new Date("2026-01-01T00:00:01.000Z"),
    ...overrides
  };
}

function warehouseExportRunResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...warehouseExportRun(),
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    createdAt: "2026-01-01T00:00:01.000Z",
    ...overrides
  };
}

function codeIntegration(overrides: Partial<CodeIntegrationRecord> = {}): CodeIntegrationRecord {
  return {
    id: "cint_1",
    projectId: "prj_1",
    provider: "github",
    name: "Web",
    owner: "acme",
    repo: "web",
    webBaseUrl: "https://github.com/acme/web",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    revokedAt: null,
    ...overrides
  };
}

function codeIntegrationResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...codeIntegration(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function releaseMetadata(overrides: Partial<ReleaseMetadataRecord> = {}): ReleaseMetadataRecord {
  return {
    id: "relm_1",
    projectId: "prj_1",
    environmentId: "env_1",
    release: "web@1.2.3",
    integrationId: "cint_1",
    commitSha: "abcdef123456",
    commitUrl: "https://github.com/acme/web/commit/abcdef123456",
    pullRequestNumber: 42,
    pullRequestUrl: "https://github.com/acme/web/pull/42",
    deployedBy: "github-actions",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

function releaseMetadataResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...releaseMetadata(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function betaProgram(overrides: Partial<BetaProgramRecord> = {}): BetaProgramRecord {
  return {
    id: "beta_1",
    projectId: "prj_1",
    environmentId: "env_1",
    key: "checkout_beta",
    name: "Checkout beta",
    description: "Early access for checkout redesign.",
    status: "active",
    actorType: "user",
    featureFlagId: "flg_1",
    featureFlagVariant: "on",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides
  };
}

function betaProgramResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...betaProgram(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides
  };
}

function betaProgramParticipant(overrides: Partial<BetaProgramParticipantRecord> = {}): BetaProgramParticipantRecord {
  return {
    id: "betap_1",
    programId: "beta_1",
    projectId: "prj_1",
    environmentId: "env_1",
    actorType: "user",
    actorId: "user_1",
    status: "active",
    notes: "Requested early access.",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    removedAt: null,
    ...overrides
  };
}

function betaProgramParticipantResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...betaProgramParticipant(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    removedAt: null,
    ...overrides
  };
}

function betaProgramAdoption(overrides: Partial<BetaProgramAdoption> = {}): BetaProgramAdoption {
  return {
    programId: "beta_1",
    window: "30d",
    participants: 3,
    activeParticipants: 2,
    activeActorsWithEvents: 1,
    events: 4,
    adoptionRate: 50,
    samples: [{ actorId: "user_1", events: 4, lastSeenAt: "2026-01-01T00:00:00.000Z" }],
    ...overrides
  };
}

function dataGovernancePolicy(overrides: Partial<DataGovernancePolicy> = {}): DataGovernancePolicy {
  return {
    projectId: "prj_1",
    environmentId: "env_1",
    retentionPolicy: { events: 45, errors: 180 },
    propertyRules: [{ target: "event.properties", path: "email", action: "mask" }],
    updatedByUserId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

function dataGovernancePolicyResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...dataGovernancePolicy(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function createMultipartPayload(
  parts: Array<
    | { name: string; value: string }
    | { name: string; filename: string; contentType: string; content: string | Buffer }
  >
): { headers: Record<string, string>; payload: Buffer } {
  const boundary = `sigmon-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];

  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if ("filename" in part) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.contentType}\r\n\r\n`
        )
      );
      chunks.push(Buffer.isBuffer(part.content) ? part.content : Buffer.from(part.content));
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`));
    }
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(chunks)
  };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.doUnmock("@sigmon/db/repositories/source-maps.js");
  vi.resetModules();
});

describe("admin routes", () => {
  it("returns 401 for unauthenticated users on GET /admin/users", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: {
        login: async () => null,
        findSessionUser: async () => null
      },
      users: {
        listUsers: async () => []
      }
    });

    const response = await app.inject({ method: "GET", url: "/admin/users" });

    expect(response.statusCode).toBe(401);
  });

  it("returns 403 for regular users on GET /admin/users", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: {
        login: async () => ({ id: "usr_2", email: "user@example.com", isAdmin: false }),
        findSessionUser: async () => ({ id: "usr_2", email: "user@example.com", isAdmin: false })
      },
      users: {
        listUsers: async () => []
      }
    });

    const response = await app.inject({ method: "GET", url: "/admin/users" });

    expect(response.statusCode).toBe(403);
  });

  it("lists dead letter jobs for admins", async () => {
    const listDeadLetterJobs = vi.fn(async () => ({
      deadLetterJobs: [
        {
          id: "dlj_1",
          projectId: null,
          environmentId: null,
          queueName: "telemetry",
          jobName: "event",
          payload: { eventId: "evt_1" },
          errorMessage: "insert failed",
          createdAt: new Date("2026-06-01T12:00:00.000Z")
        }
      ],
      cursor: "cursor_next"
    }));
    app = await buildApp({
      readiness,
      auth: adminAuth,
      deadLetters: {
        listDeadLetterJobs
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/admin/dead-letter-jobs?limit=25&cursor=cursor_1&queue_name=telemetry&job_name=event" +
        "&error=insert&created_from=2026-06-01T00%3A00%3A00.000Z&created_to=2026-06-02T00%3A00%3A00.000Z&status=pending"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      deadLetterJobs: [
        {
          id: "dlj_1",
          projectId: null,
          environmentId: null,
          queueName: "telemetry",
          jobName: "event",
          payload: { eventId: "evt_1" },
          errorMessage: "insert failed",
          createdAt: "2026-06-01T12:00:00.000Z"
        }
      ],
      cursor: "cursor_next"
    });
    expect(listDeadLetterJobs).toHaveBeenCalledWith({
      limit: 25,
      cursor: "cursor_1",
      queueName: "telemetry",
      jobName: "event",
      error: "insert",
      createdFrom: new Date("2026-06-01T00:00:00.000Z"),
      createdTo: new Date("2026-06-02T00:00:00.000Z"),
      status: "pending"
    });
  });

  it("returns 400 for invalid dead letter filter ranges", async () => {
    const listDeadLetterJobs = vi.fn(async () => ({ deadLetterJobs: [] }));
    app = await buildApp({
      readiness,
      auth: adminAuth,
      deadLetters: {
        listDeadLetterJobs
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dead-letter-jobs?created_from=2026-06-02T00%3A00%3A00.000Z&created_to=2026-06-01T00%3A00%3A00.000Z"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_dead_letter_request" });
    expect(listDeadLetterJobs).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid dead letter cursors", async () => {
    const listDeadLetterJobs = vi.fn(async () => {
      throw new Error("invalid_cursor");
    });
    app = await buildApp({
      readiness,
      auth: adminAuth,
      deadLetters: {
        listDeadLetterJobs
      }
    });

    const response = await app.inject({ method: "GET", url: "/admin/dead-letter-jobs?cursor=bad" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_cursor" });
  });

  it("returns 400 for mismatched dead letter cursor scopes", async () => {
    const listDeadLetterJobs = vi.fn(async () => {
      throw new Error("invalid_cursor_scope");
    });
    app = await buildApp({
      readiness,
      auth: adminAuth,
      deadLetters: {
        listDeadLetterJobs
      }
    });

    const response = await app.inject({ method: "GET", url: "/admin/dead-letter-jobs?cursor=bad" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_cursor" });
  });

  it("gets and deletes dead letter jobs for admins", async () => {
    const getDeadLetterJob = vi.fn(async (id: string) =>
      id === "dlj_1"
        ? {
            id: "dlj_1",
            projectId: null,
            environmentId: null,
            queueName: "telemetry",
            jobName: "trace",
            payload: { traceId: "trc_1" },
            errorMessage: "insert failed",
            createdAt: new Date("2026-06-01T13:00:00.000Z")
          }
        : undefined
    );
    const listDeadLetterJobActions = vi.fn(async (id: string) =>
      id === "dlj_1"
        ? [
            {
              id: "dla_1",
              deadLetterJobId: "dlj_1",
              queueName: "telemetry",
              jobName: "trace",
              action: "deleted" as const,
              actorUserId: "usr_1",
              actorEmail: "admin@example.com",
              metadata: {},
              createdAt: new Date("2026-06-01T14:00:00.000Z")
            }
          ]
        : []
    );
    const deleteDeadLetterJob = vi.fn(async (id: string) => id === "dlj_1");
    app = await buildApp({
      readiness,
      auth: adminAuth,
      deadLetters: {
        getDeadLetterJob,
        listDeadLetterJobActions,
        deleteDeadLetterJob
      }
    });

    const getResponse = await app.inject({ method: "GET", url: "/admin/dead-letter-jobs/dlj_1" });
    const actionsResponse = await app.inject({ method: "GET", url: "/admin/dead-letter-jobs/dlj_1/actions" });
    const deleteResponse = await app.inject({ method: "DELETE", url: "/admin/dead-letter-jobs/dlj_1" });
    const missingResponse = await app.inject({ method: "GET", url: "/admin/dead-letter-jobs/dlj_missing" });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual({
      deadLetterJob: {
        id: "dlj_1",
        projectId: null,
        environmentId: null,
        queueName: "telemetry",
        jobName: "trace",
        payload: { traceId: "trc_1" },
        errorMessage: "insert failed",
        createdAt: "2026-06-01T13:00:00.000Z"
      }
    });
    expect(actionsResponse.statusCode).toBe(200);
    expect(actionsResponse.json()).toEqual({
      actions: [
        {
          id: "dla_1",
          deadLetterJobId: "dlj_1",
          queueName: "telemetry",
          jobName: "trace",
          action: "deleted",
          actorUserId: "usr_1",
          actorEmail: "admin@example.com",
          metadata: {},
          createdAt: "2026-06-01T14:00:00.000Z"
        }
      ]
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(missingResponse.statusCode).toBe(404);
    expect(getDeadLetterJob).toHaveBeenCalledWith("dlj_1");
    expect(listDeadLetterJobActions).toHaveBeenCalledWith("dlj_1");
    expect(deleteDeadLetterJob).toHaveBeenCalledWith("dlj_1", { userId: "usr_1", email: "admin@example.com" });
  });

  it("replays dead letter jobs for admins", async () => {
    const replayDeadLetterJob = vi.fn(async (id: string): Promise<"replayed" | "not_found"> =>
      id === "dlj_1" ? "replayed" : "not_found"
    );
    app = await buildApp({
      readiness,
      auth: adminAuth,
      deadLetters: {
        replayDeadLetterJob
      }
    });

    const response = await app.inject({ method: "POST", url: "/admin/dead-letter-jobs/dlj_1/replay" });
    const missingResponse = await app.inject({ method: "POST", url: "/admin/dead-letter-jobs/dlj_missing/replay" });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ replayed: true, id: "dlj_1" });
    expect(missingResponse.statusCode).toBe(404);
    expect(replayDeadLetterJob).toHaveBeenCalledWith("dlj_1", { userId: "usr_1", email: "admin@example.com" });
  });

  it("rejects dead letter replay when the stored job is not replayable", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      deadLetters: {
        replayDeadLetterJob: async (id) => (id === "dlj_invalid" ? "invalid_payload" : "unsupported_queue")
      }
    });

    const invalidResponse = await app.inject({ method: "POST", url: "/admin/dead-letter-jobs/dlj_invalid/replay" });
    const unsupportedResponse = await app.inject({
      method: "POST",
      url: "/admin/dead-letter-jobs/dlj_unsupported/replay"
    });

    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toEqual({ error: "dead_letter_invalid_payload" });
    expect(unsupportedResponse.statusCode).toBe(400);
    expect(unsupportedResponse.json()).toEqual({ error: "dead_letter_unsupported_queue" });
  });

  it("rejects weak admin-created passwords", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      users: {
        createUser: async () => ({ id: "usr_2", email: "user@example.com", isAdmin: false })
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/users",
      payload: { email: "user@example.com", password: "x", isAdmin: false }
    });

    expect(response.statusCode).toBe(400);
  });

  it("creates console users as administrators and rejects explicit operator accounts", async () => {
    const createUser = vi.fn(async (input) => ({ id: "usr_2", email: input.email, isAdmin: input.isAdmin }));
    app = await buildApp({ readiness, auth: adminAuth, users: { createUser } });

    const defaultAdmin = await app.inject({
      method: "POST",
      url: "/admin/users",
      payload: { email: "admin-2@example.com", password: "temporary-password" }
    });
    const operator = await app.inject({
      method: "POST",
      url: "/admin/users",
      payload: { email: "operator@example.com", password: "temporary-password", isAdmin: false }
    });

    expect(defaultAdmin.statusCode).toBe(201);
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: true }));
    expect(operator.statusCode).toBe(400);
    expect(operator.json()).toEqual({ error: "console_users_must_be_admins" });
    expect(createUser).toHaveBeenCalledTimes(1);
  });

  it("prevents the current administrator from demoting or archiving themselves", async () => {
    const updateUser = vi.fn();
    const archiveUser = vi.fn();
    app = await buildApp({ readiness, auth: adminAuth, users: { updateUser, archiveUser } });

    const demote = await app.inject({
      method: "PATCH",
      url: "/admin/users/usr_1",
      payload: { isAdmin: false }
    });
    const archive = await app.inject({ method: "DELETE", url: "/admin/users/usr_1" });

    expect(demote.statusCode).toBe(409);
    expect(demote.json()).toEqual({ error: "cannot_demote_current_admin" });
    expect(archive.statusCode).toBe(409);
    expect(archive.json()).toEqual({ error: "cannot_archive_current_admin" });
    expect(updateUser).not.toHaveBeenCalled();
    expect(archiveUser).not.toHaveBeenCalled();
  });

  it("returns repository admin-invariant conflicts with a stable API contract", async () => {
    const updateUser = vi.fn(async (id: string) => {
      throw new AdminUserInvariantError(id === "usr_2" ? "last_active_admin" : "console_users_must_be_admins");
    });
    const archiveUser = vi.fn(async () => { throw new AdminUserInvariantError("last_active_admin"); });
    app = await buildApp({ readiness, auth: adminAuth, users: { updateUser, archiveUser } });

    const demote = await app.inject({
      method: "PATCH",
      url: "/admin/users/usr_2",
      payload: { isAdmin: false }
    });
    const archive = await app.inject({ method: "DELETE", url: "/admin/users/usr_2" });
    const unsupportedDemotion = await app.inject({
      method: "PATCH",
      url: "/admin/users/usr_3",
      payload: { isAdmin: false }
    });

    expect(demote.statusCode).toBe(409);
    expect(demote.json()).toEqual({ error: "last_active_admin" });
    expect(archive.statusCode).toBe(409);
    expect(archive.json()).toEqual({ error: "last_active_admin" });
    expect(unsupportedDemotion.statusCode).toBe(400);
    expect(unsupportedDemotion.json()).toEqual({ error: "console_users_must_be_admins" });
    expect(updateUser).toHaveBeenCalledWith("usr_2", { isAdmin: false }, { actorUserId: "usr_1" });
    expect(updateUser).toHaveBeenCalledWith("usr_3", { isAdmin: false }, { actorUserId: "usr_1" });
    expect(archiveUser).toHaveBeenCalledWith("usr_2", { actorUserId: "usr_1" });
  });

  it("rejects a copied cookie after an administrator changes its user's password", async () => {
    const harness = createLifecycleHarness();
    app = await buildApp({ readiness, auth: harness.auth, users: harness.users });
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin@example.com", password: "password" }
    });
    const cookie = readSessionCookie(login);

    const changed = await app.inject({
      method: "PATCH",
      url: "/admin/users/usr_1",
      headers: { cookie },
      payload: { password: "replacement-password" }
    });

    expect(changed.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("rejects a copied cookie after an administrator archives its user", async () => {
    const harness = createLifecycleHarness();
    app = await buildApp({ readiness, auth: harness.auth, users: harness.users });
    const actorLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin@example.com", password: "password" }
    });
    const targetLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin-2@example.com", password: "password" }
    });
    const actorCookie = readSessionCookie(actorLogin);
    const copiedTargetCookie = readSessionCookie(targetLogin);

    const archived = await app.inject({
      method: "DELETE",
      url: "/admin/users/usr_2",
      headers: { cookie: actorCookie }
    });

    expect(archived.statusCode).toBe(204);
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: copiedTargetCookie } })).statusCode
    ).toBe(401);
  });

  it("rejects unsafe webhook notification-channel URLs in development", async () => {
    const alerts = {
      listNotificationChannels: vi.fn(async () => []),
      createNotificationChannel: vi.fn(async (input) => ({
        id: "chn_1",
        name: input.name,
        type: "webhook" as const,
        url: input.url,
        emailRecipients: [] as [],
        secretHeaderName: input.secretHeaderName ?? null,
        secretHeaderValue: input.secretHeaderValue ?? null,
        hasSecret: Boolean(input.secretHeaderValue),
        enabled: input.enabled,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        archivedAt: null
      })),
      updateNotificationChannel: vi.fn(),
      archiveNotificationChannel: vi.fn(),
      getNotificationChannel: vi.fn(),
      listAlertRules: vi.fn(async () => []),
      createAlertRule: vi.fn(),
      updateAlertRule: vi.fn(),
      archiveAlertRule: vi.fn()
    };

    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts,
      nodeEnv: "development"
    });

    for (const url of [
      "http://localhost/hook",
      "http://127.0.0.1/hook",
      "http://10.0.0.1/hook",
      "http://172.16.0.1/hook",
      "http://192.168.1.10/hook",
      "http://169.254.169.254/latest/meta-data",
      "http://100.64.0.1/hook",
      "http://224.0.0.1/hook",
      "http://[::1]/hook",
      "http://[fc00::1]/hook",
      "http://[fe80::1]/hook"
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/admin/notification-channels",
        payload: { name: "Unsafe", type: "webhook", url }
      });

      expect(response.statusCode, url).toBe(400);
      expect(response.json(), url).toEqual({ error: "invalid_notification_channel_request" });
    }
    expect(alerts.createNotificationChannel).not.toHaveBeenCalled();
  });

  it("creates a project", async () => {
    const createdProjects: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        projects: {
          list: async () => [],
          get: async () => null,
          create: async (input) => {
            createdProjects.push(input);
            return {
              id: "prj_1",
              name: input.name,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-01T00:00:00.000Z"),
              archivedAt: null
            };
          },
          update: async () => null,
          archive: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/projects",
      payload: { name: "SignalMonitor" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().project).toMatchObject({ id: "prj_1", name: "SignalMonitor" });
    expect(createdProjects).toEqual([{ name: "SignalMonitor" }]);
  });

  it("creates an environment for a project", async () => {
    const createdEnvironments: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        environments: {
          list: async () => [],
          create: async (input) => {
            createdEnvironments.push(input);
            return {
              id: "env_1",
              projectId: input.projectId,
              name: input.name,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-01T00:00:00.000Z"),
              archivedAt: null
            };
          },
          update: async () => null,
          archive: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_1/environments",
      payload: { name: "Production" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().environment).toMatchObject({
      id: "env_1",
      projectId: "prj_1",
      name: "Production"
    });
    expect(createdEnvironments).toEqual([{ projectId: "prj_1", name: "Production" }]);
  });

  it("manages project browser origins", async () => {
    const createdOrigins: unknown[] = [];
    const archivedOriginIds: string[] = [];

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        browserOrigins: {
          list: async (projectId) => [
            {
              id: "borg_1",
              projectId,
              origin: "https://app.example.com",
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              archivedAt: null
            }
          ],
          create: async (input) => {
            createdOrigins.push(input);
            return {
              id: "borg_2",
              projectId: input.projectId,
              origin: "https://new.example.com",
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              archivedAt: null
            };
          },
          archive: async (id) => {
            archivedOriginIds.push(id);
            return {
              id,
              projectId: "prj_1",
              origin: "https://app.example.com",
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              archivedAt: new Date("2026-01-02T00:00:00.000Z")
            };
          }
        }
      }
    });

    const listResponse = await app.inject({ method: "GET", url: "/admin/projects/prj_1/browser-origins" });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().origins).toEqual([
      expect.objectContaining({ id: "borg_1", projectId: "prj_1", origin: "https://app.example.com" })
    ]);

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_1/browser-origins",
      payload: { origin: "https://new.example.com/dashboard" }
    });
    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().origin).toMatchObject({ id: "borg_2", origin: "https://new.example.com" });
    expect(createdOrigins).toEqual([{ projectId: "prj_1", origin: "https://new.example.com/dashboard" }]);

    const deleteResponse = await app.inject({ method: "DELETE", url: "/admin/browser-origins/borg_1" });
    expect(deleteResponse.statusCode).toBe(204);
    expect(archivedOriginIds).toEqual(["borg_1"]);
  });

  it("updates browser-origin cache state only after successful admin mutations", async () => {
    const allowedOrigins = new Set([
      "https://archived.example.com",
      "https://project.example.com",
      "https://failed.example.com"
    ]);
    const lookup = vi.fn(async (origin: string) => allowedOrigins.has(origin));
    const originRecord = (id: string, origin: string) => ({
      id,
      projectId: "prj_1",
      origin,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      archivedAt: null
    });

    app = await buildApp({
      readiness,
      auth: adminAuth,
      isBrowserCorsOriginAllowed: lookup,
      adminResources: {
        projects: {
          list: async () => [],
          get: async () => null,
          create: async () => {
            throw new Error("not used");
          },
          update: async () => null,
          archive: async () => {
            allowedOrigins.delete("https://project.example.com");
          }
        },
        browserOrigins: {
          list: async () => [],
          create: async (input) => {
            const origin = new URL(input.origin).origin;
            if (origin === "https://failed-create.example.com") throw new Error("create failed");
            allowedOrigins.add(origin);
            return originRecord("borg_created", origin);
          },
          archive: async (id) => {
            if (id === "borg_failed") throw new Error("archive failed");
            allowedOrigins.delete("https://archived.example.com");
            return {
              ...originRecord(id, "https://archived.example.com"),
              archivedAt: new Date("2026-01-02T00:00:00.000Z")
            };
          }
        }
      }
    });

    const preflight = (origin: string) => app!.inject({ method: "OPTIONS", url: "/v1/events", headers: { origin } });

    expect((await preflight("https://new.example.com")).statusCode).not.toBe(204);
    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_1/browser-origins",
      payload: { origin: "https://new.example.com/path" }
    });
    expect(createResponse.statusCode).toBe(201);
    expect((await preflight("https://new.example.com")).statusCode).toBe(204);

    expect((await preflight("https://archived.example.com")).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: "/admin/browser-origins/borg_archived" })).statusCode).toBe(204);
    expect((await preflight("https://archived.example.com")).statusCode).not.toBe(204);

    expect((await preflight("https://project.example.com")).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: "/admin/projects/prj_1" })).statusCode).toBe(204);
    expect((await preflight("https://project.example.com")).statusCode).not.toBe(204);

    expect((await preflight("https://failed.example.com")).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: "/admin/browser-origins/borg_failed" })).statusCode).toBe(500);
    allowedOrigins.delete("https://failed.example.com");
    expect((await preflight("https://failed.example.com")).statusCode).toBe(204);

    expect((await preflight("https://failed-create.example.com")).statusCode).not.toBe(204);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/admin/projects/prj_1/browser-origins",
          payload: { origin: "https://failed-create.example.com" }
        })
      ).statusCode
    ).toBe(500);
    allowedOrigins.add("https://failed-create.example.com");
    expect((await preflight("https://failed-create.example.com")).statusCode).not.toBe(204);
  });

  it("manages project code integrations and release metadata", async () => {
    const list = vi.fn(async () => [codeIntegration()]);
    const create = vi.fn(async (input) => codeIntegration({ ...input, id: "cint_2" }));
    const revoke = vi.fn(async () => codeIntegration());
    const upsertReleaseMetadata = vi.fn(async (input) => releaseMetadata(input));

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        codeIntegrations: { list, create, revoke, upsertReleaseMetadata }
      }
    });

    const listResponse = await app.inject({ method: "GET", url: "/admin/projects/prj_1/code-integrations" });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({ integrations: [codeIntegrationResponse()] });
    expect(list).toHaveBeenCalledWith("prj_1");

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_1/code-integrations",
      payload: { provider: "gitlab", name: "API", owner: "platform/team", repo: "api" }
    });
    expect(createResponse.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith({
      projectId: "prj_1",
      provider: "gitlab",
      name: "API",
      owner: "platform/team",
      repo: "api"
    });

    const releaseResponse = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_1/release-metadata",
      payload: {
        environmentId: "env_1",
        release: "web@1.2.3",
        integrationId: "cint_1",
        commitSha: "abcdef123456",
        commitUrl: "https://github.com/acme/web/commit/abcdef123456",
        pullRequestNumber: 42,
        pullRequestUrl: "https://github.com/acme/web/pull/42",
        deployedBy: "github-actions"
      }
    });
    expect(releaseResponse.statusCode).toBe(201);
    expect(releaseResponse.json()).toEqual({ metadata: releaseMetadataResponse() });
    expect(upsertReleaseMetadata).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      release: "web@1.2.3",
      integrationId: "cint_1",
      commitSha: "abcdef123456",
      commitUrl: "https://github.com/acme/web/commit/abcdef123456",
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/acme/web/pull/42",
      deployedBy: "github-actions"
    });

    const deleteResponse = await app.inject({ method: "DELETE", url: "/admin/projects/prj_1/code-integrations/cint_1" });
    expect(deleteResponse.statusCode).toBe(204);
    expect(revoke).toHaveBeenCalledWith({ projectId: "prj_1", integrationId: "cint_1" });
  });

  it("rejects release metadata linked to another project's code integration", async () => {
    const upsertReleaseMetadata = vi.fn(async () => {
      throw new Error("code_integration_not_found");
    });
    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        codeIntegrations: {
          list: vi.fn(async () => []),
          create: vi.fn(),
          revoke: vi.fn(),
          upsertReleaseMetadata,
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_1/release-metadata",
      payload: { environmentId: "env_1", release: "web@2.0.0", integrationId: "cint_other" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "code_integration_not_found" });
  });

  it("manages analytics segments for admins", async () => {
    const list = vi.fn(async () => [analyticsSegment()]);
    const create = vi.fn(async (input) => analyticsSegment(input));
    const update = vi.fn(async (_id, input) => analyticsSegment({ ...input, id: "seg_1" }));
    const archive = vi.fn(async () => undefined);
    const get = vi.fn(async () => analyticsSegment());
    const preview = vi.fn(async () => analyticsSegmentPreview());

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsSegments: { list, create, update, archive, get, preview }
      }
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/analytics-segments?project_id=prj_1&environment_id=env_1"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({ segments: [analyticsSegmentResponse()] });
    expect(list).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/analytics-segments",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Team creators",
        actorType: "user",
        definition: { window: "30d", eventName: "project.created", propertyName: "plan", propertyValue: "team" }
      }
    });
    expect(createResponse.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Team creators",
      actorType: "user",
      definition: { window: "30d", eventName: "project.created", propertyName: "plan", propertyValue: "team" }
    });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/admin/analytics-segments/seg_1",
      payload: { name: "Activated users" }
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith("seg_1", { name: "Activated users" });

    const previewResponse = await app.inject({
      method: "GET",
      url: "/admin/analytics-segments/seg_1/preview?project_id=prj_1&environment_id=env_1&limit=3"
    });
    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.json()).toEqual({
      preview: {
        segmentId: "seg_1",
        actorType: "user",
        window: "30d",
        actors: 1,
        samples: [{ actorId: "user_1", lastSeenAt: "2026-01-01T00:00:00.000Z" }]
      }
    });
    expect(get).toHaveBeenCalledWith({ id: "seg_1", projectId: "prj_1", environmentId: "env_1" });
    expect(preview).toHaveBeenCalledWith(analyticsSegment(), { limit: 3 });

    const deleteResponse = await app.inject({ method: "DELETE", url: "/admin/analytics-segments/seg_1" });
    expect(deleteResponse.statusCode).toBe(204);
    expect(archive).toHaveBeenCalledWith("seg_1");
  });

  it("rejects analytics segments without any condition", async () => {
    const create = vi.fn(async () => analyticsSegment());

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsSegments: {
          list: async () => [],
          create,
          update: async () => undefined,
          archive: async () => undefined,
          get: async () => undefined,
          preview: async () => analyticsSegmentPreview({ actors: 0, samples: [] })
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/analytics-segments",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Invalid",
        actorType: "user",
        definition: { window: "30d" }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_analytics_segment_request" });
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts a v2 tree definition combining event and trait conditions", async () => {
    const create = vi.fn(async (input) => analyticsSegment(input));

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsSegments: {
          list: async () => [],
          create,
          update: async () => undefined,
          archive: async () => undefined,
          get: async () => undefined,
          preview: async () => analyticsSegmentPreview()
        }
      }
    });

    const definition = {
      version: 2,
      window: "30d",
      root: {
        kind: "group",
        op: "and",
        children: [
          { kind: "event", eventName: "project.created" },
          { kind: "trait", source: "user", name: "plan", operator: "eq", value: "enterprise" }
        ]
      }
    };

    const response = await app.inject({
      method: "POST",
      url: "/admin/analytics-segments",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Enterprise creators",
        actorType: "user",
        definition
      }
    });

    expect(response.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        definition
      })
    );
  });

  it("rejects a v2 definition using an operator outside the whitelist", async () => {
    const create = vi.fn(async () => analyticsSegment());

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsSegments: {
          list: async () => [],
          create,
          update: async () => undefined,
          archive: async () => undefined,
          get: async () => undefined,
          preview: async () => analyticsSegmentPreview({ actors: 0, samples: [] })
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/analytics-segments",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Invalid operator",
        actorType: "user",
        definition: {
          version: 2,
          root: { kind: "trait", source: "user", name: "plan", operator: "nope", value: "enterprise" }
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "segment_invalid_operator" });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a v2 definition that exceeds the structural complexity limits", async () => {
    const create = vi.fn(async () => analyticsSegment());

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsSegments: {
          list: async () => [],
          create,
          update: async () => undefined,
          archive: async () => undefined,
          get: async () => undefined,
          preview: async () => analyticsSegmentPreview({ actors: 0, samples: [] })
        }
      }
    });

    let root: unknown = { kind: "event", eventName: "leaf" };
    for (let i = 0; i < 5; i += 1) {
      root = { kind: "group", op: "not", children: [root] };
    }

    const response = await app.inject({
      method: "POST",
      url: "/admin/analytics-segments",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Too complex",
        actorType: "user",
        definition: { version: 2, root }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "segment_definition_too_complex" });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a v2 definition patch using an operator outside the whitelist", async () => {
    const update = vi.fn(async () => analyticsSegment());

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsSegments: {
          list: async () => [],
          create: async () => analyticsSegment(),
          update,
          archive: async () => undefined,
          get: async () => undefined,
          preview: async () => analyticsSegmentPreview({ actors: 0, samples: [] })
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/analytics-segments/seg_1",
      payload: {
        definition: {
          version: 2,
          root: { kind: "event", property: { name: "plan", operator: "nope", value: "team" } }
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "segment_invalid_operator" });
    expect(update).not.toHaveBeenCalled();
  });

  it("manages analytics dashboards for admins with scoped mutations", async () => {
    const list = vi.fn(async () => [analyticsDashboard()]);
    const create = vi.fn(async (input) => analyticsDashboard(input));
    const update = vi.fn(async (input) => analyticsDashboard({ ...input.patch, id: input.id }));
    const archive = vi.fn(async () => undefined);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsDashboards: { list, create, update, archive }
      }
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/analytics-dashboards?project_id=prj_1&environment_id=env_1"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({ dashboards: [analyticsDashboardResponse()] });
    expect(list).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/analytics-dashboards",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Operations report",
        category: "operational",
        filters: { window: "7d" },
        widgets: [
          { type: "metric.events", title: "Events", width: "half", options: {} },
          { type: "metric.errors", title: "Errors", width: "half", options: {} },
          { type: "top.events", title: "Top events", width: "full", options: {} }
        ]
      }
    });
    expect(createResponse.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ projectId: "prj_1", environmentId: "env_1", name: "Operations report" }));

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/admin/analytics-dashboards/dash_1?project_id=prj_1&environment_id=env_1",
      payload: { name: "Executive report" }
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith({
      id: "dash_1",
      projectId: "prj_1",
      environmentId: "env_1",
      patch: { name: "Executive report" }
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/admin/analytics-dashboards/dash_1?project_id=prj_1&environment_id=env_1"
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(archive).toHaveBeenCalledWith({ id: "dash_1", projectId: "prj_1", environmentId: "env_1" });
  });

  it("accepts a focused dashboard with one widget", async () => {
    const create = vi.fn(async () => analyticsDashboard());

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsDashboards: {
          list: async () => [],
          create,
          update: async () => undefined,
          archive: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/analytics-dashboards",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Focused operations",
        widgets: [{ type: "metric.events", title: "Events", width: "half", options: {} }]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      name: "Focused operations",
      widgets: [expect.objectContaining({ type: "metric.events" })]
    }));
  });

  it("rejects dashboard filters that reports cannot evaluate", async () => {
    const create = vi.fn(async () => analyticsDashboard());
    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsDashboards: { list: async () => [], create, update: async () => undefined, archive: async () => undefined }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/analytics-dashboards",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Unsupported segment",
        filters: { window: "7d", segmentId: "seg_1" },
        widgets: [{ type: "metric.events", title: "Events", width: "half", options: {} }]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts insight widgets only when they reference a saved insight", async () => {
    const create = vi.fn(async (input) => analyticsDashboard(input));
    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsDashboards: { list: async () => [], create, update: async () => undefined, archive: async () => undefined }
      }
    });

    const valid = await app.inject({
      method: "POST",
      url: "/admin/analytics-dashboards",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Activation",
        widgets: [{ type: "insight", title: "Activation trend", width: "full", options: { insightId: "ins_1" } }]
      }
    });
    expect(valid.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      widgets: [expect.objectContaining({ type: "insight", options: { insightId: "ins_1" } })]
    }));

    const invalid = await app.inject({
      method: "POST",
      url: "/admin/analytics-dashboards",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Broken",
        widgets: [{ type: "insight", title: "Missing reference", width: "half", options: {} }]
      }
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("manages analytics insights for admins with scoped mutations", async () => {
    const insight = {
      id: "ins_1",
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Checkout trend",
      description: null,
      definition: { bucket: "hour" as const, metric: "count" as const, eventName: "checkout.started" },
      createdAt: new Date("2026-07-30T00:00:00.000Z"),
      updatedAt: new Date("2026-07-30T00:00:00.000Z"),
      archivedAt: null
    };
    const list = vi.fn(async () => [insight]);
    const create = vi.fn(async () => insight);
    const update = vi.fn(async () => ({ ...insight, name: "Renamed" }));
    const archive = vi.fn(async () => undefined);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsInsights: {
          list,
          create,
          update,
          archive,
          listProperties: async () => [],
          promoteProperty: async () => ({
            id: "prop_1",
            projectId: "prj_1",
            environmentId: "env_1",
            property: "plan",
            displayName: "Plan",
            indexName: "analytics_event_property_plan",
            indexStatus: "ready",
            indexError: null,
            indexedAt: new Date("2026-07-30T00:00:00.000Z"),
            createdAt: new Date("2026-07-30T00:00:00.000Z"),
            updatedAt: new Date("2026-07-30T00:00:00.000Z"),
            archivedAt: null
          }),
          archiveProperty: async () => undefined
        }
      }
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/analytics/insights?project_id=prj_1&environment_id=env_1"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });
    expect(listResponse.json()).toEqual({
      insights: [
        expect.objectContaining({
          id: "ins_1",
          projectId: "prj_1",
          environmentId: "env_1",
          name: "Checkout trend",
          createdAt: "2026-07-30T00:00:00.000Z"
        })
      ]
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/analytics/insights",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Checkout trend",
        definition: { bucket: "hour", metric: "count", eventName: "checkout.started" }
      }
    });
    expect(createResponse.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Checkout trend",
      definition: { bucket: "hour", metric: "count", eventName: "checkout.started" }
    });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/admin/analytics/insights/ins_1?project_id=prj_1&environment_id=env_1",
      payload: { name: "Renamed" }
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith({
      id: "ins_1",
      projectId: "prj_1",
      environmentId: "env_1",
      patch: { name: "Renamed" }
    });

    const archiveResponse = await app.inject({
      method: "DELETE",
      url: "/admin/analytics/insights/ins_1?project_id=prj_1&environment_id=env_1"
    });
    expect(archiveResponse.statusCode).toBe(204);
    expect(archive).toHaveBeenCalledWith({ id: "ins_1", projectId: "prj_1", environmentId: "env_1" });
  });

  it("manages promoted event properties for admins within a scope", async () => {
    const property = {
      id: "prop_1",
      projectId: "prj_1",
      environmentId: "env_1",
      property: "plan",
      displayName: "Plan",
      indexName: "analytics_event_property_plan",
      indexStatus: "ready" as const,
      indexError: null,
      indexedAt: new Date("2026-07-30T00:00:00.000Z"),
      createdAt: new Date("2026-07-30T00:00:00.000Z"),
      updatedAt: new Date("2026-07-30T00:00:00.000Z"),
      archivedAt: null
    };
    const listProperties = vi.fn(async () => [property]);
    const promoteProperty = vi.fn(async () => property);
    const archiveProperty = vi.fn(async () => undefined);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsInsights: {
          list: async () => [],
          create: async () => {
            throw new Error("unused");
          },
          update: async () => undefined,
          archive: async () => undefined,
          listProperties,
          promoteProperty,
          archiveProperty
        }
      }
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/analytics/promoted-properties?project_id=prj_1&environment_id=env_1"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listProperties).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/analytics/promoted-properties",
      payload: { projectId: "prj_1", environmentId: "env_1", property: "plan", displayName: "Plan" }
    });
    expect(createResponse.statusCode).toBe(201);
    expect(promoteProperty).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      property: "plan",
      displayName: "Plan"
    });

    const archiveResponse = await app.inject({
      method: "DELETE",
      url: "/admin/analytics/promoted-properties/prop_1?project_id=prj_1&environment_id=env_1"
    });
    expect(archiveResponse.statusCode).toBe(204);
    expect(archiveProperty).toHaveBeenCalledWith({
      id: "prop_1",
      projectId: "prj_1",
      environmentId: "env_1"
    });
  });

  it("reports a conflict when a promoted property is still used by an insight", async () => {
    const inUse = Object.assign(new Error("event_property_in_use"), { name: "EventPropertyInUseError" });
    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsInsights: {
          list: async () => [],
          create: async () => { throw new Error("unused"); },
          update: async () => undefined,
          archive: async () => undefined,
          listProperties: async () => [],
          promoteProperty: async () => { throw new Error("unused"); },
          archiveProperty: async () => { throw inUse; }
        }
      }
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/admin/analytics/promoted-properties/prop_1?project_id=prj_1&environment_id=env_1"
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "event_property_in_use" });
  });

  it("returns structured authorization, validation, not-found, and capability errors for analytics insights", async () => {
    app = await buildApp({ readiness, auth: userAuth });
    const forbidden = await app.inject({
      method: "GET",
      url: "/admin/analytics/insights?project_id=prj_1&environment_id=env_1"
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: "admin_required" });

    await app.close();
    app = await buildApp({ readiness, auth: adminAuth });
    const unavailable = await app.inject({
      method: "GET",
      url: "/admin/analytics/insights?project_id=prj_1&environment_id=env_1"
    });
    expect(unavailable.statusCode).toBe(501);
    expect(unavailable.json()).toEqual({ error: "analytics_insights_repository_unavailable" });

    await app.close();
    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsInsights: {
          list: async () => [],
          create: async () => {
            throw new Error("unused");
          },
          update: async () => null,
          archive: async () => undefined,
          listProperties: async () => [],
          promoteProperty: async () => {
            throw new Error("unused");
          },
          archiveProperty: async () => undefined
        }
      }
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/admin/analytics/insights",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Invalid",
        definition: { bucket: "minute", metric: "count" }
      }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "invalid_analytics_insight_request" });

    const missing = await app.inject({
      method: "PATCH",
      url: "/admin/analytics/insights/missing?project_id=prj_1&environment_id=env_1",
      payload: { name: "Renamed" }
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "analytics_insight_not_found" });

    const invalidProperty = await app.inject({
      method: "POST",
      url: "/admin/analytics/promoted-properties",
      payload: { projectId: "prj_1", environmentId: "env_1", property: "not valid!" }
    });
    expect(invalidProperty.statusCode).toBe(400);
    expect(invalidProperty.json()).toEqual({ error: "invalid_promoted_event_property_request" });
  });

  it("returns a structured 400 when an insight uses an unpromoted breakdown", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        analyticsInsights: {
          list: async () => [],
          create: async () => {
            throw new EventPropertyNotPromotedError("plan");
          },
          update: async () => undefined,
          archive: async () => undefined,
          listProperties: async () => [],
          promoteProperty: async () => {
            throw new Error("unused");
          },
          archiveProperty: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/analytics/insights",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "By plan",
        definition: { bucket: "day", metric: "count", breakdownProperty: "plan" }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "breakdown_property_not_promoted" });
  });

  it("manages experiments for admins with scoped mutations", async () => {
    const list = vi.fn(async () => [experiment()]);
    const create = vi.fn(async (input) => experiment(input));
    const update = vi.fn(async (input) => experiment({ ...input.patch, id: input.id }));
    const archive = vi.fn(async () => undefined);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        experiments: { list, create, update, archive }
      }
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/experiments?project_id=prj_1&environment_id=env_1"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({ experiments: [experimentResponse()] });
    expect(list).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/experiments",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        key: "checkout_copy",
        name: "Checkout copy",
        actorType: "user",
        exposureEvent: "sigmon.experiment.exposed",
        conversionEvent: "checkout.completed",
        variants: [
          { key: "control", name: "Control", weight: 50 },
          { key: "treatment", name: "Treatment", weight: 50 }
        ],
        primaryMetric: { eventName: "checkout.completed", windowHours: 24 }
      }
    });
    expect(createResponse.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ key: "checkout_copy", variants: expect.any(Array) }));

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/admin/experiments/exp_1?project_id=prj_1&environment_id=env_1",
      payload: { status: "paused" }
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith({
      id: "exp_1",
      projectId: "prj_1",
      environmentId: "env_1",
      patch: { status: "paused" }
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/admin/experiments/exp_1?project_id=prj_1&environment_id=env_1"
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(archive).toHaveBeenCalledWith({ id: "exp_1", projectId: "prj_1", environmentId: "env_1" });
  });

  it("rejects experiments with fewer than two variants", async () => {
    const create = vi.fn(async () => experiment());

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        experiments: {
          list: async () => [],
          create,
          update: async () => undefined,
          archive: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/experiments",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        key: "bad",
        name: "Bad",
        variants: [{ key: "only", name: "Only", weight: 100 }]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_experiment_request" });
    expect(create).not.toHaveBeenCalled();
  });

  it("manages surveys for admins with scoped mutations", async () => {
    const list = vi.fn(async () => [survey()]);
    const create = vi.fn(async (input) => survey(input));
    const update = vi.fn(async (input) => survey({ ...input.patch, id: input.id }));
    const archive = vi.fn(async () => undefined);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        surveys: { list, create, update, archive }
      }
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/surveys?project_id=prj_1&environment_id=env_1"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({ surveys: [surveyResponse()] });
    expect(list).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/surveys",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        key: "activation_pulse",
        name: "Activation pulse",
        status: "active",
        actorType: "user",
        triggerEvent: "checkout.completed",
        questions: [
          {
            id: "satisfaction",
            type: "rating",
            label: "How satisfied are you?",
            required: true,
            scale: { min: 1, max: 5, minLabel: "Hard", maxLabel: "Great" }
          }
        ],
        targeting: { tenantId: "tenant_1" }
      }
    });
    expect(createResponse.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        key: "activation_pulse",
        actorType: "user",
        triggerEvent: "checkout.completed",
        targeting: { tenantId: "tenant_1" }
      })
    );

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/admin/surveys/surv_1?project_id=prj_1&environment_id=env_1",
      payload: { status: "paused" }
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith({
      id: "surv_1",
      projectId: "prj_1",
      environmentId: "env_1",
      patch: { status: "paused" }
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/admin/surveys/surv_1?project_id=prj_1&environment_id=env_1"
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(archive).toHaveBeenCalledWith({ id: "surv_1", projectId: "prj_1", environmentId: "env_1" });
  });

  it("rejects surveys without questions", async () => {
    const create = vi.fn(async () => survey());

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        surveys: {
          list: async () => [],
          create,
          update: async () => undefined,
          archive: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/surveys",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        key: "bad",
        name: "Bad",
        questions: []
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_survey_request" });
    expect(create).not.toHaveBeenCalled();
  });

  it("manages message campaigns for admins with scoped mutations", async () => {
    const list = vi.fn(async () => [messageCampaign()]);
    const create = vi.fn(async (input) => messageCampaign(input));
    const update = vi.fn(async (input) => messageCampaign({ ...input.patch, id: input.id }));
    const archive = vi.fn(async () => undefined);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        messageCampaigns: { list, create, update, archive }
      }
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/message-campaigns?project_id=prj_1&environment_id=env_1"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({ campaigns: [messageCampaignResponse()] });
    expect(list).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/message-campaigns",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        key: "invoice_activation",
        name: "Invoice activation",
        status: "active",
        channelType: "email",
        notificationChannelId: "chn_1",
        segmentId: "seg_1",
        conversionEvent: "invoice.paid",
        subject: "Create your first invoice",
        body: "Invite tenants to finish onboarding.",
        ctaUrl: "https://app.example.com/invoices",
        consentCategory: "product",
        privacyNote: "Only opted-in contacts."
      }
    });
    expect(createResponse.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        key: "invoice_activation",
        channelType: "email",
        notificationChannelId: "chn_1",
        consentCategory: "product"
      })
    );

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/admin/message-campaigns/cmp_1?project_id=prj_1&environment_id=env_1",
      payload: { status: "paused" }
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith({
      id: "cmp_1",
      projectId: "prj_1",
      environmentId: "env_1",
      patch: { status: "paused" }
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/admin/message-campaigns/cmp_1?project_id=prj_1&environment_id=env_1"
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(archive).toHaveBeenCalledWith({ id: "cmp_1", projectId: "prj_1", environmentId: "env_1" });
  });

  it("manages feedback widget settings for a scoped environment", async () => {
    const getSettings = vi.fn(async () => feedbackWidgetSettings());
    const upsertSettings = vi.fn(async (input) => feedbackWidgetSettings(input));

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        feedbackWidget: { getSettings, upsertSettings }
      }
    });

    const getResponse = await app.inject({
      method: "GET",
      url: "/admin/feedback-widget?project_id=prj_1&environment_id=env_1"
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual({ settings: feedbackWidgetSettingsResponse() });
    expect(getSettings).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/admin/feedback-widget",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        enabled: true,
        title: "Report feedback",
        prompt: "What should we improve?",
        placeholder: "Tell us what happened...",
        buttonLabel: "Feedback",
        accentColor: "#00aa66",
        allowScreenshot: false,
        privacyNote: "Do not include secrets."
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(upsertSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        title: "Report feedback",
        privacyNote: "Do not include secrets."
      })
    );
  });

  it("manages feature flags for admins with audit history and evaluation preview", async () => {
    const list = vi.fn(async () => [featureFlag()]);
    const create = vi.fn(async (input) => featureFlag(input));
    const update = vi.fn(async (input) => featureFlag({ ...input.patch, id: input.id }));
    const archive = vi.fn(async () => undefined);
    const listAudit = vi.fn(async () => [featureFlagAudit()]);
    const evaluate = vi.fn(
      async (): Promise<FeatureFlagEvaluation> => ({
        key: "new_checkout",
        variant: "on",
        value: true,
        matched: true,
        reason: "rule_match",
        ruleId: "internal"
      })
    );

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        featureFlags: { list, create, update, archive, listAudit, evaluate }
      }
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/feature-flags?project_id=prj_1&environment_id=env_1"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({ flags: [featureFlagResponse()] });

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/feature-flags",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        key: "new_checkout",
        name: "New checkout",
        status: "active",
        defaultVariant: "off",
        variants: [
          { key: "off", value: false },
          { key: "on", value: true }
        ],
        rules: [
          { id: "internal", description: "Internal user", variant: "on", match: { userId: "user_1" } },
          { id: "gradual_rollout", description: "Gradual rollout", variant: "on", match: {}, rollout: { percentage: 10, stickiness: "user" } }
        ]
      }
    });
    expect(createResponse.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "new_checkout",
        actorId: "usr_1",
        rules: expect.arrayContaining([expect.objectContaining({ id: "gradual_rollout", rollout: { percentage: 10, stickiness: "user" } })])
      })
    );

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/admin/feature-flags/flg_1?project_id=prj_1&environment_id=env_1",
      payload: { status: "paused" }
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith({
      id: "flg_1",
      projectId: "prj_1",
      environmentId: "env_1",
      patch: { status: "paused" },
      actorId: "usr_1"
    });

    const auditResponse = await app.inject({
      method: "GET",
      url: "/admin/feature-flags/flg_1/audit?project_id=prj_1&environment_id=env_1"
    });
    expect(auditResponse.statusCode).toBe(200);
    expect(auditResponse.json()).toEqual({ audit: [featureFlagAuditResponse()] });

    const evaluateResponse = await app.inject({
      method: "POST",
      url: "/admin/feature-flags/flg_1/evaluate?project_id=prj_1&environment_id=env_1",
      payload: { subject: { userId: "user_1", traits: { plan: "beta" } }, fallbackVariant: "off" }
    });
    expect(evaluateResponse.statusCode).toBe(200);
    expect(evaluateResponse.json()).toEqual({ evaluation: { key: "new_checkout", variant: "on", value: true, matched: true, reason: "rule_match", ruleId: "internal" } });
    expect(evaluate).toHaveBeenCalledWith({
      id: "flg_1",
      projectId: "prj_1",
      environmentId: "env_1",
      subject: { userId: "user_1", traits: { plan: "beta" } },
      fallbackVariant: "off"
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/admin/feature-flags/flg_1?project_id=prj_1&environment_id=env_1"
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(archive).toHaveBeenCalledWith({ id: "flg_1", projectId: "prj_1", environmentId: "env_1", actorId: "usr_1" });
  });

  it("manages beta programs, participants, and adoption for admins", async () => {
    const list = vi.fn(async () => [betaProgram()]);
    const create = vi.fn(async (input) => betaProgram(input));
    const update = vi.fn(async (input) => betaProgram({ ...input.patch, id: input.id }));
    const archive = vi.fn(async () => undefined);
    const listParticipants = vi.fn(async () => [betaProgramParticipant()]);
    const addParticipant = vi.fn(async (input) => betaProgramParticipant(input));
    const removeParticipant = vi.fn(async () => undefined);
    const getAdoption = vi.fn(async () => betaProgramAdoption());

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        betaPrograms: { list, create, update, archive, listParticipants, addParticipant, removeParticipant, getAdoption }
      }
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/beta-programs?project_id=prj_1&environment_id=env_1"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({ programs: [betaProgramResponse()] });

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/beta-programs",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        key: "checkout_beta",
        name: "Checkout beta",
        status: "active",
        actorType: "user",
        featureFlagId: "flg_1",
        featureFlagVariant: "on"
      }
    });
    expect(createResponse.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ key: "checkout_beta", actorType: "user" }));

    const participantsResponse = await app.inject({
      method: "GET",
      url: "/admin/beta-programs/beta_1/participants?project_id=prj_1&environment_id=env_1"
    });
    expect(participantsResponse.statusCode).toBe(200);
    expect(participantsResponse.json()).toEqual({ participants: [betaProgramParticipantResponse()] });

    const addResponse = await app.inject({
      method: "POST",
      url: "/admin/beta-programs/beta_1/participants",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        actorType: "user",
        actorId: "user_1",
        status: "active",
        notes: "Requested early access."
      }
    });
    expect(addResponse.statusCode).toBe(201);
    expect(addParticipant).toHaveBeenCalledWith(expect.objectContaining({ programId: "beta_1", actorId: "user_1", actorType: "user" }));

    const adoptionResponse = await app.inject({
      method: "GET",
      url: "/admin/beta-programs/beta_1/adoption?project_id=prj_1&environment_id=env_1&window=30d"
    });
    expect(adoptionResponse.statusCode).toBe(200);
    expect(adoptionResponse.json()).toEqual({ adoption: betaProgramAdoption() });
    expect(getAdoption).toHaveBeenCalledWith({ programId: "beta_1", projectId: "prj_1", environmentId: "env_1", window: "30d" });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/admin/beta-programs/beta_1?project_id=prj_1&environment_id=env_1",
      payload: { status: "paused" }
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith({ id: "beta_1", projectId: "prj_1", environmentId: "env_1", patch: { status: "paused" } });

    const removeResponse = await app.inject({
      method: "DELETE",
      url: "/admin/beta-programs/beta_1/participants/betap_1?project_id=prj_1&environment_id=env_1"
    });
    expect(removeResponse.statusCode).toBe(204);
    expect(removeParticipant).toHaveBeenCalledWith({ programId: "beta_1", projectId: "prj_1", environmentId: "env_1", participantId: "betap_1" });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/admin/beta-programs/beta_1?project_id=prj_1&environment_id=env_1"
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(archive).toHaveBeenCalledWith({ id: "beta_1", projectId: "prj_1", environmentId: "env_1" });
  });

  it("manages data governance policies for admins", async () => {
    const get = vi.fn(async () => dataGovernancePolicy());
    const upsert = vi.fn(async (input) =>
      dataGovernancePolicy({
        retentionPolicy: input.retentionPolicy,
        propertyRules: input.propertyRules,
        updatedByUserId: input.updatedByUserId ?? null
      })
    );

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        dataGovernance: { get, upsert }
      }
    });

    const getResponse = await app.inject({
      method: "GET",
      url: "/admin/data-governance?project_id=prj_1&environment_id=env_1"
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual({ policy: dataGovernancePolicyResponse() });
    expect(get).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });

    const putResponse = await app.inject({
      method: "PUT",
      url: "/admin/data-governance",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        retentionPolicy: { events: 60, errors: 365 },
        propertyRules: [
          { target: "event.properties", path: "email", action: "mask" },
          { target: "metadata", path: "headers.authorization", action: "block" }
        ]
      }
    });
    expect(putResponse.statusCode).toBe(200);
    expect(upsert).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      retentionPolicy: { events: 60, errors: 365 },
      propertyRules: [
        { target: "event.properties", path: "email", action: "mask" },
        { target: "metadata", path: "headers.authorization", action: "block" }
      ],
      updatedByUserId: "usr_1"
    });
  });

  it("rejects unknown data governance retention categories", async () => {
    const upsert = vi.fn(async () => dataGovernancePolicy());
    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        dataGovernance: { get: async () => dataGovernancePolicy(), upsert }
      }
    });

    const response = await app.inject({
      method: "PUT",
      url: "/admin/data-governance",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        retentionPolicy: { events: 60, unknownCategory: 45 },
        propertyRules: []
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_data_governance_request" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("manages warehouse export destinations and manual runs for admins", async () => {
    const repositoryDestination = () => ({
      ...warehouseDestination(),
      connectionUrl: "postgres://synthetic-private.invalid/db",
      connectionUrlEncrypted: "v1.synthetic-envelope",
      connection_url: "postgres://synthetic-legacy.invalid/db",
      connection_url_encrypted: "v1.synthetic-legacy-envelope"
    });
    const listDestinations = vi.fn(async () => [repositoryDestination()]);
    const createDestination = vi.fn(async (input) =>
      ({
        ...repositoryDestination(),
        name: input.name,
        datasets: input.datasets,
        batchSize: input.batchSize
      })
    );
    const updateDestination = vi.fn(async (input) =>
      ({
        ...repositoryDestination(),
        id: input.id,
        name: input.name ?? "Warehouse",
        enabled: input.enabled ?? true
      })
    );
    const archiveDestination = vi.fn(async () => undefined);
    const listRuns = vi.fn(async () => [warehouseExportRun()]);
    const runDestination = vi.fn(async () => ({ ran: true, skipped: false, exported: 1, failed: 0 }));

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        warehouseExports: {
          listDestinations,
          createDestination,
          updateDestination,
          archiveDestination,
          listRuns,
          runDestination
        }
      }
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/warehouse-destinations?project_id=prj_1&environment_id=env_1"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({ destinations: [warehouseDestinationResponse()] });
    expect(listResponse.json().destinations[0]).not.toHaveProperty("connectionUrl");
    expect(listResponse.json().destinations[0]).not.toHaveProperty("connectionUrlEncrypted");
    expect(listResponse.json().destinations[0]).not.toHaveProperty("connection_url");
    expect(listResponse.json().destinations[0]).not.toHaveProperty("connection_url_encrypted");
    expect(listDestinations).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });

    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/warehouse-destinations",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Warehouse prod",
        destinationType: "postgres",
        connectionUrl: "postgres://writer:secret@warehouse.internal:5432/analytics",
        datasets: ["events", "traces", "userProfiles", "tenantProfiles"],
        batchSize: 1000,
        enabled: true
      }
    });
    expect(createResponse.statusCode).toBe(201);
    expect(createDestination).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Warehouse prod",
      destinationType: "postgres",
      connectionUrl: "postgres://writer:secret@warehouse.internal:5432/analytics",
      datasets: ["events", "traces", "userProfiles", "tenantProfiles"],
      batchSize: 1000,
      enabled: true
    });
    expect(createResponse.body).not.toContain("secret");
    expect(createResponse.json().destination).not.toHaveProperty("connectionUrl");
    expect(createResponse.json().destination).not.toHaveProperty("connectionUrlEncrypted");
    expect(createResponse.json().destination).not.toHaveProperty("connection_url");
    expect(createResponse.json().destination).not.toHaveProperty("connection_url_encrypted");

    const invalidDatasetResponse = await app.inject({
      method: "POST",
      url: "/admin/warehouse-destinations",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Invalid warehouse",
        destinationType: "postgres",
        connectionUrl: "postgres://writer:secret@warehouse.internal:5432/analytics",
        datasets: ["events", "userAccounts"]
      }
    });
    expect(invalidDatasetResponse.statusCode).toBe(400);

    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/admin/warehouse-destinations/whdst_1",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Warehouse paused",
        enabled: false
      }
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().destination).not.toHaveProperty("connectionUrl");
    expect(patchResponse.json().destination).not.toHaveProperty("connectionUrlEncrypted");
    expect(patchResponse.json().destination).not.toHaveProperty("connection_url");
    expect(patchResponse.json().destination).not.toHaveProperty("connection_url_encrypted");
    expect(updateDestination).toHaveBeenCalledWith({
      id: "whdst_1",
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Warehouse paused",
      connectionUrl: undefined,
      datasets: undefined,
      batchSize: undefined,
      enabled: false
    });

    const runsResponse = await app.inject({
      method: "GET",
      url: "/admin/warehouse-destinations/whdst_1/runs?project_id=prj_1&environment_id=env_1"
    });
    expect(runsResponse.statusCode).toBe(200);
    expect(runsResponse.json()).toEqual({ runs: [warehouseExportRunResponse()] });
    expect(listRuns).toHaveBeenCalledWith({ destinationId: "whdst_1", projectId: "prj_1", environmentId: "env_1", limit: undefined });

    const runResponse = await app.inject({
      method: "POST",
      url: "/admin/warehouse-destinations/whdst_1/runs",
      payload: { projectId: "prj_1", environmentId: "env_1" }
    });
    expect(runResponse.statusCode).toBe(202);
    expect(runResponse.json()).toEqual({ result: { ran: true, skipped: false, exported: 1, failed: 0 } });
    expect(runDestination).toHaveBeenCalledWith({
      destinationId: "whdst_1",
      projectId: "prj_1",
      environmentId: "env_1",
      trigger: "manual"
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/admin/warehouse-destinations/whdst_1?project_id=prj_1&environment_id=env_1"
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(archiveDestination).toHaveBeenCalledWith({ id: "whdst_1", projectId: "prj_1", environmentId: "env_1" });
  });

  it("rejects invalid browser origins", async () => {
    const createOrigin = vi.fn();

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        browserOrigins: {
          list: async () => [],
          create: createOrigin,
          archive: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_1/browser-origins",
      payload: { origin: "not a url" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_browser_origin_request" });
    expect(createOrigin).not.toHaveBeenCalled();
  });

  it("returns 404 when environment creation targets an inactive project scope", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        environments: {
          list: async () => [],
          create: async () => {
            throw new Error("active_project_not_found");
          },
          update: async () => null,
          archive: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_archived/environments",
      payload: { name: "Production" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "project_not_found" });
  });

  it("returns a one-time API key secret with its capability and stores only prefix and hash", async () => {
    const storedApiKeys: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: adminAuth,
      apiKeyPepper: "test-pepper",
      adminResources: {
        apiKeys: {
          list: async () => [],
          create: async (input) => {
            storedApiKeys.push(input);
            return {
              id: "key_1",
              projectId: input.projectId,
              environmentId: input.environmentId,
              name: input.name,
              prefix: input.prefix,
              hash: input.hash,
              capability: input.capability,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              revokedAt: null
            };
          },
          revoke: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_1/api-keys",
      payload: { environmentId: "env_1", name: "Production ingest", capability: "server" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().apiKey.secret).toMatch(/^sh_/);
    expect(response.json().apiKey.prefix).toBe(response.json().apiKey.secret.slice(0, 12));
    expect(storedApiKeys).toHaveLength(1);
    expect(storedApiKeys[0]).toMatchObject({
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Production ingest",
      prefix: response.json().apiKey.prefix,
      capability: "server"
    });
    expect(storedApiKeys[0]).not.toHaveProperty("secret");
    expect(storedApiKeys[0]).toHaveProperty("hash");
    expect(response.json().apiKey.hash).toBeUndefined();
    expect(response.json().apiKey.capability).toBe("server");
  });

  it("requires capability when creating an API key", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      apiKeyPepper: "test-pepper",
      adminResources: {
        apiKeys: {
          list: async () => [],
          create: async () => {
            throw new Error("not used");
          },
          revoke: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_1/api-keys",
      payload: { environmentId: "env_1", name: "missing" }
    });

    expect(response.statusCode).toBe(400);
  });

  it("accepts a 120-character API key name and rejects 121 characters", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      apiKeyPepper: "test-pepper",
      adminResources: {
        apiKeys: {
          list: async () => [],
          create: async (input) => ({
            id: "key_1",
            projectId: input.projectId,
            environmentId: input.environmentId,
            name: input.name,
            prefix: input.prefix,
            hash: input.hash,
            capability: input.capability,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            revokedAt: null
          }),
          revoke: async () => undefined
        }
      }
    });

    const accepted = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_1/api-keys",
      payload: { environmentId: "env_1", name: "a".repeat(120), capability: "server" }
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_1/api-keys",
      payload: { environmentId: "env_1", name: "a".repeat(121), capability: "server" }
    });

    expect(accepted.statusCode).toBe(201);
    expect(rejected.statusCode).toBe(400);
  });

  it("renames an API key without exposing its hash", async () => {
    const updates: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        apiKeys: {
          list: async () => [],
          create: async () => {
            throw new Error("not used");
          },
          update: async (id, input) => {
            updates.push({ id, input });
            return {
              id,
              projectId: "prj_1",
              environmentId: "env_1",
              name: input.name ?? "Production ingest",
              prefix: "sh_live_1234",
              hash: "stored-hash",
              capability: "browser",
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              revokedAt: null
            };
          },
          revoke: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/api-keys/key_1",
      payload: { name: "Browser production" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().apiKey).toMatchObject({ id: "key_1", name: "Browser production" });
    expect(response.json().apiKey.hash).toBeUndefined();
    expect(updates).toEqual([{ id: "key_1", input: { name: "Browser production" } }]);
  });

  it("returns 404 when API key creation targets an inactive project or environment scope", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      apiKeyPepper: "test-pepper",
      adminResources: {
        apiKeys: {
          list: async () => [],
          create: async () => {
            throw new Error("active_api_key_scope_not_found");
          },
          revoke: async () => undefined
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/projects/prj_archived/api-keys",
      payload: { environmentId: "env_archived", name: "Production ingest", capability: "browser" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "api_key_scope_not_found" });
  });

  it("soft archives a project", async () => {
    const archivedProjectIds: string[] = [];

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        projects: {
          list: async () => [],
          get: async () => null,
          create: async () => {
            throw new Error("not used");
          },
          update: async () => null,
          archive: async (id) => {
            archivedProjectIds.push(id);
          }
        }
      }
    });

    const response = await app.inject({ method: "DELETE", url: "/admin/projects/prj_1" });

    expect(response.statusCode).toBe(204);
    expect(archivedProjectIds).toEqual(["prj_1"]);
  });

  it("revokes an API key", async () => {
    const revokedApiKeyIds: string[] = [];

    app = await buildApp({
      readiness,
      auth: adminAuth,
      adminResources: {
        apiKeys: {
          list: async () => [],
          create: async () => {
            throw new Error("not used");
          },
          revoke: async (id) => {
            revokedApiKeyIds.push(id);
          }
        }
      }
    });

    const response = await app.inject({ method: "DELETE", url: "/admin/api-keys/key_1" });

    expect(response.statusCode).toBe(204);
    expect(revokedApiKeyIds).toEqual(["key_1"]);
  });

  it("creates source map upload tokens for admins and returns the secret once", async () => {
    const createToken = vi.fn().mockResolvedValue({
      id: "smtok_1",
      projectId: "prj_1",
      environmentId: "env_1",
      name: "GitHub Actions",
      prefix: "shsmap_test",
      hash: "hash",
      createdAt: new Date("2026-05-11T12:00:00.000Z"),
      lastUsedAt: null,
      revokedAt: null
    });
    const hashApiKeySecret = vi.fn().mockResolvedValue("hash");

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMapUploadTokens: {
        create: createToken,
        list: vi.fn(),
        revoke: vi.fn()
      },
      createSourceMapUploadToken: () => ({ secret: "shsmap_test_secret", prefix: "shsmap_test" }),
      hashApiKeySecret
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-map-upload-tokens",
      payload: { projectId: "prj_1", environmentId: "env_1", name: "GitHub Actions" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().token).toMatchObject({
      id: "smtok_1",
      projectId: "prj_1",
      environmentId: "env_1",
      name: "GitHub Actions",
      prefix: "shsmap_test",
      secret: "shsmap_test_secret"
    });
    expect(response.json().token.hash).toBeUndefined();
    expect(hashApiKeySecret).toHaveBeenCalledWith("shsmap_test_secret");
    expect(createToken).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      name: "GitHub Actions",
      prefix: "shsmap_test",
      hash: "hash"
    });
  });

  it("lists source map upload tokens without secrets or hashes", async () => {
    const listTokens = vi.fn().mockResolvedValue([
      {
        id: "smtok_1",
        projectId: "prj_1",
        environmentId: "env_1",
        name: "GitHub Actions",
        prefix: "shsmap_test",
        hash: "hash",
        createdAt: new Date("2026-05-11T12:00:00.000Z"),
        lastUsedAt: null,
        revokedAt: null
      }
    ]);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMapUploadTokens: {
        list: listTokens,
        create: vi.fn(),
        revoke: vi.fn()
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/source-map-upload-tokens?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().tokens).toHaveLength(1);
    expect(response.json().tokens[0]).toMatchObject({
      id: "smtok_1",
      projectId: "prj_1",
      environmentId: "env_1",
      name: "GitHub Actions",
      prefix: "shsmap_test"
    });
    expect(response.json().tokens[0].secret).toBeUndefined();
    expect(response.json().tokens[0].hash).toBeUndefined();
    expect(listTokens).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });
  });

  it("renames source map upload tokens without exposing secrets or hashes", async () => {
    const updateToken = vi.fn().mockResolvedValue({
      id: "smtok_1",
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Production sourcemaps",
      prefix: "shsmap_test",
      hash: "hash",
      createdAt: new Date("2026-05-11T12:00:00.000Z"),
      lastUsedAt: null,
      revokedAt: null
    });

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMapUploadTokens: {
        list: vi.fn(),
        create: vi.fn(),
        update: updateToken,
        revoke: vi.fn()
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/source-map-upload-tokens/smtok_1?project_id=prj_1&environment_id=env_1",
      payload: { name: "Production sourcemaps" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().token).toMatchObject({
      id: "smtok_1",
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Production sourcemaps",
      prefix: "shsmap_test"
    });
    expect(response.json().token.secret).toBeUndefined();
    expect(response.json().token.hash).toBeUndefined();
    expect(updateToken).toHaveBeenCalledWith({
      id: "smtok_1",
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Production sourcemaps"
    });
  });

  it("revokes source map upload tokens for admins", async () => {
    const revoke = vi.fn();

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMapUploadTokens: {
        list: vi.fn(),
        create: vi.fn(),
        revoke
      }
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/admin/source-map-upload-tokens/smtok_1?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(204);
    expect(revoke).toHaveBeenCalledWith({ id: "smtok_1", projectId: "prj_1", environmentId: "env_1" });
  });

  it("rejects source map upload tokens requests for non-admin users", async () => {
    const createToken = vi.fn();

    app = await buildApp({
      readiness,
      auth: userAuth,
      sourceMapUploadTokens: {
        list: vi.fn(),
        create: createToken,
        revoke: vi.fn()
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-map-upload-tokens",
      payload: { projectId: "prj_1", environmentId: "env_1", name: "GitHub Actions" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "admin_required" });
    expect(createToken).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid source map upload tokens request shape", async () => {
    const createToken = vi.fn();

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMapUploadTokens: {
        list: vi.fn(),
        create: createToken,
        revoke: vi.fn()
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-map-upload-tokens",
      payload: { projectId: "prj_1", environmentId: "", name: "" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_source_map_upload_token_request" });
    expect(createToken).not.toHaveBeenCalled();
  });

  it("returns 501 when the source map upload tokens repository is unavailable", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/source-map-upload-tokens?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "source_map_upload_tokens_repository_unavailable" });
  });

  it("returns 501 when source map upload token hashing is unavailable", async () => {
    const createToken = vi.fn();

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMapUploadTokens: {
        list: vi.fn(),
        create: createToken,
        revoke: vi.fn()
      },
      createSourceMapUploadToken: () => ({ secret: "shsmap_test_secret", prefix: "shsmap_test" })
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-map-upload-tokens",
      payload: { projectId: "prj_1", environmentId: "env_1", name: "GitHub Actions" }
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "source_map_upload_token_hashing_unavailable" });
    expect(createToken).not.toHaveBeenCalled();
  });

  it("returns 404 when source map upload tokens creation targets an inactive scope", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      hashApiKeySecret: async () => "hash",
      sourceMapUploadTokens: {
        list: vi.fn(),
        create: async () => {
          throw new Error("active_source_map_upload_token_scope_not_found");
        },
        revoke: vi.fn()
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-map-upload-tokens",
      payload: { projectId: "prj_archived", environmentId: "env_archived", name: "GitHub Actions" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "source_map_upload_token_scope_not_found" });
  });

  it("lists source map artifacts for admins", async () => {
    const listCalls: unknown[] = [];
    const artifact = sourceMapArtifact();

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        list: async (filters) => {
          listCalls.push(filters);
          return { artifacts: [artifact], cursor: "cursor_next" };
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/source-maps?project_id=prj_1&environment_id=env_1&release=web%401.0.0&limit=25&cursor=cursor_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ artifacts: [artifact], cursor: "cursor_next" });
    expect(listCalls).toEqual([
      { projectId: "prj_1", environmentId: "env_1", release: "web@1.0.0", limit: 25, cursor: "cursor_1" }
    ]);
  });

  it("returns 400 for invalid source map artifact cursors", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        list: async () => {
          throw new Error("invalid_cursor");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/source-maps?project_id=prj_1&environment_id=env_1&cursor=bad"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_cursor" });
  });

  it("rejects source map uploads for non-admin users", async () => {
    const uploadCalls: unknown[] = [];
    const { headers, payload } = createMultipartPayload([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "2026.05.10" },
      { name: "minified_file", value: "app.min.js" },
      {
        name: "file",
        filename: "app.min.js.map",
        contentType: "application/json",
        content: JSON.stringify({ version: 3, file: "app.min.js", sources: [], names: [], mappings: "" })
      }
    ]);

    app = await buildApp({
      readiness,
      auth: userAuth,
      sourceMaps: {
        uploadMap: async (input) => {
          uploadCalls.push(input);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-maps",
      headers,
      payload
    });

    expect(response.statusCode).toBe(403);
    expect(uploadCalls).toEqual([]);
  });

  it("deletes source map artifacts for admins", async () => {
    const removeCalls: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        remove: async (input) => {
          removeCalls.push(input);
        }
      }
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/admin/source-maps/smap_1?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(204);
    expect(removeCalls).toEqual([{ id: "smap_1", projectId: "prj_1", environmentId: "env_1" }]);
  });

  it("uploads a single source map for admins", async () => {
    const uploadCalls: unknown[] = [];
    const uploadedArtifacts = [sourceMapArtifact()];
    const sourceMap = JSON.stringify({ version: 3, file: "app.min.js", sources: [], names: [], mappings: "" });
    const { headers, payload } = createMultipartPayload([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "2026.05.10" },
      { name: "minified_file", value: "app.min.js" },
      { name: "file", filename: "app.min.js.map", contentType: "application/json", content: sourceMap }
    ]);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        uploadMap: async (input) => {
          uploadCalls.push(input);
          return uploadedArtifacts;
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-maps",
      headers,
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ artifacts: uploadedArtifacts });
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0]).toMatchObject({
      projectId: "prj_1",
      environmentId: "env_1",
      release: "2026.05.10",
      minifiedFile: "app.min.js",
      uploadedByUserId: "usr_1",
      originalFilename: "app.min.js.map",
      contentType: "application/json"
    });
    expect((uploadCalls[0] as { content: Buffer }).content).toEqual(Buffer.from(sourceMap));
  });

  it("returns 404 when admin source map uploads target an inactive scope", async () => {
    const sourceMap = JSON.stringify({ version: 3, file: "app.min.js", sources: [], names: [], mappings: "" });
    const { headers, payload } = createMultipartPayload([
      { name: "project_id", value: "prj_archived" },
      { name: "environment_id", value: "env_archived" },
      { name: "release", value: "2026.05.10" },
      { name: "minified_file", value: "app.min.js" },
      { name: "file", filename: "app.min.js.map", contentType: "application/json", content: sourceMap }
    ]);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        uploadMap: async () => {
          throw new Error("active_source_map_scope_not_found");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-maps",
      headers,
      payload
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "invalid_source_map_request" });
  });

  it("returns 400 when source map upload content is invalid", async () => {
    const { headers, payload } = createMultipartPayload([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "2026.05.10" },
      { name: "minified_file", value: "app.min.js" },
      { name: "file", filename: "app.min.js.map", contentType: "application/json", content: "not-json" }
    ]);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        uploadMap: async () => {
          throw new Error("invalid_source_map");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-maps",
      headers,
      payload
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_source_map_request" });
  });

  it("rejects uploads with multiple file parts without calling source map upload", async () => {
    const uploadCalls: unknown[] = [];
    const sourceMap = JSON.stringify({ version: 3, file: "app.min.js", sources: [], names: [], mappings: "" });
    const { headers, payload } = createMultipartPayload([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "2026.05.10" },
      { name: "minified_file", value: "app.min.js" },
      { name: "file", filename: "app.min.js.map", contentType: "application/json", content: sourceMap },
      { name: "bundle", filename: "source-maps.zip", contentType: "application/zip", content: Buffer.from("zip") }
    ]);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        uploadMap: async (input) => {
          uploadCalls.push(input);
          return [];
        },
        uploadBundle: async (input) => {
          uploadCalls.push(input);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-maps",
      headers,
      payload
    });

    expect([400, 413]).toContain(response.statusCode);
    expect(uploadCalls).toEqual([]);
  });

  it("rejects source map uploads with too many fields without calling upload", async () => {
    const uploadCalls: unknown[] = [];
    const sourceMap = JSON.stringify({ version: 3, file: "app.min.js", sources: [], names: [], mappings: "" });
    const { headers, payload } = createMultipartPayload([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "2026.05.10" },
      { name: "minified_file", value: "app.min.js" },
      { name: "extra", value: "client-controlled" },
      { name: "file", filename: "app.min.js.map", contentType: "application/json", content: sourceMap }
    ]);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        uploadMap: async (input) => {
          uploadCalls.push(input);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-maps",
      headers,
      payload
    });

    expect([400, 413]).toContain(response.statusCode);
    expect(uploadCalls).toEqual([]);
  });

  it("uploads a source map bundle for admins", async () => {
    const uploadCalls: unknown[] = [];
    const uploadedArtifacts = [sourceMapArtifact()];
    const bundle = Buffer.from("zip-content");
    const { headers, payload } = createMultipartPayload([
      { name: "project_id", value: "prj_1" },
      { name: "environment_id", value: "env_1" },
      { name: "release", value: "2026.05.10" },
      { name: "bundle", filename: "source-maps.zip", contentType: "application/zip", content: bundle }
    ]);

    app = await buildApp({
      readiness,
      auth: adminAuth,
      sourceMaps: {
        uploadBundle: async (input) => {
          uploadCalls.push(input);
          return uploadedArtifacts;
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/source-maps",
      headers,
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ artifacts: uploadedArtifacts });
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0]).toMatchObject({
      projectId: "prj_1",
      environmentId: "env_1",
      release: "2026.05.10",
      uploadedByUserId: "usr_1",
      originalFilename: "source-maps.zip",
      contentType: "application/zip"
    });
    expect((uploadCalls[0] as { content: Buffer }).content).toEqual(bundle);
  });

  it("cleans up bundle files when artifact creation fails after a partial bundle upload", async () => {
    vi.resetModules();

    const createdArtifactInputs: Array<{ storagePath: string }> = [];
    const createSourceMapArtifact = vi.fn(async (_db, input: { storagePath: string }) => {
      createdArtifactInputs.push(input);
      if (createdArtifactInputs.length === 2) {
        throw new Error("db_down");
      }

      return sourceMapArtifact({ storagePath: input.storagePath });
    });

    vi.doMock("@sigmon/db/repositories/source-maps.js", () => ({
      createSourceMapArtifact,
      deleteSourceMapArtifact: vi.fn(),
      getSourceMapArtifact: vi.fn()
    }));

    const { uploadSourceMapBundle } = await import("../src/source-maps/storage.js");
    const localDir = await mkdtemp(path.join(tmpdir(), "sigmon-source-maps-"));
    const db = {
      transaction: () => ({
        execute: async <T>(callback: (trx: unknown) => Promise<T>) => callback({})
      })
    };
    const firstMap = Buffer.from(
      JSON.stringify({ version: 3, file: "app-one.min.js", sources: [], names: [], mappings: "" })
    );
    const secondMap = Buffer.from(
      JSON.stringify({ version: 3, file: "app-two.min.js", sources: [], names: [], mappings: "" })
    );

    try {
      await expect(
        uploadSourceMapBundle({
          db: db as never,
          localDir,
          input: {
            projectId: "prj_1",
            environmentId: "env_1",
            release: "2026.05.10",
            uploadedByUserId: "usr_1",
            originalFilename: "source-maps.zip",
            contentType: "application/zip",
            content: Buffer.from(
              zipSync({
                "app-one.min.js.map": firstMap,
                "app-two.min.js.map": secondMap
              })
            )
          }
        })
      ).rejects.toThrow("db_down");

      expect(createSourceMapArtifact).toHaveBeenCalledTimes(2);
      expect(createdArtifactInputs).toHaveLength(2);
      await Promise.all(
        createdArtifactInputs.map((input) => expect(access(input.storagePath)).rejects.toThrow())
      );
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it("normalizes a caller-supplied minified file path to the basename the resolver looks up", async () => {
    vi.resetModules();

    const createdArtifactInputs: Array<Record<string, unknown>> = [];
    const createSourceMapArtifact = vi.fn(async (_db, input: Record<string, unknown>) => {
      createdArtifactInputs.push(input);
      return sourceMapArtifact({ storagePath: input.storagePath as string });
    });

    vi.doMock("@sigmon/db/repositories/source-maps.js", () => ({
      createSourceMapArtifact,
      deleteSourceMapArtifact: vi.fn(),
      getSourceMapArtifact: vi.fn()
    }));

    const { uploadSingleSourceMap } = await import("../src/source-maps/storage.js");
    const localDir = await mkdtemp(path.join(tmpdir(), "sigmon-source-maps-"));
    const db = {
      transaction: () => ({
        execute: async <T>(callback: (trx: unknown) => Promise<T>) => callback({})
      })
    };

    try {
      await uploadSingleSourceMap({
        db: db as never,
        localDir,
        input: {
          projectId: "prj_1",
          environmentId: "env_1",
          release: "2026.05.10",
          // What `pnpm source-maps:upload --minified-file assets/app.min.js`
          // actually sends. Stack frames arrive normalized to the basename,
          // so storing the composed path means the lookup never matches.
          minifiedFile: "assets/app.min.js",
          uploadedByTokenId: "smtok_1",
          originalFilename: "app.min.js.map",
          contentType: "application/json",
          content: Buffer.from(
            JSON.stringify({ version: 3, file: "app.min.js", sources: [], names: [], mappings: "" })
          )
        }
      });

      expect(createdArtifactInputs[0]).toMatchObject({ minifiedFile: "app.min.js" });
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it("passes token attribution to source map artifact creation", async () => {
    vi.resetModules();

    const createdArtifactInputs: Array<Record<string, unknown>> = [];
    const createSourceMapArtifact = vi.fn(async (_db, input: Record<string, unknown>) => {
      createdArtifactInputs.push(input);
      return sourceMapArtifact({
        storagePath: input.storagePath,
        uploadedByUserId: input.uploadedByUserId ?? null,
        uploadedByTokenId: input.uploadedByTokenId ?? null
      });
    });

    vi.doMock("@sigmon/db/repositories/source-maps.js", () => ({
      createSourceMapArtifact,
      deleteSourceMapArtifact: vi.fn(),
      getSourceMapArtifact: vi.fn()
    }));

    const { uploadSingleSourceMap, uploadSourceMapBundle } = await import("../src/source-maps/storage.js");
    const localDir = await mkdtemp(path.join(tmpdir(), "sigmon-source-maps-"));
    const db = {
      transaction: () => ({
        execute: async <T>(callback: (trx: unknown) => Promise<T>) => callback({})
      })
    };
    const singleMap = Buffer.from(
      JSON.stringify({ version: 3, file: "app.min.js", sources: [], names: [], mappings: "" })
    );
    const bundledMap = Buffer.from(
      JSON.stringify({ version: 3, file: "bundle.min.js", sources: [], names: [], mappings: "" })
    );

    try {
      await uploadSingleSourceMap({
        db: db as never,
        localDir,
        input: {
          projectId: "prj_1",
          environmentId: "env_1",
          release: "2026.05.10",
          minifiedFile: "app.min.js",
          uploadedByTokenId: "smtok_1",
          originalFilename: "app.min.js.map",
          contentType: "application/json",
          content: singleMap
        }
      });

      await uploadSourceMapBundle({
        db: db as never,
        localDir,
        input: {
          projectId: "prj_1",
          environmentId: "env_1",
          release: "2026.05.10",
          uploadedByTokenId: "smtok_1",
          originalFilename: "source-maps.zip",
          contentType: "application/zip",
          content: Buffer.from(zipSync({ "bundle.min.js.map": bundledMap }))
        }
      });

      expect(createSourceMapArtifact).toHaveBeenCalledTimes(2);
      expect(createdArtifactInputs).toHaveLength(2);
      expect(createdArtifactInputs[0]).toMatchObject({
        minifiedFile: "app.min.js",
        uploadedByTokenId: "smtok_1"
      });
      expect(createdArtifactInputs[0]).not.toHaveProperty("uploadedByUserId");
      expect(createdArtifactInputs[1]).toMatchObject({
        minifiedFile: "bundle.min.js",
        uploadedByTokenId: "smtok_1"
      });
      expect(createdArtifactInputs[1]).not.toHaveProperty("uploadedByUserId");
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });
});

describe("read token administration", () => {
  const anonymousAuth = {
    login: async () => null,
    findSessionUser: async () => null
  };

  function fakeReadTokenRepository() {
    const tokens = [
      {
        id: "rdtok_1",
        projectId: "prj_1",
        environmentId: "env_1",
        name: "mcp",
        prefix: "shread_testsec",
        hash: "hash",
        createdAt: new Date("2026-05-11T12:00:00.000Z"),
        lastUsedAt: null as Date | null,
        revokedAt: null as Date | null
      }
    ];

    return {
      list: async ({ projectId, environmentId }: { projectId: string; environmentId: string }) =>
        tokens.filter((token) => token.projectId === projectId && token.environmentId === environmentId),
      create: async (input: {
        projectId: string;
        environmentId: string;
        name: string;
        prefix: string;
        hash: string;
      }) => {
        const token = {
          id: `rdtok_${tokens.length + 1}`,
          ...input,
          createdAt: new Date("2026-05-11T12:00:00.000Z"),
          lastUsedAt: null,
          revokedAt: null
        };
        tokens.push(token);
        return token;
      },
      update: async ({
        id,
        projectId,
        environmentId,
        name
      }: {
        id: string;
        projectId: string;
        environmentId: string;
        name?: string;
      }) => {
        const token = tokens.find((t) => t.id === id && t.projectId === projectId && t.environmentId === environmentId);
        if (!token) {
          return null;
        }
        if (name !== undefined) {
          token.name = name;
        }
        return token;
      },
      revoke: async ({
        id,
        projectId,
        environmentId
      }: {
        id: string;
        projectId: string;
        environmentId: string;
      }) => {
        const token = tokens.find((t) => t.id === id && t.projectId === projectId && t.environmentId === environmentId);
        if (token) {
          token.revokedAt = new Date("2026-05-11T12:05:00.000Z");
        }
      }
    };
  }

  it("returns the secret exactly once, on create", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      readTokens: fakeReadTokenRepository(),
      createReadToken: () => ({ secret: "shread_testsecret", prefix: "shread_testsec" }),
      apiKeyPepper: "pepper"
    });

    const created = await app.inject({
      method: "POST",
      url: "/admin/read-tokens",
      payload: { projectId: "prj_1", environmentId: "env_1", name: "mcp" }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().token.secret).toBe("shread_testsecret");

    const listed = await app.inject({
      method: "GET",
      url: "/admin/read-tokens?project_id=prj_1&environment_id=env_1"
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().tokens[0]).not.toHaveProperty("secret");
    expect(listed.json().tokens[0]).not.toHaveProperty("hash");
  });

  it("rejects an anonymous caller", async () => {
    app = await buildApp({
      readiness,
      auth: anonymousAuth,
      readTokens: fakeReadTokenRepository()
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/read-tokens?project_id=prj_1&environment_id=env_1"
    });
    expect(response.statusCode).toBe(401);
  });

  it("answers 404 when the scope is archived or missing", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      readTokens: {
        ...fakeReadTokenRepository(),
        create: async () => {
          throw new Error("active_read_token_scope_not_found");
        }
      },
      createReadToken: () => ({ secret: "shread_testsecret", prefix: "shread_testsec" }),
      apiKeyPepper: "pepper"
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/read-tokens",
      payload: { projectId: "prj_gone", environmentId: "env_gone", name: "mcp" }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("read_token_scope_not_found");
  });

  it("renames and revokes within the scope", async () => {
    const repository = fakeReadTokenRepository();
    app = await buildApp({
      readiness,
      auth: adminAuth,
      readTokens: repository,
      apiKeyPepper: "pepper"
    });

    const renamed = await app.inject({
      method: "PATCH",
      url: "/admin/read-tokens/rdtok_1?project_id=prj_1&environment_id=env_1",
      payload: { name: "claude-desktop" }
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().token.name).toBe("claude-desktop");

    const revoked = await app.inject({
      method: "DELETE",
      url: "/admin/read-tokens/rdtok_1?project_id=prj_1&environment_id=env_1"
    });
    expect(revoked.statusCode).toBe(204);
  });
});
