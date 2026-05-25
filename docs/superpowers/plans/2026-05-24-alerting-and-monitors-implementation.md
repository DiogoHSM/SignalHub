# Alerting And Monitors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SMTP email channels, HTTP uptime monitors, heartbeat monitors, error-rate alerts, and route/name-scoped trace p95 alerts.

**Architecture:** Extend the existing alerting system instead of creating a second notification stack. Postgres stores monitor definitions, check history, heartbeat state, expanded alert rule parameters, and email channel recipients; the worker evaluates alert rules and monitors under advisory locks; the API exposes admin CRUD and heartbeat ingestion; the console manages the new channels, rules, monitors, and history in the existing Alerts/System workspace.

**Tech Stack:** TypeScript, Fastify, Kysely/Postgres migrations, BullMQ worker process, Node HTTP/HTTPS APIs, Nodemailer SMTP transport, React console, Vitest/Testcontainers.

---

## File Map

- Create `packages/db/migrations/0012_alerting_monitors.sql`: channel/rule schema changes plus monitor tables.
- Modify `packages/db/src/schema.ts`: TypeScript table definitions for email channels, rule scope fields, monitor tables.
- Modify `packages/db/src/repositories/alerts.ts`: email channel persistence, scoped rule fields, error-rate and scoped p95 evaluation.
- Create `packages/db/src/repositories/monitors.ts`: HTTP monitor and heartbeat monitor CRUD, state, check history, stale evaluation.
- Modify `packages/db/test/repositories.test.ts`: migration smoke, repository tests, alert rule evaluation tests, monitor tests.
- Modify `packages/config/src/index.ts` and `packages/config/test/config.test.ts`: SMTP config parsing and validation.
- Modify `.env.example` and `.claude/docs/SECRETS.md`: SMTP and monitor scheduler settings.
- Modify `apps/worker/src/alerts.ts`: dispatch webhook and email deliveries from the same alert event path.
- Create `apps/worker/src/email.ts`: SMTP delivery wrapper and redacted error handling.
- Create `apps/worker/src/monitors.ts`: scheduler evaluation for HTTP uptime and heartbeat monitors.
- Modify `apps/worker/src/main.ts`: wire monitor scheduler and email delivery config.
- Modify `apps/worker/test/telemetry-worker.test.ts`: alert/email delivery and scheduler tests.
- Modify `apps/api/src/routes/admin.ts`: email channel validation, alert rule fields, monitor CRUD.
- Modify `apps/api/src/routes/alerts.ts`: monitor/check history read routes if not better housed in a new route module.
- Create `apps/api/src/routes/monitors.ts`: heartbeat ingestion endpoint and optional monitor history routes if route size needs isolation.
- Modify `apps/api/src/main.ts`: register monitor routes and dependencies.
- Modify `apps/api/src/openapi.ts` and `apps/api/test/docs.test.ts`: document new admin/heartbeat/monitor endpoints.
- Modify `apps/api/test/alerts.test.ts` and `apps/api/test/admin.test.ts`: channel/rule API tests.
- Create `apps/api/test/monitors.test.ts`: monitor CRUD and heartbeat ingestion tests.
- Modify `apps/console/src/api/types.ts`: channel/rule/monitor/check types.
- Modify `apps/console/src/api/client.ts` and `apps/console/src/api/client.test.ts`: API client methods and encoding tests.
- Modify `apps/console/src/components/AlertsPanel.tsx` and `apps/console/src/components/AlertsPanel.test.tsx`: UI for email channels, rule scoping, uptime monitors, heartbeat monitors.
- Modify `apps/console/src/components/SystemHealthPanel.tsx` and tests if monitor summary is added to `/system/health`.
- Modify `README.md`, `.claude/docs/ARCHITECTURE.md`, `.claude/docs/DEPLOYMENT.md`, `.claude/docs/STACK.md`, `.claude/docs/UI-UX.md`, `.claude/docs/INFRASTRUCTURE.md`: operator docs.

## Task 1: Database Schema And Monitor Repository

**Files:**
- Create: `packages/db/migrations/0012_alerting_monitors.sql`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/repositories/monitors.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Write failing migration and repository tests**

Add tests near the existing operational table smoke tests and alert repository tests:

```ts
it("has monitor and expanded alerting tables available", async () => {
  await sql`select type, email_recipients from notification_channels limit 0`.execute(db);
  await sql`select route_pattern, minimum_sample_size from alert_rules limit 0`.execute(db);
  await sql`select id, kind, status from monitors limit 0`.execute(db);
  await sql`select monitor_id, status, latency_ms from monitor_checks limit 0`.execute(db);
});

it("creates and lists HTTP uptime monitors by project environment", async () => {
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

it("records heartbeat check-ins and finds stale heartbeat monitors", async () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk proxy pnpm vitest run packages/db/test/repositories.test.ts -t "monitor|expanded alerting|heartbeat"
```

Expected: FAIL because `monitors`/`monitor_checks` tables and repository functions do not exist.

- [ ] **Step 3: Add migration**

Create `packages/db/migrations/0012_alerting_monitors.sql`:

```sql
ALTER TABLE notification_channels DROP CONSTRAINT notification_channels_type_check;
ALTER TABLE notification_channels ALTER COLUMN url DROP NOT NULL;
ALTER TABLE notification_channels ADD COLUMN email_recipients jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE notification_channels
  ADD CONSTRAINT notification_channels_type_check CHECK (type IN ('webhook', 'email'));
ALTER TABLE notification_channels
  ADD CONSTRAINT notification_channels_shape_check CHECK (
    (type = 'webhook' AND url IS NOT NULL AND jsonb_array_length(email_recipients) = 0)
    OR
    (type = 'email' AND url IS NULL AND jsonb_array_length(email_recipients) > 0)
  );

ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_type_check;
ALTER TABLE alert_rules
  ADD CONSTRAINT alert_rules_type_check CHECK (
    type IN ('critical_errors', 'error_count', 'error_rate', 'trace_p95_latency', 'llm_cost')
  );
ALTER TABLE alert_rules ADD COLUMN route_pattern text;
ALTER TABLE alert_rules ADD COLUMN minimum_sample_size integer NOT NULL DEFAULT 1 CHECK (minimum_sample_size > 0);

CREATE TABLE monitors (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES projects(id),
  environment_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('http', 'heartbeat')),
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'up', 'down', 'degraded', 'paused')),
  url text,
  method text CHECK (method IN ('GET', 'HEAD')),
  expected_status text,
  body_contains text,
  timeout_ms integer CHECK (timeout_ms > 0),
  interval_minutes integer CHECK (interval_minutes > 0),
  failure_threshold integer NOT NULL DEFAULT 2 CHECK (failure_threshold > 0),
  recovery_threshold integer NOT NULL DEFAULT 1 CHECK (recovery_threshold > 0),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  consecutive_successes integer NOT NULL DEFAULT 0 CHECK (consecutive_successes >= 0),
  expected_interval_minutes integer CHECK (expected_interval_minutes > 0),
  grace_minutes integer CHECK (grace_minutes >= 0),
  secret_hash text,
  last_checked_at timestamptz,
  last_check_status text CHECK (last_check_status IN ('success', 'failed')),
  last_check_latency_ms integer,
  last_check_response_status integer,
  last_check_error_message text,
  last_heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id),
  CHECK (
    (kind = 'http' AND url IS NOT NULL AND method IS NOT NULL AND expected_status IS NOT NULL
      AND timeout_ms IS NOT NULL AND interval_minutes IS NOT NULL
      AND expected_interval_minutes IS NULL AND grace_minutes IS NULL AND secret_hash IS NULL)
    OR
    (kind = 'heartbeat' AND url IS NULL AND method IS NULL AND expected_status IS NULL
      AND timeout_ms IS NULL AND interval_minutes IS NULL
      AND expected_interval_minutes IS NOT NULL AND grace_minutes IS NOT NULL AND secret_hash IS NOT NULL)
  )
);

CREATE INDEX monitors_scope_idx ON monitors(project_id, environment_id, kind, enabled, archived_at);
CREATE INDEX monitors_due_http_idx ON monitors(last_checked_at, interval_minutes)
  WHERE kind = 'http' AND enabled = true AND archived_at IS NULL;
CREATE INDEX monitors_stale_heartbeat_idx ON monitors(last_heartbeat_at, expected_interval_minutes, grace_minutes)
  WHERE kind = 'heartbeat' AND enabled = true AND archived_at IS NULL;

CREATE TABLE monitor_checks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  monitor_id text NOT NULL REFERENCES monitors(id),
  checked_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  latency_ms integer,
  response_status integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX monitor_checks_monitor_time_idx ON monitor_checks(monitor_id, checked_at DESC);
```

- [ ] **Step 4: Update schema types**

In `packages/db/src/schema.ts`, update:

```ts
export type AlertRuleType = "critical_errors" | "error_count" | "error_rate" | "trace_p95_latency" | "llm_cost";

export interface NotificationChannelsTable {
  id: ColumnType<string, string | undefined, string>;
  name: string;
  type: "webhook" | "email";
  url: string | null;
  email_recipients: JsonColumn;
  secret_header_name: string | null;
  secret_header_value: string | null;
  enabled: DefaultedBoolean;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface AlertRulesTable {
  // existing fields...
  route_pattern: string | null;
  minimum_sample_size: number;
}

export interface MonitorsTable {
  id: ColumnType<string, string | undefined, string>;
  project_id: string;
  environment_id: string;
  kind: "http" | "heartbeat";
  name: string;
  enabled: DefaultedBoolean;
  status: "unknown" | "up" | "down" | "degraded" | "paused";
  url: string | null;
  method: "GET" | "HEAD" | null;
  expected_status: string | null;
  body_contains: string | null;
  timeout_ms: number | null;
  interval_minutes: number | null;
  failure_threshold: number;
  recovery_threshold: number;
  consecutive_failures: number;
  consecutive_successes: number;
  expected_interval_minutes: number | null;
  grace_minutes: number | null;
  secret_hash: string | null;
  last_checked_at: NullableTimestamp;
  last_check_status: "success" | "failed" | null;
  last_check_latency_ms: number | null;
  last_check_response_status: number | null;
  last_check_error_message: string | null;
  last_heartbeat_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface MonitorChecksTable {
  id: ColumnType<string, string | undefined, string>;
  monitor_id: string;
  checked_at: Timestamp;
  status: "success" | "failed";
  latency_ms: number | null;
  response_status: number | null;
  error_message: string | null;
  created_at: Timestamp;
}
```

Add both tables to `Database`.

- [ ] **Step 5: Implement monitor repository**

Create `packages/db/src/repositories/monitors.ts` with exported types and functions:

```ts
export type MonitorKind = "http" | "heartbeat";
export type MonitorStatus = "unknown" | "up" | "down" | "degraded" | "paused";
export type MonitorCheckStatus = "success" | "failed";

export async function createHttpMonitor(db: Db, input: CreateHttpMonitorInput): Promise<MonitorRecord>;
export async function createHeartbeatMonitor(db: Db, input: CreateHeartbeatMonitorInput): Promise<MonitorRecord>;
export async function listMonitors(db: Db, filters: { projectId: string; environmentId: string; kind?: MonitorKind }): Promise<MonitorRecord[]>;
export async function getMonitor(db: Db, id: string): Promise<MonitorRecord | undefined>;
export async function updateMonitor(db: Db, id: string, input: UpdateMonitorInput): Promise<MonitorRecord | null>;
export async function archiveMonitor(db: Db, id: string): Promise<void>;
export async function listDueHttpMonitors(db: Db, input: { now: Date; limit: number }): Promise<MonitorRecord[]>;
export async function recordMonitorCheck(db: Db, input: RecordMonitorCheckInput): Promise<MonitorRecord>;
export async function recordHeartbeatCheckIn(db: Db, input: { monitorId: string; checkedInAt: Date }): Promise<MonitorRecord | null>;
export async function listStaleHeartbeatMonitors(db: Db, input: { now: Date; limit?: number }): Promise<MonitorRecord[]>;
export async function listMonitorChecks(db: Db, input: { monitorId: string; limit?: number }): Promise<MonitorCheckRecord[]>;
```

`recordMonitorCheck` updates state:

- success increments successes, resets failures, sets `up` once `recoveryThreshold` is reached.
- failure increments failures, resets successes, sets `down` once `failureThreshold` is reached.
- before thresholds, keep previous `up/down` or use `degraded`.

- [ ] **Step 6: Run focused DB tests**

Run:

```bash
rtk proxy pnpm vitest run packages/db/test/repositories.test.ts -t "monitor|expanded alerting|heartbeat"
```

Expected: PASS for the new DB tests.

- [ ] **Step 7: Commit**

```bash
git add packages/db/migrations/0012_alerting_monitors.sql packages/db/src/schema.ts packages/db/src/repositories/monitors.ts packages/db/test/repositories.test.ts
git commit -m "feat: add monitor persistence"
```

## Task 2: SMTP Config And Email Channel Persistence

**Files:**
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/test/config.test.ts`
- Modify: `packages/db/src/repositories/alerts.ts`
- Modify: `packages/db/test/repositories.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing config and repository tests**

Add config tests:

```ts
it("loads SMTP config for email alert delivery", () => {
  const config = loadConfig({
    ...baseEnv,
    SMTP_HOST: "smtp.resend.com",
    SMTP_PORT: "587",
    SMTP_USERNAME: "resend",
    SMTP_PASSWORD: "secret-password",
    SMTP_FROM: "Sigmon <alerts@sigmon.app>",
    SMTP_SECURE: "false"
  });

  expect(config.smtp).toEqual({
    enabled: true,
    host: "smtp.resend.com",
    port: 587,
    username: "resend",
    password: "secret-password",
    from: "Sigmon <alerts@sigmon.app>",
    secure: false
  });
});

it("keeps SMTP disabled when host and from are absent", () => {
  expect(loadConfig(baseEnv).smtp.enabled).toBe(false);
});
```

Add repository test:

```ts
it("creates email notification channels with redacted recipients", async () => {
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk proxy pnpm vitest run packages/config/test/config.test.ts packages/db/test/repositories.test.ts -t "SMTP|email notification"
```

Expected: FAIL because `config.smtp` and email channel persistence do not exist.

- [ ] **Step 3: Implement config**

Add optional fields to `rawConfigSchema`:

```ts
SMTP_HOST: optionalEnvString,
SMTP_PORT: optionalPositiveInteger(587),
SMTP_USERNAME: optionalEnvString,
SMTP_PASSWORD: optionalEnvString,
SMTP_FROM: optionalEnvString,
SMTP_SECURE: z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true"),
```

After backup validation, require the complete set when any SMTP field is present:

```ts
const smtpConfigured = Boolean(parsed.SMTP_HOST || parsed.SMTP_USERNAME || parsed.SMTP_PASSWORD || parsed.SMTP_FROM);
if (smtpConfigured) {
  if (!parsed.SMTP_HOST) throw new Error("SMTP_HOST is required when SMTP email is enabled");
  if (!parsed.SMTP_USERNAME) throw new Error("SMTP_USERNAME is required when SMTP email is enabled");
  if (!parsed.SMTP_PASSWORD) throw new Error("SMTP_PASSWORD is required when SMTP email is enabled");
  if (!parsed.SMTP_FROM) throw new Error("SMTP_FROM is required when SMTP email is enabled");
}
```

Return:

```ts
smtp: {
  enabled: smtpConfigured,
  host: parsed.SMTP_HOST ?? "",
  port: parsed.SMTP_PORT,
  username: parsed.SMTP_USERNAME ?? "",
  password: parsed.SMTP_PASSWORD ?? "",
  from: parsed.SMTP_FROM ?? "",
  secure: parsed.SMTP_SECURE
}
```

- [ ] **Step 4: Implement email channel persistence**

Update `NotificationChannelRecord` to a discriminated shape:

```ts
export type NotificationChannelRecord =
  | {
      id: string;
      name: string;
      type: "webhook";
      url: string;
      emailRecipients: [];
      secretHeaderName: string | null;
      secretHeaderValue: string | null;
      hasSecret: boolean;
      enabled: boolean;
      createdAt: Date;
      updatedAt: Date;
      archivedAt: Date | null;
    }
  | {
      id: string;
      name: string;
      type: "email";
      url: null;
      emailRecipients: string[];
      secretHeaderName: null;
      secretHeaderValue: null;
      hasSecret: false;
      enabled: boolean;
      createdAt: Date;
      updatedAt: Date;
      archivedAt: Date | null;
    };
```

Update create/update inputs to accept either webhook fields or email recipients. Validate recipient arrays before insert/update.

- [ ] **Step 5: Update `.env.example`**

Add:

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_SECURE=false
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
rtk proxy pnpm vitest run packages/config/test/config.test.ts packages/db/test/repositories.test.ts -t "SMTP|email notification"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/config/src/index.ts packages/config/test/config.test.ts packages/db/src/repositories/alerts.ts packages/db/test/repositories.test.ts .env.example
git commit -m "feat: add smtp notification channels"
```

## Task 3: Error Rate And Scoped Trace P95 Rules

**Files:**
- Modify: `packages/db/src/repositories/alerts.ts`
- Modify: `packages/db/test/repositories.test.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/test/alerts.test.ts`
- Modify: `apps/console/src/api/types.ts`

- [ ] **Step 1: Write failing alert evaluation tests**

Add repository tests:

```ts
it("evaluates error rate rules with trace denominator and minimum sample size", async () => {
  await insertProjectAndEnvironment(db, "prj_rate", "env_rate");
  await insertTraceRows(db, "prj_rate", "env_rate", 100, { name: "GET /checkout" });
  await insertErrorRows(db, "prj_rate", "env_rate", 5, { fingerprint: "checkout", traceName: "GET /checkout" });

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

it("returns zero error rate when denominator is below minimum sample size", async () => {
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

it("evaluates trace p95 latency scoped by route pattern", async () => {
  await insertProjectAndEnvironment(db, "prj_p95", "env_p95");
  await insertTraceRows(db, "prj_p95", "env_p95", 10, { name: "GET /checkout", durationMs: 100 });
  await insertTraceRows(db, "prj_p95", "env_p95", 10, { name: "GET /settings", durationMs: 2000 });

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk proxy pnpm vitest run packages/db/test/repositories.test.ts -t "error rate|scoped by route"
```

Expected: FAIL because rule inputs and evaluation are not implemented.

- [ ] **Step 3: Extend alert repository types and evaluation**

Add `routePattern?: string | null` and `minimumSampleSize: number` to `AlertRuleRecord`.

Update `evaluateAlertRule` input:

```ts
routePattern?: string | null;
minimumSampleSize?: number;
```

For `trace_p95_latency`, filter with exact `name = routePattern` when present and return `0` when sample size is below `minimumSampleSize`.

For `error_rate`, calculate:

```sql
errors / traces * 100
```

using traces in the same scope/window as denominator. If `routePattern` is set, count only traces with `name = routePattern` and errors whose `trace_id` joins to those traces where possible. If denominator is below `minimumSampleSize`, return `0`.

- [ ] **Step 4: Extend API schema**

In `apps/api/src/routes/admin.ts`, update `alertRuleSchema`:

```ts
type: z.enum(["critical_errors", "error_count", "error_rate", "trace_p95_latency", "llm_cost"]),
routePattern: z.string().trim().min(1).max(256).nullable().optional(),
minimumSampleSize: z.number().int().min(1).default(1),
```

Add API tests that create:

```ts
{
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
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
rtk proxy pnpm vitest run packages/db/test/repositories.test.ts apps/api/test/alerts.test.ts -t "error rate|route pattern|minimum sample"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repositories/alerts.ts packages/db/test/repositories.test.ts apps/api/src/routes/admin.ts apps/api/test/alerts.test.ts apps/console/src/api/types.ts
git commit -m "feat: add scoped alert thresholds"
```

## Task 4: Email Delivery In Worker

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/worker/src/email.ts`
- Modify: `apps/worker/src/alerts.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/test/telemetry-worker.test.ts`

- [ ] **Step 1: Add dependency**

Run:

```bash
pnpm add nodemailer
pnpm add -D @types/nodemailer
```

- [ ] **Step 2: Write failing delivery tests**

Add tests:

```ts
it("delivers email notification channels through SMTP", async () => {
  const sendMail = vi.fn().mockResolvedValue({ messageId: "msg_1" });
  const result = await deliverEmail({
    channel: {
      id: "chn_email",
      name: "Ops email",
      type: "email",
      url: null,
      emailRecipients: ["diogo@example.com"],
      secretHeaderName: null,
      secretHeaderValue: null,
      hasSecret: false,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null
    },
    smtp: {
      enabled: true,
      host: "smtp.example.com",
      port: 587,
      username: "user",
      password: "password",
      from: "Sigmon <alerts@example.com>",
      secure: false
    },
    payload: alertPayload(),
    transportFactory: () => ({ sendMail } as never)
  });

  expect(result).toEqual({ status: "success", responseStatus: null, errorMessage: null });
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
    from: "Sigmon <alerts@example.com>",
    to: ["diogo@example.com"],
    subject: expect.stringContaining("Sigmon")
  }));
});

it("records failed email delivery when SMTP is not configured", async () => {
  const result = await deliverEmail({
    channel: emailChannel(),
    smtp: { enabled: false, host: "", port: 587, username: "", password: "", from: "", secure: false },
    payload: alertPayload()
  });

  expect(result).toEqual({ status: "failed", responseStatus: null, errorMessage: "SMTP is not configured" });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
rtk proxy pnpm vitest run apps/worker/test/telemetry-worker.test.ts -t "email"
```

Expected: FAIL because `deliverEmail` does not exist.

- [ ] **Step 4: Implement `apps/worker/src/email.ts`**

Implement:

```ts
export async function deliverEmail(input: {
  channel: Extract<NotificationChannelRecord, { type: "email" }>;
  smtp: AppConfig["smtp"];
  payload: AlertWebhookPayload;
  transportFactory?: typeof createTransport;
}): Promise<DeliveryResult>;
```

Rules:

- fail with `"SMTP is not configured"` when disabled.
- use recipients from channel.
- subject: `[Sigmon] ${payload.severity}: ${payload.ruleName}`.
- text body includes rule, project/environment, observed/threshold, window, message.
- do not include SMTP password in thrown or returned error.
- cap returned `errorMessage` with existing `sanitizeMessage`.

- [ ] **Step 5: Dispatch by channel type**

In `apps/worker/src/alerts.ts`, change `deliver` runtime to accept all notification channel types and dispatch:

```ts
if (channel.type === "webhook") return deliverWebhook(...);
return deliverEmail(...);
```

Keep webhook behavior unchanged.

- [ ] **Step 6: Wire SMTP config in main**

In `apps/worker/src/main.ts`, pass `config.smtp` into alert delivery.

- [ ] **Step 7: Run focused tests**

Run:

```bash
rtk proxy pnpm vitest run apps/worker/test/telemetry-worker.test.ts -t "email|webhook delivery"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml apps/worker/src/email.ts apps/worker/src/alerts.ts apps/worker/src/main.ts apps/worker/test/telemetry-worker.test.ts
git commit -m "feat: deliver alert emails over smtp"
```

## Task 5: HTTP And Heartbeat Monitor Worker

**Files:**
- Create: `apps/worker/src/monitors.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/test/telemetry-worker.test.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/test/config.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Add tests:

```ts
it("runs due HTTP monitors and records successful checks", async () => {
  const monitor = httpMonitor({ id: "mon_1", url: "https://microerp.example.com/health" });
  const recordMonitorCheck = vi.fn().mockResolvedValue({ ...monitor, status: "up" });

  const result = await runMonitorEvaluationOnce({
    now: () => new Date("2026-05-24T12:00:00.000Z"),
    withLock: async (run) => ({ locked: true, result: await run() }),
    listDueHttpMonitors: async () => [monitor],
    listStaleHeartbeatMonitors: async () => [],
    checkHttpMonitor: async () => ({ status: "success", latencyMs: 42, responseStatus: 200, errorMessage: null }),
    recordMonitorCheck,
    recordAlertEvent: vi.fn(),
    getNotificationChannel: vi.fn(),
    deliver: vi.fn(),
    recordDelivery: vi.fn()
  });

  expect(result).toEqual({ ran: true, skipped: false, checked: 1, staleHeartbeats: 0, triggered: 0 });
  expect(recordMonitorCheck).toHaveBeenCalledWith(expect.objectContaining({ monitorId: "mon_1", status: "success" }));
});

it("creates alert events when heartbeat monitors are stale", async () => {
  const heartbeat = heartbeatMonitor({ id: "mon_queue", notificationChannelId: "chn_email" });
  const recordAlertEvent = vi.fn().mockResolvedValue({ id: "evt_heartbeat" });

  const result = await runMonitorEvaluationOnce({
    now: () => new Date("2026-05-24T12:07:00.000Z"),
    withLock: async (run) => ({ locked: true, result: await run() }),
    listDueHttpMonitors: async () => [],
    listStaleHeartbeatMonitors: async () => [heartbeat],
    checkHttpMonitor: vi.fn(),
    recordMonitorCheck: vi.fn(),
    recordAlertEvent,
    getNotificationChannel: vi.fn().mockResolvedValue(null),
    deliver: vi.fn(),
    recordDelivery: vi.fn()
  });

  expect(result.staleHeartbeats).toBe(1);
  expect(recordAlertEvent).toHaveBeenCalledWith(expect.objectContaining({
    message: expect.stringContaining("stale")
  }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk proxy pnpm vitest run apps/worker/test/telemetry-worker.test.ts -t "HTTP monitors|heartbeat monitors|monitor evaluation"
```

Expected: FAIL because monitor worker functions do not exist.

- [ ] **Step 3: Add config**

Add config:

```ts
MONITORS_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
MONITORS_INTERVAL_MINUTES: optionalPositiveInteger(1),
MONITORS_HTTP_TIMEOUT_MS: optionalPositiveInteger(5000),
MONITORS_MAX_CONCURRENCY: optionalPositiveInteger(5),
```

Return `config.monitors`.

- [ ] **Step 4: Implement HTTP monitor checker**

In `apps/worker/src/monitors.ts`, implement:

```ts
export async function checkHttpMonitor(input: {
  monitor: HttpMonitorRecord;
  timeoutMs: number;
  requestImpl?: MonitorRequest;
  resolveHostname?: ResolveHostname;
  requestLookup?: LookupFunction;
}): Promise<{ status: "success" | "failed"; latencyMs: number | null; responseStatus: number | null; errorMessage: string | null }>;
```

Use the same safety pattern as `deliverWebhook`:

- validate URL.
- resolve hostname when needed.
- reject unsafe resolved addresses.
- do not send credentials.
- no arbitrary methods beyond `GET`/`HEAD`.
- cap body reads before applying `bodyContains`.

- [ ] **Step 5: Implement scheduler**

Implement:

```ts
export async function runMonitorEvaluationOnce(runtime: MonitorEvaluationRuntime): Promise<{
  ran: boolean;
  skipped: boolean;
  checked: number;
  staleHeartbeats: number;
  triggered: number;
}>;

export function startMonitorScheduler(input: {
  intervalMinutes: number;
  runOnce: () => Promise<unknown>;
  setIntervalImpl?: typeof setInterval;
  setTimeoutImpl?: typeof setTimeout;
  clearIntervalImpl?: typeof clearInterval;
  clearTimeoutImpl?: typeof clearTimeout;
}): () => Promise<void>;
```

Use an advisory lock in the DB repository layer, matching retention/alert scheduler patterns.

- [ ] **Step 6: Wire main**

In `apps/worker/src/main.ts`, import monitor repository functions and start monitor scheduler when `config.monitors.enabled`.

- [ ] **Step 7: Run focused tests**

Run:

```bash
rtk proxy pnpm vitest run apps/worker/test/telemetry-worker.test.ts packages/config/test/config.test.ts -t "monitor"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/monitors.ts apps/worker/src/main.ts apps/worker/test/telemetry-worker.test.ts packages/config/src/index.ts packages/config/test/config.test.ts
git commit -m "feat: evaluate uptime and heartbeat monitors"
```

## Task 6: Admin Monitor API And Heartbeat Ingestion

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Create: `apps/api/src/routes/monitors.ts`
- Modify: `apps/api/src/main.ts`
- Create: `apps/api/test/monitors.test.ts`
- Modify: `apps/api/test/alerts.test.ts`
- Modify: `apps/api/src/openapi.ts`
- Modify: `apps/api/test/docs.test.ts`

- [ ] **Step 1: Write failing API tests**

Create `apps/api/test/monitors.test.ts`:

```ts
it("creates HTTP monitors for admins", async () => {
  const createHttpMonitor = vi.fn().mockResolvedValue(httpMonitor({ id: "mon_1" }));
  const app = await buildTestApp({
    auth: adminAuth(),
    monitors: { createHttpMonitor }
  });

  const response = await app.inject({
    method: "POST",
    url: "/admin/monitors/http",
    payload: {
      projectId: "prj_1",
      environmentId: "env_1",
      name: "MicroERP",
      url: "https://microerp.example.com/health",
      method: "GET",
      expectedStatus: "2xx",
      intervalMinutes: 5,
      timeoutMs: 3000,
      failureThreshold: 2,
      recoveryThreshold: 1,
      enabled: true
    }
  });

  expect(response.statusCode).toBe(201);
  expect(createHttpMonitor).toHaveBeenCalledWith(expect.objectContaining({ name: "MicroERP" }));
});

it("records heartbeat check-ins with bearer secret", async () => {
  const recordHeartbeat = vi.fn().mockResolvedValue(heartbeatMonitor({ id: "mon_queue" }));
  const app = await buildTestApp({
    monitors: {
      verifyHeartbeatSecret: async () => true,
      recordHeartbeatCheckIn: recordHeartbeat
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/heartbeats/mon_queue",
    headers: { authorization: "Bearer heartbeat-secret" }
  });

  expect(response.statusCode).toBe(202);
  expect(recordHeartbeat).toHaveBeenCalledWith(expect.objectContaining({ monitorId: "mon_queue" }));
});

it("rejects heartbeat check-ins with invalid secrets", async () => {
  const app = await buildTestApp({
    monitors: {
      verifyHeartbeatSecret: async () => false,
      recordHeartbeatCheckIn: vi.fn()
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/heartbeats/mon_queue",
    headers: { authorization: "Bearer wrong" }
  });

  expect(response.statusCode).toBe(401);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk proxy pnpm vitest run apps/api/test/monitors.test.ts
```

Expected: FAIL because monitor routes are not registered.

- [ ] **Step 3: Implement admin routes**

Add admin endpoints:

- `GET /admin/monitors?project_id=&environment_id=&kind=`
- `POST /admin/monitors/http`
- `POST /admin/monitors/heartbeat`
- `PATCH /admin/monitors/:id`
- `DELETE /admin/monitors/:id`
- `GET /admin/monitors/:id/checks?limit=`

Validate HTTP monitor URLs using `validateWebhookTargetUrl` at create/update time.

Generate heartbeat secret once on create. Store only `secretHash`, return the plain secret only in the create response.

- [ ] **Step 4: Implement heartbeat route**

Create `apps/api/src/routes/monitors.ts` with:

- `POST /v1/heartbeats/:id`

Read `Authorization: Bearer <secret>`, verify hash through repository dependency, record check-in, return `202`.

- [ ] **Step 5: Wire dependencies in main**

In `apps/api/src/main.ts`, pass repository functions from `@sigmon/db/repositories/monitors.js`.

- [ ] **Step 6: Update OpenAPI docs**

Add public docs for:

- monitor admin CRUD, protected by session cookie.
- heartbeat ingestion, protected by bearer heartbeat secret.

- [ ] **Step 7: Run focused API tests**

Run:

```bash
rtk proxy pnpm vitest run apps/api/test/monitors.test.ts apps/api/test/alerts.test.ts apps/api/test/docs.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/monitors.ts apps/api/src/main.ts apps/api/test/monitors.test.ts apps/api/test/alerts.test.ts apps/api/src/openapi.ts apps/api/test/docs.test.ts
git commit -m "feat: add monitor management api"
```

## Task 7: Console API Client And Alerts UI

**Files:**
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Modify: `apps/console/src/api/client.test.ts`
- Modify: `apps/console/src/components/AlertsPanel.tsx`
- Modify: `apps/console/src/components/AlertsPanel.test.tsx`
- Modify: `apps/console/src/styles.css`

- [ ] **Step 1: Write failing client tests**

Add tests:

```ts
it("creates email notification channels", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { channel: { id: "chn_email", type: "email" } }));
  await createApiClient("/api", fetchMock).createNotificationChannel({
    name: "Ops email",
    type: "email",
    emailRecipients: ["diogo@example.com"],
    enabled: true
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/notification-channels",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "Ops email",
        type: "email",
        emailRecipients: ["diogo@example.com"],
        enabled: true
      })
    })
  );
});

it("creates HTTP monitors and heartbeat monitors", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(201, { monitor: { id: "mon_http" } }))
    .mockResolvedValueOnce(jsonResponse(201, { monitor: { id: "mon_hb" }, secret: "heartbeat-secret" }));
  const client = createApiClient("/api", fetchMock);

  await client.createHttpMonitor({ projectId: "prj", environmentId: "env", name: "App", url: "https://app.example.com", method: "GET", expectedStatus: "2xx", intervalMinutes: 5, timeoutMs: 3000, failureThreshold: 2, recoveryThreshold: 1, enabled: true });
  await client.createHeartbeatMonitor({ projectId: "prj", environmentId: "env", name: "Queue", expectedIntervalMinutes: 5, graceMinutes: 1, enabled: true });

  expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/admin/monitors/http", expect.objectContaining({ method: "POST" }));
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/admin/monitors/heartbeat", expect.objectContaining({ method: "POST" }));
});
```

- [ ] **Step 2: Run client tests to verify failure**

Run:

```bash
rtk proxy pnpm vitest run apps/console/src/api/client.test.ts -t "email notification|monitors"
```

Expected: FAIL because types/client methods do not exist.

- [ ] **Step 3: Add console types and client methods**

Add:

- email notification channel types.
- `AlertRuleType` includes `error_rate`.
- alert rule fields `routePattern` and `minimumSampleSize`.
- `MonitorResponse`, `CreateHttpMonitorInput`, `CreateHeartbeatMonitorInput`, `MonitorCheckResponse`.
- client methods for list/create/update/archive monitors and monitor checks.

- [ ] **Step 4: Write failing UI tests**

Add tests:

```ts
it("creates an email channel without SMTP credentials in the browser", async () => {
  const createNotificationChannel = vi.fn().mockResolvedValue({
    channel: { id: "chn_email", name: "Ops email", type: "email", emailRecipients: ["diogo@example.com"], enabled: true }
  });

  render(<AlertsPanel client={apiWith({ createNotificationChannel })} projectId="prj_1" environmentId="env_1" />);

  await userEvent.click(screen.getByRole("tab", { name: "Channels" }));
  await userEvent.selectOptions(screen.getByLabelText("Channel type"), "email");
  await userEvent.type(screen.getByLabelText("Channel name"), "Ops email");
  await userEvent.type(screen.getByLabelText("Recipients"), "diogo@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Create channel" }));

  expect(createNotificationChannel).toHaveBeenCalledWith({
    name: "Ops email",
    type: "email",
    emailRecipients: ["diogo@example.com"],
    enabled: true
  });
});

it("creates a route-scoped error rate alert rule", async () => {
  const createAlertRule = vi.fn().mockResolvedValue({ rule: alertRule({ type: "error_rate" }) });
  render(<AlertsPanel client={apiWith({ createAlertRule })} projectId="prj_1" environmentId="env_1" />);

  await userEvent.selectOptions(screen.getByLabelText("Rule type"), "error_rate");
  await userEvent.type(screen.getByLabelText("Rule name"), "Checkout error rate");
  await userEvent.clear(screen.getByLabelText("Threshold"));
  await userEvent.type(screen.getByLabelText("Threshold"), "5");
  await userEvent.type(screen.getByLabelText("Route or trace name"), "GET /checkout");
  await userEvent.clear(screen.getByLabelText("Minimum sample size"));
  await userEvent.type(screen.getByLabelText("Minimum sample size"), "20");
  await userEvent.click(screen.getByRole("button", { name: "Create rule" }));

  expect(createAlertRule).toHaveBeenCalledWith(expect.objectContaining({
    type: "error_rate",
    threshold: "5",
    routePattern: "GET /checkout",
    minimumSampleSize: 20
  }));
});
```

- [ ] **Step 5: Implement UI**

Refactor `AlertsPanel` into compact internal sections if needed:

- Channels: webhook/email segmented control.
- Rules: include error rate, route/trace field, minimum sample size.
- Uptime monitors: create/list status.
- Heartbeat monitors: create/list status and one-time secret display.
- History: existing alert events plus monitor check detail.

Keep SMTP credentials out of browser forms; SMTP remains env-only.

- [ ] **Step 6: Run UI tests**

Run:

```bash
rtk proxy pnpm vitest run apps/console/src/api/client.test.ts apps/console/src/components/AlertsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts apps/console/src/components/AlertsPanel.tsx apps/console/src/components/AlertsPanel.test.tsx apps/console/src/styles.css
git commit -m "feat: manage monitors in console"
```

## Task 8: System Health Summary And Docs

**Files:**
- Modify: `apps/api/src/routes/system.ts`
- Modify: `apps/api/test/system.test.ts`
- Modify: `apps/console/src/components/SystemHealthPanel.tsx`
- Modify: `apps/console/src/components/SystemHealthPanel.test.tsx`
- Modify: `README.md`
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/DEPLOYMENT.md`
- Modify: `.claude/docs/STACK.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/INFRASTRUCTURE.md`
- Modify: `.claude/docs/SECRETS.md`

- [ ] **Step 1: Write failing system health tests**

Add system route and UI assertions:

```ts
expect(snapshot.monitors).toEqual({
  enabled: true,
  healthy: 2,
  degraded: 0,
  down: 1,
  staleHeartbeats: 1,
  latestCheckAt: "2026-05-24T12:00:00.000Z"
});
```

UI should render:

```ts
expect(within(monitorsCard).getByText("Down 1")).toBeInTheDocument();
expect(within(monitorsCard).getByText("stale heartbeats 1")).toBeInTheDocument();
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
rtk proxy pnpm vitest run apps/api/test/system.test.ts apps/console/src/components/SystemHealthPanel.test.tsx -t "monitor"
```

Expected: FAIL because health summary is not exposed.

- [ ] **Step 3: Implement monitor health summary**

Add a repository dependency that counts monitor statuses and stale heartbeat monitors. Include the summary in `/system/health`.

- [ ] **Step 4: Update docs**

Document:

- SMTP setup with Resend SMTP example and provider-neutral wording.
- HTTP uptime monitor setup.
- heartbeat check-in command:

```bash
curl -X POST "$SIGMON_ENDPOINT/v1/heartbeats/MONITOR_ID" \
  -H "Authorization: Bearer HEARTBEAT_SECRET"
```

- error-rate requirements: traces must be emitted for denominator.
- route/name-scoped p95 rules.
- safety limits and SSRF protections.

- [ ] **Step 5: Run focused tests**

Run:

```bash
rtk proxy pnpm vitest run apps/api/test/system.test.ts apps/console/src/components/SystemHealthPanel.test.tsx scripts/branding-contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/system.ts apps/api/test/system.test.ts apps/console/src/components/SystemHealthPanel.tsx apps/console/src/components/SystemHealthPanel.test.tsx README.md .claude/docs/ARCHITECTURE.md .claude/docs/DEPLOYMENT.md .claude/docs/STACK.md .claude/docs/UI-UX.md .claude/docs/INFRASTRUCTURE.md .claude/docs/SECRETS.md
git commit -m "docs: document alerting monitors"
```

## Task 9: Final Verification And Handoff

**Files:**
- Modify: `docs/superpowers/runs/2026-05-24-alerting-and-monitors.md`

- [ ] **Step 1: Create run evidence file**

Record the implementation summary, commands, and any residual limitations in `docs/superpowers/runs/2026-05-24-alerting-and-monitors.md`.

- [ ] **Step 2: Run full verification**

Run:

```bash
rtk proxy pnpm test
rtk proxy pnpm build
docker compose config --quiet
git diff --check
```

Expected:

- `pnpm test`: all test files pass.
- `pnpm build`: all workspace builds pass.
- `docker compose config --quiet`: exit code 0.
- `git diff --check`: no whitespace errors.

- [ ] **Step 3: Optional local smoke**

Run only if local ports are available:

```bash
rtk proxy pnpm smoke:compose --project-name sigmon_alerting_monitors
```

If local ports are occupied, record the blocker and rely on CI `Compose smoke`.

- [ ] **Step 4: Commit run evidence**

```bash
git add docs/superpowers/runs/2026-05-24-alerting-and-monitors.md
git commit -m "docs: record alerting monitors verification"
```

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin codex/alerting-and-monitors
gh pr create --draft --title "[codex] Add alerting monitors" --body-file docs/superpowers/runs/2026-05-24-alerting-and-monitors.md
```

Monitor GitHub Actions and do not mark the PR ready until Test, Build, Docker Compose config, and Compose smoke are green.

