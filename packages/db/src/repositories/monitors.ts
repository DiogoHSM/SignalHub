import type { Selectable } from "kysely";
import { sql } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { AlertEventsTable, MonitorChecksTable, MonitorsTable } from "../schema.js";

type MonitorRow = Selectable<MonitorsTable>;
type MonitorCheckRow = Selectable<MonitorChecksTable>;
type AlertEventRow = Selectable<AlertEventsTable>;
const MONITOR_EVALUATION_LOCK_ID = 927380402916;

export type MonitorKind = "http" | "heartbeat";
export type MonitorStatus = "unknown" | "up" | "down" | "degraded" | "paused";
export type MonitorCheckStatus = "success" | "failed";

export type MonitorRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  notificationChannelId: string | null;
  kind: MonitorKind;
  name: string;
  enabled: boolean;
  status: MonitorStatus;
  url: string | null;
  method: "GET" | "HEAD" | null;
  expectedStatus: string | null;
  bodyContains: string | null;
  timeoutMs: number | null;
  intervalMinutes: number | null;
  failureThreshold: number;
  recoveryThreshold: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  expectedIntervalMinutes: number | null;
  graceMinutes: number | null;
  secretHash: string | null;
  lastCheckedAt: Date | null;
  lastCheckStatus: MonitorCheckStatus | null;
  lastCheckLatencyMs: number | null;
  lastCheckResponseStatus: number | null;
  lastCheckErrorMessage: string | null;
  lastHeartbeatAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type MonitorCheckRecord = {
  id: string;
  monitorId: string;
  checkedAt: Date;
  status: MonitorCheckStatus;
  latencyMs: number | null;
  responseStatus: number | null;
  errorMessage: string | null;
  createdAt: Date;
};

export type MonitorAlertEventRecord = {
  id: string;
  monitorId: string;
  projectId: string;
  environmentId: string;
  severity: "warning" | "critical";
  triggeredAt: Date;
  windowStart: Date;
  windowEnd: Date;
  observedValue: string;
  threshold: string;
  message: string;
  metadata: unknown;
  createdAt: Date;
};

type MonitorScope = {
  projectId: string;
  environmentId: string;
  notificationChannelId?: string | null;
};

export type CreateHttpMonitorInput = MonitorScope & {
  name: string;
  url: string;
  method: "GET" | "HEAD";
  intervalMinutes: number;
  timeoutMs: number;
  expectedStatus: string;
  bodyContains?: string | null;
  failureThreshold: number;
  recoveryThreshold: number;
  enabled: boolean;
};

export type CreateHeartbeatMonitorInput = MonitorScope & {
  name: string;
  expectedIntervalMinutes: number;
  graceMinutes: number;
  secretHash: string;
  enabled: boolean;
};

export type UpdateMonitorInput = Partial<
  MonitorScope & {
    name: string;
    enabled: boolean;
    status: MonitorStatus;
    url: string | null;
    method: "GET" | "HEAD" | null;
    expectedStatus: string | null;
    bodyContains: string | null;
    timeoutMs: number | null;
    intervalMinutes: number | null;
    failureThreshold: number;
    recoveryThreshold: number;
    expectedIntervalMinutes: number | null;
    graceMinutes: number | null;
    secretHash: string | null;
  }
>;

export type RecordMonitorCheckInput = {
  monitorId: string;
  checkedAt: Date;
  status: MonitorCheckStatus;
  latencyMs?: number | null;
  responseStatus?: number | null;
  errorMessage?: string | null;
};

function clampLimit(limit: number | undefined, fallback: number): number {
  return Math.min(Math.max(limit ?? fallback, 1), 250);
}

function toMonitor(row: MonitorRow): MonitorRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    notificationChannelId: row.notification_channel_id,
    kind: row.kind,
    name: row.name,
    enabled: row.enabled,
    status: row.status,
    url: row.url,
    method: row.method,
    expectedStatus: row.expected_status,
    bodyContains: row.body_contains,
    timeoutMs: row.timeout_ms,
    intervalMinutes: row.interval_minutes,
    failureThreshold: row.failure_threshold,
    recoveryThreshold: row.recovery_threshold,
    consecutiveFailures: row.consecutive_failures,
    consecutiveSuccesses: row.consecutive_successes,
    expectedIntervalMinutes: row.expected_interval_minutes,
    graceMinutes: row.grace_minutes,
    secretHash: row.secret_hash,
    lastCheckedAt: row.last_checked_at,
    lastCheckStatus: row.last_check_status,
    lastCheckLatencyMs: row.last_check_latency_ms,
    lastCheckResponseStatus: row.last_check_response_status,
    lastCheckErrorMessage: row.last_check_error_message,
    lastHeartbeatAt: row.last_heartbeat_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

function toMonitorCheck(row: MonitorCheckRow): MonitorCheckRecord {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    checkedAt: row.checked_at,
    status: row.status,
    latencyMs: row.latency_ms,
    responseStatus: row.response_status,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}

function toMonitorAlertEvent(row: AlertEventRow): MonitorAlertEventRecord {
  if (!row.monitor_id) {
    throw new Error("monitor_alert_event_missing_monitor_id");
  }

  return {
    id: row.id,
    monitorId: row.monitor_id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    severity: row.severity === "critical" ? "critical" : "warning",
    triggeredAt: row.triggered_at,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    observedValue: String(row.observed_value),
    threshold: String(row.threshold),
    message: row.message,
    metadata: row.metadata,
    createdAt: row.created_at
  };
}

async function assertActiveMonitorScope(db: Db, input: MonitorScope): Promise<void> {
  const activeScope = await db
    .selectFrom("projects")
    .innerJoin("environments", "environments.project_id", "projects.id")
    .select("environments.id")
    .where("projects.id", "=", input.projectId)
    .where("environments.id", "=", input.environmentId)
    .where("projects.archived_at", "is", null)
    .where("environments.archived_at", "is", null)
    .executeTakeFirst();

  if (!activeScope) {
    throw new Error("active_monitor_scope_not_found");
  }
}

function nextMonitorStatus(
  current: MonitorRow,
  checkStatus: MonitorCheckStatus,
  consecutiveFailures: number,
  consecutiveSuccesses: number
): MonitorStatus {
  if (current.status === "paused") {
    return "paused";
  }

  if (checkStatus === "success") {
    if (consecutiveSuccesses >= current.recovery_threshold) {
      return "up";
    }
    return current.status === "up" || current.status === "down" ? current.status : "degraded";
  }

  if (consecutiveFailures >= current.failure_threshold) {
    return "down";
  }
  return current.status === "up" || current.status === "down" ? current.status : "degraded";
}

export async function createHttpMonitor(db: Db, input: CreateHttpMonitorInput): Promise<MonitorRecord> {
  await assertActiveMonitorScope(db, input);

  const row = await db
    .insertInto("monitors")
    .values({
      id: createId("mon"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      notification_channel_id: input.notificationChannelId ?? null,
      kind: "http",
      name: input.name,
      enabled: input.enabled,
      status: "unknown",
      url: input.url,
      method: input.method,
      expected_status: input.expectedStatus,
      body_contains: input.bodyContains ?? null,
      timeout_ms: input.timeoutMs,
      interval_minutes: input.intervalMinutes,
      failure_threshold: input.failureThreshold,
      recovery_threshold: input.recoveryThreshold,
      consecutive_failures: 0,
      consecutive_successes: 0,
      expected_interval_minutes: null,
      grace_minutes: null,
      secret_hash: null
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toMonitor(row);
}

export async function createHeartbeatMonitor(
  db: Db,
  input: CreateHeartbeatMonitorInput
): Promise<MonitorRecord> {
  await assertActiveMonitorScope(db, input);

  const row = await db
    .insertInto("monitors")
    .values({
      id: createId("mon"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      notification_channel_id: input.notificationChannelId ?? null,
      kind: "heartbeat",
      name: input.name,
      enabled: input.enabled,
      status: "unknown",
      url: null,
      method: null,
      expected_status: null,
      body_contains: null,
      timeout_ms: null,
      interval_minutes: null,
      failure_threshold: 1,
      recovery_threshold: 1,
      consecutive_failures: 0,
      consecutive_successes: 0,
      expected_interval_minutes: input.expectedIntervalMinutes,
      grace_minutes: input.graceMinutes,
      secret_hash: input.secretHash
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toMonitor(row);
}

export async function listMonitors(
  db: Db,
  filters: { projectId: string; environmentId: string; kind?: MonitorKind }
): Promise<MonitorRecord[]> {
  let query = db
    .selectFrom("monitors")
    .selectAll()
    .where("project_id", "=", filters.projectId)
    .where("environment_id", "=", filters.environmentId)
    .where("archived_at", "is", null);

  if (filters.kind !== undefined) {
    query = query.where("kind", "=", filters.kind);
  }

  const rows = await query.orderBy("created_at", "asc").orderBy("id", "asc").execute();
  return rows.map(toMonitor);
}

export async function getMonitor(db: Db, id: string): Promise<MonitorRecord | undefined> {
  const row = await db
    .selectFrom("monitors")
    .selectAll()
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .executeTakeFirst();

  return row ? toMonitor(row) : undefined;
}

export async function updateMonitor(
  db: Db,
  id: string,
  input: UpdateMonitorInput
): Promise<MonitorRecord | null> {
  if (input.projectId !== undefined || input.environmentId !== undefined) {
    const current = await db
      .selectFrom("monitors")
      .select(["project_id", "environment_id"])
      .where("id", "=", id)
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (!current) {
      return null;
    }

    await assertActiveMonitorScope(db, {
      projectId: input.projectId ?? current.project_id,
      environmentId: input.environmentId ?? current.environment_id
    });
  }

  const row = await db
    .updateTable("monitors")
    .set({
      ...(input.projectId !== undefined ? { project_id: input.projectId } : {}),
      ...(input.environmentId !== undefined ? { environment_id: input.environmentId } : {}),
      ...(input.notificationChannelId !== undefined ? { notification_channel_id: input.notificationChannelId } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.method !== undefined ? { method: input.method } : {}),
      ...(input.expectedStatus !== undefined ? { expected_status: input.expectedStatus } : {}),
      ...(input.bodyContains !== undefined ? { body_contains: input.bodyContains } : {}),
      ...(input.timeoutMs !== undefined ? { timeout_ms: input.timeoutMs } : {}),
      ...(input.intervalMinutes !== undefined ? { interval_minutes: input.intervalMinutes } : {}),
      ...(input.failureThreshold !== undefined ? { failure_threshold: input.failureThreshold } : {}),
      ...(input.recoveryThreshold !== undefined ? { recovery_threshold: input.recoveryThreshold } : {}),
      ...(input.expectedIntervalMinutes !== undefined
        ? { expected_interval_minutes: input.expectedIntervalMinutes }
        : {}),
      ...(input.graceMinutes !== undefined ? { grace_minutes: input.graceMinutes } : {}),
      ...(input.secretHash !== undefined ? { secret_hash: input.secretHash } : {}),
      updated_at: new Date()
    })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toMonitor(row) : null;
}

export async function archiveMonitor(db: Db, id: string): Promise<void> {
  const now = new Date();
  await db
    .updateTable("monitors")
    .set({ archived_at: now, updated_at: now })
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .execute();
}

export async function listDueHttpMonitors(
  db: Db,
  input: { now: Date; limit: number }
): Promise<MonitorRecord[]> {
  const limit = clampLimit(input.limit, 50);
  const result = await sql<MonitorRow>`
    select *
    from monitors
    where kind = 'http'
      and enabled = true
      and status <> 'paused'
      and archived_at is null
      and (
        last_checked_at is null
        or last_checked_at <= ${input.now}::timestamptz - make_interval(mins => interval_minutes)
      )
    order by last_checked_at asc nulls first, created_at asc
    limit ${limit}
  `.execute(db);

  return result.rows.map(toMonitor);
}

export async function recordMonitorCheck(db: Db, input: RecordMonitorCheckInput): Promise<MonitorRecord> {
  return db.transaction().execute(async (trx) => {
    const monitor = await trx
      .selectFrom("monitors")
      .selectAll()
      .where("id", "=", input.monitorId)
      .where("archived_at", "is", null)
      .forUpdate()
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("monitor_checks")
      .values({
        id: createId("mchk"),
        monitor_id: input.monitorId,
        checked_at: input.checkedAt,
        status: input.status,
        latency_ms: input.latencyMs ?? null,
        response_status: input.responseStatus ?? null,
        error_message: input.errorMessage ?? null
      })
      .execute();

    const consecutiveFailures = input.status === "failed" ? monitor.consecutive_failures + 1 : 0;
    const consecutiveSuccesses = input.status === "success" ? monitor.consecutive_successes + 1 : 0;
    const status = nextMonitorStatus(monitor, input.status, consecutiveFailures, consecutiveSuccesses);

    const updated = await trx
      .updateTable("monitors")
      .set({
        status,
        consecutive_failures: consecutiveFailures,
        consecutive_successes: consecutiveSuccesses,
        last_checked_at: input.checkedAt,
        last_check_status: input.status,
        last_check_latency_ms: input.latencyMs ?? null,
        last_check_response_status: input.responseStatus ?? null,
        last_check_error_message: input.errorMessage ?? null,
        updated_at: new Date()
      })
      .where("id", "=", input.monitorId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return toMonitor(updated);
  });
}

export async function recordHeartbeatCheckIn(
  db: Db,
  input: { monitorId: string; checkedInAt: Date }
): Promise<MonitorRecord | null> {
  return db.transaction().execute(async (trx) => {
    const monitor = await trx
      .selectFrom("monitors")
      .select(["id", "status"])
      .where("id", "=", input.monitorId)
      .where("kind", "=", "heartbeat")
      .where("archived_at", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!monitor) {
      return null;
    }

    await trx
      .insertInto("monitor_checks")
      .values({
        id: createId("mchk"),
        monitor_id: input.monitorId,
        checked_at: input.checkedInAt,
        status: "success",
        latency_ms: null,
        response_status: null,
        error_message: null
      })
      .execute();

    const row = await trx
      .updateTable("monitors")
      .set({
        status: monitor.status === "paused" ? "paused" : "up",
        consecutive_failures: 0,
        consecutive_successes: 1,
        last_checked_at: input.checkedInAt,
        last_check_status: "success",
        last_check_latency_ms: null,
        last_check_response_status: null,
        last_check_error_message: null,
        last_heartbeat_at: input.checkedInAt,
        updated_at: new Date()
      })
      .where("id", "=", input.monitorId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return toMonitor(row);
  });
}

export async function listStaleHeartbeatMonitors(
  db: Db,
  input: { now: Date; limit?: number }
): Promise<MonitorRecord[]> {
  const limit = clampLimit(input.limit, 50);
  const result = await sql<MonitorRow>`
    select *
    from monitors
    where kind = 'heartbeat'
      and enabled = true
      and status <> 'paused'
      and archived_at is null
      and (
        last_heartbeat_at is null
        or last_heartbeat_at <= ${input.now}::timestamptz - make_interval(mins => expected_interval_minutes + grace_minutes)
      )
    order by last_heartbeat_at asc nulls first, created_at asc
    limit ${limit}
  `.execute(db);

  return result.rows.map(toMonitor);
}

export async function listMonitorChecks(
  db: Db,
  input: { monitorId: string; limit?: number }
): Promise<MonitorCheckRecord[]> {
  const limit = clampLimit(input.limit, 50);
  const rows = await db
    .selectFrom("monitor_checks")
    .selectAll()
    .where("monitor_id", "=", input.monitorId)
    .orderBy("checked_at", "desc")
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute();

  return rows.map(toMonitorCheck);
}

export async function recordMonitorAlertEvent(
  db: Db,
  input: {
    monitor: MonitorRecord;
    triggeredAt: Date;
    windowStart: Date;
    windowEnd: Date;
    observedValue: string;
    threshold: string;
    severity: "warning" | "critical";
    message: string;
    metadata: unknown;
  }
): Promise<MonitorAlertEventRecord> {
  const row = await db
    .insertInto("alert_events")
    .values({
      rule_id: null,
      monitor_id: input.monitor.id,
      project_id: input.monitor.projectId,
      environment_id: input.monitor.environmentId,
      status: "triggered",
      severity: input.severity,
      triggered_at: input.triggeredAt,
      window_start: input.windowStart,
      window_end: input.windowEnd,
      observed_value: input.observedValue,
      threshold: input.threshold,
      message: input.message,
      metadata: input.metadata
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toMonitorAlertEvent(row);
}

export async function withMonitorEvaluationLock<T>(
  db: Db,
  run: () => Promise<T>
): Promise<{ locked: false } | { locked: true; result: T }> {
  return db.transaction().execute(async (trx) => {
    const lock = await sql<{ locked: boolean }>`
      select pg_try_advisory_xact_lock(${MONITOR_EVALUATION_LOCK_ID}) as locked
    `.execute(trx);

    if (!lock.rows[0]?.locked) {
      return { locked: false };
    }

    return { locked: true, result: await run() };
  });
}
