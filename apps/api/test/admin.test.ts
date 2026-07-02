import type { FastifyInstance } from "fastify";
import { access, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSegmentPreview, AnalyticsSegmentRecord } from "../../../packages/db/src/repositories/analytics-segments.js";
import type { AnalyticsDashboardRecord } from "../../../packages/db/src/repositories/analytics-dashboards.js";
import type { ExperimentRecord } from "../../../packages/db/src/repositories/experiments.js";
import { buildApp } from "../src/app.js";

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

  it("rejects dashboards with fewer than three widgets", async () => {
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
        name: "Too small",
        widgets: [{ type: "metric.events", title: "Events", width: "half", options: {} }]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_analytics_dashboard_request" });
    expect(create).not.toHaveBeenCalled();
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

  it("returns a one-time API key secret and stores only prefix and hash", async () => {
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
      payload: { environmentId: "env_1", name: "Production ingest" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().apiKey.secret).toMatch(/^sh_/);
    expect(response.json().apiKey.prefix).toBe(response.json().apiKey.secret.slice(0, 12));
    expect(storedApiKeys).toHaveLength(1);
    expect(storedApiKeys[0]).toMatchObject({
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Production ingest",
      prefix: response.json().apiKey.prefix
    });
    expect(storedApiKeys[0]).not.toHaveProperty("secret");
    expect(storedApiKeys[0]).toHaveProperty("hash");
    expect(response.json().apiKey.hash).toBeUndefined();
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
      payload: { environmentId: "env_archived", name: "Production ingest" }
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
