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

function emailNotificationChannel(overrides: Partial<NotificationChannelRecord> = {}): NotificationChannelRecord {
  return {
    id: "chn_email",
    name: "Ops email",
    type: "email",
    url: null,
    emailRecipients: ["diogo@example.com"],
    secretHeaderName: null,
    secretHeaderValue: null,
    hasSecret: false,
    enabled: true,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    ...overrides
  } as NotificationChannelRecord;
}

function alertRule(overrides: Partial<AlertRuleRecord> = {}): AlertRuleRecord {
  return {
    id: "rule_1",
    projectId: "prj_1",
    environmentId: "env_1",
    notificationChannelId: "chn_1",
    escalationChannelId: null,
    name: "Critical errors",
    type: "critical_errors",
    severity: "critical",
    windowMinutes: 5,
    threshold: "1",
    cooldownMinutes: 10,
    escalationMinutes: null,
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
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    acknowledgedByEmail: null,
    resolvedAt: null,
    resolvedByUserId: null,
    resolvedByEmail: null,
    snoozedUntil: null,
    triageNote: null,
    escalationDueAt: null,
    escalatedAt: null,
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

  it("updates alert event triage for authenticated users", async () => {
    const received: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: {
        updateAlertEventTriage: async (id, input) => {
          received.push({ id, input });
          return alertEvent({ id, status: input.status, acknowledgedByEmail: input.actorEmail });
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/alerts/events/evt_1/triage",
      payload: { status: "acknowledged", note: "looking" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      id: "evt_1",
      status: "acknowledged",
      acknowledgedByEmail: "member@example.com"
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      id: "evt_1",
      input: { status: "acknowledged", actorUserId: "usr_member", actorEmail: "member@example.com", note: "looking" }
    });
  });

  it("rejects snooze triage without a snoozedUntil timestamp", async () => {
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: {
        updateAlertEventTriage: async () => alertEvent()
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/alerts/events/evt_1/triage",
      payload: { status: "snoozed" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_alert_triage_request" });
  });

  it("returns alert suggestions for authenticated users", async () => {
    const receivedInputs: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: {
        listAlertSuggestions: async (input) => {
          receivedInputs.push(input);
          return [
            {
              key: "critical_errors",
              type: "critical_errors" as const,
              severity: "critical" as const,
              title: "Critical errors detected",
              sub: "3 critical errors in 24h",
              windowMinutes: 60,
              threshold: "1",
              cooldownMinutes: 60,
              rationale: "rationale text",
            },
          ];
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/alerts/suggestions?project_id=prj_1&environment_id=env_1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().suggestions).toHaveLength(1);
    expect(response.json().suggestions[0]).toMatchObject({
      type: "critical_errors",
      severity: "critical",
      threshold: "1",
    });
    expect(receivedInputs).toEqual([{ projectId: "prj_1", environmentId: "env_1" }]);
  });

  it("requires authentication for suggestions", async () => {
    app = await buildApp({
      readiness,
      auth: unauthenticatedAuth,
      alerts: { listAlertSuggestions: async () => [] },
    });
    const response = await app.inject({
      method: "GET",
      url: "/alerts/suggestions?project_id=prj_1&environment_id=env_1",
    });
    expect(response.statusCode).toBe(401);
  });

  it("returns 400 for suggestions with missing query params", async () => {
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: { listAlertSuggestions: async () => [] },
    });
    const response = await app.inject({
      method: "GET",
      url: "/alerts/suggestions",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_alert_suggestions_query" });
  });

  it("returns 501 when suggestions handler is unavailable", async () => {
    app = await buildApp({ readiness, auth: userAuth });
    const response = await app.inject({
      method: "GET",
      url: "/alerts/suggestions?project_id=prj_1&environment_id=env_1",
    });
    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "alerts_repository_unavailable" });
  });

  it("returns 503 when suggestions handler throws", async () => {
    app = await buildApp({
      readiness,
      auth: userAuth,
      alerts: {
        listAlertSuggestions: async () => { throw new Error("db down"); },
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/alerts/suggestions?project_id=prj_1&environment_id=env_1",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "alerts_unavailable" });
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

  it("creates email notification channels", async () => {
    const receivedInputs: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        createNotificationChannel: async (input) => {
          receivedInputs.push(input);
          return emailNotificationChannel(input);
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/notification-channels",
      payload: {
        name: "Ops email",
        type: "email",
        emailRecipients: ["diogo@example.com"],
        enabled: true
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().channel).toMatchObject({
      type: "email",
      emailRecipients: ["diogo@example.com"],
      hasSecret: false
    });
    expect(response.json().channel.secretHeaderValue).toBeUndefined();
    expect(receivedInputs).toEqual([
      { name: "Ops email", type: "email", emailRecipients: ["diogo@example.com"], enabled: true }
    ]);
  });

  it("creates native Slack and Discord notification channels", async () => {
    const receivedInputs: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        createNotificationChannel: async (input) => {
          receivedInputs.push(input);
          return notificationChannel(input as Partial<NotificationChannelRecord>);
        }
      }
    });

    const slackResponse = await app.inject({
      method: "POST",
      url: "/admin/notification-channels",
      payload: {
        name: "Slack #incidents",
        type: "slack",
        url: "https://hooks.slack.com/services/T0/xyz",
        enabled: true
      }
    });
    expect(slackResponse.statusCode).toBe(201);
    expect(slackResponse.json().channel).toMatchObject({ type: "slack" });

    const discordResponse = await app.inject({
      method: "POST",
      url: "/admin/notification-channels",
      payload: {
        name: "Discord #alerts",
        type: "discord",
        url: "https://discord.com/api/webhooks/1/token",
        enabled: true
      }
    });
    expect(discordResponse.statusCode).toBe(201);
    expect(discordResponse.json().channel).toMatchObject({ type: "discord" });

    expect(receivedInputs).toEqual([
      { name: "Slack #incidents", type: "slack", url: "https://hooks.slack.com/services/T0/xyz", enabled: true },
      { name: "Discord #alerts", type: "discord", url: "https://discord.com/api/webhooks/1/token", enabled: true }
    ]);
  });

  it("masks Slack and Discord webhook URLs in list responses, but never the raw url", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        listNotificationChannels: async () => [
          notificationChannel({
            id: "chn_slack",
            type: "slack",
            url: "https://hooks.slack.com/services/T0/B1/verysecrettoken",
            secretHeaderName: null,
            secretHeaderValue: null,
            hasSecret: false
          }),
          notificationChannel({
            id: "chn_discord",
            type: "discord",
            url: "https://discord.com/api/webhooks/123/verysecrettoken",
            secretHeaderName: null,
            secretHeaderValue: null,
            hasSecret: false
          })
        ]
      }
    });

    const response = await app.inject({ method: "GET", url: "/admin/notification-channels" });
    expect(response.statusCode).toBe(200);

    const [slack, discord] = response.json().channels;

    expect(slack).toMatchObject({ id: "chn_slack", type: "slack", url: null, hasUrl: true });
    expect(slack.urlPreview).toBe("https://hooks.slack.com/service…");
    expect(response.body).not.toContain("verysecrettoken");

    expect(discord).toMatchObject({ id: "chn_discord", type: "discord", url: null, hasUrl: true });
    expect(discord.urlPreview).toBe("https://discord.com/api/web…");
    expect(response.body).not.toContain("verysecrettoken");
  });

  it("masks generic webhook URLs and strips repository secret fields from list responses", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        listNotificationChannels: async () => [{
          ...notificationChannel({
            id: "chn_webhook",
            type: "webhook",
            url: "https://hooks.example.com/synthetic-token"
          }),
          urlEncrypted: "v1.synthetic-url-envelope",
          secretHeaderValueEncrypted: "v1.synthetic-header-envelope",
          url_encrypted: "v1.synthetic-legacy-url-envelope",
          secret_header_value: "synthetic-legacy-header-token",
          secret_header_value_encrypted: "v1.synthetic-legacy-header-envelope"
        }]
      }
    });

    const response = await app.inject({ method: "GET", url: "/admin/notification-channels" });
    expect(response.statusCode).toBe(200);
    expect(response.json().channels[0]).toMatchObject({
      id: "chn_webhook",
      type: "webhook",
      url: null,
      hasUrl: true
    });
    expect(response.json().channels[0].urlPreview).toBe("https://hooks.example.com/…");
    expect(response.json().channels[0]).not.toHaveProperty("urlEncrypted");
    expect(response.json().channels[0]).not.toHaveProperty("secretHeaderValueEncrypted");
    expect(response.json().channels[0]).not.toHaveProperty("url_encrypted");
    expect(response.json().channels[0]).not.toHaveProperty("secret_header_value");
    expect(response.json().channels[0]).not.toHaveProperty("secret_header_value_encrypted");
    expect(response.body).not.toContain("synthetic-token");
    expect(response.body).not.toContain("synthetic-url-envelope");
    expect(response.body).not.toContain("synthetic-header-envelope");
    expect(response.body).not.toContain("synthetic-legacy-header-token");
  });

  it("preserves the existing Slack webhook url when updating a channel without a url field", async () => {
    const lookups: string[] = [];
    const updates: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        getNotificationChannel: async (id) => {
          lookups.push(id);
          return notificationChannel({
            id,
            type: "slack",
            url: "https://hooks.slack.com/services/T0/B1/existingtoken",
            secretHeaderName: null,
            secretHeaderValue: null,
            hasSecret: false
          });
        },
        updateNotificationChannel: async (id, input) => {
          updates.push({ id, input });
          return notificationChannel({
            id,
            type: "slack",
            name: "Slack renamed",
            url: "https://hooks.slack.com/services/T0/B1/existingtoken",
            secretHeaderName: null,
            secretHeaderValue: null,
            hasSecret: false
          });
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/notification-channels/chn_slack",
      payload: { name: "Slack renamed" }
    });

    expect(response.statusCode).toBe(200);
    expect(lookups).toEqual(["chn_slack"]);
    expect(updates).toEqual([{ id: "chn_slack", input: { name: "Slack renamed" } }]);
    expect(response.json().channel).toMatchObject({ type: "slack", hasUrl: true });
    expect(response.json().channel.url).toBeNull();
    expect(response.body).not.toContain("existingtoken");
  });

  it("replaces the Slack webhook url when updating a channel with a new url", async () => {
    const lookups: string[] = [];
    const updates: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        getNotificationChannel: async (id) => {
          lookups.push(id);
          return notificationChannel({
            id,
            type: "slack",
            url: "https://hooks.slack.com/services/T0/B1/existingtoken",
            secretHeaderName: null,
            secretHeaderValue: null,
            hasSecret: false
          });
        },
        updateNotificationChannel: async (id, input) => {
          updates.push({ id, input });
          return notificationChannel({
            id,
            type: "slack",
            url: "https://hooks.slack.com/services/T9/B9/newtoken",
            secretHeaderName: null,
            secretHeaderValue: null,
            hasSecret: false
          });
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/notification-channels/chn_slack",
      payload: { url: "https://hooks.slack.com/services/T9/B9/newtoken" }
    });

    expect(response.statusCode).toBe(200);
    expect(lookups).toEqual(["chn_slack"]);
    expect(updates).toEqual([
      { id: "chn_slack", input: { url: "https://hooks.slack.com/services/T9/B9/newtoken" } }
    ]);
    expect(response.json().channel).toMatchObject({ type: "slack", hasUrl: true });
    expect(response.json().channel.urlPreview).toBe("https://hooks.slack.com/service…");
    expect(response.body).not.toContain("newtoken");
  });

  it("rejects unsafe production webhook URLs for Slack and Discord channels", async () => {
    app = await buildApp({
      readiness,
      auth: adminAuth,
      nodeEnv: "production",
      alerts: {
        createNotificationChannel: async () => notificationChannel()
      }
    });

    for (const type of ["slack", "discord"]) {
      const response = await app.inject({
        method: "POST",
        url: "/admin/notification-channels",
        payload: { name: "Ops", type, url: "http://127.0.0.1/hook", enabled: true }
      });

      expect(response.statusCode, type).toBe(400);
      expect(response.json()).toEqual({ error: "invalid_notification_channel_request" });
    }
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
    const lookups: string[] = [];
    const updates: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        getNotificationChannel: async (id) => {
          lookups.push(id);
          return notificationChannel({ id });
        },
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
    expect(lookups).toEqual(["chn_1"]);
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
    const lookups: string[] = [];
    const updates: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        getNotificationChannel: async (id) => {
          lookups.push(id);
          return notificationChannel({ id });
        },
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
    expect(lookups).toEqual(["chn_1"]);
    expect(updates).toEqual([{ id: "chn_1", input: { secretHeaderName: null, secretHeaderValue: null } }]);
  });

  it("returns 404 without updating when a notification channel is missing during preflight", async () => {
    const lookups: string[] = [];
    const updates: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        getNotificationChannel: async (id) => {
          lookups.push(id);
          return null;
        },
        updateNotificationChannel: async (id, input) => {
          updates.push({ id, input });
          return notificationChannel({ id });
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/notification-channels/chn_missing",
      payload: { name: "Primary Ops" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "notification_channel_not_found" });
    expect(lookups).toEqual(["chn_missing"]);
    expect(updates).toEqual([]);
  });

  it("returns 404 when a notification channel disappears after preflight", async () => {
    const lookups: string[] = [];
    const updates: unknown[] = [];
    app = await buildApp({
      readiness,
      auth: adminAuth,
      alerts: {
        getNotificationChannel: async (id) => {
          lookups.push(id);
          return notificationChannel({ id });
        },
        updateNotificationChannel: async (id, input) => {
          updates.push({ id, input });
          return null;
        }
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/notification-channels/chn_missing",
      payload: { name: "Primary Ops" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "notification_channel_not_found" });
    expect(lookups).toEqual(["chn_missing"]);
    expect(updates).toEqual([{ id: "chn_missing", input: { name: "Primary Ops" } }]);
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

  it("creates dead-letter count alert rules", async () => {
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
      name: "Dead-letter backlog",
      type: "dead_letter_count",
      severity: "critical",
      threshold: "1",
      windowMinutes: 5,
      cooldownMinutes: 30
    };

    const response = await app.inject({ method: "POST", url: "/admin/alert-rules", payload });

    expect(response.statusCode).toBe(201);
    expect(response.json().rule).toMatchObject({ id: "rule_1", type: "dead_letter_count" });
    expect(createdRules).toEqual([{ ...payload, minimumSampleSize: 1, enabled: true }]);
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
