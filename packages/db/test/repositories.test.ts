import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedBootstrapAdmin } from "../../../scripts/seed-admin.js";
import { createDb } from "../src/client.js";
import type { Db } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import {
  deleteDeadLetterJob,
  countDeadLetterJobs,
  deleteExpiredDeadLetterJobs,
  deleteDeadLetterJobWithAction,
  getDeadLetterJob,
  insertDeadLetterJob,
  listDeadLetterJobActions,
  listDeadLetterJobs,
  recordDeadLetterJobAction
} from "../src/repositories/dead-letter.js";
import {
  archiveEnvironment,
  archiveProject,
  archiveProjectBrowserOrigin,
  createApiKeyRecord,
  createEnvironment,
  createProject,
  createProjectBrowserOrigin,
  findApiKeyByPrefix,
  getProject,
  listApiKeys,
  listProjectBrowserOrigins,
  listEnvironments,
  listProjects,
  revokeApiKey,
  updateApiKeyRecord,
  updateEnvironment,
  updateProject
} from "../src/repositories/admin.js";
import {
  createAlertRule,
  createNotificationChannel,
  evaluateAlertRule,
  listAlertEscalationsDue,
  listActiveAlertRules,
  listAlertEvents,
  markAlertEventEscalated,
  recordAlertEvent,
  recordNotificationDelivery,
  updateNotificationChannel,
  updateAlertEventTriage,
  updateAlertRule,
  updateAlertRuleEvaluation,
  withAlertEvaluationLock
} from "../src/repositories/alerts.js";
import {
  createHeartbeatMonitor,
  createHttpMonitor,
  listDueHttpMonitors,
  listMonitorChecks,
  listMonitors,
  listStaleHeartbeatMonitors,
  recordHeartbeatCheckIn,
  recordMonitorCheck,
  updateMonitor
} from "../src/repositories/monitors.js";
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
import {
  insertBreadcrumb,
  insertError,
  insertEvent,
  insertLlmCall,
  insertSpan,
  insertTrace
} from "../src/repositories/telemetry-writes.js";
import {
  buildBucketAxis,
  getErrorAggregates,
  getEventAggregates,
  getLlmAggregates,
  getLlmByPrompt,
  getLlmByTenant,
  getLlmCostByModel,
  getLlmSummary,
  getApmEndpoints,
  getOverview,
  getErrorForSourceMapResolution,
  getTraceAggregates,
  listErrors,
  listEvents,
  listLlmCalls,
  listTraceSpans,
  listTraces
} from "../src/repositories/telemetry-query.js";
import { getOperations } from "../src/repositories/operations-query.js";
import { getSessionTimeline } from "../src/repositories/session-timeline.js";
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
import { __test as systemRepositoryTest } from "../src/repositories/system.js";
import { getBackupStatus, recordBackupRun, withBackupLock } from "../src/repositories/backups.js";
import {
  backfillErrorGroups,
  buildErrorGroupingFingerprint,
  extractTopStackFrame,
  getErrorGroup,
  listErrorGroups,
  listErrorGroupsPage,
  normalizeErrorGroupingInput,
  updateErrorGroupStatus,
  updateErrorGroupTriage
} from "../src/repositories/error-groups.js";
import { getErrorGroupIncident, suggestErrorGroupPriority } from "../src/repositories/incidents.js";
import {
  createSourceMapArtifact,
  deleteSourceMapArtifact,
  findSourceMapArtifactForFrame,
  getCachedErrorStackResolution,
  listExpiredSourceMapArtifacts,
  listSourceMapArtifacts,
  listSourceMapArtifactsPage,
  replaceErrorStackResolutions,
  softDeleteSourceMapArtifactForRetention
} from "../src/repositories/source-maps.js";
import {
  createSourceMapUploadTokenRecord,
  findSourceMapUploadTokenByPrefix,
  listSourceMapUploadTokens,
  revokeSourceMapUploadToken,
  updateSourceMapUploadToken,
  updateSourceMapUploadTokenLastUsed
} from "../src/repositories/source-map-upload-tokens.js";
import {
  identifyTenantProfile,
  identifyUserProfile,
  touchTenantProfileLastSeen,
  touchUserProfileLastSeen
} from "../src/repositories/identity-profiles.js";
import { getUserDetail, listUsersActivity, type UserCursor } from "../src/repositories/users-query.js";
import {
  assignIncident,
  addTriageNote,
  listTriageNotes,
  silenceIncident,
  getIncidentMttr
} from "../src/repositories/incident-triage.js";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;

describe("repositories", () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("sigmon")
      .withUsername("sigmon")
      .withPassword("sigmon")
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

  async function seedSourceMapScope(db: Db): Promise<void> {
    await sql`insert into projects (id, name) values ('prj_1', 'Source Map Project') on conflict (id) do nothing`.execute(
      db
    );
    await sql`
      insert into environments (id, project_id, name)
      values ('env_1', 'prj_1', 'Production')
      on conflict (id) do nothing
    `.execute(db);
  }

  async function seedSourceMapUser(db: Db): Promise<{ id: string }> {
    await sql`
      insert into users (id, email, password_hash, is_admin)
      values ('usr_source_maps', 'source-maps@example.com', 'hash', true)
      on conflict (id) do nothing
    `.execute(db);
    return { id: "usr_source_maps" };
  }

  async function insertSourceMapError(
    db: Db,
    input: { id: string; projectId: string; environmentId: string; release: string }
  ): Promise<void> {
    await sql`
      insert into errors (
        id,
        project_id,
        environment_id,
        timestamp,
        received_at,
        message,
        severity,
        release,
        stack
      )
      values (
        ${input.id},
        ${input.projectId},
        ${input.environmentId},
        '2026-05-10T12:00:00.000Z',
        '2026-05-10T12:00:01.000Z',
        'Source mapped error',
        'error',
        ${input.release},
        'TypeError: failed'
      )
    `.execute(db);
  }

  async function seedGroupedError(
    db: Db,
    input: {
      id: string;
      projectId: string;
      environmentId: string;
      message: string;
      severity: string;
      timestamp: Date;
    }
  ) {
    await sql`
      insert into projects (id, name)
      values (${input.projectId}, ${input.projectId})
      on conflict (id) do nothing
    `.execute(db);
    await sql`
      insert into environments (id, project_id, name)
      values (${input.environmentId}, ${input.projectId}, 'production')
      on conflict (id) do nothing
    `.execute(db);
    await insertError(db, {
      id: input.id,
      projectId: input.projectId,
      environmentId: input.environmentId,
      message: input.message,
      severity: input.severity,
      timestamp: input.timestamp,
      receivedAt: input.timestamp
    });
    const groups = await listErrorGroups(db, {
      projectId: input.projectId,
      environmentId: input.environmentId
    });
    const group = groups[0];
    expect(group).toBeDefined();
    return group;
  }

  async function insertProjectAndEnvironment(db: Db, projectId: string, environmentId: string): Promise<void> {
    await sql`insert into projects (id, name) values (${projectId}, ${projectId})`.execute(db);
    await sql`
      insert into environments (id, project_id, name)
      values (${environmentId}, ${projectId}, 'production')
    `.execute(db);
  }

  async function insertTraceRows(
    db: Db,
    projectId: string,
    environmentId: string,
    count: number,
    overrides: { name?: string; durationMs?: number } = {}
  ): Promise<void> {
    const name = overrides.name ?? "GET /checkout";
    const routeKey = name.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
    for (let index = 0; index < count; index += 1) {
      await insertTrace(db, {
        id: `${projectId}_${routeKey}_trace_${index}`,
        traceId: `${projectId}_${routeKey}_trace_id_${index}`,
        projectId,
        environmentId,
        timestamp: new Date("2026-05-24T12:05:00.000Z"),
        receivedAt: new Date("2026-05-24T12:05:00.000Z"),
        name,
        status: "success",
        startedAt: new Date("2026-05-24T12:04:59.000Z"),
        endedAt: new Date("2026-05-24T12:05:00.000Z"),
        durationMs: overrides.durationMs ?? 100,
        metadata: {}
      });
    }
  }

  async function insertErrorRows(
    db: Db,
    projectId: string,
    environmentId: string,
    count: number,
    overrides: { fingerprint?: string; traceName?: string } = {}
  ): Promise<void> {
    const routeKey = overrides.traceName?.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
    for (let index = 0; index < count; index += 1) {
      await insertError(db, {
        id: `${projectId}_error_${index}`,
        traceId: routeKey === undefined ? undefined : `${projectId}_${routeKey}_trace_id_${index}`,
        projectId,
        environmentId,
        timestamp: new Date("2026-05-24T12:05:30.000Z"),
        receivedAt: new Date("2026-05-24T12:05:30.000Z"),
        message: "Checkout failed",
        severity: "error",
        status: "open",
        fingerprint: overrides.fingerprint,
        metadata: {},
        context: {}
      });
    }
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
      await sql`select id, type, threshold, escalation_minutes, escalation_channel_id from alert_rules limit 0`.execute(db);
      await sql`select id, observed_value, acknowledged_at, snoozed_until, escalation_due_at, escalated_at from alert_events limit 0`.execute(db);
      await sql`select id, status from notification_deliveries limit 0`.execute(db);
    });
  });

  it("has monitor and expanded alerting tables available", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`select type, email_recipients from notification_channels limit 0`.execute(db);
      await sql`select route_pattern, minimum_sample_size from alert_rules limit 0`.execute(db);
      await sql`select id, kind, status from monitors limit 0`.execute(db);
      await sql`select monitor_id, status, latency_ms from monitor_checks limit 0`.execute(db);
      await sql`select project_id, environment_id from dead_letter_jobs limit 0`.execute(db);
      await insertProjectAndEnvironment(db, "prj_alert_migration", "env_alert_migration");
      await sql`
        insert into alert_rules (
          id, project_id, environment_id, name, type, severity, window_minutes, threshold, cooldown_minutes
        )
        values (
          'rule_dead_letter_migration', 'prj_alert_migration', 'env_alert_migration', 'Dead letters',
          'dead_letter_count', 'warning', 5, 1, 10
        )
      `.execute(db);
    });
  });

  it("identity profile tables exist", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`select project_id, environment_id, user_id, traits from user_profiles limit 0`.execute(db);
      await sql`select project_id, environment_id, tenant_id, traits from tenant_profiles limit 0`.execute(db);
    });
  });

  it("incident triage migration adds columns, triage_notes table, and backfills incident numbers", async () => {
    await withDb(async (db) => {
      await migrate(db);

      // new columns exist on error_groups
      await sql`select assigned_to_user_id, silenced_until, incident_number from error_groups limit 0`.execute(db);
      // triage_notes table exists with correct columns
      await sql`select id, error_group_id, author_user_id, author_email, body, created_at from triage_notes limit 0`.execute(db);

      // insert an error which triggers group creation, then verify incident_number is assigned
      await insertProjectAndEnvironment(db, "prj_triage_test", "env_triage_test");
      await insertError(db, {
        id: "err_triage_inc_001",
        projectId: "prj_triage_test",
        environmentId: "env_triage_test",
        message: "Triage migration test error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z"),
        receivedAt: new Date("2026-06-01T10:00:01.000Z")
      });

      const group = await db
        .selectFrom("error_groups")
        .select(["id", "incident_number"])
        .where("project_id", "=", "prj_triage_test")
        .where("environment_id", "=", "env_triage_test")
        .executeTakeFirstOrThrow();

      expect(group.incident_number).not.toBeNull();
      expect(group.incident_number).toMatch(/^INC-\d{4}$/);
    });
  });

  it("incident_number is stable across many occurrences of the same group and sequence does not inflate", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_seq_stable", "env_seq_stable");

      // Insert 5 occurrences of the same logical error (same fingerprint via same message)
      for (let i = 1; i <= 5; i++) {
        await insertError(db, {
          id: `err_seq_stable_${i}`,
          projectId: "prj_seq_stable",
          environmentId: "env_seq_stable",
          message: "Stable sequence error",
          severity: "error",
          timestamp: new Date(`2026-06-01T10:0${i}:00.000Z`),
          receivedAt: new Date(`2026-06-01T10:0${i}:01.000Z`)
        });
      }

      const group = await db
        .selectFrom("error_groups")
        .select(["id", "incident_number", "occurrence_count"])
        .where("project_id", "=", "prj_seq_stable")
        .where("environment_id", "=", "env_seq_stable")
        .executeTakeFirstOrThrow();

      // exactly one group was created
      expect(group.incident_number).not.toBeNull();
      expect(group.incident_number).toMatch(/^INC-\d{4}$/);
      // all 5 occurrences landed on the same group
      expect(Number(group.occurrence_count)).toBe(5);

      // the sequence must have advanced by exactly 1 (one genuine new group)
      // we verify by inserting a second DISTINCT group and checking the numbers are consecutive
      await insertError(db, {
        id: "err_seq_stable_second_group",
        projectId: "prj_seq_stable",
        environmentId: "env_seq_stable",
        message: "Different error for second group",
        severity: "warning",
        timestamp: new Date("2026-06-01T10:10:00.000Z"),
        receivedAt: new Date("2026-06-01T10:10:01.000Z")
      });

      const groups = await db
        .selectFrom("error_groups")
        .select(["incident_number"])
        .where("project_id", "=", "prj_seq_stable")
        .where("environment_id", "=", "env_seq_stable")
        .orderBy("incident_number", "asc")
        .execute();

      expect(groups).toHaveLength(2);
      const [first, second] = groups;
      expect(first.incident_number).toMatch(/^INC-\d{4}$/);
      expect(second.incident_number).toMatch(/^INC-\d{4}$/);
      // the two numbers must be consecutive — no sequence slots wasted by the 5 extra occurrences
      const firstNum = parseInt(first.incident_number!.slice(4), 10);
      const secondNum = parseInt(second.incident_number!.slice(4), 10);
      expect(secondNum - firstNum).toBe(1);
    });
  });

  it("runs backup metadata migrations", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`select id, status, trigger, filename, checksum_sha256, s3_key from backup_runs limit 0`.execute(db);
    });
  });

  it("runs error group migrations", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`select id, grouping_fingerprint, status from error_groups limit 0`.execute(db);
      await sql`select error_group_id, grouping_fingerprint from errors limit 0`.execute(db);
    });
  });

  it("runs source map migrations", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`select id, release, minified_file from source_map_artifacts limit 0`.execute(db);
      await sql`select error_id, frame_index, original_source from error_stack_resolutions limit 0`.execute(db);
    });
  });

  it("runs breadcrumb migrations", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`select id, type, category, message, level, data from breadcrumbs limit 0`.execute(db);
      await sql`select deleted_breadcrumbs, breadcrumbs_days from retention_runs limit 0`.execute(db);
    });
  });

  it("runs source map upload token migrations", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`select id, prefix, hash, last_used_at, revoked_at from source_map_upload_tokens limit 0`.execute(db);
      await sql`select uploaded_by_user_id, uploaded_by_token_id from source_map_artifacts limit 0`.execute(db);
    });
  });

  it("creates stable cursor and session timeline indexes", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const rows = await sql<{ index_name: string }>`
        select index_name
        from (
          values
            ('events_scope_time_id_idx'),
            ('errors_scope_time_id_idx'),
            ('llm_calls_scope_time_id_idx'),
            ('traces_scope_time_id_idx'),
            ('spans_scope_time_id_idx'),
            ('events_scope_session_time_id_idx'),
            ('errors_scope_session_time_id_idx'),
            ('llm_calls_scope_session_time_id_idx'),
            ('traces_scope_session_time_id_idx'),
            ('spans_scope_session_time_id_idx'),
            ('source_map_artifacts_scope_created_id_idx'),
            ('monitor_checks_monitor_checked_id_idx'),
            ('events_scope_trace_time_id_idx'),
            ('errors_scope_trace_time_id_idx'),
            ('llm_calls_scope_trace_time_id_idx'),
            ('traces_scope_trace_time_id_idx'),
            ('spans_scope_trace_time_id_idx'),
            ('events_scope_tenant_time_id_idx'),
            ('errors_scope_tenant_time_id_idx'),
            ('llm_calls_scope_tenant_time_id_idx'),
            ('traces_scope_tenant_time_id_idx'),
            ('spans_scope_tenant_time_id_idx'),
            ('events_scope_user_time_id_idx'),
            ('errors_scope_user_time_id_idx'),
            ('llm_calls_scope_user_time_id_idx'),
            ('traces_scope_user_time_id_idx'),
            ('spans_scope_user_time_id_idx'),
            ('source_map_artifacts_scope_release_created_id_idx'),
            ('errors_group_tenant_idx'),
            ('errors_group_user_idx'),
            ('error_groups_scope_cursor_order_idx'),
            ('alert_events_scope_triggered_created_id_idx')
        ) expected(index_name)
        where to_regclass(expected.index_name) is not null
      `.execute(db);

      expect(rows.rows.map((row) => row.index_name).sort()).toEqual(
        [
          "alert_events_scope_triggered_created_id_idx",
          "error_groups_scope_cursor_order_idx",
          "errors_group_tenant_idx",
          "errors_group_user_idx",
          "errors_scope_session_time_id_idx",
          "errors_scope_tenant_time_id_idx",
          "errors_scope_time_id_idx",
          "errors_scope_trace_time_id_idx",
          "errors_scope_user_time_id_idx",
          "events_scope_session_time_id_idx",
          "events_scope_tenant_time_id_idx",
          "events_scope_time_id_idx",
          "events_scope_trace_time_id_idx",
          "events_scope_user_time_id_idx",
          "llm_calls_scope_session_time_id_idx",
          "llm_calls_scope_tenant_time_id_idx",
          "llm_calls_scope_time_id_idx",
          "llm_calls_scope_trace_time_id_idx",
          "llm_calls_scope_user_time_id_idx",
          "monitor_checks_monitor_checked_id_idx",
          "source_map_artifacts_scope_created_id_idx",
          "source_map_artifacts_scope_release_created_id_idx",
          "spans_scope_session_time_id_idx",
          "spans_scope_tenant_time_id_idx",
          "spans_scope_time_id_idx",
          "spans_scope_trace_time_id_idx",
          "spans_scope_user_time_id_idx",
          "traces_scope_session_time_id_idx",
          "traces_scope_tenant_time_id_idx",
          "traces_scope_time_id_idx",
          "traces_scope_trace_time_id_idx",
          "traces_scope_user_time_id_idx"
        ].sort()
      );
      const monitorCheckIndex = await sql<{ definition: string }>`
        select indexdef as definition
        from pg_indexes
        where indexname = 'monitor_checks_monitor_checked_id_idx'
      `.execute(db);
      expect(monitorCheckIndex.rows[0]?.definition).toContain("created_at DESC");
      const errorGroupIndex = await sql<{ definition: string }>`
        select indexdef as definition
        from pg_indexes
        where indexname = 'error_groups_scope_cursor_order_idx'
      `.execute(db);
      expect(errorGroupIndex.rows[0]?.definition).toContain("last_seen_at DESC");
    });
  });

  it("has source-map retention columns on retention_runs", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`
        select
          source_maps_enabled,
          source_maps_days,
          source_maps_batch_size,
          deleted_source_map_artifacts,
          deleted_source_map_files
        from retention_runs
        limit 0
      `.execute(db);
    });
  });

  it("enforces source map upload token scope and artifact attribution constraints", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await sql`insert into projects (id, name) values ('prj_scope_a', 'Scope A'), ('prj_scope_b', 'Scope B')`.execute(db);
      await sql`
        insert into environments (id, project_id, name)
        values ('env_scope_a', 'prj_scope_a', 'Production'), ('env_scope_b', 'prj_scope_b', 'Production')
      `.execute(db);
      await sql`
        insert into users (id, email, password_hash, is_admin)
        values ('usr_source_map_constraints', 'source-map-constraints@example.com', 'hash', true)
      `.execute(db);

      await expect(sql`
        insert into source_map_upload_tokens (id, project_id, environment_id, name, prefix, hash)
        values ('smut_bad_scope', 'prj_scope_a', 'env_scope_b', 'CI', 'shsmap_bad_scope', 'hash_bad_scope')
      `.execute(db)).rejects.toThrow();

      await sql`
        insert into source_map_upload_tokens (id, project_id, environment_id, name, prefix, hash)
        values ('smut_constraints', 'prj_scope_a', 'env_scope_a', 'CI', 'shsmap_constraints', 'hash_constraints')
      `.execute(db);

      await expect(sql`
        insert into source_map_artifacts (
          id, project_id, environment_id, release, minified_file, original_filename, content_type,
          byte_size, sha256, storage_path, uploaded_by_user_id, uploaded_by_token_id
        )
        values (
          'smap_missing_uploader', 'prj_scope_a', 'env_scope_a', 'web@1.0.0', 'missing.js',
          'missing.js.map', 'application/json', 42, 'sha_missing', '/tmp/missing.js.map', null, null
        )
      `.execute(db)).rejects.toThrow();

      await expect(sql`
        insert into source_map_artifacts (
          id, project_id, environment_id, release, minified_file, original_filename, content_type,
          byte_size, sha256, storage_path, uploaded_by_user_id, uploaded_by_token_id
        )
        values (
          'smap_both_uploaders', 'prj_scope_a', 'env_scope_a', 'web@1.0.0', 'both.js',
          'both.js.map', 'application/json', 42, 'sha_both', '/tmp/both.js.map',
          'usr_source_map_constraints', 'smut_constraints'
        )
      `.execute(db)).rejects.toThrow();
    });
  });

  it("creates lists finds uses and revokes source map upload tokens", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Source Map Token Lifecycle" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      const firstToken = await createSourceMapUploadTokenRecord(db, {
        projectId: project.id,
        environmentId: environment.id,
        name: "Manual Upload",
        prefix: "shsmap_lifecycle_a",
        hash: "hash_lifecycle_a"
      });
      const token = await createSourceMapUploadTokenRecord(db, {
        projectId: project.id,
        environmentId: environment.id,
        name: "GitHub Actions",
        prefix: "shsmap_lifecycle_b",
        hash: "hash_lifecycle_b"
      });
      await sql`
        update source_map_upload_tokens
        set created_at = '2026-05-10T00:00:00.000Z'
        where id = ${firstToken.id}
      `.execute(db);

      expect(token.id).toMatch(/^smtok_/);
      expect(token).toMatchObject({
        projectId: project.id,
        environmentId: environment.id,
        name: "GitHub Actions",
        prefix: "shsmap_lifecycle_b",
        hash: "hash_lifecycle_b",
        lastUsedAt: null,
        revokedAt: null
      });
      expect(token.createdAt).toBeInstanceOf(Date);

      const listed = await listSourceMapUploadTokens(db, {
        projectId: project.id,
        environmentId: environment.id
      });
      expect(listed.map((item) => item.id)).toEqual([token.id, firstToken.id]);

      const found = await findSourceMapUploadTokenByPrefix(db, "shsmap_lifecycle_b");
      expect(found?.id).toBe(token.id);

      const renamed = await updateSourceMapUploadToken(db, {
        id: token.id,
        projectId: project.id,
        environmentId: environment.id,
        name: "Production sourcemaps"
      });
      expect(renamed).toMatchObject({
        id: token.id,
        name: "Production sourcemaps",
        hash: "hash_lifecycle_b"
      });

      await updateSourceMapUploadTokenLastUsed(db, token.id);
      const used = await findSourceMapUploadTokenByPrefix(db, "shsmap_lifecycle_b");
      expect(used?.lastUsedAt).toBeInstanceOf(Date);
      const usedAtBeforeRevoke = used?.lastUsedAt;

      await revokeSourceMapUploadToken(db, {
        id: token.id,
        projectId: project.id,
        environmentId: environment.id
      });

      await updateSourceMapUploadTokenLastUsed(db, token.id);
      const afterRevoke = await findSourceMapUploadTokenByPrefix(db, "shsmap_lifecycle_b");
      expect(afterRevoke).toBeUndefined();
      const [revoked] = await listSourceMapUploadTokens(db, {
        projectId: project.id,
        environmentId: environment.id
      });
      expect(revoked.lastUsedAt).toEqual(usedAtBeforeRevoke);
    });
  });

  it("identity profiles upsert sanitized traits", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_identity", "env_identity");

      await identifyUserProfile(db, {
        projectId: "prj_identity",
        environmentId: "env_identity",
        userId: "usr_ana",
        tenantId: "tenant_acme",
        traits: { name: "Ana", token: "secret-value" },
        timestamp: new Date("2026-05-25T10:00:00.000Z")
      });
      await identifyTenantProfile(db, {
        projectId: "prj_identity",
        environmentId: "env_identity",
        tenantId: "tenant_acme",
        traits: { plan: "pro" },
        timestamp: new Date("2026-05-25T10:01:00.000Z")
      });

      const user = await db
        .selectFrom("user_profiles")
        .select(["tenant_id", "traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity")
        .where("environment_id", "=", "env_identity")
        .where("user_id", "=", "usr_ana")
        .executeTakeFirstOrThrow();
      expect(user.tenant_id).toBe("tenant_acme");
      expect(user.traits).toEqual({ name: "Ana", token: "[REDACTED]" });
      expect(user.first_seen_at).toEqual(new Date("2026-05-25T10:00:00.000Z"));
      expect(user.last_seen_at).toEqual(new Date("2026-05-25T10:00:00.000Z"));
      expect(user.updated_at).toEqual(new Date("2026-05-25T10:00:00.000Z"));

      await identifyUserProfile(db, {
        projectId: "prj_identity",
        environmentId: "env_identity",
        userId: "usr_ana",
        traits: { name: "Ana Maria", role: "admin", token: "new-secret-value" },
        timestamp: new Date("2026-05-25T10:10:00.000Z")
      });

      const updatedUser = await db
        .selectFrom("user_profiles")
        .select(["tenant_id", "traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity")
        .where("environment_id", "=", "env_identity")
        .where("user_id", "=", "usr_ana")
        .executeTakeFirstOrThrow();
      expect(updatedUser.tenant_id).toBe("tenant_acme");
      expect(updatedUser.traits).toEqual({ name: "Ana Maria", role: "admin", token: "[REDACTED]" });
      expect(updatedUser.first_seen_at).toEqual(new Date("2026-05-25T10:00:00.000Z"));
      expect(updatedUser.last_seen_at).toEqual(new Date("2026-05-25T10:10:00.000Z"));
      expect(updatedUser.updated_at).toEqual(new Date("2026-05-25T10:10:00.000Z"));

      await identifyUserProfile(db, {
        projectId: "prj_identity",
        environmentId: "env_identity",
        userId: "usr_ana",
        tenantId: "tenant_acme",
        traits: { name: "Ana Historical", token: "older-secret-value" },
        timestamp: new Date("2026-05-25T09:55:00.000Z")
      });

      const outOfOrderUser = await db
        .selectFrom("user_profiles")
        .select(["traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity")
        .where("environment_id", "=", "env_identity")
        .where("user_id", "=", "usr_ana")
        .executeTakeFirstOrThrow();
      expect(outOfOrderUser.traits).toEqual({ name: "Ana Historical", token: "[REDACTED]" });
      expect(outOfOrderUser.first_seen_at).toEqual(new Date("2026-05-25T10:00:00.000Z"));
      expect(outOfOrderUser.last_seen_at).toEqual(new Date("2026-05-25T10:10:00.000Z"));
      expect(outOfOrderUser.updated_at).toEqual(new Date("2026-05-25T09:55:00.000Z"));

      const tenant = await db
        .selectFrom("tenant_profiles")
        .select(["traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity")
        .where("environment_id", "=", "env_identity")
        .where("tenant_id", "=", "tenant_acme")
        .executeTakeFirstOrThrow();
      expect(tenant.traits).toEqual({ plan: "pro" });
      expect(tenant.first_seen_at).toEqual(new Date("2026-05-25T10:01:00.000Z"));
      expect(tenant.last_seen_at).toEqual(new Date("2026-05-25T10:01:00.000Z"));
      expect(tenant.updated_at).toEqual(new Date("2026-05-25T10:01:00.000Z"));

      await identifyTenantProfile(db, {
        projectId: "prj_identity",
        environmentId: "env_identity",
        tenantId: "tenant_acme",
        traits: { plan: "enterprise", region: "br" },
        timestamp: new Date("2026-05-25T10:11:00.000Z")
      });

      const updatedTenant = await db
        .selectFrom("tenant_profiles")
        .select(["traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity")
        .where("environment_id", "=", "env_identity")
        .where("tenant_id", "=", "tenant_acme")
        .executeTakeFirstOrThrow();
      expect(updatedTenant.traits).toEqual({ plan: "enterprise", region: "br" });
      expect(updatedTenant.first_seen_at).toEqual(new Date("2026-05-25T10:01:00.000Z"));
      expect(updatedTenant.last_seen_at).toEqual(new Date("2026-05-25T10:11:00.000Z"));
      expect(updatedTenant.updated_at).toEqual(new Date("2026-05-25T10:11:00.000Z"));

      await identifyTenantProfile(db, {
        projectId: "prj_identity",
        environmentId: "env_identity",
        tenantId: "tenant_acme",
        traits: { plan: "legacy" },
        timestamp: new Date("2026-05-25T09:56:00.000Z")
      });

      const outOfOrderTenant = await db
        .selectFrom("tenant_profiles")
        .select(["traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity")
        .where("environment_id", "=", "env_identity")
        .where("tenant_id", "=", "tenant_acme")
        .executeTakeFirstOrThrow();
      expect(outOfOrderTenant.traits).toEqual({ plan: "legacy" });
      expect(outOfOrderTenant.first_seen_at).toEqual(new Date("2026-05-25T10:01:00.000Z"));
      expect(outOfOrderTenant.last_seen_at).toEqual(new Date("2026-05-25T10:11:00.000Z"));
      expect(outOfOrderTenant.updated_at).toEqual(new Date("2026-05-25T09:56:00.000Z"));
    });
  });

  it("touches last seen without overwriting identity profile traits", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_identity_touch", "env_identity_touch");

      await identifyUserProfile(db, {
        projectId: "prj_identity_touch",
        environmentId: "env_identity_touch",
        userId: "usr_ana",
        tenantId: "tenant_acme",
        traits: { name: "Ana", token: "secret-value" },
        timestamp: new Date("2026-05-25T10:00:00.000Z")
      });
      await touchUserProfileLastSeen(db, {
        projectId: "prj_identity_touch",
        environmentId: "env_identity_touch",
        userId: "usr_ana",
        tenantId: "tenant_updated",
        timestamp: new Date("2026-05-25T10:05:00.000Z")
      });

      const user = await db
        .selectFrom("user_profiles")
        .select(["tenant_id", "traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity_touch")
        .where("environment_id", "=", "env_identity_touch")
        .where("user_id", "=", "usr_ana")
        .executeTakeFirstOrThrow();
      expect(user.tenant_id).toBe("tenant_updated");
      expect(user.traits).toEqual({ name: "Ana", token: "[REDACTED]" });
      expect(user.first_seen_at).toEqual(new Date("2026-05-25T10:00:00.000Z"));
      expect(user.last_seen_at).toEqual(new Date("2026-05-25T10:05:00.000Z"));
      expect(user.updated_at).toEqual(new Date("2026-05-25T10:05:00.000Z"));

      await touchUserProfileLastSeen(db, {
        projectId: "prj_identity_touch",
        environmentId: "env_identity_touch",
        userId: "usr_ana",
        timestamp: new Date("2026-05-25T10:03:00.000Z")
      });

      const userTouchedWithoutTenant = await db
        .selectFrom("user_profiles")
        .select(["tenant_id", "traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity_touch")
        .where("environment_id", "=", "env_identity_touch")
        .where("user_id", "=", "usr_ana")
        .executeTakeFirstOrThrow();
      expect(userTouchedWithoutTenant.tenant_id).toBe("tenant_updated");
      expect(userTouchedWithoutTenant.traits).toEqual({ name: "Ana", token: "[REDACTED]" });
      expect(userTouchedWithoutTenant.first_seen_at).toEqual(new Date("2026-05-25T10:00:00.000Z"));
      expect(userTouchedWithoutTenant.last_seen_at).toEqual(new Date("2026-05-25T10:05:00.000Z"));
      expect(userTouchedWithoutTenant.updated_at).toEqual(new Date("2026-05-25T10:03:00.000Z"));

      await identifyTenantProfile(db, {
        projectId: "prj_identity_touch",
        environmentId: "env_identity_touch",
        tenantId: "tenant_acme",
        traits: { plan: "pro" },
        timestamp: new Date("2026-05-25T10:01:00.000Z")
      });
      await touchTenantProfileLastSeen(db, {
        projectId: "prj_identity_touch",
        environmentId: "env_identity_touch",
        tenantId: "tenant_acme",
        timestamp: new Date("2026-05-25T10:06:00.000Z")
      });

      const tenant = await db
        .selectFrom("tenant_profiles")
        .select(["traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity_touch")
        .where("environment_id", "=", "env_identity_touch")
        .where("tenant_id", "=", "tenant_acme")
        .executeTakeFirstOrThrow();
      expect(tenant.traits).toEqual({ plan: "pro" });
      expect(tenant.first_seen_at).toEqual(new Date("2026-05-25T10:01:00.000Z"));
      expect(tenant.last_seen_at).toEqual(new Date("2026-05-25T10:06:00.000Z"));
      expect(tenant.updated_at).toEqual(new Date("2026-05-25T10:06:00.000Z"));

      await touchTenantProfileLastSeen(db, {
        projectId: "prj_identity_touch",
        environmentId: "env_identity_touch",
        tenantId: "tenant_acme",
        timestamp: new Date("2026-05-25T10:04:00.000Z")
      });

      const tenantTouchedOlder = await db
        .selectFrom("tenant_profiles")
        .select(["traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity_touch")
        .where("environment_id", "=", "env_identity_touch")
        .where("tenant_id", "=", "tenant_acme")
        .executeTakeFirstOrThrow();
      expect(tenantTouchedOlder.traits).toEqual({ plan: "pro" });
      expect(tenantTouchedOlder.first_seen_at).toEqual(new Date("2026-05-25T10:01:00.000Z"));
      expect(tenantTouchedOlder.last_seen_at).toEqual(new Date("2026-05-25T10:06:00.000Z"));
      expect(tenantTouchedOlder.updated_at).toEqual(new Date("2026-05-25T10:04:00.000Z"));
    });
  });

  it("touches identity profile last seen from telemetry events without overwriting traits", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_identity_event_touch", "env_identity_event_touch");

      await insertEvent(db, {
        id: "evt_identity_touch_create",
        projectId: "prj_identity_event_touch",
        environmentId: "env_identity_event_touch",
        userId: "usr_event_touch",
        tenantId: "tenant_event_touch",
        timestamp: new Date("2026-05-25T11:00:00.000Z"),
        receivedAt: new Date("2026-05-25T11:00:01.000Z"),
        name: "identity.touch.created"
      });

      const createdUser = await db
        .selectFrom("user_profiles")
        .select(["tenant_id", "traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity_event_touch")
        .where("environment_id", "=", "env_identity_event_touch")
        .where("user_id", "=", "usr_event_touch")
        .executeTakeFirstOrThrow();
      expect(createdUser.tenant_id).toBe("tenant_event_touch");
      expect(createdUser.traits).toEqual({});
      expect(createdUser.first_seen_at).toEqual(new Date("2026-05-25T11:00:00.000Z"));
      expect(createdUser.last_seen_at).toEqual(new Date("2026-05-25T11:00:00.000Z"));
      expect(createdUser.updated_at).toEqual(new Date("2026-05-25T11:00:00.000Z"));

      const createdTenant = await db
        .selectFrom("tenant_profiles")
        .select(["traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity_event_touch")
        .where("environment_id", "=", "env_identity_event_touch")
        .where("tenant_id", "=", "tenant_event_touch")
        .executeTakeFirstOrThrow();
      expect(createdTenant.traits).toEqual({});
      expect(createdTenant.first_seen_at).toEqual(new Date("2026-05-25T11:00:00.000Z"));
      expect(createdTenant.last_seen_at).toEqual(new Date("2026-05-25T11:00:00.000Z"));
      expect(createdTenant.updated_at).toEqual(new Date("2026-05-25T11:00:00.000Z"));

      await identifyUserProfile(db, {
        projectId: "prj_identity_event_touch",
        environmentId: "env_identity_event_touch",
        userId: "usr_event_traited",
        tenantId: "tenant_event_traited",
        traits: { name: "Telemetry User", plan: "pro" },
        timestamp: new Date("2026-05-25T10:55:00.000Z")
      });
      await identifyTenantProfile(db, {
        projectId: "prj_identity_event_touch",
        environmentId: "env_identity_event_touch",
        tenantId: "tenant_event_traited",
        traits: { name: "Telemetry Tenant", tier: "enterprise" },
        timestamp: new Date("2026-05-25T10:56:00.000Z")
      });

      await insertEvent(db, {
        id: "evt_identity_touch_update",
        projectId: "prj_identity_event_touch",
        environmentId: "env_identity_event_touch",
        userId: "usr_event_traited",
        tenantId: "tenant_event_traited",
        timestamp: new Date("2026-05-25T11:05:00.000Z"),
        receivedAt: new Date("2026-05-25T11:05:01.000Z"),
        name: "identity.touch.updated"
      });
      await insertEvent(db, {
        id: "evt_identity_touch_update",
        projectId: "prj_identity_event_touch",
        environmentId: "env_identity_event_touch",
        userId: "usr_event_traited",
        tenantId: "tenant_event_traited",
        timestamp: new Date("2026-05-25T11:10:00.000Z"),
        receivedAt: new Date("2026-05-25T11:10:01.000Z"),
        name: "identity.touch.updated.duplicate"
      });

      const updatedUser = await db
        .selectFrom("user_profiles")
        .select(["traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity_event_touch")
        .where("environment_id", "=", "env_identity_event_touch")
        .where("user_id", "=", "usr_event_traited")
        .executeTakeFirstOrThrow();
      expect(updatedUser.traits).toEqual({ name: "Telemetry User", plan: "pro" });
      expect(updatedUser.first_seen_at).toEqual(new Date("2026-05-25T10:55:00.000Z"));
      expect(updatedUser.last_seen_at).toEqual(new Date("2026-05-25T11:05:00.000Z"));
      expect(updatedUser.updated_at).toEqual(new Date("2026-05-25T11:05:00.000Z"));

      const updatedTenant = await db
        .selectFrom("tenant_profiles")
        .select(["traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity_event_touch")
        .where("environment_id", "=", "env_identity_event_touch")
        .where("tenant_id", "=", "tenant_event_traited")
        .executeTakeFirstOrThrow();
      expect(updatedTenant.traits).toEqual({ name: "Telemetry Tenant", tier: "enterprise" });
      expect(updatedTenant.first_seen_at).toEqual(new Date("2026-05-25T10:56:00.000Z"));
      expect(updatedTenant.last_seen_at).toEqual(new Date("2026-05-25T11:05:00.000Z"));
      expect(updatedTenant.updated_at).toEqual(new Date("2026-05-25T11:05:00.000Z"));
    });
  });

  it("touches identity profile last seen from telemetry errors inside the write transaction", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_identity_error_touch", "env_identity_error_touch");

      await insertError(db, {
        id: "err_identity_touch",
        projectId: "prj_identity_error_touch",
        environmentId: "env_identity_error_touch",
        userId: "usr_error_touch",
        tenantId: "tenant_error_touch",
        timestamp: new Date("2026-05-25T12:00:00.000Z"),
        receivedAt: new Date("2026-05-25T12:00:01.000Z"),
        message: "Identity touch failed",
        severity: "error"
      });

      const user = await db
        .selectFrom("user_profiles")
        .select(["traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity_error_touch")
        .where("environment_id", "=", "env_identity_error_touch")
        .where("user_id", "=", "usr_error_touch")
        .executeTakeFirstOrThrow();
      expect(user.traits).toEqual({});
      expect(user.first_seen_at).toEqual(new Date("2026-05-25T12:00:00.000Z"));
      expect(user.last_seen_at).toEqual(new Date("2026-05-25T12:00:00.000Z"));
      expect(user.updated_at).toEqual(new Date("2026-05-25T12:00:00.000Z"));

      const tenant = await db
        .selectFrom("tenant_profiles")
        .select(["traits", "first_seen_at", "last_seen_at", "updated_at"])
        .where("project_id", "=", "prj_identity_error_touch")
        .where("environment_id", "=", "env_identity_error_touch")
        .where("tenant_id", "=", "tenant_error_touch")
        .executeTakeFirstOrThrow();
      expect(tenant.traits).toEqual({});
      expect(tenant.first_seen_at).toEqual(new Date("2026-05-25T12:00:00.000Z"));
      expect(tenant.last_seen_at).toEqual(new Date("2026-05-25T12:00:00.000Z"));
      expect(tenant.updated_at).toEqual(new Date("2026-05-25T12:00:00.000Z"));
    });
  });

  it("rolls back non-error telemetry inserts when profile touch fails", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_identity_atomic_touch", "env_identity_atomic_touch");

      await sql`drop trigger if exists test_user_profile_touch_fail_trigger on user_profiles`.execute(db);
      await sql`drop function if exists test_user_profile_touch_fail()`.execute(db);
      await sql`
        create function test_user_profile_touch_fail()
        returns trigger as $$
        begin
          if new.user_id = 'usr_atomic_llm' then
            raise exception 'profile touch failed';
          end if;
          return new;
        end;
        $$ language plpgsql
      `.execute(db);
      await sql`
        create trigger test_user_profile_touch_fail_trigger
        before insert or update on user_profiles
        for each row execute function test_user_profile_touch_fail()
      `.execute(db);

      try {
        await expect(
          insertLlmCall(db, {
            id: "llm_identity_atomic_touch",
            projectId: "prj_identity_atomic_touch",
            environmentId: "env_identity_atomic_touch",
            userId: "usr_atomic_llm",
            tenantId: "tenant_atomic_llm",
            timestamp: new Date("2026-05-25T12:20:00.000Z"),
            receivedAt: new Date("2026-05-25T12:20:01.000Z"),
            provider: "openai",
            model: "gpt-test",
            status: "success"
          })
        ).rejects.toThrow("profile touch failed");

        const rows = await db
          .selectFrom("llm_calls")
          .select("id")
          .where("id", "=", "llm_identity_atomic_touch")
          .execute();
        expect(rows).toHaveLength(0);
      } finally {
        await sql`drop trigger if exists test_user_profile_touch_fail_trigger on user_profiles`.execute(db);
        await sql`drop function if exists test_user_profile_touch_fail()`.execute(db);
      }
    });
  });

  it("touches identity profile last seen from llm trace span and breadcrumb telemetry", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_identity_signal_touch", "env_identity_signal_touch");

      await insertLlmCall(db, {
        id: "llm_identity_touch",
        projectId: "prj_identity_signal_touch",
        environmentId: "env_identity_signal_touch",
        userId: "usr_llm_touch",
        tenantId: "tenant_llm_touch",
        timestamp: new Date("2026-05-25T12:30:00.000Z"),
        receivedAt: new Date("2026-05-25T12:30:01.000Z"),
        provider: "openai",
        model: "gpt-test",
        status: "success"
      });
      await insertTrace(db, {
        id: "trc_identity_touch",
        traceId: "trace_identity_touch",
        projectId: "prj_identity_signal_touch",
        environmentId: "env_identity_signal_touch",
        userId: "usr_trace_touch",
        tenantId: "tenant_trace_touch",
        timestamp: new Date("2026-05-25T12:31:00.000Z"),
        receivedAt: new Date("2026-05-25T12:31:01.000Z"),
        name: "identity.trace",
        status: "success",
        startedAt: new Date("2026-05-25T12:30:59.000Z")
      });
      await insertSpan(db, {
        id: "spn_identity_touch",
        traceId: "trace_identity_touch",
        projectId: "prj_identity_signal_touch",
        environmentId: "env_identity_signal_touch",
        userId: "usr_span_touch",
        tenantId: "tenant_span_touch",
        timestamp: new Date("2026-05-25T12:32:00.000Z"),
        receivedAt: new Date("2026-05-25T12:32:01.000Z"),
        name: "identity.span",
        status: "success",
        startedAt: new Date("2026-05-25T12:31:59.000Z")
      });
      await insertBreadcrumb(db, {
        id: "brd_identity_touch",
        projectId: "prj_identity_signal_touch",
        environmentId: "env_identity_signal_touch",
        userId: "usr_breadcrumb_touch",
        tenantId: "tenant_breadcrumb_touch",
        timestamp: new Date("2026-05-25T12:33:00.000Z"),
        receivedAt: new Date("2026-05-25T12:33:01.000Z"),
        type: "custom",
        message: "identity breadcrumb",
        level: "info"
      });

      const users = await db
        .selectFrom("user_profiles")
        .select(["user_id", "traits", "last_seen_at"])
        .where("project_id", "=", "prj_identity_signal_touch")
        .where("environment_id", "=", "env_identity_signal_touch")
        .orderBy("user_id")
        .execute();
      expect(users).toEqual([
        { user_id: "usr_breadcrumb_touch", traits: {}, last_seen_at: new Date("2026-05-25T12:33:00.000Z") },
        { user_id: "usr_llm_touch", traits: {}, last_seen_at: new Date("2026-05-25T12:30:00.000Z") },
        { user_id: "usr_span_touch", traits: {}, last_seen_at: new Date("2026-05-25T12:32:00.000Z") },
        { user_id: "usr_trace_touch", traits: {}, last_seen_at: new Date("2026-05-25T12:31:00.000Z") }
      ]);

      const tenants = await db
        .selectFrom("tenant_profiles")
        .select(["tenant_id", "traits", "last_seen_at"])
        .where("project_id", "=", "prj_identity_signal_touch")
        .where("environment_id", "=", "env_identity_signal_touch")
        .orderBy("tenant_id")
        .execute();
      expect(tenants).toEqual([
        { tenant_id: "tenant_breadcrumb_touch", traits: {}, last_seen_at: new Date("2026-05-25T12:33:00.000Z") },
        { tenant_id: "tenant_llm_touch", traits: {}, last_seen_at: new Date("2026-05-25T12:30:00.000Z") },
        { tenant_id: "tenant_span_touch", traits: {}, last_seen_at: new Date("2026-05-25T12:32:00.000Z") },
        { tenant_id: "tenant_trace_touch", traits: {}, last_seen_at: new Date("2026-05-25T12:31:00.000Z") }
      ]);
    });
  });

  it("rejects source map upload tokens for inactive missing or mismatched scopes", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const activeProject = await createProject(db, { name: "Source Map Token Active Scope" });
      const activeEnvironment = await createEnvironment(db, { projectId: activeProject.id, name: "production" });
      const otherProject = await createProject(db, { name: "Source Map Token Other Scope" });
      const otherEnvironment = await createEnvironment(db, { projectId: otherProject.id, name: "production" });
      const archivedProject = await createProject(db, { name: "Source Map Token Archived Project" });
      const archivedProjectEnvironment = await createEnvironment(db, {
        projectId: archivedProject.id,
        name: "production"
      });
      await archiveProject(db, archivedProject.id);
      const archivedEnvironmentProject = await createProject(db, {
        name: "Source Map Token Archived Environment"
      });
      const archivedEnvironment = await createEnvironment(db, {
        projectId: archivedEnvironmentProject.id,
        name: "production"
      });
      await archiveEnvironment(db, archivedEnvironment.id);

      const invalidInputs = [
        {
          projectId: "prj_missing_source_map_token",
          environmentId: activeEnvironment.id,
          name: "Missing project",
          prefix: "shsmap_missing_project",
          hash: "hash_missing_project"
        },
        {
          projectId: activeProject.id,
          environmentId: "env_missing_source_map_token",
          name: "Missing environment",
          prefix: "shsmap_missing_environment",
          hash: "hash_missing_environment"
        },
        {
          projectId: activeProject.id,
          environmentId: otherEnvironment.id,
          name: "Mismatched environment",
          prefix: "shsmap_mismatched_environment",
          hash: "hash_mismatched_environment"
        },
        {
          projectId: archivedProject.id,
          environmentId: archivedProjectEnvironment.id,
          name: "Archived project",
          prefix: "shsmap_archived_project",
          hash: "hash_archived_project"
        },
        {
          projectId: archivedEnvironmentProject.id,
          environmentId: archivedEnvironment.id,
          name: "Archived environment",
          prefix: "shsmap_archived_environment",
          hash: "hash_archived_environment"
        }
      ];

      for (const input of invalidInputs) {
        await expect(createSourceMapUploadTokenRecord(db, input)).rejects.toThrow(
          "active_source_map_upload_token_scope_not_found"
        );
      }
    });
  });

  it("finds source map upload tokens by prefix only for active non-revoked scopes", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const activeProject = await createProject(db, { name: "Source Map Token Prefix Active" });
      const activeEnvironment = await createEnvironment(db, { projectId: activeProject.id, name: "production" });
      const activeToken = await createSourceMapUploadTokenRecord(db, {
        projectId: activeProject.id,
        environmentId: activeEnvironment.id,
        name: "Active token",
        prefix: "shsmap_prefix_active",
        hash: "hash_prefix_active"
      });
      const revokedToken = await createSourceMapUploadTokenRecord(db, {
        projectId: activeProject.id,
        environmentId: activeEnvironment.id,
        name: "Revoked token",
        prefix: "shsmap_prefix_revoked",
        hash: "hash_prefix_revoked"
      });

      const archivedProject = await createProject(db, { name: "Source Map Token Prefix Archived Project" });
      const archivedProjectEnvironment = await createEnvironment(db, {
        projectId: archivedProject.id,
        name: "production"
      });
      const archivedProjectToken = await createSourceMapUploadTokenRecord(db, {
        projectId: archivedProject.id,
        environmentId: archivedProjectEnvironment.id,
        name: "Archived project token",
        prefix: "shsmap_prefix_archived_project",
        hash: "hash_prefix_archived_project"
      });

      const archivedEnvironmentProject = await createProject(db, {
        name: "Source Map Token Prefix Archived Environment"
      });
      const archivedEnvironment = await createEnvironment(db, {
        projectId: archivedEnvironmentProject.id,
        name: "production"
      });
      const archivedEnvironmentToken = await createSourceMapUploadTokenRecord(db, {
        projectId: archivedEnvironmentProject.id,
        environmentId: archivedEnvironment.id,
        name: "Archived environment token",
        prefix: "shsmap_prefix_archived_environment",
        hash: "hash_prefix_archived_environment"
      });

      await revokeSourceMapUploadToken(db, {
        id: revokedToken.id,
        projectId: activeProject.id,
        environmentId: activeEnvironment.id
      });
      await archiveProject(db, archivedProject.id);
      await archiveEnvironment(db, archivedEnvironment.id);

      await expect(findSourceMapUploadTokenByPrefix(db, activeToken.prefix)).resolves.toMatchObject({
        id: activeToken.id
      });
      await expect(findSourceMapUploadTokenByPrefix(db, revokedToken.prefix)).resolves.toBeUndefined();
      await expect(findSourceMapUploadTokenByPrefix(db, archivedProjectToken.prefix)).resolves.toBeUndefined();
      await expect(findSourceMapUploadTokenByPrefix(db, archivedEnvironmentToken.prefix)).resolves.toBeUndefined();
    });
  });

  it("does not list update or revoke source map upload tokens for archived scopes", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const archivedProject = await createProject(db, { name: "Source Map Token Archived Operations" });
      const archivedProjectEnvironment = await createEnvironment(db, {
        projectId: archivedProject.id,
        name: "production"
      });
      const archivedProjectToken = await createSourceMapUploadTokenRecord(db, {
        projectId: archivedProject.id,
        environmentId: archivedProjectEnvironment.id,
        name: "Archived project token",
        prefix: "shsmap_archived_operations_project",
        hash: "hash_archived_operations_project"
      });

      const archivedEnvironmentProject = await createProject(db, {
        name: "Source Map Token Archived Environment Operations"
      });
      const archivedEnvironment = await createEnvironment(db, {
        projectId: archivedEnvironmentProject.id,
        name: "production"
      });
      const archivedEnvironmentToken = await createSourceMapUploadTokenRecord(db, {
        projectId: archivedEnvironmentProject.id,
        environmentId: archivedEnvironment.id,
        name: "Archived environment token",
        prefix: "shsmap_archived_operations_environment",
        hash: "hash_archived_operations_environment"
      });

      await archiveProject(db, archivedProject.id);
      await archiveEnvironment(db, archivedEnvironment.id);

      await expect(
        listSourceMapUploadTokens(db, {
          projectId: archivedProject.id,
          environmentId: archivedProjectEnvironment.id
        })
      ).resolves.toEqual([]);
      await expect(
        updateSourceMapUploadToken(db, {
          id: archivedProjectToken.id,
          projectId: archivedProject.id,
          environmentId: archivedProjectEnvironment.id,
          name: "Should not update"
        })
      ).resolves.toBeUndefined();

      await revokeSourceMapUploadToken(db, {
        id: archivedEnvironmentToken.id,
        projectId: archivedEnvironmentProject.id,
        environmentId: archivedEnvironment.id
      });
      const [archivedEnvironmentRow] = await db
        .selectFrom("source_map_upload_tokens")
        .select(["name", "revoked_at"])
        .where("id", "=", archivedEnvironmentToken.id)
        .execute();
      expect(archivedEnvironmentRow).toMatchObject({
        name: "Archived environment token",
        revoked_at: null
      });
    });
  });

  it("prevents breadcrumbs from referencing an environment in another project", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const firstProject = await createProject(db, { name: "Breadcrumb Scope A" });
      const firstEnvironment = await createEnvironment(db, { projectId: firstProject.id, name: "production" });
      const secondProject = await createProject(db, { name: "Breadcrumb Scope B" });
      const secondEnvironment = await createEnvironment(db, { projectId: secondProject.id, name: "production" });

      await sql`
        insert into breadcrumbs (
          id,
          project_id,
          environment_id,
          timestamp,
          type,
          message
        )
        values (
          'brd_valid_scope',
          ${firstProject.id},
          ${firstEnvironment.id},
          '2026-05-10T12:00:00.000Z',
          'custom',
          'Valid scope'
        )
      `.execute(db);

      await expect(
        sql`
          insert into breadcrumbs (
            id,
            project_id,
            environment_id,
            timestamp,
            type,
            message
          )
          values (
            'brd_cross_scope',
            ${firstProject.id},
            ${secondEnvironment.id},
            '2026-05-10T12:01:00.000Z',
            'custom',
            'Invalid scope'
          )
        `.execute(db)
      ).rejects.toThrow();
    });
  });

  it("persists breadcrumbs through the telemetry write repository", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Breadcrumb Writes" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      await insertBreadcrumb(db, {
        id: "brd_repository",
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_1",
        userId: "user_1",
        sessionId: "sess_1",
        traceId: "trc_1",
        timestamp: new Date("2026-05-11T12:00:00.000Z"),
        receivedAt: new Date("2026-05-11T12:00:01.000Z"),
        source: "sdk-js",
        release: "1.2.3",
        metadata: { page: "checkout" },
        type: "navigation",
        category: "route",
        message: "Navigated to /checkout",
        level: "info",
        data: { from: "/cart", to: "/checkout" }
      });

      const row = await db
        .selectFrom("breadcrumbs")
        .select(["id", "session_id", "trace_id", "type", "category", "message", "level", "data"])
        .where("id", "=", "brd_repository")
        .executeTakeFirstOrThrow();

      expect(row).toMatchObject({
        id: "brd_repository",
        session_id: "sess_1",
        trace_id: "trc_1",
        type: "navigation",
        category: "route",
        message: "Navigated to /checkout",
        level: "info",
        data: { from: "/cart", to: "/checkout" }
      });
    });
  });

  it("ignores duplicate event ids during telemetry retries", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const project = await createProject(db, { name: "Idempotent Events" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const input = {
        id: "evt_retry",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-23T12:00:00.000Z"),
        receivedAt: new Date("2026-05-23T12:00:00.000Z"),
        name: "retry.event"
      };

      try {
        await insertEvent(db, input);
        await insertEvent(db, input);

        const rows = await db.selectFrom("events").select("id").where("id", "=", input.id).execute();
        expect(rows).toHaveLength(1);
      } finally {
        await db.deleteFrom("events").where("id", "=", input.id).execute();
      }
    });
  });

  it("paginates event lists with scoped timestamp cursors", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const project = await createProject(db, { name: "Cursor Events" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const otherProject = await createProject(db, { name: "Other Cursor Events" });
      const otherEnvironment = await createEnvironment(db, { projectId: otherProject.id, name: "production" });

      for (const input of [
        { id: "evt_cursor_1", timestamp: new Date("2026-05-23T12:00:00.000Z"), name: "cursor.oldest" },
        { id: "evt_cursor_2", timestamp: new Date("2026-05-23T12:01:00.000Z"), name: "cursor.middle" },
        { id: "evt_cursor_3", timestamp: new Date("2026-05-23T12:02:00.000Z"), name: "cursor.newest" }
      ]) {
        await insertEvent(db, {
          ...input,
          projectId: project.id,
          environmentId: environment.id,
          receivedAt: input.timestamp
        });
      }

      const firstPage = await listEvents(db, { projectId: project.id, environmentId: environment.id, limit: 2 });

      expect(firstPage.data.map((event) => event.id)).toEqual(["evt_cursor_3", "evt_cursor_2"]);
      expect(firstPage.cursor).toEqual(expect.any(String));

      const secondPage = await listEvents(db, {
        projectId: project.id,
        environmentId: environment.id,
        limit: 2,
        cursor: firstPage.cursor
      });

      expect(secondPage.data.map((event) => event.id)).toEqual(["evt_cursor_1"]);
      expect(secondPage.cursor).toBeUndefined();

      await expect(
        listEvents(db, {
          projectId: otherProject.id,
          environmentId: otherEnvironment.id,
          limit: 2,
          cursor: firstPage.cursor
        })
      ).rejects.toThrow(/invalid_cursor_scope/);
      await expect(
        listEvents(db, {
          projectId: project.id,
          environmentId: environment.id,
          eventName: "cursor.oldest",
          limit: 2,
          cursor: firstPage.cursor
        })
      ).rejects.toThrow(/invalid_cursor_scope/);
    });
  });

  it("does not increment error group counters for duplicate error ids", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const project = await createProject(db, { name: "Idempotent Errors" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const input = {
        id: "err_retry",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-23T12:00:00.000Z"),
        receivedAt: new Date("2026-05-23T12:00:00.000Z"),
        message: "Retry failed",
        severity: "error"
      };

      try {
        await insertError(db, input);
        await insertError(db, input);

        const errors = await db.selectFrom("errors").select("id").where("id", "=", input.id).execute();
        expect(errors).toHaveLength(1);
        const group = await db
          .selectFrom("error_groups")
          .select(["occurrence_count"])
          .where("project_id", "=", project.id)
          .where("environment_id", "=", environment.id)
          .executeTakeFirstOrThrow();
        expect(Number(group.occurrence_count)).toBe(1);
      } finally {
        await db.deleteFrom("errors").where("id", "=", input.id).execute();
        await db.deleteFrom("error_groups").where("project_id", "=", project.id).execute();
      }
    });
  });

  it("does not touch identity profiles when an error insert is skipped by on conflict", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const project = await createProject(db, { name: "Idempotent Error Profile Touches" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      await sql`drop trigger if exists test_error_conflict_skip_trigger on errors`.execute(db);
      await sql`drop function if exists test_error_conflict_skip()`.execute(db);
      await sql`
        create function test_error_conflict_skip()
        returns trigger as $$
        begin
          if new.id = 'err_identity_conflict_skip' and pg_trigger_depth() = 1 then
            insert into errors (
              id,
              project_id,
              environment_id,
              tenant_id,
              user_id,
              session_id,
              trace_id,
              timestamp,
              received_at,
              source,
              release,
              metadata,
              message,
              type,
              severity,
              stack,
              status,
              fingerprint,
              context,
              error_group_id,
              grouping_fingerprint
            )
            values (
              new.id,
              new.project_id,
              new.environment_id,
              new.tenant_id,
              new.user_id,
              new.session_id,
              new.trace_id,
              new.timestamp,
              new.received_at,
              new.source,
              new.release,
              new.metadata,
              new.message,
              new.type,
              new.severity,
              new.stack,
              new.status,
              new.fingerprint,
              new.context,
              new.error_group_id,
              new.grouping_fingerprint
            );
          end if;
          return new;
        end;
        $$ language plpgsql
      `.execute(db);
      await sql`
        create trigger test_error_conflict_skip_trigger
        before insert on errors
        for each row execute function test_error_conflict_skip()
      `.execute(db);

      try {
        await insertError(db, {
          id: "err_identity_conflict_skip",
          projectId: project.id,
          environmentId: environment.id,
          userId: "usr_error_conflict_skip",
          tenantId: "tenant_error_conflict_skip",
          timestamp: new Date("2026-05-25T12:10:00.000Z"),
          receivedAt: new Date("2026-05-25T12:10:01.000Z"),
          message: "Conflict skipped",
          severity: "error"
        });

        const userProfiles = await db
          .selectFrom("user_profiles")
          .select("user_id")
          .where("project_id", "=", project.id)
          .where("environment_id", "=", environment.id)
          .where("user_id", "=", "usr_error_conflict_skip")
          .execute();
        expect(userProfiles).toHaveLength(0);

        const tenantProfiles = await db
          .selectFrom("tenant_profiles")
          .select("tenant_id")
          .where("project_id", "=", project.id)
          .where("environment_id", "=", environment.id)
          .where("tenant_id", "=", "tenant_error_conflict_skip")
          .execute();
        expect(tenantProfiles).toHaveLength(0);
      } finally {
        await sql`drop trigger if exists test_error_conflict_skip_trigger on errors`.execute(db);
        await sql`drop function if exists test_error_conflict_skip()`.execute(db);
      }
    });
  });

  it("ignores duplicate trace ids during telemetry retries", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const project = await createProject(db, { name: "Idempotent Traces" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const input = {
        id: "trc_retry",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-23T12:00:00.000Z"),
        receivedAt: new Date("2026-05-23T12:00:00.000Z"),
        name: "retry.trace",
        status: "ok",
        startedAt: new Date("2026-05-23T12:00:00.000Z")
      };

      try {
        await insertTrace(db, input);
        await insertTrace(db, input);

        const rows = await db.selectFrom("traces").select("id").where("id", "=", input.id).execute();
        expect(rows).toHaveLength(1);
      } finally {
        await db.deleteFrom("traces").where("id", "=", input.id).execute();
      }
    });
  });

  it("ignores duplicate llm call ids during telemetry retries", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const project = await createProject(db, { name: "Idempotent LLM Calls" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const input = {
        id: "llm_retry",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-23T12:00:00.000Z"),
        receivedAt: new Date("2026-05-23T12:00:00.000Z"),
        provider: "openai",
        model: "gpt-5",
        status: "success"
      };

      try {
        await insertLlmCall(db, input);
        await insertLlmCall(db, input);

        const rows = await db.selectFrom("llm_calls").select("id").where("id", "=", input.id).execute();
        expect(rows).toHaveLength(1);
      } finally {
        await db.deleteFrom("llm_calls").where("id", "=", input.id).execute();
      }
    });
  });

  it("ignores duplicate span ids during telemetry retries", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const project = await createProject(db, { name: "Idempotent Spans" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const input = {
        id: "spn_retry",
        projectId: project.id,
        environmentId: environment.id,
        traceId: "trc_retry_parent",
        timestamp: new Date("2026-05-23T12:00:00.000Z"),
        receivedAt: new Date("2026-05-23T12:00:00.000Z"),
        name: "retry.span",
        status: "ok",
        startedAt: new Date("2026-05-23T12:00:00.000Z")
      };

      try {
        await insertSpan(db, input);
        await insertSpan(db, input);

        const rows = await db.selectFrom("spans").select("id").where("id", "=", input.id).execute();
        expect(rows).toHaveLength(1);
      } finally {
        await db.deleteFrom("spans").where("id", "=", input.id).execute();
      }
    });
  });

  it("ignores duplicate breadcrumb ids during telemetry retries", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const project = await createProject(db, { name: "Idempotent Breadcrumbs" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const input = {
        id: "brd_retry",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-23T12:00:00.000Z"),
        receivedAt: new Date("2026-05-23T12:00:00.000Z"),
        type: "custom" as const,
        message: "retry breadcrumb",
        level: "info" as const
      };

      try {
        await insertBreadcrumb(db, input);
        await insertBreadcrumb(db, input);

        const rows = await db.selectFrom("breadcrumbs").select("id").where("id", "=", input.id).execute();
        expect(rows).toHaveLength(1);
      } finally {
        await db.deleteFrom("breadcrumbs").where("id", "=", input.id).execute();
      }
    });
  });

  it("creates lists and soft deletes source map artifacts", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await seedSourceMapScope(db);
      const user = await seedSourceMapUser(db);

      const artifact = await createSourceMapArtifact(db, {
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.0",
        minifiedFile: "app.min.js",
        originalFilename: "app.min.js.map",
        contentType: "application/json",
        byteSize: 128,
        sha256: "abc123",
        storagePath: "/tmp/app.min.js.map",
        uploadedByUserId: user.id
      });

      expect(artifact.id).toMatch(/^smap_/);
      await expect(
        createSourceMapArtifact(db, {
          projectId: "prj_1",
          environmentId: "env_1",
          release: "web@1.0.0",
          minifiedFile: "app.min.js",
          originalFilename: "dupe.map",
          contentType: "application/json",
          byteSize: 10,
          sha256: "def456",
          storagePath: "/tmp/dupe.map",
          uploadedByUserId: user.id
        })
      ).rejects.toThrow();

      expect(await listSourceMapArtifacts(db, { projectId: "prj_1", environmentId: "env_1" })).toHaveLength(1);

      await deleteSourceMapArtifact(db, {
        id: artifact.id,
        projectId: "prj_1",
        environmentId: "env_1"
      });

      expect(await listSourceMapArtifacts(db, { projectId: "prj_1", environmentId: "env_1" })).toEqual([]);
    });
  });

  it("paginates source map artifacts with scoped created-at cursors", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await seedSourceMapScope(db);
      const user = await seedSourceMapUser(db);

      const artifacts = [];
      for (const [index, minifiedFile, createdAt] of [
        [1, "app.1.js", "2026-05-10T12:00:00.000Z"],
        [2, "app.2.js", "2026-05-10T12:01:00.000Z"],
        [3, "app.3.js", "2026-05-10T12:02:00.000Z"]
      ] as const) {
        const artifact = await createSourceMapArtifact(db, {
          projectId: "prj_1",
          environmentId: "env_1",
          release: "web@1.0.0",
          minifiedFile,
          originalFilename: `${minifiedFile}.map`,
          contentType: "application/json",
          byteSize: 128 + index,
          sha256: `sha-${index}`,
          storagePath: `/tmp/${minifiedFile}.map`,
          uploadedByUserId: user.id
        });
        await sql`update source_map_artifacts set created_at = ${new Date(createdAt)} where id = ${artifact.id}`.execute(db);
        artifacts.push(artifact);
      }

      const firstPage = await listSourceMapArtifactsPage(db, {
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.0",
        limit: 2
      });

      expect(firstPage.artifacts.map((artifact) => artifact.minifiedFile)).toEqual(["app.3.js", "app.2.js"]);
      expect(firstPage.cursor).toEqual(expect.any(String));

      const secondPage = await listSourceMapArtifactsPage(db, {
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.0",
        limit: 2,
        cursor: firstPage.cursor
      });

      expect(secondPage.artifacts.map((artifact) => artifact.minifiedFile)).toEqual(["app.1.js"]);
      expect(secondPage.cursor).toBeUndefined();

      await expect(
        listSourceMapArtifactsPage(db, {
          projectId: "prj_1",
          environmentId: "env_1",
          release: "web@2.0.0",
          limit: 2,
          cursor: firstPage.cursor
        })
      ).rejects.toThrow(/invalid_cursor_scope/);

      expect(artifacts).toHaveLength(3);
    });
  });

  it("rejects source map artifacts for archived project or environment scopes", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const user = await seedSourceMapUser(db);
      const archivedProject = await createProject(db, { name: "Archived Source Maps" });
      const archivedProjectEnvironment = await createEnvironment(db, {
        projectId: archivedProject.id,
        name: "production"
      });
      const activeProject = await createProject(db, { name: "Archived Source Map Environment" });
      const archivedEnvironment = await createEnvironment(db, { projectId: activeProject.id, name: "archived" });

      await archiveProject(db, archivedProject.id);
      await archiveEnvironment(db, archivedEnvironment.id);

      const base = {
        release: "web@1.0.0",
        minifiedFile: "app.min.js",
        originalFilename: "app.min.js.map",
        contentType: "application/json",
        byteSize: 128,
        sha256: "abc123",
        storagePath: "/tmp/app.min.js.map",
        uploadedByUserId: user.id
      };

      await expect(
        createSourceMapArtifact(db, {
          ...base,
          projectId: archivedProject.id,
          environmentId: archivedProjectEnvironment.id
        })
      ).rejects.toThrow("active_source_map_scope_not_found");
      await expect(
        createSourceMapArtifact(db, {
          ...base,
          projectId: activeProject.id,
          environmentId: archivedEnvironment.id
        })
      ).rejects.toThrow("active_source_map_scope_not_found");
    });
  });

  it("persists source map artifacts uploaded by tokens", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await seedSourceMapScope(db);
      await sql`
        insert into source_map_upload_tokens (id, project_id, environment_id, name, prefix, hash)
        values ('smut_attr', 'prj_1', 'env_1', 'CI', 'shsmap_attr', 'hash_attr')
      `.execute(db);

      const artifact = await createSourceMapArtifact(db, {
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.2.3",
        minifiedFile: "assets/app.js",
        originalFilename: "app.js.map",
        contentType: "application/json",
        byteSize: 42,
        sha256: "a".repeat(64),
        storagePath: "/tmp/source-maps/app.js.map",
        uploadedByTokenId: "smut_attr"
      });

      expect(artifact.uploadedByUserId).toBeNull();
      expect(artifact.uploadedByTokenId).toBe("smut_attr");
    });
  });

  it("lists expired source-map artifacts for retention in bounded order", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Source Map Retention Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "Production" });
      const user = await createUser(db, {
        email: "sourcemaps-retention@example.com",
        passwordHash: "hash",
        isAdmin: true
      });
      const older = new Date("2025-12-31T00:00:00.000Z");
      const old = new Date("2026-01-01T00:00:00.000Z");
      const fresh = new Date("2026-05-13T00:00:00.000Z");
      const deletedAt = new Date("2026-01-15T00:00:00.000Z");

      await sql`
        insert into source_map_artifacts
          (id, project_id, environment_id, release, minified_file, original_filename, content_type, byte_size, sha256, storage_path, uploaded_by_user_id, created_at, deleted_at)
        values
          ('smap_older', ${project.id}, ${environment.id}, 'old', 'z.js', 'z.js.map', 'application/json', 1, 'sha0', '/tmp/z.map', ${user.id}, ${older}, null),
          ('smap_old_2', ${project.id}, ${environment.id}, 'old', 'b.js', 'b.js.map', 'application/json', 1, 'sha2', '/tmp/b.map', ${user.id}, ${old}, null),
          ('smap_old_1', ${project.id}, ${environment.id}, 'old', 'a.js', 'a.js.map', 'application/json', 1, 'sha1', '/tmp/a.map', ${user.id}, ${old}, null),
          ('smap_old_deleted', ${project.id}, ${environment.id}, 'old', 'deleted.js', 'deleted.js.map', 'application/json', 1, 'sha_deleted', '/tmp/deleted.map', ${user.id}, ${older}, ${deletedAt}),
          ('smap_fresh', ${project.id}, ${environment.id}, 'fresh', 'c.js', 'c.js.map', 'application/json', 1, 'sha3', '/tmp/c.map', ${user.id}, ${fresh}, null)
      `.execute(db);

      const expired = await listExpiredSourceMapArtifacts(db, {
        cutoff: new Date("2026-02-01T00:00:00.000Z"),
        batchSize: 3
      });

      expect(expired).toEqual([
        expect.objectContaining({ id: "smap_older", storagePath: "/tmp/z.map" }),
        expect.objectContaining({ id: "smap_old_1", storagePath: "/tmp/a.map" }),
        expect.objectContaining({ id: "smap_old_2", storagePath: "/tmp/b.map" })
      ]);

      await expect(
        listExpiredSourceMapArtifacts(db, {
          cutoff: new Date("2026-02-01T00:00:00.000Z"),
          batchSize: 2
        })
      ).resolves.toHaveLength(2);

      const allExpired = await listExpiredSourceMapArtifacts(db, {
        cutoff: new Date("2026-02-01T00:00:00.000Z"),
        batchSize: 10
      });
      expect(allExpired.map((artifact) => artifact.id).filter((id) => id.startsWith("smap_"))).toEqual([
        "smap_older",
        "smap_old_1",
        "smap_old_2"
      ]);

      await sql`
        delete from source_map_artifacts
        where id in ('smap_older', 'smap_old_1', 'smap_old_2', 'smap_old_deleted', 'smap_fresh')
      `.execute(db);
    });
  });

  it("soft-deletes a retained source-map artifact and cached resolutions", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Source Map Delete Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "Production" });
      const user = await createUser(db, {
        email: "sourcemaps-delete@example.com",
        passwordHash: "hash",
        isAdmin: true
      });

      await insertError(db, {
        id: "err_source_map_delete",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        receivedAt: new Date("2026-01-01T00:00:01.000Z"),
        message: "Source map delete cache",
        severity: "error",
        release: "web@1"
      });

      await sql`
        insert into source_map_artifacts
          (id, project_id, environment_id, release, minified_file, original_filename, content_type, byte_size, sha256, storage_path, uploaded_by_user_id)
        values
          ('smap_delete_1', ${project.id}, ${environment.id}, 'web@1', 'app.js', 'app.js.map', 'application/json', 1, 'sha1', '/tmp/app.map', ${user.id}),
          ('smap_delete_2', ${project.id}, ${environment.id}, 'web@1', 'vendor.js', 'vendor.js.map', 'application/json', 1, 'sha2', '/tmp/vendor.map', ${user.id})
      `.execute(db);
      await sql`
        insert into error_stack_resolutions
          (id, error_id, project_id, environment_id, release, source_map_artifact_id, frame_index, minified_file, minified_line, minified_column, original_source, original_line, original_column)
        values
          ('esr_delete_1', 'err_source_map_delete', ${project.id}, ${environment.id}, 'web@1', 'smap_delete_1', 0, 'app.js', 1, 1, 'src/app.ts', 1, 1),
          ('esr_delete_2', 'err_source_map_delete', ${project.id}, ${environment.id}, 'web@1', 'smap_delete_2', 1, 'vendor.js', 1, 1, 'src/vendor.ts', 1, 1)
      `.execute(db);

      const deleted = await softDeleteSourceMapArtifactForRetention(db, "smap_delete_1");

      expect(deleted).toEqual(expect.objectContaining({ id: "smap_delete_1" }));
      await expect(getCachedErrorStackResolution(db, "err_source_map_delete")).resolves.toEqual([]);
      const remaining = await listExpiredSourceMapArtifacts(db, {
        cutoff: new Date("2030-01-01T00:00:00.000Z"),
        batchSize: 10
      });
      expect(remaining.find((artifact) => artifact.id === "smap_delete_1")).toBeUndefined();

      await sql`delete from source_map_artifacts where id in ('smap_delete_1', 'smap_delete_2')`.execute(db);
      await sql`delete from errors where id = 'err_source_map_delete'`.execute(db);
    });
  });

  it("clears cached source-map resolutions when retention delete is retried", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Source Map Delete Retry Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "Production" });
      const user = await createUser(db, {
        email: "sourcemaps-delete-retry@example.com",
        passwordHash: "hash",
        isAdmin: true
      });

      await insertError(db, {
        id: "err_source_map_delete_retry",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        receivedAt: new Date("2026-01-01T00:00:01.000Z"),
        message: "Source map delete retry cache",
        severity: "error",
        release: "web@1"
      });

      await sql`
        insert into source_map_artifacts
          (id, project_id, environment_id, release, minified_file, original_filename, content_type, byte_size, sha256, storage_path, uploaded_by_user_id, deleted_at)
        values
          ('smap_delete_retry_1', ${project.id}, ${environment.id}, 'web@1', 'retry.js', 'retry.js.map', 'application/json', 1, 'sha_retry', '/tmp/retry.map', ${user.id}, ${new Date("2026-01-02T00:00:00.000Z")})
      `.execute(db);
      await sql`
        insert into error_stack_resolutions
          (id, error_id, project_id, environment_id, release, source_map_artifact_id, frame_index, minified_file, minified_line, minified_column, original_source, original_line, original_column)
        values
          ('esr_delete_retry_1', 'err_source_map_delete_retry', ${project.id}, ${environment.id}, 'web@1', 'smap_delete_retry_1', 0, 'retry.js', 1, 1, 'src/retry.ts', 1, 1)
      `.execute(db);

      await expect(getCachedErrorStackResolution(db, "err_source_map_delete_retry")).resolves.toHaveLength(1);
      await expect(softDeleteSourceMapArtifactForRetention(db, "smap_delete_retry_1")).resolves.toBeNull();
      await expect(getCachedErrorStackResolution(db, "err_source_map_delete_retry")).resolves.toEqual([]);

      await sql`delete from source_map_artifacts where id = 'smap_delete_retry_1'`.execute(db);
      await sql`delete from errors where id = 'err_source_map_delete_retry'`.execute(db);
    });
  });

  it("stores cached stack resolutions and clears them when an artifact is deleted", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await seedSourceMapScope(db);
      const user = await seedSourceMapUser(db);
      const artifact = await createSourceMapArtifact(db, {
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.0",
        minifiedFile: "app.min.js",
        originalFilename: "app.min.js.map",
        contentType: "application/json",
        byteSize: 128,
        sha256: "abc123",
        storagePath: "/tmp/app.min.js.map",
        uploadedByUserId: user.id
      });
      await insertSourceMapError(db, {
        id: "err_1",
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.0"
      });

      await replaceErrorStackResolutions(db, {
        errorId: "err_1",
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.0",
        frames: [
          {
            sourceMapArtifactId: artifact.id,
            frameIndex: 0,
            minifiedFile: "app.min.js",
            minifiedLine: 1,
            minifiedColumn: 42,
            originalSource: "src/app.ts",
            originalLine: 10,
            originalColumn: 3,
            originalName: "checkout"
          }
        ]
      });
      const otherArtifact = await createSourceMapArtifact(db, {
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.0",
        minifiedFile: "vendor.min.js",
        originalFilename: "vendor.min.js.map",
        contentType: "application/json",
        byteSize: 128,
        sha256: "def456",
        storagePath: "/tmp/vendor.min.js.map",
        uploadedByUserId: user.id
      });
      await replaceErrorStackResolutions(db, {
        errorId: "err_1",
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.0",
        frames: [
          {
            sourceMapArtifactId: artifact.id,
            frameIndex: 0,
            minifiedFile: "app.min.js",
            minifiedLine: 1,
            minifiedColumn: 42,
            originalSource: "src/app.ts",
            originalLine: 10,
            originalColumn: 3,
            originalName: "checkout"
          },
          {
            sourceMapArtifactId: otherArtifact.id,
            frameIndex: 1,
            minifiedFile: "vendor.min.js",
            minifiedLine: 2,
            minifiedColumn: 20,
            originalSource: "src/vendor.ts",
            originalLine: 5,
            originalColumn: 7,
            originalName: "vendor"
          }
        ]
      });

      expect(await getCachedErrorStackResolution(db, "err_1")).toHaveLength(2);
      await deleteSourceMapArtifact(db, { id: artifact.id, projectId: "prj_1", environmentId: "env_1" });
      expect(await getCachedErrorStackResolution(db, "err_1")).toEqual([]);
      await deleteSourceMapArtifact(db, { id: otherArtifact.id, projectId: "prj_1", environmentId: "env_1" });

      await db.deleteFrom("source_map_artifacts").where("id", "in", [artifact.id, otherArtifact.id]).execute();
      await sql`delete from errors where id = 'err_1'`.execute(db);
    });
  });

  it("enforces source-map stack resolution scope at the database boundary", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await seedSourceMapScope(db);
      const user = await seedSourceMapUser(db);
      await sql`insert into projects (id, name) values ('prj_stack_scope_other', 'Stack Scope Other') on conflict (id) do nothing`.execute(
        db
      );
      await sql`
        insert into environments (id, project_id, name)
        values ('env_stack_scope_other', 'prj_stack_scope_other', 'Production')
        on conflict (id) do nothing
      `.execute(db);
      await insertSourceMapError(db, {
        id: "err_stack_scope_boundary",
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@scope"
      });
      const artifact = await createSourceMapArtifact(db, {
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@scope",
        minifiedFile: "scope.min.js",
        originalFilename: "scope.min.js.map",
        contentType: "application/json",
        byteSize: 128,
        sha256: "scope-boundary",
        storagePath: "/tmp/scope.min.js.map",
        uploadedByUserId: user.id
      });
      const otherArtifact = await createSourceMapArtifact(db, {
        projectId: "prj_stack_scope_other",
        environmentId: "env_stack_scope_other",
        release: "web@scope",
        minifiedFile: "scope.min.js",
        originalFilename: "scope.min.js.map",
        contentType: "application/json",
        byteSize: 128,
        sha256: "scope-boundary-other",
        storagePath: "/tmp/scope-other.min.js.map",
        uploadedByUserId: user.id
      });

      await expect(sql`
        insert into error_stack_resolutions
          (id, error_id, project_id, environment_id, release, source_map_artifact_id, frame_index, minified_file, minified_line, minified_column, original_source, original_line, original_column)
        values
          ('esr_scope_wrong_error', 'err_stack_scope_boundary', 'prj_stack_scope_other', 'env_stack_scope_other', 'web@scope', ${otherArtifact.id}, 0, 'scope.min.js', 1, 1, 'src/app.ts', 1, 1)
      `.execute(db)).rejects.toThrow();

      await expect(sql`
        insert into error_stack_resolutions
          (id, error_id, project_id, environment_id, release, source_map_artifact_id, frame_index, minified_file, minified_line, minified_column, original_source, original_line, original_column)
        values
          ('esr_scope_wrong_artifact', 'err_stack_scope_boundary', 'prj_1', 'env_1', 'web@scope', ${otherArtifact.id}, 0, 'scope.min.js', 1, 1, 'src/app.ts', 1, 1)
      `.execute(db)).rejects.toThrow();

      await expect(sql`
        insert into error_stack_resolutions
          (id, error_id, project_id, environment_id, release, source_map_artifact_id, frame_index, minified_file, minified_line, minified_column, original_source, original_line, original_column)
        values
          ('esr_scope_wrong_release', 'err_stack_scope_boundary', 'prj_1', 'env_1', 'web@other', ${artifact.id}, 0, 'scope.min.js', 1, 1, 'src/app.ts', 1, 1)
      `.execute(db)).rejects.toThrow();

      await expect(sql`
        insert into error_stack_resolutions
          (id, error_id, project_id, environment_id, release, source_map_artifact_id, frame_index, minified_file, minified_line, minified_column, original_source, original_line, original_column)
        values
          ('esr_scope_wrong_file', 'err_stack_scope_boundary', 'prj_1', 'env_1', 'web@scope', ${artifact.id}, 0, 'wrong.min.js', 1, 1, 'src/app.ts', 1, 1)
      `.execute(db)).rejects.toThrow();

      await expect(sql`
        insert into error_stack_resolutions
          (id, error_id, project_id, environment_id, release, source_map_artifact_id, frame_index, minified_file, minified_line, minified_column, original_source, original_line, original_column)
        values
          ('esr_scope_valid', 'err_stack_scope_boundary', 'prj_1', 'env_1', 'web@scope', ${artifact.id}, 0, 'scope.min.js', 1, 1, 'src/app.ts', 1, 1)
      `.execute(db)).resolves.toBeDefined();
    });
  });

  it("does not resolve source maps for archived project or environment scopes", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const user = await seedSourceMapUser(db);
      const project = await createProject(db, { name: "Archived Source Map Resolution Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      await createSourceMapArtifact(db, {
        projectId: project.id,
        environmentId: environment.id,
        release: "web@archived",
        minifiedFile: "archived.min.js",
        originalFilename: "archived.min.js.map",
        contentType: "application/json",
        byteSize: 128,
        sha256: "archived-scope",
        storagePath: "/tmp/archived.min.js.map",
        uploadedByUserId: user.id
      });
      await insertSourceMapError(db, {
        id: "err_source_map_archived_scope",
        projectId: project.id,
        environmentId: environment.id,
        release: "web@archived"
      });

      await archiveEnvironment(db, environment.id);
      await expect(
        getErrorForSourceMapResolution(db, {
          id: "err_source_map_archived_scope",
          projectId: project.id,
          environmentId: environment.id
        })
      ).resolves.toBeNull();
      await expect(
        findSourceMapArtifactForFrame(db, {
          projectId: project.id,
          environmentId: environment.id,
          release: "web@archived",
          minifiedFile: "archived.min.js"
        })
      ).resolves.toBeNull();
    });
  });

  it("rejects stack resolution replacement when the target error scope or release does not match", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await seedSourceMapScope(db);
      await insertSourceMapError(db, {
        id: "err_source_map_scope_mismatch",
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.0"
      });

      await expect(
        replaceErrorStackResolutions(db, {
          errorId: "err_source_map_scope_mismatch",
          projectId: "prj_1",
          environmentId: "env_1",
          release: "web@2.0.0",
          frames: []
        })
      ).rejects.toThrow(/does not match source map scope/);
      await expect(getCachedErrorStackResolution(db, "err_source_map_scope_mismatch")).resolves.toEqual([]);

      await sql`delete from errors where id = 'err_source_map_scope_mismatch'`.execute(db);
    });
  });

  it("rejects stack resolution frames for wrong-scope deleted or mismatched-file artifacts", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await seedSourceMapScope(db);
      const user = await seedSourceMapUser(db);
      await sql`insert into projects (id, name) values ('prj_source_maps_other', 'Other Source Map Project') on conflict (id) do nothing`.execute(
        db
      );
      await sql`
        insert into environments (id, project_id, name)
        values ('env_source_maps_other', 'prj_source_maps_other', 'Production')
        on conflict (id) do nothing
      `.execute(db);
      await insertSourceMapError(db, {
        id: "err_source_map_artifact_validation",
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.0"
      });

      const validArtifact = await createSourceMapArtifact(db, {
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.0",
        minifiedFile: "artifact-validation-valid.min.js",
        originalFilename: "artifact-validation-valid.min.js.map",
        contentType: "application/json",
        byteSize: 128,
        sha256: "artifact-validation-valid",
        storagePath: "/tmp/artifact-validation-valid.min.js.map",
        uploadedByUserId: user.id
      });
      const otherScopeArtifact = await createSourceMapArtifact(db, {
        projectId: "prj_source_maps_other",
        environmentId: "env_source_maps_other",
        release: "web@1.0.0",
        minifiedFile: "artifact-validation-other.min.js",
        originalFilename: "artifact-validation-other.min.js.map",
        contentType: "application/json",
        byteSize: 128,
        sha256: "artifact-validation-other",
        storagePath: "/tmp/artifact-validation-other.min.js.map",
        uploadedByUserId: user.id
      });
      const deletedArtifact = await createSourceMapArtifact(db, {
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.0",
        minifiedFile: "artifact-validation-deleted.min.js",
        originalFilename: "artifact-validation-deleted.min.js.map",
        contentType: "application/json",
        byteSize: 128,
        sha256: "artifact-validation-deleted",
        storagePath: "/tmp/artifact-validation-deleted.min.js.map",
        uploadedByUserId: user.id
      });
      await deleteSourceMapArtifact(db, {
        id: deletedArtifact.id,
        projectId: "prj_1",
        environmentId: "env_1"
      });

      const invalidFrames = [
        { sourceMapArtifactId: otherScopeArtifact.id, minifiedFile: "artifact-validation-other.min.js" },
        { sourceMapArtifactId: deletedArtifact.id, minifiedFile: "artifact-validation-deleted.min.js" },
        { sourceMapArtifactId: validArtifact.id, minifiedFile: "wrong-file.min.js" }
      ];

      for (const [index, frame] of invalidFrames.entries()) {
        await expect(
          replaceErrorStackResolutions(db, {
            errorId: "err_source_map_artifact_validation",
            projectId: "prj_1",
            environmentId: "env_1",
            release: "web@1.0.0",
            frames: [
              {
                sourceMapArtifactId: frame.sourceMapArtifactId,
                frameIndex: index,
                minifiedFile: frame.minifiedFile,
                minifiedLine: 1,
                minifiedColumn: 42,
                originalSource: "src/app.ts",
                originalLine: 10,
                originalColumn: 3,
                originalName: "checkout"
              }
            ]
          })
        ).rejects.toThrow(/invalid source map artifact/);
      }

      await expect(getCachedErrorStackResolution(db, "err_source_map_artifact_validation")).resolves.toEqual([]);
      await sql`delete from errors where id = 'err_source_map_artifact_validation'`.execute(db);
    });
  });

  it("clears stack resolutions with empty frames after validating the error scope", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await seedSourceMapScope(db);
      const user = await seedSourceMapUser(db);
      const artifact = await createSourceMapArtifact(db, {
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.1",
        minifiedFile: "empty-clear.min.js",
        originalFilename: "empty-clear.min.js.map",
        contentType: "application/json",
        byteSize: 128,
        sha256: "empty-clear",
        storagePath: "/tmp/empty-clear.min.js.map",
        uploadedByUserId: user.id
      });
      await insertSourceMapError(db, {
        id: "err_source_map_empty_clear",
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.1"
      });
      await replaceErrorStackResolutions(db, {
        errorId: "err_source_map_empty_clear",
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.1",
        frames: [
          {
            sourceMapArtifactId: artifact.id,
            frameIndex: 0,
            minifiedFile: "empty-clear.min.js",
            minifiedLine: 1,
            minifiedColumn: 42,
            originalSource: "src/app.ts",
            originalLine: 10,
            originalColumn: 3,
            originalName: "checkout"
          }
        ]
      });

      await expect(
        replaceErrorStackResolutions(db, {
          errorId: "err_source_map_empty_clear",
          projectId: "prj_1",
          environmentId: "env_1",
          release: "web@wrong",
          frames: []
        })
      ).rejects.toThrow(/does not match source map scope/);
      await expect(getCachedErrorStackResolution(db, "err_source_map_empty_clear")).resolves.toHaveLength(1);

      await expect(
        replaceErrorStackResolutions(db, {
          errorId: "err_source_map_empty_clear",
          projectId: "prj_1",
          environmentId: "env_1",
          release: "web@1.0.1",
          frames: []
        })
      ).resolves.toEqual([]);
      await expect(getCachedErrorStackResolution(db, "err_source_map_empty_clear")).resolves.toEqual([]);

      await sql`delete from errors where id = 'err_source_map_empty_clear'`.execute(db);
    });
  });

  it("returns null when deleting an already deleted source map artifact", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await seedSourceMapScope(db);
      const user = await seedSourceMapUser(db);
      const artifact = await createSourceMapArtifact(db, {
        projectId: "prj_1",
        environmentId: "env_1",
        release: "web@1.0.2",
        minifiedFile: "already-deleted.min.js",
        originalFilename: "already-deleted.min.js.map",
        contentType: "application/json",
        byteSize: 128,
        sha256: "already-deleted",
        storagePath: "/tmp/already-deleted.min.js.map",
        uploadedByUserId: user.id
      });

      const deleted = await deleteSourceMapArtifact(db, {
        id: artifact.id,
        projectId: "prj_1",
        environmentId: "env_1"
      });

      expect(deleted?.storagePath).toBe("/tmp/already-deleted.min.js.map");
      await expect(
        deleteSourceMapArtifact(db, {
          id: artifact.id,
          projectId: "prj_1",
          environmentId: "env_1"
        })
      ).resolves.toBeNull();
    });
  });

  it("rejects errors linked to error groups from a different scope", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`insert into projects (id, name) values ('prj_error_group_scope_a', 'Error Group Scope A')`.execute(db);
      await sql`insert into projects (id, name) values ('prj_error_group_scope_b', 'Error Group Scope B')`.execute(db);
      await sql`
        insert into environments (id, project_id, name)
        values ('env_error_group_scope_a', 'prj_error_group_scope_a', 'production')
      `.execute(db);
      await sql`
        insert into environments (id, project_id, name)
        values ('env_error_group_scope_b', 'prj_error_group_scope_b', 'production')
      `.execute(db);
      await sql`
        insert into error_groups (
          id,
          project_id,
          environment_id,
          grouping_fingerprint,
          message,
          severity,
          first_seen_at,
          last_seen_at
        )
        values (
          'egrp_cross_scope_a',
          'prj_error_group_scope_a',
          'env_error_group_scope_a',
          'fp_cross_scope',
          'Cross scope error',
          'error',
          '2026-05-10T12:00:00.000Z',
          '2026-05-10T12:00:00.000Z'
        )
      `.execute(db);

      await expect(sql`
        insert into errors (
          id,
          project_id,
          environment_id,
          timestamp,
          received_at,
          message,
          severity,
          error_group_id
        )
        values (
          'err_cross_scope_b',
          'prj_error_group_scope_b',
          'env_error_group_scope_b',
          '2026-05-10T12:00:01.000Z',
          '2026-05-10T12:00:02.000Z',
          'Cross scope linked error',
          'error',
          'egrp_cross_scope_a'
        )
      `.execute(db)).rejects.toThrow(/foreign key constraint/);
    });
  });

  it("builds deterministic fallback error grouping fingerprints", () => {
    const first = buildErrorGroupingFingerprint({
      message: "Payment failed for user 123456",
      type: "PaymentError",
      stack: "PaymentError: failed\n    at charge (/app/src/payments.ts:42:7)"
    });
    const second = buildErrorGroupingFingerprint({
      message: " payment   failed for user 999999 ",
      type: "paymenterror",
      stack: "PaymentError: failed\n    at charge (/app/src/payments.ts:42:7)"
    });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.source).toContain("paymenterror");
    expect(first.topStackFrame).toBe("at charge (/app/src/payments.ts:42:7)");
  });

  it("uses explicit error fingerprints without hashing the fallback source", () => {
    const result = buildErrorGroupingFingerprint({
      fingerprint: "checkout-provider-timeout",
      message: "Provider timeout",
      type: "TimeoutError",
      stack: "TimeoutError: provider timeout"
    });

    expect(result.fingerprint).toBe("checkout-provider-timeout");
    expect(result.source).toBe("explicit:checkout-provider-timeout");
  });

  it("normalizes error grouping input and extracts top stack frames", () => {
    expect(normalizeErrorGroupingInput("Checkout failed for request 018f1f31-8d48-7721-86b2-80f86fd87bb6")).toBe(
      "checkout failed for request {uuid}"
    );
    expect(extractTopStackFrame("Error: failed\n    at first (/app/a.ts:1:2)\n    at second (/app/b.ts:3:4)")).toBe(
      "at first (/app/a.ts:1:2)"
    );
    expect(extractTopStackFrame("Contact support@example.com for help\nfn@https://example.com/app.js:1:2")).toBe(
      "fn@https://example.com/app.js:1:2"
    );
    expect(extractTopStackFrame("Error: failed\nhttps://example.com/app.js:1:2")).toBe(
      "https://example.com/app.js:1:2"
    );
    expect(extractTopStackFrame("Error: failed\n@https://example.com/app.js:1:2")).toBe(
      "@https://example.com/app.js:1:2"
    );
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

  it("creates email notification channels with redacted recipients", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const channel = await createNotificationChannel(db, {
        name: "Ops email",
        type: "email",
        emailRecipients: ["diogo@example.com"],
        enabled: true
      });

      expect(channel).toMatchObject({
        type: "email",
        url: null,
        emailRecipients: ["diogo@example.com"],
        hasSecret: false
      });

      await expect(
        updateNotificationChannel(db, channel.id, {
          secretHeaderName: "X-SignalMonitor-Secret",
          secretHeaderValue: "secret"
        })
      ).rejects.toThrow("invalid_email_notification_channel");

      await expect(
        updateNotificationChannel(db, channel.id, {
          url: null,
          secretHeaderName: null,
          secretHeaderValue: null
        })
      ).resolves.toMatchObject({ id: channel.id, type: "email", url: null, hasSecret: false });

      const webhook = await createNotificationChannel(db, {
        name: "Ops webhook url",
        type: "webhook",
        url: "https://hooks.example.com/sigmon",
        enabled: true
      });
      await expect(updateNotificationChannel(db, webhook.id, { url: null })).rejects.toThrow(
        "webhook_url_required"
      );
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
        url: "https://hooks.example.com/sigmon",
        secretHeaderName: "X-SignalMonitor-Secret",
        secretHeaderValue: "secret-value",
        enabled: true
      });
      expect(channel.hasSecret).toBe(true);
      expect(channel.secretHeaderValue).toBe("secret-value");

      const rule = await createAlertRule(db, {
        projectId: project.id,
        environmentId: environment.id,
        notificationChannelId: channel.id,
        escalationChannelId: channel.id,
        name: "Critical errors",
        type: "critical_errors",
        severity: "critical",
        windowMinutes: 10,
        threshold: "1",
        cooldownMinutes: 30,
        escalationMinutes: 5,
        enabled: true
      });
      expect(rule.type).toBe("critical_errors");
      expect(rule.escalationChannelId).toBe(channel.id);
      expect(rule.escalationMinutes).toBe(5);

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
      expect(events[0]).toMatchObject({
        id: event.id,
        latestDeliveryStatus: "success",
        escalationDueAt: new Date("2026-05-06T12:05:00.000Z")
      });

      const dueBeforeAck = await listAlertEscalationsDue(db, {
        now: new Date("2026-05-06T12:06:00.000Z")
      });
      expect(dueBeforeAck[0]).toMatchObject({
        id: event.id,
        ruleEscalationChannelId: channel.id,
        ruleName: "Critical errors"
      });

      await updateAlertEventTriage(db, event.id, {
        status: "acknowledged",
        actorUserId: null,
        actorEmail: "ops@example.com",
        now: new Date("2026-05-06T12:02:00.000Z"),
        note: "investigating"
      });

      await expect(
        listAlertEscalationsDue(db, { now: new Date("2026-05-06T12:06:00.000Z") })
      ).resolves.toEqual([]);

      await updateAlertEventTriage(db, event.id, {
        status: "triggered",
        actorUserId: null,
        actorEmail: "ops@example.com",
        now: new Date("2026-05-06T12:03:00.000Z")
      });
      await markAlertEventEscalated(db, event.id, new Date("2026-05-06T12:06:00.000Z"));
      const escalated = await listAlertEvents(db, { projectId: project.id, environmentId: environment.id, limit: 10 });
      expect(escalated[0]).toMatchObject({
        status: "triggered",
        escalatedAt: new Date("2026-05-06T12:06:00.000Z")
      });
    });
  });

  it("creates and lists HTTP uptime monitors by project environment", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_monitor", "env_monitor");

      const monitor = await createHttpMonitor(db, {
        projectId: "prj_monitor",
        environmentId: "env_monitor",
        name: "MicroERP app",
        url: "https://microerp.example.com/health",
        method: "GET",
        intervalMinutes: 5,
        timeoutMs: 3000,
        expectedStatus: "2xx",
        bodyContains: "ok",
        failureThreshold: 2,
        recoveryThreshold: 1,
        enabled: true
      });

      expect(monitor).toMatchObject({
        projectId: "prj_monitor",
        environmentId: "env_monitor",
        kind: "http",
        name: "MicroERP app",
        status: "unknown",
        url: "https://microerp.example.com/health"
      });

      await recordMonitorCheck(db, {
        monitorId: monitor.id,
        checkedAt: new Date("2026-05-24T12:00:00.000Z"),
        status: "success",
        latencyMs: 42,
        responseStatus: 200,
        errorMessage: null
      });

      const monitors = await listMonitors(db, { projectId: "prj_monitor", environmentId: "env_monitor" });
      expect(monitors).toHaveLength(1);
      expect(monitors[0]).toMatchObject({ id: monitor.id, status: "up", lastCheckStatus: "success" });
    });
  });

  it("paginates monitor checks with checked-at cursors", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_monitor_checks_cursor", "env_monitor_checks_cursor");

      const monitor = await createHttpMonitor(db, {
        projectId: "prj_monitor_checks_cursor",
        environmentId: "env_monitor_checks_cursor",
        name: "Cursor monitor",
        url: "https://cursor.example.com/health",
        method: "GET",
        intervalMinutes: 5,
        timeoutMs: 3000,
        expectedStatus: "2xx",
        bodyContains: null,
        failureThreshold: 2,
        recoveryThreshold: 1,
        enabled: true
      });

      for (const [checkedAt, latencyMs] of [
        ["2026-05-24T12:00:00.000Z", 30],
        ["2026-05-24T12:01:00.000Z", 40],
        ["2026-05-24T12:02:00.000Z", 50]
      ] as const) {
        await recordMonitorCheck(db, {
          monitorId: monitor.id,
          checkedAt: new Date(checkedAt),
          status: "success",
          latencyMs,
          responseStatus: 200,
          errorMessage: null
        });
      }

      const firstPage = await listMonitorChecks(db, {
        monitorId: monitor.id,
        projectId: "prj_monitor_checks_cursor",
        environmentId: "env_monitor_checks_cursor",
        limit: 2
      });

      expect(firstPage.checks.map((check) => check.latencyMs)).toEqual([50, 40]);
      expect(firstPage.cursor).toEqual(expect.any(String));

      const secondPage = await listMonitorChecks(db, {
        monitorId: monitor.id,
        projectId: "prj_monitor_checks_cursor",
        environmentId: "env_monitor_checks_cursor",
        limit: 2,
        cursor: firstPage.cursor
      });

      expect(secondPage.checks.map((check) => check.latencyMs)).toEqual([30]);
      expect(secondPage.cursor).toBeUndefined();

      await expect(
        listMonitorChecks(db, {
          monitorId: "mon_other",
          projectId: "prj_monitor_checks_cursor",
          environmentId: "env_monitor_checks_cursor",
          limit: 2,
          cursor: firstPage.cursor
        })
      ).rejects.toThrow(/invalid_cursor_scope/);
      await expect(
        listMonitorChecks(db, {
          monitorId: monitor.id,
          projectId: "prj_monitor_checks_cursor",
          environmentId: "env_other",
          limit: 2,
          cursor: firstPage.cursor
        })
      ).rejects.toThrow(/invalid_cursor_scope/);
    });
  });

  it("records heartbeat check-ins and finds stale heartbeat monitors", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_heartbeat", "env_heartbeat");
      const monitor = await createHeartbeatMonitor(db, {
        projectId: "prj_heartbeat",
        environmentId: "env_heartbeat",
        name: "MicroERP queue",
        expectedIntervalMinutes: 5,
        graceMinutes: 1,
        secretHash: "hash_1",
        enabled: true
      });

      await recordHeartbeatCheckIn(db, {
        monitorId: monitor.id,
        checkedInAt: new Date("2026-05-24T12:00:00.000Z")
      });

      const stale = await listStaleHeartbeatMonitors(db, {
        now: new Date("2026-05-24T12:07:00.000Z")
      });
      expect(stale.map((item) => item.id)).toContain(monitor.id);
    });
  });

  it("does not mark new heartbeat monitors stale before their first deadline", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_new_heartbeat", "env_new_heartbeat");
      const monitor = await createHeartbeatMonitor(db, {
        projectId: "prj_new_heartbeat",
        environmentId: "env_new_heartbeat",
        name: "MicroERP new queue",
        expectedIntervalMinutes: 5,
        graceMinutes: 1,
        secretHash: "hash_1",
        enabled: true
      });

      const early = await listStaleHeartbeatMonitors(db, {
        now: new Date(monitor.createdAt.getTime() + 5 * 60 * 1000)
      });
      expect(early.map((item) => item.id)).not.toContain(monitor.id);

      const stale = await listStaleHeartbeatMonitors(db, {
        now: new Date(monitor.createdAt.getTime() + 7 * 60 * 1000)
      });
      expect(stale.map((item) => item.id)).toContain(monitor.id);
    });
  });

  it("rejects HTTP-only fields on heartbeat monitors", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_heartbeat_shape", "env_heartbeat_shape");
      const monitor = await createHeartbeatMonitor(db, {
        projectId: "prj_heartbeat_shape",
        environmentId: "env_heartbeat_shape",
        name: "MicroERP queue shape",
        expectedIntervalMinutes: 5,
        graceMinutes: 1,
        secretHash: "hash_shape",
        enabled: true
      });

      await expect(updateMonitor(db, monitor.id, { bodyContains: "ok" })).rejects.toThrow();
    });
  });

  it("does not schedule paused monitors or unpause heartbeat check-ins", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_paused_monitor", "env_paused_monitor");

      const httpMonitor = await createHttpMonitor(db, {
        projectId: "prj_paused_monitor",
        environmentId: "env_paused_monitor",
        name: "Paused HTTP",
        url: "https://microerp.example.com/health",
        method: "GET",
        intervalMinutes: 5,
        timeoutMs: 3000,
        expectedStatus: "2xx",
        failureThreshold: 2,
        recoveryThreshold: 1,
        enabled: true
      });
      const heartbeatMonitor = await createHeartbeatMonitor(db, {
        projectId: "prj_paused_monitor",
        environmentId: "env_paused_monitor",
        name: "Paused queue",
        expectedIntervalMinutes: 5,
        graceMinutes: 1,
        secretHash: "hash_paused",
        enabled: true
      });

      await updateMonitor(db, httpMonitor.id, { status: "paused" });
      await updateMonitor(db, heartbeatMonitor.id, { status: "paused" });

      const dueHttp = await listDueHttpMonitors(db, {
        now: new Date("2026-05-24T12:00:00.000Z"),
        limit: 10
      });
      expect(dueHttp.map((item) => item.id)).not.toContain(httpMonitor.id);

      const checkIn = await recordHeartbeatCheckIn(db, {
        monitorId: heartbeatMonitor.id,
        checkedInAt: new Date("2026-05-24T11:50:00.000Z")
      });
      expect(checkIn).toMatchObject({ id: heartbeatMonitor.id, status: "paused" });

      const stale = await listStaleHeartbeatMonitors(db, {
        now: new Date("2026-05-24T12:00:00.000Z")
      });
      expect(stale.map((item) => item.id)).not.toContain(heartbeatMonitor.id);
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

  it("records backup runs and reads latest status", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const failed = await recordBackupRun(db, {
        startedAt: new Date("2026-05-06T01:00:00.000Z"),
        finishedAt: new Date("2026-05-06T01:00:05.000Z"),
        status: "failed",
        trigger: "scheduled",
        filename: "sigmon-20260506T010000Z.dump",
        localPath: "/var/lib/sigmon/backups/sigmon-20260506T010000Z.dump",
        sizeBytes: null,
        checksumSha256: null,
        s3Bucket: null,
        s3Key: null,
        errorMessage: "pg_dump failed"
      });
      const success = await recordBackupRun(db, {
        startedAt: new Date("2026-05-06T02:00:00.000Z"),
        finishedAt: new Date("2026-05-06T02:00:07.000Z"),
        status: "success",
        trigger: "manual",
        filename: "sigmon-20260506T020000Z.dump",
        localPath: "/var/lib/sigmon/backups/sigmon-20260506T020000Z.dump",
        sizeBytes: 1234,
        checksumSha256: "a92e0ec81286ff0f9ccf5982a22a83a0b70082446d5fd7af0eb9a3ceacd16c86",
        s3Bucket: "sigmon-backups",
        s3Key: "prod/sigmon/sigmon-20260506T020000Z.dump",
        errorMessage: null
      });

      const status = await getBackupStatus(db);

      expect(failed.status).toBe("failed");
      expect(failed.checksumSha256).toBeNull();
      expect(success.status).toBe("success");
      expect(success.checksumSha256).toBe("a92e0ec81286ff0f9ccf5982a22a83a0b70082446d5fd7af0eb9a3ceacd16c86");
      expect(status.latestSuccess).toMatchObject({
        id: success.id,
        sizeBytes: 1234,
        checksumSha256: "a92e0ec81286ff0f9ccf5982a22a83a0b70082446d5fd7af0eb9a3ceacd16c86"
      });
      expect(status.latestFailure).toMatchObject({
        id: failed.id,
        checksumSha256: null,
        errorMessage: "pg_dump failed"
      });
    });
  });

  it("orders latest backup status deterministically when started timestamps tie", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const startedAt = new Date("2026-05-06T03:00:00.000Z");
      await sql`
        insert into backup_runs (
          id,
          started_at,
          finished_at,
          status,
          trigger,
          filename,
          local_path,
          size_bytes,
          created_at
        )
        values (
          'backup_success_older',
          ${startedAt},
          ${startedAt},
          'success',
          'manual',
          'older.dump',
          '/var/lib/sigmon/backups/older.dump',
          100,
          '2026-05-06T03:00:01.000Z'
        ),
        (
          'backup_success_newer',
          ${startedAt},
          ${startedAt},
          'success',
          'manual',
          'newer.dump',
          '/var/lib/sigmon/backups/newer.dump',
          200,
          '2026-05-06T03:00:02.000Z'
        ),
        (
          'backup_failed_aaa',
          ${startedAt},
          ${startedAt},
          'failed',
          'scheduled',
          'failed-a.dump',
          '/var/lib/sigmon/backups/failed-a.dump',
          null,
          '2026-05-06T03:00:03.000Z'
        ),
        (
          'backup_failed_zzz',
          ${startedAt},
          ${startedAt},
          'failed',
          'scheduled',
          'failed-z.dump',
          '/var/lib/sigmon/backups/failed-z.dump',
          null,
          '2026-05-06T03:00:03.000Z'
        )
      `.execute(db);

      await expect(getBackupStatus(db)).resolves.toMatchObject({
        latestSuccess: { id: "backup_success_newer", sizeBytes: 200 },
        latestFailure: { id: "backup_failed_zzz" }
      });
    });
  });

  it("rejects unsafe backup size values", async () => {
    await withDb(async (db) => {
      await migrate(db);

      await sql`
        insert into backup_runs (
          id,
          started_at,
          finished_at,
          status,
          trigger,
          filename,
          local_path,
          size_bytes
        )
        values (
          'backup_unsafe_size',
          '2026-05-06T04:00:00.000Z',
          '2026-05-06T04:00:01.000Z',
          'success',
          'manual',
          'unsafe.dump',
          '/var/lib/sigmon/backups/unsafe.dump',
          9007199254740992
        )
      `.execute(db);

      await expect(getBackupStatus(db)).rejects.toThrow("backup size_bytes exceeds Number.MAX_SAFE_INTEGER");
    });
  });

  it("uses a backup advisory lock without holding an idle transaction", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const first = await withBackupLock(db, async () => {
        const lockHolders = await sql<{ state: string | null }>`
          select state
          from pg_stat_activity
          where datname = current_database()
            and pid <> pg_backend_pid()
            and query like '%pg_try_advisory%lock%'
        `.execute(db);
        const nested = await withBackupLock(db, async () => "nested");
        return { nested, lockStates: lockHolders.rows.map((row) => row.state) };
      });

      expect(first.locked).toBe(true);
      if (!first.locked) throw new Error("backup lock was not acquired");
      expect(first.result.nested).toEqual({ locked: false });
      expect(first.result.lockStates).not.toContain("idle in transaction");
      await expect(withBackupLock(db, async () => "released")).resolves.toEqual({ locked: true, result: "released" });
    });
  });

  it("returns latest ingestion freshness timestamps or nulls", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await db.deleteFrom("spans").execute();
      await db.deleteFrom("traces").execute();
      await db.deleteFrom("errors").execute();
      await db.deleteFrom("events").execute();
      await db.deleteFrom("llm_calls").execute();

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

  it("calculates suggested incident priority from group impact", () => {
    const now = new Date("2026-05-24T12:00:00.000Z");
    type PriorityCase = {
      input: {
        severity: string;
        occurrenceCount: number;
        affectedUsersCount: number;
        affectedTenantsCount: number;
        lastRegressedAt?: Date | null;
      };
      expected: "urgent" | "high" | "normal" | "low";
    };
    const cases: PriorityCase[] = [
      {
        input: { severity: "critical", occurrenceCount: 1, affectedUsersCount: 1, affectedTenantsCount: 1 },
        expected: "urgent"
      },
      {
        input: { severity: "fatal", occurrenceCount: 1, affectedUsersCount: 1, affectedTenantsCount: 1 },
        expected: "urgent"
      },
      {
        input: { severity: "info", occurrenceCount: 1, affectedUsersCount: 1, affectedTenantsCount: 3 },
        expected: "urgent"
      },
      {
        input: { severity: "info", occurrenceCount: 1, affectedUsersCount: 25, affectedTenantsCount: 1 },
        expected: "urgent"
      },
      {
        input: { severity: "error", occurrenceCount: 1, affectedUsersCount: 1, affectedTenantsCount: 1 },
        expected: "high"
      },
      {
        input: { severity: "info", occurrenceCount: 10, affectedUsersCount: 1, affectedTenantsCount: 1 },
        expected: "high"
      },
      {
        input: {
          severity: "info",
          occurrenceCount: 1,
          affectedUsersCount: 1,
          affectedTenantsCount: 1,
          lastRegressedAt: new Date("2026-05-24T00:00:00.000Z")
        },
        expected: "high"
      },
      {
        input: { severity: "warning", occurrenceCount: 1, affectedUsersCount: 1, affectedTenantsCount: 1 },
        expected: "normal"
      },
      {
        input: { severity: "info", occurrenceCount: 2, affectedUsersCount: 1, affectedTenantsCount: 1 },
        expected: "normal"
      },
      {
        input: { severity: "info", occurrenceCount: 1, affectedUsersCount: 1, affectedTenantsCount: 1 },
        expected: "low"
      }
    ];

    for (const testCase of cases) {
      expect(
        suggestErrorGroupPriority({
          ...testCase.input,
          lastRegressedAt: testCase.input.lastRegressedAt ?? null,
          now
        })
      ).toBe(testCase.expected);
    }
  });

  it("returns an incident with a scoped primary occurrence", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const group = await seedGroupedError(db, {
        id: "err_incident_primary",
        projectId: "prj_incident",
        environmentId: "env_incident",
        message: "Incident primary failure",
        severity: "critical",
        timestamp: new Date("2026-05-24T12:00:00.000Z")
      });

      const incident = await getErrorGroupIncident(db, {
        groupId: group.id,
        projectId: "prj_incident",
        environmentId: "env_incident",
        errorId: "err_incident_primary",
        now: new Date("2026-05-24T12:10:00.000Z")
      });

      expect(incident).toMatchObject({
        group: { id: group.id },
        primaryOccurrence: { id: "err_incident_primary", errorGroupId: group.id },
        priority: null,
        suggestedPriority: "urgent"
      });
    });
  });

  it("uses the latest group occurrence when no primary error id is provided", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const group = await seedGroupedError(db, {
        id: "err_incident_latest_first",
        projectId: "prj_incident_latest",
        environmentId: "env_incident_latest",
        message: "Incident latest failure",
        severity: "error",
        timestamp: new Date("2026-05-24T12:00:00.000Z")
      });
      await insertError(db, {
        id: "err_incident_latest_second",
        projectId: "prj_incident_latest",
        environmentId: "env_incident_latest",
        message: "Incident latest failure",
        severity: "error",
        timestamp: new Date("2026-05-24T12:05:00.000Z"),
        receivedAt: new Date("2026-05-24T12:05:01.000Z")
      });

      const incident = await getErrorGroupIncident(db, {
        groupId: group.id,
        projectId: "prj_incident_latest",
        environmentId: "env_incident_latest"
      });

      expect(incident?.primaryOccurrence).toMatchObject({
        id: "err_incident_latest_second",
        errorGroupId: group.id
      });
    });
  });

  it("returns null when an explicit primary occurrence belongs to a different group", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const group = await seedGroupedError(db, {
        id: "err_incident_scope_first",
        projectId: "prj_incident_scope",
        environmentId: "env_incident_scope",
        message: "Incident scoped failure",
        severity: "error",
        timestamp: new Date("2026-05-24T12:00:00.000Z")
      });
      await seedGroupedError(db, {
        id: "err_incident_scope_other_group",
        projectId: "prj_incident_scope",
        environmentId: "env_incident_scope",
        message: "Other incident scoped failure",
        severity: "error",
        timestamp: new Date("2026-05-24T12:01:00.000Z")
      });

      await expect(
        getErrorGroupIncident(db, {
          groupId: group.id,
          projectId: "prj_incident_scope",
          environmentId: "env_incident_scope",
          errorId: "err_incident_scope_other_group"
        })
      ).resolves.toBeNull();
    });
  });

  it("returns null when the requested incident scope does not match the group", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const group = await seedGroupedError(db, {
        id: "err_incident_wrong_scope",
        projectId: "prj_incident_wrong_scope",
        environmentId: "env_incident_wrong_scope",
        message: "Incident wrong scope failure",
        severity: "error",
        timestamp: new Date("2026-05-24T12:00:00.000Z")
      });

      await expect(
        getErrorGroupIncident(db, {
          groupId: group.id,
          projectId: "prj_incident_wrong_scope",
          environmentId: "env_incident_wrong_scope_other",
          errorId: "err_incident_wrong_scope"
        })
      ).resolves.toBeNull();
    });
  });

  it("separates strongly related and nearby incident context", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const timestamp = new Date("2026-05-24T12:00:00.000Z");
      const group = await seedGroupedError(db, {
        id: "err_incident_context",
        projectId: "prj_incident_context",
        environmentId: "env_incident_context",
        message: "Incident context failure",
        severity: "error",
        timestamp
      });

      await sql`
        update errors
        set user_id = 'user_1',
            tenant_id = 'tenant_1',
            session_id = 'session_1',
            trace_id = 'trace_1'
        where id = 'err_incident_context'
      `.execute(db);
      await insertEvent(db, {
        id: "evt_strong_session",
        projectId: "prj_incident_context",
        environmentId: "env_incident_context",
        name: "checkout.clicked",
        timestamp: new Date("2026-05-24T11:59:00.000Z"),
        receivedAt: new Date("2026-05-24T11:59:01.000Z"),
        userId: "user_1",
        tenantId: "tenant_1",
        sessionId: "session_1"
      });
      await insertEvent(db, {
        id: "evt_nearby_user",
        projectId: "prj_incident_context",
        environmentId: "env_incident_context",
        name: "checkout.started",
        timestamp: new Date("2026-05-24T11:58:00.000Z"),
        receivedAt: new Date("2026-05-24T11:58:01.000Z"),
        userId: "user_1",
        tenantId: "tenant_1"
      });
      await insertError(db, {
        id: "err_incident_context_same_group",
        projectId: "prj_incident_context",
        environmentId: "env_incident_context",
        message: "Incident context failure",
        severity: "error",
        timestamp: new Date("2026-05-24T12:01:00.000Z"),
        receivedAt: new Date("2026-05-24T12:01:01.000Z")
      });

      const incident = await getErrorGroupIncident(db, {
        groupId: group.id,
        projectId: "prj_incident_context",
        environmentId: "env_incident_context",
        errorId: "err_incident_context",
        now: new Date("2026-05-24T12:10:00.000Z")
      });

      expect(incident?.stronglyRelated.items.map((item) => item.id)).toContain("evt_strong_session");
      expect(incident?.stronglyRelated.items.map((item) => item.id)).toContain("err_incident_context_same_group");
      expect(incident?.nearbyContext.items.map((item) => item.id)).toContain("evt_nearby_user");
      expect(incident?.nearbyContext.items.map((item) => item.id)).not.toContain("evt_strong_session");
      expect(incident?.nearbyContext.items.map((item) => item.id)).not.toContain("err_incident_context_same_group");
    });
  });

  it("does not leak truncated strong matches into nearby incident context", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const timestamp = new Date("2026-05-24T12:00:00.000Z");
      const group = await seedGroupedError(db, {
        id: "err_incident_truncated_primary",
        projectId: "prj_incident_truncated",
        environmentId: "env_incident_truncated",
        message: "Incident truncated context failure",
        severity: "error",
        timestamp
      });

      await sql`
        update errors
        set user_id = 'user_truncated',
            tenant_id = 'tenant_truncated'
        where id = 'err_incident_truncated_primary'
      `.execute(db);

      const hiddenStrongIds: string[] = [];
      for (let index = 0; index < 76; index += 1) {
        const id = `err_incident_truncated_strong_${index.toString().padStart(2, "0")}`;
        if (index >= 74) hiddenStrongIds.push(id);
        await insertError(db, {
          id,
          projectId: "prj_incident_truncated",
          environmentId: "env_incident_truncated",
          message: "Incident truncated context failure",
          severity: "error",
          timestamp: new Date(timestamp.getTime() + (index + 1) * 1000),
          receivedAt: new Date(timestamp.getTime() + (index + 1) * 1000 + 1),
          userId: "user_truncated",
          tenantId: "tenant_truncated"
        });
      }

      await insertEvent(db, {
        id: "evt_incident_truncated_nearby",
        projectId: "prj_incident_truncated",
        environmentId: "env_incident_truncated",
        name: "checkout.nearby",
        timestamp: new Date("2026-05-24T11:59:00.000Z"),
        receivedAt: new Date("2026-05-24T11:59:01.000Z"),
        userId: "user_truncated",
        tenantId: "tenant_truncated"
      });

      const incident = await getErrorGroupIncident(db, {
        groupId: group.id,
        projectId: "prj_incident_truncated",
        environmentId: "env_incident_truncated",
        errorId: "err_incident_truncated_primary"
      });

      expect(incident?.stronglyRelated.truncated).toBe(true);
      expect(incident?.nearbyContext.items.map((item) => item.id)).toContain("evt_incident_truncated_nearby");
      expect(incident?.nearbyContext.items.map((item) => item.id)).not.toEqual(
        expect.arrayContaining(hiddenStrongIds)
      );
    });
  });

  it("incident detail includes incidentNumber, silencedUntil, and notes", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const group = await seedGroupedError(db, {
        id: "err_triage_fields_1",
        projectId: "prj_triage_fields",
        environmentId: "env_triage_fields",
        message: "Triage fields error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z")
      });

      const until = new Date("2026-07-01T00:00:00.000Z");
      await silenceIncident(db, { errorGroupId: group.id, until, projectId: "prj_triage_fields", environmentId: "env_triage_fields" });

      await addTriageNote(db, {
        errorGroupId: group.id,
        authorUserId: null,
        authorEmail: "ops@example.com",
        body: "First note",
        projectId: "prj_triage_fields",
        environmentId: "env_triage_fields"
      });
      await addTriageNote(db, {
        errorGroupId: group.id,
        authorUserId: null,
        authorEmail: "dev@example.com",
        body: "Second note",
        projectId: "prj_triage_fields",
        environmentId: "env_triage_fields"
      });

      const incident = await getErrorGroupIncident(db, {
        groupId: group.id,
        projectId: "prj_triage_fields",
        environmentId: "env_triage_fields",
        errorId: "err_triage_fields_1"
      });

      expect(incident).not.toBeNull();
      expect(incident!.incidentNumber).toMatch(/^INC-/);
      expect(incident!.silencedUntil).toBe(until.toISOString());
      expect(incident!.assignedTo).toBeNull();
      expect(incident!.notes).toHaveLength(2);
      expect(incident!.notes[0]).toMatchObject({
        authorEmail: "ops@example.com",
        body: "First note"
      });
      expect(incident!.notes[1]).toMatchObject({
        authorEmail: "dev@example.com",
        body: "Second note"
      });
      expect(typeof incident!.notes[0].id).toBe("string");
      expect(typeof incident!.notes[0].createdAt).toBe("string");
    });
  });

  it("incident detail assignedTo is populated when group has an assigned user", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const project = await createProject(db, { name: "Triage AssignedTo Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const user = await createUser(db, { email: "assignee-detail@example.com", passwordHash: "hash", isAdmin: false });

      await insertError(db, {
        id: "err_triage_assigned_1",
        projectId: project.id,
        environmentId: environment.id,
        message: "Assigned triage error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z"),
        receivedAt: new Date("2026-06-01T10:00:01.000Z")
      });

      const groups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      const group = groups[0];
      expect(group).toBeDefined();

      await assignIncident(db, { errorGroupId: group.id, assignedToUserId: user.id, projectId: project.id, environmentId: environment.id });

      const incident = await getErrorGroupIncident(db, {
        groupId: group.id,
        projectId: project.id,
        environmentId: environment.id,
        errorId: "err_triage_assigned_1"
      });

      expect(incident).not.toBeNull();
      expect(incident!.assignedTo).toEqual({ id: user.id, email: "assignee-detail@example.com" });
    });
  });

  it("groups new error inserts and reopens resolved groups on recurrence", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await sql`insert into projects (id, name) values ('prj_grouping', 'Grouping')`.execute(db);
      await sql`insert into environments (id, project_id, name) values ('env_grouping', 'prj_grouping', 'production')`.execute(db);

      await insertError(db, {
        id: "err_grouping_1",
        projectId: "prj_grouping",
        environmentId: "env_grouping",
        timestamp: new Date("2026-05-10T12:00:00.000Z"),
        receivedAt: new Date("2026-05-10T12:00:01.000Z"),
        message: "Checkout failed for order 123456",
        type: "CheckoutError",
        severity: "critical",
        stack: "CheckoutError: failed\n    at pay (/app/pay.ts:10:2)",
        userId: "user_1",
        tenantId: "tenant_1",
        release: "1.0.0"
      });

      const groups = await listErrorGroups(db, {
        projectId: "prj_grouping",
        environmentId: "env_grouping",
        limit: 10
      });

      expect(groups).toHaveLength(1);
      expect(groups[0]).toEqual(
        expect.objectContaining({
          message: "Checkout failed for order 123456",
          status: "open",
          occurrenceCount: 1,
          affectedUsersCount: 1,
          affectedTenantsCount: 1,
          latestErrorId: "err_grouping_1",
          latestRelease: "1.0.0"
        })
      );

      await updateErrorGroupStatus(db, {
        id: groups[0]!.id,
        projectId: "prj_grouping",
        environmentId: "env_grouping",
        status: "resolved",
        now: new Date("2026-05-10T12:05:00.000Z")
      });

      await insertError(db, {
        id: "err_grouping_2",
        projectId: "prj_grouping",
        environmentId: "env_grouping",
        timestamp: new Date("2026-05-10T12:10:00.000Z"),
        receivedAt: new Date("2026-05-10T12:10:01.000Z"),
        message: "Checkout failed for order 999999",
        type: "CheckoutError",
        severity: "error",
        stack: "CheckoutError: failed\n    at pay (/app/pay.ts:10:2)",
        userId: "user_2",
        tenantId: "tenant_1",
        release: "1.0.1"
      });

      const reopened = await getErrorGroup(db, {
        id: groups[0]!.id,
        projectId: "prj_grouping",
        environmentId: "env_grouping"
      });

      expect(reopened).toEqual(
        expect.objectContaining({
          status: "open",
          occurrenceCount: 2,
          affectedUsersCount: 2,
          affectedTenantsCount: 1,
          latestErrorId: "err_grouping_2",
          latestRelease: "1.0.1",
          resolvedAt: null,
          lastRegressedAt: expect.any(Date)
        })
      );
    });
  });

  it("paginates error groups with scoped stable cursors", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await sql`insert into projects (id, name) values ('prj_error_group_cursor', 'Error Group Cursor')`.execute(db);
      await sql`
        insert into environments (id, project_id, name)
        values ('env_error_group_cursor', 'prj_error_group_cursor', 'production')
      `.execute(db);
      await sql`insert into projects (id, name) values ('prj_error_group_cursor_other', 'Other')`.execute(db);
      await sql`
        insert into environments (id, project_id, name)
        values ('env_error_group_cursor_other', 'prj_error_group_cursor_other', 'production')
      `.execute(db);

      for (const [id, timestamp, fingerprint] of [
        ["err_group_cursor_1", "2026-05-10T12:00:00.000Z", "group-cursor-oldest"],
        ["err_group_cursor_2", "2026-05-10T12:01:00.000Z", "group-cursor-middle"],
        ["err_group_cursor_3", "2026-05-10T12:02:00.000Z", "group-cursor-newest"]
      ] as const) {
        await insertError(db, {
          id,
          projectId: "prj_error_group_cursor",
          environmentId: "env_error_group_cursor",
          timestamp: new Date(timestamp),
          receivedAt: new Date(timestamp),
          message: `Cursor ${fingerprint}`,
          severity: "error",
          fingerprint
        });
      }

      const firstPage = await listErrorGroupsPage(db, {
        projectId: "prj_error_group_cursor",
        environmentId: "env_error_group_cursor",
        limit: 2
      });

      expect(firstPage.data.map((group) => group.latestErrorId)).toEqual(["err_group_cursor_3", "err_group_cursor_2"]);
      expect(firstPage.cursor).toEqual(expect.any(String));

      const secondPage = await listErrorGroupsPage(db, {
        projectId: "prj_error_group_cursor",
        environmentId: "env_error_group_cursor",
        limit: 2,
        cursor: firstPage.cursor
      });

      expect(secondPage.data.map((group) => group.latestErrorId)).toEqual(["err_group_cursor_1"]);
      expect(secondPage.cursor).toBeUndefined();

      await expect(
        listErrorGroupsPage(db, {
          projectId: "prj_error_group_cursor_other",
          environmentId: "env_error_group_cursor_other",
          limit: 2,
          cursor: firstPage.cursor
        })
      ).rejects.toThrow(/invalid_cursor_scope/);
      await expect(
        listErrorGroupsPage(db, {
          projectId: "prj_error_group_cursor",
          environmentId: "env_error_group_cursor",
          status: "resolved",
          limit: 2,
          cursor: firstPage.cursor
        })
      ).rejects.toThrow(/invalid_cursor_scope/);
    });
  });

  it("does not downgrade fatal error groups on lower severity recurrence", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await sql`insert into projects (id, name) values ('prj_grouping_fatal', 'Grouping Fatal')`.execute(db);
      await sql`
        insert into environments (id, project_id, name)
        values ('env_grouping_fatal', 'prj_grouping_fatal', 'production')
      `.execute(db);

      await insertError(db, {
        id: "err_grouping_fatal_1",
        projectId: "prj_grouping_fatal",
        environmentId: "env_grouping_fatal",
        timestamp: new Date("2026-05-10T12:00:00.000Z"),
        receivedAt: new Date("2026-05-10T12:00:01.000Z"),
        message: "Fatal checkout failure",
        severity: "fatal",
        fingerprint: "fatal-checkout-failure"
      });

      await insertError(db, {
        id: "err_grouping_fatal_2",
        projectId: "prj_grouping_fatal",
        environmentId: "env_grouping_fatal",
        timestamp: new Date("2026-05-10T12:05:00.000Z"),
        receivedAt: new Date("2026-05-10T12:05:01.000Z"),
        message: "Fatal checkout failure",
        severity: "critical",
        fingerprint: "fatal-checkout-failure"
      });

      const groups = await listErrorGroups(db, {
        projectId: "prj_grouping_fatal",
        environmentId: "env_grouping_fatal",
        limit: 10
      });

      expect(groups).toHaveLength(1);
      expect(groups[0]).toEqual(expect.objectContaining({ occurrenceCount: 2, severity: "fatal" }));
    });
  });

  it("does not reopen resolved groups for delayed older live errors", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await sql`insert into projects (id, name) values ('prj_grouping_delayed', 'Grouping Delayed')`.execute(db);
      await sql`
        insert into environments (id, project_id, name)
        values ('env_grouping_delayed', 'prj_grouping_delayed', 'production')
      `.execute(db);

      await insertError(db, {
        id: "err_grouping_delayed_1",
        projectId: "prj_grouping_delayed",
        environmentId: "env_grouping_delayed",
        timestamp: new Date("2026-05-10T12:00:00.000Z"),
        receivedAt: new Date("2026-05-10T12:00:01.000Z"),
        message: "Delayed checkout failure",
        severity: "error",
        fingerprint: "delayed-checkout-failure",
        release: "1.0.0"
      });

      const [group] = await listErrorGroups(db, {
        projectId: "prj_grouping_delayed",
        environmentId: "env_grouping_delayed",
        limit: 10
      });
      const resolvedAt = new Date("2026-05-10T12:10:00.000Z");
      await updateErrorGroupStatus(db, {
        id: group!.id,
        projectId: "prj_grouping_delayed",
        environmentId: "env_grouping_delayed",
        status: "resolved",
        now: resolvedAt
      });

      await insertError(db, {
        id: "err_grouping_delayed_2",
        projectId: "prj_grouping_delayed",
        environmentId: "env_grouping_delayed",
        timestamp: new Date("2026-05-10T12:05:00.000Z"),
        receivedAt: new Date("2026-05-10T12:15:00.000Z"),
        message: "Delayed checkout failure",
        severity: "critical",
        fingerprint: "delayed-checkout-failure",
        release: "1.0.1"
      });

      const delayed = await getErrorGroup(db, {
        id: group!.id,
        projectId: "prj_grouping_delayed",
        environmentId: "env_grouping_delayed"
      });

      expect(delayed).toEqual(
        expect.objectContaining({
          status: "resolved",
          resolvedAt,
          lastRegressedAt: null,
          occurrenceCount: 2,
          severity: "critical",
          latestErrorId: "err_grouping_delayed_2",
          latestRelease: "1.0.1"
        })
      );
    });
  });

  it("ignores duplicate grouped raw error ids without updating group stats", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await sql`insert into projects (id, name) values ('prj_grouping_rollback', 'Grouping Rollback')`.execute(db);
      await sql`
        insert into environments (id, project_id, name)
        values ('env_grouping_rollback', 'prj_grouping_rollback', 'production')
      `.execute(db);

      await insertError(db, {
        id: "err_grouping_rollback",
        projectId: "prj_grouping_rollback",
        environmentId: "env_grouping_rollback",
        timestamp: new Date("2026-05-10T12:00:00.000Z"),
        receivedAt: new Date("2026-05-10T12:00:01.000Z"),
        message: "Checkout failed for order 123456",
        type: "CheckoutError",
        severity: "error",
        stack: "CheckoutError: failed\n    at pay (/app/pay.ts:10:2)",
        release: "1.0.0"
      });

      await insertError(db, {
        id: "err_grouping_rollback",
        projectId: "prj_grouping_rollback",
        environmentId: "env_grouping_rollback",
        timestamp: new Date("2026-05-10T12:10:00.000Z"),
        receivedAt: new Date("2026-05-10T12:10:01.000Z"),
        message: "Checkout failed for order 999999",
        type: "CheckoutError",
        severity: "critical",
        stack: "CheckoutError: failed\n    at pay (/app/pay.ts:10:2)",
        release: "1.0.1"
      });

      const groups = await listErrorGroups(db, {
        projectId: "prj_grouping_rollback",
        environmentId: "env_grouping_rollback",
        limit: 10
      });

      expect(groups).toHaveLength(1);
      expect(groups[0]).toEqual(
        expect.objectContaining({
          occurrenceCount: 1,
          severity: "error",
          latestErrorId: "err_grouping_rollback",
          latestRelease: "1.0.0"
        })
      );
    });
  });

  it("keeps ignored groups ignored when matching errors recur", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await sql`insert into projects (id, name) values ('prj_ignored_group', 'Ignored Group')`.execute(db);
      await sql`insert into environments (id, project_id, name) values ('env_ignored_group', 'prj_ignored_group', 'production')`.execute(db);

      await insertError(db, {
        id: "err_ignored_1",
        projectId: "prj_ignored_group",
        environmentId: "env_ignored_group",
        timestamp: new Date("2026-05-10T12:00:00.000Z"),
        receivedAt: new Date("2026-05-10T12:00:01.000Z"),
        message: "Known browser extension noise",
        severity: "warning",
        fingerprint: "browser-extension-noise"
      });

      const [group] = await listErrorGroups(db, {
        projectId: "prj_ignored_group",
        environmentId: "env_ignored_group",
        limit: 10
      });

      await updateErrorGroupStatus(db, {
        id: group!.id,
        projectId: "prj_ignored_group",
        environmentId: "env_ignored_group",
        status: "ignored",
        now: new Date("2026-05-10T12:05:00.000Z")
      });

      await insertError(db, {
        id: "err_ignored_2",
        projectId: "prj_ignored_group",
        environmentId: "env_ignored_group",
        timestamp: new Date("2026-05-10T12:10:00.000Z"),
        receivedAt: new Date("2026-05-10T12:10:01.000Z"),
        message: "Known browser extension noise",
        severity: "warning",
        fingerprint: "browser-extension-noise"
      });

      const ignored = await getErrorGroup(db, {
        id: group!.id,
        projectId: "prj_ignored_group",
        environmentId: "env_ignored_group"
      });

      expect(ignored).toEqual(expect.objectContaining({ status: "ignored", occurrenceCount: 2, lastRegressedAt: null }));
    });
  });

  it("stores and returns error group priority overrides", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const timestamp = new Date("2026-05-24T12:00:00.000Z");
      const group = await seedGroupedError(db, {
        id: "err_priority_1",
        projectId: "prj_priority",
        environmentId: "env_priority",
        message: "Priority smoke failure",
        severity: "critical",
        timestamp
      });

      const updated = await updateErrorGroupTriage(db, {
        id: group!.id,
        projectId: "prj_priority",
        environmentId: "env_priority",
        status: "investigating",
        priority: "urgent",
        now: new Date("2026-05-24T12:05:00.000Z")
      });

      expect(updated).toMatchObject({
        id: group!.id,
        status: "investigating",
        priority: "urgent"
      });

      const loaded = await getErrorGroup(db, {
        id: group!.id,
        projectId: "prj_priority",
        environmentId: "env_priority"
      });
      expect(loaded?.priority).toBe("urgent");

      const [listed] = await listErrorGroups(db, {
        projectId: "prj_priority",
        environmentId: "env_priority"
      });
      expect(listed!.priority).toBe("urgent");
    });
  });

  it("clears an error group priority override", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const group = await seedGroupedError(db, {
        id: "err_priority_clear_1",
        projectId: "prj_priority_clear",
        environmentId: "env_priority_clear",
        message: "Priority clear smoke failure",
        severity: "error",
        timestamp: new Date("2026-05-24T12:00:00.000Z")
      });

      await updateErrorGroupTriage(db, {
        id: group!.id,
        projectId: "prj_priority_clear",
        environmentId: "env_priority_clear",
        priority: "high",
        now: new Date("2026-05-24T12:01:00.000Z")
      });

      const cleared = await updateErrorGroupTriage(db, {
        id: group!.id,
        projectId: "prj_priority_clear",
        environmentId: "env_priority_clear",
        priority: null,
        now: new Date("2026-05-24T12:02:00.000Z")
      });

      expect(cleared?.priority).toBeNull();
    });
  });

  it("backfills existing errors into groups idempotently", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await sql`insert into projects (id, name) values ('prj_backfill_groups', 'Backfill Groups')`.execute(db);
      await sql`insert into environments (id, project_id, name) values ('env_backfill_groups', 'prj_backfill_groups', 'production')`.execute(db);

      await sql`
        insert into errors (
          id, project_id, environment_id, timestamp, received_at, message, type, severity, stack, status, fingerprint, context
        )
        values
          ('err_backfill_1', 'prj_backfill_groups', 'env_backfill_groups', '2026-05-10T12:00:00.000Z', '2026-05-10T12:00:01.000Z', 'Backfill failed for user 123456', 'BackfillError', 'error', 'BackfillError: failed\n    at run (/app/run.ts:1:1)', 'open', null, '{}'),
          ('err_backfill_2', 'prj_backfill_groups', 'env_backfill_groups', '2026-05-10T12:05:00.000Z', '2026-05-10T12:05:01.000Z', 'Backfill failed for user 999999', 'BackfillError', 'critical', 'BackfillError: failed\n    at run (/app/run.ts:1:1)', 'open', null, '{}')
      `.execute(db);

      await backfillErrorGroups(db, { batchSize: 100 });
      await backfillErrorGroups(db, { batchSize: 100 });

      const groups = await listErrorGroups(db, {
        projectId: "prj_backfill_groups",
        environmentId: "env_backfill_groups",
        limit: 10
      });

      expect(groups).toHaveLength(1);
      expect(groups[0]).toEqual(
        expect.objectContaining({
          occurrenceCount: 2,
          severity: "critical",
          latestErrorId: "err_backfill_2"
        })
      );
    });
  });

  it("backfills older errors without reopening resolved groups", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await sql`insert into projects (id, name) values ('prj_backfill_resolved', 'Backfill Resolved')`.execute(db);
      await sql`
        insert into environments (id, project_id, name)
        values ('env_backfill_resolved', 'prj_backfill_resolved', 'production')
      `.execute(db);

      await insertError(db, {
        id: "err_backfill_resolved_latest",
        projectId: "prj_backfill_resolved",
        environmentId: "env_backfill_resolved",
        timestamp: new Date("2026-05-10T12:00:00.000Z"),
        receivedAt: new Date("2026-05-10T12:00:01.000Z"),
        message: "Backfill resolved failure",
        severity: "error",
        fingerprint: "backfill-resolved-failure",
        release: "1.0.0"
      });

      const [group] = await listErrorGroups(db, {
        projectId: "prj_backfill_resolved",
        environmentId: "env_backfill_resolved",
        limit: 10
      });
      const resolvedAt = new Date("2026-05-10T12:05:00.000Z");
      await updateErrorGroupStatus(db, {
        id: group!.id,
        projectId: "prj_backfill_resolved",
        environmentId: "env_backfill_resolved",
        status: "resolved",
        now: resolvedAt
      });

      await sql`
        insert into errors (
          id, project_id, environment_id, timestamp, received_at, message, severity, status, fingerprint, context
        )
        values (
          'err_backfill_resolved_older',
          'prj_backfill_resolved',
          'env_backfill_resolved',
          '2026-05-10T11:00:00.000Z',
          '2026-05-10T11:00:01.000Z',
          'Backfill resolved failure',
          'critical',
          'open',
          'backfill-resolved-failure',
          '{}'
        )
      `.execute(db);

      const result = await backfillErrorGroups(db, { batchSize: 100 });

      const resolved = await getErrorGroup(db, {
        id: group!.id,
        projectId: "prj_backfill_resolved",
        environmentId: "env_backfill_resolved"
      });
      const attached = await sql<{ error_group_id: string | null; grouping_fingerprint: string | null }>`
        select error_group_id, grouping_fingerprint
        from errors
        where id = 'err_backfill_resolved_older'
      `.execute(db);

      expect(result).toEqual({ processed: 1, selected: 1, batchSize: 100 });
      expect(attached.rows[0]).toEqual({
        error_group_id: group!.id,
        grouping_fingerprint: "backfill-resolved-failure"
      });
      expect(resolved).toEqual(
        expect.objectContaining({
          status: "resolved",
          resolvedAt,
          lastRegressedAt: null,
          occurrenceCount: 2,
          severity: "critical",
          latestErrorId: "err_backfill_resolved_latest",
          latestRelease: "1.0.0"
        })
      );
    });
  });

  it("backfills newer errors as resolved group regressions", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await sql`insert into projects (id, name) values ('prj_backfill_regression', 'Backfill Regression')`.execute(db);
      await sql`
        insert into environments (id, project_id, name)
        values ('env_backfill_regression', 'prj_backfill_regression', 'production')
      `.execute(db);

      await insertError(db, {
        id: "err_backfill_regression_initial",
        projectId: "prj_backfill_regression",
        environmentId: "env_backfill_regression",
        timestamp: new Date("2026-05-10T12:00:00.000Z"),
        receivedAt: new Date("2026-05-10T12:00:01.000Z"),
        message: "Backfill regression failure",
        severity: "error",
        fingerprint: "backfill-regression-failure"
      });

      const [group] = await listErrorGroups(db, {
        projectId: "prj_backfill_regression",
        environmentId: "env_backfill_regression",
        limit: 10
      });
      const resolvedAt = new Date("2026-05-10T12:05:00.000Z");
      await updateErrorGroupStatus(db, {
        id: group!.id,
        projectId: "prj_backfill_regression",
        environmentId: "env_backfill_regression",
        status: "resolved",
        now: resolvedAt
      });

      await sql`
        insert into errors (
          id, project_id, environment_id, timestamp, received_at, message, severity, status, fingerprint, context
        )
        values (
          'err_backfill_regression_newer',
          'prj_backfill_regression',
          'env_backfill_regression',
          '2026-05-10T12:10:00.000Z',
          '2026-05-10T12:10:01.000Z',
          'Backfill regression failure',
          'critical',
          'open',
          'backfill-regression-failure',
          '{}'
        )
      `.execute(db);

      await backfillErrorGroups(db, { batchSize: 100 });

      const regressed = await getErrorGroup(db, {
        id: group!.id,
        projectId: "prj_backfill_regression",
        environmentId: "env_backfill_regression"
      });

      expect(regressed).toEqual(
        expect.objectContaining({
          status: "open",
          resolvedAt: null,
          lastRegressedAt: new Date("2026-05-10T12:10:00.000Z"),
          occurrenceCount: 2,
          severity: "critical",
          latestErrorId: "err_backfill_regression_newer"
        })
      );
    });
  });

  it("evaluates supported alert rule types", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Alert Evaluation Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const otherEnvironment = await createEnvironment(db, { projectId: project.id, name: "staging" });

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
      await insertDeadLetterJob(db, {
        projectId: project.id,
        environmentId: environment.id,
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "dead-letter-alert-1" },
        errorMessage: "event insert failed"
      });
      await insertDeadLetterJob(db, {
        projectId: project.id,
        environmentId: environment.id,
        queueName: "telemetry",
        jobName: "error",
        payload: { id: "dead-letter-alert-2" },
        errorMessage: "error insert failed"
      });
      await insertDeadLetterJob(db, {
        projectId: project.id,
        environmentId: otherEnvironment.id,
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "dead-letter-other-env" },
        errorMessage: "other environment failed"
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

      const errorRateResult = await evaluateAlertRule(db, {
        projectId: project.id,
        environmentId: environment.id,
        type: "error_rate",
        windowStart: new Date("2026-05-06T11:50:00.000Z"),
        windowEnd: new Date("2026-05-06T12:00:00.000Z")
      });
      expect(errorRateResult.observedValue).toBe("200");

      const deadLetterResult = await evaluateAlertRule(db, {
        projectId: project.id,
        environmentId: environment.id,
        type: "dead_letter_count",
        windowStart: new Date("2026-05-06T11:50:00.000Z"),
        windowEnd: new Date("2026-05-06T12:00:00.000Z")
      });
      expect(deadLetterResult.observedValue).toBe("2");
    });
  });

  it("evaluates error rate rules with trace denominator and minimum sample size", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_rate", "env_rate");
      await insertTraceRows(db, "prj_rate", "env_rate", 100, { name: "GET /checkout" });
      await insertErrorRows(db, "prj_rate", "env_rate", 5, {
        fingerprint: "checkout",
        traceName: "GET /checkout"
      });

      const result = await evaluateAlertRule(db, {
        projectId: "prj_rate",
        environmentId: "env_rate",
        type: "error_rate",
        windowStart: new Date("2026-05-24T12:00:00.000Z"),
        windowEnd: new Date("2026-05-24T12:10:00.000Z"),
        routePattern: "GET /checkout",
        minimumSampleSize: 20
      });

      expect(result).toEqual({ observedValue: "5" });
    });
  });

  it("returns zero error rate when denominator is below minimum sample size", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_rate_low", "env_rate_low");
      await insertTraceRows(db, "prj_rate_low", "env_rate_low", 3, { name: "GET /checkout" });
      await insertErrorRows(db, "prj_rate_low", "env_rate_low", 1, { fingerprint: "checkout" });

      const result = await evaluateAlertRule(db, {
        projectId: "prj_rate_low",
        environmentId: "env_rate_low",
        type: "error_rate",
        windowStart: new Date("2026-05-24T12:00:00.000Z"),
        windowEnd: new Date("2026-05-24T12:10:00.000Z"),
        routePattern: "GET /checkout",
        minimumSampleSize: 20
      });

      expect(result).toEqual({ observedValue: "0" });
    });
  });

  it("does not overcount route-scoped error rate with duplicate or null trace ids", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_rate_edges", "env_rate_edges");

      await insertTrace(db, {
        id: "trace_rate_edges_1",
        traceId: "trace_rate_edges_shared",
        projectId: "prj_rate_edges",
        environmentId: "env_rate_edges",
        timestamp: new Date("2026-05-24T12:05:00.000Z"),
        receivedAt: new Date("2026-05-24T12:05:00.000Z"),
        name: "GET /checkout",
        status: "success",
        startedAt: new Date("2026-05-24T12:04:59.000Z"),
        endedAt: new Date("2026-05-24T12:05:00.000Z"),
        durationMs: 100
      });
      await insertTrace(db, {
        id: "trace_rate_edges_2",
        traceId: "trace_rate_edges_shared",
        projectId: "prj_rate_edges",
        environmentId: "env_rate_edges",
        timestamp: new Date("2026-05-24T12:05:00.000Z"),
        receivedAt: new Date("2026-05-24T12:05:00.000Z"),
        name: "GET /checkout",
        status: "success",
        startedAt: new Date("2026-05-24T12:04:59.000Z"),
        endedAt: new Date("2026-05-24T12:05:00.000Z"),
        durationMs: 100
      });
      await insertTrace(db, {
        id: "trace_rate_edges_null",
        projectId: "prj_rate_edges",
        environmentId: "env_rate_edges",
        timestamp: new Date("2026-05-24T12:05:00.000Z"),
        receivedAt: new Date("2026-05-24T12:05:00.000Z"),
        name: "GET /checkout",
        status: "success",
        startedAt: new Date("2026-05-24T12:04:59.000Z"),
        endedAt: new Date("2026-05-24T12:05:00.000Z"),
        durationMs: 100
      });
      await insertError(db, {
        id: "err_rate_edges_matched",
        traceId: "trace_rate_edges_shared",
        projectId: "prj_rate_edges",
        environmentId: "env_rate_edges",
        timestamp: new Date("2026-05-24T12:05:30.000Z"),
        receivedAt: new Date("2026-05-24T12:05:30.000Z"),
        message: "Checkout failed",
        severity: "error",
        fingerprint: "checkout"
      });
      await insertError(db, {
        id: "err_rate_edges_null",
        projectId: "prj_rate_edges",
        environmentId: "env_rate_edges",
        timestamp: new Date("2026-05-24T12:05:30.000Z"),
        receivedAt: new Date("2026-05-24T12:05:30.000Z"),
        message: "Null trace failed",
        severity: "error",
        fingerprint: "checkout-null"
      });

      const result = await evaluateAlertRule(db, {
        projectId: "prj_rate_edges",
        environmentId: "env_rate_edges",
        type: "error_rate",
        windowStart: new Date("2026-05-24T12:00:00.000Z"),
        windowEnd: new Date("2026-05-24T12:10:00.000Z"),
        routePattern: "GET /checkout",
        minimumSampleSize: 1
      });

      expect(result).toEqual({ observedValue: "33.333333" });
    });
  });

  it("evaluates trace p95 latency scoped by route pattern", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await insertProjectAndEnvironment(db, "prj_p95", "env_p95");
      await insertTraceRows(db, "prj_p95", "env_p95", 10, { name: "GET /checkout", durationMs: 100 });
      await insertTraceRows(db, "prj_p95", "env_p95", 10, {
        name: "GET /settings",
        durationMs: 2000
      });

      const result = await evaluateAlertRule(db, {
        projectId: "prj_p95",
        environmentId: "env_p95",
        type: "trace_p95_latency",
        windowStart: new Date("2026-05-24T12:00:00.000Z"),
        windowEnd: new Date("2026-05-24T12:10:00.000Z"),
        routePattern: "GET /checkout",
        minimumSampleSize: 5
      });

      expect(Number(result.observedValue)).toBeLessThan(200);
    });
  });

  it("records and reads the last retention run", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const startedAt = new Date("2026-05-06T12:00:00.000Z");
      const finishedAt = new Date("2026-05-06T12:00:05.000Z");
      const deleted = {
        events: 1,
        errors: 2,
        traces: 3,
        spans: 4,
        llmCalls: 5,
        breadcrumbs: 6,
        deadLetterJobs: 0,
          sourceMapArtifacts: 0,
        sourceMapFiles: 0
      };
      const policy = {
        eventsDays: 90,
        errorsDays: 180,
        tracesDays: 90,
        spansDays: 90,
        llmCallsDays: 180,
        breadcrumbsDays: 30,
        deadLetterJobsDays: 30,
        sourceMapsEnabled: true,
        sourceMapsDays: 180,
        sourceMapsBatchSize: 100
      };

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

  it("records source-map retention policy and deleted counts", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const startedAt = new Date("2026-05-13T10:00:00.000Z");
      const finishedAt = new Date("2026-05-13T10:00:05.000Z");

      const run = await recordRetentionRun(db, {
        startedAt,
        finishedAt,
        status: "success",
        deleted: {
          events: 1,
          errors: 2,
          traces: 3,
          spans: 4,
          llmCalls: 5,
          breadcrumbs: 6,
          deadLetterJobs: 0,
          sourceMapArtifacts: 7,
          sourceMapFiles: 8
        },
        policy: {
          eventsDays: 90,
          errorsDays: 180,
          tracesDays: 90,
          spansDays: 90,
          llmCallsDays: 180,
          breadcrumbsDays: 30,
          deadLetterJobsDays: 30,
        sourceMapsEnabled: true,
          sourceMapsDays: 180,
          sourceMapsBatchSize: 100
        }
      });

      await expect(
        db
          .selectFrom("retention_runs")
          .select([
            "deleted_source_map_artifacts",
            "deleted_source_map_files",
            "source_maps_enabled",
            "source_maps_days",
            "source_maps_batch_size"
          ])
          .where("id", "=", run.id)
          .executeTakeFirstOrThrow()
      ).resolves.toEqual({
        deleted_source_map_artifacts: 7,
        deleted_source_map_files: 8,
        source_maps_enabled: true,
        source_maps_days: 180,
        source_maps_batch_size: 100
      });
      await expect(getLastRetentionRun(db)).resolves.toEqual(run);
      expect(run.deleted.sourceMapArtifacts).toBe(7);
      expect(run.deleted.sourceMapFiles).toBe(8);
      expect(run.policy.sourceMapsEnabled).toBe(true);
      expect(run.policy.sourceMapsDays).toBe(180);
      expect(run.policy.sourceMapsBatchSize).toBe(100);
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
        llmCallsDays: 180,
        breadcrumbsDays: 30,
        deadLetterJobsDays: 30,
        sourceMapsEnabled: true,
        sourceMapsDays: 180,
        sourceMapsBatchSize: 100
      });

      expect(deleted).toEqual({
        events: 2,
        errors: 1,
        traces: 1,
        spans: 1,
        llmCalls: 1,
        breadcrumbs: 0,
        deadLetterJobs: 0,
          sourceMapArtifacts: 0,
        sourceMapFiles: 0
      });

      const filters = { projectId: project.id, environmentId: environment.id, limit: 10 };
      await expect(listEvents(db, filters)).resolves.toMatchObject({
        data: [expect.objectContaining({ id: "evt_fresh_retention" })]
      });
      await expect(listErrors(db, filters)).resolves.toMatchObject({
        data: [expect.objectContaining({ id: "err_fresh_retention" })]
      });
      await expect(listTraces(db, filters)).resolves.toMatchObject({
        data: [expect.objectContaining({ id: "trc_fresh_retention" })]
      });
      await expect(listTraceSpans(db, filters)).resolves.toMatchObject({
        data: [expect.objectContaining({ id: "spn_fresh_retention" })]
      });
      await expect(listLlmCalls(db, filters)).resolves.toMatchObject({
        data: [expect.objectContaining({ id: "llm_fresh_retention" })]
      });
    });
  });

  it("rejects retention table names outside the telemetry allowlist", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await expect(
        systemRepositoryTest.deleteExpiredBatchesFromTable(db, "users", new Date("2026-01-01T00:00:00.000Z"), 10, 1)
      ).rejects.toThrow("retention table is not allowed: users");
    });
  });

  it("deletes expired breadcrumbs during retention", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Breadcrumb Retention Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      await insertBreadcrumb(db, {
        id: "brd_old",
        projectId: project.id,
        environmentId: environment.id,
        sessionId: "sess_1",
        timestamp: new Date("2026-04-01T00:00:00.000Z"),
        receivedAt: new Date("2026-04-01T00:00:00.000Z"),
        type: "custom",
        message: "old",
        level: "info",
        data: {}
      });
      await insertBreadcrumb(db, {
        id: "brd_new",
        projectId: project.id,
        environmentId: environment.id,
        sessionId: "sess_1",
        timestamp: new Date("2026-05-10T00:00:00.000Z"),
        receivedAt: new Date("2026-05-10T00:00:00.000Z"),
        type: "custom",
        message: "new",
        level: "info",
        data: {}
      });

      const deleted = await deleteExpiredTelemetry(db, {
        now: new Date("2026-05-11T00:00:00.000Z"),
        batchSize: 100,
        eventsDays: 90,
        errorsDays: 180,
        tracesDays: 90,
        spansDays: 90,
        llmCallsDays: 180,
        breadcrumbsDays: 30,
        deadLetterJobsDays: 30,
        sourceMapsEnabled: true,
        sourceMapsDays: 180,
        sourceMapsBatchSize: 100
      });

      expect(deleted.breadcrumbs).toBe(1);
      await expect(
        db.selectFrom("breadcrumbs").select("id").where("id", "=", "brd_old").executeTakeFirst()
      ).resolves.toBeUndefined();
      await expect(
        db.selectFrom("breadcrumbs").select("id").where("id", "=", "brd_new").executeTakeFirst()
      ).resolves.toBeTruthy();
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
        llmCallsDays: 180,
        breadcrumbsDays: 30,
        deadLetterJobsDays: 30,
        sourceMapsEnabled: true,
        sourceMapsDays: 180,
        sourceMapsBatchSize: 100
      });

      expect(deleted.events).toBe(1);
      await expect(listEvents(db, { projectId: project.id, environmentId: environment.id, limit: 10 })).resolves.toMatchObject({
        data: expect.arrayContaining([expect.objectContaining({ id: "evt_bounded_retention_2" })])
      });
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
      expect(events.data).toHaveLength(1);
      expect(events.data[0].name).toBe("dashboard_created");

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
        projectId: null,
        environmentId: null,
        queueName: "telemetry",
        jobName: "event",
        payload: { metadata: { authorization: "[REDACTED]" } },
        errorMessage: "authorization: [REDACTED]",
        createdAt: expect.any(Date)
      });
    });
  });

  it("lists dead letter jobs newest first with a bounded limit", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await db.deleteFrom("dead_letter_jobs").execute();

      const first = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "old" },
        errorMessage: "old failure"
      });
      const second = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "error",
        payload: { id: "new" },
        errorMessage: "new failure"
      });
      await db
        .updateTable("dead_letter_jobs")
        .set({ created_at: new Date("2026-06-01T00:00:00.000Z") })
        .where("id", "=", first.id)
        .execute();
      await db
        .updateTable("dead_letter_jobs")
        .set({ created_at: new Date("2026-06-01T00:01:00.000Z") })
        .where("id", "=", second.id)
        .execute();

      const firstPage = await listDeadLetterJobs(db, { limit: 1 });

      expect(firstPage.deadLetterJobs).toEqual([
        expect.objectContaining({
          id: second.id,
          queueName: "telemetry",
          jobName: "error",
          payload: { id: "new" },
          errorMessage: "new failure"
        })
      ]);
      expect(firstPage.deadLetterJobs).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: first.id })]));
      expect(firstPage.cursor).toEqual(expect.any(String));

      const secondPage = await listDeadLetterJobs(db, { limit: 1, cursor: firstPage.cursor });
      expect(secondPage.deadLetterJobs).toEqual([
        expect.objectContaining({
          id: first.id,
          queueName: "telemetry",
          jobName: "event",
          payload: { id: "old" },
          errorMessage: "old failure"
        })
      ]);
      expect(secondPage.cursor).toBeUndefined();

      await expect(listDeadLetterJobs(db, { cursor: "not-json" })).rejects.toThrow("invalid_cursor");
    });
  });

  it("filters dead letter jobs before applying cursor pagination", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await db.deleteFrom("dead_letter_jobs").execute();

      const matchingOld = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "matching-old" },
        errorMessage: "disk 100% full"
      });
      const matchingNew = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "matching-new" },
        errorMessage: "DISK 100% warning"
      });
      const wrongQueue = await insertDeadLetterJob(db, {
        queueName: "billing",
        jobName: "event",
        payload: { id: "wrong-queue" },
        errorMessage: "disk 100% full"
      });
      const wrongJob = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "error",
        payload: { id: "wrong-job" },
        errorMessage: "disk 100% full"
      });
      const wildcardTrap = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "wildcard-trap" },
        errorMessage: "disk 1000 full"
      });
      const underscoreTrap = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "underscore-trap" },
        errorMessage: "disk 100a full"
      });
      const backslashTrap = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "backslash-trap" },
        errorMessage: "disk path c:temp full"
      });
      const outOfRange = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "out-of-range" },
        errorMessage: "disk 100% old"
      });

      const setCreatedAt = async (id: string, createdAt: string) => {
        await db
          .updateTable("dead_letter_jobs")
          .set({ created_at: new Date(createdAt) })
          .where("id", "=", id)
          .execute();
      };
      await setCreatedAt(matchingOld.id, "2026-06-01T00:00:00.000Z");
      await setCreatedAt(matchingNew.id, "2026-06-01T00:02:00.000Z");
      await setCreatedAt(wrongQueue.id, "2026-06-01T00:03:00.000Z");
      await setCreatedAt(wrongJob.id, "2026-06-01T00:04:00.000Z");
      await setCreatedAt(wildcardTrap.id, "2026-06-01T00:05:00.000Z");
      await setCreatedAt(underscoreTrap.id, "2026-06-01T00:06:00.000Z");
      await setCreatedAt(backslashTrap.id, "2026-06-01T00:07:00.000Z");
      await setCreatedAt(outOfRange.id, "2026-05-31T23:59:00.000Z");

      const firstPage = await listDeadLetterJobs(db, {
        limit: 1,
        queueName: "telemetry",
        jobName: "event",
        error: "100%",
        createdFrom: new Date("2026-06-01T00:00:00.000Z"),
        createdTo: new Date("2026-06-01T00:03:00.000Z"),
        status: "pending"
      });

      expect(firstPage.deadLetterJobs).toEqual([
        expect.objectContaining({
          id: matchingNew.id,
          payload: { id: "matching-new" },
          errorMessage: "DISK 100% warning"
        })
      ]);
      expect(firstPage.cursor).toEqual(expect.any(String));

      const secondPage = await listDeadLetterJobs(db, {
        limit: 1,
        cursor: firstPage.cursor,
        queueName: "telemetry",
        jobName: "event",
        error: "100%",
        createdFrom: new Date("2026-06-01T00:00:00.000Z"),
        createdTo: new Date("2026-06-01T00:03:00.000Z"),
        status: "pending"
      });

      expect(secondPage.deadLetterJobs).toEqual([
        expect.objectContaining({
          id: matchingOld.id,
          payload: { id: "matching-old" },
          errorMessage: "disk 100% full"
        })
      ]);
      expect(secondPage.cursor).toBeUndefined();
      expect([...firstPage.deadLetterJobs, ...secondPage.deadLetterJobs]).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: wrongQueue.id }),
          expect.objectContaining({ id: wrongJob.id }),
          expect.objectContaining({ id: wildcardTrap.id }),
          expect.objectContaining({ id: underscoreTrap.id }),
          expect.objectContaining({ id: backslashTrap.id }),
          expect.objectContaining({ id: outOfRange.id })
        ])
      );
      await expect(
        listDeadLetterJobs(db, {
          limit: 1,
          cursor: firstPage.cursor,
          queueName: "telemetry",
          jobName: "event",
          error: "1000",
          createdFrom: new Date("2026-06-01T00:00:00.000Z"),
          createdTo: new Date("2026-06-01T00:03:00.000Z"),
          status: "pending"
        })
      ).rejects.toThrow("invalid_cursor_scope");

      const underscoreMatch = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "underscore-match" },
        errorMessage: "disk 100_ full"
      });
      const backslashMatch = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "backslash-match" },
        errorMessage: String.raw`disk path c:\temp full`
      });
      const literalUnderscorePage = await listDeadLetterJobs(db, {
        queueName: "telemetry",
        jobName: "event",
        error: "100_"
      });
      expect(literalUnderscorePage.deadLetterJobs).toEqual([
        expect.objectContaining({ id: underscoreMatch.id, errorMessage: "disk 100_ full" })
      ]);
      const literalBackslashPage = await listDeadLetterJobs(db, {
        queueName: "telemetry",
        jobName: "event",
        error: String.raw`c:\temp`
      });
      expect(literalBackslashPage.deadLetterJobs).toEqual([
        expect.objectContaining({ id: backslashMatch.id, errorMessage: String.raw`disk path c:\temp full` })
      ]);
    });
  });

  it("expires old dead letter jobs and records retained audit actions", async () => {
    await withDb(async (db) => {
      await migrate(db);
      await db.deleteFrom("dead_letter_job_actions").execute();
      await db.deleteFrom("dead_letter_jobs").execute();

      const oldJob = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "old" },
        errorMessage: "old failure"
      });
      const freshJob = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "error",
        payload: { id: "fresh" },
        errorMessage: "fresh failure"
      });
      await db
        .updateTable("dead_letter_jobs")
        .set({ created_at: new Date("2026-05-01T00:00:00.000Z") })
        .where("id", "=", oldJob.id)
        .execute();
      await db
        .updateTable("dead_letter_jobs")
        .set({ created_at: new Date("2026-06-01T00:00:00.000Z") })
        .where("id", "=", freshJob.id)
        .execute();

      const deleted = await deleteExpiredDeadLetterJobs(db, {
        cutoff: new Date("2026-05-15T00:00:00.000Z"),
        batchSize: 10
      });

      expect(deleted).toBe(1);
      await expect(getDeadLetterJob(db, oldJob.id)).resolves.toBeUndefined();
      await expect(getDeadLetterJob(db, freshJob.id)).resolves.toMatchObject({ id: freshJob.id });
      await expect(listDeadLetterJobActions(db, oldJob.id)).resolves.toEqual([
        expect.objectContaining({
          deadLetterJobId: oldJob.id,
          action: "expired",
          actorUserId: null,
          actorEmail: "system:retention",
          metadata: { cutoff: "2026-05-15T00:00:00.000Z" }
        })
      ]);
    });
  });

  it("gets and deletes dead letter jobs by id", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const job = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "trace",
        payload: { id: "trc_dead_letter" },
        errorMessage: "trace insert failed"
      });

      await expect(getDeadLetterJob(db, job.id)).resolves.toMatchObject({
        id: job.id,
        queueName: "telemetry",
        jobName: "trace",
        payload: { id: "trc_dead_letter" }
      });
      await expect(deleteDeadLetterJob(db, job.id)).resolves.toBe(true);
      await expect(getDeadLetterJob(db, job.id)).resolves.toBeUndefined();
      await expect(deleteDeadLetterJob(db, job.id)).resolves.toBe(false);
    });
  });

  it("records dead letter job actions and preserves audit history when deleting", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const job = await insertDeadLetterJob(db, {
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "evt_dead_letter_action" },
        errorMessage: "insert failed"
      });

      const action = await recordDeadLetterJobAction(db, job, {
        action: "replayed",
        actor: { userId: null, email: "admin@example.com" },
        metadata: { replayAttemptId: "rpl_1" }
      });

      expect(action).toMatchObject({
        id: expect.stringMatching(/^dla_/),
        deadLetterJobId: job.id,
        queueName: "telemetry",
        jobName: "event",
        action: "replayed",
        actorUserId: null,
        actorEmail: "admin@example.com",
        metadata: { replayAttemptId: "rpl_1" },
        createdAt: expect.any(Date)
      });

      await expect(listDeadLetterJobActions(db, job.id)).resolves.toEqual([
        expect.objectContaining({ id: action.id, action: "replayed" })
      ]);

      await expect(
        deleteDeadLetterJobWithAction(db, job.id, {
          action: "deleted",
          actor: { userId: null, email: "admin@example.com" }
        })
      ).resolves.toBe(true);
      await expect(getDeadLetterJob(db, job.id)).resolves.toBeUndefined();
      await expect(deleteDeadLetterJobWithAction(db, job.id, { action: "deleted", actor: { userId: null, email: "admin@example.com" } })).resolves.toBe(false);

      const actions = await listDeadLetterJobActions(db, job.id);
      expect(actions.map((row) => row.action)).toEqual(["deleted", "replayed"]);
      expect(actions[0]).toMatchObject({
        deadLetterJobId: job.id,
        queueName: "telemetry",
        jobName: "event",
        actorEmail: "admin@example.com"
      });
    });
  });

  it("counts dead letter jobs for operational health", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Dead Letter Count Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const otherEnvironment = await createEnvironment(db, { projectId: project.id, name: "staging" });
      const before = await countDeadLetterJobs(db);
      await insertDeadLetterJob(db, {
        projectId: project.id,
        environmentId: environment.id,
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "evt_dead_letter" },
        errorMessage: "event insert failed"
      });
      await insertDeadLetterJob(db, {
        projectId: project.id,
        environmentId: environment.id,
        queueName: "telemetry",
        jobName: "trace",
        payload: { id: "trc_dead_letter" },
        errorMessage: "trace insert failed"
      });
      await insertDeadLetterJob(db, {
        projectId: project.id,
        environmentId: otherEnvironment.id,
        queueName: "telemetry",
        jobName: "event",
        payload: { id: "other_env_dead_letter" },
        errorMessage: "event insert failed"
      });

      await expect(countDeadLetterJobs(db)).resolves.toBe(before + 3);
      await expect(countDeadLetterJobs(db, { projectId: project.id, environmentId: environment.id })).resolves.toBe(2);
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
      await expect(updateApiKeyRecord(db, apiKey.id, { name: "runtime key renamed" })).resolves.toMatchObject({
        id: apiKey.id,
        name: "runtime key renamed"
      });
      await expect(findApiKeyByPrefix(db, "sh_runtime12")).resolves.toMatchObject({ id: apiKey.id });

      const browserOrigin = await createProjectBrowserOrigin(db, {
        projectId: project.id,
        origin: "https://app.example.com/dashboard"
      });
      await expect(listProjectBrowserOrigins(db, project.id)).resolves.toEqual([
        expect.objectContaining({
          id: browserOrigin.id,
          projectId: project.id,
          origin: "https://app.example.com"
        })
      ]);
      await archiveProjectBrowserOrigin(db, browserOrigin.id);
      await expect(listProjectBrowserOrigins(db, project.id)).resolves.toEqual([]);

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
        createProjectBrowserOrigin(db, {
          projectId: archivedProject.id,
          origin: "https://archived.example.com"
        })
      ).rejects.toThrow("active_project_not_found");
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

  it("rejects telemetry writes under archived project or environment scopes", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const archivedProject = await createProject(db, { name: "Archived Telemetry Write Project" });
      const archivedProjectEnvironment = await createEnvironment(db, {
        projectId: archivedProject.id,
        name: "production"
      });
      const activeProject = await createProject(db, { name: "Archived Telemetry Write Environment Project" });
      const archivedEnvironment = await createEnvironment(db, { projectId: activeProject.id, name: "archived" });
      await archiveProject(db, archivedProject.id);
      await archiveEnvironment(db, archivedEnvironment.id);

      const base = {
        projectId: archivedProject.id,
        environmentId: archivedProjectEnvironment.id,
        timestamp: new Date("2026-05-02T12:00:00.000Z"),
        receivedAt: new Date("2026-05-02T12:00:01.000Z")
      };
      const archivedEnvironmentBase = {
        ...base,
        projectId: activeProject.id,
        environmentId: archivedEnvironment.id
      };
      const writes = [
        () => insertEvent(db, { ...base, id: "evt_archived_scope", name: "archived.scope" }),
        () => insertError(db, { ...base, id: "err_archived_scope", message: "archived", severity: "error" }),
        () =>
          insertLlmCall(db, {
            ...base,
            id: "llm_archived_scope",
            provider: "openai",
            model: "gpt-5",
            status: "success"
          }),
        () =>
          insertTrace(db, {
            ...base,
            id: "trc_archived_scope",
            name: "archived trace",
            status: "ok",
            startedAt: base.timestamp
          }),
        () =>
          insertSpan(db, {
            ...base,
            id: "spn_archived_scope",
            traceId: "trc_archived_scope",
            name: "archived span",
            status: "ok",
            startedAt: base.timestamp
          }),
        () =>
          insertBreadcrumb(db, {
            ...base,
            id: "brd_archived_scope",
            type: "custom" as const,
            message: "archived",
            level: "info" as const
          }),
        () => insertEvent(db, { ...archivedEnvironmentBase, id: "evt_archived_environment", name: "archived.environment" })
      ];

      for (const write of writes) {
        await expect(write()).rejects.toThrow("active_telemetry_scope_not_found");
      }
    });
  });

  it("keeps duplicate telemetry retries idempotent after the scope is archived", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Archived Idempotent Retry Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-02T12:00:00.000Z"),
        receivedAt: new Date("2026-05-02T12:00:01.000Z")
      };
      const writes = [
        () => insertEvent(db, { ...base, id: "evt_archived_retry", name: "archived.retry" }),
        () => insertError(db, { ...base, id: "err_archived_retry", message: "archived retry", severity: "error" }),
        () =>
          insertLlmCall(db, {
            ...base,
            id: "llm_archived_retry",
            provider: "openai",
            model: "gpt-5",
            status: "success"
          }),
        () =>
          insertTrace(db, {
            ...base,
            id: "trc_archived_retry",
            name: "archived retry trace",
            status: "ok",
            startedAt: base.timestamp
          }),
        () =>
          insertSpan(db, {
            ...base,
            id: "spn_archived_retry",
            traceId: "trc_archived_retry",
            name: "archived retry span",
            status: "ok",
            startedAt: base.timestamp
          }),
        () =>
          insertBreadcrumb(db, {
            ...base,
            id: "brd_archived_retry",
            type: "custom" as const,
            message: "archived retry",
            level: "info" as const
          })
      ];

      for (const write of writes) {
        await expect(write()).resolves.toBeUndefined();
      }

      await archiveProject(db, project.id);

      for (const write of writes) {
        await expect(write()).resolves.toBeUndefined();
      }
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
      await expect(listEvents(db, filters)).resolves.toMatchObject({ data: [expect.objectContaining({ id: "evt_runtime" })] });
      await expect(listErrors(db, filters)).resolves.toMatchObject({ data: [expect.objectContaining({ id: "err_runtime" })] });
      await expect(listLlmCalls(db, filters)).resolves.toMatchObject({ data: [expect.objectContaining({ id: "llm_runtime" })] });
      await expect(listTraces(db, filters)).resolves.toMatchObject({ data: [expect.objectContaining({ id: "trc_runtime" })] });
      await expect(listTraceSpans(db, filters)).resolves.toMatchObject({ data: [expect.objectContaining({ id: "spn_runtime" })] });
      await expect(getEventAggregates(db, filters)).resolves.toMatchObject({ total: 1 });
      await expect(getErrorAggregates(db, filters)).resolves.toMatchObject({ total: 1, open: 1 });
      await expect(getLlmAggregates(db, filters)).resolves.toMatchObject({ totalCalls: 1, totalInputTokens: 3 });
      await expect(getTraceAggregates(db, filters)).resolves.toMatchObject({ total: 1, averageDurationMs: 20 });
    });
  });

  it("aggregates APM endpoint latency, throughput, error rate, and Apdex", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "APM Endpoint Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date("2026-05-24T12:00:00.000Z");
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-24T11:55:00.000Z"),
        receivedAt: new Date("2026-05-24T11:55:01.000Z"),
        startedAt: new Date("2026-05-24T11:55:00.000Z"),
        endedAt: new Date("2026-05-24T11:55:01.000Z"),
        metadata: {}
      };

      await insertTrace(db, {
        ...base,
        id: "trc_apm_orders_1",
        traceId: "trace_apm_orders_1",
        name: "GET /api/orders",
        status: "success",
        durationMs: 100
      });
      await insertTrace(db, {
        ...base,
        id: "trc_apm_orders_2",
        traceId: "trace_apm_orders_2",
        name: "GET /api/orders",
        status: "success",
        durationMs: 600
      });
      await insertTrace(db, {
        ...base,
        id: "trc_apm_orders_3",
        traceId: "trace_apm_orders_3",
        name: "GET /api/orders",
        status: "error",
        durationMs: 2400
      });
      await insertTrace(db, {
        ...base,
        id: "trc_apm_health",
        traceId: "trace_apm_health",
        name: "GET /api/health",
        status: "success",
        durationMs: 20
      });
      await insertTrace(db, {
        ...base,
        id: "trc_apm_old",
        traceId: "trace_apm_old",
        timestamp: new Date("2026-05-20T11:55:00.000Z"),
        name: "GET /api/old",
        status: "error",
        durationMs: 5000
      });

      const apm = await getApmEndpoints(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h",
        now
      });

      expect(apm.totals).toMatchObject({
        endpoints: 2,
        requests: 4,
        errors: 1,
        errorRatePercent: 25
      });
      expect(apm.endpoints[0]).toMatchObject({
        name: "GET /api/orders",
        requests: 3,
        errors: 1,
        errorRatePercent: 33,
        p50DurationMs: 600,
        p95DurationMs: 2220,
        p99DurationMs: 2364,
        averageDurationMs: 1033,
        apdex: 0.5
      });
      expect(apm.endpoints[1]).toMatchObject({
        name: "GET /api/health",
        requests: 1,
        errors: 0,
        p95DurationMs: 20,
        apdex: 1
      });
      await expect(
        listTraces(db, { projectId: project.id, environmentId: environment.id, traceName: "GET /api/orders", limit: 10 })
      ).resolves.toMatchObject({ data: expect.arrayContaining([expect.objectContaining({ name: "GET /api/orders" })]) });
    });
  });

  it("returns a compact mixed session timeline around a center timestamp", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Session Timeline Mixed" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_timeline",
        userId: "user_timeline",
        sessionId: "session_timeline",
        traceId: "trace_timeline",
        receivedAt: new Date("2026-05-11T12:00:01.000Z"),
        source: "browser",
        release: "1.2.3",
        metadata: { hidden: "metadata should stay out of item data" }
      };

      await insertEvent(db, {
        ...base,
        id: "evt_session_timeline",
        timestamp: new Date("2026-05-11T11:59:00.000Z"),
        name: "checkout_started",
        properties: { step: "checkout" }
      });
      await insertBreadcrumb(db, {
        ...base,
        id: "brd_session_timeline",
        timestamp: new Date("2026-05-11T12:00:00.000Z"),
        type: "click",
        category: "button",
        message: "Clicked Pay",
        level: "info",
        data: { tag: "button" }
      });
      await insertTrace(db, {
        ...base,
        id: "trc_session_timeline",
        timestamp: new Date("2026-05-11T12:00:30.000Z"),
        name: "POST /checkout",
        status: "ok",
        startedAt: new Date("2026-05-11T12:00:30.000Z"),
        durationMs: 120
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_session_timeline",
        timestamp: new Date("2026-05-11T12:00:45.000Z"),
        provider: "openai",
        model: "gpt-5",
        promptName: "risk_check",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: "0.010000",
        latencyMs: 450,
        status: "success"
      });
      await insertError(db, {
        ...base,
        id: "err_session_timeline",
        timestamp: new Date("2026-05-11T12:01:00.000Z"),
        message: "Payment failed",
        severity: "error",
        context: { hidden: "context should stay out of item data" }
      });

      await insertEvent(db, {
        ...base,
        id: "evt_outside_timeline",
        timestamp: new Date("2026-05-11T12:03:00.000Z"),
        name: "outside_window"
      });

      const timeline = await getSessionTimeline(db, {
        projectId: project.id,
        environmentId: environment.id,
        sessionId: "session_timeline",
        center: new Date("2026-05-11T12:01:00.000Z"),
        beforeMs: 2 * 60 * 1000,
        afterMs: 60 * 1000,
        limit: 20
      });

      expect(timeline).toMatchObject({
        sessionId: "session_timeline",
        scope: { projectId: project.id, environmentId: environment.id },
        range: {
          from: "2026-05-11T11:59:00.000Z",
          to: "2026-05-11T12:02:00.000Z"
        },
        page: { nextCursor: null, previousCursor: null }
      });
      expect(timeline.items.map((item) => `${item.type}:${item.id}`)).toEqual([
        "event:evt_session_timeline",
        "breadcrumb:brd_session_timeline",
        "trace:trc_session_timeline",
        "llm:llm_session_timeline",
        "error:err_session_timeline"
      ]);
      expect(timeline.items[0]).toMatchObject({
        id: "evt_session_timeline",
        title: "checkout_started",
        tenantId: "tenant_timeline",
        userId: "user_timeline",
        sessionId: "session_timeline",
        traceId: "trace_timeline",
        source: "browser",
        release: "1.2.3",
        data: { properties: { step: "checkout" } }
      });
      expect(timeline.items[1]).toMatchObject({
        title: "Clicked Pay",
        level: "info",
        data: { breadcrumbType: "click", category: "button", data: { tag: "button" } }
      });
      expect(JSON.stringify(timeline.items)).not.toContain("context should stay out");
      expect(JSON.stringify(timeline.items)).not.toContain("metadata should stay out");
    });
  });

  it("keeps session timeline scope filters isolated and excludes spans", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Session Timeline Scope" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const otherEnvironment = await createEnvironment(db, { projectId: project.id, name: "staging" });
      const otherProject = await createProject(db, { name: "Session Timeline Other Scope" });
      const otherProjectEnvironment = await createEnvironment(db, { projectId: otherProject.id, name: "production" });
      const base = {
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_match",
        userId: "user_match",
        sessionId: "session_scope",
        traceId: "trace_scope",
        timestamp: new Date("2026-05-11T12:00:00.000Z"),
        receivedAt: new Date("2026-05-11T12:00:01.000Z")
      };

      await insertBreadcrumb(db, {
        ...base,
        id: "same_time_brd_scope",
        type: "custom",
        message: "Same time breadcrumb",
        level: "info"
      });
      await insertEvent(db, {
        ...base,
        id: "same_time_evt_scope",
        name: "same_time_event"
      });
      await insertError(db, {
        ...base,
        id: "err_scope",
        timestamp: new Date("2026-05-11T12:01:00.000Z"),
        message: "Scoped error",
        severity: "error"
      });
      await insertLlmCall(db, {
        ...base,
        id: "llm_scope",
        timestamp: new Date("2026-05-11T12:02:00.000Z"),
        provider: "openai",
        model: "gpt-5",
        inputTokens: 1,
        outputTokens: 2,
        costUsd: "0.001000",
        status: "success"
      });
      await insertTrace(db, {
        ...base,
        id: "trc_filtered_by_type_scope",
        timestamp: new Date("2026-05-11T12:03:00.000Z"),
        name: "filtered trace",
        status: "ok",
        startedAt: new Date("2026-05-11T12:03:00.000Z")
      });
      await insertSpan(db, {
        ...base,
        id: "spn_scope_must_not_return",
        name: "span excluded",
        status: "ok",
        startedAt: new Date("2026-05-11T12:00:00.000Z")
      });
      await insertEvent(db, {
        ...base,
        id: "evt_wrong_project_scope",
        projectId: otherProject.id,
        environmentId: otherProjectEnvironment.id,
        name: "wrong_project"
      });
      await insertEvent(db, {
        ...base,
        id: "evt_wrong_environment_scope",
        environmentId: otherEnvironment.id,
        name: "wrong_environment"
      });
      await insertEvent(db, {
        ...base,
        id: "evt_wrong_session_scope",
        sessionId: "other_session",
        name: "wrong_session"
      });
      await insertEvent(db, {
        ...base,
        id: "evt_wrong_tenant_scope",
        tenantId: "tenant_other",
        name: "wrong_tenant"
      });
      await insertEvent(db, {
        ...base,
        id: "evt_wrong_user_scope",
        userId: "user_other",
        name: "wrong_user"
      });

      const timeline = await getSessionTimeline(db, {
        projectId: project.id,
        environmentId: environment.id,
        sessionId: "session_scope",
        tenantId: "tenant_match",
        userId: "user_match",
        types: ["breadcrumb", "event", "error", "llm"],
        from: new Date("2026-05-11T11:59:00.000Z"),
        to: new Date("2026-05-11T12:05:00.000Z"),
        limit: 20
      });

      expect(timeline.items.map((item) => `${item.type}:${item.id}`)).toEqual([
        "breadcrumb:same_time_brd_scope",
        "event:same_time_evt_scope",
        "error:err_scope",
        "llm:llm_scope"
      ]);
      expect(timeline.items.map((item) => item.id)).not.toContain("spn_scope_must_not_return");
      expect(timeline.items.map((item) => item.id)).not.toContain("trc_filtered_by_type_scope");
      expect(timeline.items.every((item) => item.tenantId === "tenant_match")).toBe(true);
      expect(timeline.items.every((item) => item.userId === "user_match")).toBe(true);
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

      await expect(listLlmCalls(db, filters)).resolves.toMatchObject({
        data: [expect.objectContaining({ id: "llm_match" })]
      });
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

  it("builds project operations health from monitors alerts incidents and telemetry", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Operations Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date("2026-05-25T12:00:00.000Z");
      const inWindow = new Date("2026-05-25T11:50:00.000Z");
      const receivedAt = new Date("2026-05-25T11:50:01.000Z");

      const channel = await createNotificationChannel(db, {
        name: "Ops email",
        type: "email",
        emailRecipients: ["ops@example.com"],
        enabled: true
      });

      const httpMonitor = await createHttpMonitor(db, {
        projectId: project.id,
        environmentId: environment.id,
        notificationChannelId: channel.id,
        name: "API uptime",
        url: "https://api.example.com/health",
        method: "GET",
        intervalMinutes: 5,
        timeoutMs: 5000,
        expectedStatus: "2xx",
        failureThreshold: 2,
        recoveryThreshold: 2,
        enabled: true
      });
      await recordMonitorCheck(db, {
        monitorId: httpMonitor.id,
        checkedAt: inWindow,
        status: "success",
        latencyMs: 82,
        responseStatus: 200
      });

      await createHeartbeatMonitor(db, {
        projectId: project.id,
        environmentId: environment.id,
        notificationChannelId: channel.id,
        name: "Queue worker heartbeat",
        expectedIntervalMinutes: 5,
        graceMinutes: 2,
        secretHash: "hashed-secret",
        enabled: true
      });

      const rule = await createAlertRule(db, {
        projectId: project.id,
        environmentId: environment.id,
        notificationChannelId: channel.id,
        name: "Checkout p95",
        type: "trace_p95_latency",
        severity: "warning",
        windowMinutes: 10,
        threshold: "750",
        cooldownMinutes: 20,
        routePattern: "checkout",
        minimumSampleSize: 1,
        enabled: true
      });
      const alertEvent = await recordAlertEvent(db, {
        rule,
        triggeredAt: inWindow,
        windowStart: new Date("2026-05-25T11:40:00.000Z"),
        windowEnd: inWindow,
        observedValue: "900",
        message: "Checkout p95 latency is high",
        metadata: {}
      });
      await recordNotificationDelivery(db, {
        alertEventId: alertEvent.id,
        notificationChannelId: channel.id,
        status: "failed",
        attemptedAt: inWindow,
        responseStatus: null,
        errorMessage: "smtp unavailable"
      });

      await insertEvent(db, {
        projectId: project.id,
        environmentId: environment.id,
        id: "evt_operations_1",
        name: "checkout.started",
        timestamp: inWindow,
        receivedAt
      });
      await insertError(db, {
        projectId: project.id,
        environmentId: environment.id,
        id: "err_operations_1",
        message: "Checkout failed",
        severity: "critical",
        status: "open",
        traceId: "trace_checkout_1",
        timestamp: inWindow,
        receivedAt
      });
      await insertTrace(db, {
        projectId: project.id,
        environmentId: environment.id,
        id: "trc_checkout_1",
        traceId: "trace_checkout_1",
        name: "checkout",
        status: "error",
        timestamp: inWindow,
        receivedAt,
        startedAt: inWindow,
        durationMs: 900
      });

      const operations = await getOperations(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h",
        now
      });

      expect(operations.status).toBe("degraded");
      expect(operations.summary.monitors.total).toBe(2);
      expect(operations.summary.alerts.events.deliveryFailed).toBe(1);
      expect(operations.summary.telemetry).toMatchObject({
        events: 1,
        errors: 1,
        traces: 1,
        failedTraces: 1,
        errorRatePercent: 100
      });
      expect(operations.topLatency).toEqual([
        { name: "checkout", p95TraceDurationMs: 900, traces: 1, failedTraces: 1 }
      ]);
      expect(operations.recent.alerts[0]).toMatchObject({
        message: "Checkout p95 latency is high",
        latestDeliveryStatus: "failed"
      });
      expect(operations.setupGaps.map((gap) => gap.key)).not.toContain("http_monitor");
    });
  });

  it("marks operations as not configured when no operational data exists", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Empty Operations Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      const operations = await getOperations(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h",
        now: new Date("2026-05-25T12:00:00.000Z")
      });

      expect(operations.status).toBe("not_configured");
      expect(operations.setupGaps.map((gap) => gap.key)).toEqual([
        "http_monitor",
        "heartbeat_monitor",
        "alert_rule",
        "notification_channel",
        "recent_telemetry"
      ]);
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
      await insertEvent(db, {
        ...base,
        id: "evt_entity_search_same_tenant_other_user",
        timestamp: new Date("2026-05-05T10:02:00.000Z"),
        name: "same.tenant.other.user",
        tenantId: "tenant_beta",
        userId: "user_other",
        sessionId: "session_c"
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
      expect(byUser.tenants[0]).toMatchObject({ events: 0, errors: 1, activeUsers: 1 });
    });
  });

  it("joins tenant profile traits into tenant list detail and profile search", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Entity Profiles" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date("2026-05-05T12:00:00.000Z");
      const receivedAt = new Date("2026-05-05T12:00:01.000Z");

      await identifyTenantProfile(db, {
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_1",
        traits: { name: "MicroERP", plan: "pro" },
        timestamp: new Date("2026-05-05T11:00:00.000Z")
      });
      await identifyTenantProfile(db, {
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_email",
        traits: { email: "billing@tenant.example" },
        timestamp: new Date("2026-05-05T11:00:00.000Z")
      });
      await identifyTenantProfile(db, {
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant_display",
        traits: { display_name: "Display ERP", operation_mode: 2, status: true },
        timestamp: new Date("2026-05-05T11:00:00.000Z")
      });
      await insertEvent(db, {
        id: "evt_tenant_profile",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-05T11:05:00.000Z"),
        receivedAt,
        name: "profile.match",
        tenantId: "tenant_1",
        userId: "user_1",
        sessionId: "session_1"
      });
      await insertEvent(db, {
        id: "evt_tenant_profile_email",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-05T11:06:00.000Z"),
        receivedAt,
        name: "profile.email",
        tenantId: "tenant_email",
        userId: "user_email",
        sessionId: "session_email"
      });
      await insertEvent(db, {
        id: "evt_tenant_profile_display",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-05T11:06:30.000Z"),
        receivedAt,
        name: "profile.display",
        tenantId: "tenant_display",
        userId: "user_display",
        sessionId: "session_display"
      });
      await insertEvent(db, {
        id: "evt_tenant_profile_unassigned",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-05T11:07:00.000Z"),
        receivedAt,
        name: "profile.unassigned",
        userId: "user_unassigned",
        sessionId: "session_unassigned"
      });

      const result = await listEntityTenants(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "MicroERP",
        limit: 50,
        now
      });

      expect(result.tenants).toHaveLength(1);
      expect(result.tenants[0]).toMatchObject({
        tenantId: "tenant_1",
        label: "MicroERP",
        traits: { name: "MicroERP", plan: "pro" },
        keyTraits: { plan: "pro" }
      });

      const detail = await getEntityTenantDetail(db, "tenant_1", {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        limit: 50,
        now
      });
      expect(detail.tenant).toMatchObject({
        tenantId: "tenant_1",
        label: "MicroERP",
        traits: { name: "MicroERP", plan: "pro" },
        keyTraits: { plan: "pro" }
      });

      const byEmail = await listEntityTenants(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "billing@tenant",
        limit: 50,
        now
      });
      expect(byEmail.tenants.map((tenant) => tenant.tenantId)).toEqual(["tenant_email"]);

      const byDisplayName = await listEntityTenants(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "Display ERP",
        limit: 50,
        now
      });
      expect(byDisplayName.tenants[0]).toMatchObject({
        tenantId: "tenant_display",
        label: "Display ERP",
        keyTraits: { operation_mode: "2", status: "true" }
      });

      const byPlan = await listEntityTenants(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "pro",
        limit: 50,
        now
      });
      expect(byPlan.tenants.map((tenant) => tenant.tenantId)).toEqual(["tenant_1"]);

      const byOperationMode = await listEntityTenants(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "2",
        limit: 50,
        now
      });
      expect(byOperationMode.tenants.map((tenant) => tenant.tenantId)).toEqual(["tenant_display"]);

      const byStatus = await listEntityTenants(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "true",
        limit: 50,
        now
      });
      expect(byStatus.tenants.map((tenant) => tenant.tenantId)).toEqual(["tenant_display"]);

      const allTenants = await listEntityTenants(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        limit: 50,
        now
      });
      expect(allTenants.tenants.find((tenant) => tenant.tenantId === null)).toMatchObject({
        label: "Unassigned",
        traits: {},
        keyTraits: {}
      });
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
        id: "evt_user_search_one_other_session",
        timestamp: new Date("2026-05-05T10:00:30.000Z"),
        name: "user.other.session",
        tenantId: "tenant_match",
        userId: "user_match",
        sessionId: "session_other_match_user"
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
      expect(bySession.users[0]).toMatchObject({ events: 1, activeSessions: 1 });

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

  it("joins user profile traits into user list detail and profile search", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "User Profiles" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date("2026-05-05T12:00:00.000Z");
      const receivedAt = new Date("2026-05-05T12:00:01.000Z");

      await identifyUserProfile(db, {
        projectId: project.id,
        environmentId: environment.id,
        userId: "user_1",
        tenantId: "tenant_1",
        traits: { name: "Ana Souza", plan: "enterprise", role: "admin" },
        timestamp: new Date("2026-05-05T11:00:00.000Z")
      });
      await identifyUserProfile(db, {
        projectId: project.id,
        environmentId: environment.id,
        userId: "user_email",
        tenantId: "tenant_1",
        traits: { email: "ana.email@example.com" },
        timestamp: new Date("2026-05-05T11:00:00.000Z")
      });
      await identifyUserProfile(db, {
        projectId: project.id,
        environmentId: environment.id,
        userId: "user_display",
        tenantId: "tenant_1",
        traits: { display_name: "Ana Display", operation_mode: 7, status: "suspended" },
        timestamp: new Date("2026-05-05T11:00:00.000Z")
      });
      await insertEvent(db, {
        id: "evt_user_profile",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-05T11:05:00.000Z"),
        receivedAt,
        name: "profile.match",
        tenantId: "tenant_1",
        userId: "user_1",
        sessionId: "session_1"
      });
      await insertEvent(db, {
        id: "evt_user_profile_email",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-05T11:06:00.000Z"),
        receivedAt,
        name: "profile.email",
        tenantId: "tenant_1",
        userId: "user_email",
        sessionId: "session_email"
      });
      await insertEvent(db, {
        id: "evt_user_profile_display",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-05T11:06:30.000Z"),
        receivedAt,
        name: "profile.display",
        tenantId: "tenant_1",
        userId: "user_display",
        sessionId: "session_display"
      });
      await insertEvent(db, {
        id: "evt_user_profile_anonymous",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-05T11:07:00.000Z"),
        receivedAt,
        name: "profile.anonymous",
        tenantId: "tenant_1",
        sessionId: "session_anonymous"
      });

      const result = await listUsersActivity(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "Ana Souza",
        limit: 50,
        now
      });

      expect(result.users).toHaveLength(1);
      expect(result.users[0]).toMatchObject({
        userId: "user_1",
        label: "Ana Souza",
        traits: { name: "Ana Souza", plan: "enterprise", role: "admin" },
        keyTraits: { plan: "enterprise", role: "admin" }
      });

      const detail = await getUserDetail(db, "user_1", {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        limit: 50,
        now
      });
      expect(detail.user).toMatchObject({
        userId: "user_1",
        label: "Ana Souza",
        traits: { name: "Ana Souza", plan: "enterprise", role: "admin" },
        keyTraits: { plan: "enterprise", role: "admin" }
      });

      const byEmail = await listUsersActivity(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "ana.email",
        limit: 50,
        now
      });
      expect(byEmail.users.map((user) => user.userId)).toEqual(["user_email"]);

      const byDisplayName = await listUsersActivity(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "Ana Display",
        limit: 50,
        now
      });
      expect(byDisplayName.users[0]).toMatchObject({
        userId: "user_display",
        label: "Ana Display",
        keyTraits: { operation_mode: "7", status: "suspended" }
      });

      const byRole = await listUsersActivity(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "admin",
        limit: 50,
        now
      });
      expect(byRole.users.map((user) => user.userId)).toEqual(["user_1"]);

      const byPlan = await listUsersActivity(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "enterprise",
        limit: 50,
        now
      });
      expect(byPlan.users.map((user) => user.userId)).toEqual(["user_1"]);

      const byStatus = await listUsersActivity(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        search: "suspended",
        limit: 50,
        now
      });
      expect(byStatus.users.map((user) => user.userId)).toEqual(["user_display"]);

      const allUsers = await listUsersActivity(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d",
        limit: 50,
        now
      });
      expect(allUsers.users.find((user) => user.userId === null)).toMatchObject({
        label: "Anonymous / Unassigned",
        traits: {},
        keyTraits: {}
      });
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
      ).resolves.toMatchObject({ data: [expect.objectContaining({ id: "evt_named_1", name: "checkout.started" })] });
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
      ).resolves.toMatchObject({
        data: [
          expect.objectContaining({
            id: "err_filtered_1",
            severity: "critical",
            status: "open",
            fingerprint: "fp_checkout_fetch"
          })
        ]
      });
    });
  });

  it("lists raw errors with error group identifiers and filters by group", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Raw Group Filter" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      await insertError(db, {
        id: "err_raw_group_filter_1",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: new Date("2026-05-10T12:00:00.000Z"),
        receivedAt: new Date("2026-05-10T12:00:01.000Z"),
        message: "Grouped raw error",
        severity: "error",
        fingerprint: "grouped-raw-error"
      });

      const rawErrors = await listErrors(db, {
        projectId: project.id,
        environmentId: environment.id,
        limit: 10
      });
      const [raw] = rawErrors.data;

      expect(raw?.errorGroupId).toEqual(expect.stringMatching(/^egrp_/));
      expect(raw?.groupingFingerprint).toBe("grouped-raw-error");

      const filtered = await listErrors(db, {
        projectId: project.id,
        environmentId: environment.id,
        errorGroupId: raw!.errorGroupId!,
        limit: 10
      });

      expect(filtered.data.map((error) => error.id)).toEqual(["err_raw_group_filter_1"]);
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
      expect(defaultEvents.data).toHaveLength(50);

      const limitedEvents = await listEvents(db, { projectId: project.id, environmentId: environment.id, limit: 2 });
      expect(limitedEvents.data).toHaveLength(2);
    });
  });

  // ── incident-triage ──────────────────────────────────────────────────────────

  it("assign sets and clears assignedToUserId on an error group", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Assign Incident Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const user = await createUser(db, { email: "assignee@example.com", passwordHash: "hash", isAdmin: false });

      await insertError(db, {
        id: "err_assign_001",
        projectId: project.id,
        environmentId: environment.id,
        message: "Assignable error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z"),
        receivedAt: new Date("2026-06-01T10:00:01.000Z")
      });

      const groups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      const group = groups[0];
      expect(group).toBeDefined();

      // Assign to valid user
      const assignResult = await assignIncident(db, { errorGroupId: group.id, assignedToUserId: user.id, projectId: project.id, environmentId: environment.id });
      expect(assignResult.ok).toBe(true);
      if (!assignResult.ok) throw new Error("expected ok");
      expect(assignResult.group.assignedToUserId).toBe(user.id);

      // Unassign (null)
      const unassignResult = await assignIncident(db, { errorGroupId: group.id, assignedToUserId: null, projectId: project.id, environmentId: environment.id });
      expect(unassignResult.ok).toBe(true);
      if (!unassignResult.ok) throw new Error("expected ok");
      expect(unassignResult.group.assignedToUserId).toBeNull();
    });
  });

  it("assign returns group_not_found for unknown error group", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const user = await createUser(db, { email: "assignee-no-group@example.com", passwordHash: "hash", isAdmin: false });

      const result = await assignIncident(db, { errorGroupId: "grp_does_not_exist", assignedToUserId: user.id, projectId: "prj_any", environmentId: "env_any" });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error");
      expect(result.error.kind).toBe("group_not_found");
    });
  });

  it("assign returns user_not_found for unknown user", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Assign Unknown User Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      await insertError(db, {
        id: "err_assign_unknown_001",
        projectId: project.id,
        environmentId: environment.id,
        message: "Unknown assignee error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z"),
        receivedAt: new Date("2026-06-01T10:00:01.000Z")
      });

      const groups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      const group = groups[0];
      expect(group).toBeDefined();

      const result = await assignIncident(db, { errorGroupId: group.id, assignedToUserId: "usr_does_not_exist", projectId: project.id, environmentId: environment.id });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error");
      expect(result.error.kind).toBe("user_not_found");
    });
  });

  it("assign returns user_archived for archived user", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Assign Archived User Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const user = await createUser(db, { email: "archived-assignee@example.com", passwordHash: "hash", isAdmin: false });
      await archiveUser(db, user.id);

      await insertError(db, {
        id: "err_assign_archived_001",
        projectId: project.id,
        environmentId: environment.id,
        message: "Archived assignee error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z"),
        receivedAt: new Date("2026-06-01T10:00:01.000Z")
      });

      const groups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      const group = groups[0];
      expect(group).toBeDefined();

      const result = await assignIncident(db, { errorGroupId: group.id, assignedToUserId: user.id, projectId: project.id, environmentId: environment.id });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error");
      expect(result.error.kind).toBe("user_archived");
    });
  });

  it("addTriageNote creates notes and listTriageNotes returns them ascending by created_at", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Triage Notes Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const user = await createUser(db, { email: "noter@example.com", passwordHash: "hash", isAdmin: false });

      await insertError(db, {
        id: "err_notes_001",
        projectId: project.id,
        environmentId: environment.id,
        message: "Note-worthy error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z"),
        receivedAt: new Date("2026-06-01T10:00:01.000Z")
      });

      const groups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      const group = groups[0];
      expect(group).toBeDefined();

      const result1 = await addTriageNote(db, {
        errorGroupId: group.id,
        authorUserId: user.id,
        authorEmail: "noter@example.com",
        body: "First note",
        projectId: project.id,
        environmentId: environment.id
      });
      const result2 = await addTriageNote(db, {
        errorGroupId: group.id,
        authorUserId: null,
        authorEmail: "external@example.com",
        body: "Second note",
        projectId: project.id,
        environmentId: environment.id
      });
      expect(result1.ok).toBe(true);
      if (!result1.ok) throw new Error("expected ok");
      const note1 = result1.note;
      expect(result2.ok).toBe(true);
      if (!result2.ok) throw new Error("expected ok");
      const note2 = result2.note;

      expect(note1.id).toMatch(/^note_/);
      expect(note1.errorGroupId).toBe(group.id);
      expect(note1.authorUserId).toBe(user.id);
      expect(note1.authorEmail).toBe("noter@example.com");
      expect(note1.body).toBe("First note");
      expect(note1.createdAt).toBeInstanceOf(Date);

      expect(note2.authorUserId).toBeNull();
      expect(note2.authorEmail).toBe("external@example.com");

      const notes = await listTriageNotes(db, group.id);
      expect(notes).toHaveLength(2);
      expect(notes[0].id).toBe(note1.id);
      expect(notes[1].id).toBe(note2.id);
      expect(notes[0].createdAt.getTime()).toBeLessThanOrEqual(notes[1].createdAt.getTime());
    });
  });

  it("listTriageNotes returns empty array for group with no notes", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Empty Notes Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      await insertError(db, {
        id: "err_empty_notes_001",
        projectId: project.id,
        environmentId: environment.id,
        message: "No notes error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z"),
        receivedAt: new Date("2026-06-01T10:00:01.000Z")
      });

      const groups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      const group = groups[0];
      expect(group).toBeDefined();

      const notes = await listTriageNotes(db, group.id);
      expect(notes).toHaveLength(0);
    });
  });

  it("silenceIncident sets and clears silenced_until", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Silence Incident Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      await insertError(db, {
        id: "err_silence_001",
        projectId: project.id,
        environmentId: environment.id,
        message: "Silenceable error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z"),
        receivedAt: new Date("2026-06-01T10:00:01.000Z")
      });

      const groups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      const group = groups[0];
      expect(group).toBeDefined();

      const until = new Date("2026-06-08T10:00:00.000Z");
      const silenced = await silenceIncident(db, { errorGroupId: group.id, until, projectId: project.id, environmentId: environment.id });
      expect(silenced).not.toBeNull();
      expect(silenced!.silencedUntil).toEqual(until);

      // Clear silence
      const cleared = await silenceIncident(db, { errorGroupId: group.id, until: null, projectId: project.id, environmentId: environment.id });
      expect(cleared).not.toBeNull();
      expect(cleared!.silencedUntil).toBeNull();
    });
  });

  it("silenceIncident returns null for unknown group id", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const result = await silenceIncident(db, { errorGroupId: "grp_does_not_exist", until: new Date(), projectId: "prj_any", environmentId: "env_any" });
      expect(result).toBeNull();
    });
  });

  it("getIncidentMttr returns null mttr and 0 count when no resolved groups in window", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "MTTR Empty Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      const result = await getIncidentMttr(db, {
        projectId: project.id,
        environmentId: environment.id,
        windowDays: 30
      });

      expect(result.mttrMs).toBeNull();
      expect(result.resolvedCount).toBe(0);
    });
  });

  it("getIncidentMttr computes average over resolved groups within window only", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "MTTR Compute Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      // Insert 3 errors that become 3 separate groups (different messages)
      const now = new Date();
      const oneDayMs = 24 * 60 * 60 * 1000;

      await insertError(db, {
        id: "err_mttr_a",
        projectId: project.id,
        environmentId: environment.id,
        message: "MTTR error A unique fingerprint alpha",
        severity: "error",
        timestamp: new Date(now.getTime() - 3 * oneDayMs),
        receivedAt: new Date(now.getTime() - 3 * oneDayMs + 1000)
      });
      await insertError(db, {
        id: "err_mttr_b",
        projectId: project.id,
        environmentId: environment.id,
        message: "MTTR error B unique fingerprint beta",
        severity: "error",
        timestamp: new Date(now.getTime() - 2 * oneDayMs),
        receivedAt: new Date(now.getTime() - 2 * oneDayMs + 1000)
      });
      // Out-of-window error (31 days ago)
      await insertError(db, {
        id: "err_mttr_c",
        projectId: project.id,
        environmentId: environment.id,
        message: "MTTR error C unique fingerprint gamma",
        severity: "error",
        timestamp: new Date(now.getTime() - 31 * oneDayMs),
        receivedAt: new Date(now.getTime() - 31 * oneDayMs + 1000)
      });

      const groups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      expect(groups.length).toBeGreaterThanOrEqual(3);

      // Resolve groups A and B with known resolution times (1h and 2h after first_seen_at respectively)
      const groupA = groups.find((g) => g.latestErrorId === "err_mttr_a")!;
      const groupB = groups.find((g) => g.latestErrorId === "err_mttr_b")!;
      const groupC = groups.find((g) => g.latestErrorId === "err_mttr_c")!;

      expect(groupA).toBeDefined();
      expect(groupB).toBeDefined();
      expect(groupC).toBeDefined();

      const resolvedAtA = new Date(groupA.firstSeenAt.getTime() + 1 * 60 * 60 * 1000); // +1h
      const resolvedAtB = new Date(groupB.firstSeenAt.getTime() + 3 * 60 * 60 * 1000); // +3h
      // Resolve C out of window
      const resolvedAtC = new Date(groupC.firstSeenAt.getTime() + 2 * 60 * 60 * 1000);

      // Mark as resolved — force resolved_at and status directly
      await sql`
        UPDATE error_groups
        SET status = 'resolved', resolved_at = ${resolvedAtA.toISOString()}
        WHERE id = ${groupA.id}
      `.execute(db);
      await sql`
        UPDATE error_groups
        SET status = 'resolved', resolved_at = ${resolvedAtB.toISOString()}
        WHERE id = ${groupB.id}
      `.execute(db);
      await sql`
        UPDATE error_groups
        SET status = 'resolved', resolved_at = ${resolvedAtC.toISOString()}
        WHERE id = ${groupC.id}
      `.execute(db);

      // Query with 30-day window — should include A and B, not C
      const result = await getIncidentMttr(db, {
        projectId: project.id,
        environmentId: environment.id,
        windowDays: 30
      });

      // A: 1h = 3_600_000ms, B: 3h = 10_800_000ms → avg = 7_200_000ms
      expect(result.resolvedCount).toBe(2);
      expect(result.mttrMs).not.toBeNull();
      expect(result.mttrMs!).toBeCloseTo(7_200_000, -3); // within ±1000ms tolerance
    });
  });

  it("getIncidentMttr ignores unresolved groups and respects project/env scope", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "MTTR Scoped Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const otherProject = await createProject(db, { name: "MTTR Other Project" });
      const otherEnvironment = await createEnvironment(db, { projectId: otherProject.id, name: "staging" });

      const now = new Date();
      const oneDayMs = 24 * 60 * 60 * 1000;

      // Resolved in target scope
      await insertError(db, {
        id: "err_mttr_scoped_a",
        projectId: project.id,
        environmentId: environment.id,
        message: "Scoped MTTR resolved error alpha unique",
        severity: "error",
        timestamp: new Date(now.getTime() - 2 * oneDayMs),
        receivedAt: new Date(now.getTime() - 2 * oneDayMs + 1000)
      });

      // Unresolved in target scope — should be ignored
      await insertError(db, {
        id: "err_mttr_scoped_b",
        projectId: project.id,
        environmentId: environment.id,
        message: "Scoped MTTR unresolved error beta unique",
        severity: "error",
        timestamp: new Date(now.getTime() - 1 * oneDayMs),
        receivedAt: new Date(now.getTime() - 1 * oneDayMs + 1000)
      });

      // Resolved in other scope — should be ignored
      await insertError(db, {
        id: "err_mttr_other",
        projectId: otherProject.id,
        environmentId: otherEnvironment.id,
        message: "Other project MTTR resolved error gamma unique",
        severity: "error",
        timestamp: new Date(now.getTime() - 2 * oneDayMs),
        receivedAt: new Date(now.getTime() - 2 * oneDayMs + 1000)
      });

      const scopedGroups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      const groupA = scopedGroups.find((g) => g.latestErrorId === "err_mttr_scoped_a")!;

      const otherGroups = await listErrorGroups(db, {
        projectId: otherProject.id,
        environmentId: otherEnvironment.id
      });
      const groupOther = otherGroups.find((g) => g.latestErrorId === "err_mttr_other")!;

      expect(groupA).toBeDefined();
      expect(groupOther).toBeDefined();

      const resolvedAtA = new Date(groupA.firstSeenAt.getTime() + 2 * 60 * 60 * 1000); // +2h
      const resolvedAtOther = new Date(groupOther.firstSeenAt.getTime() + 10 * 60 * 60 * 1000); // +10h (should be excluded)

      await sql`UPDATE error_groups SET status = 'resolved', resolved_at = ${resolvedAtA.toISOString()} WHERE id = ${groupA.id}`.execute(db);
      await sql`UPDATE error_groups SET status = 'resolved', resolved_at = ${resolvedAtOther.toISOString()} WHERE id = ${groupOther.id}`.execute(db);

      const result = await getIncidentMttr(db, {
        projectId: project.id,
        environmentId: environment.id,
        windowDays: 30
      });

      // Only groupA resolved in scope: 2h = 7_200_000ms
      expect(result.resolvedCount).toBe(1);
      expect(result.mttrMs).not.toBeNull();
      expect(result.mttrMs!).toBeCloseTo(7_200_000, -3);
    });
  });

  it("assignIncident returns group_not_found when called with wrong project/env scope", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Assign Scope Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const otherProject = await createProject(db, { name: "Assign Other Project" });
      const otherEnvironment = await createEnvironment(db, { projectId: otherProject.id, name: "staging" });
      const user = await createUser(db, { email: "assign-scope@example.com", passwordHash: "hash", isAdmin: false });

      await insertError(db, {
        id: "err_assign_scope_001",
        projectId: project.id,
        environmentId: environment.id,
        message: "Assign scope error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z"),
        receivedAt: new Date("2026-06-01T10:00:01.000Z")
      });

      const groups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      const group = groups[0];
      expect(group).toBeDefined();

      // Call with wrong scope — should return group_not_found, not mutate
      const result = await assignIncident(db, {
        errorGroupId: group.id,
        assignedToUserId: user.id,
        projectId: otherProject.id,
        environmentId: otherEnvironment.id
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error");
      expect(result.error.kind).toBe("group_not_found");

      // Verify the group was not mutated
      const unchanged = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      expect(unchanged[0].assignedToUserId).toBeNull();
    });
  });

  it("assignIncident succeeds when called with correct project/env scope", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Assign Correct Scope Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const user = await createUser(db, { email: "assign-correct-scope@example.com", passwordHash: "hash", isAdmin: false });

      await insertError(db, {
        id: "err_assign_correct_001",
        projectId: project.id,
        environmentId: environment.id,
        message: "Assign correct scope error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z"),
        receivedAt: new Date("2026-06-01T10:00:01.000Z")
      });

      const groups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      const group = groups[0];
      expect(group).toBeDefined();

      const result = await assignIncident(db, {
        errorGroupId: group.id,
        assignedToUserId: user.id,
        projectId: project.id,
        environmentId: environment.id
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.group.assignedToUserId).toBe(user.id);
    });
  });

  it("silenceIncident returns null when called with wrong project/env scope", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Silence Scope Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const otherProject = await createProject(db, { name: "Silence Other Project" });
      const otherEnvironment = await createEnvironment(db, { projectId: otherProject.id, name: "staging" });

      await insertError(db, {
        id: "err_silence_scope_001",
        projectId: project.id,
        environmentId: environment.id,
        message: "Silence scope error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z"),
        receivedAt: new Date("2026-06-01T10:00:01.000Z")
      });

      const groups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      const group = groups[0];
      expect(group).toBeDefined();

      const until = new Date("2026-06-08T10:00:00.000Z");

      // Wrong scope — should return null
      const result = await silenceIncident(db, {
        errorGroupId: group.id,
        until,
        projectId: otherProject.id,
        environmentId: otherEnvironment.id
      });
      expect(result).toBeNull();

      // Verify the group was not silenced
      const unchanged = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      expect(unchanged[0].silencedUntil).toBeNull();
    });
  });

  it("silenceIncident succeeds when called with correct project/env scope", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Silence Correct Scope Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      await insertError(db, {
        id: "err_silence_correct_001",
        projectId: project.id,
        environmentId: environment.id,
        message: "Silence correct scope error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z"),
        receivedAt: new Date("2026-06-01T10:00:01.000Z")
      });

      const groups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      const group = groups[0];
      expect(group).toBeDefined();

      const until = new Date("2026-06-08T10:00:00.000Z");
      const result = await silenceIncident(db, {
        errorGroupId: group.id,
        until,
        projectId: project.id,
        environmentId: environment.id
      });
      expect(result).not.toBeNull();
      expect(result!.silencedUntil).toEqual(until);
    });
  });

  it("addTriageNote returns group_not_found when called with wrong project/env scope", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Note Scope Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const otherProject = await createProject(db, { name: "Note Other Project" });
      const otherEnvironment = await createEnvironment(db, { projectId: otherProject.id, name: "staging" });
      const user = await createUser(db, { email: "note-scope@example.com", passwordHash: "hash", isAdmin: false });

      await insertError(db, {
        id: "err_note_scope_001",
        projectId: project.id,
        environmentId: environment.id,
        message: "Note scope error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z"),
        receivedAt: new Date("2026-06-01T10:00:01.000Z")
      });

      const groups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      const group = groups[0];
      expect(group).toBeDefined();

      // Wrong scope — should return not-found signal
      const result = await addTriageNote(db, {
        errorGroupId: group.id,
        authorUserId: user.id,
        authorEmail: "note-scope@example.com",
        body: "Should not persist",
        projectId: otherProject.id,
        environmentId: otherEnvironment.id
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error");
      expect(result.error).toBe("group_not_found");

      // Verify no note was inserted
      const notes = await listTriageNotes(db, group.id);
      expect(notes).toHaveLength(0);
    });
  });

  it("addTriageNote succeeds when called with correct project/env scope", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "Note Correct Scope Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const user = await createUser(db, { email: "note-correct-scope@example.com", passwordHash: "hash", isAdmin: false });

      await insertError(db, {
        id: "err_note_correct_001",
        projectId: project.id,
        environmentId: environment.id,
        message: "Note correct scope error",
        severity: "error",
        timestamp: new Date("2026-06-01T10:00:00.000Z"),
        receivedAt: new Date("2026-06-01T10:00:01.000Z")
      });

      const groups = await listErrorGroups(db, { projectId: project.id, environmentId: environment.id });
      const group = groups[0];
      expect(group).toBeDefined();

      const result = await addTriageNote(db, {
        errorGroupId: group.id,
        authorUserId: user.id,
        authorEmail: "note-correct-scope@example.com",
        body: "Scoped note",
        projectId: project.id,
        environmentId: environment.id
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.note.body).toBe("Scoped note");
      expect(result.note.errorGroupId).toBe(group.id);
    });
  });

  it("getLlmSummary returns correct aggregates for in-window llm_calls", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "LLM Summary Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      // Use a fixed anchor inside the 24h window
      const now = new Date();
      const inWindow = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2h ago
      const receivedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000 + 1000);
      const outsideWindow = new Date(now.getTime() - 26 * 60 * 60 * 1000); // 26h ago

      // success row: input=100 output=50 => tokens=150, latency=200ms, cost=0.010000
      await insertLlmCall(db, {
        id: "llm_sum_success",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: inWindow,
        receivedAt,
        provider: "openai",
        model: "gpt-5",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: "0.010000",
        latencyMs: 200,
        status: "success"
      });

      // error row: input=200 output=100 => tokens=300, latency=400ms, cost=0.020000
      await insertLlmCall(db, {
        id: "llm_sum_error",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: inWindow,
        receivedAt,
        provider: "openai",
        model: "gpt-5",
        inputTokens: 200,
        outputTokens: 100,
        costUsd: "0.020000",
        latencyMs: 400,
        status: "error"
      });

      // pending row: null latency, cost=0.005000
      await insertLlmCall(db, {
        id: "llm_sum_pending",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: inWindow,
        receivedAt,
        provider: "openai",
        model: "gpt-5",
        inputTokens: 50,
        outputTokens: 25,
        costUsd: "0.005000",
        latencyMs: undefined,
        status: "pending"
      });

      // outside-window row — should be excluded
      await insertLlmCall(db, {
        id: "llm_sum_outside",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: outsideWindow,
        receivedAt: new Date(outsideWindow.getTime() + 1000),
        provider: "openai",
        model: "gpt-5",
        inputTokens: 999,
        outputTokens: 999,
        costUsd: "9.999999",
        latencyMs: 9999,
        status: "success"
      });

      const summary = await getLlmSummary(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h"
      });

      // calls = 3 in-window rows
      expect(summary.calls).toBe(3);
      // failedCalls = error + pending = 2
      expect(summary.failedCalls).toBe(2);
      // costUsd = 0.010000 + 0.020000 + 0.005000 = 0.035000
      expect(summary.costUsd).toBe("0.035000");
      // avgTokens = round((150 + 300 + 75) / 3) = round(175) = 175
      expect(summary.avgTokens).toBe(175);
      // avgLatencyMs = round((200 + 400) / 2) = 300 (null latency excluded)
      expect(summary.avgLatencyMs).toBe(300);
      // p95LatencyMs: only 2 non-null values [200, 400], p95 = 200 + 0.95*(400-200) = 390
      expect(summary.p95LatencyMs).toBe(390);
    });
  });

  it("getLlmSummary returns zero/null shape for empty window (different project)", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "LLM Summary Empty Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      const summary = await getLlmSummary(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h"
      });

      expect(summary).toEqual({
        calls: 0,
        failedCalls: 0,
        costUsd: "0",
        avgTokens: null,
        avgLatencyMs: null,
        p95LatencyMs: null
      });
    });
  });

  it("buildBucketAxis produces correct hour and day bucket starts", () => {
    // hour case: from=2026-06-22T03:30Z to=2026-06-22T06:10Z → 4 buckets
    const hourAxis = buildBucketAxis(new Date("2026-06-22T03:30:00Z"), new Date("2026-06-22T06:10:00Z"), "hour");
    expect(hourAxis).toEqual([
      "2026-06-22T03:00:00.000Z",
      "2026-06-22T04:00:00.000Z",
      "2026-06-22T05:00:00.000Z",
      "2026-06-22T06:00:00.000Z"
    ]);

    // day case: from=2026-06-20T15:00Z to=2026-06-22T10:00Z → 3 days
    const dayAxis = buildBucketAxis(new Date("2026-06-20T15:00:00Z"), new Date("2026-06-22T10:00:00Z"), "day");
    expect(dayAxis).toEqual([
      "2026-06-20T00:00:00.000Z",
      "2026-06-21T00:00:00.000Z",
      "2026-06-22T00:00:00.000Z"
    ]);
  });

  it("getLlmByTenant returns top 10 tenants ordered by cost desc, excludes null tenant", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "LLM ByTenant Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date();
      const inWindow = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2h ago
      const receivedAt = new Date(inWindow.getTime() + 1000);

      // Seed 11 tenants so we can assert the cap of 10.
      // Costs are spread so sorting by cost desc is deterministic.
      // tenant-01 gets the most cost, tenant-11 gets the least.
      for (let i = 1; i <= 11; i++) {
        const tenantId = `tenant-${String(i).padStart(2, "0")}`;
        const costNum = (12 - i) * 0.01; // tenant-01 = 0.11, tenant-11 = 0.01
        const cost = costNum.toFixed(6);
        await insertLlmCall(db, {
          id: `llm_tenant_${i}_a`,
          projectId: project.id,
          environmentId: environment.id,
          tenantId,
          timestamp: inWindow,
          receivedAt,
          provider: "openai",
          model: "gpt-4",
          inputTokens: 100,
          outputTokens: 50,
          costUsd: cost,
          latencyMs: 100 + i * 10,
          status: "success"
        });
        // Add one failed call for tenant-01 only
        if (i === 1) {
          await insertLlmCall(db, {
            id: `llm_tenant_${i}_b`,
            projectId: project.id,
            environmentId: environment.id,
            tenantId,
            timestamp: inWindow,
            receivedAt,
            provider: "openai",
            model: "gpt-4",
            inputTokens: 50,
            outputTokens: 25,
            costUsd: "0.000000",
            latencyMs: 50,
            status: "error"
          });
        }
      }

      // Add a null-tenant row (should be excluded)
      await insertLlmCall(db, {
        id: "llm_tenant_null",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: inWindow,
        receivedAt,
        provider: "openai",
        model: "gpt-4",
        inputTokens: 500,
        outputTokens: 500,
        costUsd: "99.000000",
        latencyMs: 999,
        status: "success"
      });

      const rows = await getLlmByTenant(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h"
      });

      // Cap of 10: tenant-11 (lowest cost) is excluded
      expect(rows).toHaveLength(10);

      // No null tenants in result
      for (const row of rows) {
        expect(row.tenantId).not.toBeNull();
        expect(typeof row.tenantId).toBe("string");
      }

      // First row is tenant-01 (highest cost = 0.110000)
      expect(rows[0].tenantId).toBe("tenant-01");
      // tenant-01 has 2 calls (1 success + 1 error), 1 failedCall
      expect(rows[0].calls).toBe(2);
      expect(rows[0].failedCalls).toBe(1);
      // cost = 0.110000 + 0.000000 = 0.110000
      expect(rows[0].costUsd).toBe("0.110000");
      // avgTokens = round((150 + 75) / 2) = 113
      expect(rows[0].avgTokens).toBe(113);
      // avgLatencyMs = round((110 + 50) / 2) = 80
      expect(rows[0].avgLatencyMs).toBe(80);
      // p95 of [50, 110] = 50 + 0.95*(110-50) = 50 + 57 = 107
      expect(rows[0].p95LatencyMs).toBe(107);

      // Second row is tenant-02
      expect(rows[1].tenantId).toBe("tenant-02");
      expect(rows[1].calls).toBe(1);
      expect(rows[1].failedCalls).toBe(0);
      // cost = (12 - 2) * 0.01 = 0.100000
      expect(rows[1].costUsd).toBe("0.100000");

      // Last row in result is tenant-10
      expect(rows[9].tenantId).toBe("tenant-10");
    });
  });

  it("getLlmByTenant excludes out-of-window rows and other projects", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "LLM ByTenant Scoped" });
      const otherProject = await createProject(db, { name: "LLM ByTenant Other" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const otherEnv = await createEnvironment(db, { projectId: otherProject.id, name: "production" });
      const now = new Date();
      const inWindow = new Date(now.getTime() - 1 * 60 * 60 * 1000);
      const outsideWindow = new Date(now.getTime() - 30 * 60 * 60 * 1000);
      const receivedAt = new Date(inWindow.getTime() + 1000);

      await insertLlmCall(db, {
        id: "llm_scoped_in",
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant-a",
        timestamp: inWindow,
        receivedAt,
        provider: "openai",
        model: "gpt-4",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: "0.010000",
        latencyMs: 200,
        status: "success"
      });

      // Out-of-window row for same tenant
      await insertLlmCall(db, {
        id: "llm_scoped_out",
        projectId: project.id,
        environmentId: environment.id,
        tenantId: "tenant-a",
        timestamp: outsideWindow,
        receivedAt: new Date(outsideWindow.getTime() + 1000),
        provider: "openai",
        model: "gpt-4",
        inputTokens: 999,
        outputTokens: 999,
        costUsd: "9.999999",
        latencyMs: 9999,
        status: "success"
      });

      // Different project row
      await insertLlmCall(db, {
        id: "llm_scoped_other_proj",
        projectId: otherProject.id,
        environmentId: otherEnv.id,
        tenantId: "tenant-a",
        timestamp: inWindow,
        receivedAt,
        provider: "openai",
        model: "gpt-4",
        inputTokens: 999,
        outputTokens: 999,
        costUsd: "9.999999",
        latencyMs: 9999,
        status: "success"
      });

      const rows = await getLlmByTenant(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h"
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].tenantId).toBe("tenant-a");
      expect(rows[0].calls).toBe(1);
      expect(rows[0].costUsd).toBe("0.010000");
    });
  });

  it("getLlmByPrompt returns rows per (prompt, model) pair, null prompt → Unspecified, ordered by cost desc", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "LLM ByPrompt Project" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date();
      const inWindow = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const receivedAt = new Date(inWindow.getTime() + 1000);

      // (prompt-a, gpt-4): 2 calls, 1 success + 1 error, cost = 0.030000
      await insertLlmCall(db, {
        id: "llm_prompt_a_gpt4_1",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: inWindow,
        receivedAt,
        provider: "openai",
        model: "gpt-4",
        promptName: "prompt-a",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: "0.020000",
        latencyMs: 200,
        status: "success"
      });
      await insertLlmCall(db, {
        id: "llm_prompt_a_gpt4_2",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: inWindow,
        receivedAt,
        provider: "openai",
        model: "gpt-4",
        promptName: "prompt-a",
        inputTokens: 50,
        outputTokens: 25,
        costUsd: "0.010000",
        latencyMs: 400,
        status: "error"
      });

      // (prompt-a, gpt-3.5): 1 call, cost = 0.005000
      await insertLlmCall(db, {
        id: "llm_prompt_a_gpt35_1",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: inWindow,
        receivedAt,
        provider: "openai",
        model: "gpt-3.5",
        promptName: "prompt-a",
        inputTokens: 80,
        outputTokens: 40,
        costUsd: "0.005000",
        latencyMs: 100,
        status: "success"
      });

      // (prompt-b, gpt-4): 1 call, highest cost = 0.050000
      await insertLlmCall(db, {
        id: "llm_prompt_b_gpt4_1",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: inWindow,
        receivedAt,
        provider: "openai",
        model: "gpt-4",
        promptName: "prompt-b",
        inputTokens: 200,
        outputTokens: 100,
        costUsd: "0.050000",
        latencyMs: 300,
        status: "success"
      });

      // null prompt_name, model gpt-4: 1 call → should appear as "Unspecified"
      await insertLlmCall(db, {
        id: "llm_prompt_null_gpt4",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: inWindow,
        receivedAt,
        provider: "openai",
        model: "gpt-4",
        inputTokens: 60,
        outputTokens: 30,
        costUsd: "0.002000",
        latencyMs: 150,
        status: "success"
      });

      const rows = await getLlmByPrompt(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h"
      });

      // 4 distinct (coalesced_prompt, model) pairs:
      // (prompt-b, gpt-4)=0.05, (prompt-a, gpt-4)=0.03, (prompt-a, gpt-3.5)=0.005, (Unspecified, gpt-4)=0.002
      expect(rows).toHaveLength(4);

      // Row 0: prompt-b / gpt-4 (highest cost)
      expect(rows[0].promptName).toBe("prompt-b");
      expect(rows[0].model).toBe("gpt-4");
      expect(rows[0].calls).toBe(1);
      expect(rows[0].failedCalls).toBe(0);
      expect(rows[0].costUsd).toBe("0.050000");
      // avgTokens = round((200 + 100) / 1) = 300
      expect(rows[0].avgTokens).toBe(300);
      expect(rows[0].avgLatencyMs).toBe(300);
      expect(rows[0].p95LatencyMs).toBe(300);

      // Row 1: prompt-a / gpt-4 (cost=0.030000)
      expect(rows[1].promptName).toBe("prompt-a");
      expect(rows[1].model).toBe("gpt-4");
      expect(rows[1].calls).toBe(2);
      expect(rows[1].failedCalls).toBe(1);
      expect(rows[1].costUsd).toBe("0.030000");
      // avgTokens = round((150 + 75) / 2) = 113
      expect(rows[1].avgTokens).toBe(113);
      // avgLatencyMs = round((200 + 400) / 2) = 300
      expect(rows[1].avgLatencyMs).toBe(300);
      // p95 of [200, 400] = 200 + 0.95*200 = 390
      expect(rows[1].p95LatencyMs).toBe(390);

      // Row 2: prompt-a / gpt-3.5 (cost=0.005000)
      expect(rows[2].promptName).toBe("prompt-a");
      expect(rows[2].model).toBe("gpt-3.5");
      expect(rows[2].calls).toBe(1);
      expect(rows[2].failedCalls).toBe(0);
      expect(rows[2].costUsd).toBe("0.005000");

      // Row 3: Unspecified / gpt-4 (null prompt → 'Unspecified', cost=0.002000)
      expect(rows[3].promptName).toBe("Unspecified");
      expect(rows[3].model).toBe("gpt-4");
      expect(rows[3].calls).toBe(1);
      expect(rows[3].costUsd).toBe("0.002000");
    });
  });

  it("getLlmByPrompt caps at 20 rows and excludes out-of-window rows", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "LLM ByPrompt Cap" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const now = new Date();
      const inWindow = new Date(now.getTime() - 1 * 60 * 60 * 1000);
      const outsideWindow = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
      const receivedAt = new Date(inWindow.getTime() + 1000);

      // Seed 21 unique (prompt, model) pairs
      for (let i = 1; i <= 21; i++) {
        const cost = (0.001 * i).toFixed(6);
        await insertLlmCall(db, {
          id: `llm_cap_${i}`,
          projectId: project.id,
          environmentId: environment.id,
          timestamp: inWindow,
          receivedAt,
          provider: "openai",
          model: `model-${String(i).padStart(2, "0")}`,
          promptName: `prompt-cap`,
          inputTokens: 100,
          outputTokens: 50,
          costUsd: cost,
          latencyMs: 100,
          status: "success"
        });
      }

      // Out-of-window row (should be excluded)
      await insertLlmCall(db, {
        id: "llm_cap_outside",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: outsideWindow,
        receivedAt: new Date(outsideWindow.getTime() + 1000),
        provider: "openai",
        model: "model-99",
        promptName: "prompt-cap",
        inputTokens: 999,
        outputTokens: 999,
        costUsd: "9.999999",
        latencyMs: 9999,
        status: "success"
      });

      const rows = await getLlmByPrompt(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h"
      });

      // Cap of 20: only top 20 by cost
      expect(rows).toHaveLength(20);
      // Highest cost is model-21 (i=21, cost=0.021000)
      expect(rows[0].model).toBe("model-21");
    });
  });

  it("getLlmCostByModel returns top-5 models ordered by total cost desc with zero-filled bucket axis", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "LLM CostByModel Main" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      // Use a fixed "now" so buckets are predictable
      const now = new Date();
      // Place calls in two different hours within the 24h window
      const hourA = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
      const hourB = new Date(now.getTime() - 5 * 60 * 60 * 1000); // 5 hours ago
      const receivedAt = new Date(now.getTime() - 100);

      // Seed 6 models to assert top-5 cap.
      // model-1: cost 0.100000 in hourA
      // model-2: cost 0.080000 in hourA
      // model-3: cost 0.060000 in hourB
      // model-4: cost 0.040000 in hourA
      // model-5: cost 0.020000 in hourB
      // model-6: cost 0.005000 in hourA (should be excluded from top-5)
      const models = [
        { name: "model-1", cost: "0.100000", hour: hourA },
        { name: "model-2", cost: "0.080000", hour: hourA },
        { name: "model-3", cost: "0.060000", hour: hourB },
        { name: "model-4", cost: "0.040000", hour: hourA },
        { name: "model-5", cost: "0.020000", hour: hourB },
        { name: "model-6", cost: "0.005000", hour: hourA }
      ];

      for (let i = 0; i < models.length; i++) {
        const m = models[i];
        await insertLlmCall(db, {
          id: `llm_cbm_${i + 1}`,
          projectId: project.id,
          environmentId: environment.id,
          timestamp: m.hour,
          receivedAt,
          provider: "openai",
          model: m.name,
          inputTokens: 100,
          outputTokens: 50,
          costUsd: m.cost,
          latencyMs: 100,
          status: "success"
        });
      }

      const result = await getLlmCostByModel(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h"
      });

      // Buckets axis: hourly, 24h window
      expect(result.buckets.length).toBeGreaterThanOrEqual(24);
      expect(result.buckets.length).toBeLessThanOrEqual(26);

      // Top-5 cap: model-6 excluded
      expect(result.series).toHaveLength(5);

      // Ordered by total cost desc
      expect(result.series[0].model).toBe("model-1");
      expect(result.series[1].model).toBe("model-2");
      expect(result.series[2].model).toBe("model-3");
      expect(result.series[3].model).toBe("model-4");
      expect(result.series[4].model).toBe("model-5");

      // Each costs array length must match buckets length
      for (const s of result.series) {
        expect(s.costs).toHaveLength(result.buckets.length);
      }

      // Verify bucket alignment: find the hourA and hourB bucket keys
      const hourAKey = `${hourA.getUTCFullYear().toString().padStart(4, "0")}-${(hourA.getUTCMonth() + 1).toString().padStart(2, "0")}-${hourA.getUTCDate().toString().padStart(2, "0")}T${hourA.getUTCHours().toString().padStart(2, "0")}:00:00.000Z`;
      const hourBKey = `${hourB.getUTCFullYear().toString().padStart(4, "0")}-${(hourB.getUTCMonth() + 1).toString().padStart(2, "0")}-${hourB.getUTCDate().toString().padStart(2, "0")}T${hourB.getUTCHours().toString().padStart(2, "0")}:00:00.000Z`;

      const hourAIdx = result.buckets.indexOf(hourAKey);
      const hourBIdx = result.buckets.indexOf(hourBKey);
      expect(hourAIdx).toBeGreaterThanOrEqual(0);
      expect(hourBIdx).toBeGreaterThanOrEqual(0);

      // model-1 has cost in hourA, zero in hourB
      const m1 = result.series[0];
      expect(m1.costs[hourAIdx]).toBe("0.100000");
      expect(m1.costs[hourBIdx]).toBe("0");

      // model-3 has cost in hourB, zero in hourA
      const m3 = result.series[2];
      expect(m3.costs[hourBIdx]).toBe("0.060000");
      expect(m3.costs[hourAIdx]).toBe("0");
    });
  });

  it("getLlmCostByModel returns empty series when no data in window", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "LLM CostByModel Empty" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      const result = await getLlmCostByModel(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h"
      });

      // Buckets axis is non-empty even with no data
      expect(result.buckets.length).toBeGreaterThanOrEqual(24);
      expect(result.series).toHaveLength(0);
    });
  });

  it("getLlmCostByModel returns daily axis for 7d window", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "LLM CostByModel 7d" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });

      const now = new Date();
      const inWindow = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
      const receivedAt = new Date(inWindow.getTime() + 1000);

      await insertLlmCall(db, {
        id: "llm_cbm_7d_1",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: inWindow,
        receivedAt,
        provider: "openai",
        model: "gpt-4",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: "0.010000",
        latencyMs: 100,
        status: "success"
      });

      const result = await getLlmCostByModel(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "7d"
      });

      // Daily axis for 7d: ~7–8 buckets
      expect(result.buckets.length).toBeGreaterThanOrEqual(7);
      expect(result.buckets.length).toBeLessThanOrEqual(9);

      // Buckets are daily (time portion is T00:00:00.000Z)
      for (const b of result.buckets) {
        expect(b).toMatch(/T00:00:00\.000Z$/);
      }

      expect(result.series).toHaveLength(1);
      expect(result.series[0].model).toBe("gpt-4");
      expect(result.series[0].costs).toHaveLength(result.buckets.length);

      // The seeded day's cost lands in its daily bucket; every other day is zero-filled.
      const seededDay = new Date(inWindow);
      seededDay.setUTCHours(0, 0, 0, 0);
      const dayKey = `${seededDay.getUTCFullYear().toString().padStart(4, "0")}-${(seededDay.getUTCMonth() + 1).toString().padStart(2, "0")}-${seededDay.getUTCDate().toString().padStart(2, "0")}T00:00:00.000Z`;
      const dayIdx = result.buckets.indexOf(dayKey);
      expect(dayIdx).toBeGreaterThanOrEqual(0);
      expect(result.series[0].costs[dayIdx]).toBe("0.010000");
      expect(result.series[0].costs.filter((c) => c === "0")).toHaveLength(result.buckets.length - 1);
    });
  });

  it("getLlmCostByModel excludes out-of-window rows and other projects", async () => {
    await withDb(async (db) => {
      await migrate(db);

      const project = await createProject(db, { name: "LLM CostByModel Scope" });
      const otherProject = await createProject(db, { name: "LLM CostByModel Other" });
      const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
      const otherEnv = await createEnvironment(db, { projectId: otherProject.id, name: "production" });

      const now = new Date();
      const inWindow = new Date(now.getTime() - 1 * 60 * 60 * 1000);
      const outsideWindow = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
      const receivedAt = new Date(inWindow.getTime() + 1000);

      // In-window row for the target project
      await insertLlmCall(db, {
        id: "llm_cbm_scope_1",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: inWindow,
        receivedAt,
        provider: "openai",
        model: "model-x",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: "0.010000",
        latencyMs: 100,
        status: "success"
      });

      // Out-of-window row for the target project
      await insertLlmCall(db, {
        id: "llm_cbm_scope_2",
        projectId: project.id,
        environmentId: environment.id,
        timestamp: outsideWindow,
        receivedAt: new Date(outsideWindow.getTime() + 1000),
        provider: "openai",
        model: "model-y",
        inputTokens: 999,
        outputTokens: 999,
        costUsd: "9.999999",
        latencyMs: 9999,
        status: "success"
      });

      // Row for other project (should be excluded)
      await insertLlmCall(db, {
        id: "llm_cbm_scope_3",
        projectId: otherProject.id,
        environmentId: otherEnv.id,
        timestamp: inWindow,
        receivedAt,
        provider: "openai",
        model: "model-z",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: "5.000000",
        latencyMs: 100,
        status: "success"
      });

      const result = await getLlmCostByModel(db, {
        projectId: project.id,
        environmentId: environment.id,
        window: "24h"
      });

      // Only model-x in window for this project
      expect(result.series).toHaveLength(1);
      expect(result.series[0].model).toBe("model-x");
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
