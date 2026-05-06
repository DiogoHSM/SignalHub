import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedBootstrapAdmin } from "../../../scripts/seed-admin.js";
import { createDb } from "../src/client.js";
import type { Db } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { insertDeadLetterJob } from "../src/repositories/dead-letter.js";
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
} from "../src/repositories/admin.js";
import {
  createAlertRule,
  createNotificationChannel,
  evaluateAlertRule,
  listActiveAlertRules,
  listAlertEvents,
  recordAlertEvent,
  recordNotificationDelivery,
  updateAlertRule,
  updateAlertRuleEvaluation,
  withAlertEvaluationLock
} from "../src/repositories/alerts.js";
import {
  archiveUser,
  createUser,
  findUserByEmail,
  findUserByGoogleSubject,
  findUserById,
  linkGoogleSubject,
  listUsers,
  updateUser
} from "../src/repositories/users.js";
import { insertError, insertEvent, insertLlmCall, insertSpan, insertTrace } from "../src/repositories/telemetry-writes.js";
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
} from "../src/repositories/telemetry-query.js";
import { getEntityTenantDetail, listEntityTenants, type EntityCursor } from "../src/repositories/entities-query.js";
import {
  deleteExpiredTelemetry,
  getHeartbeat,
  getIngestionFreshness,
  getLastRetentionRun,
  recordRetentionRun,
  upsertHeartbeat,
  withRetentionLock
} from "../src/repositories/system.js";
import { getUserDetail, listUsersActivity, type UserCursor } from "../src/repositories/users-query.js";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;

describe("repositories", () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("signalhub")
      .withUsername("signalhub")
      .withPassword("signalhub")
      .start();
  }, 60_000);

  afterAll(async () => {
    await container?.stop();
  }, 30_000);

  async function withDb<T>(run: (db: Db) => Promise<T>): Promise<T> {
    const db = createDb(container.getConnectionUri());
    try {
      return await run(db);
    } finally {
      await db.destroy();
    }
  }

  function decodeEntityCursorForTest(cursor: string): EntityCursor {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as EntityCursor;
  }

  function decodeUserCursorForTest(cursor: string): UserCursor {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as UserCursor;
  }

  it("runs migrations idempotently", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await migrate(db);
    });
  });

  it("runs operational safety migrations", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`select id, status, started_at from retention_runs limit 0`.execute(db);
      await sql`select component, last_heartbeat_at from system_heartbeats limit 0`.execute(db);
    });
  });

  it("runs simple alert migrations", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`select id, type, enabled from notification_channels limit 0`.execute(db);
      await sql`select id, type, threshold from alert_rules limit 0`.execute(db);
      await sql`select id, observed_value from alert_events limit 0`.execute(db);
      await sql`select id, status from notification_deliveries limit 0`.execute(db);
    });
  });

  it("rejects alert events whose rule scope does not match the event scope", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`insert into projects (id, name) values ('prj_alert_scope_a', 'Alert Scope A')`.execute(db);
      await sql`insert into projects (id, name) values ('prj_alert_scope_b', 'Alert Scope B')`.execute(db);
      await sql`insert into environments (id, project_id, name) values ('env_alert_scope_a', 'prj_alert_scope_a', 'production')`.execute(db);
      await sql`insert into environments (id, project_id, name) values ('env_alert_scope_b', 'prj_alert_scope_b', 'production')`.execute(db);
      await sql`
        insert into alert_rules (
          id,
          project_id,
          environment_id,
          name,
          type,
          severity,
          window_minutes,
          threshold,
          cooldown_minutes
        )
        values (
          'alr_alert_scope_a',
          'prj_alert_scope_a',
          'env_alert_scope_a',
          'Critical errors',
          'critical_errors',
          'critical',
          5,
          1,
          10
        )
      `.execute(db);

      await expect(sql`
        insert into alert_events (
          id,
          rule_id,
          project_id,
          environment_id,
          status,
          severity,
          triggered_at,
          window_start,
          window_end,
          observed_value,
          threshold,
          message
        )
        values (
          'ale_alert_scope_mismatch',
          'alr_alert_scope_a',
          'prj_alert_scope_b',
          'env_alert_scope_b',
          'triggered',
          'critical',
          '2026-05-06T12:00:00.000Z',
          '2026-05-06T11:55:00.000Z',
          '2026-05-06T12:00:00.000Z',
          2,
          1,
          'Mismatched alert scope'
        )
      `.execute(db)).rejects.toThrow(/foreign key constraint/);
    });
  });

  it("uses transaction-scoped retention locks without leaking locks", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const first = await withRetentionLock(db, async () => {
        const concurrent = await withRetentionLock(db, async () => "concurrent");
        expect(concurrent).toEqual({ locked: false });
        return "first";
      });
      expect(first).toEqual({ locked: true, result: "first" });

      await expect(withRetentionLock(db, async () => "second")).resolves.toEqual({ locked: true, result: "second" });
    });
  });

  it("releases retention locks after failed locked work", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await expect(
        withRetentionLock(db, async (lockedDb) => {
          await sql`select * from missing_retention_table`.execute(lockedDb);
        })
      ).rejects.toThrow("retention_delete_failed");

      await expect(withRetentionLock(db, async () => "after failure")).resolves.toEqual({
        locked: true,
        result: "after failure"
      });
    });
  });

  it("creates channels rules alert events and deliveries", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Alert Repository Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      const channel = await createNotificationChannel(db, {
        name: "Ops webhook",
        type: "webhook",
        url: "https://hooks.example.com/signalhub",
        secretHeaderName: "X-SignalHub-Secret",
        secretHeaderValue: "secret-value",
        enabled: true
      });
      expect(channel.hasSecret).toBe(true);
      expect(channel.secretHeaderValue).toBe("secret-value");

      const rule = await createAlertRule(db, {
        projectId: project.id,
        environmentId: environment.id,
        notificationChannelId: channel.id,
        name: "Critical errors",
        type: "critical_errors",
        severity: "critical",
        windowMinutes: 10,
        threshold: "1",
        cooldownMinutes: 30,
        enabled: true
      });
      expect(rule.type).toBe("critical_errors");

      const evaluatedAt = new Date("2026-05-06T12:00:00.000Z");
      await updateAlertRuleEvaluation(db, {
        ruleId: rule.id,
        evaluatedAt,
        triggeredAt: evaluatedAt
      });

      const activeRules = await listActiveAlertRules(db);
      expect(activeRules.find((activeRule) => activeRule.id === rule.id)).toMatchObject({
        id: rule.id,
        lastEvaluatedAt: evaluatedAt,
        lastTriggeredAt: evaluatedAt
      });

      const event = await recordAlertEvent(db, {
        rule,
        triggeredAt: new Date("2026-05-06T12:00:00.000Z"),
        windowStart: new Date("2026-05-06T11:50:00.000Z"),
        windowEnd: new Date("2026-05-06T12:00:00.000Z"),
        observedValue: "2",
        message: "Critical errors threshold reached",
        metadata: { count: 2 }
      });

      await recordNotificationDelivery(db, {
        alertEventId: event.id,
        notificationChannelId: channel.id,
        status: "success",
        attemptedAt: new Date("2026-05-06T12:00:01.000Z"),
        responseStatus: 204,
        errorMessage: null
      });

      const events = await listAlertEvents(db, { projectId: project.id, environmentId: environment.id, limit: 10 });
      expect(events[0]).toMatchObject({ id: event.id, latestDeliveryStatus: "success" });
    });
  });

  it("uses an advisory lock for alert evaluation", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const first = await withAlertEvaluationLock(db, async () => {
        const second = await withAlertEvaluationLock(db, async () => "nested");
        expect(second).toEqual({ locked: false });
        return "outer";
      });

      expect(first).toEqual({ locked: true, result: "outer" });
    });
  });

  it("does not conflict alert evaluation locks with retention locks", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const result = await withRetentionLock(db, async () => {
        return withAlertEvaluationLock(db, async () => "alerts");
      });

      expect(result).toEqual({ locked: true, result: { locked: true, result: "alerts" } });
    });
  });

  it("rejects new alert rules under archived scopes", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Active Alert Scope Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const archivedProject = await createProject(db, { name: "Archived Alert Scope Project" });
      const archivedProjectEnvironment = await createEnvironment(db, {
        projectId: archivedProject.id,
        name: "production"
      });

      await archiveProject(db, archivedProject.id);
      await expect(
        createAlertRule(db, {
          projectId: archivedProject.id,
          environmentId: archivedProjectEnvironment.id,
          name: "Archived project alert",
          type: "critical_errors",
          severity: "critical",
          windowMinutes: 10,
          threshold: "1",
          cooldownMinutes: 30,
          enabled: true
        })
      ).rejects.toThrow("active_alert_rule_scope_not_found");

      const archivedEnvironment = await createEnvironment(db, { projectId: project.id, name: "archived" });
      await archiveEnvironment(db, archivedEnvironment.id);
      await expect(
        createAlertRule(db, {
          projectId: project.id,
          environmentId: archivedEnvironment.id,
          name: "Archived environment alert",
          type: "critical_errors",
          severity: "critical",
          windowMinutes: 10,
          threshold: "1",
          cooldownMinutes: 30,
          enabled: true
        })
      ).rejects.toThrow("active_alert_rule_scope_not_found");

      await expect(
        createAlertRule(db, {
          projectId: archivedProject.id,
          environmentId: environment.id,
          name: "Cross project alert",
          type: "critical_errors",
          severity: "critical",
          windowMinutes: 10,
          threshold: "1",
          cooldownMinutes: 30,
          enabled: true
        })
      ).rejects.toThrow("active_alert_rule_scope_not_found");
    });
  });

  it("rejects alert rule updates to archived scopes", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Update Alert Scope Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const archivedEnvironment = await createEnvironment(db, { projectId: project.id, name: "archived" });
      const rule = await createAlertRule(db, {
        projectId: project.id,
        environmentId: environment.id,
        name: "Update scope alert",
        type: "critical_errors",
        severity: "critical",
        windowMinutes: 10,
        threshold: "1",
        cooldownMinutes: 30,
        enabled: true
      });

      await archiveEnvironment(db, archivedEnvironment.id);

      await expect(updateAlertRule(db, rule.id, { environmentId: archivedEnvironment.id })).rejects.toThrow(
        "active_alert_rule_scope_not_found"
      );
    });
  });

  it("excludes alert rules from archived scopes when listing active rules", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Active Alert Rules Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const archivedProject = await createProject(db, { name: "Archived Active Alert Rules Project" });
      const archivedProjectEnvironment = await createEnvironment(db, {
        projectId: archivedProject.id,
        name: "production"
      });
      const archivedEnvironment = await createEnvironment(db, { projectId: project.id, name: "archived" });

      const activeRule = await createAlertRule(db, {
        projectId: project.id,
        environmentId: environment.id,
        name: "Active alert",
        type: "critical_errors",
        severity: "critical",
        windowMinutes: 10,
        threshold: "1",
        cooldownMinutes: 30,
        enabled: true
      });
      const archivedProjectRule = await createAlertRule(db, {
        projectId: archivedProject.id,
        environmentId: archivedProjectEnvironment.id,
        name: "Archived project alert",
        type: "critical_errors",
        severity: "critical",
        windowMinutes: 10,
        threshold: "1",
        cooldownMinutes: 30,
        enabled: true
      });
      const archivedEnvironmentRule = await createAlertRule(db, {
        projectId: project.id,
        environmentId: archivedEnvironment.id,
        name: "Archived environment alert",
        type: "critical_errors",
        severity: "critical",
        windowMinutes: 10,
        threshold: "1",
        cooldownMinutes: 30,
        enabled: true
      });

      await archiveProject(db, archivedProject.id);
      await archiveEnvironment(db, archivedEnvironment.id);

      const activeRules = await listActiveAlertRules(db);
      expect(activeRules.map((rule) => rule.id)).toContain(activeRule.id);
      expect(activeRules.map((rule) => rule.id)).not.toContain(archivedProjectRule.id);
      expect(activeRules.map((rule) => rule.id)).not.toContain(archivedEnvironmentRule.id);
    });
  });

  it("records and reads worker heartbeat", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const heartbeatAt = new Date("2026-05-06T12:00:00.000Z");
      const updatedHeartbeatAt = new Date("2026-05-06T12:05:00.000Z");
      await upsertHeartbeat(db, { component: "worker", heartbeatAt });
      await upsertHeartbeat(db, { component: "worker", heartbeatAt: updatedHeartbeatAt });

      const heartbeat = await getHeartbeat(db, "worker");
      expect(heartbeat?.component).toBe("worker");
      expect(heartbeat?.lastHeartbeatAt).toEqual(updatedHeartbeatAt);
    });
  });

  it("returns latest ingestion freshness timestamps or nulls", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await expect(getIngestionFreshness(db)).resolves.toEqual({
        lastEventAt: null,
        lastErrorAt: null,
        lastTraceAt: null,
        lastSpanAt: null,
        lastLlmCallAt: null
      });

      const project = await createProject(db, { name: "Freshness Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const receivedAt = new Date("2026-05-06T12:00:00.000Z");
      const olderAt = new Date("2026-05-06T09:00:00.000Z");
      const eventAt = new Date("2026-05-06T10:00:00.000Z");
      const errorAt = new Date("2026-05-06T10:01:00.000Z");
      const traceAt = new Date("2026-05-06T10:02:00.000Z");
      const spanAt = new Date("2026-05-06T10:03:00.000Z");
      const llmAt = new Date("2026-05-06T10:04:00.000Z");

      await insertEvent(db, {
        id: "evt_freshness_older",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: olderAt,
        receivedAt,
        name: "freshness.event.older"
      });
      await insertEvent(db, {
        id: "evt_freshness",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: eventAt,
        receivedAt,
        name: "freshness.event"
      });
      await insertError(db, {
        id: "err_freshness_older",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: olderAt,
        receivedAt,
        message: "Older freshness error",
        severity: "warning"
      });
      await insertError(db, {
        id: "err_freshness",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: errorAt,
        receivedAt,
        message: "Freshness error",
        severity: "error"
      });
      await insertTrace(db, {
        id: "trc_freshness_older",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: olderAt,
        receivedAt,
        name: "Older freshness trace",
        status: "ok",
        startedAt: olderAt
      });
      await insertTrace(db, {
        id: "trc_freshness",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: traceAt,
        receivedAt,
        name: "Freshness trace",
        status: "ok",
        startedAt: traceAt
      });
      await insertSpan(db, {
        id: "spn_freshness_older",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: olderAt,
        receivedAt,
        traceId: "trace_freshness_older",
        name: "Older freshness span",
        status: "ok",
        startedAt: olderAt
      });
      await insertSpan(db, {
        id: "spn_freshness",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: spanAt,
        receivedAt,
        traceId: "trace_freshness",
        name: "Freshness span",
        status: "ok",
        startedAt: spanAt
      });
      await insertLlmCall(db, {
        id: "llm_freshness_older",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: olderAt,
        receivedAt,
        provider: "openai",
        model: "gpt-4",
        status: "success"
      });
      await insertLlmCall(db, {
        id: "llm_freshness",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: llmAt,
        receivedAt,
        provider: "openai",
        model: "gpt-5",
        status: "success"
      });

      await expect(getIngestionFreshness(db)).resolves.toEqual({
        lastEventAt: eventAt,
        lastErrorAt: errorAt,
        lastTraceAt: traceAt,
        lastSpanAt: spanAt,
        lastLlmCallAt: llmAt
      });
    });
  });

  it("evaluates supported alert rule types", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Alert Evaluation Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      await insertError(db, {
        id: "err_critical",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-06T11:58:00.000Z"),
        receivedAt: new Date("2026-05-06T11:58:00.000Z"),
        message: "Checkout failed",
        severity: "critical",
        status: "open",
        metadata: {},
        context: {}
      });
      await insertError(db, {
        id: "err_warning_for_alert_count",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-06T11:59:00.000Z"),
        receivedAt: new Date("2026-05-06T11:59:00.000Z"),
        message: "Retryable checkout failure",
        severity: "warning",
        status: "open",
        metadata: {},
        context: {}
      });

      await insertTrace(db, {
        id: "trace_slow",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-06T11:58:00.000Z"),
        receivedAt: new Date("2026-05-06T11:58:00.000Z"),
        name: "checkout",
        status: "success",
        startedAt: new Date("2026-05-06T11:57:45.000Z"),
        endedAt: new Date("2026-05-06T11:58:00.000Z"),
        durationMs: 15000,
        metadata: {}
      });
      await insertLlmCall(db, {
        id: "llm_alert_cost",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-06T11:58:30.000Z"),
        receivedAt: new Date("2026-05-06T11:58:30.000Z"),
        provider: "openai",
        model: "gpt-5",
        status: "success",
        costUsd: "1.25"
      });

      const criticalResult = await evaluateAlertRule(db, {
        projectId: project.id,
        environmentId: environment.id,
        type: "critical_errors",
        windowStart: new Date("2026-05-06T11:50:00.000Z"),
        windowEnd: new Date("2026-05-06T12:00:00.000Z")
      });
      expect(criticalResult.observedValue).toBe("1");

      const errorCountResult = await evaluateAlertRule(db, {
        projectId: project.id,
        environmentId: environment.id,
        type: "error_count",
        windowStart: new Date("2026-05-06T11:50:00.000Z"),
        windowEnd: new Date("2026-05-06T12:00:00.000Z")
      });
      expect(errorCountResult.observedValue).toBe("2");

      const latencyResult = await evaluateAlertRule(db, {
        projectId: project.id,
        environmentId: environment.id,
        type: "trace_p95_latency",
        windowStart: new Date("2026-05-06T11:50:00.000Z"),
        windowEnd: new Date("2026-05-06T12:00:00.000Z")
      });
      expect(latencyResult.observedValue).toBe("15000");

      const llmCostResult = await evaluateAlertRule(db, {
        projectId: project.id,
        environmentId: environment.id,
        type: "llm_cost",
        windowStart: new Date("2026-05-06T11:50:00.000Z"),
        windowEnd: new Date("2026-05-06T12:00:00.000Z")
      });
      expect(llmCostResult.observedValue).toBe("1.25");
    });
  });

  it("records and reads the last retention run", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const startedAt = new Date("2026-05-06T12:00:00.000Z");
      const finishedAt = new Date("2026-05-06T12:00:05.000Z");
      const deleted = { events: 1, errors: 2, traces: 3, spans: 4, llmCalls: 5 };
      const policy = { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180 };

      const run = await recordRetentionRun(db, {
        startedAt,
        finishedAt,
        status: "success",
        deleted,
        policy
      });

      expect(run).toMatchObject({
        id: expect.any(String),
        status: "success",
        startedAt,
        finishedAt,
        errorMessage: null,
        deleted,
        policy
      });
      await expect(getLastRetentionRun(db)).resolves.toEqual(run);
    });
  });

  it("deletes telemetry older than retention cutoffs in bounded batches", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Retention Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const receivedAt = new Date("2026-05-06T12:00:00.000Z");
      const oldTimestamp = new Date("2026-01-01T12:00:00.000Z");
      const olderTimestamp = new Date("2025-12-31T12:00:00.000Z");
      const longRetentionOldTimestamp = new Date("2025-10-01T12:00:00.000Z");
      const freshTimestamp = new Date("2026-05-05T12:00:00.000Z");

      await insertEvent(db, {
        id: "evt_old_retention",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: oldTimestamp,
        receivedAt,
        name: "old.event"
      });
      await insertEvent(db, {
        id: "evt_older_retention",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: olderTimestamp,
        receivedAt,
        name: "older.event"
      });
      await insertEvent(db, {
        id: "evt_fresh_retention",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: freshTimestamp,
        receivedAt,
        name: "fresh.event"
      });
      await insertError(db, {
        id: "err_old_retention",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: longRetentionOldTimestamp,
        receivedAt,
        message: "Old error",
        severity: "error"
      });
      await insertError(db, {
        id: "err_fresh_retention",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: freshTimestamp,
        receivedAt,
        message: "Fresh error",
        severity: "error"
      });
      await insertTrace(db, {
        id: "trc_old_retention",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: oldTimestamp,
        receivedAt,
        traceId: "trace_old_retention",
        name: "Old trace",
        status: "ok",
        startedAt: oldTimestamp
      });
      await insertTrace(db, {
        id: "trc_fresh_retention",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: freshTimestamp,
        receivedAt,
        traceId: "trace_fresh_retention",
        name: "Fresh trace",
        status: "ok",
        startedAt: freshTimestamp
      });
      await insertSpan(db, {
        id: "spn_old_retention",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: oldTimestamp,
        receivedAt,
        traceId: "trace_old_retention",
        name: "Old span",
        status: "ok",
        startedAt: oldTimestamp
      });
      await insertSpan(db, {
        id: "spn_fresh_retention",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: freshTimestamp,
        receivedAt,
        traceId: "trace_fresh_retention",
        name: "Fresh span",
        status: "ok",
        startedAt: freshTimestamp
      });
      await insertLlmCall(db, {
        id: "llm_old_retention",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: longRetentionOldTimestamp,
        receivedAt,
        provider: "openai",
        model: "gpt-5",
        status: "success"
      });
      await insertLlmCall(db, {
        id: "llm_fresh_retention",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: freshTimestamp,
        receivedAt,
        provider: "openai",
        model: "gpt-5",
        status: "success"
      });

      const deleted = await deleteExpiredTelemetry(db, {
        now: new Date("2026-05-06T12:00:00.000Z"),
        batchSize: 1,
        eventsDays: 90,
        errorsDays: 180,
        tracesDays: 90,
        spansDays: 90,
        llmCallsDays: 180
      });

      expect(deleted).toEqual({
        events: 2,
        errors: 1,
        traces: 1,
        spans: 1,
        llmCalls: 1
      });

      const filters = { projectId: project.id, environmentId: environment.id, limit: 10 };
      await expect(listEvents(db, filters)).resolves.toEqual([expect.objectContaining({ id: "evt_fresh_retention" })]);
      await expect(listErrors(db, filters)).resolves.toEqual([expect.objectContaining({ id: "err_fresh_retention" })]);
      await expect(listTraces(db, filters)).resolves.toEqual([expect.objectContaining({ id: "trc_fresh_retention" })]);
      await expect(listTraceSpans(db, filters)).resolves.toEqual([
        expect.objectContaining({ id: "spn_fresh_retention" })
      ]);
      await expect(listLlmCalls(db, filters)).resolves.toEqual([
        expect.objectContaining({ id: "llm_fresh_retention" })
      ]);
    });
  });

  it("limits retention work per table by maximum batch count", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Bounded Retention Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const receivedAt = new Date("2026-05-06T12:00:00.000Z");
      const oldTimestamp = new Date("2026-01-01T12:00:00.000Z");

      await insertEvent(db, {
        id: "evt_bounded_retention_1",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: oldTimestamp,
        receivedAt,
        name: "bounded.retention.one"
      });
      await insertEvent(db, {
        id: "evt_bounded_retention_2",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: oldTimestamp,
        receivedAt,
        name: "bounded.retention.two"
      });

      const deleted = await deleteExpiredTelemetry(db, {
        now: new Date("2026-05-06T12:00:00.000Z"),
        batchSize: 1,
        maxBatchesPerTable: 1,
        eventsDays: 90,
        errorsDays: 180,
        tracesDays: 90,
        spansDays: 90,
        llmCallsDays: 180
      });

      expect(deleted.events).toBe(1);
      await expect(listEvents(db, { projectId: project.id, environmentId: environment.id, limit: 10 })).resolves.toHaveLength(1);
    });
  });

  it("creates admin resources and queries telemetry", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const user = await createUser(db, {
        email: "Admin@Example.com",
        passwordHash: "hash",
        isAdmin: true
      });
      const foundUser = await findUserByEmail(db, "admin@example.com");
      expect(foundUser?.id).toBe(user.id);
      expect(foundUser?.email).toBe("admin@example.com");

      const project = await createProject(db, { name: "Demo API" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const apiKey = await createApiKeyRecord(db, {
        projectId: project.id,
        environmentId: environment.id,
        name: "prod key",
        prefix: "sh_abc123456",
        hash: "hash"
      });

      expect(apiKey.revokedAt).toBeNull();

      await insertEvent(db, {
        id: "evt_1",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-02T12:00:00.000Z"),
        receivedAt: new Date("2026-05-02T12:00:01.000Z"),
        name: "dashboard_created",
        tenantId: "tenant_1",
        userId: "user_1",
        sessionId: "session_1",
        traceId: "trace_1",
        source: "web",
        release: "1.0.0",
        metadata: { plan: "pro" },
        properties: { charts_count: 6 }
      });

      await insertLlmCall(db, {
        id: "llm_1",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-02T12:00:00.000Z"),
        receivedAt: new Date("2026-05-02T12:00:01.000Z"),
        tenantId: "tenant_1",
        userId: "user_1",
        provider: "openai",
        model: "gpt-5.5",
        promptName: "generate_sql",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: "0.030000",
        status: "success"
      });

      const events = await listEvents(db, { projectId: project.id, environmentId: environment.id });
      expect(events).toHaveLength(1);
      expect(events[0].name).toBe("dashboard_created");

      const llm = await getLlmAggregates(db, { projectId: project.id, environmentId: environment.id });
      expect(llm.totalCalls).toBe(1);
      expect(llm.totalInputTokens).toBe(100);
    });
  });

  it("inserts dead letter jobs with sanitized details", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const job = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "event",
        payload: { metadata: { authorization: "[REDACTED]" } },
        errorMessage: "authorization: [REDACTED]"
      });

      expect(job).toMatchObject({
        id: expect.stringMatching(/^dlj_/),
        queueName: "telemetry",
        jobName: "event",
        payload: { metadata: { authorization: "[REDACTED]" } },
        errorMessage: "authorization: [REDACTED]",
        createdAt: expect.any(Date)
      });
    });
  });

  it("supports runtime admin resource and user management helpers", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const user = await createUser(db, {
        email: "runtime-user@example.com",
        passwordHash: "hash",
        isAdmin: false
      });
      await expect(findUserById(db, user.id)).resolves.toMatchObject({ id: user.id });
      await expect(listUsers(db)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: user.id })]));
      await expect(updateUser(db, user.id, { email: "Runtime-Renamed@example.com", isAdmin: true })).resolves.toMatchObject({
        id: user.id,
        email: "runtime-renamed@example.com",
        isAdmin: true
      });
      await archiveUser(db, user.id);
      await expect(findUserById(db, user.id)).resolves.toBeUndefined();

      const project = await createProject(db, { name: "Runtime Project" });
      await expect(listProjects(db)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: project.id })]));
      await expect(getProject(db, project.id)).resolves.toMatchObject({ id: project.id });
      await expect(updateProject(db, project.id, { name: "Runtime Project Updated" })).resolves.toMatchObject({
        id: project.id,
        name: "Runtime Project Updated"
      });

      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      await expect(listEnvironments(db, project.id)).resolves.toEqual([expect.objectContaining({ id: environment.id })]);
      await expect(updateEnvironment(db, environment.id, { name: "staging" })).resolves.toMatchObject({
        id: environment.id,
        name: "staging"
      });

      const apiKey = await createApiKeyRecord(db, {
        projectId: project.id,
        environmentId: environment.id,
        name: "runtime key",
        prefix: "sh_runtime12",
        hash: "runtime-hash"
      });
      await expect(listApiKeys(db, project.id)).resolves.toEqual([expect.objectContaining({ id: apiKey.id })]);
      await expect(findApiKeyByPrefix(db, "sh_runtime12")).resolves.toMatchObject({ id: apiKey.id });

      const archivedProject = await createProject(db, { name: "Archived Key Project" });
      const archivedProjectEnvironment = await createEnvironment(db, {
        projectId: archivedProject.id,
        name: "production"
      });
      await createApiKeyRecord(db, {
        projectId: archivedProject.id,
        environmentId: archivedProjectEnvironment.id,
        name: "archived project key",
        prefix: "sh_archproj1",
        hash: "archived-project-hash"
      });
      await archiveProject(db, archivedProject.id);
      await expect(findApiKeyByPrefix(db, "sh_archproj1")).resolves.toBeUndefined();

      const archivedEnvironment = await createEnvironment(db, { projectId: project.id, name: "archived-env" });
      await createApiKeyRecord(db, {
        projectId: project.id,
        environmentId: archivedEnvironment.id,
        name: "archived environment key",
        prefix: "sh_archenv12",
        hash: "archived-environment-hash"
      });
      await archiveEnvironment(db, archivedEnvironment.id);
      await expect(findApiKeyByPrefix(db, "sh_archenv12")).resolves.toBeUndefined();

      await revokeApiKey(db, apiKey.id);
      await expect(findApiKeyByPrefix(db, "sh_runtime12")).resolves.toBeUndefined();

      await archiveEnvironment(db, environment.id);
      await expect(listEnvironments(db, project.id)).resolves.toEqual([]);
      await archiveProject(db, project.id);
      await expect(getProject(db, project.id)).resolves.toBeUndefined();
    });
  });

  it("rejects new environments and API keys under archived scopes", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Active Scope Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const archivedProject = await createProject(db, { name: "Archived Scope Project" });
      const archivedProjectEnvironment = await createEnvironment(db, {
        projectId: archivedProject.id,
        name: "production"
      });

      await archiveProject(db, archivedProject.id);
      await expect(createEnvironment(db, { projectId: archivedProject.id, name: "staging" })).rejects.toThrow(
        "active_project_not_found"
      );
      await expect(
        createApiKeyRecord(db, {
          projectId: archivedProject.id,
          environmentId: archivedProjectEnvironment.id,
          name: "archived project key",
          prefix: "sh_rejectp1",
          hash: "hash"
        })
      ).rejects.toThrow("active_api_key_scope_not_found");

      const archivedEnvironment = await createEnvironment(db, { projectId: project.id, name: "archived" });
      await archiveEnvironment(db, archivedEnvironment.id);
      await expect(
        createApiKeyRecord(db, {
          projectId: project.id,
          environmentId: archivedEnvironment.id,
          name: "archived environment key",
          prefix: "sh_rejecte1",
          hash: "hash"
        })
      ).rejects.toThrow("active_api_key_scope_not_found");

      await expect(
        createApiKeyRecord(db, {
          projectId: archivedProject.id,
          environmentId: environment.id,
          name: "cross project key",
          prefix: "sh_rejectx1",
          hash: "hash"
        })
      ).rejects.toThrow("active_api_key_scope_not_found");
    });
  });

  it("supports runtime telemetry list and aggregate helpers", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Runtime Telemetry" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_runtime",
        userId: "user_runtime",
        sessionId: "session_runtime",
        traceId: "trace_runtime",
        timestamp: new Date("2026-05-02T12:00:00.000Z"),
        receivedAt: new Date("2026-05-02T12:00:01.000Z")
      };

      await insertEvent(db, { ...base, id: "evt_runtime", name: "runtime.event" });
      await insertError(db, { ...base, id: "err_runtime", message: "Runtime failed", severity: "error" });
      await insertLlmCall(db, {
        ...base,
        id: "llm_runtime",
        provider: "openai",
        model: "gpt-5",
        inputTokens: 3,
        outputTokens: 4,
        costUsd: "0.010000",
        status: "success"
      });
      await insertTrace(db, {
        ...base,
        id: "trc_runtime",
        name: "runtime trace",
        status: "ok",
        startedAt: new Date("2026-05-02T12:00:00.000Z"),
        durationMs: 20
      });
      await insertSpan(db, {
        ...base,
        id: "spn_runtime",
        traceId: "trace_runtime",
        name: "runtime span",
        status: "ok",
        startedAt: new Date("2026-05-02T12:00:00.000Z"),
        durationMs: 10
      });

      const filters = { projectId: project.id, environmentId: environment.id, traceId: "trace_runtime" };
      await expect(listEvents(db, filters)).resolves.toEqual([expect.objectContaining({ id: "evt_runtime" })]);
      await expect(listErrors(db, filters)).resolves.toEqual([expect.objectContaining({ id: "err_runtime" })]);
      await expect(listLlmCalls(db, filters)).resolves.toEqual([expect.objectContaining({ id: "llm_runtime" })]);
      await expect(listTraces(db, filters)).resolves.toEqual([expect.objectContaining({ id: "trc_runtime" })]);
      await expect(listTraceSpans(db, filters)).resolves.toEqual([expect.objectContaining({ id: "spn_runtime" })]);
      await expect(getEventAggregates(db, filters)).resolves.toMatchObject({ total: 1 });
      await expect(getErrorAggregates(db, filters)).resolves.toMatchObject({ total: 1, open: 1 });
      await expect(getLlmAggregates(db, filters)).resolves.toMatchObject({ totalCalls: 1, totalInputTokens: 3 });
      await expect(getTraceAggregates(db, filters)).resolves.toMatchObject({ total: 1, averageDurationMs: 20 });
    });
  });

  it("filters LLM calls and aggregates by exact LLM fields", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "LLM Filters" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_llm",
        userId: "user_llm",
        sessionId: "session_llm",
        traceId: "trace_llm",
        timestamp: new Date("2026-05-05T12:00:00.000Z"),
        receivedAt: new Date("2026-05-05T12:00:01.000Z")
      };

      await insertLlmCall(db, {
        ...base,
        id: "llm_match",
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: "0.250000",
        latencyMs: 1200,
        status: "success"
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_other_model",
        provider: "openai",
        model: "gpt-4",
        promptName: "generate_sql",
        inputTokens: 100,
        outputTokens: 200,
        costUsd: "2.500000",
        latencyMs: 2200,
        status: "success"
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_other_status",
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        inputTokens: 5,
        outputTokens: 6,
        costUsd: "0.050000",
        latencyMs: 800,
        status: "error"
      });

      const filters = {
        projectId: project.id,
        environmentId: environment.id,
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        status: "success"
      };

      await expect(listLlmCalls(db, filters)).resolves.toEqual([expect.objectContaining({ id: "llm_match" })]);
      await expect(getLlmAggregates(db, filters)).resolves.toMatchObject({
        totalCalls: 1,
        totalInputTokens: 10,
        totalOutputTokens: 20,
        totalCostUsd: "0.250000"
      });
    });
  });

  it("builds overview metrics trends top lists and recent signals", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Overview Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const otherProject = await createProject(db, { name: "Other Project" });
      const otherEnvironment = await createEnvironment(db, { projectId: otherProject.id, name: "production" });
      const now = new Date("2026-05-05T12:00:00.000Z");
      const inWindow = new Date("2026-05-05T10:00:00.000Z");
      const olderInWindow = new Date("2026-05-05T09:00:00.000Z");
      const outsideWindow = new Date("2026-05-03T12:00:00.000Z");
      const receivedAt = new Date("2026-05-05T12:00:01.000Z");
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        receivedAt,
        source: "api",
        release: "1.0.0"
      };

      await insertEvent(db, {
        ...base,
        id: "evt_overview_1",
        name: "dashboard_created",
        tenantId: "tenant_a",
        userId: "user_a",
        sessionId: "session_a",
        traceId: "trace_success",
        timestamp: inWindow
      });
      await insertEvent(db, {
        ...base,
        id: "evt_overview_2",
        name: "dashboard_created",
        tenantId: "tenant_a",
        userId: "user_b",
        sessionId: "session_b",
        traceId: "trace_failed",
        timestamp: inWindow
      });
      await insertEvent(db, {
        ...base,
        id: "evt_overview_3",
        name: "chat_started",
        tenantId: "tenant_b",
        userId: "user_c",
        sessionId: "session_c",
        traceId: "trace_llm",
        timestamp: olderInWindow
      });
      await insertEvent(db, {
        projectId: otherProject.id,
        environmentId: otherEnvironment.id,
        id: "evt_other_scope",
        name: "dashboard_created",
        timestamp: inWindow,
        receivedAt
      });
      await insertEvent(db, { ...base, id: "evt_old", name: "old_event", timestamp: outsideWindow, receivedAt });

      await insertError(db, {
        ...base,
        id: "err_recent",
        message: "Checkout failed",
        type: "CheckoutError",
        severity: "critical",
        status: "open",
        tenantId: "tenant_a",
        userId: "user_a",
        traceId: "trace_failed",
        timestamp: inWindow
      });
      await insertError(db, {
        ...base,
        id: "err_fatal",
        message: "Worker crashed",
        severity: "fatal",
        status: "open",
        tenantId: "tenant_a",
        userId: "user_a",
        traceId: "trace_failed",
        timestamp: inWindow
      });
      await insertError(db, {
        ...base,
        id: "err_warning",
        message: "Slow response",
        severity: "warning",
        status: "resolved",
        tenantId: "tenant_b",
        userId: "user_c",
        timestamp: olderInWindow
      });

      await insertTrace(db, {
        ...base,
        id: "trc_success",
        name: "Generate dashboard",
        status: "success",
        tenantId: "tenant_a",
        userId: "user_a",
        traceId: "trace_success",
        timestamp: inWindow,
        startedAt: inWindow,
        durationMs: 100
      });
      await insertTrace(db, {
        ...base,
        id: "trc_failed",
        name: "Checkout",
        status: "error",
        tenantId: "tenant_b",
        userId: "user_c",
        traceId: "trace_failed",
        timestamp: olderInWindow,
        startedAt: olderInWindow,
        durationMs: 300
      });

      await insertLlmCall(db, {
        ...base,
        id: "llm_success",
        provider: "openai",
        model: "gpt-5",
        promptName: "generate_sql",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: "0.300000",
        latencyMs: 1200,
        status: "success",
        tenantId: "tenant_a",
        userId: "user_b",
        traceId: "trace_llm",
        timestamp: inWindow
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_failed",
        provider: "anthropic",
        model: "claude",
        promptName: null,
        inputTokens: 20,
        outputTokens: 10,
        costUsd: "0.100000",
        latencyMs: 900,
        status: "error",
        error: "provider_error",
        tenantId: "tenant_b",
        userId: "user_c",
        traceId: "trace_failed",
        timestamp: olderInWindow
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_unspecified_prompt",
        provider: "openai",
        model: "gpt-5",
        promptName: null,
        inputTokens: 5,
        outputTokens: 5,
        costUsd: "0.050000",
        latencyMs: 500,
        status: "success",
        timestamp: inWindow
      });

      const overview = await getOverview(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h",
        now
      });

      expect(overview.scope).toEqual({ projectId: project.id, environmentId: environment.id });
      expect(overview.window).toBe("24h");
      expect(overview.range.bucket).toBe("hour");
      expect(overview.kpis).toMatchObject({
        events: 3,
        activeUsers: 3,
        activeTenants: 2,
        errors: 3,
        openErrors: 2,
        traces: 2,
        failedTraces: 1,
        averageTraceDurationMs: 200,
        p95TraceDurationMs: expect.any(Number),
        llmCalls: 3,
        failedLlmCalls: 1,
        llmInputTokens: 125,
        llmOutputTokens: 65,
        llmCostUsd: "0.450000"
      });
      expect(overview.top.events).toEqual([
        { name: "dashboard_created", total: 2 },
        { name: "chat_started", total: 1 }
      ]);
      expect(overview.top.tenantsByUsage[0]).toEqual({ tenantId: "tenant_a", total: 6 });
      expect(overview.top.tenantsByErrors).toEqual([
        { tenantId: "tenant_a", total: 2 },
        { tenantId: "tenant_b", total: 1 }
      ]);
      expect(overview.top.tenantsByLlmCost).toEqual([
        { tenantId: "tenant_a", totalCostUsd: "0.300000" },
        { tenantId: "tenant_b", totalCostUsd: "0.100000" }
      ]);
      expect(overview.top.llmModels).toEqual([
        { model: "gpt-5", total: 2, totalCostUsd: "0.350000" },
        { model: "claude", total: 1, totalCostUsd: "0.100000" }
      ]);
      expect(overview.top.llmPrompts).toEqual([
        { promptName: "Unspecified", total: 2, totalCostUsd: "0.150000" },
        { promptName: "generate_sql", total: 1, totalCostUsd: "0.300000" }
      ]);
      expect(overview.top.errorStatus).toEqual([
        { status: "open", total: 2 },
        { status: "resolved", total: 1 }
      ]);
      expect(overview.recent.errors).toEqual([
        expect.objectContaining({ id: "err_fatal", message: "Worker crashed", severity: "fatal", status: "open" }),
        expect.objectContaining({ id: "err_recent", message: "Checkout failed", severity: "critical", status: "open" }),
        expect.objectContaining({ id: "err_warning", message: "Slow response", severity: "warning", status: "resolved" })
      ]);
      expect(overview.recent.failedTraces).toEqual([expect.objectContaining({ id: "trc_failed", status: "error" })]);
      expect(overview.recent.failedLlmCalls).toEqual([
        expect.objectContaining({ id: "llm_failed", status: "error", promptName: "Unspecified" })
      ]);
      expect(overview.trends.usage).toHaveLength(25);
      expect(overview.trends.errors).toHaveLength(25);
      expect(overview.trends.latency).toHaveLength(25);
      expect(overview.trends.aiCost).toHaveLength(25);
      expect(overview.trends.usage.map((bucket) => bucket.bucketStart)).toEqual(
        overview.trends.aiCost.map((bucket) => bucket.bucketStart)
      );
      expect(overview.trends.errors.find((bucket) => bucket.bucketStart === "2026-05-05T10:00:00.000Z")).toMatchObject({
        errors: 2,
        openErrors: 2,
        severeErrors: 2
      });
    });
  });

  it("lists entity tenants by deterministic impact score", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Entities Summary" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date("2026-05-05T12:00:00.000Z");
      const receivedAt = new Date("2026-05-05T12:00:01.000Z");
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        receivedAt,
        source: "api",
        release: "1.0.0"
      };

      await insertEvent(db, {
        ...base,
        id: "evt_entity_alpha",
        timestamp: new Date("2026-05-05T11:55:00.000Z"),
        name: "checkout.started",
        tenantId: "tenant_alpha",
        userId: "user_alpha",
        sessionId: "session_alpha",
        traceId: "trace_alpha"
      });
      await insertError(db, {
        ...base,
        id: "err_entity_alpha",
        timestamp: new Date("2026-05-05T11:56:00.000Z"),
        message: "Payment failed",
        type: "PaymentError",
        severity: "critical",
        status: "open",
        tenantId: "tenant_alpha",
        userId: "user_alpha",
        sessionId: "session_alpha",
        traceId: "trace_alpha"
      });
      await insertTrace(db, {
        ...base,
        id: "trc_entity_alpha",
        timestamp: new Date("2026-05-05T11:57:00.000Z"),
        name: "checkout",
        status: "error",
        startedAt: new Date("2026-05-05T11:57:00.000Z"),
        durationMs: 2000,
        tenantId: "tenant_alpha",
        userId: "user_alpha",
        sessionId: "session_alpha",
        traceId: "trace_alpha"
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_entity_alpha",
        timestamp: new Date("2026-05-05T11:58:00.000Z"),
        provider: "openai",
        model: "gpt-5",
        promptName: "summarize_checkout",
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: "12.500000",
        latencyMs: 800,
        status: "error",
        tenantId: "tenant_alpha",
        userId: "user_alpha",
        sessionId: "session_alpha",
        traceId: "trace_alpha"
      });
      await insertEvent(db, {
        ...base,
        id: "evt_entity_unassigned",
        timestamp: new Date("2026-05-05T11:59:00.000Z"),
        name: "anonymous.activity",
        userId: "anonymous_user",
        sessionId: "anonymous_session"
      });
      await insertEvent(db, {
        ...base,
        id: "evt_entity_old",
        timestamp: new Date("2026-04-01T12:00:00.000Z"),
        name: "outside.window",
        tenantId: "tenant_old",
        userId: "user_old",
        sessionId: "session_old"
      });

      const result = await listEntityTenants(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        limit: 50,
        now
      });

      expect(result.window).toBe("7d");
      expect(result.range).toEqual({ from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" });
      expect(result.tenants.map((tenant) => tenant.label)).toEqual(["tenant_alpha", "Unassigned"]);
      expect(result.tenants[0]).toMatchObject({
        tenantId: "tenant_alpha",
        isUnassigned: false,
        events: 1,
        errors: 1,
        openErrors: 1,
        severeErrors: 1,
        traces: 1,
        failedTraces: 1,
        llmCalls: 1,
        failedLlmCalls: 1,
        llmCostUsd: "12.500000",
        activeUsers: 1,
        activeSessions: 1,
        lastSeenAt: "2026-05-05T11:58:00.000Z"
      });
      expect(result.tenants[0].impactScore).toBe(39.125);
      expect(result.tenants[1]).toMatchObject({ tenantId: null, label: "Unassigned", isUnassigned: true, events: 1 });
    });
  });

  it("searches entity tenants by tenant id or user id", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Entities Search" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date("2026-05-05T12:00:00.000Z");
      const receivedAt = new Date("2026-05-05T12:00:01.000Z");
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        receivedAt,
        source: "api",
        release: "1.0.0"
      };

      await insertEvent(db, {
        ...base,
        id: "evt_entity_search_tenant",
        timestamp: new Date("2026-05-05T10:00:00.000Z"),
        name: "tenant.match",
        tenantId: "tenant_search",
        userId: "user_a",
        sessionId: "session_a"
      });
      await insertError(db, {
        ...base,
        id: "err_entity_search_user",
        timestamp: new Date("2026-05-05T10:01:00.000Z"),
        message: "User matched",
        severity: "warning",
        status: "open",
        tenantId: "tenant_beta",
        userId: "user_search",
        sessionId: "session_b"
      });

      const byTenant = await listEntityTenants(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "tenant_sea",
        limit: 50,
        now
      });
      expect(byTenant.tenants.map((tenant) => tenant.tenantId)).toEqual(["tenant_search"]);

      const byUser = await listEntityTenants(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "user_sea",
        limit: 50,
        now
      });
      expect(byUser.tenants.map((tenant) => tenant.tenantId)).toEqual(["tenant_beta"]);
    });
  });

  it("lists users by deterministic impact score", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Users Summary" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date("2026-05-05T12:00:00.000Z");
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_alpha",
        receivedAt: new Date("2026-05-05T12:00:01.000Z"),
        source: "api",
        release: "1.0.0",
        metadata: {}
      };

      await insertEvent(db, {
        ...base,
        id: "evt_user_alpha",
        timestamp: new Date("2026-05-05T11:55:00.000Z"),
        name: "checkout.started",
        userId: "user_alpha",
        sessionId: "session_alpha",
        traceId: "trace_alpha"
      });
      await insertError(db, {
        ...base,
        id: "err_user_alpha",
        timestamp: new Date("2026-05-05T11:56:00.000Z"),
        message: "Payment failed",
        type: "PaymentError",
        severity: "critical",
        status: "open",
        fingerprint: "payment_failed",
        userId: "user_alpha",
        sessionId: "session_alpha",
        traceId: "trace_alpha"
      });
      await insertTrace(db, {
        ...base,
        id: "trc_user_alpha",
        timestamp: new Date("2026-05-05T11:57:00.000Z"),
        name: "checkout",
        status: "error",
        startedAt: new Date("2026-05-05T11:57:00.000Z"),
        durationMs: 2000,
        userId: "user_alpha",
        sessionId: "session_alpha",
        traceId: "trace_alpha"
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_user_alpha",
        timestamp: new Date("2026-05-05T11:58:00.000Z"),
        provider: "openai",
        model: "gpt-5",
        promptName: "summarize_checkout",
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: "12.500000",
        latencyMs: 800,
        status: "error",
        userId: "user_alpha",
        sessionId: "session_alpha",
        traceId: "trace_alpha"
      });
      await insertEvent(db, {
        ...base,
        id: "evt_user_anonymous",
        timestamp: new Date("2026-05-05T11:59:00.000Z"),
        name: "anonymous.activity",
        sessionId: "anonymous_session"
      });
      await insertEvent(db, {
        ...base,
        id: "evt_user_old",
        timestamp: new Date("2026-04-01T12:00:00.000Z"),
        name: "outside.window",
        userId: "user_old",
        sessionId: "session_old"
      });

      const result = await listUsersActivity(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        limit: 50,
        now
      });

      expect(result.window).toBe("7d");
      expect(result.range).toEqual({ from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" });
      expect(result.users.map((user) => user.label)).toEqual(["user_alpha", "Anonymous / Unassigned"]);
      expect(result.users[0]).toMatchObject({
        userId: "user_alpha",
        isAnonymous: false,
        events: 1,
        errors: 1,
        openErrors: 1,
        severeErrors: 1,
        traces: 1,
        failedTraces: 1,
        llmCalls: 1,
        failedLlmCalls: 1,
        llmCostUsd: "12.500000",
        activeTenants: 1,
        activeSessions: 1,
        lastSeenAt: "2026-05-05T11:58:00.000Z"
      });
      expect(result.users[0].impactScore).toBe(39.125);
      expect(result.users[1]).toMatchObject({ userId: null, label: "Anonymous / Unassigned", isAnonymous: true, events: 1 });
    });
  });

  it("searches users by user id, tenant id, or session id and filters by tenant", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Users Search" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date("2026-05-05T12:00:00.000Z");
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        receivedAt: new Date("2026-05-05T12:00:01.000Z"),
        source: "api",
        release: "1.0.0",
        metadata: {}
      };

      await insertEvent(db, {
        ...base,
        id: "evt_user_search_one",
        timestamp: new Date("2026-05-05T10:00:00.000Z"),
        name: "user.match",
        tenantId: "tenant_match",
        userId: "user_match",
        sessionId: "session_match"
      });
      await insertEvent(db, {
        ...base,
        id: "evt_user_search_other",
        timestamp: new Date("2026-05-05T10:01:00.000Z"),
        name: "other.user",
        tenantId: "tenant_other",
        userId: "user_other",
        sessionId: "session_other"
      });

      const bySession = await listUsersActivity(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "session_match",
        limit: 50,
        now
      });
      expect(bySession.users.map((user) => user.userId)).toEqual(["user_match"]);

      const byTenant = await listUsersActivity(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        tenantId: "tenant_other",
        limit: 50,
        now
      });
      expect(byTenant.users.map((user) => user.userId)).toEqual(["user_other"]);
    });
  });

  it("gets user detail with recent sessions and cross-signal timeline", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "User Detail" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date("2026-05-05T12:00:00.000Z");
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_alpha",
        userId: "user_detail",
        receivedAt: new Date("2026-05-05T12:00:01.000Z"),
        source: "api",
        release: "1.0.0",
        metadata: { hidden: true }
      };

      await insertEvent(db, {
        ...base,
        id: "evt_user_detail",
        timestamp: new Date("2026-05-05T11:50:00.000Z"),
        name: "checkout.started",
        sessionId: "session_alpha",
        traceId: "trace_alpha",
        properties: { hidden: true }
      });
      await insertError(db, {
        ...base,
        id: "err_user_detail",
        timestamp: new Date("2026-05-05T11:51:00.000Z"),
        message: "Checkout failed",
        severity: "error",
        stack: "hidden",
        status: "open",
        fingerprint: "checkout_failed",
        context: { hidden: true },
        sessionId: "session_alpha",
        traceId: "trace_alpha"
      });
      await insertTrace(db, {
        ...base,
        id: "trc_user_detail",
        timestamp: new Date("2026-05-05T11:52:00.000Z"),
        name: "checkout",
        status: "success",
        startedAt: new Date("2026-05-05T11:52:00.000Z"),
        endedAt: new Date("2026-05-05T11:52:01.000Z"),
        durationMs: 1000,
        sessionId: "session_alpha",
        traceId: "trace_alpha"
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_user_detail",
        timestamp: new Date("2026-05-05T11:53:00.000Z"),
        provider: "openai",
        model: "gpt-5",
        promptName: "cart.summary",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: "0.250000",
        latencyMs: 500,
        status: "success",
        inputPreview: "hidden",
        outputPreview: "hidden",
        sessionId: "session_beta",
        traceId: "trace_beta"
      });
      await insertSpan(db, {
        ...base,
        id: "spn_user_detail",
        timestamp: new Date("2026-05-05T11:54:00.000Z"),
        traceId: "trace_alpha",
        name: "hidden span",
        status: "error",
        startedAt: new Date("2026-05-05T11:54:00.000Z"),
        input: { hidden: true },
        output: { hidden: true },
        sessionId: "session_alpha"
      });

      const result = await getUserDetail(db, "user_detail", {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        limit: 50,
        now
      });

      expect(result.user).toMatchObject({
        userId: "user_detail",
        events: 1,
        errors: 1,
        traces: 1,
        llmCalls: 1,
        activeTenants: 1,
        activeSessions: 2
      });
      expect(result.recentSessions.map((session) => session.sessionId)).toEqual(["session_beta", "session_alpha"]);
      expect(result.timeline.map((row) => `${row.type}:${row.id}`)).toEqual([
        "llm:llm_user_detail",
        "trace:trc_user_detail",
        "error:err_user_detail",
        "event:evt_user_detail"
      ]);
      expect(result.timeline.map((row) => row.id)).not.toContain("spn_user_detail");
      expect(result.timeline[0]).not.toHaveProperty("inputPreview");
      expect(result.timeline[1]).not.toHaveProperty("metadata");
    });
  });

  it("filters user detail by tenant and signal type and paginates timeline", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "User Cursor" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date("2026-05-05T12:00:00.000Z");
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        userId: "user_cursor",
        sessionId: "session_cursor",
        receivedAt: new Date("2026-05-05T12:00:01.000Z"),
        source: "api",
        release: "1.0.0",
        metadata: {}
      };

      for (const [id, timestamp, tenantId] of [
        ["evt_user_cursor_1", "2026-05-05T11:59:00.000Z", "tenant_cursor"],
        ["evt_user_cursor_2", "2026-05-05T11:58:00.000Z", "tenant_cursor"],
        ["evt_user_cursor_other", "2026-05-05T11:57:00.000Z", "tenant_other"]
      ] as const) {
        await insertEvent(db, {
          ...base,
          id,
          timestamp: new Date(timestamp),
          name: id,
          tenantId
        });
      }

      const firstPage = await getUserDetail(db, "user_cursor", {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        tenantId: "tenant_cursor",
        signalType: "event",
        limit: 1,
        now
      });
      expect(firstPage.timeline.map((row) => row.id)).toEqual(["evt_user_cursor_1"]);
      expect(firstPage.cursor).toEqual(expect.any(String));

      const secondPage = await getUserDetail(db, "user_cursor", {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        tenantId: "tenant_cursor",
        signalType: "event",
        limit: 1,
        cursor: decodeUserCursorForTest(firstPage.cursor!),
        now
      });
      expect(secondPage.timeline.map((row) => row.id)).toEqual(["evt_user_cursor_2"]);
      expect(secondPage.cursor).toBeUndefined();
    });
  });

  it("gets entity tenant detail with top users and cross-signal timeline", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Entities Detail" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date("2026-05-05T12:00:00.000Z");
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_detail",
        traceId: "trace_detail",
        metadata: {}
      };

      await insertEvent(db, {
        ...base,
        id: "evt_detail_1",
        timestamp: new Date("2026-05-05T11:55:00.000Z"),
        receivedAt: new Date("2026-05-05T11:55:01.000Z"),
        name: "checkout.started",
        userId: "user_1",
        sessionId: "session_1",
        properties: { secret: "hidden event" }
      });
      await insertError(db, {
        ...base,
        id: "err_detail_1",
        timestamp: new Date("2026-05-05T11:56:00.000Z"),
        receivedAt: new Date("2026-05-05T11:56:01.000Z"),
        message: "Checkout failed",
        type: "CheckoutError",
        severity: "error",
        stack: "hidden stack",
        status: "open",
        fingerprint: "checkout_failed",
        context: { secret: "hidden context" },
        userId: "user_1",
        sessionId: "session_1"
      });
      await insertTrace(db, {
        ...base,
        id: "trc_detail_1",
        timestamp: new Date("2026-05-05T11:57:00.000Z"),
        receivedAt: new Date("2026-05-05T11:57:01.000Z"),
        name: "checkout trace",
        status: "error",
        startedAt: new Date("2026-05-05T11:57:00.000Z"),
        endedAt: new Date("2026-05-05T11:57:03.000Z"),
        durationMs: 3000,
        userId: "user_2",
        sessionId: "session_2"
      });
      await insertSpan(db, {
        ...base,
        id: "spn_detail_1",
        timestamp: new Date("2026-05-05T11:57:30.000Z"),
        receivedAt: new Date("2026-05-05T11:57:31.000Z"),
        parentSpanId: undefined,
        name: "span excluded",
        status: "error",
        startedAt: new Date("2026-05-05T11:57:30.000Z"),
        endedAt: new Date("2026-05-05T11:57:31.000Z"),
        durationMs: 1000,
        input: { hidden: true },
        output: null,
        error: { hidden: true },
        userId: "user_2",
        sessionId: "session_2"
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_detail_1",
        timestamp: new Date("2026-05-05T11:58:00.000Z"),
        receivedAt: new Date("2026-05-05T11:58:01.000Z"),
        provider: "openai",
        model: "gpt-5",
        promptName: "explain_checkout",
        inputTokens: 120,
        outputTokens: 80,
        costUsd: "1.250000",
        latencyMs: 500,
        status: "success",
        inputPreview: "hidden input",
        outputPreview: "hidden output",
        userId: "user_2",
        sessionId: "session_2"
      });
      await insertEvent(db, {
        ...base,
        id: "evt_detail_same_time",
        timestamp: new Date("2026-05-05T11:59:00.000Z"),
        receivedAt: new Date("2026-05-05T11:59:01.000Z"),
        name: "same.timestamp.event"
      });
      await insertError(db, {
        ...base,
        id: "err_detail_same_time",
        timestamp: new Date("2026-05-05T11:59:00.000Z"),
        receivedAt: new Date("2026-05-05T11:59:01.000Z"),
        message: "Same timestamp error",
        severity: "warning"
      });
      await insertTrace(db, {
        ...base,
        id: "trc_detail_same_time",
        timestamp: new Date("2026-05-05T11:59:00.000Z"),
        receivedAt: new Date("2026-05-05T11:59:01.000Z"),
        name: "same timestamp trace",
        status: "success",
        startedAt: new Date("2026-05-05T11:59:00.000Z")
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_detail_same_time",
        timestamp: new Date("2026-05-05T11:59:00.000Z"),
        receivedAt: new Date("2026-05-05T11:59:01.000Z"),
        provider: "anthropic",
        model: "claude-4",
        costUsd: "0.100000",
        status: "success"
      });

      const detail = await getEntityTenantDetail(db, "tenant_detail", {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        limit: 50,
        now
      });

      expect(detail.tenant.tenantId).toBe("tenant_detail");
      expect(detail.topUsers).toEqual([
        expect.objectContaining({
          userId: "user_2",
          traces: 1,
          llmCalls: 1,
          llmCostUsd: "1.250000",
          lastSeenAt: "2026-05-05T11:58:00.000Z"
        }),
        expect.objectContaining({
          userId: "user_1",
          events: 1,
          errors: 1,
          lastSeenAt: "2026-05-05T11:56:00.000Z"
        })
      ]);
      expect(detail.timeline.map((row) => row.id)).toEqual([
        "err_detail_same_time",
        "evt_detail_same_time",
        "llm_detail_same_time",
        "trc_detail_same_time",
        "llm_detail_1",
        "trc_detail_1",
        "err_detail_1",
        "evt_detail_1"
      ]);
      expect(detail.timeline).toEqual([
        expect.objectContaining({
          type: "error",
          label: "Same timestamp error",
          message: "Same timestamp error"
        }),
        expect.objectContaining({ type: "event", label: "same.timestamp.event", eventName: "same.timestamp.event" }),
        expect.objectContaining({ type: "llm", label: "anthropic / claude-4", provider: "anthropic", model: "claude-4" }),
        expect.objectContaining({ type: "trace", label: "same timestamp trace", name: "same timestamp trace" }),
        expect.objectContaining({
          type: "llm",
          label: "openai / gpt-5",
          provider: "openai",
          model: "gpt-5",
          promptName: "explain_checkout",
          costUsd: "1.250000"
        }),
        expect.objectContaining({
          type: "trace",
          label: "checkout trace",
          name: "checkout trace",
          durationMs: 3000
        }),
        expect.objectContaining({
          type: "error",
          label: "Checkout failed",
          message: "Checkout failed",
          severity: "error",
          status: "open"
        }),
        expect.objectContaining({ type: "event", label: "checkout.started", eventName: "checkout.started" })
      ]);
      expect(JSON.stringify(detail.timeline)).not.toContain("hidden");
      expect(JSON.stringify(detail.timeline)).not.toContain("spn_detail_1");
    });
  });

  it("filters entity tenant detail by user and signal type and paginates with a cursor", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Entities Cursor" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date("2026-05-05T12:00:00.000Z");

      for (const [id, minute, userId] of [
        ["evt_cursor_1", "55", "user_cursor"],
        ["evt_cursor_2", "55", "user_cursor"],
        ["evt_cursor_3", "55", "user_cursor"],
        ["evt_cursor_other_user", "54", "other_user"]
      ] as const) {
        await insertEvent(db, {
          id,
          projectId: project.id,
          environmentId: environment.id,
          timestamp: new Date(`2026-05-05T11:${minute}:00.000Z`),
          receivedAt: new Date(`2026-05-05T11:${minute}:01.000Z`),
          name: id,
          tenantId: "tenant_cursor",
          userId,
          sessionId: "session_cursor",
          properties: {}
        });
      }

      const firstPage = await getEntityTenantDetail(db, "tenant_cursor", {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        userId: "user_cursor",
        signalType: "event",
        limit: 1,
        now
      });

      expect(firstPage.timeline.map((row) => row.id)).toEqual(["evt_cursor_1"]);
      expect(firstPage.cursor).toEqual(expect.any(String));
      expect(firstPage.topUsers.map((user) => user.userId)).toEqual(["user_cursor", "other_user"]);

      const secondPage = await getEntityTenantDetail(db, "tenant_cursor", {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        userId: "user_cursor",
        signalType: "event",
        limit: 2,
        cursor: decodeEntityCursorForTest(firstPage.cursor!),
        now
      });

      expect(secondPage.timeline.map((row) => row.id)).toEqual(["evt_cursor_2", "evt_cursor_3"]);
      expect(secondPage.cursor).toBeUndefined();
    });
  });

  it("gets exact entity tenant detail summary outside the first tenant list page", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Entities Detail Exact Summary" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date("2026-05-05T12:00:00.000Z");
      const receivedAt = new Date("2026-05-05T12:00:01.000Z");
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        receivedAt
      };

      for (let index = 0; index < 101; index += 1) {
        await insertError(db, {
          ...base,
          id: `err_detail_rank_${index}`,
          timestamp: new Date("2026-05-05T11:00:00.000Z"),
          message: `Ranked tenant ${index}`,
          severity: "warning",
          status: "resolved",
          tenantId: `tenant_rank_${index}`,
          userId: `user_rank_${index}`,
          sessionId: `session_rank_${index}`
        });
      }
      await insertEvent(db, {
        ...base,
        id: "evt_tail_summary",
        timestamp: new Date("2026-05-05T11:59:00.000Z"),
        name: "tail.summary",
        tenantId: "tenant_tail",
        userId: "user_tail",
        sessionId: "session_tail"
      });

      const detail = await getEntityTenantDetail(db, "tenant_tail", {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        limit: 10,
        now
      });

      expect(detail.tenant).toMatchObject({
        tenantId: "tenant_tail",
        events: 1,
        errors: 0,
        activeUsers: 1,
        activeSessions: 1,
        lastSeenAt: "2026-05-05T11:59:00.000Z"
      });
      expect(detail.timeline.map((row) => row.id)).toEqual(["evt_tail_summary"]);
    });
  });

  it("buckets overview trends in UTC when the database session timezone is not UTC", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await sql`set timezone to 'America/Sao_Paulo'`.execute(db);

      const project = await createProject(db, { name: "Overview UTC Buckets" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const timestamp = new Date("2026-05-05T00:30:00.000Z");
      const receivedAt = new Date("2026-05-05T00:30:01.000Z");
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_utc",
        userId: "user_utc",
        sessionId: "session_utc",
        traceId: "trace_utc",
        timestamp,
        receivedAt
      };

      await insertEvent(db, {
        ...base,
        id: "evt_utc_bucket",
        name: "utc_bucket_event"
      });
      await insertError(db, {
        ...base,
        id: "err_utc_bucket",
        message: "UTC bucket error",
        severity: "critical",
        status: "open"
      });
      await insertTrace(db, {
        ...base,
        id: "trc_utc_bucket",
        name: "UTC bucket trace",
        status: "success",
        startedAt: timestamp,
        durationMs: 120
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_utc_bucket",
        provider: "openai",
        model: "gpt-5",
        promptName: "utc_bucket",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: "0.010000",
        status: "success"
      });

      const overview = await getOverview(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h",
        now: new Date("2026-05-05T02:00:00.000Z")
      });

      const usageBucket = overview.trends.usage.find(
        (bucket) => bucket.bucketStart === "2026-05-05T00:00:00.000Z"
      );
      expect(usageBucket).toEqual({
        bucketStart: "2026-05-05T00:00:00.000Z",
        events: 1,
        traces: 1,
        llmCalls: 1
      });
      expect(overview.trends.errors.find((bucket) => bucket.bucketStart === "2026-05-05T00:00:00.000Z")).toMatchObject({
        errors: 1,
        openErrors: 1,
        severeErrors: 1
      });
      expect(overview.trends.latency.find((bucket) => bucket.bucketStart === "2026-05-05T00:00:00.000Z")).toMatchObject({
        averageTraceDurationMs: 120,
        p95TraceDurationMs: 120
      });
      expect(overview.trends.aiCost.find((bucket) => bucket.bucketStart === "2026-05-05T00:00:00.000Z")).toMatchObject({
        llmCostUsd: "0.010000",
        llmCalls: 1
      });

      const dailyOverview = await getOverview(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        now: new Date("2026-05-05T02:00:00.000Z")
      });
      expect(dailyOverview.trends.usage.find((bucket) => bucket.bucketStart === "2026-05-05T00:00:00.000Z")).toMatchObject(
        {
          events: 1,
          traces: 1,
          llmCalls: 1
        }
      );
    });
  });

  it("filters events by exact event name", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Named Events API" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-04T12:00:00.000Z"),
        receivedAt: new Date("2026-05-04T12:00:01.000Z")
      };

      await insertEvent(db, { ...base, id: "evt_named_1", name: "checkout.started" });
      await insertEvent(db, { ...base, id: "evt_named_2", name: "checkout.completed" });

      await expect(
        listEvents(db, { projectId: project.id, environmentId: environment.id, eventName: "checkout.started" })
      ).resolves.toEqual([expect.objectContaining({ id: "evt_named_1", name: "checkout.started" })]);
    });
  });

  it("filters errors by exact severity status and fingerprint", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Filtered Errors API" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-04T12:00:00.000Z"),
        receivedAt: new Date("2026-05-04T12:00:01.000Z")
      };

      await insertError(db, {
        ...base,
        id: "err_filtered_1",
        message: "Checkout fetch failed",
        severity: "critical",
        status: "open",
        fingerprint: "fp_checkout_fetch"
      });
      await insertError(db, {
        ...base,
        id: "err_filtered_2",
        message: "Checkout fetch failed",
        severity: "warning",
        status: "open",
        fingerprint: "fp_checkout_fetch"
      });
      await insertError(db, {
        ...base,
        id: "err_filtered_3",
        message: "Checkout fetch failed",
        severity: "critical",
        status: "resolved",
        fingerprint: "fp_checkout_fetch"
      });
      await insertError(db, {
        ...base,
        id: "err_filtered_4",
        message: "Other error",
        severity: "critical",
        status: "open",
        fingerprint: "fp_other"
      });

      await expect(
        listErrors(db, {
          projectId: project.id,
          environmentId: environment.id,
          severity: "critical",
          status: "open",
          fingerprint: "fp_checkout_fetch"
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "err_filtered_1",
          severity: "critical",
          status: "open",
          fingerprint: "fp_checkout_fetch"
        })
      ]);
    });
  });

  it("rejects telemetry whose environment belongs to another project", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const firstProject = await createProject(db, { name: "Cross Project A" });
      const secondProject = await createProject(db, { name: "Cross Project B" });
      await createEnvironment(db, { projectId: firstProject.id, name: "production" });
      const secondEnvironment = await createEnvironment(db, { projectId: secondProject.id, name: "production" });

      await expect(
        insertEvent(db, {
          id: "evt_cross_project",
          projectId: firstProject.id,
          environmentId: secondEnvironment.id,
          timestamp: new Date("2026-05-02T12:00:00.000Z"),
          receivedAt: new Date("2026-05-02T12:00:01.000Z"),
          name: "invalid_cross_project_event"
        })
      ).rejects.toThrow();
    });
  });

  it("does not find archived users by email", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const user = await createUser(db, {
        email: "archived@example.com",
        passwordHash: "hash",
        isAdmin: false
      });

      await db
        .updateTable("users")
        .set({ archived_at: new Date("2026-05-02T12:00:00.000Z") })
        .where("id", "=", user.id)
        .execute();

      await expect(findUserByEmail(db, "archived@example.com")).resolves.toBeUndefined();
      await expect(
        createUser(db, {
          email: "archived@example.com",
          passwordHash: "new-hash",
          isAdmin: false
        })
      ).resolves.toMatchObject({ email: "archived@example.com" });
    });
  });

  it("finds active users inserted directly with mixed-case email", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`
        INSERT INTO users (id, email, password_hash, is_admin)
        VALUES ('usr_direct_mixed_case', 'DirectMixed@Example.com', 'hash', true)
      `.execute(db);

      await expect(findUserByEmail(db, "directmixed@example.com")).resolves.toMatchObject({
        id: "usr_direct_mixed_case"
      });
    });
  });

  it("links and finds users by Google subject", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const user = await createUser(db, {
        email: "google-user@example.com",
        passwordHash: "hash",
        isAdmin: false
      });

      await expect(linkGoogleSubject(db, user.id, "google-subject-1")).resolves.toMatchObject({
        id: user.id,
        googleSubject: "google-subject-1"
      });
      await expect(findUserByGoogleSubject(db, "google-subject-1")).resolves.toMatchObject({
        id: user.id,
        email: "google-user@example.com"
      });

      await archiveUser(db, user.id);
      await expect(findUserByGoogleSubject(db, "google-subject-1")).resolves.toBeUndefined();
    });
  });

  it("rejects duplicate active users with different email casing", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await createUser(db, {
        email: "Case-Dupe@Example.com",
        passwordHash: "hash",
        isAdmin: false
      });

      await expect(
        createUser(db, {
          email: "case-dupe@example.com",
          passwordHash: "hash",
          isAdmin: false
        })
      ).rejects.toThrow();
    });
  });

  it("rejects bootstrap admin seeding when active email belongs to a non-admin user", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await createUser(db, {
        email: "bootstrap@example.com",
        passwordHash: "hash",
        isAdmin: false
      });

      await expect(
        seedBootstrapAdmin(db, {
          email: "bootstrap@example.com",
          password: "unused"
        })
      ).rejects.toThrow("Bootstrap admin email already belongs to a non-admin user");
    });
  });

  it("rejects bootstrap admin seeding for direct mixed-case non-admin users", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`
        INSERT INTO users (id, email, password_hash, is_admin)
        VALUES ('usr_bootstrap_mixed_non_admin', 'BootstrapMixed@Example.com', 'hash', false)
      `.execute(db);

      await expect(
        seedBootstrapAdmin(db, {
          email: "bootstrapmixed@example.com",
          password: "unused"
        })
      ).rejects.toThrow("Bootstrap admin email already belongs to a non-admin user");
    });
  });

  it("rejects duplicate api key prefixes", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Duplicate Prefix API" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      await createApiKeyRecord(db, {
        projectId: project.id,
        environmentId: environment.id,
        name: "first key",
        prefix: "sh_duplicate",
        hash: "hash-1"
      });

      await expect(
        createApiKeyRecord(db, {
          projectId: project.id,
          environmentId: environment.id,
          name: "second key",
          prefix: "sh_duplicate",
          hash: "hash-2"
        })
      ).rejects.toThrow();
    });
  });

  it("bounds event listing by default and explicit limits", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Bounded Events API" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      for (let index = 0; index < 55; index += 1) {
        await insertEvent(db, {
          id: `evt_bounded_${index}`,
          projectId: project.id,
          environmentId: environment.id,
          timestamp: new Date(Date.UTC(2026, 4, 2, 12, index, 0)),
          receivedAt: new Date(Date.UTC(2026, 4, 2, 12, index, 1)),
          name: "bounded_event"
        });
      }

      const defaultEvents = await listEvents(db, { projectId: project.id, environmentId: environment.id });
      expect(defaultEvents).toHaveLength(50);

      const limitedEvents = await listEvents(db, { projectId: project.id, environmentId: environment.id, limit: 2 });
      expect(limitedEvents).toHaveLength(2);
    });
  });

  it("detects migration checksum mismatches", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum text NOT NULL DEFAULT 'wrong'`.execute(db);
      await sql`UPDATE _migrations SET checksum = 'wrong' WHERE name = '0001_initial.sql'`.execute(db);

      await expect(migrate(db)).rejects.toThrow("Migration 0001_initial.sql checksum mismatch");
    });
  });
});
