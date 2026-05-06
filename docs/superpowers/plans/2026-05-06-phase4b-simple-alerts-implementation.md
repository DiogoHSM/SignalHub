# Phase 4B Simple Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add worker-owned simple alert evaluation, internal alert history, and generic webhook notifications.

**Architecture:** Keep alerts inside the existing self-hosted runtime. Postgres stores alert rules, notification channels, alert events, and delivery attempts; the worker evaluates enabled rules under an advisory lock and sends webhooks; the API exposes authenticated admin and read endpoints; the console adds an operational Alerts area.

**Tech Stack:** TypeScript, Fastify, Kysely/Postgres, worker scheduler, `fetch`, React, Vitest, Testing Library, Docker Compose.

---

## Scope Check

This plan covers one cohesive subsystem: simple alerts. The database metadata, worker evaluator, API routes, and console surface are all required for the first useful alert loop:

- Admin creates rules and webhook channels.
- Worker evaluates rules and records alert events.
- Worker records webhook delivery attempts.
- Console shows rules, channels, history, and delivery status.

Provider-specific notifications, alert acknowledgement, silencing, escalation, retries, private-network webhook override, and custom expressions remain out of scope.

## File Structure

Create:

- `packages/db/migrations/0003_simple_alerts.sql` - alert metadata tables and indexes.
- `packages/db/src/repositories/alerts.ts` - alert CRUD, evaluation queries, alert event recording, delivery recording, and advisory lock helper.
- `apps/worker/src/alerts.ts` - pure alert evaluation orchestration, scheduler, webhook delivery helper, and safe URL/header validation.
- `apps/api/src/routes/alerts.ts` - authenticated alert history routes.
- `apps/api/test/alerts.test.ts` - alert route tests.
- `apps/console/src/components/AlertsPanel.tsx` - operational Alerts console area.
- `apps/console/src/components/AlertsPanel.test.tsx` - Alerts panel behavior tests.

Modify:

- `packages/config/src/index.ts` - alert scheduler and webhook timeout config.
- `packages/config/test/config.test.ts` - alert config tests.
- `packages/db/src/migrate.ts` - include `0003_simple_alerts.sql`.
- `packages/db/src/schema.ts` - alert table interfaces.
- `packages/db/test/repositories.test.ts` - alert repository integration tests.
- `apps/worker/src/main.ts` - start and stop alert scheduler.
- `apps/worker/test/telemetry-worker.test.ts` - alert scheduler/evaluator/webhook unit tests.
- `apps/api/src/app.ts` - register alert routes.
- `apps/api/src/main.ts` - wire alert repositories into API dependencies.
- `apps/api/src/routes/admin.ts` - add admin CRUD endpoints for notification channels and alert rules.
- `apps/api/test/e2e.test.ts` - provide new optional app dependencies where needed.
- `apps/console/src/api/types.ts` - alert types.
- `apps/console/src/api/client.ts` - alert API methods.
- `apps/console/src/api/client.test.ts` - alert client path tests.
- `apps/console/src/components/ConsoleModeTabs.tsx` - add `alerts` mode.
- `apps/console/src/components/ConsoleModeTabs.test.tsx` - cover Alerts tab.
- `apps/console/src/components/ConsoleShell.tsx` - lazy-render `AlertsPanel`.
- `apps/console/src/components/ConsoleShell.test.tsx` - cover Alerts mode loading.
- `apps/console/src/styles.css` - Alerts layout and status styles.
- `.env.example` - alert defaults.
- `README.md` - simple alerts and webhook docs.
- `.claude/docs/ARCHITECTURE.md`, `.claude/docs/DEPLOYMENT.md`, `.claude/docs/SECRETS.md`, `.claude/docs/UI-UX.md`, `.claude/docs/PROJECT-SUMMARY.md` - project docs.

## Task 1: Alert Configuration

**Files:**

- Modify: `packages/config/src/index.ts`
- Test: `packages/config/test/config.test.ts`

- [x] **Step 1: Add failing config tests**

Add tests to `packages/config/test/config.test.ts`:

```ts
it("loads alert defaults", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    PORT: "3000",
    DATABASE_URL: "postgres://user:pass@localhost:5432/signalhub",
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "a-secure-session-secret-with-enough-length",
    API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
    BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
    BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple",
    GOOGLE_OAUTH_ENABLED: "false"
  });

  expect(config.alerts).toEqual({
    enabled: true,
    intervalMinutes: 1,
    webhookTimeoutMs: 5000
  });
});

it("loads explicit alert settings", () => {
  const config = loadConfig({
    ...validEnv,
    ALERTS_ENABLED: "false",
    ALERTS_INTERVAL_MINUTES: "5",
    ALERTS_WEBHOOK_TIMEOUT_MS: "2500"
  });

  expect(config.alerts).toEqual({
    enabled: false,
    intervalMinutes: 5,
    webhookTimeoutMs: 2500
  });
});

it.each(["ALERTS_INTERVAL_MINUTES", "ALERTS_WEBHOOK_TIMEOUT_MS"] as const)("rejects non-positive %s", (fieldName) => {
  expect(() =>
    loadConfig({
      ...validEnv,
      [fieldName]: "0"
    })
  ).toThrow();
});
```

- [x] **Step 2: Run config tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/config test
```

Expected: fail because `config.alerts` does not exist.

- [x] **Step 3: Implement alert config**

In `packages/config/src/index.ts`, add schema fields beside retention config:

```ts
ALERTS_ENABLED: z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true"),
ALERTS_INTERVAL_MINUTES: optionalPositiveInteger(1),
ALERTS_WEBHOOK_TIMEOUT_MS: optionalPositiveInteger(5000)
```

Return the parsed config:

```ts
alerts: {
  enabled: parsed.ALERTS_ENABLED,
  intervalMinutes: parsed.ALERTS_INTERVAL_MINUTES,
  webhookTimeoutMs: parsed.ALERTS_WEBHOOK_TIMEOUT_MS
}
```

- [x] **Step 4: Run config tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/config test
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add packages/config/src/index.ts packages/config/test/config.test.ts
git commit -m "feat: add alert configuration"
```

## Task 2: Alert Metadata Tables

**Files:**

- Create: `packages/db/migrations/0003_simple_alerts.sql`
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/src/schema.ts`
- Test: `packages/db/test/repositories.test.ts`

- [x] **Step 1: Add failing migration test**

Add to `packages/db/test/repositories.test.ts` near the migration coverage:

```ts
it("runs simple alert migrations", async () => {
  await sql`select id, type, enabled from notification_channels limit 0`.execute(db);
  await sql`select id, type, threshold from alert_rules limit 0`.execute(db);
  await sql`select id, observed_value from alert_events limit 0`.execute(db);
  await sql`select id, status from notification_deliveries limit 0`.execute(db);
});
```

- [x] **Step 2: Run DB tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: fail because the alert tables do not exist.

- [x] **Step 3: Add migration SQL**

Create `packages/db/migrations/0003_simple_alerts.sql`:

```sql
CREATE TABLE notification_channels (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('webhook')),
  url text NOT NULL,
  secret_header_name text,
  secret_header_value text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX notification_channels_active_idx ON notification_channels(enabled, archived_at);

CREATE TABLE alert_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL,
  notification_channel_id text REFERENCES notification_channels(id),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('critical_errors', 'error_count', 'trace_p95_latency', 'llm_cost')),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  window_minutes integer NOT NULL CHECK (window_minutes > 0),
  threshold numeric(18, 6) NOT NULL CHECK (threshold > 0),
  cooldown_minutes integer NOT NULL CHECK (cooldown_minutes > 0),
  enabled boolean NOT NULL DEFAULT true,
  last_evaluated_at timestamptz,
  last_triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id)
);

CREATE INDEX alert_rules_active_scope_idx ON alert_rules(project_id, environment_id, enabled, archived_at);
CREATE INDEX alert_rules_channel_idx ON alert_rules(notification_channel_id);

CREATE TABLE alert_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rule_id text NOT NULL REFERENCES alert_rules(id),
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('triggered')),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  triggered_at timestamptz NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  observed_value numeric(18, 6) NOT NULL,
  threshold numeric(18, 6) NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id)
);

CREATE INDEX alert_events_scope_time_idx ON alert_events(project_id, environment_id, triggered_at DESC);
CREATE INDEX alert_events_rule_time_idx ON alert_events(rule_id, triggered_at DESC);

CREATE TABLE notification_deliveries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  alert_event_id text NOT NULL REFERENCES alert_events(id),
  notification_channel_id text NOT NULL REFERENCES notification_channels(id),
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  attempted_at timestamptz NOT NULL,
  response_status integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_deliveries_event_idx ON notification_deliveries(alert_event_id);
CREATE INDEX notification_deliveries_channel_time_idx ON notification_deliveries(notification_channel_id, attempted_at DESC);
```

- [x] **Step 4: Register migration**

In `packages/db/src/migrate.ts`, add the migration to the ordered list:

```ts
{ name: "0003_simple_alerts.sql", url: new URL("../migrations/0003_simple_alerts.sql", import.meta.url) }
```

- [x] **Step 5: Update Kysely schema**

In `packages/db/src/schema.ts`, add interfaces:

```ts
export type AlertRuleType = "critical_errors" | "error_count" | "trace_p95_latency" | "llm_cost";
export type AlertSeverity = "info" | "warning" | "critical";

export interface NotificationChannelsTable {
  id: ColumnType<string, string | undefined, string>;
  name: string;
  type: "webhook";
  url: string;
  secret_header_name: string | null;
  secret_header_value: string | null;
  enabled: DefaultedBoolean;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface AlertRulesTable {
  id: ColumnType<string, string | undefined, string>;
  project_id: string;
  environment_id: string;
  notification_channel_id: string | null;
  name: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  window_minutes: number;
  threshold: NumericString;
  cooldown_minutes: number;
  enabled: DefaultedBoolean;
  last_evaluated_at: NullableTimestamp;
  last_triggered_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface AlertEventsTable {
  id: ColumnType<string, string | undefined, string>;
  rule_id: string;
  project_id: string;
  environment_id: string;
  status: "triggered";
  severity: AlertSeverity;
  triggered_at: Timestamp;
  window_start: Timestamp;
  window_end: Timestamp;
  observed_value: NumericString;
  threshold: NumericString;
  message: string;
  metadata: JsonColumn;
  created_at: Timestamp;
}

export interface NotificationDeliveriesTable {
  id: ColumnType<string, string | undefined, string>;
  alert_event_id: string;
  notification_channel_id: string;
  status: "success" | "failed";
  attempted_at: Timestamp;
  response_status: number | null;
  error_message: string | null;
  created_at: Timestamp;
}
```

Add to `Database`:

```ts
notification_channels: NotificationChannelsTable;
alert_rules: AlertRulesTable;
alert_events: AlertEventsTable;
notification_deliveries: NotificationDeliveriesTable;
```

- [x] **Step 6: Run DB tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add packages/db/migrations/0003_simple_alerts.sql packages/db/src/migrate.ts packages/db/src/schema.ts packages/db/test/repositories.test.ts
git commit -m "feat: add alert metadata tables"
```

## Task 3: Alert Repository

**Files:**

- Create: `packages/db/src/repositories/alerts.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [x] **Step 1: Add failing CRUD and evaluation tests**

Add tests to `packages/db/test/repositories.test.ts` that create one project and environment, then exercise alert repository functions:

```ts
import {
  createAlertRule,
  createNotificationChannel,
  evaluateAlertRule,
  listActiveAlertRules,
  listAlertEvents,
  recordAlertEvent,
  recordNotificationDelivery,
  updateAlertRuleEvaluation,
  withAlertEvaluationLock
} from "../src/repositories/alerts.js";
```

Use these test cases:

```ts
it("creates channels rules alert events and deliveries", async () => {
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

it("evaluates supported alert rule types", async () => {
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

  const criticalResult = await evaluateAlertRule(db, {
    projectId: project.id,
    environmentId: environment.id,
    type: "critical_errors",
    windowStart: new Date("2026-05-06T11:50:00.000Z"),
    windowEnd: new Date("2026-05-06T12:00:00.000Z")
  });
  expect(criticalResult.observedValue).toBe("1");

  const latencyResult = await evaluateAlertRule(db, {
    projectId: project.id,
    environmentId: environment.id,
    type: "trace_p95_latency",
    windowStart: new Date("2026-05-06T11:50:00.000Z"),
    windowEnd: new Date("2026-05-06T12:00:00.000Z")
  });
  expect(latencyResult.observedValue).toBe("15000");
});

it("uses an advisory lock for alert evaluation", async () => {
  const first = await withAlertEvaluationLock(db, async () => {
    const second = await withAlertEvaluationLock(db, async () => "nested");
    expect(second).toEqual({ locked: false });
    return "outer";
  });

  expect(first).toEqual({ locked: true, result: "outer" });
});
```

- [x] **Step 2: Run DB tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: fail because `repositories/alerts.ts` does not exist.

- [x] **Step 3: Implement repository types and mappers**

Create `packages/db/src/repositories/alerts.ts` with exported types:

```ts
import type { Selectable, Transaction } from "kysely";
import { sql } from "kysely";
import type { Db } from "../client.js";
import type {
  AlertEventsTable,
  AlertRulesTable,
  AlertRuleType,
  Database,
  NotificationChannelsTable,
  NotificationDeliveriesTable
} from "../schema.js";

type AlertDb = Db | Transaction<Database>;

export type NotificationChannelRecord = {
  id: string;
  name: string;
  type: "webhook";
  url: string;
  secretHeaderName: string | null;
  secretHeaderValue: string | null;
  hasSecret: boolean;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type AlertRuleRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  notificationChannelId: string | null;
  name: string;
  type: AlertRuleType;
  severity: "info" | "warning" | "critical";
  windowMinutes: number;
  threshold: string;
  cooldownMinutes: number;
  enabled: boolean;
  lastEvaluatedAt: Date | null;
  lastTriggeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type AlertEventRecord = {
  id: string;
  ruleId: string;
  projectId: string;
  environmentId: string;
  status: "triggered";
  severity: "info" | "warning" | "critical";
  triggeredAt: Date;
  windowStart: Date;
  windowEnd: Date;
  observedValue: string;
  threshold: string;
  message: string;
  metadata: unknown;
  createdAt: Date;
  latestDeliveryStatus: "success" | "failed" | null;
};
```

Implement `toNotificationChannel`, `toAlertRule`, and `toAlertEvent` mappers from selected rows.

- [x] **Step 4: Implement channel and rule CRUD**

Add functions:

```ts
export async function createNotificationChannel(db: AlertDb, input: {
  name: string;
  type: "webhook";
  url: string;
  secretHeaderName?: string | null;
  secretHeaderValue?: string | null;
  enabled: boolean;
}): Promise<NotificationChannelRecord> {
  const row = await db
    .insertInto("notification_channels")
    .values({
      name: input.name,
      type: input.type,
      url: input.url,
      secret_header_name: input.secretHeaderName ?? null,
      secret_header_value: input.secretHeaderValue ?? null,
      enabled: input.enabled
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toNotificationChannel(row);
}

export async function createAlertRule(db: AlertDb, input: {
  projectId: string;
  environmentId: string;
  notificationChannelId?: string | null;
  name: string;
  type: AlertRuleType;
  severity: "info" | "warning" | "critical";
  windowMinutes: number;
  threshold: string;
  cooldownMinutes: number;
  enabled: boolean;
}): Promise<AlertRuleRecord> {
  const row = await db
    .insertInto("alert_rules")
    .values({
      project_id: input.projectId,
      environment_id: input.environmentId,
      notification_channel_id: input.notificationChannelId ?? null,
      name: input.name,
      type: input.type,
      severity: input.severity,
      window_minutes: input.windowMinutes,
      threshold: input.threshold,
      cooldown_minutes: input.cooldownMinutes,
      enabled: input.enabled
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toAlertRule(row);
}
```

Also implement `listNotificationChannels`, `getNotificationChannel`, `updateNotificationChannel`, `archiveNotificationChannel`, `listAlertRules`, `getAlertRule`, `updateAlertRule`, and `archiveAlertRule` using the same soft-archive conventions as `packages/db/src/repositories/admin.ts`.

- [x] **Step 5: Implement evaluation queries and alert recording**

Add:

```ts
export async function evaluateAlertRule(db: AlertDb, input: {
  projectId: string;
  environmentId: string;
  type: AlertRuleType;
  windowStart: Date;
  windowEnd: Date;
}): Promise<{ observedValue: string }> {
  if (input.type === "critical_errors") {
    const row = await db
      .selectFrom("errors")
      .select(({ fn }) => fn.countAll<string>().as("value"))
      .where("project_id", "=", input.projectId)
      .where("environment_id", "=", input.environmentId)
      .where("timestamp", ">=", input.windowStart)
      .where("timestamp", "<", input.windowEnd)
      .where("severity", "in", ["critical", "fatal"])
      .executeTakeFirstOrThrow();
    return { observedValue: String(row.value ?? "0") };
  }

  if (input.type === "error_count") {
    const row = await db
      .selectFrom("errors")
      .select(({ fn }) => fn.countAll<string>().as("value"))
      .where("project_id", "=", input.projectId)
      .where("environment_id", "=", input.environmentId)
      .where("timestamp", ">=", input.windowStart)
      .where("timestamp", "<", input.windowEnd)
      .executeTakeFirstOrThrow();
    return { observedValue: String(row.value ?? "0") };
  }

  if (input.type === "trace_p95_latency") {
    const row = await sql<{ value: string | null }>`
      select percentile_cont(0.95) within group (order by duration_ms)::numeric(18, 6) as value
      from traces
      where project_id = ${input.projectId}
        and environment_id = ${input.environmentId}
        and timestamp >= ${input.windowStart}
        and timestamp < ${input.windowEnd}
        and duration_ms is not null
    `.execute(db);
    return { observedValue: row.rows[0]?.value ?? "0" };
  }

  const row = await db
    .selectFrom("llm_calls")
    .select(({ fn }) => fn.coalesce(fn.sum<string>("cost_usd"), sql<string>`0`).as("value"))
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("timestamp", ">=", input.windowStart)
    .where("timestamp", "<", input.windowEnd)
    .executeTakeFirstOrThrow();
  return { observedValue: String(row.value ?? "0") };
}
```

Implement `recordAlertEvent`, `recordNotificationDelivery`, `updateAlertRuleEvaluation`, and `listAlertEvents`. `listAlertEvents` should left-join or follow-up query the newest delivery for each event and expose `latestDeliveryStatus`.

- [x] **Step 6: Implement advisory lock and active rule listing**

Add:

```ts
const ALERT_EVALUATION_LOCK_ID = 927380402914;

export async function withAlertEvaluationLock<T>(
  db: Db,
  run: (lockedDb: Transaction<Database>) => Promise<T>
): Promise<{ locked: false } | { locked: true; result: T }> {
  return db.transaction().execute(async (trx) => {
    const lockResult = await sql<{ locked: boolean }>`SELECT pg_try_advisory_xact_lock(${ALERT_EVALUATION_LOCK_ID}) as locked`.execute(trx);
    if (!lockResult.rows[0]?.locked) {
      return { locked: false };
    }
    return { locked: true, result: await run(trx) };
  });
}

export async function listActiveAlertRules(db: AlertDb): Promise<AlertRuleRecord[]> {
  const rows = await db
    .selectFrom("alert_rules")
    .selectAll()
    .where("enabled", "=", true)
    .where("archived_at", "is", null)
    .orderBy("created_at", "asc")
    .execute();
  return rows.map(toAlertRule);
}
```

- [x] **Step 7: Run DB tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/db test -- repositories.test.ts
```

Expected: pass.

- [x] **Step 8: Commit**

```bash
git add packages/db/src/repositories/alerts.ts packages/db/test/repositories.test.ts
git commit -m "feat: add alert repository"
```

## Task 4: Worker Alert Evaluation and Webhook Delivery

**Files:**

- Create: `apps/worker/src/alerts.ts`
- Modify: `apps/worker/src/main.ts`
- Test: `apps/worker/test/telemetry-worker.test.ts`

- [x] **Step 1: Add failing worker tests**

Add tests to `apps/worker/test/telemetry-worker.test.ts`:

```ts
import {
  deliverWebhook,
  runAlertEvaluationOnce,
  startAlertScheduler,
  validateWebhookTarget
} from "../src/alerts.js";
```

Add cases:

```ts
it("creates an alert event and records webhook success when a rule fires", async () => {
  const now = new Date("2026-05-06T12:00:00.000Z");
  const deliveries: unknown[] = [];
  const result = await runAlertEvaluationOnce({
    now: () => now,
    withLock: async (run) => ({ locked: true, result: await run() }),
    listActiveRules: async () => [
      {
        id: "rule_1",
        projectId: "prj_1",
        environmentId: "env_1",
        notificationChannelId: "chn_1",
        name: "Critical errors",
        type: "critical_errors",
        severity: "critical",
        windowMinutes: 10,
        threshold: "1",
        cooldownMinutes: 30,
        enabled: true,
        lastEvaluatedAt: null,
        lastTriggeredAt: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      }
    ],
    getNotificationChannel: async () => ({
      id: "chn_1",
      name: "Webhook",
      type: "webhook",
      url: "https://hooks.example.com/signalhub",
      secretHeaderName: null,
      secretHeaderValue: null,
      hasSecret: false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    }),
    evaluateRule: async () => ({ observedValue: "2" }),
    recordAlertEvent: async () => ({ id: "evt_1" }),
    updateRuleEvaluation: async () => {},
    deliver: async () => ({ status: "success", responseStatus: 204, errorMessage: null }),
    recordDelivery: async (input) => {
      deliveries.push(input);
    }
  });

  expect(result).toEqual({ ran: true, skipped: false, evaluated: 1, triggered: 1 });
  expect(deliveries).toHaveLength(1);
});

it("suppresses events during cooldown while updating evaluation time", async () => {
  const now = new Date("2026-05-06T12:00:00.000Z");
  const updated: unknown[] = [];
  const result = await runAlertEvaluationOnce({
    now: () => now,
    withLock: async (run) => ({ locked: true, result: await run() }),
    listActiveRules: async () => [
      {
        id: "rule_1",
        projectId: "prj_1",
        environmentId: "env_1",
        notificationChannelId: null,
        name: "Errors",
        type: "error_count",
        severity: "warning",
        windowMinutes: 10,
        threshold: "1",
        cooldownMinutes: 30,
        enabled: true,
        lastEvaluatedAt: null,
        lastTriggeredAt: new Date("2026-05-06T11:45:00.000Z"),
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      }
    ],
    getNotificationChannel: async () => null,
    evaluateRule: async () => ({ observedValue: "5" }),
    recordAlertEvent: async () => {
      throw new Error("should not create event");
    },
    updateRuleEvaluation: async (input) => {
      updated.push(input);
    },
    deliver: async () => ({ status: "success", responseStatus: 204, errorMessage: null }),
    recordDelivery: async () => {}
  });

  expect(result.triggered).toBe(0);
  expect(updated).toHaveLength(1);
});

it("rejects localhost webhook targets in production", () => {
  expect(() => validateWebhookTarget("http://localhost:3000/hook", "production")).toThrow(/private webhook targets are not allowed/);
});
```

- [x] **Step 2: Run worker tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/worker test
```

Expected: fail because `apps/worker/src/alerts.ts` does not exist.

- [x] **Step 3: Implement alert runtime types and evaluator**

Create `apps/worker/src/alerts.ts`:

```ts
import type { AlertRuleRecord, NotificationChannelRecord } from "@signal-hub/db/repositories/alerts.js";
import { sanitizePreviewText } from "@signal-hub/telemetry/sanitization";

export type AlertEvaluationRuntime = {
  now: () => Date;
  withLock: <T>(run: () => Promise<T>) => Promise<{ locked: false } | { locked: true; result: T }>;
  listActiveRules: () => Promise<AlertRuleRecord[]>;
  getNotificationChannel: (id: string) => Promise<NotificationChannelRecord | null | undefined>;
  evaluateRule: (rule: AlertRuleRecord, windowStart: Date, windowEnd: Date) => Promise<{ observedValue: string }>;
  recordAlertEvent: (input: {
    rule: AlertRuleRecord;
    triggeredAt: Date;
    windowStart: Date;
    windowEnd: Date;
    observedValue: string;
    message: string;
    metadata: unknown;
  }) => Promise<{ id: string }>;
  updateRuleEvaluation: (input: { ruleId: string; evaluatedAt: Date; triggeredAt?: Date | null }) => Promise<unknown>;
  deliver: (channel: NotificationChannelRecord, payload: AlertWebhookPayload) => Promise<DeliveryResult>;
  recordDelivery: (input: {
    alertEventId: string;
    notificationChannelId: string;
    status: "success" | "failed";
    attemptedAt: Date;
    responseStatus: number | null;
    errorMessage: string | null;
  }) => Promise<unknown>;
};
```

Implement:

```ts
export async function runAlertEvaluationOnce(runtime: AlertEvaluationRuntime): Promise<{
  ran: boolean;
  skipped: boolean;
  evaluated: number;
  triggered: number;
}> {
  const lockResult = await runtime.withLock(async () => {
    const now = runtime.now();
    const rules = await runtime.listActiveRules();
    let triggered = 0;

    for (const rule of rules) {
      const windowEnd = now;
      const windowStart = new Date(windowEnd.getTime() - rule.windowMinutes * 60 * 1000);
      const inCooldown =
        rule.lastTriggeredAt !== null &&
        now.getTime() - rule.lastTriggeredAt.getTime() < rule.cooldownMinutes * 60 * 1000;

      if (inCooldown) {
        await runtime.updateRuleEvaluation({ ruleId: rule.id, evaluatedAt: now });
        continue;
      }

      try {
        const observed = await runtime.evaluateRule(rule, windowStart, windowEnd);
        const fired = Number(observed.observedValue) >= Number(rule.threshold);
        if (!fired) {
          await runtime.updateRuleEvaluation({ ruleId: rule.id, evaluatedAt: now });
          continue;
        }

        const message = sanitizePreviewText(`${rule.name} threshold reached: ${observed.observedValue} >= ${rule.threshold}`);
        const event = await runtime.recordAlertEvent({
          rule,
          triggeredAt: now,
          windowStart,
          windowEnd,
          observedValue: observed.observedValue,
          message,
          metadata: { ruleType: rule.type }
        });
        await runtime.updateRuleEvaluation({ ruleId: rule.id, evaluatedAt: now, triggeredAt: now });
        triggered += 1;

        if (rule.notificationChannelId) {
          const channel = await runtime.getNotificationChannel(rule.notificationChannelId);
          if (channel?.enabled && channel.archivedAt === null) {
            const delivery = await runtime.deliver(channel, toWebhookPayload(rule, event.id, now, windowStart, windowEnd, observed.observedValue, message));
            await runtime.recordDelivery({
              alertEventId: event.id,
              notificationChannelId: channel.id,
              attemptedAt: now,
              ...delivery
            });
          }
        }
      } catch (error) {
        console.error(`Alert rule ${rule.id} evaluation failed`, error);
        await runtime.updateRuleEvaluation({ ruleId: rule.id, evaluatedAt: now });
      }
    }

    return { evaluated: rules.length, triggered };
  });

  if (!lockResult.locked) return { ran: false, skipped: true, evaluated: 0, triggered: 0 };
  return { ran: true, skipped: false, ...lockResult.result };
}
```

- [x] **Step 4: Implement webhook validation and delivery**

Add:

```ts
export type AlertWebhookPayload = {
  alertEventId: string;
  ruleId: string;
  ruleName: string;
  ruleType: AlertRuleRecord["type"];
  severity: AlertRuleRecord["severity"];
  projectId: string;
  environmentId: string;
  triggeredAt: string;
  window: { from: string; to: string; minutes: number };
  observedValue: string;
  threshold: string;
  message: string;
  signalhub: { source: "signalhub" };
};

export type DeliveryResult = {
  status: "success" | "failed";
  responseStatus: number | null;
  errorMessage: string | null;
};

export function validateWebhookTarget(rawUrl: string, nodeEnv: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("webhook URL must use http or https");
  }
  const host = url.hostname.toLowerCase();
  const privateHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  if (nodeEnv === "production" && privateHost) {
    throw new Error("private webhook targets are not allowed in production");
  }
  return url;
}

export async function deliverWebhook(input: {
  channel: NotificationChannelRecord;
  payload: AlertWebhookPayload;
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  nodeEnv: string;
}): Promise<DeliveryResult> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) return { status: "failed", responseStatus: null, errorMessage: "fetch is unavailable" };

  const url = validateWebhookTarget(input.channel.url, input.nodeEnv);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (input.channel.secretHeaderName && input.channel.secretHeaderValue) {
    headers[input.channel.secretHeaderName] = input.channel.secretHeaderValue;
  }

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input.payload),
      signal: controller.signal
    });
    if (response.status >= 200 && response.status < 300) {
      return { status: "success", responseStatus: response.status, errorMessage: null };
    }
    return { status: "failed", responseStatus: response.status, errorMessage: `Webhook returned HTTP ${response.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook delivery failed";
    return { status: "failed", responseStatus: null, errorMessage: sanitizePreviewText(message) };
  } finally {
    clearTimeout(timeout);
  }
}
```

- [x] **Step 5: Implement scheduler and wire worker main**

Add `startAlertScheduler` mirroring `startRetentionScheduler`, with no overlapping active run and startup run after one second.

In `apps/worker/src/main.ts`, import alert repository functions and start:

```ts
const stopAlerts = config.alerts.enabled
  ? startAlertScheduler({
      intervalMinutes: config.alerts.intervalMinutes,
      runOnce: () =>
        runAlertEvaluationOnce({
          now: () => new Date(),
          withLock: (run) => withAlertEvaluationLock(db, run),
          listActiveRules: () => listActiveAlertRules(db),
          getNotificationChannel: (id) => getNotificationChannel(db, id),
          evaluateRule: (rule, windowStart, windowEnd) =>
            evaluateAlertRule(db, {
              projectId: rule.projectId,
              environmentId: rule.environmentId,
              type: rule.type,
              windowStart,
              windowEnd
            }),
          recordAlertEvent: (input) => recordAlertEvent(db, input),
          updateRuleEvaluation: (input) => updateAlertRuleEvaluation(db, input),
          deliver: (channel, payload) =>
            deliverWebhook({
              channel,
              payload,
              timeoutMs: config.alerts.webhookTimeoutMs,
              nodeEnv: config.nodeEnv
            }),
          recordDelivery: (input) => recordNotificationDelivery(db, input)
        })
    })
  : async () => {};
```

Add `stopAlerts()` to the shutdown `Promise.allSettled` list.

- [x] **Step 6: Run worker tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/worker test
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add apps/worker/src/alerts.ts apps/worker/src/main.ts apps/worker/test/telemetry-worker.test.ts
git commit -m "feat: add worker alert evaluation"
```

## Task 5: Alert API Routes

**Files:**

- Create: `apps/api/src/routes/alerts.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Create: `apps/api/test/alerts.test.ts`
- Modify: `apps/api/test/e2e.test.ts`

- [x] **Step 1: Add failing API tests**

Create `apps/api/test/alerts.test.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const adminAuth = {
  findSessionUser: async () => ({ id: "usr_admin", email: "admin@example.com", isAdmin: true }),
  login: async () => null,
  logout: async () => {}
};

const userAuth = {
  findSessionUser: async () => ({ id: "usr_member", email: "member@example.com", isAdmin: false }),
  login: async () => null,
  logout: async () => {}
};

describe("alert routes", () => {
  it("requires admin access to create notification channels", async () => {
    app = await buildApp({ readiness: async () => ({ postgres: true, redis: true }), auth: userAuth });
    const response = await app.inject({
      method: "POST",
      url: "/admin/notification-channels",
      payload: { name: "Ops", type: "webhook", url: "https://hooks.example.com/signalhub", enabled: true }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "admin_required" });
  });

  it("redacts webhook secrets in channel responses", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: adminAuth,
      alerts: {
        listNotificationChannels: async () => [],
        createNotificationChannel: async () => ({
          id: "chn_1",
          name: "Ops",
          type: "webhook",
          url: "https://hooks.example.com/signalhub",
          secretHeaderName: "X-SignalHub-Secret",
          secretHeaderValue: "secret",
          hasSecret: true,
          enabled: true,
          createdAt: new Date("2026-05-06T12:00:00.000Z"),
          updatedAt: new Date("2026-05-06T12:00:00.000Z"),
          archivedAt: null
        })
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/notification-channels",
      payload: {
        name: "Ops",
        type: "webhook",
        url: "https://hooks.example.com/signalhub",
        secretHeaderName: "X-SignalHub-Secret",
        secretHeaderValue: "secret",
        enabled: true
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().channel.hasSecret).toBe(true);
    expect(response.json().channel.secretHeaderValue).toBeUndefined();
  });

  it("returns alert history for authenticated users", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      auth: userAuth,
      alerts: {
        listAlertEvents: async () => [
          {
            id: "evt_1",
            ruleId: "rule_1",
            projectId: "prj_1",
            environmentId: "env_1",
            status: "triggered",
            severity: "critical",
            triggeredAt: new Date("2026-05-06T12:00:00.000Z"),
            windowStart: new Date("2026-05-06T11:50:00.000Z"),
            windowEnd: new Date("2026-05-06T12:00:00.000Z"),
            observedValue: "2",
            threshold: "1",
            message: "Critical errors threshold reached",
            metadata: {},
            createdAt: new Date("2026-05-06T12:00:00.000Z"),
            latestDeliveryStatus: "success"
          }
        ]
      }
    });

    const response = await app.inject({ method: "GET", url: "/alerts/events?project_id=prj_1&environment_id=env_1" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({ id: "evt_1", latestDeliveryStatus: "success" });
  });
});
```

- [x] **Step 2: Run API tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/api test -- alerts.test.ts
```

Expected: fail because alert route dependencies and routes do not exist.

- [x] **Step 3: Add alert route dependency types and register routes**

In `apps/api/src/app.ts`, add an optional `alerts` dependency to `buildApp` options and register:

```ts
import { registerAlertRoutes, type AlertRouteDependencies } from "./routes/alerts.js";
import type { AlertAdministrationDependencies } from "./routes/admin.js";

export type BuildAppOptions = {
  // existing options...
  alerts?: AlertRouteDependencies & AlertAdministrationDependencies;
  nodeEnv?: string;
};

registerAdminRoutes(app, {
  auth: options.auth,
  users: options.users,
  adminResources: options.adminResources,
  apiKeyPepper: options.apiKeyPepper,
  hashApiKeySecret: options.hashApiKeySecret,
  alerts: options.alerts,
  nodeEnv: options.nodeEnv
});
registerAlertRoutes(app, { auth: options.auth, alerts: options.alerts });
```

- [x] **Step 4: Implement admin alert endpoints**

In `apps/api/src/routes/admin.ts`, extend `AdminRouteOptions`:

```ts
export type AlertAdministrationDependencies = {
  listNotificationChannels?: () => Promise<NotificationChannelRecord[]>;
  createNotificationChannel?: (input: CreateNotificationChannelInput) => Promise<NotificationChannelRecord>;
  updateNotificationChannel?: (id: string, input: UpdateNotificationChannelInput) => Promise<NotificationChannelRecord | null | undefined>;
  archiveNotificationChannel?: (id: string) => Promise<void>;
  listAlertRules?: (filters: { projectId?: string; environmentId?: string }) => Promise<AlertRuleRecord[]>;
  createAlertRule?: (input: CreateAlertRuleInput) => Promise<AlertRuleRecord>;
  updateAlertRule?: (id: string, input: UpdateAlertRuleInput) => Promise<AlertRuleRecord | null | undefined>;
  archiveAlertRule?: (id: string) => Promise<void>;
};

export type AdminRouteOptions = {
  // existing fields...
  alerts?: AlertAdministrationDependencies;
  nodeEnv?: string;
};
```

Add Zod schemas:

```ts
const notificationChannelSchema = z.object({
  name: z.string().trim().min(1).max(256),
  type: z.literal("webhook"),
  url: z.string().url(),
  secretHeaderName: z.string().trim().regex(/^[A-Za-z0-9-]+$/).min(1).max(128).optional().nullable(),
  secretHeaderValue: z.string().trim().min(1).max(4096).optional().nullable(),
  enabled: z.boolean().default(true)
});

const alertRuleSchema = z.object({
  projectId: z.string().min(1),
  environmentId: z.string().min(1),
  notificationChannelId: z.string().min(1).optional().nullable(),
  name: z.string().trim().min(1).max(256),
  type: z.enum(["critical_errors", "error_count", "trace_p95_latency", "llm_cost"]),
  severity: z.enum(["info", "warning", "critical"]),
  windowMinutes: z.number().int().min(1),
  threshold: z.string().regex(/^\d+(\.\d{1,6})?$/),
  cooldownMinutes: z.number().int().min(1),
  enabled: z.boolean().default(true)
});
```

Add a local webhook URL validator to `apps/api/src/routes/admin.ts`:

```ts
function validateWebhookUrl(rawUrl: string, nodeEnv: string | undefined): boolean {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const privateHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  return nodeEnv === "production" ? !privateHost : true;
}
```

Extend `AdminRouteOptions` with:

```ts
nodeEnv?: string;
```

Before creating or updating a notification channel, return `400 invalid_notification_channel_request` when `validateWebhookUrl(parsed.data.url, options.nodeEnv)` is false.

Add `GET`, `POST`, `PATCH`, and `DELETE` handlers for `/admin/notification-channels` and `/admin/alert-rules`. Return redacted channels with:

```ts
function redactNotificationChannel(channel: NotificationChannelRecord) {
  const { secretHeaderValue: _secretHeaderValue, ...safeChannel } = channel;
  return safeChannel;
}
```

- [x] **Step 5: Implement alert history routes**

Create `apps/api/src/routes/alerts.ts`:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { setCurrentUser } from "../plugins/request-context.js";
import type { AuthDependencies } from "./auth.js";

export type AlertRouteDependencies = {
  listAlertEvents?: (filters: { projectId: string; environmentId: string; limit?: number }) => Promise<unknown[]>;
  getAlertEvent?: (id: string) => Promise<unknown | null | undefined>;
};

const listQuerySchema = z.object({
  project_id: z.string().min(1),
  environment_id: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

async function requireHumanUser(request: FastifyRequest, reply: FastifyReply, auth: AuthDependencies | undefined) {
  const user = await auth?.findSessionUser(request as Parameters<AuthDependencies["findSessionUser"]>[0]);
  if (!user) {
    setCurrentUser(request, null);
    reply.status(401).send({ error: "unauthenticated" });
    return undefined;
  }
  setCurrentUser(request, user);
  return user;
}

export function registerAlertRoutes(app: FastifyInstance, options: { auth?: AuthDependencies; alerts?: AlertRouteDependencies }): void {
  app.get("/alerts/events", async (request, reply) => {
    const user = await requireHumanUser(request, reply, options.auth);
    if (!user) return reply;
    if (!options.alerts?.listAlertEvents) return reply.status(501).send({ error: "alerts_repository_unavailable" });
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_alert_query" });
    try {
      const data = await options.alerts.listAlertEvents({
        projectId: parsed.data.project_id,
        environmentId: parsed.data.environment_id,
        limit: parsed.data.limit
      });
      return reply.send({ data });
    } catch {
      return reply.status(503).send({ error: "alerts_unavailable" });
    }
  });
}
```

Add `GET /alerts/events/:id` with `getAlertEvent`.

- [x] **Step 6: Wire API main**

In `apps/api/src/main.ts`, import alert repository functions and pass them to `buildApp`:

```ts
nodeEnv: config.nodeEnv,
alerts: {
  listNotificationChannels: () => listNotificationChannels(db),
  createNotificationChannel: (input) => createNotificationChannel(db, input),
  updateNotificationChannel: (id, input) => updateNotificationChannel(db, id, input),
  archiveNotificationChannel: (id) => archiveNotificationChannel(db, id),
  listAlertRules: (filters) => listAlertRules(db, filters),
  createAlertRule: (input) => createAlertRule(db, input),
  updateAlertRule: (id, input) => updateAlertRule(db, id, input),
  archiveAlertRule: (id) => archiveAlertRule(db, id),
  listAlertEvents: (filters) => listAlertEvents(db, filters),
  getAlertEvent: (id) => getAlertEvent(db, id)
}
```

Update any `buildApp` calls in `apps/api/test/e2e.test.ts` by leaving `alerts` and `nodeEnv` omitted. Both options must remain optional so existing e2e tests compile without extra setup.

- [x] **Step 7: Run API tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/api test -- alerts.test.ts
pnpm --filter @signal-hub/api test
```

Expected: pass.

- [x] **Step 8: Commit**

```bash
git add apps/api/src/routes/alerts.ts apps/api/src/routes/admin.ts apps/api/src/app.ts apps/api/src/main.ts apps/api/test/alerts.test.ts apps/api/test/e2e.test.ts
git commit -m "feat: add alert api routes"
```

## Task 6: Console Alert Client

**Files:**

- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Modify: `apps/console/src/api/client.test.ts`

- [x] **Step 1: Add failing client tests**

Add to `apps/console/src/api/client.test.ts`:

```ts
it("fetches alert events", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
  const client = createApiClient({ apiBasePath: "/api", fetchImpl });

  await client.listAlertEvents({ projectId: "prj_1", environmentId: "env_1" });

  expect(fetchImpl).toHaveBeenCalledWith("/api/alerts/events?project_id=prj_1&environment_id=env_1", expect.anything());
});

it("creates notification channels without reading back secrets", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ channel: { id: "chn_1", hasSecret: true } }));
  const client = createApiClient({ apiBasePath: "/api", fetchImpl });

  const result = await client.createNotificationChannel({
    name: "Ops",
    type: "webhook",
    url: "https://hooks.example.com/signalhub",
    secretHeaderName: "X-SignalHub-Secret",
    secretHeaderValue: "secret",
    enabled: true
  });

  expect(result.channel.hasSecret).toBe(true);
  expect(fetchImpl).toHaveBeenCalledWith("/api/admin/notification-channels", expect.objectContaining({ method: "POST" }));
});
```

- [x] **Step 2: Run console client tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/console test -- client.test.ts
```

Expected: fail because alert client methods do not exist.

- [x] **Step 3: Add console alert types**

In `apps/console/src/api/types.ts`, add:

```ts
export type AlertRuleType = "critical_errors" | "error_count" | "trace_p95_latency" | "llm_cost";
export type AlertSeverity = "info" | "warning" | "critical";

export type NotificationChannelResponse = {
  id: string;
  name: string;
  type: "webhook";
  url: string;
  secretHeaderName: string | null;
  hasSecret: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type AlertRuleResponse = {
  id: string;
  projectId: string;
  environmentId: string;
  notificationChannelId: string | null;
  name: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  windowMinutes: number;
  threshold: string;
  cooldownMinutes: number;
  enabled: boolean;
  lastEvaluatedAt: string | null;
  lastTriggeredAt: string | null;
};

export type AlertEventResponse = {
  id: string;
  ruleId: string;
  projectId: string;
  environmentId: string;
  status: "triggered";
  severity: AlertSeverity;
  triggeredAt: string;
  windowStart: string;
  windowEnd: string;
  observedValue: string;
  threshold: string;
  message: string;
  latestDeliveryStatus: "success" | "failed" | null;
};
```

- [x] **Step 4: Add API client methods**

In `apps/console/src/api/client.ts`, add methods to `ApiClient` and implementation:

```ts
listNotificationChannels: () => request<{ channels: NotificationChannelResponse[] }>(path(apiBasePath, "/admin/notification-channels")),
createNotificationChannel: (input) =>
  request<{ channel: NotificationChannelResponse }>(path(apiBasePath, "/admin/notification-channels"), {
    method: "POST",
    body: JSON.stringify(input)
  }),
listAlertRules: (filters) =>
  request<{ rules: AlertRuleResponse[] }>(
    `${path(apiBasePath, "/admin/alert-rules")}?project_id=${encodeURIComponent(filters.projectId)}&environment_id=${encodeURIComponent(filters.environmentId)}`
  ),
createAlertRule: (input) =>
  request<{ rule: AlertRuleResponse }>(path(apiBasePath, "/admin/alert-rules"), {
    method: "POST",
    body: JSON.stringify(input)
  }),
listAlertEvents: (filters) =>
  request<{ data: AlertEventResponse[] }>(
    `${path(apiBasePath, "/alerts/events")}?project_id=${encodeURIComponent(filters.projectId)}&environment_id=${encodeURIComponent(filters.environmentId)}`
  )
```

Also add update/archive methods if the UI in Task 7 uses edit/delete toggles.

- [x] **Step 5: Run console client tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/console test -- client.test.ts
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts
git commit -m "feat: add alert console client"
```

## Task 7: Console Alerts Panel

**Files:**

- Create: `apps/console/src/components/AlertsPanel.tsx`
- Create: `apps/console/src/components/AlertsPanel.test.tsx`
- Modify: `apps/console/src/components/ConsoleModeTabs.tsx`
- Modify: `apps/console/src/components/ConsoleModeTabs.test.tsx`
- Modify: `apps/console/src/components/ConsoleShell.tsx`
- Modify: `apps/console/src/components/ConsoleShell.test.tsx`
- Modify: `apps/console/src/styles.css`

- [x] **Step 1: Add failing panel and navigation tests**

Create `apps/console/src/components/AlertsPanel.test.tsx`:

```tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { AlertsPanel } from "./AlertsPanel";

afterEach(() => cleanup());

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listAlertRules: vi.fn().mockResolvedValue({ rules: [] }),
    listNotificationChannels: vi.fn().mockResolvedValue({ channels: [] }),
    listAlertEvents: vi.fn().mockResolvedValue({ data: [] }),
    createAlertRule: vi.fn().mockResolvedValue({ rule: { id: "rule_1" } }),
    createNotificationChannel: vi.fn().mockResolvedValue({ channel: { id: "chn_1", hasSecret: true } }),
    ...overrides
  } as ApiClient;
}

describe("AlertsPanel", () => {
  it("renders alert rules channels and recent history", async () => {
    const api = client({
      listAlertRules: vi.fn().mockResolvedValue({
        rules: [
          {
            id: "rule_1",
            projectId: "prj_1",
            environmentId: "env_1",
            notificationChannelId: "chn_1",
            name: "Critical errors",
            type: "critical_errors",
            severity: "critical",
            windowMinutes: 10,
            threshold: "1",
            cooldownMinutes: 30,
            enabled: true,
            lastEvaluatedAt: null,
            lastTriggeredAt: "2026-05-06T12:00:00.000Z"
          }
        ]
      }),
      listNotificationChannels: vi.fn().mockResolvedValue({
        channels: [{ id: "chn_1", name: "Ops", type: "webhook", url: "https://hooks.example.com", secretHeaderName: null, hasSecret: false, enabled: true }]
      }),
      listAlertEvents: vi.fn().mockResolvedValue({
        data: [{ id: "evt_1", ruleId: "rule_1", severity: "critical", message: "Critical errors threshold reached", observedValue: "2", threshold: "1", latestDeliveryStatus: "success", triggeredAt: "2026-05-06T12:00:00.000Z" }]
      })
    });

    render(<AlertsPanel client={api} projectId="prj_1" environmentId="env_1" />);

    expect(await screen.findByRole("heading", { name: "Alerts" })).toBeInTheDocument();
    expect(screen.getByText("Critical errors")).toBeInTheDocument();
    expect(screen.getByText("Ops")).toBeInTheDocument();
    expect(screen.getByText("Critical errors threshold reached")).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
  });

  it("creates a webhook channel without displaying the saved secret", async () => {
    const createNotificationChannel = vi.fn().mockResolvedValue({
      channel: { id: "chn_1", name: "Ops", type: "webhook", url: "https://hooks.example.com", secretHeaderName: "X-SignalHub-Secret", hasSecret: true, enabled: true }
    });
    render(<AlertsPanel client={client({ createNotificationChannel })} projectId="prj_1" environmentId="env_1" />);

    await userEvent.type(await screen.findByLabelText("Channel name"), "Ops");
    await userEvent.type(screen.getByLabelText("Webhook URL"), "https://hooks.example.com");
    await userEvent.type(screen.getByLabelText("Secret header name"), "X-SignalHub-Secret");
    await userEvent.type(screen.getByLabelText("Secret header value"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Create channel" }));

    await waitFor(() => expect(createNotificationChannel).toHaveBeenCalled());
    expect(screen.queryByDisplayValue("secret")).not.toBeInTheDocument();
  });
});
```

Update `ConsoleModeTabs.test.tsx` to expect an `Alerts` tab and `ConsoleShell.test.tsx` to load the Alerts panel.

- [x] **Step 2: Run console tests and verify failure**

Run:

```bash
pnpm --filter @signal-hub/console test -- AlertsPanel.test.tsx ConsoleModeTabs.test.tsx ConsoleShell.test.tsx
```

Expected: fail because `AlertsPanel` and `alerts` mode do not exist.

- [x] **Step 3: Implement `AlertsPanel`**

Create `apps/console/src/components/AlertsPanel.tsx` with:

```tsx
import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { AlertEventResponse, AlertRuleResponse, NotificationChannelResponse } from "../api/types";

type AlertsPanelProps = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
};

export function AlertsPanel({ client, projectId, environmentId }: AlertsPanelProps) {
  const [rules, setRules] = useState<AlertRuleResponse[]>([]);
  const [channels, setChannels] = useState<NotificationChannelResponse[]>([]);
  const [events, setEvents] = useState<AlertEventResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId || !environmentId) return;
    let stale = false;
    setLoading(true);
    setError(null);
    Promise.all([
      client.listAlertRules({ projectId, environmentId }),
      client.listNotificationChannels(),
      client.listAlertEvents({ projectId, environmentId })
    ])
      .then(([ruleResult, channelResult, eventResult]) => {
        if (stale) return;
        setRules(ruleResult.rules);
        setChannels(channelResult.channels);
        setEvents(eventResult.data);
      })
      .catch(() => {
        if (!stale) setError("Alerts unavailable");
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [client, projectId, environmentId]);

  if (!projectId || !environmentId) {
    return <section className="alerts-panel"><h2>Alerts</h2><p>Select a project and environment.</p></section>;
  }

  if (loading) return <section className="alerts-panel" role="status">Loading alerts</section>;
  if (error) return <section className="alerts-panel" role="alert">{error}</section>;

  return (
    <section className="alerts-panel">
      <header className="panel-header">
        <h2>Alerts</h2>
      </header>
      <div className="alerts-grid">
        <article className="alerts-card">
          <h3>Rules</h3>
          {rules.length === 0 ? <p>No alert rules</p> : rules.map((rule) => <div key={rule.id}>{rule.name}</div>)}
        </article>
        <article className="alerts-card">
          <h3>Channels</h3>
          {channels.length === 0 ? <p>No channels</p> : channels.map((channel) => <div key={channel.id}>{channel.name}</div>)}
        </article>
        <article className="alerts-card">
          <h3>Recent alerts</h3>
          {events.length === 0 ? <p>No alert events</p> : events.map((event) => <div key={event.id}>{event.message}</div>)}
        </article>
      </div>
    </section>
  );
}
```

Then add compact create forms for rules and channels, using existing form/input styles from setup components. Keep secret values write-only by clearing the field after create success.

- [x] **Step 4: Add Alerts mode**

Update `apps/console/src/components/ConsoleModeTabs.tsx`:

```ts
export type ConsoleMode = "setup" | "overview" | "investigate" | "alerts" | "system";
```

Add the button:

```tsx
<button type="button" className={mode === "alerts" ? "active" : ""} onClick={() => onModeChange("alerts")}>
  Alerts
</button>
```

Update `ConsoleShell.tsx` to render:

```tsx
{mode === "alerts" ? <AlertsPanel client={client} projectId={activeProject?.id} environmentId={activeEnvironment?.id} /> : null}
```

- [x] **Step 5: Add CSS**

In `apps/console/src/styles.css`, add:

```css
.alerts-panel {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.alerts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1rem;
  min-width: 0;
}

.alerts-card {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1rem;
  background: var(--panel-background);
  min-width: 0;
}

.alerts-form {
  display: grid;
  gap: 0.75rem;
}

.alerts-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-width: 0;
}
```

Use existing status pill classes if available; otherwise add a focused `.status-pill` variant that matches the System panel.

- [x] **Step 6: Run console tests and verify pass**

Run:

```bash
pnpm --filter @signal-hub/console test -- AlertsPanel.test.tsx ConsoleModeTabs.test.tsx ConsoleShell.test.tsx
```

Expected: pass.

- [x] **Step 7: Commit**

```bash
git add apps/console/src/components/AlertsPanel.tsx apps/console/src/components/AlertsPanel.test.tsx apps/console/src/components/ConsoleModeTabs.tsx apps/console/src/components/ConsoleModeTabs.test.tsx apps/console/src/components/ConsoleShell.tsx apps/console/src/components/ConsoleShell.test.tsx apps/console/src/styles.css
git commit -m "feat: add alerts console panel"
```

## Task 8: Documentation

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/DEPLOYMENT.md`
- Modify: `.claude/docs/SECRETS.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`

- [x] **Step 1: Update `.env.example`**

Add:

```txt
ALERTS_ENABLED=true
ALERTS_INTERVAL_MINUTES=1
ALERTS_WEBHOOK_TIMEOUT_MS=5000
```

- [x] **Step 2: Update README**

Add a short section:

```md
## Simple Alerts

SignalHub can evaluate simple project/environment-scoped alert rules from the worker process. The first alert slice supports critical error count, total error count, trace p95 latency, and LLM cost thresholds over rolling windows.

Alert events are stored internally. Optional webhook channels send compact JSON payloads and record each delivery attempt. Native email, Telegram, Discord, escalation, silencing, and acknowledgement workflows are not part of this slice.

Webhook secrets are write-only. Saved secret values are never returned by the API or displayed in the console.
```

- [x] **Step 3: Update project docs**

Add concise entries:

- `.claude/docs/ARCHITECTURE.md`: worker alert evaluator, alert tables, and API/console surfaces.
- `.claude/docs/DEPLOYMENT.md`: `ALERTS_*` environment variables and worker-owned scheduling.
- `.claude/docs/SECRETS.md`: webhook secret header value is write-only and redacted.
- `.claude/docs/UI-UX.md`: `Alerts` console mode and operational compact layout.
- `.claude/docs/PROJECT-SUMMARY.md`: add Phase 4B simple alerts to implemented capabilities after implementation.

- [x] **Step 4: Commit**

```bash
git add .env.example README.md .claude/docs/ARCHITECTURE.md .claude/docs/DEPLOYMENT.md .claude/docs/SECRETS.md .claude/docs/UI-UX.md .claude/docs/PROJECT-SUMMARY.md
git commit -m "docs: document simple alerts"
```

## Task 9: Final Verification and Visual Check

**Files:**

- Potentially modify exact files responsible for any defect found during verification.

- [x] **Step 1: Run full tests**

Run:

```bash
pnpm test
```

Expected: all tests pass.

- [x] **Step 2: Run production build**

Run:

```bash
pnpm build
```

Expected: all workspace builds pass.

- [x] **Step 3: Validate Compose**

Run:

```bash
docker compose config --quiet
```

Expected: exits 0.

- [x] **Step 4: Browser visual check**

Run the console dev server:

```bash
pnpm dev:console
```

Use browser automation with mocked console config, auth, projects, environments, alert rules, notification channels, and alert events.

Verify at `1440x1000` and `390x900`:

- Alerts tab is visible.
- Rules, channels, and recent alert history render.
- Empty states render.
- Delivery success and failure states render.
- Webhook secret field does not retain a saved value after create.
- There is no horizontal page overflow.

- [x] **Step 5: Commit verification fixes if needed**

If verification fixes are needed:

```bash
git add <fixed-files>
git commit -m "fix: polish simple alerts verification"
```

If no fixes are needed, do not create an empty commit.
