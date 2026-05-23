# Phase 6D Critical Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the audit Top 10 hygiene findings so SignalMonitor is safer to deploy before Phase 6F EasyPanel VPS work.

**Architecture:** Keep hardening changes inside existing package boundaries. Shared low-level security and runtime helpers live in `@sigmon/config`; API and worker consume those helpers without duplicating policy. Database reliability changes stay in `@sigmon/db`, queue behavior stays in `@sigmon/queues`, and operator-facing behavior is reflected in README plus canonical `.claude/docs`.

**Tech Stack:** TypeScript, pnpm workspaces, Fastify 5, BullMQ, Kysely/Postgres, Redis, Docker Compose, Vitest, Node.js 22.

---

## File Structure

- Create `packages/config/src/network-security.ts`: shared webhook URL and unsafe-address validation.
- Modify `packages/config/src/index.ts`: export network-security and logger helpers, and keep production placeholder validation.
- Modify `packages/config/test/config.test.ts`: production placeholder coverage.
- Modify `apps/api/src/app.ts`: Fastify logger, global error handler, security headers hook, cookie defaults.
- Create `apps/api/test/security-headers.test.ts`: header and error-handler assertions.
- Modify `apps/api/src/routes/admin.ts`: use shared webhook target validation and remove duplicate IP helper code.
- Modify `apps/api/test/admin.test.ts`: notification-channel SSRF validation cases.
- Modify `apps/worker/src/alerts.ts`: use shared validation for URL literals, DNS resolution, and validating HTTP lookup.
- Modify `apps/worker/test/telemetry-worker.test.ts`: alert delivery SSRF cases in non-production and DNS-rebinding coverage.
- Create `packages/config/src/logger.ts`: small structured logger and redaction helper usable by API startup and worker.
- Modify `apps/api/src/main.ts`: startup listen failure handling, ordered bounded shutdown, structured logs.
- Modify `apps/worker/src/main.ts`: structured logs and ordered bounded shutdown.
- Create `apps/api/test/startup-shutdown.test.ts`: unit-level startup/shutdown helper tests after extracting helpers.
- Create `apps/worker/test/shutdown.test.ts`: worker shutdown sequencing tests after extracting helpers.
- Modify `packages/queues/src/telemetry-queue.ts`: deterministic BullMQ `jobId`.
- Modify `packages/queues/test/telemetry-queue.test.ts`: duplicate enqueue returns one logical job.
- Modify `packages/db/src/repositories/telemetry-writes.ts`: idempotent inserts.
- Modify `packages/db/test/repositories.test.ts`: duplicate insert and error-group counter tests.
- Modify `packages/db/src/repositories/system.ts`: retention table allowlist.
- Modify `apps/worker/src/backups.ts`: checksum sidecar creation and metadata recording.
- Modify `scripts/backup-restore.ts`: checksum verification before restore.
- Add `packages/db/migrations/0010_backup_checksums.sql`: backup checksum metadata column.
- Modify `packages/db/src/migrate.ts` and `packages/db/src/schema.ts`: register checksum migration and schema field.
- Modify `packages/db/src/repositories/backups.ts`: read/write backup checksum.
- Modify `apps/worker/test/backups.test.ts`: checksum creation and restore verification cases.
- Modify `Dockerfile`: non-root runtime user, `tini`, healthcheck helper availability.
- Modify `docker-compose.yml`: API and worker healthchecks, safer internal password interpolation.
- Modify `scripts/doctor.ts` and `scripts/doctor.test.ts`: production checks for Compose placeholders and Docker hardening expectations.
- Modify `packages/sdk/package.json`: explicit exports for root, `./browser`, and `./node`.
- Create `packages/sdk/src/browser.ts`: browser-facing SDK entrypoint with naming that requires browser/public key semantics.
- Create `packages/sdk/src/node.ts`: server-side SDK entrypoint.
- Modify `packages/sdk/src/index.ts`: keep compatibility exports but update documentation path.
- Create `packages/sdk/test/exports.test.ts`: package export and source-boundary checks.
- Modify `README.md`, `.claude/docs/ARCHITECTURE.md`, `.claude/docs/DEPLOYMENT.md`, `.claude/docs/STACK.md`, `.claude/docs/CONSTRAINTS.md`, `.claude/docs/SECRETS.md`, `.claude/docs/INFRASTRUCTURE.md`: active documentation updates.

## Task 1: Shared Webhook SSRF Guard

**Files:**
- Create: `packages/config/src/network-security.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/worker/src/alerts.ts`
- Test: `apps/api/test/admin.test.ts`
- Test: `apps/worker/test/telemetry-worker.test.ts`

- [ ] **Step 1: Write focused failing tests**

Add API notification-channel tests that expect localhost/private/link-local targets to be rejected even when `nodeEnv` is `"development"`:

```ts
it.each([
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
])("rejects unsafe webhook target %s outside production", async (url) => {
  app = await buildApp({
    readiness: async () => ({ postgres: true, redis: true }),
    nodeEnv: "development",
    auth: adminAuth,
    alerts: {
      listNotificationChannels: vi.fn(),
      createNotificationChannel: vi.fn(),
      updateNotificationChannel: vi.fn(),
      archiveNotificationChannel: vi.fn(),
      getNotificationChannel: vi.fn(),
      listAlertRules: vi.fn(),
      createAlertRule: vi.fn(),
      updateAlertRule: vi.fn(),
      archiveAlertRule: vi.fn()
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/admin/notification-channels",
    payload: { name: "Unsafe", type: "webhook", url }
  });

  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: "invalid_notification_channel_request" });
});
```

Add worker delivery tests that pass `nodeEnv: "development"` and prove DNS results are still rejected:

```ts
it("rejects private DNS resolution outside production", async () => {
  const result = await deliverWebhook({
    channel: {
      id: "chn_1",
      name: "Webhook",
      type: "webhook",
      url: "https://example.test/hook",
      secretHeaderName: null,
      secretHeaderValue: null,
      hasSecret: false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    },
    payload,
    timeoutMs: 1000,
    nodeEnv: "development",
    resolveHostname: async () => [{ address: "169.254.169.254", family: 4 }],
    requestImpl: vi.fn()
  });

  expect(result).toEqual({
    status: "failed",
    responseStatus: null,
    errorMessage: "unsafe webhook target"
  });
});
```

- [ ] **Step 2: Run the failing focused tests**

Run:

```sh
pnpm test apps/api/test/admin.test.ts apps/worker/test/telemetry-worker.test.ts
```

Expected: FAIL because non-production private webhook targets are currently allowed and the expected `"unsafe webhook target"` message does not exist.

- [ ] **Step 3: Create the shared validator**

Create `packages/config/src/network-security.ts`:

```ts
import { isIP } from "node:net";

export type ResolvedAddress = { address: string; family: number };

export function validateWebhookTargetUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("webhook URL must use http or https");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("webhook URL credentials are not allowed");
  }
  assertSafeWebhookHost(url.hostname);
  return url;
}

export function assertSafeResolvedAddresses(addresses: ResolvedAddress[]): void {
  if (addresses.length === 0) throw new Error("Webhook DNS resolution failed");
  for (const entry of addresses) {
    assertSafeWebhookHost(entry.address);
  }
}

export function assertSafeWebhookHost(rawHost: string): void {
  if (isUnsafeWebhookHost(rawHost)) {
    throw new Error("unsafe webhook target");
  }
}

export function isUnsafeWebhookHost(rawHost: string): boolean {
  const host = normalizeLiteralHost(rawHost);
  if (host === "localhost") return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) return isUnsafeIpv4Host(host);

  const mappedIpv4Host = parseIpv4MappedIpv6Host(host);
  if (mappedIpv4Host) return isUnsafeIpv4Host(mappedIpv4Host);

  if (ipVersion === 6) return isUnsafeIpv6Host(host);
  return false;
}

function normalizeLiteralHost(host: string): string {
  return host.toLowerCase().replace(/^\\[(.*)\\]$/, "$1");
}

function parseIpv4MappedIpv6Host(host: string): string | null {
  const mappedPrefix = "::ffff:";
  if (!host.startsWith(mappedPrefix)) return null;
  const mappedAddress = host.slice(mappedPrefix.length);
  if (isIP(mappedAddress) === 4) return mappedAddress;
  const hextets = mappedAddress.split(":");
  if (hextets.length !== 2) return null;
  const high = parseIpv6MappedHextet(hextets[0]);
  const low = parseIpv6MappedHextet(hextets[1]);
  if (high === null || low === null) return null;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function parseIpv6MappedHextet(hextet: string | undefined): number | null {
  if (!hextet || !/^[0-9a-f]{1,4}$/.test(hextet)) return null;
  return Number.parseInt(hextet, 16);
}

function isUnsafeIpv4Host(host: string): boolean {
  const octets = host.split(".").map((octet) => Number(octet));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }
  const [first, second] = octets;
  return (
    host === "0.0.0.0" ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isUnsafeIpv6Host(host: string): boolean {
  if (host === "::" || host === "::1" || isUnspecifiedIpv6Host(host)) return true;
  const firstHextet = Number.parseInt(host.split(":")[0] ?? "", 16);
  if (Number.isNaN(firstHextet)) return false;
  return (
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00
  );
}

function isUnspecifiedIpv6Host(host: string): boolean {
  return host.replace(/:/g, "").replace(/0/g, "").length === 0;
}
```

Export the helper from `packages/config/src/index.ts`:

```ts
export {
  assertSafeResolvedAddresses,
  assertSafeWebhookHost,
  isUnsafeWebhookHost,
  validateWebhookTargetUrl,
  type ResolvedAddress
} from "./network-security.js";
```

- [ ] **Step 4: Replace duplicated route and worker policy**

In `apps/api/src/routes/admin.ts`, import `validateWebhookTargetUrl` and change `validateWebhookUrl` to:

```ts
function validateWebhookUrl(rawUrl: string, _nodeEnv: string | undefined): boolean {
  try {
    validateWebhookTargetUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
```

Delete the local `isPrivateWebhookHost`, `normalizeLiteralHost`, IPv4, and IPv6 helpers from `admin.ts`.

In `apps/worker/src/alerts.ts`, import `assertSafeResolvedAddresses`, `assertSafeWebhookHost`, and `validateWebhookTargetUrl`. Change `validateWebhookTarget` to ignore `nodeEnv` and delegate:

```ts
export function validateWebhookTarget(rawUrl: string, _nodeEnv: string): URL {
  return validateWebhookTargetUrl(rawUrl);
}
```

Change the DNS preflight to run in every environment:

```ts
if (shouldResolveWebhookHostname(url)) {
  const resolveHostname = input.resolveHostname ?? defaultResolveHostname;
  try {
    const resolved = await resolveHostname(url.hostname);
    assertSafeResolvedAddresses(resolved);
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      errorMessage: sanitizeMessage(error instanceof Error ? error.message : "Webhook DNS resolution failed")
    };
  }
}
```

Change `createValidatingWebhookLookup` to call `assertSafeWebhookHost` for every returned address. Remove the duplicated worker private-host helpers.

- [ ] **Step 5: Run focused tests**

Run:

```sh
pnpm test apps/api/test/admin.test.ts apps/worker/test/telemetry-worker.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add packages/config/src/index.ts packages/config/src/network-security.ts apps/api/src/routes/admin.ts apps/api/test/admin.test.ts apps/worker/src/alerts.ts apps/worker/test/telemetry-worker.test.ts
git commit -m "fix: block unsafe webhook targets in all environments"
```

## Task 2: Queue And Telemetry Idempotency

**Files:**
- Modify: `packages/queues/src/telemetry-queue.ts`
- Modify: `packages/queues/test/telemetry-queue.test.ts`
- Modify: `packages/db/src/repositories/telemetry-writes.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Write duplicate queue and repository tests**

Add a queue test:

```ts
it("uses telemetry payload id as the BullMQ job id", async () => {
  const queue = createTelemetryQueue(redisUrl);
  const payload: TelemetryJobPayload = {
    kind: "event",
    id: "evt_dedupe",
    projectId: "project_1",
    environmentId: "environment_1",
    payload: { name: "dashboard_created" }
  };

  try {
    const first = await enqueueTelemetryJob(queue, payload);
    const second = await enqueueTelemetryJob(queue, payload);

    expect(first.id).toBe("event:evt_dedupe");
    expect(second.id).toBe("event:evt_dedupe");
    expect(await queue.count()).toBe(1);
  } finally {
    await queue.obliterate({ force: true });
    await queue.close();
  }
});
```

Add repository tests near telemetry write coverage:

```ts
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

    await insertEvent(db, input);
    await insertEvent(db, input);

    const rows = await db.selectFrom("events").select("id").where("id", "=", input.id).execute();
    expect(rows).toHaveLength(1);
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

    await insertError(db, input);
    await insertError(db, input);

    const group = await db.selectFrom("error_groups").select(["occurrence_count"]).executeTakeFirstOrThrow();
    expect(Number(group.occurrence_count)).toBe(1);
  });
});
```

- [ ] **Step 2: Run failing focused tests**

Run:

```sh
pnpm test packages/queues/test/telemetry-queue.test.ts packages/db/test/repositories.test.ts
```

Expected: FAIL. Queue jobs get generated IDs, and duplicate DB inserts currently hit unique constraints.

- [ ] **Step 3: Make queue jobs deterministic**

Update `enqueueTelemetryJob`:

```ts
export async function enqueueTelemetryJob(queue: TelemetryQueue, payload: TelemetryJobPayload) {
  return queue.add(payload.kind, payload, { jobId: `${payload.kind}:${payload.id}` });
}
```

- [ ] **Step 4: Make telemetry inserts idempotent**

Add a helper in `packages/db/src/repositories/telemetry-writes.ts`:

```ts
async function recordInserted(rowCount: number | bigint | undefined): Promise<boolean> {
  return Number(rowCount ?? 0) > 0;
}
```

For `insertEvent`, `insertLlmCall`, `insertTrace`, `insertSpan`, and `insertBreadcrumb`, add `.onConflict((oc) => oc.column("id").doNothing())` before `.execute()`.

For `insertError`, first check whether the error already exists inside the transaction:

```ts
const existing = await trx.selectFrom("errors").select("id").where("id", "=", input.id).executeTakeFirst();
if (existing) return;
```

Then keep group upsert and insert in the same transaction, and add `.onConflict((oc) => oc.column("id").doNothing())` to the insert. After the insert, call `refreshErrorGroupStats` so duplicate race cases recalculate from actual rows instead of optimistic counters.

- [ ] **Step 5: Run focused tests**

Run:

```sh
pnpm test packages/queues/test/telemetry-queue.test.ts packages/db/test/repositories.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add packages/queues/src/telemetry-queue.ts packages/queues/test/telemetry-queue.test.ts packages/db/src/repositories/telemetry-writes.ts packages/db/test/repositories.test.ts
git commit -m "fix: make telemetry retries idempotent"
```

## Task 3: Structured Logging And Global API Error Handling

**Files:**
- Create: `packages/config/src/logger.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/worker/src/main.ts`
- Test: `apps/api/test/security-headers.test.ts`
- Test: `apps/worker/test/telemetry-worker.test.ts`

- [ ] **Step 1: Write failing API error-handler test**

Create `apps/api/test/security-headers.test.ts` with this first test:

```ts
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("API hardening", () => {
  it("returns sanitized JSON for unexpected route errors", async () => {
    app = await buildApp({
      readiness: async () => {
        throw new Error("database password=super-secret exploded");
      },
      nodeEnv: "production"
    });

    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal_server_error" });
    expect(response.body).not.toContain("super-secret");
  });
});
```

- [ ] **Step 2: Run failing focused test**

Run:

```sh
pnpm test apps/api/test/security-headers.test.ts
```

Expected: FAIL because the global handler is not installed.

- [ ] **Step 3: Add shared structured logger helper**

Create `packages/config/src/logger.ts`:

```ts
type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

const secretKeyPattern = /(authorization|cookie|password|secret|token|api[_-]?key|access[_-]?key|session|pepper)/i;

export type StructuredLogger = {
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
};

export function createStructuredLogger(component: string): StructuredLogger {
  const write = (level: LogLevel, fields: LogFields, message: string) => {
    const record = {
      level,
      component,
      message,
      time: new Date().toISOString(),
      ...redactLogFields(fields)
    };
    const line = JSON.stringify(record);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
  };
  return {
    debug: (fields, message) => write("debug", fields, message),
    info: (fields, message) => write("info", fields, message),
    warn: (fields, message) => write("warn", fields, message),
    error: (fields, message) => write("error", fields, message)
  };
}

export function redactLogFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactLogFields(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      secretKeyPattern.test(key) ? "[REDACTED]" : redactLogFields(entry)
    ])
  );
}
```

Export it from `packages/config/src/index.ts`.

- [ ] **Step 4: Enable Fastify logger and global handler**

In `apps/api/src/app.ts`, change Fastify creation:

```ts
const app = Fastify({
  logger: {
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-api-key']",
      "req.headers['sigmon-source-map-token']",
      "res.headers['set-cookie']"
    ]
  }
});
```

Add this after plugin registration begins and before route registration:

```ts
app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, "Unhandled API error");
  return reply.status(500).send({ error: "internal_server_error" });
});
```

Keep known route-level status responses intact.

- [ ] **Step 5: Use structured logger in API and worker main files**

In `apps/api/src/main.ts` and `apps/worker/src/main.ts`, import `createStructuredLogger` from `@sigmon/config`. Replace startup, shutdown, worker event, scheduler, and dead-letter `console.*` calls with logger calls like:

```ts
const logger = createStructuredLogger("api");
logger.info({ port: config.port }, "API starting");
logger.error({ error }, "API shutdown step failed");
```

For worker events:

```ts
logger.info({ jobId: job.id, jobName: job.name }, "Processed telemetry job");
logger.error({ jobId: job?.id, error }, "Telemetry job failed");
```

- [ ] **Step 6: Run focused tests**

Run:

```sh
pnpm test apps/api/test/security-headers.test.ts apps/worker/test/telemetry-worker.test.ts
pnpm --filter @sigmon/api build
pnpm --filter @sigmon/worker build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add packages/config/src/index.ts packages/config/src/logger.ts apps/api/src/app.ts apps/api/src/main.ts apps/worker/src/main.ts apps/api/test/security-headers.test.ts apps/worker/test/telemetry-worker.test.ts
git commit -m "fix: add structured runtime logging"
```

## Task 4: API Listen Failure And Ordered Bounded Shutdown

**Files:**
- Modify: `apps/api/src/main.ts`
- Modify: `apps/worker/src/main.ts`
- Create: `apps/api/src/runtime.ts`
- Create: `apps/worker/src/runtime.ts`
- Test: `apps/api/test/startup-shutdown.test.ts`
- Test: `apps/worker/test/shutdown.test.ts`

- [ ] **Step 1: Write runtime helper tests**

Create API shutdown tests:

```ts
import { describe, expect, it, vi } from "vitest";
import { runShutdownSteps, listenWithCleanup } from "../src/runtime.js";

describe("API runtime", () => {
  it("runs shutdown steps sequentially", async () => {
    const order: string[] = [];
    await runShutdownSteps([
      { name: "app.close", run: async () => order.push("app") },
      { name: "queue.close", run: async () => order.push("queue") },
      { name: "redis.quit", run: async () => order.push("redis") },
      { name: "db.destroy", run: async () => order.push("db") }
    ], 1000);

    expect(order).toEqual(["app", "queue", "redis", "db"]);
  });

  it("cleans up resources when listen fails", async () => {
    const cleanup = vi.fn(async () => undefined);
    await expect(
      listenWithCleanup({
        listen: async () => {
          throw new Error("EADDRINUSE");
        },
        cleanup,
        logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
      })
    ).rejects.toThrow("EADDRINUSE");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
```

Create worker shutdown tests with the same `runShutdownSteps` expectation for `stopBackups`, `stopAlerts`, `stopRetention`, `stopHeartbeat`, `worker.close`, `connection.quit`, and `db.destroy`.

- [ ] **Step 2: Run failing runtime tests**

Run:

```sh
pnpm test apps/api/test/startup-shutdown.test.ts apps/worker/test/shutdown.test.ts
```

Expected: FAIL because runtime helper modules do not exist.

- [ ] **Step 3: Add API runtime helper**

Create `apps/api/src/runtime.ts`:

```ts
import type { StructuredLogger } from "@sigmon/config";

export type ShutdownStep = { name: string; run: () => Promise<unknown> };

export async function runShutdownSteps(steps: ShutdownStep[], timeoutMs: number): Promise<void> {
  for (const step of steps) {
    await withTimeout(step.run(), timeoutMs, `${step.name} timed out`);
  }
}

export async function listenWithCleanup(input: {
  listen: () => Promise<unknown>;
  cleanup: () => Promise<void>;
  logger: StructuredLogger;
}): Promise<void> {
  try {
    await input.listen();
  } catch (error) {
    input.logger.error({ error }, "API listen failed");
    await input.cleanup();
    throw error;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
```

Create the equivalent `apps/worker/src/runtime.ts` or share the helper through `packages/config/src/runtime.ts` if the implementation stays identical. Prefer `packages/config/src/runtime.ts` if both apps need the exact same code.

- [ ] **Step 4: Wire API startup and shutdown**

In `apps/api/src/main.ts`, replace direct listen with:

```ts
await listenWithCleanup({
  listen: () => app.listen({ port: config.port, host: "0.0.0.0" }),
  cleanup: () => shutdown("SIGTERM", { exit: false }),
  logger
});
```

Change shutdown to run these stages in order with a 10 second per-stage timeout:

```ts
await runShutdownSteps(
  [
    { name: "app.close", run: () => app.close() },
    { name: "telemetryQueue.close", run: () => telemetryQueue.close() },
    { name: "redis.quit", run: () => redis.quit() },
    { name: "db.destroy", run: () => db.destroy() }
  ],
  10_000
);
```

Catch and log each failed step inside `runShutdownSteps` if tests are written for continue-on-error behavior; otherwise let shutdown fail and set a non-zero exit in the signal handler.

- [ ] **Step 5: Wire worker shutdown**

In `apps/worker/src/main.ts`, close schedulers and worker first, then Redis and DB:

```ts
await runShutdownSteps(
  [
    { name: "stopBackups", run: stopBackups },
    { name: "stopAlerts", run: stopAlerts },
    { name: "stopRetention", run: stopRetention },
    { name: "stopHeartbeat", run: async () => stopHeartbeat() },
    { name: "worker.close", run: () => worker.close() },
    { name: "connection.quit", run: () => connection.quit() },
    { name: "db.destroy", run: () => db.destroy() }
  ],
  10_000
);
```

- [ ] **Step 6: Run focused tests and builds**

Run:

```sh
pnpm test apps/api/test/startup-shutdown.test.ts apps/worker/test/shutdown.test.ts
pnpm --filter @sigmon/api build
pnpm --filter @sigmon/worker build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add apps/api/src/main.ts apps/api/src/runtime.ts apps/api/test/startup-shutdown.test.ts apps/worker/src/main.ts apps/worker/src/runtime.ts apps/worker/test/shutdown.test.ts
git commit -m "fix: bound startup and shutdown behavior"
```

## Task 5: Retention Table Allowlist

**Files:**
- Modify: `packages/db/src/repositories/system.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Write failing allowlist test**

Add a test near retention repository tests:

```ts
it("rejects retention table names outside the telemetry allowlist", async () => {
  await withDb(async (db) => {
    await migrate(db);
    await expect(
      deleteExpiredBatchesFromTableForTest(db, "users", new Date("2026-01-01T00:00:00.000Z"), 10, 1)
    ).rejects.toThrow("retention table is not allowed: users");
  });
});
```

Expose a test-only function from `system.ts`:

```ts
export const __test = { deleteExpiredBatchesFromTable };
```

Use `__test.deleteExpiredBatchesFromTable` in the test rather than exporting it as public API.

- [ ] **Step 2: Run failing focused test**

Run:

```sh
pnpm test packages/db/test/repositories.test.ts
```

Expected: FAIL because `deleteExpiredBatchesFromTable` is not exposed and table names are unrestricted.

- [ ] **Step 3: Add allowlist type and runtime check**

In `packages/db/src/repositories/system.ts`:

```ts
const retentionTables = ["events", "errors", "traces", "spans", "llm_calls", "breadcrumbs"] as const;
type RetentionTable = (typeof retentionTables)[number];
const retentionTableSet = new Set<string>(retentionTables);

function assertRetentionTable(tableName: string): asserts tableName is RetentionTable {
  if (!retentionTableSet.has(tableName)) {
    throw new Error(`retention table is not allowed: ${tableName}`);
  }
}
```

Call `assertRetentionTable(tableName)` at the start of `deleteExpiredFromTable`.

Change internal call sites to pass `RetentionTable` where straightforward:

```ts
async function deleteExpiredFromTable(db: SystemDb, tableName: RetentionTable, cutoff: Date, batchSize: number)
```

- [ ] **Step 4: Run focused test**

Run:

```sh
pnpm test packages/db/test/repositories.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/db/src/repositories/system.ts packages/db/test/repositories.test.ts
git commit -m "fix: restrict retention table deletes"
```

## Task 6: Backup Integrity Metadata And Restore Verification

**Files:**
- Create: `packages/db/migrations/0010_backup_checksums.sql`
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/repositories/backups.ts`
- Modify: `apps/worker/src/backups.ts`
- Modify: `apps/worker/test/backups.test.ts`
- Modify: `scripts/backup-restore.ts`

- [ ] **Step 1: Write failing checksum tests**

In `apps/worker/test/backups.test.ts`, add:

```ts
it("records a sha256 checksum for successful local backups", async () => {
  const localDir = await mkdtemp(join(tmpdir(), "sigmon-backups-"));
  const records: BackupRunInput[] = [];

  await runBackupOnce({
    now: fixedNowSequence(),
    trigger: "manual",
    config: backupConfig({ localDir }),
    withLock: async (run) => ({ locked: true, result: await run() }),
    dumpDatabase: async ({ outputPath }) => {
      await writeFile(outputPath, "backup-content");
    },
    recordBackupRun: async (input) => {
      records.push(input);
    }
  });

  expect(records[0]).toMatchObject({
    status: "success",
    checksumSha256: "80afc9140b99393493ac1744b90951585e171abcdfdd7ed46a8d21a89bdfcc8f"
  });
});

it("refuses restore when a checksum sidecar does not match", async () => {
  const localDir = await mkdtemp(join(tmpdir(), "sigmon-restore-"));
  const dumpPath = join(localDir, "sigmon-20260523T120000Z.dump");
  await writeFile(dumpPath, "tampered");
  await writeFile(`${dumpPath}.sha256`, "80afc9140b99393493ac1744b90951585e171abcdfdd7ed46a8d21a89bdfcc8f  sigmon-20260523T120000Z.dump\n");

  await expect(
    restoreBackup({
      databaseUrl: "postgres://sigmon:secret@localhost:5432/sigmon",
      filePath: dumpPath,
      spawnFn: vi.fn()
    })
  ).rejects.toThrow("Backup checksum mismatch");
});
```

- [ ] **Step 2: Run failing backup tests**

Run:

```sh
pnpm test apps/worker/test/backups.test.ts
```

Expected: FAIL because checksum metadata and sidecar verification do not exist.

- [ ] **Step 3: Add backup checksum migration**

Create `packages/db/migrations/0010_backup_checksums.sql`:

```sql
ALTER TABLE backup_runs
  ADD COLUMN checksum_sha256 text;
```

Register it in `packages/db/src/migrate.ts` after `0009_source_map_retention.sql`.

Update `BackupRunsTable` in `packages/db/src/schema.ts`:

```ts
checksum_sha256: string | null;
```

- [ ] **Step 4: Update backup repository types**

In `packages/db/src/repositories/backups.ts`, add `checksumSha256: string | null` to `BackupRunRecord` and the `recordBackupRun` input type. Map `row.checksum_sha256` in `toBackupRunRecord`, and insert `checksum_sha256: input.checksumSha256`.

Update repository tests that construct backup rows to include either `checksum_sha256` in raw SQL column lists or rely on the nullable default.

- [ ] **Step 5: Create checksum helpers**

In `apps/worker/src/backups.ts`, import `createHash` and `createReadStream` handling. Add:

```ts
export async function calculateFileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function writeChecksumSidecar(filePath: string, checksum: string): Promise<void> {
  await writeFile(`${filePath}.sha256`, `${checksum}  ${basename(filePath)}\n`);
}
```

After `stat(localPath)`, compute checksum and write sidecar. Record `checksumSha256`.

- [ ] **Step 6: Verify checksum before restore**

In `scripts/backup-restore.ts`, add:

```ts
export async function verifyBackupChecksum(filePath: string): Promise<void> {
  const sidecarPath = `${filePath}.sha256`;
  let sidecar: string;
  try {
    sidecar = await readFile(sidecarPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const expected = sidecar.trim().split(/\s+/)[0];
  const actual = await calculateFileSha256(filePath);
  if (actual !== expected) {
    throw new Error("Backup checksum mismatch");
  }
}
```

Call `await verifyBackupChecksum(input.filePath)` at the start of `restoreBackup`, before spawning `pg_restore`.

- [ ] **Step 7: Run focused backup and DB tests**

Run:

```sh
pnpm test apps/worker/test/backups.test.ts packages/db/test/repositories.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```sh
git add packages/db/migrations/0010_backup_checksums.sql packages/db/src/migrate.ts packages/db/src/schema.ts packages/db/src/repositories/backups.ts packages/db/test/repositories.test.ts apps/worker/src/backups.ts apps/worker/test/backups.test.ts scripts/backup-restore.ts
git commit -m "fix: verify backup integrity"
```

## Task 7: Docker And Compose Hardening

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `scripts/doctor.ts`
- Modify: `scripts/doctor.test.ts`

- [ ] **Step 1: Write doctor expectations**

In `scripts/doctor.test.ts`, add checks that production Compose env cannot rely on `sigmon-local-only-change-me` and that rendered Compose config includes healthchecks for API and worker:

```ts
it("fails production envs that keep the local-only postgres password placeholder", () => {
  const results = validateEnv({
    ...validEnv,
    NODE_ENV: "production",
    POSTGRES_PASSWORD: "sigmon-local-only-change-me",
    DATABASE_URL: "postgres://sigmon:sigmon-local-only-change-me@postgres:5432/sigmon"
  });

  expect(results).toContainEqual(
    expect.objectContaining({ status: "fail", message: "POSTGRES_PASSWORD must be replaced for production" })
  );
});
```

Add a text assertion for `docker-compose.yml`:

```ts
it("defines API and worker healthchecks", async () => {
  const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
  expect(compose).toContain("api:");
  expect(compose).toContain("worker:");
  expect(compose).toContain("healthcheck:");
});
```

- [ ] **Step 2: Run failing doctor tests**

Run:

```sh
pnpm test scripts/doctor.test.ts
```

Expected: FAIL until doctor and Compose are hardened.

- [ ] **Step 3: Harden Dockerfile**

Change `Dockerfile`:

```dockerfile
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache postgresql16-client tini curl
RUN addgroup -S sigmon && adduser -S sigmon -G sigmon

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.base.json vitest.config.ts ./

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sigmon/console build
RUN chown -R sigmon:sigmon /app

USER sigmon
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "start:api"]
```

- [ ] **Step 4: Add Compose healthchecks**

In `docker-compose.yml`, add for API:

```yaml
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:3000/health >/dev/null"]
      interval: 10s
      timeout: 5s
      retries: 12
```

For worker, use a Node process check:

```yaml
    healthcheck:
      test: ["CMD-SHELL", "pgrep -f 'tsx src/main.ts' >/dev/null || pgrep -f '@sigmon/worker' >/dev/null"]
      interval: 10s
      timeout: 5s
      retries: 12
```

If `pgrep` is unavailable in Alpine, use `ps | grep -v grep | grep -q 'worker'`.

- [ ] **Step 5: Tighten doctor production placeholder checks**

In `scripts/doctor.ts`, make `validateEnv` return a failure when `NODE_ENV=production` and `POSTGRES_PASSWORD` equals `sigmon-local-only-change-me`:

```ts
if (nodeEnv === "production" && env.POSTGRES_PASSWORD === "sigmon-local-only-change-me") {
  results.push(createResult("fail", "POSTGRES_PASSWORD must be replaced for production"));
}
```

Keep existing `DATABASE_URL` placeholder validation.

- [ ] **Step 6: Run focused checks**

Run:

```sh
pnpm test scripts/doctor.test.ts
docker compose config --quiet
```

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add Dockerfile docker-compose.yml scripts/doctor.ts scripts/doctor.test.ts
git commit -m "fix: harden container runtime defaults"
```

## Task 8: SDK Browser And Server Boundary

**Files:**
- Modify: `packages/sdk/package.json`
- Create: `packages/sdk/src/browser.ts`
- Create: `packages/sdk/src/node.ts`
- Modify: `packages/sdk/src/index.ts`
- Create: `packages/sdk/test/exports.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write package export tests**

Create `packages/sdk/test/exports.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("SDK exports", () => {
  it("publishes explicit browser and node entrypoints", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

    expect(manifest.exports["./browser"]).toEqual({
      types: "./dist/browser.d.ts",
      default: "./dist/browser.js"
    });
    expect(manifest.exports["./node"]).toEqual({
      types: "./dist/node.d.ts",
      default: "./dist/node.js"
    });
  });

  it("keeps browser entrypoint free of node imports", async () => {
    const source = await readFile(new URL("../src/browser.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/node:/);
    expect(source).not.toMatch(/from ["']fs/);
    expect(source).not.toMatch(/from ["']crypto/);
  });
});
```

- [ ] **Step 2: Run failing SDK tests**

Run:

```sh
pnpm test packages/sdk/test/exports.test.ts
```

Expected: FAIL because `browser.ts`, `node.ts`, and package exports do not exist.

- [ ] **Step 3: Add explicit entrypoints**

Create `packages/sdk/src/browser.ts`:

```ts
export type {
  BrowserBreadcrumbOptions,
  StopBrowserBreadcrumbs,
  SignalMonitorClient,
  SignalMonitorClientOptions
} from "./index.js";

export { createBrowserBreadcrumbs, sanitizeBreadcrumbUrl } from "./browser-breadcrumbs.js";
export { createSignalMonitorClient } from "./client.js";
```

Create `packages/sdk/src/node.ts`:

```ts
export type {
  SignalMonitorClient,
  SignalMonitorClientOptions,
  SignalContext,
  SignalMetadata
} from "./index.js";

export { createSignalMonitorClient } from "./client.js";
```

Keep `index.ts` as compatibility but update docs to prefer `@sigmon/sdk/browser` for browser apps and `@sigmon/sdk/node` for server-side use.

- [ ] **Step 4: Update package exports**

In `packages/sdk/package.json`:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  },
  "./browser": {
    "types": "./dist/browser.d.ts",
    "default": "./dist/browser.js"
  },
  "./node": {
    "types": "./dist/node.d.ts",
    "default": "./dist/node.js"
  }
}
```

- [ ] **Step 5: Update README SDK snippets**

Change browser-facing examples to import from `@sigmon/sdk/browser` and label the key as a browser ingestion key that is expected to be public. Change server examples to import from `@sigmon/sdk/node` and state server-side keys must not be bundled into browser code.

- [ ] **Step 6: Run SDK tests and build**

Run:

```sh
pnpm test packages/sdk/test/exports.test.ts packages/sdk/test/client.test.ts packages/sdk/test/browser-breadcrumbs.test.ts
pnpm --filter @sigmon/sdk build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add packages/sdk/package.json packages/sdk/src/browser.ts packages/sdk/src/node.ts packages/sdk/src/index.ts packages/sdk/test/exports.test.ts README.md
git commit -m "fix: clarify sdk runtime entrypoints"
```

## Task 9: HTTP Security Headers And Cookie Hardening

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/test/security-headers.test.ts`
- Modify: `apps/api/test/auth.test.ts`
- Modify: `scripts/smoke-compose/http.ts`

- [ ] **Step 1: Add failing header and cookie tests**

Extend `apps/api/test/security-headers.test.ts`:

```ts
it("sets baseline security headers", async () => {
  app = await buildApp({
    readiness: async () => ({ postgres: true, redis: true }),
    nodeEnv: "production"
  });

  const response = await app.inject({ method: "GET", url: "/health" });

  expect(response.headers["x-content-type-options"]).toBe("nosniff");
  expect(response.headers["referrer-policy"]).toBe("no-referrer");
  expect(response.headers["x-frame-options"]).toBe("DENY");
  expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
});
```

Extend auth tests to assert production session cookie hardening:

```ts
it("uses host-prefixed secure session cookies in production", async () => {
  app = await buildApp({
    readiness: async () => ({ postgres: true, redis: true }),
    nodeEnv: "production",
    auth: {
      login: async (_email, _password, { reply }) => {
        reply.setCookie("__Host-sigmon_session", "session_1", {
          httpOnly: true,
          sameSite: "lax",
          secure: true,
          path: "/"
        });
        return { id: "usr_1", email: "admin@example.com", isAdmin: true };
      },
      findSessionUser: async () => null
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: "admin@example.com", password: "password" }
  });

  expect(response.headers["set-cookie"]).toContain("__Host-sigmon_session=");
  expect(response.headers["set-cookie"]).toContain("Secure");
  expect(response.headers["set-cookie"]).toContain("HttpOnly");
});
```

- [ ] **Step 2: Run failing API tests**

Run:

```sh
pnpm test apps/api/test/security-headers.test.ts apps/api/test/auth.test.ts
```

Expected: FAIL because headers are absent and app-level auth dependencies still set old cookie names in tests.

- [ ] **Step 3: Add security headers hook**

In `apps/api/src/app.ts`, add an `onRequest` or `onSend` hook:

```ts
app.addHook("onRequest", async (_request, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("X-Frame-Options", "DENY");
  reply.header(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"
  );
  if (options.nodeEnv === "production") {
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});
```

- [ ] **Step 4: Centralize cookie names and options**

In `apps/api/src/main.ts`, set:

```ts
const sessionCookieName = config.nodeEnv === "production" ? "__Host-sigmon_session" : "sigmon_session";
```

For OAuth state in `apps/api/src/routes/auth.ts`, keep `sigmon_oauth_state` because it is path-scoped to `/auth/google/callback`; document that `__Host-` is only compatible with `Path=/`, so it applies to the main session cookie.

Update `setSessionCookie` to use secure production options:

```ts
reply.setCookie(sessionCookieName, sessionToken, {
  httpOnly: true,
  sameSite: "lax",
  secure: config.nodeEnv === "production",
  path: "/",
  maxAge: sessionMaxAgeSeconds
});
```

If smoke cookie parsing breaks on prefixed names, update `scripts/smoke-compose/http.ts` cookie jar parsing to accept any cookie name.

- [ ] **Step 5: Run focused API tests**

Run:

```sh
pnpm test apps/api/test/security-headers.test.ts apps/api/test/auth.test.ts scripts/smoke-compose.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add apps/api/src/app.ts apps/api/src/main.ts apps/api/src/routes/auth.ts apps/api/test/security-headers.test.ts apps/api/test/auth.test.ts scripts/smoke-compose/http.ts scripts/smoke-compose.test.ts
git commit -m "fix: add http security headers"
```

## Task 10: Documentation And Release Notes

**Files:**
- Modify: `README.md`
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/DEPLOYMENT.md`
- Modify: `.claude/docs/STACK.md`
- Modify: `.claude/docs/CONSTRAINTS.md`
- Modify: `.claude/docs/SECRETS.md`
- Modify: `.claude/docs/INFRASTRUCTURE.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`

- [ ] **Step 1: Update active operator docs**

Update docs with these exact points:

- Webhook URLs are rejected if they target local/private/link-local/multicast/metadata networks in every environment.
- Telemetry queues use deterministic job IDs and database writes are idempotent for duplicate telemetry IDs.
- API and worker produce structured logs with redacted secret-bearing fields.
- API startup failures log and cleanup; shutdown is ordered and bounded.
- Docker image runs as a non-root user under `tini`; Compose defines healthchecks.
- Backups write SHA-256 sidecars and restore verifies sidecars when present.
- SDK docs distinguish `@sigmon/sdk/browser` and `@sigmon/sdk/node`.
- Security headers are enabled; the production session cookie uses the strongest compatible settings.

- [ ] **Step 2: Run docs grep checks**

Run:

```sh
rg -n "SignalHub|signal-hub|SIGNALHUB" README.md .claude/docs packages apps scripts
rg -n "sigmon-local-only-change-me" README.md .claude/docs docker-compose.yml .env.example scripts
```

Expected: old-name grep returns only intentional historical notes if any. Placeholder grep is allowed in `.env.example`, local development docs, and production rejection tests only.

- [ ] **Step 3: Commit docs**

```sh
git add README.md .claude/docs/ARCHITECTURE.md .claude/docs/DEPLOYMENT.md .claude/docs/STACK.md .claude/docs/CONSTRAINTS.md .claude/docs/SECRETS.md .claude/docs/INFRASTRUCTURE.md .claude/docs/PROJECT-SUMMARY.md
git commit -m "docs: document phase 6d hardening"
```

## Task 11: Final Verification And Audit Traceability

**Files:**
- Modify: `docs/superpowers/plans/2026-05-23-phase6d-critical-hygiene-implementation.md`
- Create: `docs/superpowers/runs/2026-05-23-phase6d-critical-hygiene.md`

- [ ] **Step 1: Run full local verification**

Run:

```sh
pnpm test
pnpm build
docker compose config --quiet
pnpm run doctor
pnpm smoke:compose
```

Expected: PASS. If a command fails, rerun with `rtk proxy <command>` to collect complete output before fixing.

- [ ] **Step 2: Create run evidence file**

Create `docs/superpowers/runs/2026-05-23-phase6d-critical-hygiene.md` with:

```md
# Phase 6D Critical Hygiene Run

## Audit Top 10 Traceability

| Audit item | Status | Evidence |
| --- | --- | --- |
| C1/C2 SSRF | remediated | Shared webhook target validation blocks unsafe ranges in API and worker tests. |
| C10/C11 idempotency | remediated | Queue job IDs and DB duplicate insert tests pass. |
| Logging/error handler | remediated | Fastify logger, global error handler, worker structured logs. |
| C6/C7 container/config | remediated | Docker non-root/tini, Compose healthchecks, production placeholder rejection. |
| C9 backups | remediated | SHA-256 backup sidecars and restore verification. |
| C5 SDK browser safety | guarded | Explicit `@sigmon/sdk/browser` and `@sigmon/sdk/node` exports plus docs. |
| C3 listen failure | remediated | Listen cleanup test and runtime helper. |
| C4 retention allowlist | remediated | Retention table allowlist test. |
| Shutdown | remediated | Ordered bounded shutdown helpers and tests. |
| Headers/cookies | remediated | Header and cookie tests pass. |

## Verification

- `pnpm test`: passed, include observed file/test counts from the command output.
- `pnpm build`: passed.
- `docker compose config --quiet`: passed.
- `pnpm run doctor`: passed, include any expected warnings.
- `pnpm smoke:compose`: passed, include smoke summary counts.
```

- [ ] **Step 3: Replace sample evidence text with observed command output**

Replace the sample phrases in the run file with the observed result and short evidence line, for example:

```md
- `pnpm test`: passed, 56 files / 800 tests.
```

- [ ] **Step 4: Update the implementation checklist**

In this plan file, mark completed task checkboxes for the work that was actually completed. Leave no completed work untracked.

- [ ] **Step 5: Commit run evidence**

```sh
git add docs/superpowers/plans/2026-05-23-phase6d-critical-hygiene-implementation.md docs/superpowers/runs/2026-05-23-phase6d-critical-hygiene.md
git commit -m "docs: record phase 6d verification"
```

## Task 12: Memory And PR Handoff

**Files:**
- Modify: `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`

- [ ] **Step 1: Update versioned memory**

Append a `2026-05-23` entry with:

```md
- Completed Phase 6D Critical Hygiene on branch `codex/phase6d-critical-hygiene` at commit `$(git rev-parse --short HEAD)`.
- Remediated the audit Top 10 scope: SSRF hardening, telemetry idempotency, structured logging/error handling, Docker/Compose hardening, backup checksum verification, SDK browser/node entrypoints, listen failure cleanup, retention table allowlist, ordered bounded shutdown, and security headers/cookie hardening.
- Final verification: `pnpm test`, `pnpm build`, `docker compose config --quiet`, `pnpm run doctor`, and `pnpm smoke:compose` passed.
- Next planned phase: Phase 6F EasyPanel VPS deployment.
```

- [ ] **Step 2: Commit memory update in config repo only**

Run:

```sh
git -C /Users/diogo/Developer/Github/claude-config add projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
git -C /Users/diogo/Developer/Github/claude-config commit -m "memory: record signalmonitor phase 6d completion" -- projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
```

- [ ] **Step 3: Open PR after local verification**

Use the repository GitHub flow:

```sh
git status -sb
git push -u origin codex/phase6d-critical-hygiene
gh pr create --draft --base main --head codex/phase6d-critical-hygiene --title "Phase 6D critical hygiene" --body-file docs/superpowers/runs/2026-05-23-phase6d-critical-hygiene.md
```

Expected: PR is created as draft and CI starts.

- [ ] **Step 4: Record CI evidence**

After GitHub Actions reports, update the run file with CI check names and statuses, then commit:

```sh
git add docs/superpowers/runs/2026-05-23-phase6d-critical-hygiene.md
git commit -m "docs: record phase 6d ci evidence"
git push
```

Expected: run file records Test, Build, Docker Compose config, and Compose smoke CI evidence.

## Execution Order

Implement in this order:

1. Task 1, SSRF guard.
2. Task 2, idempotency.
3. Task 5, retention allowlist.
4. Task 6, backup integrity.
5. Task 3, structured logging.
6. Task 4, startup and shutdown runtime.
7. Task 7, Docker and Compose hardening.
8. Task 8, SDK boundary.
9. Task 9, headers and cookies.
10. Task 10, docs.
11. Task 11, final verification.
12. Task 12, memory and PR handoff.

This order reduces conflict risk: database/queue safety lands first, runtime behavior lands before container hardening, and docs wait until code behavior is stable.
