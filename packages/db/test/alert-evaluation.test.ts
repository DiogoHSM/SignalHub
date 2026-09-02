import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { SecretBox } from "@sigmon/config";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { createTestDb } from "./test-db.js";
import {
  createNotificationChannel,
  evaluateAlertRule,
  getNotificationChannel,
  listNotificationChannels,
  updateNotificationChannel
} from "../src/repositories/alerts.js";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;

const windowStart = new Date("2026-06-24T11:00:00Z");
const windowEnd = new Date("2026-06-24T12:00:00Z");
const box = new SecretBox({ currentKey: Buffer.alloc(32, 12).toString("base64") });

describe("evaluateAlertRule", () => {
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
    const db = createTestDb(container.getConnectionUri());
    try {
      return await run(db);
    } finally {
      await db.destroy();
    }
  }

  async function seedScope(db: Db, projectId: string, environmentId: string): Promise<void> {
    await sql`insert into projects (id, name) values (${projectId}, ${projectId}) on conflict (id) do nothing`.execute(db);
    await sql`
      insert into environments (id, project_id, name)
      values (${environmentId}, ${projectId}, 'production')
      on conflict (id) do nothing
    `.execute(db);
  }

  async function seedTrace(
    db: Db,
    scope: { projectId: string; environmentId: string },
    input: { id: string; traceId: string; name: string; at: Date }
  ): Promise<void> {
    await sql`
      insert into traces (id, project_id, environment_id, trace_id, timestamp, received_at, name, status, started_at)
      values (
        ${input.id}, ${scope.projectId}, ${scope.environmentId}, ${input.traceId},
        ${input.at}, ${input.at}, ${input.name}, 'success', ${input.at}
      )
    `.execute(db);
  }

  async function seedError(
    db: Db,
    scope: { projectId: string; environmentId: string },
    input: { id: string; traceId: string | null; severity: string; at: Date }
  ): Promise<void> {
    await sql`
      insert into errors (id, project_id, environment_id, trace_id, timestamp, received_at, message, severity)
      values (
        ${input.id}, ${scope.projectId}, ${scope.environmentId}, ${input.traceId},
        ${input.at}, ${input.at}, 'boom', ${input.severity}
      )
    `.execute(db);
  }

  // ---------------------------------------------------------------------------
  // routePattern scoping
  //
  // trace_p95_latency and error_rate already scope by route. error_count and
  // critical_errors did not, so a rule scoped to one route fired on every
  // error in the environment — while getTopErrorGroupId, called in the same
  // evaluation, *did* apply the route filter. The count and the attributed
  // group disagreed with each other.
  // ---------------------------------------------------------------------------

  it("error_count counts only errors on the scoped route", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const scope = { projectId: "prj_ec", environmentId: "env_ec" };
      await seedScope(db, scope.projectId, scope.environmentId);
      const at = new Date("2026-06-24T11:30:00Z");

      await seedTrace(db, scope, { id: "t_checkout", traceId: "trace_checkout", name: "POST /checkout", at });
      await seedTrace(db, scope, { id: "t_health", traceId: "trace_health", name: "GET /health", at });
      await seedError(db, scope, { id: "e_checkout", traceId: "trace_checkout", severity: "error", at });
      await seedError(db, scope, { id: "e_health_1", traceId: "trace_health", severity: "error", at });
      await seedError(db, scope, { id: "e_health_2", traceId: "trace_health", severity: "error", at });

      const scoped = await evaluateAlertRule(db, {
        ...scope,
        type: "error_count",
        windowStart,
        windowEnd,
        routePattern: "POST /checkout"
      });
      expect(scoped.observedValue).toBe("1");

      const unscoped = await evaluateAlertRule(db, {
        ...scope,
        type: "error_count",
        windowStart,
        windowEnd
      });
      expect(unscoped.observedValue).toBe("3");
    });
  });

  it("critical_errors counts only critical errors on the scoped route", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const scope = { projectId: "prj_ce", environmentId: "env_ce" };
      await seedScope(db, scope.projectId, scope.environmentId);
      const at = new Date("2026-06-24T11:30:00Z");

      await seedTrace(db, scope, { id: "t_pay", traceId: "trace_pay", name: "POST /pay", at });
      await seedTrace(db, scope, { id: "t_ping", traceId: "trace_ping", name: "GET /ping", at });
      await seedError(db, scope, { id: "e_pay", traceId: "trace_pay", severity: "critical", at });
      await seedError(db, scope, { id: "e_ping", traceId: "trace_ping", severity: "fatal", at });
      // Same route, but not critical — must stay out of the count.
      await seedError(db, scope, { id: "e_pay_warn", traceId: "trace_pay", severity: "error", at });

      const scoped = await evaluateAlertRule(db, {
        ...scope,
        type: "critical_errors",
        windowStart,
        windowEnd,
        routePattern: "POST /pay"
      });
      expect(scoped.observedValue).toBe("1");

      const unscoped = await evaluateAlertRule(db, {
        ...scope,
        type: "critical_errors",
        windowStart,
        windowEnd
      });
      expect(unscoped.observedValue).toBe("2");
    });
  });

  it("error_count does not double-count when a trace id maps to several trace names", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const scope = { projectId: "prj_fanout", environmentId: "env_fanout" };
      await seedScope(db, scope.projectId, scope.environmentId);
      const at = new Date("2026-06-24T11:30:00Z");

      // One trace id, two rows with the same name: a join would fan out and
      // report 2 for a single error.
      await seedTrace(db, scope, { id: "t_a", traceId: "trace_dup", name: "POST /checkout", at });
      await seedTrace(db, scope, { id: "t_b", traceId: "trace_dup", name: "POST /checkout", at });
      await seedError(db, scope, { id: "e_dup", traceId: "trace_dup", severity: "error", at });

      const result = await evaluateAlertRule(db, {
        ...scope,
        type: "error_count",
        windowStart,
        windowEnd,
        routePattern: "POST /checkout"
      });
      expect(result.observedValue).toBe("1");
    });
  });

  // ---------------------------------------------------------------------------
  // dead_letter_count window
  //
  // The count ignored windowStart/windowEnd entirely, so the rule latched on
  // permanently after the first dead letter ever recorded.
  // ---------------------------------------------------------------------------

  it("dead_letter_count counts only jobs inside the evaluation window", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const scope = { projectId: "prj_dlq", environmentId: "env_dlq" };
      await seedScope(db, scope.projectId, scope.environmentId);

      const inside = new Date("2026-06-24T11:30:00Z");
      const before = new Date("2026-06-20T09:00:00Z");

      for (const [id, createdAt] of [
        ["dlq_old", before],
        ["dlq_recent", inside]
      ] as const) {
        await sql`
          insert into dead_letter_jobs (id, project_id, environment_id, queue_name, job_name, payload, error_message, created_at)
          values (${id}, ${scope.projectId}, ${scope.environmentId}, 'telemetry', 'persist', '{}'::jsonb, 'boom', ${createdAt})
        `.execute(db);
      }

      const result = await evaluateAlertRule(db, {
        ...scope,
        type: "dead_letter_count",
        windowStart,
        windowEnd
      });
      expect(result.observedValue).toBe("1");
    });
  });

  it("stores notification URLs and header secrets encrypted and only decrypts for explicit privileged reads", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const originalUrl = "https://hooks.invalid/services/synthetic-url-token";
      const channel = await createNotificationChannel(db, {
        name: "Synthetic webhook",
        type: "webhook",
        url: originalUrl,
        secretHeaderName: "X-Synthetic-Token",
        secretHeaderValue: "synthetic-notification-value",
        enabled: true
      }, box);

      const storedAfterCreate = await db
        .selectFrom("notification_channels")
        .selectAll()
        .where("id", "=", channel.id)
        .executeTakeFirstOrThrow() as {
          url: string | null;
          url_encrypted?: string | null;
          url_preview?: string | null;
          secret_header_value: string | null;
          secret_header_value_encrypted?: string | null;
        };
      expect(storedAfterCreate.url).toBeNull();
      expect(storedAfterCreate.url_encrypted).toMatch(/^v1\./);
      expect(storedAfterCreate.url_encrypted).not.toContain("synthetic-url-token");
      expect(storedAfterCreate.url_preview).toBe("https://hooks.invalid/…");
      expect(storedAfterCreate.secret_header_value).toBeNull();
      expect(storedAfterCreate.secret_header_value_encrypted).toMatch(/^v1\./);

      const decrypt = vi.spyOn(box, "decrypt");
      const adminChannel = (await listNotificationChannels(db))[0];
      expect(adminChannel?.url).toBeNull();
      expect(adminChannel?.hasUrl).toBe(true);
      expect(adminChannel?.urlPreview).toBe(storedAfterCreate.url_preview);
      expect(adminChannel?.hasSecret).toBe(true);
      expect(adminChannel?.secretHeaderValue).toBeNull();
      expect(adminChannel).not.toHaveProperty("urlEncrypted");
      expect(adminChannel).not.toHaveProperty("secretHeaderValueEncrypted");
      expect(decrypt).not.toHaveBeenCalled();

      const encryptedUrlBeforeOmittedUpdate = storedAfterCreate.url_encrypted;
      const encryptedBeforeOmittedUpdate = storedAfterCreate.secret_header_value_encrypted;
      await updateNotificationChannel(db, channel.id, { name: "Synthetic renamed" });
      const storedAfterOmittedUpdate = await db
        .selectFrom("notification_channels")
        .selectAll()
        .where("id", "=", channel.id)
        .executeTakeFirstOrThrow() as {
          url: string | null;
          url_encrypted?: string | null;
          secret_header_value: string | null;
          secret_header_value_encrypted?: string | null;
        };
      expect(storedAfterOmittedUpdate.url).toBeNull();
      expect(storedAfterOmittedUpdate.url_encrypted).toBe(encryptedUrlBeforeOmittedUpdate);
      expect(storedAfterOmittedUpdate.secret_header_value).toBeNull();
      expect(storedAfterOmittedUpdate.secret_header_value_encrypted).toBe(encryptedBeforeOmittedUpdate);
      expect(decrypt).not.toHaveBeenCalled();

      const replacementUrl = "https://hooks.invalid/services/synthetic-replacement-token";
      await updateNotificationChannel(db, channel.id, {
        url: replacementUrl,
        secretHeaderValue: "synthetic-notification-replacement"
      }, box);
      const storedAfterSecretUpdate = await db
        .selectFrom("notification_channels")
        .selectAll()
        .where("id", "=", channel.id)
        .executeTakeFirstOrThrow() as {
          url: string | null;
          url_encrypted?: string | null;
          secret_header_value: string | null;
          secret_header_value_encrypted?: string | null;
        };
      expect(storedAfterSecretUpdate.url).toBeNull();
      expect(storedAfterSecretUpdate.url_encrypted).toMatch(/^v1\./);
      expect(storedAfterSecretUpdate.url_encrypted).not.toBe(encryptedUrlBeforeOmittedUpdate);
      expect(storedAfterSecretUpdate.secret_header_value).toBeNull();
      expect(storedAfterSecretUpdate.secret_header_value_encrypted).toMatch(/^v1\./);
      expect(storedAfterSecretUpdate.secret_header_value_encrypted).not.toBe(encryptedBeforeOmittedUpdate);

      const privileged = await getNotificationChannel(db, channel.id, { includeSecret: true, secretBox: box });
      expect(privileged?.url).toBe(replacementUrl);
      expect(privileged?.secretHeaderValue).toBe("synthetic-notification-replacement");
      decrypt.mockRestore();
    });
  });

  it("fails privileged notification reads closed for missing, legacy, and invalid ciphertext", async () => {
    await withDb(async (db) => {
      await migrate(db);
      const channel = await createNotificationChannel(db, {
        name: "Synthetic fail closed webhook",
        type: "webhook",
        url: "https://hooks.invalid/fail-closed",
        secretHeaderName: "X-Synthetic-Token",
        secretHeaderValue: "synthetic-fail-closed-value",
        enabled: true
      }, box);

      await expect(getNotificationChannel(db, channel.id, { includeSecret: true })).rejects.toThrow("secret_box_required");

      await sql`
        update notification_channels
        set url = 'https://hooks.invalid/services/synthetic-legacy-token', url_encrypted = null,
          secret_header_value = 'synthetic-legacy-value', secret_header_value_encrypted = null
        where id = ${channel.id}
      `.execute(db);
      await expect(
        getNotificationChannel(db, channel.id, { includeSecret: true, secretBox: box })
      ).rejects.toThrow("legacy_plaintext_secret_present");

      const otherBox = new SecretBox({ currentKey: Buffer.alloc(32, 13).toString("base64") });
      const unknownUrlCiphertext = otherBox.encrypt("https://hooks.invalid/services/synthetic-unknown-token", {
        table: "notification_channels",
        rowId: channel.id,
        field: "url"
      });
      await sql`
        update notification_channels
        set url = null, url_encrypted = ${unknownUrlCiphertext},
          secret_header_value = null, secret_header_value_encrypted = null
        where id = ${channel.id}
      `.execute(db);
      await expect(
        getNotificationChannel(db, channel.id, { includeSecret: true, secretBox: box })
      ).rejects.toThrow("secret_key_unknown");

      const wrongAadCiphertext = box.encrypt("https://hooks.invalid/services/synthetic-wrong-aad-token", {
        table: "notification_channels",
        rowId: "synthetic-other-row",
        field: "url"
      });
      await sql`
        update notification_channels
        set url_encrypted = ${wrongAadCiphertext}
        where id = ${channel.id}
      `.execute(db);
      await expect(
        getNotificationChannel(db, channel.id, { includeSecret: true, secretBox: box })
      ).rejects.toThrow("secret_authentication_failed");

      const validCiphertext = box.encrypt("https://hooks.invalid/services/synthetic-tamper-token", {
        table: "notification_channels",
        rowId: channel.id,
        field: "url"
      });
      const parts = validCiphertext.split(".");
      parts[3] = `${parts[3]!.startsWith("A") ? "B" : "A"}${parts[3]!.slice(1)}`;
      const tamperedCiphertext = parts.join(".");
      await sql`
        update notification_channels
        set url_encrypted = ${tamperedCiphertext}
        where id = ${channel.id}
      `.execute(db);

      const ordinary = (await listNotificationChannels(db)).find((item) => item.id === channel.id);
      expect(ordinary).toMatchObject({ id: channel.id, url: null, hasUrl: true });
      expect(ordinary).not.toHaveProperty("urlEncrypted");
      await expect(
        getNotificationChannel(db, channel.id, { includeSecret: true, secretBox: box })
      ).rejects.toThrow("secret_authentication_failed");
    });
  });
});
