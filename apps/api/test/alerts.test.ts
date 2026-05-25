import type { FastifyInstance } from "fastify";
import type { AlertEventRecord, AlertRuleRecord, NotificationChannelRecord } from "@sigmon/db/repositories/alerts.js";
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

const unauthenticatedAuth = {
  login: async () => null,
  findSessionUser: async () => null
};

function notificationChannel(overrides: Partial<NotificationChannelRecord> = {}): NotificationChannelRecord {
  const channel: NotificationChannelRecord = {
    id: "chn_1",
    name: "Ops",
    type: "webhook",
    url: "https://hooks.example.com/sigmon",
    emailRecipients: [],
    secretHeaderName: "X-SignalMonitor-Secret",
    secretHeaderValue: "secret",
    hasSecret: true,
    enabled: true,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null
  };

  return { ...channel, ...overrides } as NotificationChannelRecord;
}

function alertRule(overrides: Partial<AlertRuleRecord> = {}): AlertRuleRecord {
  return {
    id: "rule_1",
    projectId: "prj_1",
    environmentId: "env_1",
    notificationChannelId: "chn_1",
    name: "Critical errors",
    type: "critical_errors",
    severity: "critical",
    windowMinutes: 5,
    threshold: "1",
    cooldownMinutes: 10,
    routePattern: null,
    minimumSampleSize: 1,
    enabled: true,
    lastEvaluatedAt: null,
    lastTriggeredAt: null,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    ...overrides
  } as AlertRuleRecord;
}

function alertEvent(overrides: Partial<AlertEventRecord> = {}): AlertEventRecord {
  return {
    id: "evt_1",
    ruleId: "rule_1",
    monitorId: null,
    projectId: "prj_1",
    environmentId: "env_1",
    status: "triggered",
    severity: "critical",
    triggeredAt: createdAt,
    windowStart: new Date("2026-05-06T11:55:00.000Z"),
    windowEnd: createdAt,
    observedValue: "2",
    threshold: "1",
    message: "Critical errors threshold reached",
    metadata: { count: 2 },
    createdAt,
    latestDeliveryStatus: "success",
    ...overrides
  };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("alert history routes", () => {
  it("requires authentication for alert event history", async () => {
    app = await buildApp({
      readiness,
      auth: unauthenticatedAuth,
      alerts: {
        listAlertEvents: async () => []
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/alerts/events?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns 400 for invalid alert event history queries", async () => {
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: {
        listAlertEvents: async () => []
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/alerts/events?project_id=prj_1&environment_id=env_1&limit=0"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_alert_query" });
  });

  it("returns 400 when alert event history limit exceeds 100", async () => {
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: {
        listAlertEvents: async () => []
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/alerts/events?project_id=prj_1&environment_id=env_1&limit=101"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_alert_query" });
  });

  it("returns 501 when the alert history repository is unavailable", async () => {
    app = await buildApp({ readiness, auth: userAuth });

    const response = await app.inject({
      method: "GET",
      url: "/alerts/events?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "alerts_repository_unavailable" });
  });

  it("returns 503 when the alert history repository throws", async () => {
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: {
        listAlertEvents: async () => {
          throw new Error("db down");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/alerts/events?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "alerts_unavailable" });
  });

  it("returns alert history for authenticated users", async () => {
    const receivedFilters: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: {
        listAlertEvents: async (filters) => {
          receivedFilters.push(filters);
          return [alertEvent()];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/alerts/events?project_id=prj_1&environment_id=env_1&limit=25"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({ id: "evt_1", latestDeliveryStatus: "success" });
    expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1", limit: 25 }]);
  });

  it("returns a single alert event by id", async () => {
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: {
        getAlertEvent: async (id) => alertEvent({ id })
      }
    });

    const response = await app.inject({ method: "GET", url: "/alerts/events/evt_1" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ id: "evt_1", ruleId: "rule_1" });
  });

  it("returns 404 when a single alert event is missing", async () => {
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: {
        getAlertEvent: async () => null
      }
    });

    const response = await app.inject({ method: "GET", url: "/alerts/events/evt_missing" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "alert_event_not_found" });
  });
});

describe("admin alert routes", () => {
  it("requires admin access to create notification channels", async () => {
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: {
        createNotificationChannel: async () => notificationChannel()
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/notification-channels",
      payload: { name: "Ops", type: "webhook", url: "https://hooks.example.com/sigmon", enabled: true }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "admin_required" });
  });

  it("returns 501 when notification channel dependencies are unavailable", async () => {
    app = await buildApp({ readiness, auth: adminAuth });

    const response = await app.inject({ method: "GET", url: "/admin/notification-channels" });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "notification_channels_repository_unavailable" });
  });

  it("redacts webhook secrets in notification channel responses", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        createNotificationChannel: async () => notificationChannel()
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/notification-channels",
      payload: {
        name: "Ops",
        type: "webhook",
        url: "https://hooks.example.com/sigmon",
        secretHeaderName: "X-SignalMonitor-Secret",
        secretHeaderValue: "secret",
        enabled: true
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().channel.hasSecret).toBe(true);
    expect(response.json().channel.secretHeaderValue).toBeUndefined();
  });

  it("returns 503 without leaking repository errors when creating notification channels fails", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        createNotificationChannel: async () => {
          throw new Error("database password exposed");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/notification-channels",
      payload: { name: "Ops", type: "webhook", url: "https://hooks.example.com/sigmon", enabled: true }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "notification_channels_unavailable" });
    expect(response.body).not.toContain("database password exposed");
  });

  it("rejects unsafe production webhook URLs", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      nodeEnv: "production",
      alerts: {
        createNotificationChannel: async () => notificationChannel()
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/notification-channels",
      payload: { name: "Ops", type: "webhook", url: "http://127.0.0.1/hook", enabled: true }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_notification_channel_request" });
  });

  it("rejects secret header names outside the allowed prefixes", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        createNotificationChannel: async () => notificationChannel()
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/notification-channels",
      payload: {
        name: "Ops",
        type: "webhook",
        url: "https://hooks.example.com/sigmon",
        secretHeaderName: "Authorization",
        secretHeaderValue: "secret",
        enabled: true
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_notification_channel_request" });
  });

  it("rejects prefixed secret header names with non-alphanumeric token characters", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        createNotificationChannel: async () => notificationChannel()
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/notification-channels",
      payload: {
        name: "Ops",
        type: "webhook",
        url: "https://hooks.example.com/sigmon",
        secretHeaderName: "X-SignalMonitor_Secret",
        secretHeaderValue: "secret",
        enabled: true
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_notification_channel_request" });
  });

  it("updates and redacts notification channels", async () => {
    const updates: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        updateNotificationChannel: async (id, input) => {
          updates.push({ id, input });
          return notificationChannel({ id, name: input.name, secretHeaderValue: "new-secret" });
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/notification-channels/chn_1",
      payload: { name: "Primary Ops" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().channel).toMatchObject({ id: "chn_1", name: "Primary Ops", hasSecret: true });
    expect(response.json().channel.secretHeaderValue).toBeUndefined();
    expect(updates).toEqual([{ id: "chn_1", input: { name: "Primary Ops" } }]);
  });

  it("rejects notification channel updates that set a secret value while clearing the header name", async () => {
    const updates: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        updateNotificationChannel: async (id, input) => {
          updates.push({ id, input });
          return notificationChannel({ id, secretHeaderName: input.secretHeaderName, secretHeaderValue: "secret" });
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/notification-channels/chn_1",
      payload: { secretHeaderName: null, secretHeaderValue: "secret" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_notification_channel_request" });
    expect(updates).toEqual([]);
  });

  it("rejects notification channel updates that set only a secret value", async () => {
    const updates: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        updateNotificationChannel: async (id, input) => {
          updates.push({ id, input });
          return notificationChannel({ id, secretHeaderValue: "new-secret" });
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/notification-channels/chn_1",
      payload: { secretHeaderValue: "new-secret" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_notification_channel_request" });
    expect(updates).toEqual([]);
  });

  it("clears the secret value when clearing a notification channel secret header name", async () => {
    const updates: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        updateNotificationChannel: async (id, input) => {
          updates.push({ id, input });
          return notificationChannel({
            id,
            secretHeaderName: input.secretHeaderName,
            secretHeaderValue: input.secretHeaderValue,
            hasSecret: false
          });
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/notification-channels/chn_1",
      payload: { secretHeaderName: null }
    });

    expect(response.statusCode).toBe(200);
    expect(updates).toEqual([{ id: "chn_1", input: { secretHeaderName: null, secretHeaderValue: null } }]);
  });

  it("returns 404 when updating a missing notification channel", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        updateNotificationChannel: async () => null
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/notification-channels/chn_missing",
      payload: { name: "Primary Ops" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "notification_channel_not_found" });
  });

  it("archives notification channels", async () => {
    const archivedIds: string[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        archiveNotificationChannel: async (id) => {
          archivedIds.push(id);
        }
      }
    });

    const response = await app.inject({ method: "DELETE", url: "/admin/notification-channels/chn_1" });

    expect(response.statusCode).toBe(204);
    expect(archivedIds).toEqual(["chn_1"]);
  });

  it("lists alert rules with optional filters", async () => {
    const receivedFilters: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        listAlertRules: async (filters) => {
          receivedFilters.push(filters);
          return [alertRule()];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/alert-rules?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().rules[0]).toMatchObject({ id: "rule_1", projectId: "prj_1" });
    expect(receivedFilters).toEqual([{ projectId: "prj_1", environmentId: "env_1" }]);
  });

  it("creates alert rules", async () => {
    const createdRules: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        getNotificationChannel: async () => notificationChannel(),
        createAlertRule: async (input) => {
          createdRules.push(input);
          return alertRule(input);
        }
      }
    });

    const payload = {
      projectId: "prj_1",
      environmentId: "env_1",
      notificationChannelId: "chn_1",
      name: "Critical errors",
      type: "critical_errors",
      severity: "critical",
      windowMinutes: 5,
      threshold: "1.5",
      cooldownMinutes: 10,
      enabled: true
    };

    const response = await app.inject({ method: "POST", url: "/admin/alert-rules", payload });

    expect(response.statusCode).toBe(201);
    expect(response.json().rule).toMatchObject({ id: "rule_1", threshold: "1.5" });
    expect(createdRules).toEqual([{ ...payload, minimumSampleSize: 1 }]);
  });

  it("creates error rate alert rules with route pattern and minimum sample size", async () => {
    const createdRules: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        createAlertRule: async (input) => {
          createdRules.push(input);
          return alertRule(input);
        }
      }
    });

    const payload = {
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Checkout error rate",
      type: "error_rate",
      severity: "critical",
      threshold: "5",
      windowMinutes: 10,
      cooldownMinutes: 30,
      routePattern: "GET /checkout",
      minimumSampleSize: 20
    };

    const response = await app.inject({ method: "POST", url: "/admin/alert-rules", payload });

    expect(response.statusCode).toBe(201);
    expect(response.json().rule).toMatchObject({
      id: "rule_1",
      type: "error_rate",
      routePattern: "GET /checkout",
      minimumSampleSize: 20
    });
    expect(createdRules).toEqual([{ ...payload, enabled: true }]);
  });

  it("updates alert rule route pattern and minimum sample size", async () => {
    const updatedRules: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        updateAlertRule: async (id, input) => {
          updatedRules.push({ id, input });
          return alertRule({ id, ...input });
        }
      }
    });

    const payload = {
      type: "error_rate",
      routePattern: "GET /checkout",
      minimumSampleSize: 20
    };

    const response = await app.inject({ method: "PATCH", url: "/admin/alert-rules/rule_1", payload });

    expect(response.statusCode).toBe(200);
    expect(response.json().rule).toMatchObject(payload);
    expect(updatedRules).toEqual([{ id: "rule_1", input: payload }]);
  });

  it("returns 503 without leaking repository errors when creating alert rules fails", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        getNotificationChannel: async () => notificationChannel(),
        createAlertRule: async () => {
          throw new Error("database host leaked");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/alert-rules",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        notificationChannelId: "chn_1",
        name: "Critical errors",
        type: "critical_errors",
        severity: "critical",
        windowMinutes: 5,
        threshold: "1.5",
        cooldownMinutes: 10,
        enabled: true
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "alert_rules_unavailable" });
    expect(response.body).not.toContain("database host leaked");
  });

  it("preserves known alert rule scope not found mapping", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        getNotificationChannel: async () => notificationChannel(),
        createAlertRule: async () => {
          throw new Error("active_alert_rule_scope_not_found");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/alert-rules",
      payload: {
        projectId: "prj_missing",
        environmentId: "env_missing",
        notificationChannelId: "chn_1",
        name: "Critical errors",
        type: "critical_errors",
        severity: "critical",
        windowMinutes: 5,
        threshold: "1.5",
        cooldownMinutes: 10,
        enabled: true
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "alert_rule_scope_not_found" });
  });

  it("returns 404 without creating alert rules when the notification channel is missing", async () => {
    const createdRules: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        getNotificationChannel: async () => null,
        createAlertRule: async (input) => {
          createdRules.push(input);
          return alertRule(input);
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/alert-rules",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        notificationChannelId: "chn_missing",
        name: "Critical errors",
        type: "critical_errors",
        severity: "critical",
        windowMinutes: 5,
        threshold: "1.5",
        cooldownMinutes: 10,
        enabled: true
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "notification_channel_not_found" });
    expect(createdRules).toEqual([]);
  });

  it("returns 400 for invalid alert rule requests", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        createAlertRule: async () => alertRule()
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/alert-rules",
      payload: {
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Bad threshold",
        type: "critical_errors",
        severity: "critical",
        windowMinutes: 5,
        threshold: "0",
        cooldownMinutes: 10,
        enabled: true
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_alert_rule_request" });
  });

  it("updates alert rules and returns 404 for missing targets", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        updateAlertRule: async () => null
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/alert-rules/rule_missing",
      payload: { enabled: false }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "alert_rule_not_found" });
  });

  it("returns 404 without updating alert rules when the notification channel is missing", async () => {
    const updatedRules: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        getNotificationChannel: async () => null,
        updateAlertRule: async (_id, input) => {
          updatedRules.push(input);
          return alertRule(input);
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/alert-rules/rule_1",
      payload: { notificationChannelId: "chn_missing" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "notification_channel_not_found" });
    expect(updatedRules).toEqual([]);
  });

  it("archives alert rules", async () => {
    const archivedIds: string[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        archiveAlertRule: async (id) => {
          archivedIds.push(id);
        }
      }
    });

    const response = await app.inject({ method: "DELETE", url: "/admin/alert-rules/rule_1" });

    expect(response.statusCode).toBe(204);
    expect(archivedIds).toEqual(["rule_1"]);
  });
});
